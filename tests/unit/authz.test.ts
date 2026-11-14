/**
 * 권한 매트릭스 (계약 검수 S6) — 모든 명령 × 4개 역할을 자동으로 확인한다.
 * 새 명령을 추가하면 첫 테스트가 실패한다 → 아래 표에 역할별 허용 여부를 정하고 나서 통과시킨다 (권한 구멍 방지).
 */
import { describe, expect, it } from "vitest";
import { authorize, ForbiddenError, viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";
import { COMMANDS, type CommandName } from "@/lib/data/registry";
import { createSeed } from "@/lib/data/seed";
import { computeSignals } from "@/lib/domain/risk";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const ALL = Object.keys(COMMANDS).sort() as CommandName[];

/** 현장 직원이 실행할 수 있는 명령 (그 안에서도 담당 현장·본인 것만) */
const FIELD_ALLOWED = new Set<CommandName>(["submitFieldReport", "voidReport", "voidCostEntry", "editCostEntry", "setActionStatus", "addActionNote", "completeAction", "updateProgress", "requestAttendanceFix", "workOrderStep", "supplementReport", "checkIn", "checkOut", "confirmQr", "reportCrew", "recordMaterial", "voidMaterialMove", "withdrawLocationConsent", "reportDeviceCheck", "sendFeedback"]);
/** 대표만 실행할 수 있는 명령 (개인위치정보 규칙·좌표 삭제 · D-43) */
const CEO_ONLY = new Set<CommandName>(["setLocationPolicy", "purgeLocationsNow", "purgeMemberLocations"]);
/** 발주처가 실행할 수 있는 명령 */
const PARTNER_ALLOWED = new Set<CommandName>(["createPartnerRequest", "confirmPartnerRequest"]);

const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const CEO = member("u-ceo", "ceo");
const MANAGER = member("u-manager", "manager");
const FIELD = member("u-field", "field");
const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });

function sample(db: DemoDB, name: CommandName): Record<string, unknown> {
  const sig = computeSignals(db, NOW)[0];
  return { siteId: "site-a", signal: name === "createAction" ? sig : undefined, reportId: db.reports[0]?.id, entryId: db.costEntries[0]?.id, actionId: db.actions[0]?.id, workOrderId: db.workOrders?.[0]?.id, requestId: db.partnerRequests.find((r) => r.partnerUserId === "u-partner" && r.siteId === "site-a")?.id, to: "in_progress", input: {} };
}

describe("권한 매트릭스 — 모든 명령 × 역할", () => {
  it("명령 목록이 바뀌면 이 표를 먼저 갱신한다 (62개)", () => {
    expect(ALL).toEqual(
      [
        "addActionNote", "addBilling", "addPayment", "assignAction", "checkIn", "checkOut", "completeAction", "confirmPartnerRequest", "confirmProofEvent", "confirmQr", "correctAttendance", "createAction", "createKiosk", "createPartnerRequest", "createWorkOrder", "editCostEntry", "importCostRows", "importData", "purgeLocationsNow", "purgeMemberLocations", "recordMaterial", "reportCrew", "reportDeviceCheck", "reviewFeedback", "requestAttendanceFix", "reviewAttendanceFix", "reviewCostEntry", "reviewReport", "reviewWorkOrder", "revokeKiosk", "saveSite", "setActionStatus", "setChangeOrderStatus", "setCompanySettings", "setLocationPolicy", "setPhotoShare", "setSiteGeo", "setSiteMaterials", "setSiteWarranty", "sendFeedback", "setThresholds", "submitFieldReport", "supplementReport", "undoImport", "updateForecast", "updatePartnerRequest", "updateProgress", "voidCostEntry", "voidMaterialMove", "voidReport", "withdrawLocationConsent", "workOrderStep",
        // 보고서 링크 (D-73) — 본사만
        "createShare", "revokeShare",
        // 하자 접수 링크 (D-74) — 본사만
        "createIntake", "closeIntake", "renewIntakeStatus", "reopenIntakeLink", "discardIntakeRequests", "registerPhoneDefect", "reopenIntakeRequest",
        // 월 마감 노무 정산 (D-79) — 본사만
        "settleLabor",
      ].sort(),
    );
    // QR 태블릿 연결은 로그인 없는 전용 API로만 (명령 목록에 없어야 함)
    expect(ALL).not.toContain("pairKiosk");
    // 보고서 링크를 열어 본 기록도 명령이 아니다 (로그인한 사람이 횟수를 올리지 못하게 · D-73)
    expect(ALL).not.toContain("recordShareView");
    // 하자 접수·확인(로그인 없는 사람)도 명령이 아니다 — 로그인한 사용자가 남의 이름으로 접수·확인하지 못하게 (D-74)
    expect(ALL).not.toContain("submitIntake");
    expect(ALL).not.toContain("confirmIntake");
  });

  it("대표는 모든 명령, 관리자는 개인위치정보 규칙·좌표 삭제를 뺀 모든 명령 (금액·승인 포함)", () => {
    const db = createSeed(NOW);
    for (const name of ALL) expect(() => authorize(CEO, name, sample(db, name), db, NOW), `ceo:${name}`).not.toThrow();
    for (const name of ALL)
      if (CEO_ONLY.has(name)) expect(() => authorize(MANAGER, name, sample(db, name), db, NOW), `manager:${name}`).toThrow(ForbiddenError);
      else expect(() => authorize(MANAGER, name, sample(db, name), db, NOW), `manager:${name}`).not.toThrow();
  });

  it("현장 직원: 허용 목록 밖의 명령은 모두 거부 (승인·금액·설정·지시·가져오기·단말기)", () => {
    const db = createSeed(NOW);
    const denied = ALL.filter((n) => !FIELD_ALLOWED.has(n));
    expect(denied.length).toBe(ALL.length - FIELD_ALLOWED.size);
    for (const name of denied) expect(() => authorize(FIELD, name, sample(db, name), db, NOW), name).toThrow(ForbiddenError);
  });

  it("현장 직원: 허용된 명령도 담당 현장·본인 것만", () => {
    const db = createSeed(NOW);
    const other = "site-c"; // 정우진 담당
    for (const name of ["submitFieldReport", "updateProgress", "requestAttendanceFix", "checkIn", "checkOut", "confirmQr", "reportCrew", "recordMaterial"] as CommandName[]) expect(() => authorize(FIELD, name, { siteId: other }, db, NOW), name).toThrow(ForbiddenError);
    // 자재 기록 취소는 본인 기록·오늘 것만 (D-62 · 지난 날 기록은 본사 · D-63)
    const today = { ...db.materialMoves![0], id: "mm-today", workDate: "2026-11-04", by: "u-field" };
    const othersMove = { ...today, id: "mm-other", by: "u-manager" };
    const db2 = { ...db, materialMoves: [...db.materialMoves!, today, othersMove] };
    expect(() => authorize(FIELD, "voidMaterialMove", { moveId: "mm-today" }, db2, NOW)).not.toThrow();
    expect(() => authorize(FIELD, "voidMaterialMove", { moveId: "mm-seed-a1" }, db2, NOW)).toThrow(/지난 날 기록/); // 40일 전 본인 기록
    expect(() => authorize(FIELD, "voidMaterialMove", { moveId: "mm-other" }, db2, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(FIELD, "voidMaterialMove", { moveId: "nope" }, db, NOW)).toThrow(ForbiddenError);
    // 끝난 현장에는 현장에서 새 자재 기록을 넣지 못한다
    const db3 = { ...db, sites: db.sites.map((s) => (s.id === "site-a" ? { ...s, status: "completed" as const } : s)) };
    expect(() => authorize(FIELD, "recordMaterial", { siteId: "site-a" }, db3, NOW)).toThrow(/진행 중인 현장/);
    expect(() => authorize(MANAGER, "recordMaterial", { siteId: "site-a" }, db3, NOW)).not.toThrow();
    const othersReport = db.reports.find((r) => r.createdBy !== "u-field")!;
    expect(() => authorize(FIELD, "voidReport", { reportId: othersReport.id }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(FIELD, "supplementReport", { reportId: othersReport.id }, db, NOW)).toThrow(ForbiddenError);
    const othersEntry = db.costEntries.find((e) => e.createdBy !== "u-field")!;
    expect(() => authorize(FIELD, "voidCostEntry", { entryId: othersEntry.id }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(FIELD, "editCostEntry", { entryId: othersEntry.id }, db, NOW)).toThrow(ForbiddenError);
    const othersOrder = (db.workOrders ?? []).find((w) => w.assigneeUserId !== "u-field");
    if (othersOrder) expect(() => authorize(FIELD, "workOrderStep", { workOrderId: othersOrder.id }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(FIELD, "workOrderStep", { workOrderId: "nope" }, db, NOW)).toThrow(ForbiddenError);
    const notMine = db.actions.find((a) => a.assigneeUserId !== "u-field");
    if (notMine) expect(() => authorize(FIELD, "setActionStatus", { actionId: notMine.id, to: "in_progress" }, db, NOW)).toThrow(ForbiddenError);
    const mine = db.actions.find((a) => a.assigneeUserId === "u-field");
    if (mine) {
      // 현장은 ‘완료 확정’을 할 수 없다
      expect(() => authorize(FIELD, "setActionStatus", { actionId: mine.id, to: "done" }, db, NOW)).toThrow(ForbiddenError);
      const args = authorize(FIELD, "completeAction", { actionId: mine.id, input: { confirm: true } }, db, NOW) as { input: { confirm: boolean } };
      expect(args.input.confirm).toBe(false);
    }
    // 현장 보고의 출처는 서버가 정한다 (PC로 위장 불가)
    expect((authorize(FIELD, "submitFieldReport", { siteId: "site-a", source: "PC" }, db, NOW) as { source: string }).source).toBe("FIELD");
  });

  it("발주처: 본인 현장 요청 등록만, 나머지는 전부 거부", () => {
    const db = createSeed(NOW);
    for (const name of ALL.filter((n) => !PARTNER_ALLOWED.has(n))) expect(() => authorize(PARTNER, name, sample(db, name), db, NOW), name).toThrow(ForbiddenError);
    expect(() => authorize(PARTNER, "createPartnerRequest", { siteId: "site-a" }, db, NOW)).not.toThrow();
    expect(() => authorize(PARTNER, "createPartnerRequest", { siteId: "site-b" }, db, NOW)).toThrow(ForbiddenError);
  });
});

/** 금액으로 볼 수 있는 0보다 큰 숫자를 찾는다 */
const MONEY_KEY = /amount|Amount|dayRate|DayRate|budget|Budget|eac|profit|Profit|margin|Margin|outstanding|contract|Contract|remaining|incurred|estimate/;
function moneyPaths(x: unknown, path = ""): string[] {
  if (Array.isArray(x)) return x.flatMap((v, i) => moneyPaths(v, `${path}[${i}]`));
  if (x && typeof x === "object") return Object.entries(x).flatMap(([k, v]) => (typeof v === "number" && v > 0 && MONEY_KEY.test(k) ? [`${path}.${k}`] : moneyPaths(v, `${path}.${k}`)));
  return [];
}

describe("역할별로 내려보내는 데이터 — 금액 전수 검사", () => {
  it("발주처에게는 금액이 하나도 가지 않는다", () => {
    const db = createSeed(NOW);
    db.settings = { ...db.settings!, teamRates: [{ team: "유리 설치팀", dayRate: 320_000 }] };
    const v = viewFor(PARTNER, db);
    // 목표 이익률·하락 기준은 작동하지 않는 값으로 (회사 내부 경영 정보)
    expect(v.thresholds).toMatchObject({ targetMarginPct: 0, marginDropPp: 100 });
    expect(moneyPaths(v).filter((p) => p !== ".thresholds.marginDropPp")).toEqual([]);
    expect(v.importBatches).toEqual([]);
    expect(v.users.every((u) => u.role !== "partner" || u.id === "u-partner")).toBe(true);
    // 직원 명단·출근 위치 범위는 보내지 않는다 (D-77 리허설)
    expect(v.users.map((u) => u.id)).toEqual(["u-partner"]);
    expect(v.sites.every((s) => s.geo === undefined)).toBe(true);
  });

  it("발주처 설정에는 공개 대표 번호만 (일당·팀 단가·위치 규칙 없음 · D-77)", () => {
    const db = createSeed(NOW);
    db.settings = { ...db.settings!, sampleData: false, publicPhone: "031-123-4567", teamRates: [{ team: "유리 설치팀", dayRate: 320_000 }] };
    const v = viewFor(PARTNER, db);
    expect(v.settings?.publicPhone).toBe("031-123-4567");
    expect(v.settings?.laborDayRate).toBe(0);
    expect(v.settings?.teamRates).toBeUndefined();
    expect(v.settings?.location).toBeUndefined();
    db.settings = { ...db.settings!, publicPhone: undefined };
    expect(viewFor(PARTNER, db).settings).toBeUndefined();
  });

  it("현장 직원에게는 본인이 입력한 비용과 기본 일당만 (계약·예산·기성·변경공사·팀 단가·이익 없음)", () => {
    const db = createSeed(NOW);
    db.settings = { ...db.settings!, teamRates: [{ team: "유리 설치팀", dayRate: 320_000 }] };
    const v = viewFor(FIELD, db);
    expect(v.thresholds).toMatchObject({ targetMarginPct: 0, marginDropPp: 100 });
    const leaks = moneyPaths(v).filter((p) => !/^\.costEntries\[\d+\]\.amount$|^\.costEntries\[\d+\]\.qty\.dayRate$|^\.settings\.laborDayRate$|^\.thresholds\.marginDropPp$/.test(p));
    expect(leaks).toEqual([]);
    expect(v.costEntries.every((e) => e.createdBy === "u-field")).toBe(true);
    expect(v.settings?.teamRates).toBeUndefined();
    expect(v.billings).toEqual([]);
    expect(v.changeOrders).toEqual([]);
    expect(v.budgets).toEqual([]);
  });

  it("현장 휴대폰에는 최근 60일 + 아직 끝나지 않은 것만 (보완 요청 보고·대기 비용·진행 중 지시는 오래돼도 보냄)", () => {
    const db = createSeed(NOW);
    const old = "2026-07-01"; // 120일 전
    db.attendance = [...(db.attendance ?? []), { id: "att-old", siteId: "site-a", userId: "u-field", workDate: old, inAt: `${old}T07:30:00+09:00`, inGeo: { status: "inside" } as never }];
    db.reports = [
      ...db.reports,
      { id: "rep-old", siteId: "site-a", reportDate: old, workDone: "옛 보고", issues: "", tomorrowPlan: "", photoIds: ["ph-old"], costEntryIds: [], createdBy: "u-field", createdAt: `${old}T17:00:00+09:00`, status: "submitted" },
      { id: "rep-old-returned", siteId: "site-a", reportDate: old, workDone: "보완 요청 받은 옛 보고", issues: "", tomorrowPlan: "", photoIds: ["ph-ret"], costEntryIds: [], createdBy: "u-field", createdAt: `${old}T17:00:00+09:00`, status: "submitted", review: { status: "returned", at: `${old}T18:00:00+09:00`, by: "u-manager", note: "사진 보완" } },
    ];
    db.photos = [...db.photos, { id: "ph-old", siteId: "site-a", dataUrl: "/api/photos/ph-old", caption: "", createdAt: `${old}T16:00:00+09:00`, createdBy: "u-field" }, { id: "ph-ret", siteId: "site-a", dataUrl: "/api/photos/ph-ret", caption: "", createdAt: `${old}T16:00:00+09:00`, createdBy: "u-field" }];
    db.costEntries = [...db.costEntries, { ...db.costEntries[0], id: "ce-old-pending", siteId: "site-a", date: old, createdBy: "u-field", status: "pending" }, { ...db.costEntries[0], id: "ce-old-done", siteId: "site-a", date: old, createdBy: "u-field", status: "active" }];
    db.workOrders = [...(db.workOrders ?? []), { id: "wo-old-open", siteId: "site-a", title: "옛 지시", detail: "", assigneeUserId: "u-field", status: "received", createdAt: `${old}T08:00:00+09:00`, createdBy: "u-manager", history: [] }, { id: "wo-old-done", siteId: "site-a", title: "끝난 옛 지시", detail: "", assigneeUserId: "u-field", status: "confirmed", createdAt: `${old}T08:00:00+09:00`, createdBy: "u-manager", history: [] }];
    const v = viewFor(FIELD, db, NOW);
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(v.attendance ?? [])).not.toContain("att-old");
    expect(ids(v.reports)).not.toContain("rep-old");
    expect(ids(v.reports)).toContain("rep-old-returned");
    expect(ids(v.photos)).toContain("ph-ret");
    expect(ids(v.photos)).not.toContain("ph-old");
    expect(ids(v.costEntries)).toContain("ce-old-pending");
    expect(ids(v.costEntries)).not.toContain("ce-old-done");
    expect(ids(v.workOrders ?? [])).toContain("wo-old-open");
    expect(ids(v.workOrders ?? [])).not.toContain("wo-old-done");
    // 본사(대표·관리자)는 전체 기간을 받는다
    expect(ids(viewFor(MANAGER, db, NOW).attendance ?? [])).toContain("att-old");
  });

  it("현장에 배정된 위험 조치·실증 기록에도 금액 문구가 없다 (미수 조치를 현장에 배정해도)", async () => {
    const { createAction, completeAction } = await import("@/lib/data/commands");
    let db = createSeed(NOW);
    const sig = computeSignals(db, NOW).find((s) => s.rule === "RECEIVABLE_OVERDUE") ?? computeSignals(db, NOW)[0];
    const made = createAction(db, { signal: sig, title: sig.recommendation.actionTitle, description: sig.recommendation.description, assigneeUserId: "u-field", dueDate: "2026-11-10" }, { userId: "u-ceo", now: NOW });
    db = made.db;
    const actionId = (made.result as { actionId: string }).actionId;
    db = completeAction(db, actionId, { result: "현장 확인 완료", confirm: false } as never, { userId: "u-field", now: NOW }).db;
    const v = viewFor(FIELD, db, NOW);
    const text = JSON.stringify({ actions: v.actions, proofEvents: v.proofEvents });
    expect(text).not.toMatch(/\d[\d,.]*\s*(만\s*원|억|원)/);
    const a = v.actions.find((x) => x.id === actionId)!;
    expect(a).toMatchObject({ title: sig.recommendation.actionTitle, signalTitle: "", signalWhy: [], result: "현장 확인 완료" });
    expect(a.claimAmount).toBeUndefined();
    // 현장 화면이 쓰는 확인 상태는 남는다
    if (a.proofEventId) expect(v.proofEvents.find((p) => p.proof_event_id === a.proofEventId)?.status).toBeTruthy();
  });

  it("모든 역할: QR 단말기 비밀값·연결 코드와 중복 방지 키는 내려가지 않는다", () => {
    const db = createSeed(NOW);
    for (const m of [CEO, MANAGER, FIELD, PARTNER]) {
      const v = viewFor(m, db);
      expect(JSON.stringify(v.kiosks ?? [])).not.toMatch(/"secret"|"pairHash"/);
      expect(v.idempotencyKeys).toEqual([]);
    }
  });
});
