/**
 * D-86 1년치 규모 복원 — 실제와 비슷하게 내용이 섞인 자료(같은 줄 복사는 압축이 지나치게 잘 돼 크기를 작게 잘못 본다 · 점검 반영).
 * 원가 9,000 · 활동 이력 25,000 · 출퇴근 9,000 · 보고 3,000건(약 4.6만 줄)을 만들어
 * - 압축 크기(서버 요청 한도 4.5MB를 넘으면 조각으로 나눠 올린다)
 * - 조각 올리기 → 합쳐서 복원이 서버 시간 한도(60초) 안에 끝나는지
 * 를 본다.
 */
import { gzipSync } from "node:zlib";
import { afterAll, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

const URL_ = await testDatabaseUrl("d86perf");
process.env.DATABASE_URL = URL_;
const { getDb } = await import("@/server/sql");
const { restoreCompany, storeRestorePart } = await import("@/server/restore");
const { CommandError } = await import("@/lib/data/commands");
const { createSeed } = await import("@/lib/data/seed");

afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(URL_);
});

/** 같은 씨앗이면 같은 자료 — 내용이 줄마다 다르게 */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
}
const WORDS = ["레미콘", "타설", "철근", "배근", "거푸집", "해체", "양중", "타워크레인", "커튼월", "앵커", "실링", "방수", "도장", "전기", "배관", "설비", "외벽", "층", "동측", "서측", "남측", "북측", "자재", "반입", "검측", "감리", "협의", "추가", "변경", "설계", "야간", "우천", "중지", "재개", "완료", "점검", "보수", "하자", "인력", "장비"];

it("1년치 규모(약 4.6만 줄 · 내용 섞임) 압축 크기 · 조각 올리기 → 합쳐 복원 < 30초", { timeout: 180_000 }, async () => {
  const r = rng(86);
  const pick = () => WORDS[Math.floor(r() * WORDS.length)];
  const phrase = (n: number) => Array.from({ length: n }, pick).join(" ") + ` ${Math.floor(r() * 900 + 100)}`;
  const now = new Date("2026-11-14T03:00:00Z");
  const db = createSeed(now);
  const cats = ["material", "labor", "subcontract", "equipment", "overhead"] as const;
  const ce = db.costEntries[0];
  for (let i = 0; i < 9000; i++) {
    const d = new Date(now.getTime() - Math.floor(r() * 365) * 86_400_000 - Math.floor(r() * 86_400_000)).toISOString();
    db.costEntries.push({ ...ce, id: `ce_${Math.floor(r() * 1e12).toString(36)}${i}`, siteId: ["site-a", "site-b", "site-c"][i % 3], category: cats[Math.floor(r() * 5)], amount: Math.floor(r() * 5_000) * 1_000 + 10_000, date: d.slice(0, 10), forecastImpact: "within_forecast", note: phrase(4), createdAt: d });
  }
  for (let i = 0; i < 25_000; i++) db.activityLogs.push({ id: `log_${Math.floor(r() * 1e12).toString(36)}${i}`, at: new Date(now.getTime() - i * 1_200_000 - Math.floor(r() * 600_000)).toISOString(), by: ["u-manager", "u-field", "u-field2", "u-ceo"][Math.floor(r() * 4)], type: ["cost", "report", "attendance", "billing"][Math.floor(r() * 4)], summary: phrase(6), siteId: ["site-a", "site-b", "site-c"][i % 3] });
  const att = db.attendance?.[0];
  // 작업자 30명 × 300일 (한 사람이 같은 날 여러 번 겹치지 않게 — 실제 자료 모양)
  if (att)
    for (let i = 0; i < 9000; i++) {
      const day = new Date(now.getTime() - Math.floor(i / 30) * 86_400_000).toISOString().slice(0, 10);
      const mm = () => String(Math.floor(r() * 60)).padStart(2, "0");
      // 한국 시간 09시대 출근 · 17시대 퇴근
      db.attendance!.push({ ...att, id: `att_${Math.floor(r() * 1e12).toString(36)}${i}`, userId: `u-w${i % 30}`, workDate: day, inAt: `${day}T00:${mm()}:00.000Z`, outAt: `${day}T08:${mm()}:00.000Z` });
    }
  const rep = db.reports[0];
  for (let i = 0; i < 3000; i++) db.reports.push({ ...rep, id: `rep_${Math.floor(r() * 1e12).toString(36)}${i}`, workDone: phrase(12), issues: phrase(5), tomorrowPlan: phrase(6) });
  const members = db.users.map((u) => ({ id: u.id, email: `${u.id}@year.test`, name: u.name, title: u.title, role: u.role, siteIds: [], partnerSiteIds: u.partnerSiteIds ?? [], active: true }));
  // 시드 사진은 data: 주소 → 저장된 시스템의 백업처럼 주소로 바꾼다
  const photos = db.photos.map((p) => ({ ...p, dataUrl: `/api/photos/${p.id}` }));
  const json = JSON.stringify({ format: "taekang-site-intelligence-backup", version: 1, exportedAt: now.toISOString(), companyId: "co-year", members, data: { ...db, photos, users: undefined } }, null, 1);
  const gz = gzipSync(Buffer.from(json));
  console.log(`[d86] 1년치(섞인 자료) 원문 ${(json.length / 1e6).toFixed(1)}MB · 압축 ${(gz.length / 1e6).toFixed(2)}MB`);
  // 같은 줄 복사(0.43MB)보다 훨씬 크다 — 한 번에 보내는 한도(3MB) 근처라 조각 올리기를 시험한다
  expect(gz.length).toBeGreaterThan(1_000_000);

  // 조각 올리기 — 1MB씩 (화면은 3MB씩)
  const PART = 1_000_000;
  const parts = Math.ceil(gz.length / PART);
  const uploadId = "perf_upload_0123456789";
  for (let seq = 0; seq < parts; seq++) {
    if (seq === 1) continue; // 하나 빠뜨리면 합치지 않는다
    await storeRestorePart({ uploadId, seq, data: gz.subarray(seq * PART, (seq + 1) * PART).toString("base64") });
  }
  await expect(restoreCompany({ uploadId, parts, email: "u-ceo@year.test", password: "Yearowner2027" }, now)).rejects.toBeInstanceOf(CommandError);
  await storeRestorePart({ uploadId, seq: 1, data: gz.subarray(PART, 2 * PART).toString("base64") });
  // 형식이 틀린 조각 요청
  await expect(storeRestorePart({ uploadId: "x", seq: 0, data: "AA" })).rejects.toBeInstanceOf(CommandError);
  await expect(storeRestorePart({ uploadId, seq: 99, data: "AA" })).rejects.toBeInstanceOf(CommandError);

  const t = performance.now();
  const res = await restoreCompany({ uploadId, parts, email: "u-ceo@year.test", password: "Yearowner2027" }, now);
  const ms = performance.now() - t;
  console.log(`[d86] 1년치 조각 ${parts}개 합쳐 복원 ${Math.round(ms)}ms`);
  expect(ms).toBeLessThan(30_000);
  expect(res.summary.counts.costEntries).toBe(db.costEntries.length);
  const pg = await getDb();
  const [{ n }] = await pg.query<{ n: string }>(`select count(*) as n from records where company_id = 'co-year'`);
  expect(Number(n)).toBeGreaterThan(46_000);
  // 다 쓴 조각은 지워지고, 복원 뒤에는 조각도 받지 않는다
  const [{ c }] = await pg.query<{ c: string }>(`select count(*) as c from restore_uploads`);
  expect(Number(c)).toBe(0);
  await expect(storeRestorePart({ uploadId, seq: 0, data: "AA" })).rejects.toThrow();
});
