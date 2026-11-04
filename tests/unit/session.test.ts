/**
 * 로그인 유지 (D-48) — 쓰는 동안 30일씩 연장, 처음 로그인 후 180일 상한, 10분 안에는 다시 쓰지 않음,
 * 모든 기기 로그아웃(알림 해제·권한), 사용자 관리 활동 이력, 쿠키 만료 갱신
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.DATABASE_URL = await testDatabaseUrl("session");

const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const http = await import("@/server/http");
const { getDb } = await import("@/server/sql");
const { ForbiddenError } = await import("@/server/authz");

const PW = "Taekang2026!";
type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
let ceo: Member;
let manager: Member;
let field: Member;
let fieldToken = "";

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});
beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@ses.test", password: PW, withDemoData: true });
  const L = async (e: string) => {
    const r = await auth.login(e, PW);
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  ceo = (await L("ceo@ses.test")).member;
  manager = (await L("manager@demo.local")).member;
  const f = await L("field@demo.local");
  field = f.member;
  fieldToken = f.token;
});

const DAY = 86_400_000;
async function setSession(token: string, sql: string) {
  await (await getDb()).query(`update sessions set ${sql} where token_hash = $1`, [auth.tokenHash(token)]);
}
async function expiresOf(token: string): Promise<number> {
  const [r] = await (await getDb()).query<{ e: string | Date }>(`select expires_at as e from sessions where token_hash = $1`, [auth.tokenHash(token)]);
  return new Date(r.e).getTime();
}

describe("로그인 유지", () => {
  it("쓰는 동안: 남은 기간이 줄었으면 지금부터 30일로 늘리고 새 만료를 알려준다", async () => {
    await setSession(fieldToken, `last_seen_at = now() - interval '11 minutes', expires_at = now() + interval '10 days'`);
    let renewed: Date | null = null;
    expect(await auth.memberFromToken(fieldToken, (d) => (renewed = d))).toMatchObject({ id: field.id });
    expect(renewed).not.toBeNull();
    const e = await expiresOf(fieldToken);
    expect(Math.abs(e - (Date.now() + 30 * DAY))).toBeLessThan(5 * 60_000);
  });

  it("10분 안에 다시 쓰면 DB를 다시 쓰지 않고, 이미 충분히 남았으면 늘리지 않는다", async () => {
    let n = 0;
    await auth.memberFromToken(fieldToken, () => (n += 1)); // 방금 연장됨 → 10분 안
    expect(n).toBe(0);
    await setSession(fieldToken, `last_seen_at = now() - interval '11 minutes', expires_at = now() + interval '29 days 12 hours'`);
    await auth.memberFromToken(fieldToken, () => (n += 1));
    expect(n).toBe(0);
  });

  it("만료 연장은 쿠키를 다시 쓰는 요청에서만, 마지막 사용과 상관없이 (다른 요청이 먼저 와도 연장이 막히지 않게 · D-49)", async () => {
    await setSession(fieldToken, `last_seen_at = now() - interval '11 minutes', expires_at = now() + interval '10 days'`);
    await auth.memberFromToken(fieldToken); // 명령 등 다른 요청: 마지막 사용만
    expect(Math.abs((await expiresOf(fieldToken)) - (Date.now() + 10 * DAY))).toBeLessThan(5 * 60_000);
    let renewed: Date | null = null;
    await auth.memberFromToken(fieldToken, (d) => (renewed = d)); // 마지막 사용이 방금이어도
    expect(renewed).not.toBeNull();
    expect(Math.abs((await expiresOf(fieldToken)) - (Date.now() + 30 * DAY))).toBeLessThan(5 * 60_000);
  });

  it("처음 로그인 후 180일이 상한 — 그 뒤에는 다시 로그인", async () => {
    await setSession(fieldToken, `created_at = now() - interval '175 days', last_seen_at = now() - interval '1 hour', expires_at = now() + interval '2 days'`);
    let renewed: Date | null = null;
    await auth.memberFromToken(fieldToken, (d) => (renewed = d));
    expect(renewed).not.toBeNull();
    expect(Math.abs((await expiresOf(fieldToken)) - (Date.now() + 5 * DAY))).toBeLessThan(5 * 60_000);
    // 상한에 닿으면 더 쓰지 않는다
    let again = 0;
    await auth.memberFromToken(fieldToken, () => (again += 1));
    expect(again).toBe(0);
    await setSession(fieldToken, `expires_at = now() - interval '1 minute'`);
    expect(await auth.memberFromToken(fieldToken)).toBeNull();
  });

  it("쿠키도 새 만료에 맞춰 다시 쓴다 (Max-Age ≈ 30일)", () => {
    const req = new NextRequest("https://t.example/api/state", { headers: { cookie: `${auth.SESSION_COOKIE}=${"x".repeat(43)}` } });
    const res = http.renewCookie(NextResponse.json({}), req, new Date(Date.now() + 30 * DAY));
    const c = res.headers.get("set-cookie") ?? "";
    expect(c).toContain(`${auth.SESSION_COOKIE}=`);
    const age = Number(/Max-Age=(\d+)/i.exec(c)?.[1]);
    expect(Math.abs(age - 30 * 86_400)).toBeLessThan(120);
    expect(c).toMatch(/HttpOnly/i);
    expect(http.renewCookie(NextResponse.json({}), req, null).headers.get("set-cookie")).toBeNull();
  });
});

describe("모든 기기 로그아웃 · 사용자 관리 이력", () => {
  it("관리자가 현장 직원을 모든 기기에서 로그아웃: 세션·휴대폰 알림 삭제, 활동 이력, 목록의 기기 수", async () => {
    const r2 = await auth.login("field@demo.local", PW); // 기기 2대째
    expect(r2.ok).toBe(true);
    const db = await getDb();
    await db.query(`insert into records (company_id, collection, id, site_id, data) values ($1, 'pushSubscriptions', 'sub-x', null, $2::jsonb)`, [field.companyId, JSON.stringify({ id: "sub-x", userId: field.id, endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } })]);
    const before = (await svc.listMembers(manager)).find((x) => x.id === field.id)!;
    expect(before.devices).toBeGreaterThanOrEqual(1);
    expect(before.lastSeenAt).not.toBeNull();
    const out = await svc.signOutMember(manager, field.id);
    expect(out.devices).toBe(before.devices);
    expect((await svc.listMembers(manager)).find((x) => x.id === field.id)!.devices).toBe(0);
    if (r2.ok) expect(await auth.memberFromToken(r2.token)).toBeNull();
    const [p] = await db.query<{ n: number }>(`select count(*)::int as n from records where collection = 'pushSubscriptions' and data->>'userId' = $1`, [field.id]);
    expect(p.n).toBe(0);
    const logs = await svc.listActivity(ceo, { from: "2026-01-01", to: "2030-12-31", type: "member" });
    expect(logs.logs.some((l) => l.by === manager.id && /모든 기기 로그아웃 — .*기기 \d+대/.test(l.summary))).toBe(true);
  });

  it("관리자는 대표를 로그아웃시킬 수 없고, 현장 직원은 아무도 못 한다", async () => {
    await expect(svc.signOutMember(manager, ceo.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.signOutMember(field, manager.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("비밀번호 초기화·비활성화·사용자 추가도 누가 했는지 활동 이력에 남는다", async () => {
    await svc.updateMember(manager, field.id, { password: "Temp12345a" });
    const nm = await svc.createMember(ceo, { email: "new@ses.test", name: "신규 소장", title: "", role: "field", password: "Temp12345b", siteIds: [] });
    await svc.updateMember(ceo, nm.id, { active: false });
    const logs = (await svc.listActivity(ceo, { from: "2026-01-01", to: "2030-12-31", type: "member" })).logs.map((l) => l.summary);
    expect(logs.some((s) => /사용자 변경 — .*비밀번호 초기화/.test(s))).toBe(true);
    expect(logs).toContain("사용자 추가 — 신규 소장 (현장직원)");
    expect(logs.some((s) => s.startsWith("사용자 변경 — 신규 소장: 비활성화"))).toBe(true);
  });
});
