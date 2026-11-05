/**
 * 아침 출근 몰림 부하 측정 (D-50) — 기본 테스트에는 포함하지 않는다. 실행: npm run perf
 * 1년치 데이터(현장 6·직원 20·300일)가 쌓인 회사에서
 *   ① 현장 직원 20명이 같은 순간 출근 (서로 다른 로그인)
 *   ② 퇴근 무렵: 보고 6건 + 본사 화면 새로고침 10번 동시
 * 회사 데이터는 일관성을 위해 명령을 한 건씩(회사 잠금) 처리하므로, 몰리면 뒤 사람이 기다린다 — 그 시간을 잰다.
 * 실제 Postgres·풀러로: TEST_DATABASE_URL=postgres://…(PgBouncer 트랜잭션 모드 등) npm run perf
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "../unit/testDb";

process.env.DATABASE_URL = await testDatabaseUrl("peak");

const { getDb } = await import("@/server/sql");
const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const { seedYear } = await import("./yearData");
const { currentTerms } = await import("@/lib/domain/privacy");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
const DAYS = Number(process.env.PERF_DAYS ?? 300);
const PEOPLE = Number(process.env.PEAK_PEOPLE ?? 20);
let ceo: Member;
let manager: Member;
const crew: Member[] = [];
const RESULTS: Record<string, string | number> = {};
const DB_URL = process.env.DATABASE_URL!;
const SITE_GEO: Record<string, { lat: number; lng: number }> = { "site-a": { lat: 37.2636, lng: 127.0286 }, "site-b": { lat: 37.5642, lng: 126.9751 }, "site-c": { lat: 36.3504, lng: 127.3845 } };

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

async function burst<T>(label: string, jobs: (() => Promise<T>)[]): Promise<{ ok: number; errors: string[]; lat: number[] }> {
  const t0 = performance.now();
  const lat: number[] = [];
  const errors: string[] = [];
  let ok = 0;
  await Promise.all(
    jobs.map(async (j) => {
      const s = performance.now();
      try {
        await j();
        ok += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      } finally {
        lat.push(performance.now() - s);
      }
    }),
  );
  RESULTS[`${label} 전체(ms)`] = Math.round(performance.now() - t0);
  RESULTS[`${label} 중간값(ms)`] = pct(lat, 50);
  RESULTS[`${label} 95%(ms)`] = pct(lat, 95);
  RESULTS[`${label} 가장 늦음(ms)`] = Math.round(Math.max(...lat));
  RESULTS[`${label} 오류`] = errors.length;
  return { ok, errors, lat };
}

afterAll(async () => {
  console.table(RESULTS);
  console.log("PEAK_RESULTS " + JSON.stringify(RESULTS));
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@peak.test", password: PW, withDemoData: true });
  const L = async (email: string) => {
    const r = await auth.login(email, PW);
    if (!r.ok) throw new Error(r.error);
    return r.member;
  };
  ceo = await L("ceo@peak.test");
  manager = await L("manager@demo.local");
  RESULTS["쌓인 기록"] = await seedYear(ceo.companyId, DAYS);
  const sites = ["site-a", "site-b", "site-c"];
  for (let i = 0; i < PEOPLE; i++) {
    const m = await svc.createMember(ceo, { email: `crew${i}@peak.test`, name: `현장${i + 1}`, title: "", role: "field", password: PW, siteIds: [sites[i % 3]] });
    void m;
    crew.push(await L(`crew${i}@peak.test`));
  }
}, 600_000);

describe("아침 출근 몰림", () => {
  it(`현장 직원 ${PEOPLE}명이 같은 순간 출근`, async () => {
    const terms = currentTerms((await svc.getView(ceo)).db);
    const r = await burst(
      "① 동시 출근",
      crew.map((m) => () => {
        const g = SITE_GEO[m.siteIds[0]];
        return svc.executeCommand(m, "checkIn", { siteId: m.siteIds[0], sample: { lat: g.lat + 0.0002, lng: g.lng + 0.0001, accuracy: 15 }, consent: true, consentTerms: terms, deviceId: `dev-peak-${m.id.slice(-6)}` });
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(PEOPLE);
  }, 600_000);

  it("퇴근 무렵: 보고 6건 + 본사 화면 새로고침 10번 동시", async () => {
    const reports = crew.slice(0, 6).map((m, i) => () => svc.executeCommand(m, "submitFieldReport", { idempotencyKey: `peak-rep-${i}`, siteId: m.siteIds[0], reportDate: new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10), workDone: "부하 측정 보고" }));
    const views = Array.from({ length: 10 }, (_, i) => () => svc.getView(i % 2 ? ceo : manager));
    const r = await burst("② 보고+본사 화면", [...reports, ...views]);
    expect(r.errors).toEqual([]);
    // 화면 새로고침(읽기)은 회사 잠금을 기다리지 않는다
    const single = performance.now();
    await svc.getView(manager);
    RESULTS["본사 화면 1번(ms)"] = Math.round(performance.now() - single);
  }, 600_000);
});
