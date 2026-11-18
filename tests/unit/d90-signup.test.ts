/**
 * D-90 회원가입 신청 · 승인 — 실제 Postgres(PGlite)에서
 * 신청 → 승인 대기(로그인 막힘, 비밀번호가 맞을 때만 이유) → 승인 담당만 승인·승인 안 함·지우기 → 일시 정지·다시 사용
 * 승인 담당은 대표 권한 또는 ‘가입 승인 담당’으로 지정된 본사관리자 (지정은 대표 권한만)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.DATABASE_URL = await testDatabaseUrl("d90signup");

const { getDb } = await import("@/server/sql");
const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const { loadState } = await import("@/server/state");
const { ForbiddenError } = await import("@/server/authz");
const { CommandError } = await import("@/lib/data/commands");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let dev: Member;
let manager: Member;

async function loginAs(email: string, pw = PW): Promise<Member> {
  const r = await auth.login(email, pw);
  if (!r.ok) throw new Error(r.error);
  const m = await auth.memberFromToken(r.token);
  if (!m) throw new Error("session");
  return m;
}
const form = (email: string, extra: Record<string, unknown> = {}) => ({ name: "이다솜", email, password: "Dasom2026a", phone: "010-1234-5678", title: "실장", kind: "manager", note: "본사", agree: true, ...extra });
const DB_URL = process.env.DATABASE_URL!;

beforeAll(async () => {
  // 개발 담당이 먼저 최초 설정 (직함 ‘개발자’ · 대표 권한)
  const r = await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "김상호", title: "개발자", email: "dev@taekang.test", password: PW });
  expect(r.member.role).toBe("ceo");
  dev = await loginAs("dev@taekang.test");
  // 승인 담당이 아닌 일반 본사관리자 — 대표 권한이 바로 추가
  await svc.createMember(dev, { name: "박공무", email: "manager@taekang.test", role: "manager", password: PW });
  manager = await loginAs("manager@taekang.test");
});
afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

describe("D-90 최초 설정 직함", () => {
  it("최초 설정 계정의 직함을 정할 수 있다 (기본 ‘대표’) · 대표 권한이라 가입 승인 가능", () => {
    expect(dev.title).toBe("개발자");
    expect(auth.canApprove(dev)).toBe(true);
    expect(auth.canApprove(manager)).toBe(false);
  });
});

describe("D-90 회원가입 신청", () => {
  it("신청하면 승인 대기 — 로그인 막힘 · 비밀번호가 맞을 때만 ‘승인 대기’라고 알려 줌 · 화면 데이터·백업에 없음", async () => {
    await svc.signUp(form("dasom@taekang.test"));
    const wrong = await auth.login("dasom@taekang.test", "Wrong2026x");
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.error).toMatch(/비밀번호가 맞지/);
    const right = await auth.login("dasom@taekang.test", "Dasom2026a");
    expect(right.ok).toBe(false);
    expect(!right.ok && right.blocked).toBe("pending");
    expect(!right.ok && right.error).toMatch(/승인하면 로그인/);
    const db = await (await getDb()).transaction((tx) => loadState(tx, dev.companyId));
    expect(db.users.some((u) => u.name === "이다솜")).toBe(false);
    const backup = JSON.parse((await svc.exportCompany(dev)).body);
    expect(backup.members.some((m: { email: string }) => m.email === "dasom@taekang.test")).toBe(false);
    // 승인 담당의 화면 데이터에는 승인 대기 수, 일반 본사관리자는 0 · 숫자 없음
    expect((await svc.getView(dev)).db.signup).toEqual({ pending: 1, canApprove: true });
    expect((await svc.getView(manager)).db.signup).toEqual({ pending: 0, canApprove: false });
    // 목록: 승인 담당에게만 휴대폰 번호
    const forDev = (await svc.listMembers(dev)).find((m) => m.email === "dasom@taekang.test")!;
    expect(forDev.signupStatus).toBe("pending");
    expect(forDev.signup?.phone).toBe("010-1234-5678");
    expect((await svc.listMembers(manager)).find((m) => m.email === "dasom@taekang.test")!.signup?.phone).toBe("");
  });

  it("입력 검사 — 동의·휴대폰·구분·비밀번호 규칙 · 같은 이메일 두 번 · 이미 있는 계정", async () => {
    await expect(svc.signUp(form("x1@taekang.test", { agree: false }))).rejects.toThrow(/동의/);
    await expect(svc.signUp(form("x1@taekang.test", { phone: "12" }))).rejects.toThrow(/휴대폰/);
    await expect(svc.signUp(form("x1@taekang.test", { kind: "ceo" }))).rejects.toThrow(/골라/);
    await expect(svc.signUp(form("x1@taekang.test", { password: "short" }))).rejects.toThrow(/8자/);
    await expect(svc.signUp(form("dasom@taekang.test"))).rejects.toThrow(/이미 가입 신청/);
    await expect(svc.signUp(form("manager@taekang.test"))).rejects.toThrow(/이미 가입된/);
  });

  it("승인 대기 신청은 수정·켜기로 우회할 수 없다 — 승인으로만", async () => {
    const p = (await svc.listMembers(dev)).find((m) => m.email === "dasom@taekang.test")!;
    await expect(svc.updateMember(dev, p.id, { active: true })).rejects.toThrow(/승인/);
    await expect(svc.updateMember(dev, p.id, { role: "manager" })).rejects.toThrow(/승인/);
  });

  it("승인 담당이 아닌 본사관리자는 승인·승인 안 함·계정 추가·일시 정지를 못 한다", async () => {
    const p = (await svc.listMembers(dev)).find((m) => m.email === "dasom@taekang.test")!;
    await expect(svc.decideSignup(manager, p.id, { action: "approve", role: "field" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.decideSignup(manager, p.id, { action: "reject" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.createMember(manager, { name: "몰래", email: "sneak@taekang.test", role: "field", password: PW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.updateMember(manager, dev.id, { active: false })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("대표 권한이 승인(본사관리자 + 가입 승인 담당) → 바로 로그인 · 그 사람도 이제 승인할 수 있다", async () => {
    const p = (await svc.listMembers(dev)).find((m) => m.email === "dasom@taekang.test")!;
    const v = await svc.decideSignup(dev, p.id, { action: "approve", role: "manager", title: "실장", approver: true });
    expect("deleted" in v).toBe(false);
    const dasom = await loginAs("dasom@taekang.test", "Dasom2026a");
    expect(dasom.role).toBe("manager");
    expect(dasom.mustChangePassword).toBe(false);
    expect(auth.canApprove(dasom)).toBe(true);
    // 다른 신청을 실장이 승인 · 현장 직원으로 · 담당 현장
    await svc.signUp(form("worker@taekang.test", { name: "최현장", kind: "field", title: "반장" }));
    const w = (await svc.listMembers(dasom)).find((m) => m.email === "worker@taekang.test")!;
    await svc.decideSignup(dasom, w.id, { action: "approve", role: "field", title: "반장", siteIds: [] });
    const worker = await loginAs("worker@taekang.test", "Dasom2026a");
    expect(worker.role).toBe("field");
    // 승인된 사람은 화면 데이터에 나온다 · 활동 이력에 누가 승인했는지
    const db = await (await getDb()).transaction((tx) => loadState(tx, dev.companyId));
    expect(db.users.map((u) => u.name)).toEqual(expect.arrayContaining(["이다솜", "최현장"]));
    expect(db.activityLogs.some((l) => l.summary.startsWith("가입 승인 — 최현장") && l.by === dasom.id)).toBe(true);
  });

  it("가입 승인 담당 지정은 대표 권한만 · 본사관리자에게만", async () => {
    const dasom = await loginAs("dasom@taekang.test", "Dasom2026a");
    await expect(svc.updateMember(dasom, manager.id, { approver: true })).rejects.toBeInstanceOf(ForbiddenError);
    const worker = (await svc.listMembers(dev)).find((m) => m.email === "worker@taekang.test")!;
    await expect(svc.updateMember(dev, worker.id, { approver: true })).rejects.toThrow(/본사관리자/);
    // 대표 권한이 지정하면 그 사람도 승인 가능 · 역할을 현장으로 바꾸면 담당도 풀린다
    await svc.updateMember(dev, manager.id, { approver: true });
    expect(auth.canApprove(await loginAs("manager@taekang.test"))).toBe(true);
    await svc.updateMember(dev, manager.id, { role: "field" });
    expect((await svc.listMembers(dev)).find((m) => m.id === manager.id)!.approver).toBe(false);
    await svc.updateMember(dev, manager.id, { role: "manager" });
  });

  it("승인 안 함 → 로그인 막힘(이유 안내) · 다시 승인 가능 · 지우기 · 실수로 누른 신청", async () => {
    await svc.signUp(form("oops@taekang.test", { name: "실수", kind: "other" }));
    const o = (await svc.listMembers(dev)).find((m) => m.email === "oops@taekang.test")!;
    await svc.decideSignup(dev, o.id, { action: "reject", reason: "회사 사람이 아님" });
    const r = await auth.login("oops@taekang.test", "Dasom2026a");
    expect(!r.ok && r.blocked).toBe("rejected");
    expect((await svc.listMembers(dev)).find((m) => m.id === o.id)!.signup?.reason).toBe("회사 사람이 아님");
    await expect(svc.signUp(form("oops@taekang.test"))).rejects.toThrow(/승인되지 않았습니다/);
    await expect(svc.decideSignup(dev, o.id, { action: "reject" })).rejects.toThrow(/이미/);
    // 지우면 같은 이메일로 다시 신청할 수 있다
    await svc.decideSignup(dev, o.id, { action: "delete" });
    expect((await svc.listMembers(dev)).some((m) => m.id === o.id)).toBe(false);
    await svc.signUp(form("oops@taekang.test", { name: "실수2" }));
  });

  it("일시 정지 → 즉시 로그인 끊김 · 로그인하면 ‘일시 정지’ 안내 · 다시 사용", async () => {
    const worker = await loginAs("worker@taekang.test", "Dasom2026a");
    const r0 = await auth.login("worker@taekang.test", "Dasom2026a");
    if (!r0.ok) throw new Error("login");
    const dasom = await loginAs("dasom@taekang.test", "Dasom2026a");
    await svc.updateMember(dasom, worker.id, { active: false });
    expect(await auth.memberFromToken(r0.token)).toBeNull();
    const r1 = await auth.login("worker@taekang.test", "Dasom2026a");
    expect(!r1.ok && r1.blocked).toBe("suspended");
    expect(!r1.ok && r1.error).toMatch(/일시 정지/);
    await svc.updateMember(dasom, worker.id, { active: true });
    expect((await auth.login("worker@taekang.test", "Dasom2026a")).ok).toBe(true);
  });

  it("승인 대기는 30건까지만 쌓인다 · 오래된 신청은 매일 점검이 지운다(승인 안 함 30일 · 처리 안 됨 60일)", async () => {
    const pending = (await svc.listMembers(dev)).filter((m) => m.signupStatus === "pending").length;
    for (let i = pending; i < svc.SIGNUP_PENDING_MAX; i++) await svc.signUp(form(`bulk${i}@taekang.test`, { name: `대량${i}` }));
    await expect(svc.signUp(form("one-more@taekang.test"))).rejects.toThrow(/밀려/);
    const later = new Date(Date.now() + 61 * 86_400_000);
    const removed = await svc.purgeSignups(later);
    expect(removed).toBeGreaterThanOrEqual(svc.SIGNUP_PENDING_MAX);
    expect((await svc.listMembers(dev)).filter((m) => m.signupStatus === "pending")).toEqual([]);
    // 승인된 사람은 그대로
    expect((await svc.listMembers(dev)).some((m) => m.email === "dasom@taekang.test")).toBe(true);
  });

  it("오류 종류: 입력 오류는 CommandError(칸 표시) · 권한은 ForbiddenError", async () => {
    await expect(svc.signUp(form("bad", { name: "" }))).rejects.toBeInstanceOf(CommandError);
  });
});
