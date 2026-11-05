/**
 * 회사 데이터 메모리 재사용 안전 장치 (D-50, PGlite 또는 TEST_DATABASE_URL의 실제 Postgres)
 * - 같은 rev면 다시 읽지 않고, 다른 서버(또는 사용자 관리)가 바꿔 rev가 오르면 다시 읽는다
 * - 바뀐 것이 있는데 rev를 안 올린 저장은 저장 단계가 올린다
 * - 기억한 데이터는 시험에서 얼려 둔다 (누가 고치면 바로 오류)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.DATABASE_URL = await testDatabaseUrl("cache");

const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const cache = await import("@/server/stateCache");
const { loadState, persistState } = await import("@/server/state");
const { getDb } = await import("@/server/sql");

const PW = "Taekang2026!";
type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
let ceo: Member;
let manager: Member;
let field: Member;
const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});
beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@cache.test", password: PW, withDemoData: true });
  const L = async (e: string) => {
    const r = await auth.login(e, PW);
    if (!r.ok) throw new Error(r.error);
    return r.member;
  };
  ceo = await L("ceo@cache.test");
  manager = await L("manager@demo.local");
  field = await L("field@demo.local");
});
const rev = async () => Number((await (await getDb()).query<{ rev: string | number }>(`select rev from companies where id = $1`, [ceo.companyId]))[0].rev);
const report = (k: string) => ({ idempotencyKey: k, siteId: "site-a", reportDate: "2026-11-04", workDone: `기억 시험 ${k}` });

describe("회사 데이터 메모리 재사용", () => {
  it("명령 뒤 커밋된 상태를 rev와 함께 기억하고, 같은 rev에서만 돌려준다", async () => {
    const out = await svc.executeCommand(field, "submitFieldReport", report("c-1"));
    const r = await rev();
    expect(out.rev).toBe(r);
    const c = cache.cachedState(ceo.companyId, r)!;
    expect(c).not.toBeNull();
    expect(c.reports.some((x) => x.workDone === "기억 시험 c-1")).toBe(true);
    expect(cache.cachedState(ceo.companyId, r - 1)).toBeNull();
    // 시험에서는 얼려 둔다 — 고치려 하면 오류
    expect(() => {
      (c.reports as unknown as unknown[]).push({});
    }).toThrow(TypeError);
  });

  it("다른 서버가 DB를 바꾸고 rev를 올리면 다시 읽어, 그 변경을 되돌리지 않는다", async () => {
    await svc.executeCommand(field, "submitFieldReport", report("c-2"));
    // 다른 서버(인스턴스)의 저장을 흉내: 현장 이름을 바꾸고 rev를 올린다
    const db = await getDb();
    await db.query(`update records set data = jsonb_set(data, '{shortName}', to_jsonb('A현장(다른 서버)'::text)) where company_id = $1 and collection = 'sites' and id = 'site-a'`, [ceo.companyId]);
    await db.query(`update companies set rev = rev + 1 where id = $1`, [ceo.companyId]);
    const out = await svc.executeCommand(manager, "updateProgress", { siteId: "site-a", progressPct: 41 });
    expect(out.db.sites.find((s) => s.id === "site-a")!.shortName).toBe("A현장(다른 서버)");
    const [row] = await db.query<{ n: string }>(`select data->>'shortName' as n from records where company_id = $1 and collection = 'sites' and id = 'site-a'`, [ceo.companyId]);
    expect(row.n).toBe("A현장(다른 서버)");
  });

  it("사용자 관리(명령 밖 변경)도 rev를 올려 다음 명령·화면이 새 이름을 본다", async () => {
    await svc.executeCommand(field, "submitFieldReport", report("c-3"));
    await svc.updateMember(ceo, field.id, { name: "최성민(바뀐 이름)" });
    const v = await svc.getView(manager);
    expect(v.db.users.find((u) => u.id === field.id)!.name).toBe("최성민(바뀐 이름)");
    const out = await svc.executeCommand(field, "submitFieldReport", report("c-4"));
    expect(out.db.users.find((u) => u.id === field.id)!.name).toBe("최성민(바뀐 이름)");
  });

  it("바뀐 것이 있는데 rev를 올리지 않은 저장 → 저장 단계가 올린다", async () => {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const prev = await loadState(tx, ceo.companyId);
      const next = structuredClone(prev);
      next.sites = next.sites.map((s) => (s.id === "site-b" ? { ...s, shortName: "B현장(rev 안 올림)" } : s));
      expect(next.rev).toBe(prev.rev);
      await persistState(tx, ceo.companyId, prev, next);
      expect(next.rev).toBe(prev.rev + 1);
    });
    const r = await rev();
    const v = await svc.getView(ceo);
    expect(v.rev).toBe(r);
    expect(v.db.sites.find((s) => s.id === "site-b")!.shortName).toBe("B현장(rev 안 올림)");
  });

  it("기억 시간이 지나면(또는 끄면) 쓰지 않는다", async () => {
    await svc.executeCommand(field, "submitFieldReport", report("c-5"));
    const r = await rev();
    expect(cache.cachedState(ceo.companyId, r)).not.toBeNull();
    process.env.STATE_CACHE_TTL_MS = "0";
    await new Promise((res) => setTimeout(res, 5));
    expect(cache.cachedState(ceo.companyId, r)).toBeNull();
    delete process.env.STATE_CACHE_TTL_MS;
    process.env.STATE_CACHE = "off";
    expect(cache.cachedState(ceo.companyId, r)).toBeNull();
    delete process.env.STATE_CACHE;
  });
});
