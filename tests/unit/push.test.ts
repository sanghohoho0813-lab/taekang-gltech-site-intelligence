/**
 * 휴대폰 알림 서버 (실제 Postgres 엔진 PGlite) — 구독 검증·저장, 명령 → 알림 발송, 만료 구독 정리, 퇴사자 정리
 * 실제 푸시 서버 대신 테스트용 발송 함수로 받는다.
 */
import { createECDH, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropTestDatabase, testDatabaseUrl } from "./testDb";

// 기본은 PGlite 메모리 DB. 실제 Postgres로: TEST_DATABASE_URL=postgres://… → 이 파일 전용 빈 임시 DB를 만들고 끝나면 지운다
process.env.DATABASE_URL = await testDatabaseUrl("push");
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const push = await import("@/server/push");
const { getDb } = await import("@/server/sql");
const { CommandError } = await import("@/lib/data/commands");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let ceo: Member;
let manager: Member;
let field: Member;
const sent: { endpoint: string; payload: { title: string; body: string; url: string } }[] = [];
let status = 201;

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fakeSub(host = "fcm.googleapis.com") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://${host}/fcm/send/${b64u(randomBytes(12))}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(randomBytes(16)) } };
}
async function loginAs(email: string) {
  const r = await auth.login(email, PW);
  if (!r.ok) throw new Error(r.error);
  return (await auth.memberFromToken(r.token))!;
}

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@push.test", password: PW, withDemoData: true });
  ceo = await loginAs("ceo@push.test");
  manager = await loginAs("manager@demo.local");
  field = await loginAs("field@demo.local");
});

describe("휴대폰 알림 — 서버", () => {
  it("알림 설정(VAPID)이 없으면 등록을 거부하고, 명령은 그대로 동작한다", async () => {
    await expect(push.saveSubscription(field, fakeSub())).rejects.toBeInstanceOf(CommandError);
    const out = await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-a", title: "설정 전 지시", detail: "", assigneeUserId: field.id });
    expect(out.rev).toBeGreaterThan(0);
  });

  it("공식 푸시 서버 주소·올바른 키만 등록 (임의 주소로 서버가 요청하게 만드는 공격 차단)", async () => {
    push.setPushSender(async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return { statusCode: status };
    });
    for (const bad of [fakeSub("evil.example.com"), { ...fakeSub(), endpoint: "http://fcm.googleapis.com/x" }, { ...fakeSub(), keys: { p256dh: "abc", auth: "def" } }, null, { endpoint: "https://169.254.169.254/latest" }])
      expect(() => push.validateSubscription(bad)).toThrow(CommandError);
    for (const host of ["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com", "wns2-par02p.notify.windows.com"]) expect(() => push.validateSubscription(fakeSub(host))).not.toThrow();
  });

  it("본사 작업지시 → 현장소장 휴대폰으로 발송 (내용에 금액 없음), 보낸 사람에게는 안 감", async () => {
    const fs = fakeSub();
    expect((await push.saveSubscription(field, fs, "test-ua")).count).toBe(1);
    const ms = fakeSub();
    await push.saveSubscription(manager, ms);
    sent.length = 0;
    await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-a", title: "3층 남측 실링 보수", detail: "누수", assigneeUserId: field.id, urgent: true });
    expect(sent.map((s) => s.endpoint)).toEqual([fs.endpoint]);
    expect(sent[0].payload).toMatchObject({ title: "긴급 본사 작업지시", url: "/my-actions" });
    expect(sent[0].payload.body).toContain("3층 남측 실링 보수");
    // 현장 문제 보고 → 본사(관리자)에게
    sent.length = 0;
    await svc.executeCommand(field, "submitFieldReport", { idempotencyKey: "push-r1", siteId: "site-a", reportDate: "2026-11-04", workDone: "설치", issues: "크레인 고장", costs: [{ category: "material", amount: 3_000_000, forecastImpact: "additional" }], reason: "design_change" });
    expect(sent.map((s) => s.endpoint)).toEqual([ms.endpoint]);
    expect(JSON.stringify(sent)).not.toMatch(/300만|3,000,000|3000000/);
  });

  it("만료된 구독(410)은 지우고, 발송 실패해도 명령은 성공", async () => {
    status = 410;
    sent.length = 0;
    const out = await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-a", title: "만료 확인", detail: "", assigneeUserId: field.id });
    expect(out.rev).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);
    expect(await push.countFor(field)).toBe(0);
    status = 201;
  });

  it("한 사람당 최근 5대까지, 끄기는 본인 것만, 퇴사(비활성화)하면 모두 지움", async () => {
    for (let i = 0; i < 7; i++) await push.saveSubscription(field, fakeSub());
    expect(await push.countFor(field)).toBe(5);
    const mine = fakeSub();
    await push.saveSubscription(field, mine);
    // 관리자가 현장소장 구독 주소로 끄기를 요청해도 지워지지 않는다
    await push.removeSubscription(manager, mine.endpoint);
    expect(await push.countFor(field)).toBe(5);
    await push.removeSubscription(field, mine.endpoint);
    expect(await push.countFor(field)).toBe(4);
    await svc.updateMember(ceo, field.id, { active: false });
    const db = await getDb();
    const [r] = await db.query<{ n: number }>(`select count(*)::int as n from records where collection = 'pushSubscriptions' and data->>'userId' = $1`, [field.id]);
    expect(r.n).toBe(0);
  });

  it("실제 웹 푸시 라이브러리가 저장 형식을 받아 암호화된 요청(VAPID 서명)을 만든다", async () => {
    const webpush = (await import("web-push")).default;
    const k = webpush.generateVAPIDKeys();
    const sub = push.validateSubscription(fakeSub("web.push.apple.com"));
    const req = webpush.generateRequestDetails(sub, JSON.stringify({ title: "본사 작업지시", body: "A현장" }), { vapidDetails: { subject: "mailto:ops@taekang.test", publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 60 });
    expect(req.endpoint).toBe(sub.endpoint);
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    // 본문은 암호화되어 원문이 보이지 않는다
    expect(Buffer.from(req.body as Buffer).toString("utf8")).not.toContain("본사 작업지시");
  });

  it("구독 정보는 화면 데이터·백업에 들어가지 않는다", async () => {
    await push.saveSubscription(manager, fakeSub());
    const view = JSON.stringify((await svc.getView(ceo)).db);
    expect(view).not.toContain("fcm.googleapis.com");
    expect((await svc.exportCompany(ceo)).body).not.toContain("fcm.googleapis.com");
  });
});
