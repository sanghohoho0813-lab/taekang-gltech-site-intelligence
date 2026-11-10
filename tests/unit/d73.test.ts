/**
 * D-73 보고서 링크 — 로그인 없이 여는 읽기 전용 주소.
 * 1) 순수 로직: 만들기·닫기·기한·고정된 내용·비밀값 미저장·금액/이름/요청 내용 없음·권한·보관
 * 2) 서버 (실제 Postgres 엔진): 주소로 열기·사진(지금도 공개인 것만)·열어 본 횟수·처음 열림 알림·API 응답·요청 제한·매일 점검 정리
 */
import { createECDH, createHash, randomBytes as nodeRandom } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.NEXT_PUBLIC_DATA_MODE = "live";
process.env.DATABASE_URL = await testDatabaseUrl("d73");
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const { createSeed } = await import("@/lib/data/seed");
const { submitFieldReport, voidReport, CommandError } = await import("@/lib/data/commands");
const { COMMANDS } = await import("@/lib/data/registry");
const { setPhotoShare } = await import("@/lib/data/portalCommands");
const { applyShareRetention, createShare, recordShareView, revokeShare } = await import("@/lib/data/shareCommands");
const share = await import("@/lib/domain/share");
const { authorize, viewFor, ForbiddenError } = await import("@/server/authz");
const { hasMoney } = await import("@/lib/domain/redact");
const svc = await import("@/server/service");
const shareSvc = await import("@/server/shareService");
const auth = await import("@/server/auth");
const push = await import("@/server/push");
const { resetRateLimits } = await import("@/server/rateLimit");
const { getDb } = await import("@/server/sql");
const { NextRequest } = await import("next/server");
const dataRoute = await import("@/app/api/share/[token]/route");
const viewRoute = await import("@/app/api/share/[token]/view/route");
const photoRoute = await import("@/app/api/share/[token]/photo/[id]/route");

import type { DemoDB, ReportShare } from "@/lib/domain/types";
import type { Member as AuthMember } from "@/server/auth";

const NOW = new Date("2026-11-10T03:00:00Z");
const TODAY = "2026-11-10";
const ctx = (userId = "u-manager", now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const member = (id: string, role: AuthMember["role"], extra: Partial<AuthMember> = {}): AuthMember => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const days = (n: number, from = NOW) => new Date(from.getTime() + n * 86_400_000);

/** 공개 사진 1장(A현장, 11월) + 공개하지 않은 사진 1장 */
function seedWithPhotos(): { db: DemoDB; shared: string; hidden: string; reportId: string } {
  const r = submitFieldReport(createSeed(NOW), { idempotencyKey: "s1", siteId: "site-a", reportDate: TODAY, workDone: "3층 유닛 설치 — 원청 담당과 단가 협의 중(내부)", photos: [{ dataUrl: JPG, caption: "내부 메모" }, { dataUrl: JPG, caption: "내부 2" }] }, ctx("u-field"));
  const [a, b] = r.db.photos.filter((p) => p.reportId === r.result.reportId);
  const db = setPhotoShare(r.db, { photoIds: [a.id], shared: true, caption: "커튼월 유닛 설치" }, ctx()).db;
  return { db, shared: a.id, hidden: b.id, reportId: r.result.reportId };
}

describe("보고서 링크 — 만들기 (순수 로직)", () => {
  it("base64url: Node와 같은 결과 (길이 0~40바이트)", () => {
    for (let n = 0; n <= 40; n++) {
      const b = nodeRandom(n);
      expect(share.base64url(new Uint8Array(b))).toBe(b.toString("base64url"));
    }
  });

  it("주소 비밀값은 결과로 한 번만 — 저장된 데이터 어디에도 없고, id는 그 SHA-256", () => {
    const { db } = seedWithPhotos();
    const out = createShare(db, { kind: "monthly", siteId: "site-a", month: "2026-11", days: 14 }, ctx());
    const { token, shareId, expiresAt } = out.result;
    expect(token).toMatch(share.SHARE_TOKEN_RE);
    expect(shareId).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(out.db)).not.toContain(token);
    expect(expiresAt).toBe(days(14).toISOString());
    const s = out.db.shares![0];
    expect(s).toMatchObject({ id: shareId, kind: "monthly", siteId: "site-a", month: "2026-11", title: "A현장 11월 공정 보고서", createdBy: "u-manager", views: 0 });
    expect(out.db.activityLogs[0]).toMatchObject({ type: "share", siteId: "site-a", by: "u-manager" });
    expect(out.db.activityLogs[0].summary).toContain("A현장 11월 공정 보고서");
    // 두 번 만들면 주소가 다르다
    const again = createShare(out.db, { kind: "monthly", siteId: "site-a", month: "2026-11" }, ctx());
    expect(again.result.token).not.toBe(token);
    expect(again.db.shares).toHaveLength(2);
  });

  it("내용: 금액·사람 이름·요청 내용·내부 메모·보고 글 없음 — 공정·공개 사진 번호·건수만", () => {
    const { db, shared, hidden } = seedWithPhotos();
    for (const input of [{ kind: "monthly" as const, siteId: "site-a", month: "2026-11" }, { kind: "completion" as const, siteId: "site-a" }]) {
      const s = createShare(db, input, ctx()).db.shares![0];
      const text = JSON.stringify(s.snapshot);
      expect(hasMoney(text), input.kind).toBe(false);
      // 직원 이름 없음 (발주처 계정 이름은 회사 이름이라 준공 보고서의 ‘발주처’ 칸과 겹친다 — 사람 이름이 아님)
      for (const u of db.users.filter((x) => x.role !== "partner")) expect(text, `${input.kind}:${u.name}`).not.toContain(u.name);
      for (const r of db.partnerRequests) {
        expect(text).not.toContain(r.title);
        if (r.reply) expect(text).not.toContain(r.reply);
      }
      expect(text).not.toContain("단가 협의");
      expect(text).not.toContain("내부 메모");
      expect(text).not.toContain(db.sites.find((x) => x.id === "site-a")!.warranty?.note ?? "가상 계약서 하자담보 조항");
      // 사진은 번호·날짜·공개 설명만 (원본 주소·내부 설명 없음), 공개한 것만
      expect(s.snapshot!.photos).toEqual([{ id: shared, at: expect.any(String), caption: "커튼월 유닛 설치" }]);
      expect(text).not.toContain(hidden);
      expect(text).not.toContain("data:image");
    }
    // 준공 보고서 링크에는 ‘계획보다 늦음’(본사 화면 전용)이 없다
    const c = createShare(db, { kind: "completion", siteId: "site-a" }, ctx()).db.shares![0].snapshot!;
    expect(c.kind).toBe("completion");
    expect(JSON.stringify(c)).not.toContain('"late"');
  });

  it("만든 뒤 공정률을 고쳐도 보낸 내용은 그대로 (고정)", () => {
    const { db } = seedWithPhotos();
    const made = createShare(db, { kind: "monthly", siteId: "site-a" }, ctx());
    const before = JSON.stringify(made.db.shares![0].snapshot);
    const pct = made.db.sites.find((s) => s.id === "site-a")!.progressPct;
    const next = COMMANDS.updateProgress(made.db, { siteId: "site-a", progressPct: pct + 5 }, ctx());
    expect(next.db.sites.find((s) => s.id === "site-a")!.progressPct).toBe(pct + 5);
    expect(JSON.stringify(next.db.shares![0].snapshot)).toBe(before);
    expect((next.db.shares![0].snapshot as { progressPct: number }).progressPct).toBe(pct);
  });

  it("입력 확인: 종류·기한(7·14·30일)·달(착공한 달~이번 달)·현장 · 한 현장에 열린 링크 20개까지", () => {
    const db = createSeed(NOW);
    const bad = (input: unknown) => expect(() => createShare(db, input as never, ctx())).toThrow(CommandError);
    bad({ kind: "weekly", siteId: "site-a" });
    bad({ kind: "monthly", siteId: "site-a", days: 5 });
    bad({ kind: "monthly", siteId: "site-a", days: 365 });
    bad({ kind: "monthly", siteId: "site-a", month: "2026-12" }); // 다음 달
    bad({ kind: "monthly", siteId: "site-a", month: "2020-01" }); // 착공 전
    bad({ kind: "monthly", siteId: "site-a", month: "2026-13" });
    bad({ kind: "monthly", siteId: "nope" });
    bad({ kind: "completion", siteId: 3 });
    for (const d of share.SHARE_DAYS) expect(createShare(db, { kind: "completion", siteId: "site-a", days: d }, ctx()).result.expiresAt).toBe(days(d).toISOString());
    // 기본 14일
    expect(createShare(db, { kind: "completion", siteId: "site-a" }, ctx()).result.expiresAt).toBe(days(share.SHARE_DEFAULT_DAYS).toISOString());
    let cur = db;
    for (let i = 0; i < share.SHARE_MAX_OPEN_PER_SITE; i++) cur = createShare(cur, { kind: "completion", siteId: "site-a" }, ctx()).db;
    expect(() => createShare(cur, { kind: "completion", siteId: "site-a" }, ctx())).toThrow(/20개/);
    // 다른 현장은 따로 센다 · 하나 닫으면 다시 만들 수 있다
    expect(() => createShare(cur, { kind: "completion", siteId: "site-b" }, ctx())).not.toThrow();
    const closed = revokeShare(cur, { shareId: cur.shares![0].id }, ctx()).db;
    expect(() => createShare(closed, { kind: "completion", siteId: "site-a" }, ctx())).not.toThrow();
  });

  it("고를 수 있는 달: 착공한 달부터 이번 달까지 최근 것부터 (최대 24개월) · 본사는 62일보다 오래된 달도 만든다", () => {
    expect(share.shareMonths({ startDate: "2026-09-20" }, TODAY)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(share.shareMonths({ startDate: "2020-01-01" }, TODAY)).toHaveLength(share.SHARE_MONTHS_BACK);
    expect(share.shareMonths({ startDate: "2027-03-01" }, TODAY)).toEqual(["2026-11"]);
    const db = createSeed(NOW);
    const site = db.sites.find((s) => s.id === "site-a")!;
    const oldest = share.shareMonths(site, TODAY).at(-1)!;
    expect(oldest).toBe(site.startDate.slice(0, 7));
    const doc = share.monthlyDoc(db, "site-a", oldest, TODAY)!;
    expect(doc).toMatchObject({ kind: "monthly", month: oldest, asOf: TODAY, siteShort: "A현장" });
    expect(doc.stages).toHaveLength(site.stages.length);
  });
});

describe("보고서 링크 — 닫기·기한·보관·권한 (순수 로직)", () => {
  it("닫으면 내용도 지운다 · 두 번 닫기·기한 지난 링크 닫기는 거부", () => {
    const made = createShare(createSeed(NOW), { kind: "completion", siteId: "site-a", days: 7 }, ctx());
    const id = made.result.shareId;
    const closed = revokeShare(made.db, { shareId: id }, ctx("u-ceo", days(1)));
    const s = closed.db.shares![0];
    expect(s.revokedAt).toBe(days(1).toISOString());
    expect(s.revokedBy).toBe("u-ceo");
    expect(s.snapshot).toBeUndefined();
    expect(share.shareState(s, days(1).toISOString())).toBe("revoked");
    expect(closed.db.activityLogs[0].summary).toContain("닫음");
    expect(() => revokeShare(closed.db, { shareId: id }, ctx())).toThrow(/이미 닫은/);
    expect(() => revokeShare(made.db, { shareId: id }, ctx("u-ceo", days(8)))).toThrow(/기한/);
    expect(() => revokeShare(made.db, { shareId: "nope" }, ctx())).toThrow(CommandError);
  });

  it("기한: 끝나는 시각부터 열리지 않는다", () => {
    const s = createShare(createSeed(NOW), { kind: "completion", siteId: "site-a", days: 7 }, ctx()).db.shares![0];
    expect(share.shareState(s, new Date(days(7).getTime() - 1).toISOString())).toBe("open");
    expect(share.shareState(s, days(7).toISOString())).toBe("expired");
  });

  it("열어 본 기록(시연판): 횟수·처음·마지막 시각 · 닫히거나 기한 지난 링크는 세지 않는다", () => {
    const made = createShare(createSeed(NOW), { kind: "completion", siteId: "site-a", days: 7 }, ctx());
    const id = made.result.shareId;
    const v1 = recordShareView(made.db, { shareId: id }, ctx("system", days(1)));
    const v2 = recordShareView(v1.db, { shareId: id }, ctx("system", days(2)));
    expect(v2.db.shares![0]).toMatchObject({ views: 2, firstViewedAt: days(1).toISOString(), lastViewedAt: days(2).toISOString() });
    expect(() => recordShareView(made.db, { shareId: id }, ctx("system", days(8)))).toThrow(CommandError);
    expect(() => recordShareView(revokeShare(made.db, { shareId: id }, ctx()).db, { shareId: id }, ctx("system"))).toThrow(CommandError);
  });

  it("보관: 기한이 지나면 내용 삭제, 닫히거나 끝난 지 60일이 지나면 기록 삭제 · 바꿀 것이 없으면 그대로", () => {
    const made = createShare(createSeed(NOW), { kind: "completion", siteId: "site-a", days: 7 }, ctx()).db;
    expect(applyShareRetention(made, days(3))).toBe(made);
    const expired = applyShareRetention(made, days(8));
    expect(expired.shares).toHaveLength(1);
    expect(expired.shares![0].snapshot).toBeUndefined();
    expect(applyShareRetention(expired, days(9))).toBe(expired);
    expect(applyShareRetention(made, days(7 + share.SHARE_KEEP_DAYS + 1)).shares).toHaveLength(0);
    const noShares = createSeed(NOW);
    expect(applyShareRetention(noShares, NOW)).toBe(noShares);
  });

  it("사진: 공개를 끄거나 보고를 취소하면 링크에서도 빠진다", () => {
    const { db, shared, hidden, reportId } = seedWithPhotos();
    const p = (d: DemoDB, id: string) => d.photos.find((x) => x.id === id);
    expect(share.sharePhotoVisible(db, p(db, shared), "site-a")).toBe(true);
    expect(share.sharePhotoVisible(db, p(db, hidden), "site-a")).toBe(false);
    expect(share.sharePhotoVisible(db, p(db, shared), "site-b")).toBe(false);
    expect(share.sharePhotoVisible(db, undefined, "site-a")).toBe(false);
    const off = setPhotoShare(db, { photoIds: [shared], shared: false }, ctx()).db;
    expect(share.sharePhotoVisible(off, p(off, shared), "site-a")).toBe(false);
    const voided = voidReport(db, reportId, ctx("u-field")).db;
    // 취소한 보고의 사진에 공개 표시가 남아 있어도 보이지 않는다
    const stale = { ...voided, photos: voided.photos.map((x) => (x.id === shared ? { ...x, shared: { at: NOW.toISOString(), by: "u-manager", caption: "x" } } : x)) };
    expect(share.sharePhotoVisible(stale, p(stale, shared), "site-a")).toBe(false);
  });

  it("권한: 본사만 만들고 닫는다 · 화면 데이터 — 본사는 목록만(내용 없이), 현장·발주처에는 보내지 않는다", () => {
    const made = createShare(createSeed(NOW), { kind: "monthly", siteId: "site-a" }, ctx()).db;
    const id = made.shares![0].id;
    const FIELD = member("u-field", "field");
    const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });
    for (const m of [FIELD, PARTNER]) {
      expect(() => authorize(m, "createShare", { kind: "monthly", siteId: "site-a" }, made, NOW)).toThrow(ForbiddenError);
      expect(() => authorize(m, "revokeShare", { shareId: id }, made, NOW)).toThrow(ForbiddenError);
      expect(viewFor(m, made, NOW).shares).toEqual([]);
    }
    for (const m of [member("u-ceo", "ceo"), member("u-manager", "manager")]) {
      expect(() => authorize(m, "createShare", { kind: "monthly", siteId: "site-a" }, made, NOW)).not.toThrow();
      const v = viewFor(m, made, NOW).shares!;
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ id, title: "A현장 11월 공정 보고서", views: 0 });
      expect("snapshot" in v[0]).toBe(false);
    }
  });

  it("보낼 글: 회사·보고서 이름·기한·주소 — 금액 없음", () => {
    const msg = share.shareMessage({ company: "(주)태강지엘텍", title: "A현장 11월 공정 보고서", url: "https://x.test/s/abc", expiresAt: "2026-11-24T03:00:00.000Z" });
    expect(msg).toBe("[(주)태강지엘텍] A현장 11월 공정 보고서입니다.\n아래 주소를 누르면 바로 보실 수 있습니다 (로그인 없음 · 2026.11.24까지 열림).\nhttps://x.test/s/abc");
    expect(hasMoney(msg)).toBe(false);
  });
});

// ───────────────────────── 서버 ─────────────────────────

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let ceo: Member;
let manager: Member;
let field: Member;
const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag: string } }[] = [];
const subs: Record<string, string> = {};
let token = "";
let shareId = "";
let sharedPhoto = "";
let hiddenPhoto = "";

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fakeSub() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${b64u(nodeRandom(12))}`, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(nodeRandom(16)) } };
}
async function loginAs(email: string) {
  const r = await auth.login(email, PW);
  if (!r.ok) throw new Error(r.error);
  return (await auth.memberFromToken(r.token))!;
}
const mine = async (): Promise<ReportShare> => (await svc.getView(ceo)).db.shares!.find((s) => s.id === shareId)!;
const req = (path: string, init: { method?: string; ip?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers: { "x-forwarded-for": init.ip ?? "203.0.113.10", ...(init.headers ?? {}) } });

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  push.setPushSender(null);
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@d73.test", password: PW, withDemoData: true });
  ceo = await loginAs("ceo@d73.test");
  manager = await loginAs("manager@demo.local");
  field = await loginAs("field@demo.local");
  push.setPushSender(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201 };
  });
  for (const [k, m] of [["ceo", ceo], ["manager", manager]] as const) {
    const s = fakeSub();
    await push.saveSubscription(m, s);
    subs[k] = s.endpoint;
  }
  // 현장 보고에 사진 2장 → 1장만 발주처 공개
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const r = await svc.executeCommand(field, "submitFieldReport", { idempotencyKey: "d73-1", siteId: "site-a", reportDate: today, workDone: "유닛 설치", photos: [{ dataUrl: JPG }, { dataUrl: JPG }] });
  const reportId = (r.result as { reportId: string }).reportId;
  const photos = (await svc.getView(ceo)).db.photos.filter((p) => p.reportId === reportId);
  [sharedPhoto, hiddenPhoto] = photos.map((p) => p.id);
  await svc.executeCommand(manager, "setPhotoShare", { photoIds: [sharedPhoto], shared: true, caption: "유닛 설치 전경" });
  const made = await svc.executeCommand(manager, "createShare", { kind: "monthly", siteId: "site-a", days: 7 });
  ({ token, shareId } = made.result as { token: string; shareId: string });
  sent.length = 0;
});

describe("보고서 링크 — 서버 (실제 Postgres 엔진)", () => {
  it("색인이 있다 (회사 번호 없이 링크 id로 바로 찾는다) · DB에 비밀값이 없다", async () => {
    const db = await getDb();
    const idx = await db.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'records' and indexname = 'records_share_id'`);
    expect(idx).toHaveLength(1);
    const rows = await db.query<{ id: string; data: unknown }>(`select id, data::text as data from records where collection = 'shares'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(createHash("sha256").update(token).digest("hex"));
    expect(String(rows[0].data)).not.toContain(token);
    const all = await db.query<{ n: number }>(`select count(*)::int as n from records where data::text like $1`, [`%${token}%`]);
    expect(all[0].n).toBe(0);
  });

  it("화면 데이터: 본사에는 목록만 (내용 없이) · 현장 직원에게는 보내지 않는다", async () => {
    const v = (await svc.getView(ceo)).db.shares!;
    expect(v).toHaveLength(1);
    expect("snapshot" in v[0]).toBe(false);
    expect((await svc.getView(field)).db.shares).toEqual([]);
    await expect(svc.executeCommand(field, "createShare", { kind: "monthly", siteId: "site-a" })).rejects.toThrow(ForbiddenError);
    await expect(svc.executeCommand(field, "revokeShare", { shareId })).rejects.toThrow(ForbiddenError);
  });

  it("주소로 열기: 고정한 내용 + 지금 공개인 사진만 · 틀린 주소·형식이 다른 값은 ‘없음’", async () => {
    const r = await shareSvc.openShare(token);
    if (!r.ok) throw new Error(r.reason);
    expect(r.title).toBe("A현장 11월 공정 보고서".replace("11월", `${Number(r.doc.kind === "monthly" ? r.doc.month.slice(5, 7) : 0)}월`));
    expect(r.doc.kind).toBe("monthly");
    expect(r.doc.company).toBe("(주)태강지엘텍");
    expect(r.doc.sample).toBe(true);
    expect(r.photoIds).toEqual([sharedPhoto]);
    expect(hasMoney(JSON.stringify(r.doc))).toBe(false);
    const other = share.base64url(new Uint8Array(nodeRandom(24)));
    for (const bad of [other, "", "short", `${token}x`, token.slice(0, 31), "../../etc/passwd", null, 42, { token }]) expect(await shareSvc.openShare(bad)).toEqual({ ok: false, reason: "notfound" });
    // 링크 id(해시)를 알아도 열 수 없다
    expect(await shareSvc.openShare(shareId)).toEqual({ ok: false, reason: "notfound" });
    expect(await shareSvc.openShare(shareId.slice(0, 32))).toEqual({ ok: false, reason: "notfound" });
  });

  it("사진: 문서에 든 공개 사진만 준다 — 다른 사진·공개를 끈 사진은 주지 않고, 다시 켜면 다시 보인다", async () => {
    const ok = await shareSvc.sharePhoto(token, sharedPhoto);
    expect(ok?.mime).toBe("image/jpeg");
    expect(ok!.data.length).toBeGreaterThan(50);
    expect(await shareSvc.sharePhoto(token, hiddenPhoto)).toBeNull();
    expect(await shareSvc.sharePhoto(token, "nope")).toBeNull();
    expect(await shareSvc.sharePhoto(token, "a/../b")).toBeNull();
    expect(await shareSvc.sharePhoto(share.base64url(new Uint8Array(nodeRandom(24))), sharedPhoto)).toBeNull();
    await svc.executeCommand(manager, "setPhotoShare", { photoIds: [sharedPhoto], shared: false });
    expect(await shareSvc.sharePhoto(token, sharedPhoto)).toBeNull();
    const r = await shareSvc.openShare(token);
    expect(r.ok && r.photoIds).toEqual([]);
    // 링크를 만든 뒤 새로 공개한 사진은 (문서에 없으므로) 나오지 않는다
    await svc.executeCommand(manager, "setPhotoShare", { photoIds: [hiddenPhoto], shared: true });
    expect(await shareSvc.sharePhoto(token, hiddenPhoto)).toBeNull();
    await svc.executeCommand(manager, "setPhotoShare", { photoIds: [sharedPhoto], shared: true });
    expect((await shareSvc.sharePhoto(token, sharedPhoto))?.mime).toBe("image/jpeg");
  });

  it("열어 본 횟수: 같은 곳 30분에 한 번 · 처음 열리면 만든 사람에게만 알림 + 활동 이력 · 화면이 새 횟수를 받는다", async () => {
    resetRateLimits();
    sent.length = 0;
    const rev0 = await svc.currentRev(ceo.companyId);
    const t0 = new Date();
    expect(await shareSvc.countShareView(token, "203.0.113.10", t0)).toEqual({ counted: true });
    expect(await shareSvc.countShareView(token, "203.0.113.10", new Date(t0.getTime() + 60_000))).toEqual({ counted: false });
    expect(await shareSvc.countShareView(token, "203.0.113.11", new Date(t0.getTime() + 120_000))).toEqual({ counted: true });
    // 30분이 지나면 같은 곳도 다시 센다
    expect(await shareSvc.countShareView(token, "203.0.113.10", new Date(t0.getTime() + 31 * 60_000))).toEqual({ counted: true });
    const s = await mine();
    expect(s.views).toBe(3);
    expect(s.firstViewedAt).toBe(t0.toISOString());
    expect(s.lastViewedAt).toBe(new Date(t0.getTime() + 31 * 60_000).toISOString());
    expect(await svc.currentRev(ceo.companyId)).toBe(rev0 + 3);
    // 알림은 처음 한 번, 만든 사람(공무)에게만 — 금액·이름 없음
    expect(sent.map((x) => x.endpoint)).toEqual([subs.manager]);
    expect(sent[0].payload.title).toBe("보낸 보고서를 열어 봤습니다");
    expect(sent[0].payload.body).toContain("공정 보고서");
    expect(sent[0].payload.url).toBe("/sites/site-a?tab=requests");
    expect(hasMoney(`${sent[0].payload.title} ${sent[0].payload.body}`)).toBe(false);
    const logs = (await svc.getView(ceo)).db.activityLogs.filter((l) => l.type === "share");
    expect(logs.filter((l) => l.summary.includes("처음 열림"))).toHaveLength(1);
    expect(logs.find((l) => l.summary.includes("처음 열림"))).toMatchObject({ by: "system", siteId: "site-a" });
    // 없는 주소는 세지 않는다
    expect(await shareSvc.countShareView(share.base64url(new Uint8Array(nodeRandom(24))), "203.0.113.99")).toEqual({ counted: false });
  });

  it("열어 본 기록과 명령이 겹쳐도 서로 덮어쓰지 않는다", async () => {
    resetRateLimits();
    const before = (await mine()).views;
    await Promise.all([
      shareSvc.countShareView(token, "198.51.100.1"),
      svc.executeCommand(manager, "createShare", { kind: "completion", siteId: "site-b", days: 7 }),
      shareSvc.countShareView(token, "198.51.100.2"),
      svc.executeCommand(ceo, "setCompanySettings", { morningBrief: false }),
      shareSvc.countShareView(token, "198.51.100.3"),
    ]);
    const v = (await svc.getView(ceo)).db.shares!;
    expect(v.find((s) => s.id === shareId)!.views).toBe(before + 3);
    expect(v).toHaveLength(2);
  });

  it("API: 열기 200(저장 금지·검색 금지·주소 유출 금지 머리말) · 없는 주소 404 · 사진 200/404 · 열어 봄은 항상 같은 답", async () => {
    resetRateLimits();
    const ok = await dataRoute.GET(req(`/api/share/${token}`), { params: Promise.resolve({ token }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("x-robots-tag")).toContain("noindex");
    expect(ok.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await ok.json();
    expect(Object.keys(body).sort()).toEqual(["createdAt", "doc", "expiresAt", "photoIds", "title"]);
    expect(JSON.stringify(body)).not.toContain(shareId);
    expect(JSON.stringify(body)).not.toContain("u-manager");
    const wrong = share.base64url(new Uint8Array(nodeRandom(24)));
    const miss = await dataRoute.GET(req(`/api/share/${wrong}`), { params: Promise.resolve({ token: wrong }) });
    expect(miss.status).toBe(404);
    expect((await miss.json()).code).toBe("notfound");
    const ph = await photoRoute.GET(req(`/api/share/${token}/photo/${sharedPhoto}`), { params: Promise.resolve({ token, id: sharedPhoto }) });
    expect(ph.status).toBe(200);
    expect(ph.headers.get("content-type")).toBe("image/jpeg");
    expect(ph.headers.get("cache-control")).toBe("private, no-cache");
    const cached = await photoRoute.GET(req(`/api/share/${token}/photo/${sharedPhoto}`, { headers: { "if-none-match": `"${sharedPhoto}"` } }), { params: Promise.resolve({ token, id: sharedPhoto }) });
    expect(cached.status).toBe(304);
    const noPh = await photoRoute.GET(req(`/api/share/${wrong}/photo/${sharedPhoto}`), { params: Promise.resolve({ token: wrong, id: sharedPhoto }) });
    expect(noPh.status).toBe(404);
    // 열어 봄: 맞는 주소든 아니든 같은 답 · 다른 사이트에서 보낸 요청은 거부
    for (const t of [token, wrong]) {
      const v = await viewRoute.POST(req(`/api/share/${t}/view`, { method: "POST" }), { params: Promise.resolve({ token: t }) });
      expect(v.status).toBe(200);
      expect(await v.json()).toEqual({ ok: true });
    }
    const cross = await viewRoute.POST(req(`/api/share/${token}/view`, { method: "POST", headers: { origin: "https://evil.example", host: "localhost" } }), { params: Promise.resolve({ token }) });
    expect(cross.status).toBe(403);
  });

  it("요청 제한: 없는 주소를 계속 넣는 곳은 막힌다 (맞는 주소도 그동안 열리지 않음) · 다른 곳은 그대로 열린다", async () => {
    resetRateLimits();
    const ip = "192.0.2.77";
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const w = share.base64url(new Uint8Array(nodeRandom(24)));
      last = (await dataRoute.GET(req(`/api/share/${w}`, { ip }), { params: Promise.resolve({ token: w }) })).status;
    }
    expect(last).toBe(429);
    expect((await dataRoute.GET(req(`/api/share/${token}`, { ip }), { params: Promise.resolve({ token }) })).status).toBe(429);
    expect((await dataRoute.GET(req(`/api/share/${token}`, { ip: "192.0.2.78" }), { params: Promise.resolve({ token }) })).status).toBe(200);
    resetRateLimits();
  });

  it("기한·닫기: 기한이 지나면 410 · 닫으면 바로 410, 사진도 안 나오고 횟수도 안 센다 · DB에서 내용이 지워진다", async () => {
    resetRateLimits();
    expect(await shareSvc.openShare(token, days(8, new Date()))).toEqual({ ok: false, reason: "expired" });
    expect(await shareSvc.sharePhoto(token, sharedPhoto, days(8, new Date()))).toBeNull();
    expect(await shareSvc.countShareView(token, "198.51.100.50", days(8, new Date()))).toEqual({ counted: false });
    const views = (await mine()).views;
    await svc.executeCommand(ceo, "revokeShare", { shareId });
    expect(await shareSvc.openShare(token)).toEqual({ ok: false, reason: "revoked" });
    const gone = await dataRoute.GET(req(`/api/share/${token}`), { params: Promise.resolve({ token }) });
    expect(gone.status).toBe(410);
    expect((await gone.json()).code).toBe("revoked");
    expect(await shareSvc.sharePhoto(token, sharedPhoto)).toBeNull();
    expect(await shareSvc.countShareView(token, "198.51.100.51")).toEqual({ counted: false });
    expect((await mine()).views).toBe(views);
    const db = await getDb();
    const [row] = await db.query<{ data: string }>(`select data::text as data from records where collection = 'shares' and id = $1`, [shareId]);
    expect(row.data).not.toContain("snapshot");
    await expect(svc.executeCommand(ceo, "revokeShare", { shareId })).rejects.toThrow(/이미 닫은/);
  });

  it("매일 점검: 기한이 지난 링크의 내용을 지우고, 60일 지난 기록을 지운다 (알림 설정과 상관없이)", async () => {
    const v0 = (await svc.getView(ceo)).db.shares!;
    expect(v0).toHaveLength(2);
    const db = await getDb();
    const snapshots = async () => (await db.query<{ n: number }>(`select count(*)::int as n from records where collection = 'shares' and data ? 'snapshot'`))[0].n;
    expect(await snapshots()).toBe(1);
    push.setPushSender(null);
    await svc.runDailyJobs(days(8, new Date()));
    expect(await snapshots()).toBe(0);
    expect((await svc.getView(ceo)).db.shares).toHaveLength(2);
    await svc.runDailyJobs(days(8 + share.SHARE_KEEP_DAYS, new Date()));
    expect((await svc.getView(ceo)).db.shares).toHaveLength(0);
  });
});
