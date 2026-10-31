/**
 * LIVE 서버 통합 테스트 — 실제 Postgres(PGlite, 메모리)에 스키마를 만들고
 * 최초 설정 → 로그인 → 명령 실행·저장 → 역할별 데이터 필터 → 권한 거부를 검증한다.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = "pglite:memory";

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
