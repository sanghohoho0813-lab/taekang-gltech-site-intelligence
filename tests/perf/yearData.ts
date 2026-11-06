/**
 * 성능 측정용 1년치(기본 300 작업일) 가짜 운영 데이터 — year.perf·peak.perf 공용
 * 규모(중견 창호·유리 시공사 가정): 현장 6곳 · 현장 직원 20명 · 하루 출퇴근 20 · 보고 6 · 작업 인원 18 · 활동 이력 50
 *   + 자재 반입·설치 (D-64): 현장마다 하루 설치 1건, 사흘에 반입 1건 → 300일 약 2,400건
 */
import { getDb } from "@/server/sql";

export const SITES = ["site-a", "site-b", "site-c", "site-y1", "site-y2", "site-y3"];

/** 오늘(한국 날짜)로 끝나는 days일 — i번째 날짜 */
export function dayFn(days: number) {
  const todayMs = Date.parse(new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10));
  return (i: number) => new Date(todayMs - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
}

async function bulk(companyId: string, collection: string, items: Record<string, unknown>[]) {
  const db = await getDb();
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk.map((x, j) => {
      params.push(companyId, collection, String(x.id), (x.siteId as string) ?? null, JSON.stringify(x));
      const b = j * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb)`;
    });
    await db.query(`insert into records (company_id, collection, id, site_id, data) values ${values.join(",")}`, params);
  }
}

/** DAYS일치 기록을 넣고 넣은 건수를 돌려준다 */
export async function seedYear(companyId: string, DAYS: number): Promise<number> {
  const day = dayFn(DAYS);
  const users = Array.from({ length: 20 }, (_, i) => (i === 0 ? "u-field" : `u-f${i}`));
  const att: Record<string, unknown>[] = [];
  const reports: Record<string, unknown>[] = [];
  const photos: Record<string, unknown>[] = [];
  const crew: Record<string, unknown>[] = [];
  const costs: Record<string, unknown>[] = [];
  const orders: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const moves: Record<string, unknown>[] = [];
  const geo = { status: "inside", lat: 37.5, lng: 127.03, accuracyM: 12, distanceM: 40 };
  for (let d = 0; d < DAYS; d++) {
    const date = day(d);
    users.forEach((u, i) => att.push({ id: `att-${d}-${i}`, siteId: SITES[i % 6], userId: u, workDate: date, inAt: `${date}T07:3${i % 10}:00+09:00`, inGeo: geo, inDevice: `dev-${i}`, outAt: `${date}T17:2${i % 10}:00+09:00`, outGeo: geo, outDevice: `dev-${i}` }));
    SITES.forEach((s, si) => {
      const rid = `rep-${d}-${si}`;
      reports.push({ id: rid, siteId: s, reportDate: date, workDone: `${si + 3}층 커튼월 유닛 ${d % 12}개 설치, 실링 사전 점검 및 앵커 토크 검사`, issues: d % 5 ? "" : "크레인 대기 40분", tomorrowPlan: "다음 층 앵커 설치", photoIds: [`ph-${d}-${si}-0`, `ph-${d}-${si}-1`], costEntryIds: [], createdBy: users[si], createdAt: `${date}T17:00:00+09:00`, status: "submitted", geo, review: { status: "confirmed", at: `${date}T18:30:00+09:00`, by: "u-manager" } });
      for (let p = 0; p < 2; p++) photos.push({ id: `ph-${d}-${si}-${p}`, siteId: s, reportId: rid, dataUrl: `/api/photos/ph-${d}-${si}-${p}`, caption: "현장 사진", createdAt: `${date}T16:50:00+09:00`, createdBy: users[si] });
      for (let t = 0; t < 3; t++) crew.push({ id: `crew-${d}-${si}-${t}`, siteId: s, workDate: date, team: ["유리 설치팀", "실링팀", "철골팀"][t], kind: t ? "direct" : "subcontract", headcount: 3 + t, photoId: `ph-${d}-${si}-0`, photoHash: `h${d}${si}${t}`.padEnd(64, "0"), geo, at: `${date}T09:00:00+09:00`, by: users[si] });
      moves.push({ id: `mm-${d}-${si}-i`, siteId: s, itemId: `mat-${s}-unit`, kind: "install", qty: 1 + (d % 12), workDate: date, note: d % 4 ? "" : `${si + 3}층 동측`, at: `${date}T16:30:00+09:00`, by: users[si] });
      if (d % 3 === 0) moves.push({ id: `mm-${d}-${si}-r`, siteId: s, itemId: `mat-${s}-unit`, kind: "in", qty: 24, workDate: date, note: "송장 대조", at: `${date}T09:30:00+09:00`, by: users[si] });
      if (d % 2 === 0) costs.push({ id: `ce-${d}-${si}`, siteId: s, category: ["material", "labor", "subcontract", "equipment", "overhead"][d % 5], amount: 1_000_000 + d * 1000, date, forecastImpact: "within_forecast", reason: "planned", note: "자재 반입", source: "FIELD", createdBy: users[si], createdAt: `${date}T17:00:00+09:00`, status: "active" });
    });
    for (let k = 0; k < 3; k++) {
      const s = SITES[(d + k) % 6];
      if (orders.length < DAYS * 3.4) orders.push({ id: `wo-${d}-${k}`, siteId: s, title: "2층 실링 보수", detail: "누수 부위 확인", assigneeUserId: users[k], status: "confirmed", createdAt: `${date}T08:00:00+09:00`, createdBy: "u-manager", doneNote: "보수 완료", doneQty: "6m", history: [{ at: `${date}T08:00:00+09:00`, by: "u-manager", to: "sent" }, { at: `${date}T08:30:00+09:00`, by: users[k], to: "received" }, { at: `${date}T15:00:00+09:00`, by: users[k], to: "done" }, { at: `${date}T18:00:00+09:00`, by: "u-manager", to: "confirmed" }] });
    }
    for (let k = 0; k < 50; k++) logs.push({ id: `log-${d}-${k}`, at: `${date}T${String(7 + (k % 12)).padStart(2, "0")}:00:${String(k).padStart(2, "0")}+09:00`, by: users[k % 20], type: ["attendance", "report", "crew", "order"][k % 4], siteId: SITES[k % 6], summary: `현장 기록 ${k}` });
  }
  await bulk(companyId, "attendance", att);
  await bulk(companyId, "reports", reports);
  await bulk(companyId, "photos", photos);
  await bulk(companyId, "crewChecks", crew);
  await bulk(companyId, "costEntries", costs);
  await bulk(companyId, "workOrders", orders);
  await bulk(companyId, "activityLogs", logs);
  await bulk(companyId, "materialMoves", moves);
  return att.length + reports.length + photos.length + crew.length + costs.length + orders.length + logs.length + moves.length;
}
