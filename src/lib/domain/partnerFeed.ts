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

/** 발주처에 공개한 공정 사진 (최근 것부터) */
export function sharedPhotos(db: DemoDB, siteId: string) {
  const reply = replyPhotoIds(db);
  return db.photos.filter((p) => p.siteId === siteId && p.shared && !reply.has(p.id) && !photoWithdrawn(db, p)).sort((a, b) => (b.shared!.at > a.shared!.at ? 1 : -1));
}

/** 하자보수 진행 (발주처용): 작업지시 상태 → 배정·보수 중·보수 완료. 담당자·메모는 빼고 단계·기한만 (D-68) */
export function partnerRepairView(db: Pick<DemoDB, "workOrders">, r: Pick<PartnerRequest, "linkedWorkOrderId">): PartnerRepairView | undefined {
  if (!r.linkedWorkOrderId) return undefined;
  const w = (db.workOrders ?? []).find((x) => x.id === r.linkedWorkOrderId);
  if (!w) return undefined;
  const stage: PartnerRepairView["stage"] = w.status === "done" || w.status === "confirmed" ? "done" : w.status === "in_progress" || w.status === "returned" ? "in_progress" : "assigned";
  const at = [...w.history].reverse().find((h) => (stage === "done" ? h.to === "done" : stage === "in_progress" ? h.to === "in_progress" || h.to === "returned" : true))?.at ?? w.createdAt;
  return { stage, ...(w.dueDate ? { dueDate: w.dueDate } : {}), at };
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
  next: { name: string; startDate: string; endDate: string; progressPct: number }[];
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
    answered: requests.filter((r) => r.status === "answered" && r.history.some((h) => h.status === "answered" && at(h.at))).length,
    open: requests.filter((r) => r.status !== "answered").length,
    defects: requests.filter((r) => r.type === "defect").length,
    repaired: requests.filter((r) => r.type === "defect" && r.status === "answered").length,
    confirmed: requests.filter((r) => at(r.confirmedAt)).length,
  };
  const [y, m] = month.split("-").map(Number);
  const nm = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  const nr = monthRange(nm);
  const next = (site?.stages ?? [])
    .filter((s) => s.progressPct < 100 && s.startDate <= nr.to && s.endDate >= nr.from)
    .map((s) => ({ name: s.name, startDate: s.startDate, endDate: s.endDate, progressPct: s.progressPct }));
  return { month, from, to, stages, ...(overallRow && overallRow.from !== overallRow.to ? { overall: { from: overallRow.from, to: overallRow.to } } : {}), photos, requests, counts, next };
}
