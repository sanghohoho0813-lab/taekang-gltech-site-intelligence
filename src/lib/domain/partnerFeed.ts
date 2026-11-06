/** 발주처 포털 — 최근 공정 변화 (현장 보고의 공정 진척만 · 보고 글·금액·사람 이름 없음 · D-67) */
import type { DemoDB, PartnerFeedItem, PartnerRepairView, PartnerRequest, SitePhoto } from "./types";
import { shiftDate } from "./attendance";

export const PARTNER_FEED_DAYS = 14;
/** 서버가 발주처에게 보내는 공정 변화 기간 — 월간 보고서(이번 달·지난달)를 만들 수 있게 (D-68) */
export const PARTNER_FEED_KEEP_DAYS = 62;

export function partnerProgressFeed(db: DemoDB, siteId: string, today: string, days = PARTNER_FEED_DAYS): PartnerFeedItem[] {
  const from = shiftDate(today, -(days - 1));
  const byKey = new Map<string, PartnerFeedItem>();
  // 보낸 순서대로 — 같은 날 같은 단계는 처음 값 → 마지막 값 (최솟값·최댓값으로 합쳐 실제와 다른 숫자가 나오던 문제 · D-67 점검 반영)
  // 보고 목록은 새것이 앞에 쌓인다 — 같은 시각이면 목록 뒤쪽(먼저 보낸 것)이 먼저
  const reports = db.reports
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.siteId === siteId && r.status !== "voided" && r.reportDate >= from && r.reportDate <= today)
    .sort((a, b) => a.r.createdAt.localeCompare(b.r.createdAt) || b.i - a.i)
    .map(({ r }) => r);
  for (const r of reports) {
    const changes = [...(r.stages ?? []).map((c) => ({ stage: c.name, from: c.from, to: c.to })), ...(r.progress ? [{ stage: "전체 공정률", from: r.progress.from, to: r.progress.to }] : [])];
    for (const c of changes) {
      const k = `${r.reportDate}|${c.stage}`;
      const cur = byKey.get(k);
      byKey.set(k, cur ? { ...cur, to: c.to } : { date: r.reportDate, ...c });
    }
  }
  return [...byKey.values()].filter((f) => f.from !== f.to).sort((a, b) => (a.date === b.date ? a.stage.localeCompare(b.stage) : b.date.localeCompare(a.date)));
}

/** 취소한 보고·자재 기록의 사진은 공개하지 않는다 (D-67 점검 반영) */
export function photoWithdrawn(db: Pick<DemoDB, "reports" | "materialMoves">, p: SitePhoto): boolean {
  if (p.reportId && db.reports.find((r) => r.id === p.reportId)?.status === "voided") return true;
  if (p.materialMoveId && (db.materialMoves ?? []).find((m) => m.id === p.materialMoveId)?.voided) return true;
  return false;
}

/** 하자보수 회신과 함께 보낸 보수 완료 사진 — 그 요청을 보낸 발주처에게만, ‘공정 사진’ 목록에는 넣지 않는다 (D-68) */
export function replyPhotoIds(db: Pick<DemoDB, "partnerRequests">): Set<string> {
  return new Set(db.partnerRequests.flatMap((r) => r.replyPhotoIds ?? []));
}

/** 하자보수 사진 전체 — 하자보수 작업지시의 완료 사진 + 회신 사진. 사진대장에서 전체 공개하지 않는다 (D-68 점검 반영) */
export function repairPhotoIds(db: Pick<DemoDB, "partnerRequests" | "workOrders">): Set<string> {
  const ids = replyPhotoIds(db);
  for (const w of db.workOrders ?? []) if (w.sourcePartnerRequestId) for (const id of w.donePhotoIds ?? []) ids.add(id);
  return ids;
}

/** 발주처에 공개한 공정 사진 (최근 것부터) */
export function sharedPhotos(db: DemoDB, siteId: string) {
  const reply = replyPhotoIds(db);
  return db.photos.filter((p) => p.siteId === siteId && p.shared && !reply.has(p.id) && !photoWithdrawn(db, p)).sort((a, b) => (b.shared!.at > a.shared!.at ? 1 : -1));
}

/**
 * 하자보수 진행 (발주처용): 작업지시 상태 → 배정·보수 중·마무리 확인 중·보수 완료. 담당자·메모는 빼고 단계·기한만 (D-68)
 * ‘보수 완료’는 태강지엘텍이 확인했을 때만 — 작업지시 완료 확인, 또는 현장 완료 뒤 회신 (현장이 ‘일부만 끝냈어요’로 보내도 완료로 보이던 문제 · D-68 점검 반영)
 */
export function partnerRepairView(db: Pick<DemoDB, "workOrders">, r: Pick<PartnerRequest, "linkedWorkOrderId" | "history">): PartnerRepairView | undefined {
  if (!r.linkedWorkOrderId) return undefined;
  const found = (db.workOrders ?? []).find((x) => x.id === r.linkedWorkOrderId);
  if (!found) return undefined;
  const w = found;
  const last = (pred: (h: (typeof w.history)[number]) => boolean) => [...w.history].reverse().find(pred)?.at;
  let stage: PartnerRepairView["stage"];
  let at: string;
  if (w.status === "confirmed") {
    stage = "done";
    at = last((h) => h.to === "confirmed") ?? w.createdAt;
  } else if (w.status === "done") {
    const doneAt = last((h) => h.to === "done") ?? w.createdAt;
    const answeredAfter = [...r.history].reverse().find((h) => h.status === "answered" && h.at >= doneAt && !(h.note ?? "").startsWith("발주처 확인"));
    stage = answeredAfter ? "done" : "checking";
    at = answeredAfter?.at ?? doneAt;
  } else if (w.status === "in_progress" || w.status === "returned") {
    stage = "in_progress";
    at = last((h) => h.to === "in_progress" || h.to === "returned") ?? w.createdAt;
  } else {
    stage = "assigned";
    at = w.createdAt;
  }
  return { stage, ...(w.dueDate ? { dueDate: w.dueDate } : {}), at };
}

/** 발주처에게 보이는 하자보수 한 줄 상태 — 포털·월간 보고서가 같은 말을 쓴다 (D-68 점검 반영) */
export const DEFECT_STEPS = ["접수", "보수 배정", "보수 중", "보수 완료", "확인 완료"] as const;
export function defectProgress(r: Pick<PartnerRequest, "status" | "confirmedAt">, repair: PartnerRepairView | undefined): { step: number; label: string } {
  if (r.confirmedAt) return { step: 4, label: "확인 완료" };
  if (!repair) return { step: 0, label: r.status === "answered" ? "회신 완료" : r.status === "reviewing" ? "검토 중" : "접수" };
  if (repair.stage === "done") return { step: 3, label: "보수 완료" };
  if (repair.stage === "checking") return { step: 2, label: "보수 중 · 마무리 확인 중" };
  if (repair.stage === "in_progress") return { step: 2, label: "보수 중" };
  return { step: 1, label: "보수 배정" };
}

/** 이 기간(포함)의 날짜 — 월간 보고서용 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

export interface PartnerMonthly {
  month: string;
  from: string;
  to: string;
  /** 이번 달 단계별 진척 — 그 달 첫 기록의 시작값 → 마지막 기록의 값 */
  stages: { stage: string; from: number; to: number }[];
  overall?: { from: number; to: number };
  photos: SitePhoto[];
  requests: PartnerRequest[];
  counts: { received: number; answered: number; open: number; defects: number; repaired: number; confirmed: number };
  /** 다음 달에 걸친 미완료 공정 */
  next: { name: string; startDate: string; endDate: string; progressPct: number; late: boolean }[];
}

/** 발주처 월간 공정 보고서 (D-68) — 금액·사람 이름·보고 원문 없이 공정·공개 사진·요청 처리만 */
export function partnerMonthly(db: DemoDB, siteId: string, month: string, feed: PartnerFeedItem[], partnerUserId?: string): PartnerMonthly {
  const { from, to } = monthRange(month);
  const site = db.sites.find((s) => s.id === siteId);
  const inMonth = feed.filter((f) => f.date >= from && f.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const agg = new Map<string, { stage: string; from: number; to: number }>();
  for (const f of inMonth) {
    const cur = agg.get(f.stage);
    agg.set(f.stage, cur ? { ...cur, to: f.to } : { stage: f.stage, from: f.from, to: f.to });
  }
  const overallRow = agg.get("전체 공정률");
  agg.delete("전체 공정률");
  const order = new Map((site?.stages ?? []).map((s, i) => [s.name, i]));
  const stages = [...agg.values()].filter((x) => x.from !== x.to).sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99));
  const photos = sharedPhotos(db, siteId)
    .filter((p) => kst(p.createdAt) >= from && kst(p.createdAt) <= to)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 12);
  const touched = (r: PartnerRequest) => r.history.some((h) => kst(h.at) >= from && kst(h.at) <= to);
  const requests = db.partnerRequests.filter((r) => r.siteId === siteId && (!partnerUserId || r.partnerUserId === partnerUserId) && touched(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const at = (iso?: string) => !!iso && kst(iso) >= from && kst(iso) <= to;
  const counts = {
    received: requests.filter((r) => at(r.createdAt)).length,
    // 처음 회신한 날 기준 — 발주처 확인·보수 사진 추가 회신은 회신 건수로 세지 않는다 (D-68 점검 반영)
    answered: requests.filter((r) => r.status === "answered" && at(r.history.find((h) => h.status === "answered")?.at)).length,
    open: requests.filter((r) => r.status !== "answered").length,
    defects: requests.filter((r) => r.type === "defect").length,
    repaired: requests.filter((r) => r.type === "defect" && r.status === "answered").length,
    confirmed: requests.filter((r) => at(r.confirmedAt)).length,
  };
  const [y, m] = month.split("-").map(Number);
  const nm = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const nr = monthRange(nm);
  // 계획 기간이 지났는데 끝나지 않은 공정도 넣고 ‘계획보다 늦음’으로 (D-68 점검 반영)
  const next = (site?.stages ?? [])
    .filter((s) => s.progressPct < 100 && s.startDate <= nr.to)
    .map((s) => ({ name: s.name, startDate: s.startDate, endDate: s.endDate, progressPct: s.progressPct, late: s.endDate < nr.from }));
  return { month, from, to, stages, ...(overallRow && overallRow.from !== overallRow.to ? { overall: { from: overallRow.from, to: overallRow.to } } : {}), photos, requests, counts, next };
}
