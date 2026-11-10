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

/** 본사용 공정 진행 이력 (D-71) — 발주처 월간 보고서와 같은 규칙(같은 날 같은 단계는 처음 값 → 마지막 값), 날짜별로, 엑셀로 옮긴 기록인지 단계마다 표시 (최근 날짜부터) */
export interface ProgressHistoryChange {
  stage: string;
  from: number;
  to: number;
  /** 엑셀로 옮긴 지난 기록 */
  imported: boolean;
  /** 앞 기록이 없는 첫 기록 (from = to) — ‘올랐다’가 아니라 그날 값 */
  first: boolean;
}
export interface ProgressHistoryDay {
  date: string;
  changes: ProgressHistoryChange[];
  /** 그날 기록이 모두 엑셀로 옮긴 지난 기록 */
  imported: boolean;
}
export function progressHistory(db: DemoDB, siteId: string, today: string): ProgressHistoryDay[] {
  const site = db.sites.find((s) => s.id === siteId);
  const order = new Map((site?.stages ?? []).map((st, i) => [st.id, i]));
  const reports = db.reports
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.siteId === siteId && r.status !== "voided" && r.reportDate <= today)
    .sort((a, b) => a.r.createdAt.localeCompare(b.r.createdAt) || b.i - a.i)
    .map(({ r }) => r);
  const byKey = new Map<string, ProgressHistoryChange & { date: string; key: string }>();
  for (const r of reports) {
    const imp = !!r.importBatchId;
    const changes = [...(r.stages ?? []).map((c) => ({ key: c.stageId, stage: c.name, from: c.from, to: c.to })), ...(r.progress ? [{ key: "*", stage: "전체 공정률", from: r.progress.from, to: r.progress.to }] : [])];
    for (const c of changes) {
      const k = `${r.reportDate}|${c.key}`;
      const cur = byKey.get(k);
      byKey.set(k, cur ? { ...cur, to: c.to, imported: cur.imported && imp } : { date: r.reportDate, ...c, imported: imp, first: imp && c.from === c.to });
    }
  }
  const days = new Map<string, ProgressHistoryDay>();
  for (const c of byKey.values()) {
    if (c.from === c.to && !c.first) continue;
    const d = days.get(c.date) ?? { date: c.date, changes: [], imported: true };
    d.changes.push({ stage: c.stage, from: c.from, to: c.to, imported: c.imported, first: c.first && c.from === c.to });
    (d.changes as (ProgressHistoryChange & { key?: string })[]).at(-1)!.key = c.key;
    days.set(c.date, d);
  }
  for (const d of days.values()) {
    d.imported = d.changes.every((c) => c.imported);
    // 전체 공정률 먼저, 그다음 현장 공정 단계 순서
    const rank = (c: ProgressHistoryChange & { key?: string }) => (c.key === "*" ? -1 : (order.get(c.key ?? "") ?? 99));
    d.changes.sort((a, b) => rank(a) - rank(b));
    for (const c of d.changes as (ProgressHistoryChange & { key?: string })[]) delete c.key;
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
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
    // 보수 완료일 = 본사가 처음 완료를 확인한 때 — 회신이 먼저였으면 회신한 날 (나중에 작업지시를 확인해도 날짜가 밀리지 않게 · D-69 점검 반영)
    const doneAt = last((h) => h.to === "done") ?? w.createdAt;
    const confirmedAt = last((h) => h.to === "confirmed") ?? w.createdAt;
    const answeredAfter = r.history.find((h) => h.status === "answered" && h.at >= doneAt && !(h.note ?? "").startsWith("발주처 확인"))?.at;
    at = answeredAfter && answeredAfter < confirmedAt ? answeredAfter : confirmedAt;
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
export function defectProgress(r: Pick<PartnerRequest, "status" | "confirmedAt"> & { closedWithoutRepair?: true }, repair: PartnerRepairView | undefined): { step: number; label: string } {
  if (r.confirmedAt) return { step: 4, label: "확인 완료" };
  // 작업지시 전: 접수 단계 — 본사가 ‘작업지시 없이 처리 끝’으로 회신했으면 처리 완료 (D-69 점검 반영)
  if (!repair) return r.closedWithoutRepair ? { step: 3, label: "처리 완료 (보수 없음)" } : { step: 0, label: r.status === "received" ? "접수" : r.status === "answered" ? "접수 · 회신 받음" : "접수 · 검토 중" };
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
  /** 다음 달에 걸친 미완료 공정 (보고 기간 끝 기준) — late(계획보다 늦음)는 본사 화면에서만 쓴다 */
  next: { name: string; startDate: string; endDate: string; progressPct: number; late: boolean }[];
  /** 지난 달 보고서인가 (작성일이 그 달이 끝난 뒤) */
  past: boolean;
  /** 보고 기간 끝의 전체 공정률 — 이번 달이면 지금 값, 지난 달이면 그 달 말일 값 (D-73 점검 9차) */
  endPct: number;
  /** 보고 기간 끝의 단계별 진행률 (현장 공정 단계 순서) */
  stageEnd: number[];
}

/** 발주처 월간 공정 보고서 (D-68) — 금액·사람 이름·보고 원문 없이 공정·공개 사진·요청 처리만 */
/**
 * today(작성일)를 주면 지난 달 보고서는 ‘그 달 말일’ 값으로 만든다 — 10월 보고서에 11월 수치가 10월 것처럼 찍히던 문제 (D-73 점검 9차).
 * 그 달 말일 값 = 그 달까지의 마지막 기록, 없으면 그 뒤 첫 기록이 바뀌기 전 값, 그것도 없으면 지금 값(그동안 바뀐 적 없음).
 */
export function partnerMonthly(db: DemoDB, siteId: string, month: string, feed: PartnerFeedItem[], partnerUserId?: string, today?: string): PartnerMonthly {
  const { from, to } = monthRange(month);
  const site = db.sites.find((s) => s.id === siteId);
  const past = !!today && today > to;
  const endOf = (stage: string, current: number) => {
    if (!past) return current;
    const rows = feed.filter((f) => f.stage === stage).sort((a, b) => a.date.localeCompare(b.date));
    const before = rows.filter((f) => f.date <= to).at(-1);
    if (before) return before.to;
    const after = rows.find((f) => f.date > to);
    return after ? after.from : current;
  };
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
    // 포털·하자보수 현황과 같은 기준 (보수 완료·처리 완료 · D-69 점검 반영)
    repaired: requests.filter((r) => r.type === "defect" && defectProgress(r, partnerRepairView(db, r)).step >= 3).length,
    confirmed: requests.filter((r) => at(r.confirmedAt)).length,
  };
  const [y, m] = month.split("-").map(Number);
  const nm = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const nr = monthRange(nm);
  const stageEnd = (site?.stages ?? []).map((st) => endOf(st.name, st.progressPct));
  const endPct = endOf("전체 공정률", site?.progressPct ?? 0);
  // 계획 기간이 지났는데 끝나지 않은 공정도 넣는다 (D-68 점검 반영) — 보고 기간 끝의 진행률 기준
  const next = (site?.stages ?? [])
    .map((s, i) => ({ name: s.name, startDate: s.startDate, endDate: s.endDate, progressPct: stageEnd[i], late: s.endDate < nr.from }))
    .filter((s) => s.progressPct < 100 && s.startDate <= nr.to);
  return { month, from, to, stages, ...(overallRow && overallRow.from !== overallRow.to ? { overall: { from: overallRow.from, to: overallRow.to } } : {}), photos, requests, counts, next, past, endPct, stageEnd };
}
