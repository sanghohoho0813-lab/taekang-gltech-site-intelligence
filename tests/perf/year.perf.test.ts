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
const { seedYear, dayFn } = await import("./yearData");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let ceo: Member;
let field: Member;
let companyId = "";
const RESULTS: Record<string, string | number> = {};

// 오늘로 끝나는 300일 (PERF_DAYS=900 이면 3년치)
const DAYS = Number(process.env.PERF_DAYS ?? 300);
const day = dayFn(DAYS);

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

  RESULTS.records = await seedYear(companyId, DAYS);
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
