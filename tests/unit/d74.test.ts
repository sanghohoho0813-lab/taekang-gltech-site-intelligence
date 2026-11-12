/**
 * D-74 하자 접수 링크 — 계정 없는 사람이 주소·QR로 하자를 접수하고 진행을 확인한다.
 * 1) 순수 로직: 링크 만들기·닫기, 접수 검증·번호·하루 한도, 진행 확인, 확인, 연락처 보관 기간, 권한·보기
 * 2) 서버 (실제 Postgres 엔진): 주소로 접수·진행 확인·사진·확인, API 응답·요청 제한, 동시 접수
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
const { applyIntakeRetention, closeIntake, confirmIntake, createIntake, renewIntakeStatus, submitIntake } = await import("@/lib/data/intakeCommands");
const { createShare } = await import("@/lib/data/shareCommands");
const intake = await import("@/lib/domain/intake");
const { defectRows } = await import("@/lib/domain/defects");
const { noticesFor } = await import("@/lib/domain/notify");
const { authorize, viewFor, ForbiddenError } = await import("@/server/authz");
const svc = await import("@/server/service");
const intakeSvc = await import("@/server/intakeService");
const auth = await import("@/server/auth");
const push = await import("@/server/push");
const { resetRateLimits } = await import("@/server/rateLimit");
const { getDb } = await import("@/server/sql");
const { NextRequest } = await import("next/server");
const formRoute = await import("@/app/api/intake/[token]/route");
const statusRoute = await import("@/app/api/intake/status/[key]/route");
const confirmRoute = await import("@/app/api/intake/status/[key]/confirm/route");
const photoRoute = await import("@/app/api/intake/status/[key]/photo/[id]/route");

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

describe("하자 접수 링크 — 만들기·닫기 (순수 로직)", () => {
  it("전화번호: 숫자만 남겨 한 가지 꼴로 · 맞지 않으면 받지 않는다", () => {
    expect(intake.normalizePhone("01012345678")).toBe("010-1234-5678");
    expect(intake.normalizePhone("010 1234 5678")).toBe("010-1234-5678");
    expect(intake.normalizePhone("02-123-4567")).toBe("02-123-4567");
    expect(intake.normalizePhone("0212345678")).toBe("02-1234-5678");
    expect(intake.normalizePhone("031-123-4567")).toBe("031-123-4567");
    expect(intake.normalizePhone("0505-123-4567")).toBe("050-5123-4567");
    for (const bad of ["", "1234", "12345678901", "010-1234", "전화주세요", null, 1012345678]) expect(intake.normalizePhone(bad)).toBeNull();
  });

  it("접수 주소는 22자(글자·숫자로 시작하고 끝남) · 접수만 되는 주소라 저장해 둔다(다시 볼 수 있게) · id는 그 SHA-256", () => {
    const { db, intakeId, token } = withLink();
    expect(token).toMatch(intake.INTAKE_TOKEN_RE);
    expect(token).toMatch(/^[A-Za-z0-9].*[A-Za-z0-9]$/);
    expect(intakeId).toBe(sha(token));
    expect(db.intakes![0]).toMatchObject({ id: intakeId, token, siteId: "site-a", label: "관리사무소용", createdBy: "u-manager", count: 0 });
    expect(db.activityLogs[0].summary).toBe("하자 접수 링크 만듦 — A현장 · 관리사무소용");
    for (let i = 0; i < 30; i++) expect(intake.newToken((n) => new Uint8Array(nodeRandom(n)), 16)).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{20}[A-Za-z0-9]$/);
  });

  it("한 현장에 열린 링크 5개까지 · 같은 이름은 하나만 · 닫으면 다시 만들 수 있다 · 두 번 닫기 거부", () => {
    let db = createSeed(NOW);
    const bad = (input: unknown) => expect(() => createIntake(db, input as never, ctx())).toThrow(CommandError);
    bad({ siteId: "nope" });
    bad({ siteId: "site-a", label: "가".repeat(21) });
    // 이름을 안 적으면 ‘하자 접수’
    db = createIntake(db, { siteId: "site-a" }, ctx()).db;
    expect(db.intakes![0].label).toBe("하자 접수");
    expect(() => createIntake(db, { siteId: "site-a" }, ctx())).toThrow(/이미 열려/);
    for (const l of ["1동", "2동", "3동", "4동"]) db = createIntake(db, { siteId: "site-a", label: l }, ctx()).db;
    expect(() => createIntake(db, { siteId: "site-a", label: "5동" }, ctx())).toThrow(/5개/);
    expect(() => createIntake(db, { siteId: "site-b", label: "1동" }, ctx())).not.toThrow();
    const id = db.intakes!.find((i) => i.label === "1동")!.id;
    const closed = closeIntake(db, { intakeId: id }, ctx("u-ceo", days(1)));
    expect(closed.db.intakes!.find((i) => i.id === id)).toMatchObject({ closedAt: days(1).toISOString(), closedBy: "u-ceo" });
    expect(() => closeIntake(closed.db, { intakeId: id }, ctx())).toThrow(/이미 닫은/);
    expect(() => closeIntake(db, { intakeId: "nope" }, ctx())).toThrow(CommandError);
    expect(() => createIntake(closed.db, { siteId: "site-a", label: "1동" }, ctx())).not.toThrow();
  });
});

describe("하자 접수 — 접수·진행·확인 (순수 로직)", () => {
  it("접수: 하자보수 요청 한 건 · 접수 번호(그날 그 현장 순번) · 진행 확인 주소는 한 번만(해시만 저장) · 이력·알림에 이름·연락처 없음", () => {
    const { db, req, no, statusToken, intakeId } = withRequest();
    expect(no).toBe("1112-1");
    expect(statusToken).toMatch(intake.INTAKE_STATUS_RE);
    expect(req).toMatchObject({ siteId: "site-a", partnerUserId: "", type: "defect", status: "received", title: "하자 접수 · 3층 302호 거실 창", location: "3층 302호 거실 창", statusKey: sha(statusToken) });
    expect(req.intake).toEqual({ id: intakeId, no: "1112-1", org: "관리사무소", name: "홍길동", phone: "010-1234-5678", consentAt: NOW.toISOString() });
    expect(JSON.stringify(db)).not.toContain(statusToken);
    // 사진은 그 요청에 붙고 공개 사진이 아니다
    expect(req.photoIds).toHaveLength(1);
    expect(db.photos.find((p) => p.id === req.photoIds![0])).toMatchObject({ partnerRequestId: req.id, siteId: "site-a" });
    expect(db.photos.find((p) => p.id === req.photoIds![0])!.shared).toBeUndefined();
    expect(db.intakes![0]).toMatchObject({ count: 1, lastAt: NOW.toISOString() });
    // 활동 이력·휴대폰 알림에는 위치·접수 번호만
    expect(db.activityLogs[0]).toMatchObject({ by: "system", type: "partner", siteId: "site-a" });
    expect(db.activityLogs[0].summary).toBe("하자 접수(링크): A현장 · 3층 302호 거실 창 — 접수 번호 1112-1");
    const before = withLink().db;
    const notices = noticesFor({ ...before, partnerRequests: db.partnerRequests.filter((r) => r.id !== req.id) }, db, "system");
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe("고객 요청 · 하자보수 요청");
    expect(JSON.stringify(notices)).not.toMatch(/홍길동|1234-5678/);
    expect(notices[0].to.sort()).toEqual(["u-ceo", "u-manager"]);
    // 다음 접수는 다음 번호 · 다음 날은 다시 1번
    const l2 = submitIntake(db, { ...FORM, intakeId, idempotencyKey: K("k2") }, sys());
    expect(l2.result.no).toBe("1112-2");
    expect(submitIntake(l2.db, { ...FORM, intakeId, idempotencyKey: K("k3") }, sys(days(1))).result.no).toBe("1113-1");
  });

  it("접수 검증: 위치·내용·이름·전화·동의는 꼭 · 사진 3장까지 · 닫힌 링크·없는 링크는 거부 · 같은 접수 두 번 안 들어감 · 하루 20건", () => {
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
    expect(fieldErrors({ consent: "true" })).toHaveProperty("consent");
    expect(() => submitIntake(db, { ...FORM, intakeId: "nope", idempotencyKey: K("x") }, sys())).toThrow(/접수할 수 없습니다/);
    const closed = closeIntake(db, { intakeId }, ctx()).db;
    expect(() => submitIntake(closed, { ...FORM, intakeId, idempotencyKey: K("x") }, sys())).toThrow(/접수할 수 없습니다/);
    // 같은 화면에서 두 번 누른 접수
    // 같은 접수를 다시 보냄 (응답을 못 받고 다시 누름): 새로 만들지 않고 같은 접수 번호·같은 진행 확인 주소
    const first = submitIntake(db, { ...FORM, intakeId, idempotencyKey: K("same") }, sys());
    const again = submitIntake(first.db, { ...FORM, intakeId, idempotencyKey: K("same") }, sys(days(1)));
    expect(again.db).toBe(first.db);
    expect(again.result).toMatchObject({ requestId: first.result.requestId, no: first.result.no, statusToken: first.result.statusToken, again: true });
    expect(first.result.again).toBe(false);
    expect(first.result.statusToken).toMatch(intake.INTAKE_STATUS_RE);
    expect(first.result.statusToken).toMatch(/^[A-Za-z0-9].*[A-Za-z0-9]$/);
    // 그 난수를 모르면(다른 휴대폰) 같은 접수 주소로도 그 진행 확인 주소를 만들 수 없다
    const other = submitIntake(first.db, { ...FORM, intakeId, idempotencyKey: K("other") }, sys());
    expect(other.result.statusToken).not.toBe(first.result.statusToken);
    expect(other.result.no).not.toBe(first.result.no);
    // 본사가 진행 확인 주소를 다시 만든 뒤에 같은 접수가 또 오면 새로 만들지 않고 막는다
    const renewed = COMMANDS.renewIntakeStatus(first.db, { requestId: first.result.requestId }, ctx()).db;
    expect(() => submitIntake(renewed, { ...FORM, intakeId, idempotencyKey: K("same") }, sys())).toThrow(/이미 저장된/);
    // 난수가 없거나 형식이 다르면(옛 화면·직접 호출) 매번 새 접수 · 새 난수 주소
    const s1 = submitIntake(db, { ...FORM, intakeId, idempotencyKey: "short" }, sys());
    const s2 = submitIntake(s1.db, { ...FORM, intakeId, idempotencyKey: "short" }, sys());
    expect(s2.result.requestId).not.toBe(s1.result.requestId);
    expect(s2.result.statusToken).not.toBe(s1.result.statusToken);
    // 하루 한도
    let cur = db;
    for (let i = 0; i < intake.INTAKE_DAILY_LIMIT; i++) cur = submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K(`d${i}`) }, sys()).db;
    expect(() => submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K("over") }, sys())).toThrow(/전화로/);
    expect(() => submitIntake(cur, { ...FORM, intakeId, idempotencyKey: K("tomorrow") }, sys(days(1)))).not.toThrow();
  });

  it("진행 확인: 본인이 적은 내용·단계·회신·사진만 — 접수자 이름·연락처, 담당자, 작업지시 번호, 내부 번호 없음 · 보수 끝나고 회신 받은 뒤에만 확인", () => {
    let { db, req, statusToken } = withRequest();
    const view = (d: DemoDB) => {
      const r = d.partnerRequests.find((x) => x.statusKey === sha(statusToken))!;
      return intake.intakeStatusView({ company: d.company.name, site: d.sites.find((s) => s.id === r.siteId), req: r, workOrder: (d.workOrders ?? []).find((w) => w.id === r.linkedWorkOrderId) });
    };
    const v0 = view(db);
    expect(v0).toMatchObject({ no: "1112-1", step: 0, label: "접수", location: FORM.location, description: FORM.description, canConfirm: false });
    expect(v0.photos).toEqual([{ id: req.photoIds![0], kind: "sent" }]);
    expect(JSON.stringify(v0)).not.toMatch(/홍길동|1234-5678|관리사무소|site-a|u-/);
    expect(() => confirmIntake(db, { requestId: req.id }, sys())).toThrow(/보수가 끝난 뒤/);
    // 본사: 작업지시 → 현장 완료(사진) → 회신(보수 사진)
    const wo = COMMANDS.createWorkOrder(db, { siteId: "site-a", title: "하자보수 · 302호 창 누수", assigneeUserId: "u-field", dueDate: "2026-11-20", partnerRequestId: req.id, idempotencyKey: "wo1" }, ctx());
    db = wo.db;
    const v1 = view(db);
    expect(v1).toMatchObject({ step: 1, label: "보수 배정", dueDate: "2026-11-20", canConfirm: false });
    expect(JSON.stringify(v1)).not.toContain(wo.result.workOrderId);
    db = COMMANDS.workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "receive" }, ctx("u-field")).db;
    db = COMMANDS.workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "complete", note: "실리콘 재시공", photoDataUrls: [JPG] }, ctx("u-field")).db;
    const donePhoto = db.workOrders!.find((w) => w.id === wo.result.workOrderId)!.donePhotoIds![0];
    const answered = COMMANDS.updatePartnerRequest(db, { requestId: req.id, patch: { status: "answered", reply: "실리콘을 다시 시공했습니다. 살수 시험으로 누수 없음 확인.", sharePhotoIds: [donePhoto] } }, ctx());
    // 계정이 없는 접수에 회신해도 알림 받을 사람이 없을 뿐 오류가 아니다
    expect(noticesFor(db, answered.db, "u-manager").filter((n) => n.to.includes(""))).toEqual([]);
    db = answered.db;
    const v2 = view(db);
    expect(v2).toMatchObject({ step: 3, label: "보수 완료", reply: "실리콘을 다시 시공했습니다. 살수 시험으로 누수 없음 확인.", canConfirm: true });
    expect(v2.dueDate).toBeUndefined();
    expect(v2.photos).toEqual([{ id: req.photoIds![0], kind: "sent" }, { id: donePhoto, kind: "repair" }]);
    expect(JSON.stringify(v2)).not.toMatch(/실리콘 재시공|u-field|홍길동/);
    // 확인
    const done = confirmIntake(db, { requestId: req.id, note: "잘 고쳐졌습니다" }, sys(days(1)));
    expect(done.db.partnerRequests.find((r) => r.id === req.id)).toMatchObject({ confirmedAt: days(1).toISOString(), confirmNote: "잘 고쳐졌습니다" });
    expect(view(done.db)).toMatchObject({ step: 4, label: "확인 완료", canConfirm: false, confirmedAt: days(1).toISOString() });
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

  it("진행 확인 주소 다시 만들기: 새 주소만 열리고 앞의 주소는 닫힌다 · 링크 접수가 아니면 거부", () => {
    const { db, req, statusToken } = withRequest();
    const r = renewIntakeStatus(db, { requestId: req.id }, ctx());
    expect(r.result.statusToken).toMatch(intake.INTAKE_STATUS_RE);
    expect(r.result.statusToken).not.toBe(statusToken);
    const after = r.db.partnerRequests.find((x) => x.id === req.id)!;
    expect(after.statusKey).toBe(sha(r.result.statusToken));
    expect(after.statusKey).not.toBe(sha(statusToken));
    expect(JSON.stringify(r.db)).not.toContain(r.result.statusToken);
    const normal = db.partnerRequests.find((x) => !x.intake)!;
    expect(() => renewIntakeStatus(db, { requestId: normal.id }, ctx())).toThrow(CommandError);
  });

  it("연락처 보관: 회신으로 처리가 끝난 지 90일이 지나면 이름·전화번호를 지운다 (소속·접수 번호·내용은 남김) · 처리 중이면 그대로", () => {
    const { db, req } = withRequest();
    // 처리 중: 아무리 오래돼도 그대로
    expect(applyIntakeRetention(db, days(400))).toBe(db);
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
  });

  it("권한·보기: 만들기·닫기·주소 다시 만들기는 본사만 · 접수자 이름·연락처·접수 링크는 본사만 받고, 진행 확인 주소의 해시는 아무도 받지 않는다 · 보고서 링크에도 없다", () => {
    const { db, req, intakeId } = withRequest();
    const FIELD = member("u-field", "field");
    const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });
    for (const m of [FIELD, PARTNER]) {
      expect(() => authorize(m, "createIntake", { siteId: "site-a" }, db, NOW)).toThrow(ForbiddenError);
      expect(() => authorize(m, "closeIntake", { intakeId }, db, NOW)).toThrow(ForbiddenError);
      expect(() => authorize(m, "renewIntakeStatus", { requestId: req.id }, db, NOW)).toThrow(ForbiddenError);
      const v = viewFor(m, db, NOW);
      expect(v.intakes).toEqual([]);
      expect(v.partnerRequests.some((r) => r.intake)).toBe(false);
      expect(JSON.stringify(v)).not.toMatch(/홍길동|1234-5678/);
      expect(JSON.stringify(v)).not.toContain(req.statusKey!);
      // 접수 사진: 현장 직원은 담당 현장 사진으로 보지만(보수에 필요), 발주처 계정에는 가지 않는다
      if (m.role === "partner") expect(v.photos.some((p) => p.id === req.photoIds![0])).toBe(false);
    }
    for (const m of [member("u-ceo", "ceo"), member("u-manager", "manager")]) {
      expect(() => authorize(m, "createIntake", { siteId: "site-a" }, db, NOW)).not.toThrow();
      const v = viewFor(m, db, NOW);
      expect(v.intakes).toHaveLength(1);
      expect(v.intakes![0].token).toMatch(intake.INTAKE_TOKEN_RE);
      const r = v.partnerRequests.find((x) => x.id === req.id)!;
      expect(r.intake).toMatchObject({ name: "홍길동", phone: "010-1234-5678" });
      expect("statusKey" in r).toBe(false);
    }
    // 발주처에 나가는 보고서 링크(월간·준공)에는 건수만 — 접수자·접수 내용 없음
    for (const kind of ["monthly", "completion"] as const) {
      const snap = JSON.stringify(createShare(db, { kind, siteId: "site-a" }, ctx()).db.shares![0].snapshot);
      expect(snap).not.toMatch(/홍길동|1234-5678|302호|물이 샙니다/);
    }
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

  it("접수 화면: 열린 주소면 회사·현장 이름만 · 틀린 주소·형식이 다른 값·링크 번호(해시)로는 열리지 않는다", async () => {
    const r = await intakeSvc.openIntake(token);
    expect(r).toEqual({ ok: true, view: { company: "(주)태강지엘텍", siteName: expect.stringContaining("가상 현장 A"), sample: true } });
    for (const bad of [rand(16), "", "short", `${token}x`, intakeId, intakeId.slice(0, 22), null, 42, "../../etc/passwd"]) expect(await intakeSvc.openIntake(bad)).toEqual({ ok: false, reason: "notfound" });
  });

  it("주소로 접수 → 본사에만 알림(이름·연락처 없음) · 본사 화면에만 접수자 · 현장·발주처 계정에는 가지 않는다 · DB에 진행 확인 주소가 없다", async () => {
    sent.length = 0;
    const out = await intakeSvc.submitIntakeByToken(token, { ...FORM, idempotencyKey: K("srv-1"), photoDataUrls: [JPG] });
    expect(out!.no).toMatch(/^\d{4}-1$/);
    statusToken = out!.statusToken;
    const all = (await svc.getView(ceo)).db.partnerRequests.filter((r) => r.intake);
    expect(all).toHaveLength(1);
    requestId = all[0].id;
    sentPhoto = all[0].photoIds![0];
    expect(all[0].intake).toMatchObject({ id: intakeId, name: "홍길동", phone: "010-1234-5678", org: "관리사무소" });
    expect("statusKey" in all[0]).toBe(false);
    expect((await svc.getView(ceo)).db.intakes![0]).toMatchObject({ count: 1, token });
    // 사진은 사진 저장소로 (주소만 기록)
    expect((await svc.getView(ceo)).db.photos.find((p) => p.id === sentPhoto)!.dataUrl).toBe(`/api/photos/${sentPhoto}`);
    // 알림: 대표·공무 2대, 이름·연락처 없음
    expect(sent).toHaveLength(2);
    expect(sent[0].payload.title).toBe("고객 요청 · 하자보수 요청");
    expect(JSON.stringify(sent)).not.toMatch(/홍길동|1234-5678/);
    // 현장 직원·발주처 계정
    for (const m of [field, partner]) {
      const v = (await svc.getView(m)).db;
      expect(v.partnerRequests.some((r) => r.intake)).toBe(false);
      expect(v.intakes).toEqual([]);
      expect(JSON.stringify(v)).not.toMatch(/홍길동|1234-5678/);
    }
    expect(await svc.getPhoto(partner, sentPhoto)).toBeNull();
    await expect(svc.executeCommand(field, "createIntake", { siteId: "site-a" })).rejects.toThrow(ForbiddenError);
    await expect(svc.executeCommand(partner, "renewIntakeStatus", { requestId })).rejects.toThrow(ForbiddenError);
    const db = await getDb();
    const hits = await db.query<{ n: number }>(`select count(*)::int as n from records where data::text like $1`, [`%${statusToken}%`]);
    expect(hits[0].n).toBe(0);
    // 틀린 주소로는 접수되지 않는다
    expect(await intakeSvc.submitIntakeByToken(rand(16), { ...FORM, idempotencyKey: K("srv-x") })).toBeNull();
  });

  it("진행 확인: 받은 주소로만 · 그 접수 한 건만 · 본인이 보낸 사진만 받는다", async () => {
    const v = await intakeSvc.intakeStatus(statusToken);
    expect(v).toMatchObject({ company: "(주)태강지엘텍", step: 0, label: "접수", location: FORM.location, canConfirm: false, sample: true });
    expect(v!.photos).toEqual([{ id: sentPhoto, kind: "sent" }]);
    expect(JSON.stringify(v)).not.toMatch(/홍길동|1234-5678|관리사무소/);
    for (const bad of [rand(24), token, requestId, "", null]) expect(await intakeSvc.intakeStatus(bad)).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(statusToken, sentPhoto)).toEqual({ companyId: ceo.companyId });
    const others = (await svc.getView(ceo)).db.photos.filter((p) => p.id !== sentPhoto);
    if (others[0]) expect(await intakeSvc.intakePhotoAccess(statusToken, others[0].id)).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(statusToken, "a/../b")).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(rand(24), sentPhoto)).toBeNull();
    expect((await intakeSvc.intakePhotoBlob(ceo.companyId, sentPhoto))?.mime).toBe("image/jpeg");
  });

  it("본사 작업지시 → 현장 완료 → 회신(보수 사진) → 접수자 확인: 진행 확인 화면이 따라 바뀌고, 확인은 한 번만", async () => {
    await expect(intakeSvc.confirmIntakeByKey(statusToken, "")).rejects.toThrow(/보수가 끝난 뒤/);
    const wo = await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-a", title: "하자보수 · 302호 창 누수", assigneeUserId: field.id, dueDate: "2099-01-05", partnerRequestId: requestId, idempotencyKey: "srv-wo" });
    const woId = (wo.result as { workOrderId: string }).workOrderId;
    expect(await intakeSvc.intakeStatus(statusToken)).toMatchObject({ step: 1, label: "보수 배정", dueDate: "2099-01-05" });
    await svc.executeCommand(field, "workOrderStep", { workOrderId: woId, action: "receive" });
    await svc.executeCommand(field, "workOrderStep", { workOrderId: woId, action: "complete", note: "실리콘 재시공", photoDataUrls: [JPG] });
    const donePhoto = (await svc.getView(ceo)).db.workOrders!.find((w) => w.id === woId)!.donePhotoIds![0];
    // 회신 전에는 보수 사진을 받을 수 없다
    expect(await intakeSvc.intakePhotoAccess(statusToken, donePhoto)).toBeNull();
    sent.length = 0;
    await svc.executeCommand(manager, "updatePartnerRequest", { requestId, patch: { status: "answered", reply: "실리콘을 다시 시공했습니다.", sharePhotoIds: [donePhoto] } });
    const v = await intakeSvc.intakeStatus(statusToken);
    expect(v).toMatchObject({ step: 3, label: "보수 완료", reply: "실리콘을 다시 시공했습니다.", canConfirm: true });
    expect(v!.photos).toEqual([{ id: sentPhoto, kind: "sent" }, { id: donePhoto, kind: "repair" }]);
    expect(await intakeSvc.intakePhotoAccess(statusToken, donePhoto)).toEqual({ companyId: ceo.companyId });
    // 접수자 확인 → 본사에 알림
    sent.length = 0;
    const done = await intakeSvc.confirmIntakeByKey(statusToken, "잘 고쳐졌습니다");
    expect(done!.confirmedAt).toBeTruthy();
    expect(await reqOf()).toMatchObject({ confirmNote: "잘 고쳐졌습니다" });
    expect(sent.map((x) => x.payload.title)).toEqual(["발주처 확인 완료", "발주처 확인 완료"]);
    await expect(intakeSvc.confirmIntakeByKey(statusToken, "")).rejects.toThrow(/이미 확인/);
    expect(await intakeSvc.confirmIntakeByKey(rand(24), "")).toBeNull();
    expect(await intakeSvc.intakeStatus(statusToken)).toMatchObject({ step: 4, label: "확인 완료", canConfirm: false });
  });

  it("진행 확인 주소 다시 만들기: 앞의 주소는 닫히고 새 주소만 열린다", async () => {
    const r = await svc.executeCommand(ceo, "renewIntakeStatus", { requestId });
    const next = (r.result as { statusToken: string }).statusToken;
    expect(await intakeSvc.intakeStatus(statusToken)).toBeNull();
    expect(await intakeSvc.intakePhotoAccess(statusToken, sentPhoto)).toBeNull();
    expect(await intakeSvc.intakeStatus(next)).toMatchObject({ step: 4 });
    statusToken = next;
  });

  it("API: 화면 200(저장 금지·검색 금지 머리말) · 접수 200 · 틀린 입력 400(칸별 이유) · 사람에게 안 보이는 칸이 채워지면 거부 · 없는 주소 404 · 다른 사이트 요청 403 · 사진·진행 확인", async () => {
    resetRateLimits();
    const P = { params: Promise.resolve({ token }) };
    const form = await formRoute.GET(http(`/api/intake/${token}`), P);
    expect(form.status).toBe(200);
    expect(form.headers.get("cache-control")).toBe("private, no-store");
    expect(form.headers.get("x-robots-tag")).toContain("noindex");
    expect(Object.keys(await form.json()).sort()).toEqual(["company", "sample", "siteName"]);
    const post = (body: unknown, init: { ip?: string; headers?: Record<string, string> } = {}) => formRoute.POST(http(`/api/intake/${token}`, { method: "POST", body, ...init }), { params: Promise.resolve({ token }) });
    const ok = await post({ ...FORM, idempotencyKey: K("api-1") });
    expect(ok.status).toBe(200);
    const made = (await ok.json()) as { no: string; statusToken: string };
    expect(Object.keys(made).sort()).toEqual(["no", "statusToken"]);
    expect(made.no).toMatch(/^\d{4}-2$/);
    const bad = await post({ ...FORM, phone: "12", location: "", idempotencyKey: K("api-2") });
    expect(bad.status).toBe(400);
    expect(Object.keys((await bad.json()).fieldErrors).sort()).toEqual(["location", "phone"]);
    expect((await post({ ...FORM, idempotencyKey: K("api-3"), website: "http://spam.example" })).status).toBe(400);
    // 같은 접수를 다시 보내면 같은 접수 번호·같은 진행 확인 주소 (새 접수가 생기지 않는다)
    const re = await post({ ...FORM, idempotencyKey: K("api-1") });
    expect(re.status).toBe(200);
    expect(await re.json()).toEqual(made);
    expect((await post({ ...FORM, idempotencyKey: K("api-4") }, { headers: { origin: "https://evil.example", host: "localhost" } })).status).toBe(403);
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
    const ph = await photoRoute.GET(http(`/api/intake/status/${statusToken}/photo/${sentPhoto}`), { params: Promise.resolve({ key: statusToken, id: sentPhoto }) });
    expect(ph.status).toBe(200);
    expect(ph.headers.get("content-type")).toBe("image/jpeg");
    const etag = await photoRoute.GET(http(`/api/intake/status/${statusToken}/photo/${sentPhoto}`, { headers: { "if-none-match": `"${sentPhoto}"` } }), { params: Promise.resolve({ key: statusToken, id: sentPhoto }) });
    expect(etag.status).toBe(304);
    expect((await photoRoute.GET(http(`/api/intake/status/${made.statusToken}/photo/${sentPhoto}`), { params: Promise.resolve({ key: made.statusToken, id: sentPhoto }) })).status).toBe(404);
    // 보수 전에는 확인할 수 없다 (409) · 다른 사이트에서 보낸 확인은 거부
    const cf = (key: string, headers?: Record<string, string>) => confirmRoute.POST(http(`/api/intake/status/${key}/confirm`, { method: "POST", body: { note: "" }, headers }), { params: Promise.resolve({ key }) });
    expect((await cf(made.statusToken)).status).toBe(409);
    expect((await cf(made.statusToken, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    expect((await cf(k)).status).toBe(404);
  });

  it("요청 제한: 한 곳에서 10분에 5건까지 접수 · 다른 곳은 그대로 · 없는 주소를 계속 넣어도 맞는 주소는 열린다", async () => {
    resetRateLimits();
    const ip = "192.0.2.50";
    const post = (i: number, from = ip) => formRoute.POST(http(`/api/intake/${token}`, { method: "POST", ip: from, body: { ...FORM, idempotencyKey: `rl-${from}-${i}` } }), { params: Promise.resolve({ token }) });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post(i)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await post(0, "192.0.2.51")).status).toBe(200);
    for (let i = 0; i < 21; i++) {
      const w = rand(16);
      await formRoute.GET(http(`/api/intake/${w}`, { ip: "192.0.2.60" }), { params: Promise.resolve({ token: w }) });
    }
    expect((await formRoute.GET(http(`/api/intake/${token}`, { ip: "192.0.2.60" }), { params: Promise.resolve({ token }) })).status).toBe(200);
    resetRateLimits();
  });

  it("동시에 여러 건이 들어와도 접수 번호가 겹치지 않고 모두 저장된다", async () => {
    const link = await svc.executeCommand(ceo, "createIntake", { siteId: "site-b", label: "동시 접수" });
    const t = (link.result as { token: string }).token;
    const outs = await Promise.all(Array.from({ length: 6 }, (_, i) => intakeSvc.submitIntakeByToken(t, { ...FORM, location: `${i + 1}층 창`, idempotencyKey: `con-${i}` })));
    const nos = outs.map((o) => o!.no).sort();
    expect(new Set(nos).size).toBe(6);
    expect(nos.map((n) => n.split("-")[1]).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    const v = (await svc.getView(ceo)).db;
    expect(v.partnerRequests.filter((r) => r.intake?.id === sha(t))).toHaveLength(6);
    expect(v.intakes!.find((i) => i.id === sha(t))!.count).toBe(6);
  });

  it("링크를 닫으면 그 주소로는 접수되지 않는다 (410) — 이미 들어온 접수의 진행 확인은 그대로 열린다", async () => {
    resetRateLimits();
    await svc.executeCommand(ceo, "closeIntake", { intakeId });
    expect(await intakeSvc.openIntake(token)).toEqual({ ok: false, reason: "closed" });
    const gone = await formRoute.GET(http(`/api/intake/${token}`), { params: Promise.resolve({ token }) });
    expect(gone.status).toBe(410);
    expect((await gone.json()).code).toBe("closed");
    const post = await formRoute.POST(http(`/api/intake/${token}`, { method: "POST", body: { ...FORM, idempotencyKey: K("closed-1") } }), { params: Promise.resolve({ token }) });
    expect(post.status).toBe(410);
    expect(await intakeSvc.intakeStatus(statusToken)).toMatchObject({ step: 4 });
    await expect(svc.executeCommand(ceo, "closeIntake", { intakeId })).rejects.toThrow(/이미 닫은/);
  });

  it("매일 점검·명령 실행 때: 처리 끝난 지 90일이 지난 접수의 이름·연락처를 DB에서 지운다", async () => {
    const db = await getDb();
    const count = async () => (await db.query<{ n: number }>(`select count(*)::int as n from records where collection = 'partnerRequests' and data::text like '%1234-5678%'`))[0].n;
    const before = await count();
    expect(before).toBeGreaterThan(0);
    await svc.runDailyJobs(days(intake.INTAKE_CONTACT_KEEP_DAYS + 2, new Date()));
    // 확인까지 끝난 첫 접수만 지워진다 (처리 중인 접수는 그대로)
    expect(await count()).toBe(before - 1);
    expect((await reqOf())!.intake).toMatchObject({ org: "관리사무소", purgedAt: expect.any(String) });
    expect((await reqOf())!.intake!.name).toBeUndefined();
  });
});
