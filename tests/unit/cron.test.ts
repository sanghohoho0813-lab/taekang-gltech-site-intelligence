/**
 * 매일 점검 예약 작업 (D-71) — 실제 Postgres 엔진(PGlite)에서 회사 데이터 잠금·저장, 하자보증 만료 알림 발송, 예약 작업 주소의 비밀값 확인.
 * 실제 푸시 서버 대신 테스트용 발송 함수로 받는다.
 */
import { createECDH, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.NEXT_PUBLIC_DATA_MODE = "live";
process.env.DATABASE_URL = await testDatabaseUrl("cron");
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.CRON_SECRET;

const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const push = await import("@/server/push");
const { getDb } = await import("@/server/sql");
const { warrantyEnd } = await import("@/lib/domain/warranty");
const { GET } = await import("@/app/api/cron/daily/route");
const { NextRequest } = await import("next/server");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let ceo: Member;
let manager: Member;
let partner: Member;
const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag: string } }[] = [];

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fakeSub() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${b64u(randomBytes(12))}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(randomBytes(16)) } };
}
async function loginAs(email: string) {
  const r = await auth.login(email, PW);
  if (!r.ok) throw new Error(r.error);
  return (await auth.memberFromToken(r.token))!;
}
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T03:00:00Z`) + days * 86_400_000);

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  push.setPushSender(null);
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

let end = "";
const subs: Record<string, string> = {};
beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@cron.test", password: PW, withDemoData: true });
  ceo = await loginAs("ceo@cron.test");
  manager = await loginAs("manager@demo.local");
  partner = await loginAs("partner@demo.local");
  push.setPushSender(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201 };
  });
  for (const [k, m] of [["ceo", ceo], ["manager", manager], ["partner", partner]] as const) {
    const s = fakeSub();
    await push.saveSubscription(m, s);
    subs[k] = s.endpoint;
  }
  // B현장: 착공일을 준공일로, 6개월 보증
  const { db } = await svc.getView(ceo);
  const b = db.sites.find((s) => s.id === "site-b")!;
  await svc.executeCommand(ceo, "setSiteWarranty", { siteId: "site-b", months: 6, completedDate: b.startDate });
  // 하자보증 알림만 보려고 아침 알림(D-72)은 끈다 — 아침 알림은 아래 따로
  await svc.executeCommand(ceo, "setCompanySettings", { morningBrief: false });
  end = warrantyEnd(b.startDate, 6);
});

describe("매일 점검 — 하자보증 만료 알림", () => {
  it("만료 45일 전: 본사(대표·공무) 휴대폰으로 한 번, 발주처에는 안 감 · 금액 없음 · 저장되고 rev가 오른다", async () => {
    const rev0 = await svc.currentRev(ceo.companyId);
    sent.length = 0;
    const r = await svc.runDailyJobs(shift(end, -45));
    expect(r).toMatchObject({ companies: 1, changed: 1, warrantyNotices: 1, failed: 0 });
    expect(r.pushed).toBe(2);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([subs.ceo, subs.manager].sort());
    expect(sent[0].payload).toMatchObject({ title: "하자보증 만료 45일 전", url: "/sites/site-b?tab=requests", tag: "warranty-site-b" });
    expect(JSON.stringify(sent)).not.toMatch(/원|억/);
    expect(await svc.currentRev(ceo.companyId)).toBeGreaterThan(rev0);
    const { db } = await svc.getView(ceo);
    expect(db.sites.find((s) => s.id === "site-b")!.warranty!.notices!.map((n) => n.days)).toEqual([60]);
    expect(db.activityLogs[0]).toMatchObject({ by: "system", siteId: "site-b" });
    // 발주처 화면에는 알림 기록이 없다
    expect(JSON.stringify((await svc.getView(partner)).db.sites)).not.toContain("notices");
  });

  it("같은 단계는 다시 보내지 않고 저장도 하지 않는다 · 다음 단계(30일)는 보낸다", async () => {
    const rev0 = await svc.currentRev(ceo.companyId);
    sent.length = 0;
    expect(await svc.runDailyJobs(shift(end, -44))).toMatchObject({ changed: 0, warrantyNotices: 0, pushed: 0 });
    expect(sent).toHaveLength(0);
    expect(await svc.currentRev(ceo.companyId)).toBe(rev0);
    expect(await svc.runDailyJobs(shift(end, -30))).toMatchObject({ changed: 1, warrantyNotices: 1, pushed: 2 });
    expect(sent[0].payload.title).toBe("하자보증 만료 30일 전");
  });

  it("알림 키가 없으면 ‘보낸 알림’으로 남기지 않고, 켜진 뒤 첫 점검에 보낸다", async () => {
    push.setPushSender(null);
    expect(await svc.runDailyJobs(shift(end, -7))).toMatchObject({ warrantyNotices: 0, pushed: 0 });
    expect((await svc.getView(ceo)).db.sites.find((s) => s.id === "site-b")!.warranty!.notices!.map((n) => n.days)).toEqual([60, 30]);
    push.setPushSender(async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    });
    sent.length = 0;
    expect(await svc.runDailyJobs(shift(end, -6))).toMatchObject({ warrantyNotices: 1, pushed: 2 });
    expect(sent[0].payload.title).toBe("하자보증 만료 6일 전");
  });
});

describe("매일 점검 — 아침 알림 (D-72)", () => {
  it("본사 요약은 대표·공무에게, 현장 ‘오늘 할 일’은 그 사람에게만 · 같은 날 다시 안 감 · 금액 없음", async () => {
    const field = await loginAs("field@demo.local");
    const fs = fakeSub();
    await push.saveSubscription(field, fs);
    await svc.executeCommand(ceo, "setCompanySettings", { morningBrief: true });
    // 다음 월요일 (일요일은 쉼)
    const d = new Date(Date.now() + 9 * 3_600_000);
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    const monday = d.toISOString().slice(0, 10);
    await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-a", title: "3층 실링 보수", assigneeUserId: field.id, dueDate: monday });
    sent.length = 0;
    const r = await svc.runDailyJobs(new Date(`${monday}T00:30:00Z`));
    expect(r.briefs).toBeGreaterThanOrEqual(3);
    const brief = sent.filter((x) => x.payload.tag.startsWith("brief"));
    expect(brief.filter((x) => x.payload.tag === "brief-hq").map((x) => x.endpoint).sort()).toEqual([subs.ceo, subs.manager].sort());
    expect(brief.filter((x) => x.payload.tag === "brief-field").map((x) => x.endpoint)).toEqual([fs.endpoint]);
    expect(brief.find((x) => x.payload.tag === "brief-field")!.payload).toMatchObject({ url: "/my-actions" });
    expect(JSON.stringify(brief)).not.toMatch(/\d\s*원|억/);
    expect(brief.some((x) => x.endpoint === subs.partner)).toBe(false);
    sent.length = 0;
    expect((await svc.runDailyJobs(new Date(`${monday}T05:00:00Z`))).briefs).toBe(0);
    expect(sent.filter((x) => x.payload.tag.startsWith("brief"))).toHaveLength(0);
  });
});

describe("예약 작업 주소 /api/cron/daily", () => {
  const call = (auth?: string) => GET(new NextRequest("http://localhost/api/cron/daily", { headers: auth ? { authorization: auth } : {} }));
  it("비밀값(CRON_SECRET)이 없거나 짧으면 503 — 아무것도 하지 않는다", async () => {
    expect((await call("Bearer x")).status).toBe(503);
    process.env.CRON_SECRET = "short";
    expect((await call("Bearer short")).status).toBe(503);
  });
  it("비밀값이 다르면 401, 맞으면 숫자만 돌려준다 (회사·현장 이름 없음)", async () => {
    process.env.CRON_SECRET = "cron-secret-for-test-0123456789";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-for-test-012345678")).status).toBe(401);
    expect((await call("cron-secret-for-test-0123456789")).status).toBe(401);
    const ok = await call("Bearer cron-secret-for-test-0123456789");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ ok: true, companies: 1, failed: 0 });
    expect(JSON.stringify(body)).not.toMatch(/태강|B현장|site-/);
    delete process.env.CRON_SECRET;
  });
});
