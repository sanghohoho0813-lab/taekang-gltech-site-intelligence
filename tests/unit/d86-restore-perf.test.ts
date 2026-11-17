/**
 * D-86 1년치 규모 복원 시간 — 서버 함수 시간 한도(60초) 안에 끝나야 한다.
 * 원가 9,000 · 활동 이력 25,000 · 출퇴근 9,000 · 보고 3,000건(약 4.6만 줄)을 묶어 넣는다.
 */
import { gzipSync } from "node:zlib";
import { afterAll, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

const URL_ = await testDatabaseUrl("d86perf");
process.env.DATABASE_URL = URL_;
const { getDb } = await import("@/server/sql");
const { restoreCompany } = await import("@/server/restore");
const { createSeed } = await import("@/lib/data/seed");

afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(URL_);
});

it("1년치 규모(약 4.6만 줄) 백업 복원 < 30초 · 압축 백업 < 3MB", { timeout: 120_000 }, async () => {
  const now = new Date("2026-11-14T03:00:00Z");
  const db = createSeed(now);
  const cats = ["material", "labor", "subcontract", "equipment", "overhead"] as const;
  const ce = db.costEntries[0];
  for (let i = 0; i < 9000; i++) {
    const d = new Date(now.getTime() - (i % 365) * 86_400_000).toISOString();
    db.costEntries.push({ ...ce, id: `ce-y-${i}`, siteId: ["site-a", "site-b", "site-c"][i % 3], category: cats[i % 5], amount: 100_000 + (i % 50) * 10_000, date: d.slice(0, 10), forecastImpact: "within_forecast", createdAt: d });
  }
  for (let i = 0; i < 25_000; i++) db.activityLogs.push({ id: `log-y-${i}`, at: new Date(now.getTime() - i * 600_000).toISOString(), by: "u-manager", type: "cost", summary: `원가 입력 ${i}번 — 레미콘 타설 자재 반입 기록`, siteId: "site-a" });
  const att = db.attendance?.[0];
  // 작업자 30명 × 300일 (한 사람이 같은 날 여러 번 겹치지 않게 — 실제 자료 모양)
  if (att)
    for (let i = 0; i < 9000; i++) {
      const day = new Date(now.getTime() - Math.floor(i / 30) * 86_400_000).toISOString().slice(0, 10);
      db.attendance!.push({ ...att, id: `att-y-${i}`, userId: `u-w${i % 30}`, workDate: day, inAt: `${day}T00:00:00.000Z`, outAt: `${day}T08:00:00.000Z` });
    }
  const rep = db.reports[0];
  for (let i = 0; i < 3000; i++) db.reports.push({ ...rep, id: `rep-y-${i}` });
  const members = db.users.map((u) => ({ id: u.id, email: `${u.id}@year.test`, name: u.name, title: u.title, role: u.role, siteIds: [], partnerSiteIds: u.partnerSiteIds ?? [], active: true }));
  // 시드 사진은 data: 주소 → 저장된 시스템의 백업처럼 주소로 바꾼다
  const photos = db.photos.map((p) => ({ ...p, dataUrl: `/api/photos/${p.id}` }));
  const json = JSON.stringify({ format: "taekang-site-intelligence-backup", version: 1, exportedAt: now.toISOString(), companyId: "co-year", members, data: { ...db, photos, users: undefined } }, null, 1);
  const gz = gzipSync(Buffer.from(json));
  expect(gz.length).toBeLessThan(3_000_000);
  const t = performance.now();
  const r = await restoreCompany({ backup: gz.toString("base64"), email: "u-ceo@year.test", password: "Yearowner2027" }, now);
  const ms = performance.now() - t;
  console.log(`[d86] 1년치 복원 ${Math.round(ms)}ms · 원문 ${(json.length / 1e6).toFixed(1)}MB · 압축 ${(gz.length / 1e6).toFixed(2)}MB`);
  expect(ms).toBeLessThan(30_000);
  expect(r.summary.counts.costEntries).toBe(db.costEntries.length);
  const pg = await getDb();
  const [{ n }] = await pg.query<{ n: string }>(`select count(*) as n from records where company_id = 'co-year'`);
  expect(Number(n)).toBeGreaterThan(46_000);
});
