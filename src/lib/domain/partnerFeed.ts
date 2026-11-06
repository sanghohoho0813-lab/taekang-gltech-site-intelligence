/** 발주처 포털 — 최근 공정 변화 (현장 보고의 공정 진척만 · 보고 글·금액·사람 이름 없음 · D-67) */
import type { DemoDB, PartnerFeedItem, SitePhoto } from "./types";
import { shiftDate } from "./attendance";

export const PARTNER_FEED_DAYS = 14;

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

/** 발주처에 공개한 사진 (최근 것부터) */
export function sharedPhotos(db: DemoDB, siteId: string) {
  return db.photos.filter((p) => p.siteId === siteId && p.shared && !photoWithdrawn(db, p)).sort((a, b) => (b.shared!.at > a.shared!.at ? 1 : -1));
}
