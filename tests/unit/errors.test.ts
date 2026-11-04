/**
 * 앱 오류 기록 서버 (D-47, PGlite 또는 TEST_DATABASE_URL의 실제 Postgres) —
 * 1시간 단위 묶음, 서버에서 다시 개인정보 지움, 보관 상한, 본사만 조회, 명령 안 예상 못 한 오류 기록, 화면 데이터·백업 제외
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.DATABASE_URL = await testDatabaseUrl("errors");
process.env.ERROR_LOG_MAX = "12";

const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const errors = await import("@/server/errors");
const { getDb } = await import("@/server/sql");
const { ForbiddenError } = await import("@/server/authz");

const PW = "Taekang2026!";
type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
let ceo: Member;
let field: Member;
let manager: Member;
const loginAs = async (email: string) => {
  const r = await auth.login(email, PW);
  if (!r.ok) throw new Error(r.error);
  return (await auth.memberFromToken(r.token))!;
};

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});
beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@err.test", password: PW, withDemoData: true });
  ceo = await loginAs("ceo@err.test");
  field = await loginAs("field@demo.local");
  manager = await loginAs("manager@demo.local");
});

describe("앱 오류 기록 서버", () => {
  it("같은 사람·화면·내용은 묶어 횟수만 늘리고, 서버에서 다시 개인정보를 지운다", async () => {
    for (let i = 0; i < 3; i++) await errors.recordError(field, { source: "client", route: "/field/report?x=park@taekang.test", message: "TypeError: 010-9876-5432 park@taekang.test 실패", stack: "at a (https://t/x.js?token=abc:1:2)", ua: "Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36" });
    const { errors: list } = await errors.listErrors(ceo);
    const e = list.find((x) => x.route === "/field/report")!;
    expect(e).toMatchObject({ count: 3, source: "client", userId: field.id, role: "field", browser: "삼성 인터넷 25" });
    expect(JSON.stringify(e)).not.toMatch(/park@|9876|token=abc/);
    expect(e.message).toContain("[이메일]");
  });

  it("보관 상한: 가장 오래된 것부터 지운다", async () => {
    for (let i = 0; i < 20; i++) await errors.recordError(field, { source: "client", route: "/field", message: `오류 종류 ${String.fromCharCode(65 + i)}` });
    const db = await getDb();
    const [n] = await db.query<{ n: number }>(`select count(*)::int as n from records where collection = 'errorLogs'`);
    expect(n.n).toBe(12);
    const { errors: list } = await errors.listErrors(manager);
    expect(list.map((x) => x.message)).toContain("오류 종류 T");
    expect(list.map((x) => x.message)).not.toContain("오류 종류 A");
  });

  it("조회는 대표·관리자만", async () => {
    await expect(errors.listErrors(field)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("명령 안에서 예상 못 한 오류 → 사용자에게는 형식 오류, 오류 기록에는 서버 오류로", async () => {
    // 일부러 잘못된 모양의 인자 (화면은 이렇게 보내지 않음 — 명령 함수 안에서 TypeError)
    await expect(svc.executeCommand(manager, "completeAction", {})).rejects.toMatchObject({ message: "요청 형식이 올바르지 않습니다." });
    const { errors: list } = await errors.listErrors(ceo);
    expect(list.find((x) => x.source === "server")).toMatchObject({ route: "명령 completeAction", userId: manager.id, message: expect.stringContaining("idempotencyKey") });
    // 평범한 입력 오류(CommandError)는 오류 기록에 남지 않는다
    const before = (await errors.listErrors(ceo)).errors.filter((x) => x.source === "server").length;
    await expect(svc.executeCommand(manager, "setThresholds", { targetMarginPct: -5 })).rejects.toBeTruthy();
    expect((await errors.listErrors(ceo)).errors.filter((x) => x.source === "server").length).toBe(before);
  });

  it("오류 기록은 화면 데이터·전체 백업에 들어가지 않는다", async () => {
    const v = await svc.getView(ceo);
    expect(JSON.stringify(v.db)).not.toContain("오류 종류");
    const out = await svc.exportCompany(ceo);
    expect(out.body).not.toContain("오류 종류");
  });
});
