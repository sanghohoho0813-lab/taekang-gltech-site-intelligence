/** 발주처 포털 — 최근 공정 변화 (현장 보고의 공정 진척만 · 보고 글·금액·사람 이름 없음 · D-67) */
import type { DemoDB, PartnerFeedItem } from "./types";
import { shiftDate } from "./attendance";

export const PARTNER_FEED_DAYS = 14;

export function partnerProgressFeed(db: DemoDB, siteId: string, today: string, days = PARTNER_FEED_DAYS): PartnerFeedItem[] {
  const from = shiftDate(today, -(days - 1));
  const byKey = new Map<string, PartnerFeedItem>();
  for (const r of db.reports) {
    if (r.siteId !== siteId || r.status === "voided" || r.reportDate < from || r.reportDate > today) continue;
    const changes = [...(r.stages ?? []).map((c) => ({ stage: c.name, from: c.from, to: c.to })), ...(r.progress ? [{ stage: "전체 공정률", from: r.progress.from, to: r.progress.to }] : [])];
    for (const c of changes) {
      if (c.to === c.from) continue;
      const k = `${r.reportDate}|${c.stage}`;
      const cur = byKey.get(k);
      byKey.set(k, cur ? { ...cur, from: Math.min(cur.from, c.from), to: Math.max(cur.to, c.to) } : { date: r.reportDate, ...c });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.date === b.date ? a.stage.localeCompare(b.stage) : b.date.localeCompare(a.date)));
}

/** 발주처에 공개한 사진 (최근 것부터) */
export function sharedPhotos(db: DemoDB, siteId: string) {
  return db.photos.filter((p) => p.siteId === siteId && p.shared).sort((a, b) => (b.shared!.at > a.shared!.at ? 1 : -1));
}
