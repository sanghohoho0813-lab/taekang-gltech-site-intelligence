/**
 * D-74 하자 접수 링크 — 계정 없는 사람이 주소·QR로 하자를 접수하고 진행을 확인한다.
 * 1) 순수 로직: 링크 만들기·닫기·다시 열기, 접수 검증·번호·하루 한도, 진행 확인, 확인·다시 접수, 버리기, 전화 접수, 연락처 보관 기간, 권한·보기
 * 2) 서버 (실제 Postgres 엔진): 주소로 접수·진행 확인·사진·확인·다시 접수, API 응답·요청 제한·본문 크기, 동시 접수, 한도 알림, 백업
 */
import { createECDH, createHash, randomBytes as nodeRandom } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropTestDatabase, testDatabaseUrl } from "./testDb";

process.env.NEXT_PUBLIC_DATA_MODE = "live";
process.env.DATABASE_URL = await testDatabaseUrl("d74");
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

const { createSeed } = await import("@/lib/data/seed");
const { CommandError } = await import("@/lib/data/commands");
const { COMMANDS } = await import("@/lib/data/registry");
const { applyIntakeRetention, checkIntakeInput, closeIntake, confirmIntake, createIntake, discardIntakeRequests, noteIntakeFull, registerPhoneDefect, renewIntakeStatus, reopenIntake, reopenIntakeLink, reopenIntakeRequest, submitIntake } =
  await import("@/lib/data/intakeCommands");
const { cleanText } = await import("@/lib/data/commands");
const { partnerMonthly } = await import("@/lib/domain/partnerFeed");
const { completionReport } = await import("@/lib/domain/completion");
const { createShare } = await import("@/lib/data/shareCommands");
const intake = await import("@/lib/domain/intake");
const { defectRows } = await import("@/lib/domain/defects");
const { noticesFor } = await import("@/lib/domain/notify");
const { authorize, viewFor, ForbiddenError } = await import("@/server/authz");
const svc = await import("@/server/service");
const intakeSvc = await import("@/server/intakeService");
const auth = await import("@/server/auth");
const push = await import("@/server/push");
const { resetRateLimits, clientIp } = await import("@/server/rateLimit");
const { getDb } = await import("@/server/sql");
const { NextRequest } = await import("next/server");
const formRoute = await import("@/app/api/intake/[token]/route");
const statusRoute = await import("@/app/api/intake/status/[key]/route");
const confirmRoute = await import("@/app/api/intake/status/[key]/confirm/route");
const photoRoute = await import("@/app/api/intake/status/[key]/photo/[id]/route");
const reopenRoute = await import("@/app/api/intake/status/[key]/reopen/route");

import type { DemoDB, PartnerRequest } from "@/lib/domain/types";
import type { Member as AuthMember } from "@/server/auth";

const NOW = new Date("2026-11-12T03:00:00Z"); // 11/12 12:00 KST
const ctx = (userId = "u-manager", now = NOW) => ({ userId, now });
const sys = (now = NOW) => ({ userId: "system", now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const member = (id: string, role: AuthMember["role"], extra: Partial<AuthMember> = {}): AuthMember => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const days = (n: number, from = NOW) => new Date(from.getTime() + n * 86_400_000);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const FORM = { location: "3층 302호 거실 창", description: "비가 오면 창틀 아래로 물이 샙니다.", name: "홍길동", phone: "010-1234-5678", org: "관리사무소", consent: true };
/** 화면이 만드는 접수 난수와 같은 꼴 (20자 이상) */
const K = (s: string) => `idem-0123456789abcdef-${s}`;

function withLink(db0 = createSeed(NOW)) {
  const made = createIntake(db0, { siteId: "site-a", label: "관리사무소용" }, ctx());
  return { db: made.db, intakeId: made.result.intakeId, token: made.result.token };
}
function withRequest() {
  const l = withLink();
  const out = submitIntake(l.db, { ...FORM, intakeId: l.intakeId, idempotencyKey: K("k1"), photoDataUrls: [JPG] }, sys());
  const req = out.db.partnerRequests.find((r) => r.id === out.result.requestId)!;
  return { ...l, db: out.db, req, ...out.result };
}

/** 접수 → 작업지시 → 현장 완료(사진) → 보수 사진과 회신까지 간 상태 */
function withAnswered() {
  const w = withRequest();
  const wo = COMMANDS.createWorkOrder(w.db, { siteId: "site-a", title: "하자보수 · 302호 창 누수", assigneeUserId: "u-field", dueDate: "2026-11-20", partnerRequestId: w.req.id, idempotencyKey: "wo-a" }, ctx());
  let db = COMMANDS.workOrderStep(wo.db, { workOrderId: wo.result.workOrderId, action: "complete", note: "실리콘 재시공", photoDataUrls: [JPG] }, ctx("u-field")).db;
  const donePhoto = db.workOrders!.find((x) => x.id === wo.result.workOrderId)!.donePhotoIds![0];
  db = COMMANDS.updatePartnerRequest(db, { requestId: w.req.id, patch: { status: "answered", reply: "실리콘을 다시 시공했습니다.", sharePhotoIds: [donePhoto] } }, ctx()).db;
  return { ...w, db, workOrderId: wo.result.workOrderId, donePhoto };
}
const viewOf = (d: DemoDB, statusToken: string, today = "2026-11-12") => {
  const r = d.partnerRequests.find((x) => x.statusKey === sha(statusToken))!;
  const prev = r.reopenedFrom ? d.partnerRequests.find((x) => x.id === r.reopenedFrom) : undefined;
  return intake.intakeStatusView({ company: d.company.name, site: d.sites.find((x) => x.id === r.siteId), req: r, workOrder: (d.workOrders ?? []).find((x) => x.id === r.linkedWorkOrderId), ...(prev ? { prev } : {}), round: intake.intakeRound(d, r), today });
};

describe("하자 접수 링크 — 만들기·닫기 (순수 로직)", () => {
  it("전화번호: 숫자만 남겨 한 가지 꼴로 · +82도 받는다 · 맞지 않으면 받지 않는다 · 회사 대표번호(1588-…)는 회사 전화에만", () => {
    expect(intake.normalizePhone("01012345678")).toBe("010-1234-5678");
    expect(intake.normalizePhone("010 1234 5678")).toBe("010-1234-5678");
    expect(intake.normalizePhone("02-123-4567")).toBe("02-123-4567");
    expect(intake.normalizePhone("0212345678")).toBe("02-1234-5678");
    expect(intake.normalizePhone("031-123-4567")).toBe("031-123-4567");
    expect(intake.normalizePhone("0505-123-4567")).toBe("050-5123-4567");
    expect(intake.normalizePhone("+82 10-1234-5678")).toBe("010-1234-5678");
    expect(intake.normalizePhone("821012345678")).toBe("010-1234-5678");
    expect(intake.normalizePhone("+82-2-123-4567")).toBe("02-123-4567");
    for (const bad of ["", "1234", "12345678901", "010-1234", "전화주세요", "1588-1234", null, 1012345678]) expect(intake.normalizePhone(bad)).toBeNull();
    expect(intake.normalizeOfficePhone("1588-1234")).toBe("1588-1234");
    expect(intake.normalizeOfficePhone("16441234")).toBe("1644-1234");
    expect(intake.normalizeOfficePhone("031 123 4567")).toBe("031-123-4567");
    expect(intake.normalizeOfficePhone("1234")).toBeNull();
    expect(intake.telHref("02-123-4567")).toBe("tel:021234567");
  });

  it("접수 주소는 22자(글자·숫자로 시작하고 끝남) · 접수만 되는 주소라 저장해 둔다(다시 볼 수 있게) · id는 그 SHA-256 · 건물 이름을 따로 적을 수 있다", () => {
    const { db, intakeId, token } = withLink();
    expect(token).toMatch(intake.INTAKE_TOKEN_RE);
    expect(token).toMatch(/^[A-Za-z0-9].*[A-Za-z0-9]$/);
    expect(intakeId).toBe(sha(token));
    expect(db.intakes![0]).toMatchObject({ id: intakeId, token, siteId: "site-a", label: "관리사무소용", createdBy: "u-manager", count: 0 });
    expect(db.intakes![0].place).toBeUndefined();
    expect(db.activityLogs[0].summary).toBe("하자 접수 링크 만듦 — A현장 · 관리사무소용");
    for (let i = 0; i < 30; i++) expect(intake.newToken((n) => new Uint8Array(nodeRandom(n)), 16)).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{20}[A-Za-z0-9]$/);
    const named = createIntake(createSeed(NOW), { siteId: "site-a", label: "관리사무소용", place: "  ○○물류센터  " }, ctx()).db.intakes![0];
    expect(named.place).toBe("○○물류센터");
    expect(() => createIntake(createSeed(NOW), { siteId: "site-a", place: "가".repeat(41) }, ctx())).toThrow(/40자/);
  });

  it("한 현장에 열린 링크 5개까지 · 같은 이름(띄어쓰기만 달라도)은 하나만 · 닫으면 다시 만들 수 있다 · 두 번 닫기 거부 · 닫은 링크 다시 열기", () => {
    let db = createSeed(NOW);
    const bad = (input: unknown) => expect(() => createIntake(db, input as never, ctx())).toThrow(CommandError);
    bad({ siteId: "nope" });
    bad({ siteId: "site-a", label: "가".repeat(21) });
    // 이름을 안 적으면 ‘하자 접수’
    db = createIntake(db, { siteId: "site-a" }, ctx()).db;
    expect(db.intakes![0].label).toBe("하자 접수");
    expect(() => createIntake(db, { siteId: "site-a" }, ctx())).toThrow(/이미 열려/);
    expect(() => createIntake(db, { siteId: "site-a", label: "하자  접수" }, ctx())).toThrow(/이미 열려/);
    for (const l of ["1동", "2동", "3동", "4동"]) db = createIntake(db, { siteId: "site-a", label: l }, ctx()).db;
    expect(() => createIntake(db, { siteId: "site-a", label: "5동" }, ctx())).toThrow(/5개/);
    expect(() => createIntake(db, { siteId: "site-b", label: "1동" }, ctx())).not.toThrow();
    const id = db.intakes!.find((i) => i.label === "1동")!.id;
    const closed = closeIntake(db, { intakeId: id }, ctx("u-ceo", days(1)));
    expect(closed.db.intakes!.find((i) => i.id === id)).toMatchObject({ closedAt: days(1).toISOString(), closedBy: "u-ceo" });
    expect(() => closeIntake(closed.db, { intakeId: id }, ctx())).toThrow(/이미 닫은/);
    expect(() => closeIntake(db, { intakeId: "nope" }, ctx())).toThrow(CommandError);
    // 다시 열기: 주소가 그대로 다시 통한다 · 열려 있는 것은 거부 · 그 사이 같은 이름을 새로 만들었거나 5개가 찼으면 거부
    const reopened = reopenIntakeLink(closed.db, { intakeId: id }, ctx());
    const back = reopened.db.intakes!.find((i) => i.id === id)!;
    expect(back.closedAt).toBeUndefined();
    expect(back.closedBy).toBeUndefined();
    expect(back.token).toBe(db.intakes!.find((i) => i.id === id)!.token);
    expect(() => reopenIntakeLink(db, { intakeId: id }, ctx())).toThrow(/이미 열려/);
    const again = createIntake(closed.db, { siteId: "site-a", label: "1동" }, ctx()).db;
    expect(() => reopenIntakeLink(again, { intakeId: id }, ctx())).toThrow(/5개|이미 열려/);
  });
});

describe("하자 접수 — 접수·진행·확인 (순수 로직)", () => {
  it("접수: 하자보수 요청 한 건 · 제목은 적은 내용의 앞부분 · 접수 번호(그날 회사 전체 순번) · 진행 확인 주소는 본사만 보게 저장 · 이력·알림에 이름·연락처·적은 글 없음", () => {
    const { db, req, no, statusToken, intakeId } = withRequest();
    expect(no).toBe("1112-1");
    expect(statusToken).toMatch(intake.INTAKE_STATUS_RE);
    expect(req).toMatchObject({ siteId: "site-a", partnerUserId: "", type: "defect", status: "received", title: "비가 오면 창틀 아래로 물이 샙니다.", location: "3층 302호 거실 창", statusKey: sha(statusToken), statusToken });
    expect(req.intakeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(req.intake).toEqual({ id: intakeId, no: "1112-1", org: "관리사무소", name: "홍길동", phone: "010-1234-5678", consentAt: NOW.toISOString() });
    expect(intake.intakeTitle("가".repeat(60), "x")).toBe(`${"가".repeat(39)}…`);
    expect(intake.intakeTitle("첫 줄\n둘째 줄", "x")).toBe("첫 줄");
    // 사진은 그 요청에 붙고 공개 사진이 아니다
    expect(req.photoIds).toHaveLength(1);
    expect(db.photos.find((p) => p.id === req.photoIds![0])).toMatchObject({ partnerRequestId: req.id, siteId: "site-a" });
    expect(db.photos.find((p) => p.id === req.photoIds![0])!.shared).toBeUndefined();
    expect(db.intakes![0]).toMatchObject({ count: 1, lastAt: NOW.toISOString() });
    // 활동 이력·휴대폰 알림에는 현장·접수 번호만 (접수자가 적은 글을 잠금 화면에 띄우지 않는다)
    expect(db.activityLogs[0]).toMatchObject({ by: "system", type: "partner", siteId: "site-a" });
    expect(db.activityLogs[0].summary).toBe("하자 접수(링크): A현장 — 접수 번호 1112-1");
    const before = withLink().db;
    const notices = noticesFor({ ...before, partnerRequests: db.partnerRequests.filter((r) => r.id !== req.id) }, db, "system");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: "하자 접수 (링크)", body: "A현장 · 접수 번호 1112-1", tag: `intake-${intakeId.slice(0, 12)}` });
    expect(JSON.stringify(notices)).not.toMatch(/홍길동|1234-5678|302호|물이 샙니다/);
    expect(notices[0].to.sort()).toEqual(["u-ceo", "u-manager"]);
    // 다음 접수는 다음 번호 (다른 현장이어도 겹치지 않는다) · 다음 날은 다시 1번
    const other = createIntake(db, { siteId: "site-b", label: "B동" }, ctx());
    const l2 = submitIntake(other.db, { ...FORM, intakeId: other.result.intakeId, idempotencyKey: K("k2") }, sys());
    expect(l2.result.no).toBe("1112-2");
    expect(submitIntake(l2.db, { ...FORM, intakeId, idempotencyKey: K("k3") }, sys(days(1))).result.no).toBe("1113-1");
  });

  it("접수 검증: 위치·내용·이름·전화·동의는 꼭 · 사진 3장까지·정말 사진인지·크기 · 닫힌 링크·없는 링크는 거부 · DB가 못 받는 글자는 걸러 낸다", () => {
    const { db, intakeId } = withLink();
    const fieldErrors = (input: Record<string, unknown>) => {
      try {
        submitIntake(db, { ...FORM, intakeId, idempotencyKey: K("x"), ...input } as never, sys());
      } catch (e) {
        return (e as InstanceType<typeof CommandError>).fieldErrors;
      }
      return {};
    };
    expect(Object.keys(fieldErrors({ location: " ", description: "", name: "", phone: "1234", consent: false })).sort()).toEqual(["consent", "description", "location", "name", "phone"]);
    expect(fieldErrors({ location: "가".repeat(61) })).toHaveProperty("location");
    expect(fieldErrors({ description: "가".repeat(801) })).toHaveProperty("description");
    expect(fieldErrors({ org: "가".repeat(41) })).toHaveProperty("org");
    expect(fieldErrors({ photoDataUrls: [JPG, JPG, JPG, JPG] })).toHaveProperty("photos");
    expect(fieldErrors({ photoDataUrls: ["data:text/html;base64,PHNjcmlwdD4="] })).toHaveProperty("photos");
    expect(fieldErrors({ photoDataUrls: ["/api/photos/other"] })).toHaveProperty("photos");
    // 사진이라 적었지만 사진이 아닌 것 (HTML·실행 파일) · 너무 큰 것
    expect(fieldErrors({ photoDataUrls: [`data:image/jpeg;base64,${Buffer.from("<!doctype html><script>alert(1)</script>").toString("base64")}`] })).toHaveProperty("photos");
    expect(fieldErrors({ photoDataUrls: [`data:image/png;base64,${Buffer.from("MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004").toString("base64")}`] })).toHaveProperty("photos");
    expect(fieldErrors({ photoDataUrls: [`${JPG.slice(0, -4)}${"A".repeat(intake.INTAKE_MAX_PHOTO_CHARS)}`] })).toHaveProperty("photos");
    expect(fieldErrors({ photoDataUrls: [JPG] })).toEqual({});
    expect(fieldErrors({ consent: "true" })).toHaveProperty("consent");
    // 같은 검사를 DB 없이 먼저 할 수 있다 (서버가 회사 데이터를 읽기 전에)
    expect(checkIntakeInput({ ...FORM, phone: "12" })).toMatchObject({ ok: false, errors: { phone: expect.any(String) } });
    expect(checkIntakeInput(null).ok).toBe(false);
    expect(checkIntakeInput({ ...FORM, phone: "+82 10 1234 5678" })).toMatchObject({ ok: true, value: { phone: "010-1234-5678" } });
    expect(() => submitIntake(db, { ...FORM, intakeId: "nope", idempotencyKey: K("x") }, sys())).toThrow(/접수할 수 없습니다/);
    const closed = closeIntake(db, { intakeId }, ctx()).db;
    expect(() => submitIntake(closed, { ...FORM, intakeId, idempotencyKey: K("x") }, sys())).toThrow(/접수할 수 없습니다/);
    // NUL·짝 없는 서로게이트 (jsonb가 받지 못해 저장할 때 서버 오류가 나던 글자)
    const odd = submitIntake(db, { ...FORM, intakeId, idempotencyKey: K("odd"), location: "3층\u0000 창", description: "물이\ud83d 샙니다 😀" }, sys());
    const r = odd.db.partnerRequests.find((x) => x.id === odd.result.requestId)!;
    expect(r.location).toBe("3층 창");
    expect(r.description).toBe("물이� 샙니다 😀");
    expect(cleanText("a\u0000b\udc00c")).toBe("ab�c");
    expect(cleanText("그대로")).toBe("그대로");
    // 사진 앞 바이트 검사
    expect(intake.photoLooksReal(JPG)).toBe(true);
    expect(intake.photoLooksReal("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")).toBe(true);
    expect(intake.photoLooksReal(`data:image/webp;base64,${Buffer.from("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ").toString("base64")}`)).toBe(true);
    expect(intake.photoLooksReal(`data:image/webp;base64,${Buffer.from("A".repeat(40)).toString("base64")}`)).toBe(false);
    expect(intake.photoLooksReal("data:image/png;base64,/9j/4AAQSkZJRgABAQ==")).toBe(false);
  });

  it("같은 접수를 다시 보냄(응답을 못 받고 다시 누름): 새로 만들지 않고 같은 접수 번호·같은 진행 확인 주소 · 그 난수를 모르면 만들 수 없다", () => {
    const { db, intakeId } = withLink();
    const first = submitIntake(db, { ...FORM, intakeId, idempotencyKey: K("same") }, sys());
    const again = submitIntake(first.db, { ...FORM, intakeId, idempotencyKey: K("same") }, sys(days(1)));
    expect(again.db).toBe(first.db);
    expect(again.result).toMatchObject({ requestId: first.result.requestId, no: first.result.no, statusToken: first.result.statusToken, again: true });
    expect(first.result.again).toBe(false);
    expect(first.result.statusToken).toMatch(intake.INTAKE_STATUS_RE);
    expect(first.result.statusToken).toMatch(/^[A-Za-z0-9].*[A-Za-z0-9]$/);
    // 직원용 중복 방지 목록은 쓰지 않는다 (장난 접수가 현장 직원의 재전송 번호를 밀어내지 않게)
    expect(first.db.idempotencyKeys).toEqual(db.idempotencyKeys);
    const other = submitIntake(first.db, { ...FORM, intakeId, idempotencyKey: K("other") }, sys());
    expect(other.result.statusToken).not.toBe(first.result.statusToken);
    expect(other.result.no).not.toBe(first.result.no);
    // 본사가 진행 확인 주소를 바꾼 뒤에 같은 접수가 또 오면 새로 만들지도, 새 주소를 내주지도 않는다
    const renewed = COMMANDS.renewIntakeStatus(first.db, { requestId: first.result.requestId }, ctx()).db;
    expect(() => submitIntake(renewed, { ...FORM, intakeId, idempotencyKey: K("same") }, sys())).toThrow(/이미 접수/);
    // 난수가 없거나 형식이 다르면(직접 호출) 매번 새 접수 · 새 난수 주소
    const s1 = submitIntake(db, { ...FORM, intakeId, idempotencyKey: "short" }, sys());
    const s2 = submitIntake(s1.db, { ...FORM, intakeId, idempotencyKey: "short" }, sys());
    expect(s2.result.requestId).not.toBe(s1.result.requestId);
    expect(s2.result.statusToken).not.toBe(s1.result.statusToken);
  });

  it("하루 한도: 링크 하나에 40건 · 한 곳에서 15건 (다른 곳은 그대로) · 다음 날 다시 · 한도에 닿으면 본사에 그날 한 번 알린다", () => {
    const { db, intakeId } = withLink();
    // 한 곳(같은 인터넷 주소)
    let cur = db;
    for (let i = 0; i < intake.INTAKE_SOURCE_DAILY_LIMIT; i++) cur = submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K(`s${i}`), source: "203.0.113.7" }, sys()).db;
    expect(() => submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K("s-over"), source: "203.0.113.7" }, sys())).toThrow(/이곳에서/);
    expect(() => submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K("s-other"), source: "203.0.113.8" }, sys())).not.toThrow();
    expect(() => submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K("s-next"), source: "203.0.113.7" }, sys(days(1)))).not.toThrow();
    // 접수한 곳의 주소는 저장하지 않는다 (그날·그 링크용 해시만)
    expect(JSON.stringify(cur)).not.toContain("203.0.113.7");
    expect(cur.partnerRequests[0].intakeSrc).toMatch(/^[0-9a-f]{16}$/);
    // 링크 하나
    for (let i = intake.INTAKE_SOURCE_DAILY_LIMIT; i < intake.INTAKE_DAILY_LIMIT; i++) cur = submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K(`d${i}`), source: `198.51.100.${i}` }, sys()).db;
    expect(intake.intakeFullToday(cur, intakeId, NOW.toISOString())).toBe(true);
    expect(() => submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K("over"), source: "198.51.100.200" }, sys())).toThrow(/전화로/);
    expect(() => submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K("tomorrow") }, sys(days(1)))).not.toThrow();
    // 한도 알림: 그날 한 번
    const noted = noteIntakeFull(cur, { intakeId }, sys());
    expect(noted.result.noted).toBe(true);
    expect(noted.db.intakes![0].fullOn).toBe("2026-11-12");
    expect(noted.db.activityLogs[0].summary).toContain("오늘 한도(40건)");
    const n = noticesFor(cur, noted.db, "system");
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("하자 접수 링크 한도 도달");
    expect(noteIntakeFull(noted.db, { intakeId }, sys()).db).toBe(noted.db);
    expect(noteIntakeFull(db, { intakeId }, sys()).result.noted).toBe(false);
  });

  it("진행 확인: 본인이 적은 내용·단계·회신·보수 사진만 — 접수자 이름·연락처, 담당자, 작업지시 번호, 내부 번호, 보낸 사진 원본 없음 · 보수 끝나고 회신 받은 뒤에만 확인", () => {
    let { db, req, statusToken } = withRequest();
    const v0 = viewOf(db, statusToken);
    expect(v0).toMatchObject({ no: "1112-1", step: 0, label: "접수", hint: "접수했습니다. 담당자가 내용을 확인하고 있습니다.", location: FORM.location, description: FORM.description, canConfirm: false, canReopen: false, sentPhotos: 1 });
    // 보낸 사진은 장수만 (원본을 이 주소로 다시 내주지 않는다)
    expect(v0.photos).toEqual([]);
    expect(JSON.stringify(v0)).not.toMatch(/홍길동|1234-5678|관리사무소|site-a|u-/);
    expect(JSON.stringify(v0)).not.toContain(req.photoIds![0]);
    expect(() => confirmIntake(db, { requestId: req.id }, sys())).toThrow(/보수가 끝난 뒤/);
    // 본사: 작업지시 → 현장 완료(사진) → 회신(보수 사진)
    const wo = COMMANDS.createWorkOrder(db, { siteId: "site-a", title: "하자보수 · 302호 창 누수", assigneeUserId: "u-field", dueDate: "2026-11-20", partnerRequestId: req.id, idempotencyKey: "wo1" }, ctx());
    db = wo.db;
    const v1 = viewOf(db, statusToken);
    expect(v1).toMatchObject({ step: 1, label: "보수 배정", hint: "보수할 담당자가 정해졌습니다.", dueDate: "2026-11-20", canConfirm: false });
    expect(JSON.stringify(v1)).not.toContain(wo.result.workOrderId);
    // 지난 목표일은 보여 주지 않는다 (지키지 못한 날짜를 약속처럼 띄우지 않는다)
    expect(viewOf(db, statusToken, "2026-11-21").dueDate).toBeUndefined();
    db = COMMANDS.workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "receive" }, ctx("u-field")).db;
    db = COMMANDS.workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "complete", note: "실리콘 재시공", photoDataUrls: [JPG] }, ctx("u-field")).db;
    // 현장이 끝냈다고 한 뒤에는 목표일을 보여 주지 않는다
    expect(viewOf(db, statusToken)).toMatchObject({ step: 2, label: "보수 중 · 마무리 확인 중" });
    expect(viewOf(db, statusToken).dueDate).toBeUndefined();
    const donePhoto = db.workOrders!.find((w) => w.id === wo.result.workOrderId)!.donePhotoIds![0];
    const answered = COMMANDS.updatePartnerRequest(db, { requestId: req.id, patch: { status: "answered", reply: "실리콘을 다시 시공했습니다. 살수 시험으로 누수 없음 확인.", sharePhotoIds: [donePhoto] } }, ctx());
    // 계정이 없는 접수에 회신해도 알림 받을 사람이 없을 뿐 오류가 아니다
    expect(noticesFor(db, answered.db, "u-manager")).toEqual([]);
    db = answered.db;
    const v2 = viewOf(db, statusToken);
    expect(v2).toMatchObject({ step: 3, label: "보수 완료", reply: "실리콘을 다시 시공했습니다. 살수 시험으로 누수 없음 확인.", canConfirm: true, canReopen: true });
    expect(v2.hint).toContain("확인해 주세요");
    expect(v2.photos).toEqual([{ id: donePhoto, kind: "repair" }]);
    expect(JSON.stringify(v2)).not.toMatch(/실리콘 재시공|u-field|홍길동/);
    // 확인 — 그 사이 주소가 바뀌었으면 거절 (잠금 안에서 다시 맞춰 본다)
    expect(() => confirmIntake(db, { requestId: req.id, statusKey: sha("x".repeat(32)) }, sys())).toThrow(/주소가 바뀌었습니다/);
    const done = confirmIntake(db, { requestId: req.id, statusKey: sha(statusToken), note: "잘 고쳐졌습니다" }, sys(days(1)));
    expect(done.db.partnerRequests.find((r) => r.id === req.id)).toMatchObject({ confirmedAt: days(1).toISOString(), confirmNote: "잘 고쳐졌습니다" });
    expect(viewOf(done.db, statusToken)).toMatchObject({ step: 4, label: "확인 완료", canConfirm: false, canReopen: false, confirmedAt: days(1).toISOString(), confirmNote: "잘 고쳐졌습니다" });
    expect(noticesFor(db, done.db, "system")[0]).toMatchObject({ title: "접수자 확인 완료", body: "A현장 · 접수 번호 1112-1" });
    expect(() => confirmIntake(done.db, { requestId: req.id }, sys())).toThrow(/이미 확인/);
    expect(() => confirmIntake(db, { requestId: req.id, note: "가".repeat(201) }, sys())).toThrow(/200자/);
    // 계정으로 들어온 요청은 이 길로 확인할 수 없다
    const normal = db.partnerRequests.find((r) => !r.intake && r.type === "defect")!;
    expect(() => confirmIntake(db, { requestId: normal.id }, sys())).toThrow(/찾을 수 없습니다/);
    // 본사 하자보수 현황: 사람 이름 대신 ‘링크 접수 · 접수 번호 · 소속’
    const row = defectRows(done.db, "2026-11-13").find((r) => r.req.id === req.id)!;
    expect(row.partnerName).toBe("링크 접수 1112-1 · 관리사무소");
    expect(row.next).toBe("closed");
  });

  it("보수 없이 답변으로 끝낸 건: ‘보수’라는 말을 쓰지 않고 단계도 따로 (접수 → 검토 → 답변 완료 → 확인 완료)", () => {
    const { db, req, statusToken } = withRequest();
    const answered = COMMANDS.updatePartnerRequest(db, { requestId: req.id, patch: { status: "answered", reply: "결로로 보입니다. 환기 방법을 안내드렸습니다.", closeWithoutRepair: true } }, ctx()).db;
    const v = viewOf(answered, statusToken);
    expect(v).toMatchObject({ noRepair: true, step: 2, label: "답변 완료", steps: ["접수", "검토", "답변 완료", "확인 완료"], canConfirm: true });
    expect(`${v.label}${v.hint}`).not.toContain("보수");
    const done = confirmIntake(answered, { requestId: req.id }, sys());
    expect(viewOf(done.db, statusToken)).toMatchObject({ noRepair: true, step: 3, label: "확인 완료" });
    // 일정만 안내한 답변(처리 끝이 아님)은 접수 단계에 머문다
    const sched = COMMANDS.updatePartnerRequest(db, { requestId: req.id, patch: { status: "answered", reply: "11/20에 방문하겠습니다." } }, ctx()).db;
    expect(viewOf(sched, statusToken)).toMatchObject({ step: 0, label: "접수 · 답변 받음", canConfirm: false });
    expect(viewOf(sched, statusToken).noRepair).toBeUndefined();
  });

  it("‘아직 문제가 있습니다’: 새 접수로 이어진다(앞 번호-2) · 진행 확인 주소는 그대로 새 접수를 보여 준다 · 답변 전·확인 뒤·내용 없이·여러 번은 거부 · 본사가 전화로 듣고 대신 등록", () => {
    const { db, req, statusToken } = withAnswered();
    expect(() => reopenIntake(withRequest().db, { requestId: withRequest().req.id, note: "아직 샙니다" }, sys())).toThrow(CommandError);
    expect(() => reopenIntake(db, { requestId: req.id, note: " " }, sys())).toThrow(/어떤 문제/);
    expect(() => reopenIntake(db, { requestId: req.id, note: "가".repeat(301) }, sys())).toThrow(/300자/);
    expect(() => reopenIntake(db, { requestId: req.id, statusKey: sha("y".repeat(32)), note: "아직 샙니다" }, sys())).toThrow(/주소가 바뀌었습니다/);
    const re = reopenIntake(db, { requestId: req.id, statusKey: sha(statusToken), note: "비가 오니 같은 자리에서 다시 샙니다." }, sys(days(3)));
    expect(re.result.no).toBe("1112-1-2");
    const next = re.db.partnerRequests.find((r) => r.id === re.result.requestId)!;
    const old = re.db.partnerRequests.find((r) => r.id === req.id)!;
    expect(next).toMatchObject({ reopenedFrom: req.id, status: "received", location: FORM.location, description: "비가 오니 같은 자리에서 다시 샙니다.", title: "비가 오니 같은 자리에서 다시 샙니다.", statusKey: sha(statusToken), statusToken });
    expect(next.intake).toMatchObject({ no: "1112-1-2", name: "홍길동", phone: "010-1234-5678", org: "관리사무소" });
    expect(old.statusKey).toBeUndefined();
    expect(old.statusToken).toBeUndefined();
    expect(old.history.at(-1)!.note).toContain("다시 접수 1112-1-2");
    // 접수 링크의 접수 건수·하루 한도에는 넣지 않는다
    expect(re.db.intakes![0].count).toBe(1);
    expect(intake.intakeCountToday(re.db, next.intake!.id, days(3).toISOString())).toBe(0);
    // 같은 주소가 새 접수를 보여 준다 (앞 번호·그때 받은 답변과 함께)
    const v = viewOf(re.db, statusToken);
    expect(v).toMatchObject({ no: "1112-1-2", step: 0, hint: "다시 접수되었습니다. 담당자가 다시 확인하고 있습니다.", prev: { no: "1112-1", reply: "실리콘을 다시 시공했습니다." }, sentPhotos: 0 });
    // 본사: 알림·하자보수 현황
    expect(noticesFor(db, re.db, "system")[0]).toMatchObject({ title: "하자 다시 접수 (아직 문제가 있음)", body: "A현장 · 접수 번호 1112-1-2" });
    const rows = defectRows(re.db, "2026-11-15");
    expect(rows.find((r) => r.req.id === req.id)!.next).toBe("reopened");
    expect(rows.find((r) => r.req.id === next.id)!.next).toBe("assign");
    // 이미 다시 접수된 건에 또 누를 수 없다
    expect(() => reopenIntake(re.db, { requestId: req.id, note: "또" + "!" }, sys())).toThrow(/이미 다시 접수/);
    // 세 번까지 — 넘으면 전화로
    let cur = re.db;
    let id = next.id;
    for (let round = 2; round <= intake.INTAKE_MAX_REOPEN + 1; round++) {
      cur = COMMANDS.updatePartnerRequest(cur, { requestId: id, patch: { status: "answered", reply: "다시 확인했습니다.", closeWithoutRepair: true } }, ctx()).db;
      if (round > intake.INTAKE_MAX_REOPEN) {
        expect(() => reopenIntake(cur, { requestId: id, note: "아직도 샙니다" }, sys())).toThrow(/전화로/);
        expect(viewOf(cur, statusToken)).toMatchObject({ canConfirm: true, canReopen: false });
        break;
      }
      const r = reopenIntake(cur, { requestId: id, note: "아직도 샙니다" }, sys());
      expect(r.result.no).toBe(`1112-1-${round + 1}`);
      cur = r.db;
      id = r.result.requestId;
    }
    // 접수자가 확인한 뒤에는 접수자는 못 누르지만, 전화로 알려 오면 본사가 대신 등록한다 (확인은 풀린다)
    const confirmed = confirmIntake(db, { requestId: req.id }, sys()).db;
    expect(() => reopenIntake(confirmed, { requestId: req.id, note: "다시 샙니다" }, sys())).toThrow(/새로 접수/);
    const byHq = reopenIntakeRequest(confirmed, { requestId: req.id, note: "전화: 다시 샌다고 함" }, ctx());
    expect(byHq.result.no).toBe("1112-1-2");
    expect(byHq.db.partnerRequests.find((r) => r.id === req.id)!.confirmedAt).toBeUndefined();
    expect(byHq.db.partnerRequests.find((r) => r.id === byHq.result.requestId)!.history[0].note).toContain("본사가 등록");
  });

  it("진행 확인 주소 바꾸기: 새 주소만 열리고 앞의 주소는 닫힌다 · 본사는 지금 주소를 다시 볼 수 있다 · 링크 접수가 아니면 거부", () => {
    const { db, req, statusToken } = withRequest();
    const r = renewIntakeStatus(db, { requestId: req.id }, ctx());
    expect(r.result.statusToken).toMatch(intake.INTAKE_STATUS_RE);
    expect(r.result.statusToken).not.toBe(statusToken);
    const after = r.db.partnerRequests.find((x) => x.id === req.id)!;
    expect(after.statusKey).toBe(sha(r.result.statusToken));
    expect(after.statusToken).toBe(r.result.statusToken);
    expect(JSON.stringify(r.db)).not.toContain(statusToken);
    const normal = db.partnerRequests.find((x) => !x.intake)!;
    expect(() => renewIntakeStatus(db, { requestId: normal.id }, ctx())).toThrow(CommandError);
  });

  it("버리기(장난·중복·잘못 접수): 접수와 사진을 지운다 — 건수·관리대장·보고서에 남지 않는다 · 작업지시를 보냈거나 확인한 건은 못 버린다 · 이력에는 번호·이유만", () => {
    const { db, req, intakeId } = withRequest();
    const second = submitIntake(db, { ...FORM, intakeId, idempotencyKey: K("junk"), location: "ㅁㄴㅇㄹ", description: "광고 문구", photoDataUrls: [JPG, JPG] }, sys());
    const junk = second.result.requestId;
    expect(second.db.photos.filter((p) => p.partnerRequestId === junk)).toHaveLength(2);
    expect(() => discardIntakeRequests(second.db, { requestIds: [], reason: "spam" }, ctx())).toThrow(CommandError);
    expect(() => discardIntakeRequests(second.db, { requestIds: [junk], reason: "기타" as never }, ctx())).toThrow(/이유/);
    expect(() => discardIntakeRequests(second.db, { requestIds: [second.db.partnerRequests.find((r) => !r.intake)!.id], reason: "spam" }, ctx())).toThrow(/링크·전화/);
    const out = discardIntakeRequests(second.db, { requestIds: [junk], reason: "spam" }, ctx());
    expect(out.result.discarded).toBe(1);
    expect(out.db.partnerRequests.some((r) => r.id === junk)).toBe(false);
    expect(out.db.photos.some((p) => p.partnerRequestId === junk)).toBe(false);
    expect(out.db.partnerRequests.some((r) => r.id === req.id)).toBe(true);
    expect(out.db.intakes![0]).toMatchObject({ count: 2, voided: 1 });
    expect(out.db.activityLogs[0].summary).toBe("하자 접수 1건 버림 (장난·광고) — 접수 번호 1112-2");
    expect(JSON.stringify(out.db.activityLogs)).not.toMatch(/ㅁㄴㅇㄹ|광고 문구/);
    expect(defectRows(out.db, "2026-11-12").some((r) => r.req.id === junk)).toBe(false);
    // 버린 번호는 다시 쓰지 않는다
    expect(submitIntake(out.db, { ...FORM, intakeId, idempotencyKey: K("after") }, sys()).result.no).toBe("1112-3");
    // 여러 건 한 번에
    const both = discardIntakeRequests(second.db, { requestIds: [junk, req.id], reason: "duplicate" }, ctx());
    expect(both.db.partnerRequests.some((r) => r.intake)).toBe(false);
    expect(both.db.photos.some((p) => p.partnerRequestId)).toBe(false);
    // 작업지시를 보낸 건·접수자가 확인한 건은 못 버린다
    const a = withAnswered();
    expect(() => discardIntakeRequests(a.db, { requestIds: [a.req.id], reason: "mistake" }, ctx())).toThrow(/작업지시/);
    const closed = COMMANDS.updatePartnerRequest(db, { requestId: req.id, patch: { status: "answered", reply: "하자가 아닙니다.", closeWithoutRepair: true } }, ctx()).db;
    expect(() => discardIntakeRequests(confirmIntake(closed, { requestId: req.id }, sys()).db, { requestIds: [req.id], reason: "mistake" }, ctx())).toThrow(/확인한/);
    // 다시 접수한 건을 버리면 진행 확인 주소는 앞 접수로 돌아간다 (접수자의 주소가 죽지 않게) · 앞 접수만 따로 버릴 수는 없다
    const re = reopenIntake(closed, { requestId: req.id, note: "장난으로 다시 누름" }, sys());
    expect(() => discardIntakeRequests(re.db, { requestIds: [req.id], reason: "spam" }, ctx())).toThrow(/다시 접수된 건/);
    const undone = discardIntakeRequests(re.db, { requestIds: [re.result.requestId], reason: "spam" }, ctx()).db;
    expect(undone.partnerRequests.find((r) => r.id === req.id)).toMatchObject({ statusKey: req.statusKey, statusToken: req.statusToken });
  });

  it("전화로 받은 하자 등록(본사): 같은 목록·같은 번호 체계 · 진행 확인 주소를 문자로 보낼 수 있다 · 이름·전화는 동의를 받았을 때만", () => {
    const db = withRequest().db;
    const out = registerPhoneDefect(db, { siteId: "site-a", location: "1층 로비 출입문", description: "문이 잘 닫히지 않습니다.", name: "김관리", phone: "02-123-4567", org: "관리사무소", consent: true, idempotencyKey: "ph-1" }, ctx());
    expect(out.result.no).toBe("1112-2");
    const r = out.db.partnerRequests.find((x) => x.id === out.result.requestId)!;
    expect(r).toMatchObject({ type: "defect", partnerUserId: "", status: "received", title: "문이 잘 닫히지 않습니다.", location: "1층 로비 출입문" });
    expect(r.intake).toMatchObject({ id: "phone", no: "1112-2", name: "김관리", phone: "02-123-4567" });
    expect(r.statusToken).toMatch(intake.INTAKE_STATUS_RE);
    expect(r.statusKey).toBe(sha(r.statusToken!));
    expect(r.history[0]).toMatchObject({ by: "u-manager", note: "전화 접수 (본사 등록)" });
    expect(out.db.activityLogs[0].summary).toBe("하자 접수(전화): A현장 — 접수 번호 1112-2");
    expect(defectRows(out.db, "2026-11-12").find((x) => x.req.id === r.id)!.partnerName).toBe("전화 접수 1112-2 · 관리사무소");
    // 접수 링크의 건수·한도와는 따로
    expect(out.db.intakes![0].count).toBe(1);
    expect(() => registerPhoneDefect(out.db, { siteId: "site-a", location: "1층 로비 출입문", description: "문이 잘 닫히지 않습니다.", idempotencyKey: "ph-1" }, ctx())).toThrow(/이미 저장된/);
    expect(() => registerPhoneDefect(db, { siteId: "site-a", location: "x", description: "y", name: "김관리", phone: "02-123-4567" }, ctx())).toThrow(CommandError);
    expect(() => registerPhoneDefect(db, { siteId: "site-a", location: "", description: "" }, ctx())).toThrow(CommandError);
    expect(() => registerPhoneDefect(db, { siteId: "site-a", location: "x", description: "y", phone: "12", consent: true }, ctx())).toThrow(CommandError);
    // 연락처 없이도 등록된다
    const bare = registerPhoneDefect(db, { siteId: "site-a", location: "옥상", description: "실리콘이 떨어졌습니다." }, ctx());
    expect(bare.db.partnerRequests.find((x) => x.id === bare.result.requestId)!.intake).toEqual({ id: "phone", no: "1112-2", consentAt: NOW.toISOString() });
    // 버릴 수 있다
    expect(discardIntakeRequests(out.db, { requestIds: [r.id], reason: "mistake" }, ctx()).db.partnerRequests.some((x) => x.id === r.id)).toBe(false);
  });

  it("연락처 보관: 처리가 끝난 날부터 90일 뒤에 지운다 (일정만 안내한 회신은 끝이 아니다) · 끝내지 않은 접수도 180일이면 지운다 · 소속·접수 번호·내용은 남김", () => {
    const { db, req } = withRequest();
    // 처리 중: 180일 전까지 그대로, 지나면 지운다 (잊힌 접수에 남의 번호가 남지 않게)
    expect(applyIntakeRetention(db, days(intake.INTAKE_OPEN_KEEP_DAYS - 1))).toBe(db);
    expect(applyIntakeRetention(db, days(intake.INTAKE_OPEN_KEEP_DAYS + 1)).partnerRequests.find((x) => x.id === req.id)!.intake!.name).toBeUndefined();
    // 일정만 안내한 회신: 90일이 지나도 그대로 (보수 전에 연락처가 지워지지 않게)
    const sched = COMMANDS.updatePartnerRequest(db, { requestId: req.id, patch: { status: "answered", reply: "내년 3월에 재시공하겠습니다." } }, ctx()).db;
    expect(applyIntakeRetention(sched, days(intake.INTAKE_CONTACT_KEEP_DAYS + 30))).toBe(sched);
    // ‘처리 끝’으로 회신: 그날부터 90일
    const answered = COMMANDS.updatePartnerRequest(db, { requestId: req.id, patch: { status: "answered", reply: "전화로 안내드렸습니다.", closeWithoutRepair: true } }, ctx()).db;
    expect(applyIntakeRetention(answered, days(intake.INTAKE_CONTACT_KEEP_DAYS - 1))).toBe(answered);
    const purged = applyIntakeRetention(answered, days(intake.INTAKE_CONTACT_KEEP_DAYS + 1));
    const r = purged.partnerRequests.find((x) => x.id === req.id)!;
    expect(r.intake).toEqual({ id: req.intake!.id, no: "1112-1", org: "관리사무소", consentAt: NOW.toISOString(), purgedAt: days(intake.INTAKE_CONTACT_KEEP_DAYS + 1).toISOString() });
    expect(JSON.stringify(purged.partnerRequests)).not.toMatch(/홍길동|1234-5678/);
    expect(r.location).toBe(FORM.location);
    expect(intake.intakeContactLabel(r)).toBe("관리사무소");
    // 한 번 지운 뒤에는 다시 건드리지 않는다
    expect(applyIntakeRetention(purged, days(500))).toBe(purged);
    // 보수까지 끝난 건: 보수가 끝난 날(회신) 기준 — 작업지시만 보내고 끝나지 않았으면 그대로
    const a = withAnswered();
    expect(intake.intakeFinishedAt(a.db.partnerRequests.find((x) => x.id === a.req.id)!, a.db.workOrders ?? [])).toBe(NOW.toISOString());
    expect(applyIntakeRetention(a.db, days(intake.INTAKE_CONTACT_KEEP_DAYS + 1)).partnerRequests.find((x) => x.id === a.req.id)!.intake!.phone).toBeUndefined();
    const assigned = COMMANDS.createWorkOrder(db, { siteId: "site-a", title: "하자보수 · 창", assigneeUserId: "u-field", partnerRequestId: req.id, idempotencyKey: "wo-r" }, ctx()).db;
    expect(applyIntakeRetention(assigned, days(intake.INTAKE_CONTACT_KEEP_DAYS + 30))).toBe(assigned);
  });

  it("권한·보기: 본사 명령은 본사만 · 접수자 이름·연락처·진행 확인 주소·접수 링크는 본사만 받고, 주소 해시·내부 표시는 아무도 받지 않는다 · 접수 사진은 작업지시에 붙은 뒤에만 현장에", () => {
    const { db, req, intakeId } = withRequest();
    const FIELD = member("u-field", "field", { siteIds: ["site-a"] });
    const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });
    for (const m of [FIELD, PARTNER]) {
      for (const [name, args] of [
        ["createIntake", { siteId: "site-a" }],
        ["closeIntake", { intakeId }],
        ["reopenIntakeLink", { intakeId }],
        ["renewIntakeStatus", { requestId: req.id }],
        ["discardIntakeRequests", { requestIds: [req.id], reason: "spam" }],
        ["registerPhoneDefect", { siteId: "site-a", location: "x", description: "y" }],
        ["reopenIntakeRequest", { requestId: req.id, note: "다시" }],
      ] as const)
        expect(() => authorize(m, name, args, db, NOW)).toThrow(ForbiddenError);
      const v = viewFor(m, db, NOW);
      expect(v.intakes).toEqual([]);
      expect(v.partnerRequests.some((r) => r.intake)).toBe(false);
      expect(JSON.stringify(v)).not.toMatch(/홍길동|1234-5678/);
      for (const secret of [req.statusKey!, req.statusToken!, req.intakeKey!]) expect(JSON.stringify(v)).not.toContain(secret);
      // 본사가 보기 전의 접수 사진은 현장 휴대폰에도, 발주처 계정에도 가지 않는다
      expect(v.photos.some((p) => p.id === req.photoIds![0])).toBe(false);
    }
    for (const m of [member("u-ceo", "ceo"), member("u-manager", "manager")]) {
      expect(() => authorize(m, "createIntake", { siteId: "site-a" }, db, NOW)).not.toThrow();
      expect(() => authorize(m, "discardIntakeRequests", { requestIds: [req.id], reason: "spam" }, db, NOW)).not.toThrow();
      const v = viewFor(m, db, NOW);
      expect(v.intakes).toHaveLength(1);
      expect(v.intakes![0].token).toMatch(intake.INTAKE_TOKEN_RE);
      const r = v.partnerRequests.find((x) => x.id === req.id)!;
      expect(r.intake).toMatchObject({ name: "홍길동", phone: "010-1234-5678" });
      expect(r.statusToken).toBe(req.statusToken);
      for (const k of ["statusKey", "intakeKey", "intakeSrc"]) expect(k in r).toBe(false);
    }
    // 작업지시를 보내면 그 작업지시를 받은 현장 직원에게 접수 사진이 간다 · 연락처는 본사가 ‘보여 주기’를 골랐을 때만, 본사가 완료를 확인하기 전까지만
    const plain = COMMANDS.createWorkOrder(db, { siteId: "site-a", title: "하자보수 · 창", assigneeUserId: "u-field", partnerRequestId: req.id, idempotencyKey: "wo-p" }, ctx());
    const pv = viewFor(FIELD, plain.db, NOW);
    expect(pv.photos.some((p) => p.id === req.photoIds![0])).toBe(true);
    expect(pv.workOrders!.find((w) => w.id === plain.result.workOrderId)!.contactView).toBeUndefined();
    expect(JSON.stringify(pv)).not.toMatch(/홍길동|1234-5678/);
    const shown = COMMANDS.createWorkOrder(db, { siteId: "site-a", title: "하자보수 · 창", assigneeUserId: "u-field", partnerRequestId: req.id, showContact: true, idempotencyKey: "wo-s" }, ctx());
    const sv = viewFor(FIELD, shown.db, NOW);
    expect(sv.workOrders!.find((w) => w.id === shown.result.workOrderId)!.contactView).toEqual({ who: "관리사무소 홍길동", phone: "010-1234-5678" });
    expect(sv.partnerRequests).toEqual([]);
    // 다른 현장 직원(작업지시를 받지 않은 사람)에게는 가지 않는다
    expect(JSON.stringify(viewFor(member("u-field2", "field", { siteIds: ["site-a"] }), shown.db, NOW))).not.toMatch(/홍길동|1234-5678/);
    // 본사가 완료를 확인하면 더 보내지 않는다
    let done = COMMANDS.workOrderStep(shown.db, { workOrderId: shown.result.workOrderId, action: "complete", note: "끝" }, ctx("u-field")).db;
    done = COMMANDS.reviewWorkOrder(done, { workOrderId: shown.result.workOrderId, decision: "confirm" }, ctx()).db;
    expect(JSON.stringify(viewFor(FIELD, done, NOW))).not.toMatch(/홍길동|1234-5678/);
    // 계정으로 들어온 요청의 작업지시에는 연락처 표시가 붙지 않는다
    const normal = db.partnerRequests.find((r) => !r.intake && r.type === "defect" && !r.linkedWorkOrderId && !r.confirmedAt && !r.closedWithoutRepair);
    if (normal) expect(COMMANDS.createWorkOrder(db, { siteId: normal.siteId, title: "하자보수", assigneeUserId: "u-field", partnerRequestId: normal.id, showContact: true, idempotencyKey: "wo-n" }, ctx()).db.workOrders!.at(-1)!.showContact).toBeUndefined();
  });

  it("발주처에 나가는 문서: 링크 접수는 본사가 손댄 뒤에만, 건수로만 — 목록·접수자가 적은 글은 넣지 않는다 (월간·준공·보고서 링크가 같은 규칙)", () => {
    const { db, req } = withRequest();
    const defects = (d: DemoDB) => partnerMonthly(d, "site-a", "2026-11", [], "u-partner", "2026-11-12");
    const base = defects(createSeed(NOW));
    // 손대기 전: 세지 않는다 (장난 접수가 그대로 발주처 보고서 건수가 되지 않게)
    expect(defects(db).counts).toEqual(base.counts);
    expect(completionReport(db, "site-a", "2026-11-12")!.defects).toEqual(completionReport(createSeed(NOW), "site-a", "2026-11-12")!.defects);
    // 작업지시를 보낸 뒤: 건수에만
    const triaged = COMMANDS.createWorkOrder(db, { siteId: "site-a", title: "하자보수 · 창", assigneeUserId: "u-field", partnerRequestId: req.id, idempotencyKey: "wo-m" }, ctx()).db;
    const m = defects(triaged);
    expect(m.counts.defects).toBe(base.counts.defects + 1);
    expect(m.counts.viaIntake).toBe(1);
    expect(m.requests.some((r) => r.intake)).toBe(false);
    expect(JSON.stringify(m.requests)).not.toMatch(/302호|물이 샙니다/);
    // 발주처 계정이 없는 현장의 본사 미리보기에도 목록에는 없다
    expect(partnerMonthly(triaged, "site-a", "2026-11", [], undefined, "2026-11-12").requests.some((r) => r.intake)).toBe(false);
    // 보고서 링크(월간·준공)에는 건수만 — 접수자·접수 내용 없음
    for (const kind of ["monthly", "completion"] as const) {
      const snap = JSON.stringify(createShare(triaged, { kind, siteId: "site-a" }, ctx()).db.shares![0].snapshot);
      expect(snap).not.toMatch(/홍길동|1234-5678|302호|물이 샙니다/);
    }
  });

  it("회사 전화번호(접수 화면·안내문에 보일 번호): 운영 설정으로 넣고 지운다 · 형식이 틀리면 거부 · 접수 번호 일련번호는 설정으로 못 바꾼다", () => {
    const db = createSeed(NOW);
    const set = COMMANDS.setCompanySettings(db, { publicPhone: "031 123 4567" }, ctx("u-ceo")).db;
    expect(set.settings!.publicPhone).toBe("031-123-4567");
    expect(COMMANDS.setCompanySettings(set, { publicPhone: "1588-1234" }, ctx("u-ceo")).db.settings!.publicPhone).toBe("1588-1234");
    // 다른 설정을 바꿔도 그대로 · 비우면 지움
    expect(COMMANDS.setCompanySettings(set, { laborDayRate: 310_000 }, ctx("u-ceo")).db.settings!.publicPhone).toBe("031-123-4567");
    expect(COMMANDS.setCompanySettings(set, { publicPhone: "" }, ctx("u-ceo")).db.settings!.publicPhone).toBeUndefined();
    expect(() => COMMANDS.setCompanySettings(db, { publicPhone: "1234" }, ctx("u-ceo"))).toThrow(CommandError);
    expect(() => COMMANDS.setCompanySettings(db, { intakeSeq: { day: "2026-11-12", n: 0 } }, ctx("u-ceo"))).toThrow(CommandError);
    // 접수가 들어온 뒤 설정을 바꿔도 일련번호가 이어진다
    const w = withRequest();
    const after = COMMANDS.setCompanySettings(w.db, { publicPhone: "02-123-4567" }, ctx("u-ceo")).db;
    expect(submitIntake(after, { ...FORM, intakeId: w.intakeId, idempotencyKey: K("seq") }, sys()).result.no).toBe("1112-2");
  });
});

// ───────────────────────── 서버 ─────────────────────────

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;
const PW = "Taekang2026!";
let ceo: Member;
let manager: Member;
let field: Member;
let partner: Member;
const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag: string } }[] = [];
let token = "";
let intakeId = "";
let statusToken = "";
let requestId = "";
let sentPhoto = "";
let donePhoto = "";

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
const reqOf = async (m: Member = ceo): Promise<PartnerRequest | undefined> => (await svc.getView(m)).db.partnerRequests.find((r) => r.id === requestId);
const http = (path: string, init: { method?: string; ip?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { "x-forwarded-for": init.ip ?? "203.0.113.20", ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
const rand = (bytes: number) => intake.newToken((n) => new Uint8Array(nodeRandom(n)), bytes);

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  push.setPushSender(null);
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

beforeAll(async () => {
  await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@d74.test", password: PW, withDemoData: true });
  ceo = await loginAs("ceo@d74.test");
  manager = await loginAs("manager@demo.local");
  field = await loginAs("field@demo.local");
  partner = await loginAs("partner@demo.local");
  push.setPushSender(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201 };
  });
  for (const m of [ceo, manager]) await push.saveSubscription(m, fakeSub());
  const made = await svc.executeCommand(manager, "createIntake", { siteId: "site-a", label: "관리사무소용" });
  ({ token, intakeId } = made.result as { token: string; intakeId: string });
});

describe("하자 접수 — 서버 (실제 Postgres 엔진)", () => {
  it("색인이 있다 (접수 주소·진행 확인 주소로 바로 찾는다)", async () => {
    const db = await getDb();
    const idx = await db.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'records' and indexname in ('records_intake_id', 'records_request_status_key') order by indexname`);
    expect(idx.map((r) => r.indexname)).toEqual(["records_intake_id", "records_request_status_key"]);
  });

  it("접수 화면: 열린 주소면 회사·건물 이름(본사가 넣었으면 회사 전화번호)만 · 틀린 주소·형식이 다른 값·링크 번호(해시)로는 열리지 않는다", async () => {
    const r = await intakeSvc.openIntake(token);
    expect(r).toEqual({ ok: true, companyId: ceo.companyId, view: { company: "(주)태강지엘텍", siteName: expect.stringContaining("가상 현장 A"), sample: true } });
    for (const bad of [rand(16), "", "short", `${token}x`, intakeId, intakeId.slice(0, 22), null, 42, "../../etc/passwd"]) expect(await intakeSvc.openIntake(bad)).toEqual({ ok: false, reason: "notfound" });
    // 회사 전화번호를 넣으면 접수 화면에 나온다 · 링크에 건물 이름을 따로 적었으면 그 이름으로
    await svc.executeCommand(ceo, "setCompanySettings", { publicPhone: "031-123-4567" });
    expect(await intakeSvc.openIntake(token)).toMatchObject({ ok: true, view: { phone: "031-123-4567" } });
    const named = await svc.executeCommand(ceo, "createIntake", { siteId: "site-c", label: "건물 이름", place: "○○빌딩" });
    expect(await intakeSvc.openIntake((named.result as { token: string }).token)).toMatchObject({ ok: true, view: { siteName: "○○빌딩" } });
  });

  it("주소로 접수 → 본사에만 알림(현장·접수 번호만) · 본사 화면에만 접수자·진행 확인 주소 · 현장·발주처 계정에는 가지 않는다 · 백업에는 주소가 없다", async () => {
    sent.length = 0;
    const out = await intakeSvc.submitIntakeByToken(token, { ...FORM, idempotencyKey: K("srv-1"), photoDataUrls: [JPG] }, "203.0.113.20");
    expect(out!.no).toMatch(/^\d{4}-1$/);
    statusToken = out!.statusToken;
    const all = (await svc.getView(ceo)).db.partnerRequests.filter((r) => r.intake);
    expect(all).toHaveLength(1);
    requestId = all[0].id;
    sentPhoto = all[0].photoIds![0];
    expect(all[0].intake).toMatchObject({ id: intakeId, name: "홍길동", phone: "010-1234-5678", org: "관리사무소" });
    expect(all[0].statusToken).toBe(statusToken);
    for (const k of ["statusKey", "intakeKey", "intakeSrc"]) expect(k in all[0]).toBe(false);
    expect((await svc.getView(ceo)).db.intakes!.find((i) => i.id === intakeId)).toMatchObject({ count: 1, token });
    // 사진은 사진 저장소로 (주소만 기록)
    expect((await svc.getView(ceo)).db.photos.find((p) => p.id === sentPhoto)!.dataUrl).toBe(`/api/photos/${sentPhoto}`);
    // 알림: 대표·공무 2대, 현장·접수 번호만 (접수자가 적은 글·이름·연락처 없음)
    expect(sent).toHaveLength(2);
    expect(sent[0].payload).toMatchObject({ title: "하자 접수 (링크)", body: expect.stringMatching(/^A현장 · 접수 번호 \d{4}-1$/) });
    expect(JSON.stringify(sent)).not.toMatch(/홍길동|1234-5678|302호|물이 샙니다/);
    // 현장 직원·발주처 계정: 접수·접수자·진행 확인 주소·접수 사진 모두 없다
    for (const m of [field, partner]) {
      const v = (await svc.getView(m)).db;
      expect(v.partnerRequests.some((r) => r.intake)).toBe(false);
      expect(v.intakes).toEqual([]);
      expect(JSON.stringify(v)).not.toMatch(/홍길동|1234-5678/);
      expect(JSON.stringify(v)).not.toContain(statusToken);
      expect(v.photos.some((p) => p.id === sentPhoto)).toBe(false);
      expect(await svc.getPhoto(m, sentPhoto)).toBeNull();
    }
    expect((await svc.getPhoto(ceo, sentPhoto))?.mime).toBe("image/jpeg");
    await expect(svc.executeCommand(field, "createIntake", { siteId: "site-a" })).rejects.toThrow(ForbiddenError);
    await expect(svc.executeCommand(partner, "renewIntakeStatus", { requestId })).rejects.toThrow(ForbiddenError);
    await expect(svc.executeCommand(field, "discardIntakeRequests", { requestIds: [requestId], reason: "spam" })).rejects.toThrow(ForbiddenError);
    // 접수한 곳의 주소는 DB에 없다
    const db = await getDb();
    expect((await db.query<{ n: number }>(`select count(*)::int as n from records where data::text like '%203.0.113.20%'`))[0].n).toBe(0);
    // 백업: 진행 확인 주소(비밀값·해시)·내부 표시는 넣지 않는다 (백업 파일로 진행 확인 화면을 열 수 없게) · 대표만
    const backup = (await svc.exportCompany(ceo)).body;
    expect(backup).not.toContain(statusToken);
    expect(backup).not.toMatch(/"statusKey"|"statusToken"|"intakeKey"|"intakeSrc"/);
    expect(backup).toContain("010-1234-5678");
    await expect(svc.exportCompany(manager)).rejects.toThrow(ForbiddenError);
    // 틀린 주소로는 접수되지 않는다
    expect(await intakeSvc.submitIntakeByToken(rand(16), { ...FORM, idempotencyKey: K("srv-x") })).toBeNull();
  });

  it("진행 확인: 받은 주소로만 · 그 접수 한 건만 · 접수자가 올린 사진은 이 주소로 다시 내주지 않는다", async () => {
    const v = await intakeSvc.intakeStatus(statusToken);
    expect(v).toMatchObject({ company: "(주)태강지엘텍", phone: "031-123-4567", step: 0, label: "접수", location: FORM.location, canConfirm: false, sentPhotos: 1, photos: [], sample: true });
    expect(JSON.stringify(v)).not.toMatch(/홍길동|1234-5678|관리사무소/);
    expect(JSON.stringify(v)).not.toContain(sentPhoto);
    for (const bad of [rand(24), token, requestId, "", null]) expect(await intakeSvc.intakeStatus(bad)).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(statusToken, sentPhoto)).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(statusToken, "a/../b")).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(rand(24), sentPhoto)).toBeNull();
  });

  it("본사 작업지시(연락처 보여 주기) → 현장 완료 → 회신(보수 사진) → 접수자 확인: 진행 확인 화면이 따라 바뀌고, 확인은 한 번만", async () => {
    await expect(intakeSvc.confirmIntakeByKey(statusToken, "")).rejects.toThrow(/보수가 끝난 뒤/);
    const wo = await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-a", title: "하자보수 · 302호 창 누수", assigneeUserId: field.id, dueDate: "2099-01-05", partnerRequestId: requestId, showContact: true, idempotencyKey: "srv-wo" });
    const woId = (wo.result as { workOrderId: string }).workOrderId;
    expect(await intakeSvc.intakeStatus(statusToken)).toMatchObject({ step: 1, label: "보수 배정", dueDate: "2099-01-05" });
    // 작업지시를 받은 현장 직원: 접수 사진과 (본사가 고른 경우) 방문 전 연락처 — 요청 자체·진행 확인 주소는 없다
    const fv = (await svc.getView(field)).db;
    expect(fv.workOrders!.find((w) => w.id === woId)!.contactView).toEqual({ who: "관리사무소 홍길동", phone: "010-1234-5678" });
    expect(fv.photos.some((p) => p.id === sentPhoto)).toBe(true);
    expect((await svc.getPhoto(field, sentPhoto))?.mime).toBe("image/jpeg");
    expect(fv.partnerRequests).toEqual([]);
    expect(JSON.stringify(fv)).not.toContain(statusToken);
    await svc.executeCommand(field, "workOrderStep", { workOrderId: woId, action: "receive" });
    await svc.executeCommand(field, "workOrderStep", { workOrderId: woId, action: "complete", note: "실리콘 재시공", photoDataUrls: [JPG] });
    donePhoto = (await svc.getView(ceo)).db.workOrders!.find((w) => w.id === woId)!.donePhotoIds![0];
    // 회신 전에는 보수 사진을 받을 수 없다
    expect(await intakeSvc.intakePhotoAccess(statusToken, donePhoto)).toBeNull();
    sent.length = 0;
    await svc.executeCommand(manager, "updatePartnerRequest", { requestId, patch: { status: "answered", reply: "실리콘을 다시 시공했습니다.", sharePhotoIds: [donePhoto] } });
    const v = await intakeSvc.intakeStatus(statusToken);
    expect(v).toMatchObject({ step: 3, label: "보수 완료", reply: "실리콘을 다시 시공했습니다.", canConfirm: true, canReopen: true });
    expect(v!.photos).toEqual([{ id: donePhoto, kind: "repair" }]);
    expect(await intakeSvc.intakePhotoAccess(statusToken, donePhoto)).toEqual({ companyId: ceo.companyId });
    expect((await intakeSvc.intakePhotoBlob(ceo.companyId, donePhoto))?.mime).toBe("image/jpeg");
    // 본사가 작업지시를 확인하면 현장 휴대폰에 연락처를 더 보내지 않는다
    await svc.executeCommand(manager, "reviewWorkOrder", { workOrderId: woId, decision: "confirm" });
    expect(JSON.stringify((await svc.getView(field)).db)).not.toMatch(/홍길동|1234-5678/);
    // 접수자 확인 → 본사에 알림
    sent.length = 0;
    const done = await intakeSvc.confirmIntakeByKey(statusToken, "잘 고쳐졌습니다");
    expect(done!.confirmedAt).toBeTruthy();
    expect(await reqOf()).toMatchObject({ confirmNote: "잘 고쳐졌습니다" });
    expect(sent.map((x) => x.payload.title)).toEqual(["접수자 확인 완료", "접수자 확인 완료"]);
    await expect(intakeSvc.confirmIntakeByKey(statusToken, "")).rejects.toThrow(/이미 확인/);
    expect(await intakeSvc.confirmIntakeByKey(rand(24), "")).toBeNull();
    expect(await intakeSvc.intakeStatus(statusToken)).toMatchObject({ step: 4, label: "확인 완료", canConfirm: false, confirmNote: "잘 고쳐졌습니다" });
  });

  it("‘아직 문제가 있습니다’(주소로): 같은 주소가 새 접수를 보여 준다 · 본사에 알림 · 버리면 주소는 앞 접수로 돌아가고 사진 원본까지 지운다", async () => {
    const out = await intakeSvc.submitIntakeByToken(token, { ...FORM, location: "2층 복도 창", description: "창이 끝까지 닫히지 않습니다.", idempotencyKey: K("srv-re"), photoDataUrls: [JPG] }, "203.0.113.21");
    const key = out!.statusToken;
    const first = (await svc.getView(ceo)).db.partnerRequests.find((r) => r.statusToken === key)!;
    await expect(intakeSvc.reopenIntakeByKey(key, "아직 안 닫힙니다")).rejects.toThrow(/답변을 받은 뒤/);
    await svc.executeCommand(manager, "updatePartnerRequest", { requestId: first.id, patch: { status: "answered", reply: "레일을 조정했습니다.", closeWithoutRepair: true } });
    expect(await intakeSvc.intakeStatus(key)).toMatchObject({ noRepair: true, label: "답변 완료", canConfirm: true, canReopen: true });
    sent.length = 0;
    const re = await intakeSvc.reopenIntakeByKey(key, "아직 안 닫힙니다");
    expect(re!.no).toBe(`${out!.no}-2`);
    expect(sent.map((x) => x.payload.title)).toEqual(["하자 다시 접수 (아직 문제가 있음)", "하자 다시 접수 (아직 문제가 있음)"]);
    expect(await intakeSvc.intakeStatus(key)).toMatchObject({ no: `${out!.no}-2`, step: 0, description: "아직 안 닫힙니다", prev: { no: out!.no, reply: "레일을 조정했습니다." } });
    await expect(intakeSvc.reopenIntakeByKey(key, "또")).rejects.toThrow(CommandError);
    expect(await intakeSvc.reopenIntakeByKey(rand(24), "아직 안 닫힙니다")).toBeNull();
    const v = (await svc.getView(ceo)).db;
    const child = v.partnerRequests.find((r) => r.reopenedFrom === first.id)!;
    expect(child.statusToken).toBe(key);
    expect(v.partnerRequests.find((r) => r.id === first.id)!.statusToken).toBeUndefined();
    // 다시 접수한 건을 버린다 → 주소는 앞 접수(답변 받은 상태)로 돌아간다
    await svc.executeCommand(manager, "discardIntakeRequests", { requestIds: [child.id], reason: "spam" });
    expect(await intakeSvc.intakeStatus(key)).toMatchObject({ no: out!.no, label: "답변 완료" });
    // 앞 접수까지 버린다 → 주소는 열리지 않고, 사진 기록과 원본이 DB에서 지워진다
    const photoId = first.photoIds![0];
    const db = await getDb();
    const blobs = async () => (await db.query<{ n: number }>(`select count(*)::int as n from photo_blobs where id = $1`, [photoId]))[0].n;
    expect(await blobs()).toBe(1);
    const out2 = await svc.executeCommand(ceo, "discardIntakeRequests", { requestIds: [first.id], reason: "duplicate" });
    expect(out2.result).toEqual({ discarded: 1 });
    expect(await intakeSvc.intakeStatus(key)).toBeNull();
    expect(await blobs()).toBe(0);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from records where id = $1`, [photoId]))[0].n).toBe(0);
    expect((await svc.getView(ceo)).db.intakes!.find((i) => i.id === intakeId)).toMatchObject({ count: 2, voided: 2 });
  });

  it("진행 확인 주소 바꾸기: 앞의 주소는 닫히고 새 주소만 열린다 · 본사 화면에 새 주소가 보인다", async () => {
    const r = await svc.executeCommand(ceo, "renewIntakeStatus", { requestId });
    const next = (r.result as { statusToken: string }).statusToken;
    expect(await intakeSvc.intakeStatus(statusToken)).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(statusToken, donePhoto)).toBeNull();
    expect(await intakeSvc.intakeStatus(next)).toMatchObject({ step: 4 });
    expect((await reqOf())!.statusToken).toBe(next);
    statusToken = next;
  });

  it("전화로 받은 하자(본사 등록): 진행 확인 주소가 열린다 · 현장·발주처는 등록할 수 없다", async () => {
    const out = await svc.executeCommand(manager, "registerPhoneDefect", { siteId: "site-a", location: "1층 로비 출입문", description: "문이 잘 닫히지 않습니다.", name: "김관리", phone: "02-123-4567", consent: true, idempotencyKey: "srv-phone" });
    const r = (await svc.getView(ceo)).db.partnerRequests.find((x) => x.id === (out.result as { requestId: string }).requestId)!;
    expect(r.intake).toMatchObject({ id: "phone", name: "김관리" });
    expect(await intakeSvc.intakeStatus(r.statusToken)).toMatchObject({ no: r.intake!.no, step: 0, sentPhotos: 0 });
    await expect(svc.executeCommand(field, "registerPhoneDefect", { siteId: "site-a", location: "x", description: "y" })).rejects.toThrow(ForbiddenError);
    await expect(svc.executeCommand(partner, "reopenIntakeRequest", { requestId: r.id, note: "다시" })).rejects.toThrow(ForbiddenError);
  });

  it("API: 화면 200(저장 금지·검색 금지 머리말) · 접수 200 · 틀린 입력 400(칸별 이유) · 자동으로 채워진 칸은 거부 · 없는 주소 404 · 다른 사이트 요청 403 · 보수 사진·진행 확인·다시 접수", async () => {
    resetRateLimits();
    const P = { params: Promise.resolve({ token }) };
    const form = await formRoute.GET(http(`/api/intake/${token}`), P);
    expect(form.status).toBe(200);
    expect(form.headers.get("cache-control")).toBe("private, no-store");
    expect(form.headers.get("x-robots-tag")).toContain("noindex");
    expect(Object.keys(await form.json()).sort()).toEqual(["company", "phone", "sample", "siteName"]);
    const post = (body: unknown, init: { ip?: string; headers?: Record<string, string> } = {}) => formRoute.POST(http(`/api/intake/${token}`, { method: "POST", body, ...init }), { params: Promise.resolve({ token }) });
    const ok = await post({ ...FORM, idempotencyKey: K("api-1") });
    expect(ok.status).toBe(200);
    const made = (await ok.json()) as { no: string; statusToken: string };
    expect(Object.keys(made).sort()).toEqual(["no", "statusToken"]);
    const bad = await post({ ...FORM, phone: "12", location: "", idempotencyKey: K("api-2") });
    expect(bad.status).toBe(400);
    expect(Object.keys((await bad.json()).fieldErrors).sort()).toEqual(["location", "phone"]);
    const trap = await post({ ...FORM, idempotencyKey: K("api-3"), extra: "http://spam.example" });
    expect(trap.status).toBe(400);
    expect((await trap.json()).error).toContain("자동으로 채워진");
    // 같은 접수를 다시 보내면 같은 접수 번호·같은 진행 확인 주소 (새 접수가 생기지 않는다)
    const re = await post({ ...FORM, idempotencyKey: K("api-1") });
    expect(re.status).toBe(200);
    expect(await re.json()).toEqual(made);
    expect((await post({ ...FORM, idempotencyKey: K("api-4") }, { headers: { origin: "https://evil.example", host: "localhost" } })).status).toBe(403);
    // DB가 못 받는 글자(NUL)가 들어와도 서버 오류가 아니다 — 걸러서 받는다
    const nul = await post({ ...FORM, location: "4층\u0000 창", idempotencyKey: K("api-nul") });
    expect(nul.status).toBe(200);
    const nulKey = ((await nul.json()) as { statusToken: string }).statusToken;
    expect(await intakeSvc.intakeStatus(nulKey)).toMatchObject({ location: "4층 창" });
    const wrong = rand(16);
    const miss = await formRoute.GET(http(`/api/intake/${wrong}`), { params: Promise.resolve({ token: wrong }) });
    expect(miss.status).toBe(404);
    const missPost = await formRoute.POST(http(`/api/intake/${wrong}`, { method: "POST", body: { ...FORM, idempotencyKey: K("api-5") } }), { params: Promise.resolve({ token: wrong }) });
    expect(missPost.status).toBe(404);
    // 진행 확인·사진·확인
    const st = await statusRoute.GET(http(`/api/intake/status/${made.statusToken}`), { params: Promise.resolve({ key: made.statusToken }) });
    expect(st.status).toBe(200);
    expect(st.headers.get("cache-control")).toBe("private, no-store");
    const body = await st.json();
    expect(body).toMatchObject({ no: made.no, step: 0 });
    expect(JSON.stringify(body)).not.toMatch(/홍길동|1234-5678/);
    const k = rand(24);
    expect((await statusRoute.GET(http(`/api/intake/status/${k}`), { params: Promise.resolve({ key: k }) })).status).toBe(404);
    const photo = (key: string, id: string, headers?: Record<string, string>) => photoRoute.GET(http(`/api/intake/status/${key}/photo/${id}`, { headers }), { params: Promise.resolve({ key, id }) });
    const ph = await photo(statusToken, donePhoto);
    expect(ph.status).toBe(200);
    expect(ph.headers.get("content-type")).toBe("image/jpeg");
    expect(ph.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await photo(statusToken, donePhoto, { "if-none-match": `"${donePhoto}"` })).status).toBe(304);
    // 접수자가 올린 사진·다른 접수의 사진은 주지 않는다
    expect((await photo(statusToken, sentPhoto)).status).toBe(404);
    expect((await photo(made.statusToken, donePhoto)).status).toBe(404);
    // 보수 전에는 확인·다시 접수할 수 없다 (409) · 다른 사이트에서 보낸 요청은 거부
    const cf = (key: string, headers?: Record<string, string>) => confirmRoute.POST(http(`/api/intake/status/${key}/confirm`, { method: "POST", body: { note: "" }, headers }), { params: Promise.resolve({ key }) });
    expect((await cf(made.statusToken)).status).toBe(409);
    expect((await cf(made.statusToken, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    expect((await cf(k)).status).toBe(404);
    const ro = (key: string, note: string, headers?: Record<string, string>) => reopenRoute.POST(http(`/api/intake/status/${key}/reopen`, { method: "POST", body: { note }, headers }), { params: Promise.resolve({ key }) });
    expect((await ro(made.statusToken, "아직 샙니다")).status).toBe(409);
    expect((await ro(made.statusToken, "아직 샙니다", { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    expect((await ro(k, "아직 샙니다")).status).toBe(404);
  });

  it("본문 크기: 길이 머리말 없이 나눠 보내도 한도를 넘으면 그만 읽는다 (400) · 주소가 틀리면 본문을 읽기 전에 404", async () => {
    resetRateLimits();
    const stream = (bytes: number) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          const chunk = new TextEncoder().encode("A".repeat(64_000));
          for (let n = 0; n < bytes; n += chunk.length) c.enqueue(chunk);
          c.close();
        },
      });
    const chunked = (path: string, bytes: number) => new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "x-forwarded-for": "203.0.113.30", "content-type": "application/json" }, body: stream(bytes), duplex: "half" } as never);
    const big = await formRoute.POST(chunked(`/api/intake/${token}`, 6_000_000), { params: Promise.resolve({ token }) });
    expect(big.status).toBe(400);
    expect((await big.json()).error).toContain("너무 큽니다");
    const wrong = rand(16);
    expect((await formRoute.POST(chunked(`/api/intake/${wrong}`, 6_000_000), { params: Promise.resolve({ token: wrong }) })).status).toBe(404);
    const cf = await confirmRoute.POST(chunked(`/api/intake/status/${statusToken}/confirm`, 200_000), { params: Promise.resolve({ key: statusToken }) });
    expect(cf.status).toBe(400);
  });

  it("요청 제한: 한 곳에서 링크 하나에 10분에 10건 · 틀린 입력은 세지 않는다 · ‘확인’은 따로 센다 · 다른 곳은 그대로 · 없는 주소를 계속 넣어도 맞는 주소는 열린다 · IPv6는 /64로 묶는다", async () => {
    resetRateLimits();
    const ip = "192.0.2.50";
    const post = (i: number, from = ip, extra: Record<string, unknown> = {}) =>
      formRoute.POST(http(`/api/intake/${token}`, { method: "POST", ip: from, body: { ...FORM, idempotencyKey: K(`rl-${from}-${i}`), ...extra } }), { params: Promise.resolve({ token }) });
    // 틀린 입력 12번 — 세지 않는다
    for (let i = 0; i < 12; i++) expect((await post(100 + i, ip, { phone: "12" })).status).toBe(400);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post(i)).status);
    expect(codes).toEqual([...Array(10).fill(200), 429]);
    expect((await post(0, "192.0.2.51")).status).toBe(200);
    // 접수가 막힌 곳에서도 ‘확인’은 된다 (따로 센다 — 여기서는 보수 전이라 409)
    const cf = await confirmRoute.POST(http(`/api/intake/status/${statusToken}/confirm`, { method: "POST", ip, body: { note: "" } }), { params: Promise.resolve({ key: statusToken }) });
    expect(cf.status).toBe(409);
    for (let i = 0; i < 21; i++) {
      const w = rand(16);
      await formRoute.GET(http(`/api/intake/${w}`, { ip: "192.0.2.60" }), { params: Promise.resolve({ token: w }) });
    }
    expect((await formRoute.GET(http(`/api/intake/${token}`, { ip: "192.0.2.60" }), { params: Promise.resolve({ token }) })).status).toBe(200);
    // IPv6: 한 회선이 받는 /64 안에서 주소를 바꿔도 같은 곳
    const v6 = (a: string) => clientIp(http("/x", { ip: a }));
    expect(v6("2001:db8:1:2:aaaa:bbbb:cccc:1")).toBe("2001:db8:1:2::/64");
    expect(v6("2001:db8:1:2::ffff")).toBe("2001:db8:1:2::/64");
    expect(v6("2001:0db8:0001:0002:0:0:0:9")).toBe("2001:db8:1:2::/64");
    expect(v6("2001:db8:1:3::1")).not.toBe(v6("2001:db8:1:2::1"));
    expect(v6("203.0.113.9")).toBe("203.0.113.9");
    resetRateLimits();
  });

  it("동시에 여러 건이 들어와도 접수 번호가 겹치지 않고 모두 저장된다", async () => {
    const link = await svc.executeCommand(ceo, "createIntake", { siteId: "site-b", label: "동시 접수" });
    const t = (link.result as { token: string }).token;
    const outs = await Promise.all(Array.from({ length: 6 }, (_, i) => intakeSvc.submitIntakeByToken(t, { ...FORM, location: `${i + 1}층 창`, idempotencyKey: K(`con-${i}`) }, `198.51.100.${i}`)));
    const nos = outs.map((o) => o!.no).sort();
    expect(new Set(nos).size).toBe(6);
    // 회사 전체에서 겹치지 않는다 (다른 현장의 접수 번호와도)
    const v = (await svc.getView(ceo)).db;
    const all = v.partnerRequests.filter((r) => r.intake).map((r) => r.intake!.no);
    expect(new Set(all).size).toBe(all.length);
    expect(v.partnerRequests.filter((r) => r.intake?.id === sha(t))).toHaveLength(6);
    expect(v.intakes!.find((i) => i.id === sha(t))!.count).toBe(6);
  });

  it("하루 한도에 닿으면: 접수 화면이 미리 알려 주고(full) · 접수는 거절 · 본사에 그날 한 번만 알린다", async () => {
    const link = await svc.executeCommand(ceo, "createIntake", { siteId: "site-c", label: "한도 시험" });
    const { token: t, intakeId: id } = link.result as { token: string; intakeId: string };
    for (let i = 0; i < intake.INTAKE_DAILY_LIMIT; i++) await intakeSvc.submitIntakeByToken(t, { ...FORM, location: `${i}`, idempotencyKey: K(`cap-${i}`) }, `10.0.${Math.floor(i / 10)}.${i}`);
    expect(await intakeSvc.openIntake(t)).toMatchObject({ ok: true, view: { full: true } });
    sent.length = 0;
    await expect(intakeSvc.submitIntakeByToken(t, { ...FORM, idempotencyKey: K("cap-over") }, "10.9.9.9")).rejects.toThrow(/전화로/);
    await expect(intakeSvc.submitIntakeByToken(t, { ...FORM, idempotencyKey: K("cap-over2") }, "10.9.9.10")).rejects.toThrow(/전화로/);
    expect(sent.map((x) => x.payload.title)).toEqual(["하자 접수 링크 한도 도달", "하자 접수 링크 한도 도달"]);
    const v = (await svc.getView(ceo)).db;
    expect(v.intakes!.find((i) => i.id === id)).toMatchObject({ count: intake.INTAKE_DAILY_LIMIT, fullOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(v.activityLogs.filter((l) => l.summary.includes("오늘 한도")).length).toBe(1);
    // 한꺼번에 버리기 (장난 접수 40건)
    const junk = v.partnerRequests.filter((r) => r.intake?.id === id).map((r) => r.id);
    expect((await svc.executeCommand(ceo, "discardIntakeRequests", { requestIds: junk, reason: "spam" })).result).toEqual({ discarded: intake.INTAKE_DAILY_LIMIT });
    expect(await intakeSvc.openIntake(t)).toMatchObject({ ok: true, view: {} });
    expect(((await intakeSvc.openIntake(t)) as { view: { full?: boolean } }).view.full).toBeUndefined();
  });

  it("링크를 닫으면 그 주소로는 접수되지 않는다 (410 — 어디에 전화할지는 알려 준다) · 이미 들어온 접수의 진행 확인은 그대로 · 다시 열면 다시 접수된다", async () => {
    resetRateLimits();
    await svc.executeCommand(ceo, "closeIntake", { intakeId });
    expect(await intakeSvc.openIntake(token)).toEqual({ ok: false, reason: "closed", company: "(주)태강지엘텍", phone: "031-123-4567" });
    const gone = await formRoute.GET(http(`/api/intake/${token}`), { params: Promise.resolve({ token }) });
    expect(gone.status).toBe(410);
    expect(await gone.json()).toMatchObject({ code: "closed", company: "(주)태강지엘텍", phone: "031-123-4567" });
    const post = await formRoute.POST(http(`/api/intake/${token}`, { method: "POST", body: { ...FORM, idempotencyKey: K("closed-1") } }), { params: Promise.resolve({ token }) });
    expect(post.status).toBe(410);
    expect(await intakeSvc.intakeStatus(statusToken)).toMatchObject({ step: 4 });
    await expect(svc.executeCommand(ceo, "closeIntake", { intakeId })).rejects.toThrow(/이미 닫은/);
    await svc.executeCommand(manager, "reopenIntakeLink", { intakeId });
    expect(await intakeSvc.openIntake(token)).toMatchObject({ ok: true });
    await expect(svc.executeCommand(field, "reopenIntakeLink", { intakeId })).rejects.toThrow(ForbiddenError);
  });

  it("매일 점검·명령 실행·화면 읽기 때: 처리 끝난 지 90일이 지난 접수의 이름·연락처를 지운다 (처리 중인 접수는 그대로)", async () => {
    const db = await getDb();
    const count = async () => (await db.query<{ n: number }>(`select count(*)::int as n from records where collection = 'partnerRequests' and data::text like '%1234-5678%'`))[0].n;
    const before = await count();
    expect(before).toBeGreaterThan(1);
    await svc.runDailyJobs(days(intake.INTAKE_CONTACT_KEEP_DAYS + 2, new Date()));
    // 확인까지 끝난 첫 접수만 지워진다 (처리 중인 접수는 그대로)
    expect(await count()).toBe(before - 1);
    expect((await reqOf())!.intake).toMatchObject({ org: "관리사무소", purgedAt: expect.any(String) });
    expect((await reqOf())!.intake!.name).toBeUndefined();
    // 끝내지 않은 접수도 180일이면 지운다
    await svc.runDailyJobs(days(intake.INTAKE_OPEN_KEEP_DAYS + 2, new Date()));
    expect(await count()).toBe(0);
  });
});
