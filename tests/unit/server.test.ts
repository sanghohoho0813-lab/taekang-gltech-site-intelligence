/**
 * LIVE 서버 통합 테스트 — 실제 Postgres(PGlite, 메모리)에 스키마를 만들고
 * 최초 설정 → 로그인 → 명령 실행·저장 → 역할별 데이터 필터 → 권한 거부를 검증한다.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dropTestDatabase, testDatabaseUrl } from "./testDb";

// 기본은 PGlite 메모리 DB. 실제 Postgres로: TEST_DATABASE_URL=postgres://… → 이 파일 전용 빈 임시 DB를 만들고 끝나면 지운다
process.env.DATABASE_URL = await testDatabaseUrl("server");

const { getDb } = await import("@/server/sql");
const { migrationSqlFile } = await import("@/server/migrations");
const { loadState } = await import("@/server/state");
const svc = await import("@/server/service");
const auth = await import("@/server/auth");
const { ForbiddenError } = await import("@/server/authz");
const { CommandError } = await import("@/lib/data/commands");
const { DEMO_SCENARIO } = await import("@/lib/data/seed");
const { siteFinancials } = await import("@/lib/domain/calc");

type Member = Awaited<ReturnType<typeof auth.memberFromToken>> & object;

const PW = "Taekang2026!";
/** 동의 화면에 보여준 조건 (회사 기본 규칙 · D-49) */
const TERMS = { version: 2, retentionDays: null, viewers: "hq" as const };
let ceo: Member;
let field: Member;
let partner: Member;
let manager: Member;

async function loginAs(email: string): Promise<Member> {
  const r = await auth.login(email, PW);
  if (!r.ok) throw new Error(r.error);
  const m = await auth.memberFromToken(r.token);
  if (!m) throw new Error("session");
  return m;
}

const fieldReport = (key: string, extra: Record<string, unknown> = {}) => ({
  idempotencyKey: key,
  siteId: "site-a",
  reportDate: "2026-10-30",
  workDone: DEMO_SCENARIO.workDone,
  costs: DEMO_SCENARIO.costs.map((c) => ({ category: c.category, amount: c.amount, forecastImpact: "additional", note: c.note })),
  reason: "design_change",
  ...extra,
});

const DB_URL = process.env.DATABASE_URL!;
afterAll(async () => {
  await (await getDb()).close();
  await dropTestDatabase(DB_URL);
});

beforeAll(async () => {
  expect(await svc.needsSetup()).toBe(true);
  const r = await svc.setupCompany({ companyName: "(주)태강지엘텍", name: "대표", email: "ceo@taekang.test", password: PW, withDemoData: true });
  expect(r.member.role).toBe("ceo");
  ceo = await loginAs("ceo@taekang.test");
  field = await loginAs("field@demo.local");
  partner = await loginAs("partner@demo.local");
  manager = await loginAs("manager@demo.local");
});

describe("스키마·최초 설정", () => {
  it("supabase/migrations/001_init.sql 이 앱 스키마와 같다", () => {
    expect(readFileSync("supabase/migrations/001_init.sql", "utf8")).toBe(migrationSqlFile());
  });
  it("JSON 값이 문자열로 이중 저장되지 않는다 (실제 Postgres 회귀 방지 · D-41)", async () => {
    const db = await getDb();
    const types = await db.query<{ t: string; n: number }>(`select jsonb_typeof(data) as t, count(*)::int as n from records group by 1`);
    expect(types.map((r) => r.t)).toEqual(["object"]);
    const [st] = await db.query<{ t: string; s: string }>(`select jsonb_typeof(settings) as t, jsonb_typeof(baseline) as s from company_state limit 1`);
    expect(st).toMatchObject({ t: "object", s: "object" });
    const [m] = await db.query<{ t: string }>(`select jsonb_typeof(site_ids) as t from members limit 1`);
    expect(m.t).toBe("array");
    const [one] = await db.query<{ id: string | null }>(`select data->>'id' as id from records where collection = 'sites' limit 1`);
    expect(one.id).toBeTruthy();
  });
  it("최초 설정은 한 번만 — 두 번째는 거부", async () => {
    expect(await svc.needsSetup()).toBe(false);
    await expect(svc.setupCompany({ companyName: "x", name: "x", email: "x@x.test", password: PW })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("가상 데이터로 시작하면 A현장 10억 · 8.5억 · 15%", async () => {
    const { db } = await svc.getView(ceo);
    const f = siteFinancials(db, "site-a");
    expect(f.adjustedContract).toBe(1_000_000_000);
    expect(f.eac).toBe(850_000_000);
    expect(Math.round(f.marginPct)).toBe(15);
    expect(db.users.map((u) => u.id).sort()).toEqual(["u-ceo", "u-field", "u-field2", "u-manager", "u-partner"]);
  });
  it("가상 데이터로 시작한 회사는 표시가 남고, 운영 설정을 바꿔도 지워지지 않는다", async () => {
    expect((await svc.getView(ceo)).db.settings?.sampleData).toBe(true);
    await svc.executeCommand(ceo, "setCompanySettings", { laborDayRate: 310_000 });
    expect((await svc.getView(ceo)).db.settings?.sampleData).toBe(true);
    // 발주처에는 표시만 전달하고 내부 일당은 숨긴다
    const p = (await svc.getView(partner)).db.settings;
    expect(p?.sampleData).toBe(true);
    expect(p?.laborDayRate).toBe(0);
    await svc.executeCommand(ceo, "setCompanySettings", { laborDayRate: 300_000 });
  });
});

describe("로그인·세션", () => {
  it("비밀번호는 해시로만 저장되고 검증된다", async () => {
    const h = await auth.hashPassword("abcd1234");
    expect(h).not.toContain("abcd1234");
    expect(await auth.verifyPassword("abcd1234", h)).toBe(true);
    expect(await auth.verifyPassword("abcd1235", h)).toBe(false);
  });
  it("틀린 비밀번호는 같은 메시지, 8회 실패 시 잠금", async () => {
    await svc.createMember(ceo, { email: "lock@taekang.test", name: "잠금 테스트", role: "field", password: PW });
    for (let i = 0; i < 8; i++) {
      const r = await auth.login("lock@taekang.test", "wrong-pass-1");
      expect(r.ok).toBe(false);
    }
    const r = await auth.login("lock@taekang.test", PW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("잠겼습니다");
  });
  it("세션 토큰 해시만 저장, 로그아웃하면 무효", async () => {
    const r = await auth.login("manager@demo.local", PW);
    if (!r.ok) throw new Error();
    const db = await getDb();
    const rows = await db.query<{ token_hash: string }>(`select token_hash from sessions`);
    expect(rows.some((x) => x.token_hash === r.token)).toBe(false);
    expect(await auth.memberFromToken(r.token)).not.toBeNull();
    await auth.destroySession(r.token);
    expect(await auth.memberFromToken(r.token)).toBeNull();
  });
});

describe("명령 실행·저장", () => {
  it("현장직원 휴대폰 보고 → DB 저장 → 대표 화면 8.9억 · 11% (현장직원 응답에는 금액 없음)", async () => {
    const out = await svc.executeCommand(field, "submitFieldReport", fieldReport("k-1"));
    expect(out.result).not.toHaveProperty("before");
    expect(out.result).not.toHaveProperty("after");
    const { db } = await svc.getView(ceo);
    const f = siteFinancials(db, "site-a");
    expect(f.eac).toBe(890_000_000);
    expect(Math.round(f.marginPct)).toBe(11);
  });
  it("같은 요청을 다시 보내면 중복 저장 방지", async () => {
    await expect(svc.executeCommand(field, "submitFieldReport", fieldReport("k-1"))).rejects.toMatchObject({ code: "DUPLICATE" });
  });
  it("동시에 들어온 명령은 순서대로 모두 반영된다 (rev가 2 증가)", async () => {
    const before = await svc.currentRev(ceo.companyId);
    await Promise.all([
      svc.executeCommand(field, "submitFieldReport", { ...fieldReport("k-par-1"), costs: [] , workDone: "동시 1"}),
      svc.executeCommand(field, "submitFieldReport", { ...fieldReport("k-par-2"), costs: [], workDone: "동시 2" }),
    ]);
    expect(await svc.currentRev(ceo.companyId)).toBe(before + 2);
  });
  it("위험 신호는 서버가 다시 계산 — 지어낸 신호로는 조치를 만들 수 없다", async () => {
    const fake = { key: "FAKE:site-a", rule: "MARGIN_DROP", siteId: "site-a", severity: "high", title: "가짜", summary: "", why: [], dataUsed: [], threshold: "", metric: { label: "", current: "" }, recommendation: { actionTitle: "가짜", description: "" }, detectedAt: new Date().toISOString(), causeEntryIds: [] };
    await expect(svc.executeCommand(manager, "createAction", { signal: fake, title: "가짜", description: "", assigneeUserId: "u-field", dueDate: "2026-11-05" })).rejects.toMatchObject({ code: "STATE" });
    const { computeSignals } = await import("@/lib/domain/risk");
    const { db } = await svc.getView(manager);
    const real = computeSignals(db).find((s) => s.rule === "UNBILLED_CHANGE")!;
    const out = await svc.executeCommand(manager, "createAction", { signal: { key: real.key }, title: "추가공사 청구가능성 검토", description: "", assigneeUserId: "u-field", dueDate: "2026-11-05" });
    expect(out.result).toHaveProperty("actionId");
  });
  it("현장직원 완료는 '확인 대기' — 결과 확정은 본사", async () => {
    const { db } = await svc.getView(field);
    const a = db.actions.find((x) => x.title === "추가공사 청구가능성 검토")!;
    await svc.executeCommand(field, "setActionStatus", { actionId: a.id, to: "in_progress" });
    await svc.executeCommand(field, "completeAction", { actionId: a.id, input: { result: "근거 정리 완료", registerChangeOrder: true, claimAmount: 40_000_000, confirm: true } });
    const view = await svc.getView(ceo);
    const pe = view.db.proofEvents.find((p) => p.action_id === a.id)!;
    expect(pe.status).toBe("recorded");
    await svc.executeCommand(manager, "confirmProofEvent", { proofId: pe.proof_event_id });
    expect((await svc.getView(ceo)).db.proofEvents.find((p) => p.action_id === a.id)!.status).toBe("confirmed");
  });
});

describe("역할별 권한·데이터", () => {
  it("현장직원은 담당 아닌 현장 보고·관리 명령 불가", async () => {
    await expect(svc.executeCommand(field, "submitFieldReport", fieldReport("k-c", { siteId: "site-c" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "setThresholds", { targetMarginPct: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "addPayment", { siteId: "site-a", amount: 1, receivedDate: "2026-10-30" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("현장직원에게는 계약·예산·기성·미수·변경공사가 전송되지 않는다", async () => {
    const { db } = await svc.getView(field);
    expect(db.scope).toBe("field");
    expect(db.contracts.every((c) => c.contractAmount === 0 && c.plannedCostTotal === 0)).toBe(true);
    expect(db.budgets).toHaveLength(0);
    expect(db.forecasts).toHaveLength(0);
    expect(db.billings).toHaveLength(0);
    expect(db.payments).toHaveLength(0);
    expect(db.changeOrders).toHaveLength(0);
    expect(db.sites.map((s) => s.id).sort()).toEqual(["site-a", "site-b"]);
    expect(db.costEntries.every((e) => e.createdBy === "u-field")).toBe(true);
    expect(JSON.stringify(db)).not.toMatch(/"expectedProfit":[1-9]/);
  });
  it("발주처는 허용 현장에만 요청, 내부 데이터 없음", async () => {
    await expect(svc.executeCommand(partner, "createPartnerRequest", { siteId: "site-b", type: "other", title: "x", description: "y", idempotencyKey: "p-b" })).rejects.toBeInstanceOf(ForbiddenError);
    await svc.executeCommand(partner, "createPartnerRequest", { siteId: "site-a", type: "change_review", title: "작업지시 및 변경견적 요청", description: "서면 작업지시", idempotencyKey: "p-a" });
    const { db } = await svc.getView(partner);
    expect(db.scope).toBe("partner");
    expect(db.sites.map((s) => s.id)).toEqual(["site-a"]);
    expect(db.costEntries).toHaveLength(0);
    expect(db.actions).toHaveLength(0);
    expect(db.users.filter((u) => u.role === "partner").map((u) => u.id)).toEqual(["u-partner"]);
    expect(db.partnerRequests.every((r) => r.partnerUserId === "u-partner")).toBe(true);
  });
});

describe("사진·이력·설정", () => {
  const png1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  it("사진은 원본을 별도 표에 저장하고 주소만 남긴다 — 발주처는 볼 수 없음", async () => {
    await svc.executeCommand(field, "submitFieldReport", fieldReport("k-photo", { costs: [], workDone: "사진 보고", photos: [{ dataUrl: png1x1 }] }));
    const { db } = await svc.getView(field);
    const p = db.photos.find((x) => x.dataUrl.startsWith("/api/photos/"))!;
    expect(p).toBeTruthy();
    const id = decodeURIComponent(p.dataUrl.split("/").pop()!);
    expect((await svc.getPhoto(field, id))?.mime).toBe("image/png");
    expect(await svc.getPhoto(partner, id)).toBeNull();
  });
  it("공무 확인 후 반영 설정이면 현장 원가는 대기 → 승인 시 반영", async () => {
    await svc.executeCommand(ceo, "setCompanySettings", { costApproval: "review" });
    const before = siteFinancials((await svc.getView(ceo)).db, "site-b").eac;
    await svc.executeCommand(field, "submitFieldReport", fieldReport("k-review", { siteId: "site-b", costs: [{ category: "labor", amount: 3_000_000, forecastImpact: "additional", qty: { manDays: 10, dayRate: 300_000 } }] }));
    const mid = (await svc.getView(ceo)).db;
    expect(siteFinancials(mid, "site-b").eac).toBe(before);
    const pending = mid.costEntries.find((e) => e.status === "pending")!;
    expect(pending.qty).toEqual({ manDays: 10, dayRate: 300_000 });
    await expect(svc.executeCommand(field, "reviewCostEntry", { entryId: pending.id, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
    await svc.executeCommand(manager, "reviewCostEntry", { entryId: pending.id, decision: "approve", amount: 2_800_000 });
    expect(siteFinancials((await svc.getView(ceo)).db, "site-b").eac).toBe(before + 2_800_000);
    await svc.executeCommand(ceo, "setCompanySettings", { costApproval: "immediate" });
  });
  it("본사가 확인한 보고·원가는 현장에서 혼자 취소·수정할 수 없다", async () => {
    await svc.executeCommand(ceo, "setCompanySettings", { costApproval: "review" });
    const r = (await svc.executeCommand(field, "submitFieldReport", fieldReport("k-lock", { siteId: "site-b", costs: [{ category: "material", amount: 1_000_000, forecastImpact: "additional" }] }))).result as { reportId: string };
    const e = (await svc.getView(ceo)).db.costEntries.find((x) => x.reportId === r.reportId)!;
    expect(e.status).toBe("pending");
    await svc.executeCommand(manager, "reviewCostEntry", { entryId: e.id, decision: "approve" });
    await expect(svc.executeCommand(field, "voidReport", { reportId: r.reportId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "voidCostEntry", { entryId: e.id, reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "editCostEntry", { entryId: e.id, patch: { amount: 1 } })).rejects.toBeInstanceOf(ForbiddenError);
    // 확인 전 보고는 현장에서 취소 가능
    const r2 = (await svc.executeCommand(field, "submitFieldReport", fieldReport("k-lock2", { siteId: "site-b", costs: [] }))).result as { reportId: string };
    await svc.executeCommand(field, "voidReport", { reportId: r2.reportId });
    await svc.executeCommand(ceo, "setCompanySettings", { costApproval: "immediate" });
  });
  it("현장 문의 전화번호: 형식 확인 후 현장 직원 화면에 전달 (비우면 숨김)", async () => {
    await expect(svc.executeCommand(ceo, "setCompanySettings", { helpPhone: "전화주세요" })).rejects.toBeInstanceOf(CommandError);
    await svc.executeCommand(ceo, "setCompanySettings", { helpPhone: "02-1234-5678" });
    expect((await svc.getView(field)).db.settings?.helpPhone).toBe("02-1234-5678");
    // 다른 설정을 바꿔도 번호는 유지
    await svc.executeCommand(ceo, "setCompanySettings", { laborDayRate: 300_000 });
    expect((await svc.getView(field)).db.settings?.helpPhone).toBe("02-1234-5678");
    await svc.executeCommand(ceo, "setCompanySettings", { helpPhone: "" });
    expect((await svc.getView(field)).db.settings?.helpPhone).toBeUndefined();
  });
  it("출퇴근: 담당 현장만·본인 기록만 보이고, 정정·현장 위치는 본사만, DB에 저장", async () => {
    const near = { lat: 37.2638, lng: 127.0289, accuracy: 15 };
    await expect(svc.executeCommand(field, "checkIn", { siteId: "site-c", sample: near, consent: true, consentTerms: TERMS })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(partner, "checkIn", { siteId: "site-a" })).rejects.toBeInstanceOf(ForbiddenError);
    const r = (await svc.executeCommand(field, "checkIn", { siteId: "site-a", sample: near, consent: true, consentTerms: TERMS, deviceId: "dev-test01" })).result as { attendanceId: string; geo: { status: string } };
    expect(r.geo.status).toBe("inside");
    await expect(svc.executeCommand(field, "correctAttendance", { attendanceId: r.attendanceId, outAt: new Date().toISOString(), note: "본인 수정" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "setSiteGeo", { siteId: "site-a", lat: 37, lng: 127, radiusM: 3000 })).rejects.toBeInstanceOf(ForbiddenError);
    const fv = (await svc.getView(field)).db;
    expect((fv.attendance ?? []).every((x) => x.userId === field.id)).toBe(true);
    expect((fv.attendance ?? []).some((x) => x.id === r.attendanceId)).toBe(true);
    expect((await svc.getView(partner)).db.attendance ?? []).toHaveLength(0);
    const cv = (await svc.getView(ceo)).db;
    expect(cv.attendance!.some((x) => x.userId === "u-field2")).toBe(true); // 본사는 전체
    expect(cv.consents!.some((c) => c.userId === field.id)).toBe(true);
    await svc.executeCommand(field, "checkOut", { siteId: "site-a", sample: near, deviceId: "dev-test01" });
    expect((await svc.getView(ceo)).db.attendance!.find((x) => x.id === r.attendanceId)?.outAt).toBeTruthy();
  });
  it("현장 QR 단말기: 비밀값은 누구에게도 안 내려가고, 연결 코드로 한 번만 받는다", async () => {
    await expect(svc.executeCommand(field, "createKiosk", { siteId: "site-a" })).rejects.toBeInstanceOf(ForbiddenError);
    const r = (await svc.executeCommand(manager, "createKiosk", { siteId: "site-a" })).result as { kioskId: string; pairCode: string };
    for (const who of [ceo, manager, field, partner]) {
      const v = JSON.stringify((await svc.getView(who)).db.kiosks ?? []);
      expect(v).not.toContain("secret");
      expect(v).not.toContain("pairHash");
    }
    expect((await svc.kioskStatus(r.kioskId)).active).toBe(false); // 아직 연결 전
    // 가상 데이터로 시작한 운영 회사의 단말기 비밀값은 소스의 DEMO 값이 아니다
    const db = await getDb();
    const [demo] = await db.query<{ s: string }>(`select data->>'secret' as s from records where collection = 'kiosks' and id = 'kio_demo1'`);
    expect(demo.s).toMatch(/^[0-9a-f]{64}$/);
    const paired = await svc.pairKioskByCode(r.pairCode);
    expect(paired.secret).toMatch(/^[0-9a-f]{64}$/);
    await expect(svc.pairKioskByCode(r.pairCode)).rejects.toBeInstanceOf(CommandError); // 두 번째 거부
    expect((await svc.kioskStatus(r.kioskId)).active).toBe(true);
    await svc.executeCommand(manager, "revokeKiosk", { kioskId: r.kioskId });
    expect((await svc.kioskStatus(r.kioskId)).active).toBe(false);
  });
  it("작업 인원: 담당 현장만 보내고 담당 현장 것만 보이며, 단체 사진은 별도 저장", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await expect(svc.executeCommand(field, "reportCrew", { siteId: "site-c", team: "x", headcount: 2 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(partner, "reportCrew", { siteId: "site-a", team: "x", headcount: 2 })).rejects.toBeInstanceOf(ForbiddenError);
    await svc.executeCommand(field, "reportCrew", { siteId: "site-a", team: "서버 테스트팀", headcount: 3, photoDataUrl: png });
    const fv = (await svc.getView(field)).db;
    expect((fv.crewChecks ?? []).every((c) => ["site-a", "site-b"].includes(c.siteId))).toBe(true);
    const mine = fv.crewChecks!.find((c) => c.team === "서버 테스트팀")!;
    expect(fv.photos.find((p) => p.id === mine.photoId)?.dataUrl).toMatch(/^\/api\/photos\//);
    expect((await svc.getView(partner)).db.crewChecks ?? []).toHaveLength(0);
  });
  it("지시·확인 권한: 현장은 자기 지시·자기 요청·자기 보고만, 확인·지시는 본사만", async () => {
    await expect(svc.executeCommand(field, "createWorkOrder", { siteId: "site-a", title: "직접 지시" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "reviewReport", { reportId: "x", decision: "confirm" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "reviewAttendanceFix", { requestId: "afr-seed-1", decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(field, "requestAttendanceFix", { siteId: "site-c", workDate: "2026-11-01", kind: "missed_in", inTime: "07:00", reason: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const wo = (await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-c", title: "C현장 지시", assigneeUserId: "u-field2" })).result as { workOrderId: string };
    await expect(svc.executeCommand(field, "workOrderStep", { workOrderId: wo.workOrderId, action: "receive" })).rejects.toBeInstanceOf(ForbiddenError); // 남의 지시
    const fv = (await svc.getView(field)).db;
    expect((fv.workOrders ?? []).every((w) => w.assigneeUserId === field.id)).toBe(true);
    expect((fv.attendanceRequests ?? []).every((q) => q.userId === field.id)).toBe(true);
    const pv = (await svc.getView(partner)).db;
    expect([...(pv.workOrders ?? []), ...(pv.attendanceRequests ?? [])]).toHaveLength(0);
    const mine = (await svc.executeCommand(manager, "createWorkOrder", { siteId: "site-a", title: "A현장 지시" })).result as { workOrderId: string };
    await svc.executeCommand(field, "workOrderStep", { workOrderId: mine.workOrderId, action: "receive" });
    expect((await svc.getView(manager)).db.workOrders!.find((w) => w.id === mine.workOrderId)!.status).toBe("received");
  });
  it("자료 가져오기: 본사만 실행, 서버가 원문 재검증, DB 저장·취소, 팀 단가·가져오기 기록은 현장에 안 내려감", async () => {
    const text = "현장,구분,날짜,금액\nA현장,기성,2026-03-01,40000000\nA현장,입금,2026-03-31,40000000";
    await expect(svc.executeCommand(field, "importData", { kind: "billing", text, idempotencyKey: "imp-f" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(partner, "importData", { kind: "billing", text, idempotencyKey: "imp-p" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(manager, "importData", { kind: "billing", text: "현장,구분,날짜,금액\nZ현장,기성,2026-03-01,1", idempotencyKey: "imp-bad" })).rejects.toBeInstanceOf(CommandError);
    const out = await svc.executeCommand(manager, "importData", { kind: "billing", text, idempotencyKey: "imp-1" });
    const batchId = (out.result as { batchId: string }).batchId;
    const db = await getDb();
    const reloaded = await db.transaction((tx) => loadState(tx, ceo.companyId));
    expect(reloaded.billings.find((b) => b.billedDate === "2026-03-01")).toMatchObject({ round: 1, importBatchId: batchId });
    expect(reloaded.importBatches?.[0]).toMatchObject({ id: batchId, kind: "billing", count: 2 });
    await svc.executeCommand(manager, "importData", { kind: "rates", text: "팀,단가\n유리 설치팀 (가상 협력업체),320000", idempotencyKey: "imp-r" });
    const fv = (await svc.getView(field)).db;
    expect(fv.settings?.teamRates).toBeUndefined();
    expect(fv.settings?.laborDayRate).toBeGreaterThan(0);
    expect(fv.importBatches).toEqual([]);
    expect((await svc.getView(partner)).db.importBatches).toEqual([]);
    await svc.executeCommand(manager, "undoImport", { batchId });
    const after = await db.transaction((tx) => loadState(tx, ceo.companyId));
    expect(after.billings.some((b) => b.importBatchId === batchId)).toBe(false);
    expect(after.importBatches?.find((b) => b.id === batchId)?.undoneAt).toBeTruthy();
  });
  it("전체 자료 백업: 대표만, 비밀번호 해시·세션·QR 비밀값·중복 방지 키 없음, 모든 컬렉션 포함", async () => {
    await expect(svc.exportCompany(manager)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.exportCompany(field)).rejects.toBeInstanceOf(ForbiddenError);
    const { filename, body } = await svc.exportCompany(ceo);
    expect(filename).toMatch(/^taekang_backup_\d{8}\.json$/);
    expect(body).not.toMatch(/password_hash|passwordHash|token_hash|"secret"|pairHash|scrypt|\$argon/);
    const j = JSON.parse(body);
    expect(j.format).toBe("taekang-site-intelligence-backup");
    expect(j.members.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(j.members[0]).sort()).toEqual(["active", "email", "id", "name", "partnerSiteIds", "role", "siteIds", "title"]);
    expect(j.data.idempotencyKeys).toEqual([]);
    for (const k of ["sites", "contracts", "budgets", "costEntries", "billings", "payments", "changeOrders", "reports", "attendance", "crewChecks", "workOrders", "partnerRequests", "activityLogs"]) expect(Array.isArray(j.data[k]), k).toBe(true);
    expect(j.counts.sites).toBe(j.data.sites.length);
    expect(j.data.kiosks.every((k: Record<string, unknown>) => !("secret" in k) && !("pairHash" in k))).toBe(true);
  });
  it("활동 이력 조회: 화면에 실리는 최근 300건 밖의 오래된 이력도 서버에서 조건으로 찾고, 대표·관리자만", async () => {
    const db = await getDb();
    // 석 달 전 이력 320건을 직접 넣는다 (화면 데이터에는 최근 300건만 실림)
    for (let i = 0; i < 320; i++) {
      const at = new Date(Date.UTC(2026, 7, 1, 1, 0, i)).toISOString();
      const log = { id: `log-old-${i}`, at, by: i % 2 ? "u-field" : "u-manager", type: i % 3 ? "attendance" : "report", siteId: i % 2 ? "site-a" : "site-b", summary: `과거 이력 ${i}${i === 7 ? " 크레인 점검" : ""}` };
      await db.query(`insert into records (company_id, collection, id, site_id, data) values ($1, 'activityLogs', $2, $3, $4)`, [ceo.companyId, log.id, log.siteId, JSON.stringify(log)]);
    }
    // DB를 직접 고친 뒤에는 rev를 올린다 (서버가 기억한 회사 데이터를 다시 읽게 · D-50 운영 규칙)
    await db.query(`update companies set rev = rev + 1 where id = $1`, [ceo.companyId]);
    const view = (await svc.getView(ceo)).db;
    // 화면 데이터는 300건으로 잘리지만 DB에는 전부 남아 있다
    expect(view.activityLogs.length).toBe(300);
    const all = await svc.listActivity(manager, { from: "2026-08-01", to: "2026-08-01" });
    expect(all.logs).toHaveLength(320);
    expect(all.logs[0].at >= all.logs[319].at).toBe(true); // 최신순
    expect((await svc.listActivity(ceo, { from: "2026-08-01", to: "2026-08-01", userId: "u-field", siteId: "site-a" })).logs).toHaveLength(160);
    expect((await svc.listActivity(ceo, { from: "2026-08-01", to: "2026-08-01", type: "report" })).logs.every((l) => l.type === "report")).toBe(true);
    expect((await svc.listActivity(ceo, { from: "2026-08-01", to: "2026-08-01", q: "크레인" })).logs.map((l) => l.id)).toEqual(["log-old-7"]);
    // 검색어에 SQL을 넣어도 문자열로만 취급
    expect((await svc.listActivity(ceo, { from: "2026-08-01", to: "2026-08-01", q: "' or 1=1 --" })).logs).toEqual([]);
    expect((await svc.listActivity(ceo, { from: "2026-07-01", to: "2026-07-31" })).logs).toEqual([]);
    await expect(svc.listActivity(field, { from: "2026-08-01", to: "2026-08-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.listActivity(partner, { from: "2026-08-01", to: "2026-08-01" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.listActivity(ceo, { from: "2026-08-02", to: "2026-08-01" })).rejects.toBeInstanceOf(CommandError);
    await expect(svc.listActivity(ceo, { from: "bad", to: "2026-08-01" })).rejects.toBeInstanceOf(CommandError);
    // 없는 날짜는 서버 오류(500)가 아니라 입력 오류
    await expect(svc.listActivity(ceo, { from: "2026-13-45", to: "2026-08-01" })).rejects.toBeInstanceOf(CommandError);
    // 백업에는 300건 제한 없이 전체 이력이 들어간다
    const backup = JSON.parse((await svc.exportCompany(ceo)).body);
    expect(backup.data.activityLogs.length).toBeGreaterThan(320);
    expect(backup.data.activityLogs.some((l: { id: string }) => l.id === "log-old-0")).toBe(true);
  }, 30_000); // 320건을 한 건씩 넣으므로 바쁜 PC에서는 5초를 넘기기도 한다

  it("사진에는 휴대폰 사진 데이터만 — 다른 주소·GIF·스크립트는 거부 (본사 화면이 내부 주소를 불러오지 않게)", async () => {
    for (const dataUrl of ["/api/export", "https://evil.example/x.png", "data:image/gif;base64,R0lGODlhAQABAAAAACw=", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)"])
      await expect(svc.executeCommand(field, "submitFieldReport", fieldReport(`k-ph-${dataUrl.slice(0, 12)}`, { costs: [], photos: [{ dataUrl }] }))).rejects.toBeInstanceOf(CommandError);
    await expect(svc.executeCommand(manager, "addActionNote", { actionId: "nope", text: "", photoDataUrl: "/api/export" })).rejects.toBeInstanceOf(CommandError);
  });

  it("사용자 수정: 활성 여부는 참/거짓만 (문자열 \"false\"로 비활성화 보호 장치 우회 불가), 이름은 문자만", async () => {
    await expect(svc.updateMember(ceo, ceo.id, { active: "false" as never })).rejects.toBeInstanceOf(CommandError);
    await expect(svc.updateMember(ceo, manager.id, { name: 123 as never })).rejects.toBeInstanceOf(CommandError);
  });

  it("활동 이력은 지워지지 않는다 (DB에는 계속 쌓임)", async () => {
    const db = await getDb();
    const [{ n }] = await db.query<{ n: string }>(`select count(*) as n from records where collection = 'activityLogs'`);
    expect(Number(n)).toBeGreaterThan(5);
  });
  it("저장 후 다시 읽어도 같은 데이터 (왕복 일치)", async () => {
    const db = await getDb();
    const a = await db.transaction((tx) => loadState(tx, ceo.companyId));
    const b = await db.transaction((tx) => loadState(tx, ceo.companyId));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("현장 등록·사용자 관리", () => {
  it("현장 등록 → 실행예산이 잔여예상 → 계획 이익률 계산", async () => {
    const out = await svc.executeCommand(manager, "saveSite", {
      name: "신규 오피스 커튼월",
      shortName: "D현장",
      workType: "커튼월",
      region: "서울",
      clientName: "가상 D건설 · 원청",
      status: "active",
      startDate: "2026-11-01",
      endDate: "2027-06-30",
      fieldUserId: "u-field2",
      contractAmount: 500_000_000,
      budgets: { material: 250_000_000, labor: 100_000_000, subcontract: 50_000_000, equipment: 10_000_000, overhead: 15_000_000 },
    });
    const id = (out.result as { siteId: string }).siteId;
    const f = siteFinancials((await svc.getView(ceo)).db, id);
    expect(f.eac).toBe(425_000_000);
    expect(Math.round(f.marginPct)).toBe(15);
    await expect(svc.executeCommand(field, "saveSite", { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("잔여예상 재추정 — 재추정 전 '실행예산 내 집행'은 다시 빼지 않는다", async () => {
    await svc.executeCommand(manager, "submitFieldReport", fieldReport("k-within", { siteId: "site-c", costs: [{ category: "material", amount: 10_000_000, forecastImpact: "within_forecast" }] }));
    const remaining = { material: 100_000_000, labor: 50_000_000, subcontract: 0, equipment: 0, overhead: 0 };
    await svc.executeCommand(manager, "updateForecast", { siteId: "site-c", remaining });
    const f = siteFinancials((await svc.getView(ceo)).db, "site-c");
    expect(f.remaining).toBe(150_000_000);
  });
  it("재추정 이력·준공 원가 마감은 DB에 저장된다 — 메모리 캐시가 아니라 다시 읽어도 남는다 (D-79 대표 점검 B-1)", async () => {
    const out = await svc.executeCommand(manager, "saveSite", { name: "준공 유리 보수", shortName: "E현장", workType: "유리", region: "서울", clientName: "가상 E", status: "completed", startDate: "2026-10-01", endDate: "2026-10-30", contractAmount: 30_000_000, budgets: { material: 10_000_000, labor: 8_000_000, subcontract: 0, equipment: 0, overhead: 1_000_000 } });
    const siteId = (out.result as { siteId: string }).siteId;
    const remaining = { material: 9_000_000, labor: 8_000_000, subcontract: 0, equipment: 0, overhead: 1_000_000 };
    await svc.executeCommand(manager, "updateForecast", { siteId, remaining, note: "11월 공정회의" });
    await svc.executeCommand(manager, "updateForecast", { siteId, remaining: { ...remaining, material: 0, overhead: 0 }, closeout: true, note: "준공 정산 — 남은 청구서 없음" });
    const db = await getDb();
    const reloaded = await db.transaction((tx) => loadState(tx, ceo.companyId));
    const mine = (reloaded.forecastChanges ?? []).filter((c) => c.siteId === siteId);
    expect(mine.map((c) => c.note).slice(0, 2)).toEqual(["준공 정산 — 남은 청구서 없음", "11월 공정회의"]);
    expect(mine[0]).toMatchObject({ closeout: true, eacBefore: expect.any(Number), eacAfter: expect.any(Number) });
    expect((await svc.getView(field)).db.forecastChanges).toEqual([]);
  });
  it("관리자는 대표 권한을 줄 수 없고, 본인 비활성화 불가, 비활성화하면 세션 종료", async () => {
    await expect(svc.createMember(manager, { email: "x@taekang.test", name: "x", role: "ceo", password: PW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.updateMember(manager, manager.id, { active: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.createMember(field, { email: "y@taekang.test", name: "y", role: "field", password: PW })).rejects.toBeInstanceOf(ForbiddenError);
    const created = await svc.createMember(manager, { email: "new@taekang.test", name: "신규 소장", role: "field", password: PW });
    expect(created.mustChangePassword).toBe(true);
    const r = await auth.login("new@taekang.test", PW);
    if (!r.ok) throw new Error(r.error);
    await svc.updateMember(manager, created.id, { active: false });
    expect(await auth.memberFromToken(r.token)).toBeNull();
    await expect(svc.createMember(manager, { email: "new@taekang.test", name: "중복", role: "field", password: PW })).rejects.toBeInstanceOf(CommandError);
  });
  it("비밀번호 변경: 현재 비밀번호 확인 + 정책", async () => {
    const r = await auth.login("field2@demo.local", PW);
    if (!r.ok) throw new Error();
    const m = (await auth.memberFromToken(r.token))!;
    expect(await auth.changePassword(m, "wrong", "NewPass123", r.token)).toContain("현재 비밀번호");
    expect(await auth.changePassword(m, PW, "short", r.token)).toContain("8자");
    expect(await auth.changePassword(m, PW, "NewPass123", r.token)).toBeNull();
    expect((await auth.login("field2@demo.local", "NewPass123")).ok).toBe(true);
  });
});

describe("개인위치정보 규칙 (LIVE · D-43)", () => {
  it("규칙은 대표만 / ‘대표만’이면 관리자에게 좌표 없이 / 보관 기간이 지난 좌표는 다음 명령과 같은 트랜잭션에서 지워진다", async () => {
    await expect(svc.executeCommand(manager, "setLocationPolicy", { retentionDays: 90, viewers: "ceo" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.executeCommand(manager, "purgeMemberLocations", { userId: "u-field" })).rejects.toBeInstanceOf(ForbiddenError);
    // 좌표가 있는 출퇴근 기록 하나를 오래전 기록으로 바꿔 둔다 (DB 직접)
    const db = await getDb();
    const [row] = await db.query<{ id: string }>(`select id from records where collection = 'attendance' and data->'inGeo'->>'lat' is not null order by id limit 1`);
    expect(row?.id).toBeTruthy();
    await db.query(`update records set data = jsonb_set(data, '{inAt}', to_jsonb('2026-01-05T00:00:00.000Z'::text)) where collection = 'attendance' and id = $1`, [row.id]);
    await db.query(`update companies set rev = rev + 1 where id = $1`, [ceo.companyId]); // 직접 고친 뒤 rev 올리기 (D-50)

    await svc.executeCommand(ceo, "setLocationPolicy", { retentionDays: 90, viewers: "ceo" });
    // 명령이 없어도(주말 등) 화면 데이터·백업에는 보관 기간이 지난 좌표가 나가지 않는다 (DB 삭제는 다음 명령 때 · D-49)
    const ceoView = await svc.getView(ceo);
    expect(ceoView.db.attendance!.find((r) => r.id === row.id)!.inGeo.lat).toBeUndefined();
    const backup = JSON.parse((await svc.exportCompany(ceo)).body) as { data?: { attendance?: { id: string; inGeo: { lat?: number } }[] }; attendance?: { id: string; inGeo: { lat?: number } }[] };
    const backupRows = backup.data?.attendance ?? backup.attendance ?? [];
    expect(backupRows.find((r) => r.id === row.id)?.inGeo.lat).toBeUndefined();
    expect(backupRows.length).toBeGreaterThan(0);
    // 관리자: 좌표·거리 없이 판정만 / 대표: 그대로
    const mv = await svc.getView(manager);
    expect(mv.db.attendance!.length).toBeGreaterThan(0);
    expect(JSON.stringify(mv.db.attendance)).not.toMatch(/"lat"|"distanceM"|"accuracyM"/);
    const cv = await svc.getView(ceo);
    expect(JSON.stringify(cv.db.attendance)).toMatch(/"lat"/);

    // 다음 명령(현장 보고) 때 하루 한 번 자동 삭제
    await svc.executeCommand(field, "submitFieldReport", { ...fieldReport("k-priv-1"), costs: [], workDone: "위치 정리 확인" });
    const st = await db.transaction((tx) => loadState(tx, ceo.companyId));
    const old = st.attendance!.find((r) => r.id === row.id)!;
    expect(old.inGeo).toMatchObject({ purged: true });
    expect(old.inGeo.lat).toBeUndefined();
    expect(old.inAt).toBe("2026-01-05T00:00:00.000Z");
    expect(st.settings?.location?.purgedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const logs = await svc.listActivity(ceo, { from: "2026-01-01", to: "2030-12-31", type: "privacy" });
    expect(logs.logs.some((l) => l.by === "system" && l.summary.includes("자동 삭제"))).toBe(true);
    // 저장된 값도 jsonb 객체 (좌표 키 없음)
    const [saved] = await db.query<{ t: string; lat: string | null }>(`select jsonb_typeof(data->'inGeo') as t, data->'inGeo'->>'lat' as lat from records where collection = 'attendance' and id = $1`, [row.id]);
    expect(saved).toEqual({ t: "object", lat: null });

    // 다른 테스트에 영향이 없도록 기본값으로
    await svc.executeCommand(ceo, "setLocationPolicy", { retentionDays: null, viewers: "hq" });
  });
});
