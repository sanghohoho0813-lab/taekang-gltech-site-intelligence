/**
 * D-91 회사 휴대폰 알림 켜기 — Vercel 환경변수 없이 대표가 운영 설정에서 켠다.
 * 서버가 알림 키를 만들어 DB(serverKeys)에 보관하고, 화면 데이터·백업에는 나가지 않는다. 환경변수 키가 있으면 그것이 먼저다.
 */
import { createECDH, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.DATABASE_URL = await testDatabaseUrl("d91push");
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;

const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const push = await import("@/server/push");
const { getDb } = await import("@/server/sql");
const { ForbiddenError } = await import("@/server/authz");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let ceo: Member;
let manager: Member;
let field: Member;

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const bytes = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").length;
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

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

beforeAll(async () => {
  push.setPushSender(null);
  push.forgetAppKeys();
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@d91.test", password: PW, withDemoData: true });
  ceo = await loginAs("ceo@d91.test");
  manager = await loginAs("manager@demo.local");
  field = await loginAs("field@demo.local");
});

describe("D-91 회사 휴대폰 알림 켜기", () => {
  let publicKey = "";
  let privateKey = "";

  it("처음에는 꺼져 있고, 켤 수 있는 사람은 대표 권한뿐", async () => {
    expect(await svc.companyPushStatus(ceo)).toEqual({ enabled: false, source: null, publicKey: null, canEnable: true });
    expect((await svc.companyPushStatus(manager)).canEnable).toBe(false);
    expect((await svc.companyPushStatus(field)).canEnable).toBe(false);
    expect(await push.pushReadyFor(ceo.companyId)).toBe(false);
    expect(await push.anyAppVapid()).toBe(false);
    // 꺼져 있을 때 휴대폰 등록은 대표에게 켜는 곳을 알려 준다
    await expect(push.saveSubscription(field, fakeSub())).rejects.toThrow(/운영 설정/);
  });

  it("본사관리자·현장은 켤 수 없다", async () => {
    await expect(svc.enableCompanyPush(manager, "https://taekang.example")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.enableCompanyPush(field, "https://taekang.example")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await push.anyAppVapid()).toBe(false);
  });

  it("대표가 켜면 서버가 올바른 알림 키를 만들고, 다시 눌러도 키가 바뀌지 않는다", async () => {
    const r = await svc.enableCompanyPush(ceo, "https://taekang-gltech-site-intelligence.vercel.app");
    expect(r).toMatchObject({ enabled: true, source: "app", created: true, canEnable: true });
    expect(bytes(r.publicKey!)).toBe(65);
    publicKey = r.publicKey!;
    push.forgetAppKeys(); // 다른 서버 인스턴스처럼 DB에서 다시 읽는다
    const v = await push.vapidFor(ceo.companyId);
    expect(v).toMatchObject({ publicKey, source: "app", subject: "https://taekang-gltech-site-intelligence.vercel.app" });
    expect(bytes(v!.privateKey)).toBe(32);
    privateKey = v!.privateKey;
    const again = await svc.enableCompanyPush(ceo, "https://taekang-gltech-site-intelligence.vercel.app");
    expect(again).toMatchObject({ enabled: true, created: false, publicKey });
    expect(await push.pushReadyFor(ceo.companyId)).toBe(true);
    expect(await push.anyAppVapid()).toBe(true);
    // 본사·현장도 같은 공개 키로 휴대폰을 등록한다
    expect(await svc.companyPushStatus(field)).toMatchObject({ enabled: true, publicKey, canEnable: false });
  });

  it("켠 뒤에는 휴대폰 등록이 되고, 활동 이력에 누가 켰는지 남는다", async () => {
    expect((await push.saveSubscription(field, fakeSub())).count).toBe(1);
    const { todayIso } = await import("@/lib/domain/format");
    const today = todayIso();
    const { logs } = await svc.listActivity(ceo, { from: today, to: today });
    const log = logs.find((l) => l.summary.includes("회사 휴대폰 알림을 켰습니다"));
    expect(log).toMatchObject({ by: ceo.id, link: "/admin?tab=settings" });
    expect(logs.filter((l) => l.summary.includes("회사 휴대폰 알림을 켰습니다"))).toHaveLength(1);
  });

  it("비밀키는 화면 데이터·전체 백업에 나가지 않는다", async () => {
    for (const who of [ceo, manager, field]) {
      const view = JSON.stringify((await svc.getView(who)).db);
      expect(view).not.toContain(privateKey);
    }
    const backup = (await svc.exportCompany(ceo)).body;
    expect(backup).not.toContain(privateKey);
    expect(backup).not.toContain("serverKeys");
  });

  it("http 주소에서 켜면 발신자는 예비 메일 주소", () => {
    expect(push.vapidSubject("http://localhost:3000")).toBe("mailto:admin@example.com");
    expect(push.vapidSubject("https://a.example/path")).toBe("https://a.example");
    expect(push.vapidSubject(undefined)).toBe("mailto:admin@example.com");
  });

  it("환경변수 키가 있으면 그것이 먼저이고, 화면에서 켜도 새 키를 만들지 않는다", async () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    process.env.VAPID_PUBLIC_KEY = b64u(ecdh.getPublicKey());
    process.env.VAPID_PRIVATE_KEY = b64u(ecdh.getPrivateKey());
    try {
      const st = await svc.companyPushStatus(manager);
      expect(st).toMatchObject({ enabled: true, source: "env", publicKey: process.env.VAPID_PUBLIC_KEY });
      const r = await svc.enableCompanyPush(ceo, "https://x.example");
      expect(r).toMatchObject({ source: "env", created: false });
      expect(push.hasEnvVapid()).toBe(true);
    } finally {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
    }
    // 환경변수를 빼면 화면에서 켠 키로 돌아간다
    expect((await push.vapidFor(ceo.companyId))?.publicKey).toBe(publicKey);
  });

  it("손상된 키 기록은 쓰지 않는다 (꺼짐으로 본다)", async () => {
    const db = await getDb();
    await db.query(`update records set data = jsonb_set(data, '{privateKey}', '"abc"') where company_id = $1 and collection = 'serverKeys'`, [ceo.companyId]);
    push.forgetAppKeys();
    expect(await push.vapidFor(ceo.companyId)).toBeNull();
    expect((await svc.companyPushStatus(ceo)).enabled).toBe(false);
  });
});
