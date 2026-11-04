/**
 * 1년치 데이터 성능 측정 (D-34) — 기본 테스트에는 포함하지 않는다. 실행: npm run perf
 * 규모(중견 창호·유리 시공사 가정): 현장 6곳 · 현장 직원 20명 · 300 작업일
 *   출퇴근 6,000 · 현장 보고 1,800 · 사진 3,600 · 작업 인원 5,400 · 원가 3,000 · 작업지시 1,000 · 활동 이력 15,000
 */
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite:memory";

const { getDb } = await import("@/server/sql");
const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const { loadState } = await import("@/server/state");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let ceo: Member;
let field: Member;
let companyId = "";
const RESULTS: Record<string, string | number> = {};

// 오늘로 끝나는 300일 (PERF_DAYS=900 이면 3년치)
const DAYS = Number(process.env.PERF_DAYS ?? 300);
const TODAY_MS = Date.parse(new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10));
const day = (i: number) => new Date(TODAY_MS - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
const SITES = ["site-a", "site-b", "site-c", "site-y1", "site-y2", "site-y3"];

async function bulk(collection: string, items: Record<string, unknown>[]) {
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

async function time<T>(label: string, fn: () => Promise<T>, runs = 3): Promise<T> {
  const ts: number[] = [];
  let out!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = await fn();
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  RESULTS[label] = Math.round(ts[Math.floor(ts.length / 2)]);
  return out;
}

beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@perf.test", password: PW, withDemoData: true });
  const r = await auth.login("ceo@perf.test", PW);
  if (!r.ok) throw new Error(r.error);
  ceo = (await auth.memberFromToken(r.token))!;
  companyId = ceo.companyId;
  const f = await auth.login("field@demo.local", PW);
  if (!f.ok) throw new Error(f.error);
  field = (await auth.memberFromToken(f.token))!;

  const users = Array.from({ length: 20 }, (_, i) => (i === 0 ? "u-field" : `u-f${i}`));
  const att: Record<string, unknown>[] = [];
  const reports: Record<string, unknown>[] = [];
  const photos: Record<string, unknown>[] = [];
  const crew: Record<string, unknown>[] = [];
  const costs: Record<string, unknown>[] = [];
  const orders: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const geo = { status: "inside", lat: 37.5, lng: 127.03, accuracyM: 12, distanceM: 40 };
  for (let d = 0; d < DAYS; d++) {
    const date = day(d);
    users.forEach((u, i) => att.push({ id: `att-${d}-${i}`, siteId: SITES[i % 6], userId: u, workDate: date, inAt: `${date}T07:3${i % 10}:00+09:00`, inGeo: geo, inDevice: `dev-${i}`, outAt: `${date}T17:2${i % 10}:00+09:00`, outGeo: geo, outDevice: `dev-${i}` }));
    SITES.forEach((s, si) => {
      const rid = `rep-${d}-${si}`;
      reports.push({ id: rid, siteId: s, reportDate: date, workDone: `${si + 3}층 커튼월 유닛 ${d % 12}개 설치, 실링 사전 점검 및 앵커 토크 검사`, issues: d % 5 ? "" : "크레인 대기 40분", tomorrowPlan: "다음 층 앵커 설치", photoIds: [`ph-${d}-${si}-0`, `ph-${d}-${si}-1`], costEntryIds: [], createdBy: users[si], createdAt: `${date}T17:00:00+09:00`, status: "submitted", geo, review: { status: "confirmed", at: `${date}T18:30:00+09:00`, by: "u-manager" } });
      for (let p = 0; p < 2; p++) photos.push({ id: `ph-${d}-${si}-${p}`, siteId: s, reportId: rid, dataUrl: `/api/photos/ph-${d}-${si}-${p}`, caption: "현장 사진", createdAt: `${date}T16:50:00+09:00`, createdBy: users[si] });
      for (let t = 0; t < 3; t++) crew.push({ id: `crew-${d}-${si}-${t}`, siteId: s, workDate: date, team: ["유리 설치팀", "실링팀", "철골팀"][t], kind: t ? "direct" : "subcontract", headcount: 3 + t, photoId: `ph-${d}-${si}-0`, photoHash: `h${d}${si}${t}`.padEnd(64, "0"), geo, at: `${date}T09:00:00+09:00`, by: users[si] });
      if (d % 2 === 0) costs.push({ id: `ce-${d}-${si}`, siteId: s, category: ["material", "labor", "subcontract", "equipment", "overhead"][d % 5], amount: 1_000_000 + d * 1000, date, forecastImpact: "within_forecast", reason: "planned", note: "자재 반입", source: "FIELD", createdBy: users[si], createdAt: `${date}T17:00:00+09:00`, status: "active" });
    });
    for (let k = 0; k < 3; k++) {
      const s = SITES[(d + k) % 6];
      if (orders.length < DAYS * 3.4) orders.push({ id: `wo-${d}-${k}`, siteId: s, title: "2층 실링 보수", detail: "누수 부위 확인", assigneeUserId: users[k], status: "confirmed", createdAt: `${date}T08:00:00+09:00`, createdBy: "u-manager", doneNote: "보수 완료", doneQty: "6m", history: [{ at: `${date}T08:00:00+09:00`, by: "u-manager", to: "sent" }, { at: `${date}T08:30:00+09:00`, by: users[k], to: "received" }, { at: `${date}T15:00:00+09:00`, by: users[k], to: "done" }, { at: `${date}T18:00:00+09:00`, by: "u-manager", to: "confirmed" }] });
    }
    for (let k = 0; k < 50; k++) logs.push({ id: `log-${d}-${k}`, at: `${date}T${String(7 + (k % 12)).padStart(2, "0")}:00:${String(k).padStart(2, "0")}+09:00`, by: users[k % 20], type: ["attendance", "report", "crew", "order"][k % 4], siteId: SITES[k % 6], summary: `현장 기록 ${k}` });
  }
  await bulk("attendance", att);
  await bulk("reports", reports);
  await bulk("photos", photos);
  await bulk("crewChecks", crew);
  await bulk("costEntries", costs);
  await bulk("workOrders", orders);
  await bulk("activityLogs", logs);
  RESULTS.records = att.length + reports.length + photos.length + crew.length + costs.length + orders.length + logs.length;
}, 300_000);

describe("1년치 데이터 성능", () => {
  it("측정", async () => {
    const db = await getDb();
    const state = await time("loadState(ms)", () => db.transaction((tx) => loadState(tx, companyId)));
    RESULTS["loaded records"] = Object.values(state).filter(Array.isArray).reduce((a, v) => a + (v as unknown[]).length, 0);
    RESULTS["state JSON (MB)"] = Math.round((JSON.stringify(state).length / 1_048_576) * 10) / 10;
    const ceoView = await time("getView 대표(ms)", () => svc.getView(ceo));
    RESULTS["대표 화면 데이터 (MB)"] = Math.round((JSON.stringify(ceoView).length / 1_048_576) * 10) / 10;
    const fieldView = await time("getView 현장(ms)", () => svc.getView(field));
    RESULTS["현장 화면 데이터 (MB)"] = Math.round((JSON.stringify(fieldView).length / 1_048_576) * 100) / 100;
    const { gzipSync } = await import("node:zlib");
    RESULTS["대표 화면 데이터 압축 (MB)"] = Math.round((gzipSync(JSON.stringify(ceoView)).length / 1_048_576) * 100) / 100;
    RESULTS["현장 화면 데이터 압축 (KB)"] = Math.round(gzipSync(JSON.stringify(fieldView)).length / 1024);
    // 현장 휴대폰: 최근 60일 + 끝나지 않은 것만
    expect(fieldView.db.attendance!.every((r) => r.workDate >= day(DAYS - 61))).toBe(true);
    expect(fieldView.db.reports.length).toBeLessThan(400);
    let k = 0;
    await time("명령: 현장 보고(ms)", () => svc.executeCommand(field, "submitFieldReport", { idempotencyKey: `perf-${k++}`, siteId: "site-a", reportDate: day(DAYS - 1), workDone: "성능 측정 보고" }));
    await time("명령: 설정 변경(ms)", () => svc.executeCommand(ceo, "setCompanySettings", { laborDayRate: 300_000 + k++ }));
    console.table(RESULTS);
    // 목표: 1년치에서 명령 1건 1.5초 이내 (로컬 측정 기준). 3년치(PERF_DAYS=900)는 측정만 — 보관 정리 시점 판단용
    if (DAYS <= 365) expect(Number(RESULTS["명령: 현장 보고(ms)"])).toBeLessThan(1500);
    // 앱 안 ‘데이터 규모’ 경고 기준과 맞는지 (1년치는 여유)
    const { companyReadiness, DATA_VOLUME_WARN } = await import("@/lib/domain/readiness");
    const vol = companyReadiness(ceoView.db).find((i) => i.key === "data-volume")!;
    RESULTS["데이터 규모 표시"] = vol.status;
    if (DAYS <= 365) expect(vol.status).toBe("ok");
    else expect(DATA_VOLUME_WARN).toBeGreaterThan(0);
  }, 300_000);
});
