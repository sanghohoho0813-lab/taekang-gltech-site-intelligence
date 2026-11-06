/** D-66 안정화 2차 점검에서 재현된 버그들의 재발 방지 테스트 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { addBilling, addPayment, assignAction, createAction, CommandError, errorMessage, submitFieldReport, updatePartnerRequest, createPartnerRequest } from "@/lib/data/commands";
import { requestAttendanceFix, reviewAttendanceFix, reviewReport, supplementReport, createWorkOrder } from "@/lib/data/opsCommands";
import { importData, undoImport } from "@/lib/data/importCommands";
import { planImport, parseQtyCell, parseWonCell, normDate } from "@/lib/domain/importers";
import { periodSummary } from "@/lib/domain/attendance";
import { computeSignals } from "@/lib/domain/risk";
import { siteFinancials } from "@/lib/domain/calc";
import { fmtEok } from "@/lib/domain/format";
import { hasMoney, stripMoney } from "@/lib/domain/redact";
import { authorize, viewFor, ForbiddenError } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z"); // 12:00 KST
const ctx = (userId: string, now = NOW) => ({ userId, now });
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const FIELD = member("u-field", "field");

describe("현장 직원에게 금액이 가지 않는다", () => {
  it("활동 이력 문구의 예상 총원가·금액을 지우고 보낸다", () => {
    const r = submitFieldReport(createSeed(NOW), { idempotencyKey: "k1", siteId: "site-a", reportDate: "2026-11-04", workDone: "추가 자재", costs: [{ category: "material", amount: 30_000_000, forecastImpact: "additional", note: "" }], reason: "design_change" }, ctx("u-field"));
    expect(r.db.activityLogs.some((l) => l.by === "u-field" && hasMoney(l.summary))).toBe(true); // 본사용 문구에는 금액이 있다
    const v = viewFor(FIELD, r.db, NOW);
    expect(v.activityLogs.length).toBeGreaterThan(0);
    for (const l of v.activityLogs) expect(hasMoney(l.summary), l.summary).toBe(false);
  });
  it("금액 지우기: 억·만·원, 손익 구절", () => {
    expect(stripMoney("A현장 현장보고 + 원가 2건 4,000만 원 등록 → 예상 총원가 8.5억 원 → 8.9억 원")).toBe("A현장 현장보고 + 원가 2건 등록");
    expect(stripMoney("원가 수정 자재 → 1억 5,000만 원 · 예상 총원가 8.5억 원 → 8.6억 원")).toBe("원가 수정 자재");
    expect(stripMoney("작업 인원 5명 보고")).toBe("작업 인원 5명 보고");
  });
  it("현장 직원이 조치를 완료해도 변경공사(금액)는 만들 수 없다", () => {
    const db = createSeed(NOW);
    const sig = computeSignals(db, NOW)[0];
    const a = createAction(db, { signal: sig, assigneeUserId: "u-field" }, ctx("u-manager"));
    const actionId = a.db.actions.find((x) => x.signalKey === sig.key)!.id;
    const args = authorize(FIELD, "completeAction", { actionId, input: { result: "처리함", registerChangeOrder: true, claimAmount: 4_900_000_000 } }, a.db, NOW) as { input: Record<string, unknown> };
    expect(args.input.registerChangeOrder).toBe(false);
    expect(args.input.claimAmount).toBeUndefined();
  });
  it("현장 입력 1건은 1억 원까지 (원 단위 실수 방지)", () => {
    const db = createSeed(NOW);
    expect(() => authorize(FIELD, "submitFieldReport", { siteId: "site-a", costs: [{ amount: 3_500_000_000 }] }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(FIELD, "submitFieldReport", { siteId: "site-a", costs: [{ amount: 3_500_000 }] }, db, NOW)).not.toThrow();
  });
  it("‘추가 비용’ 보고에 비용이 0건이면 받지 않는다", () => {
    expect(() => submitFieldReport(createSeed(NOW), { idempotencyKey: "k0", siteId: "site-a", reportDate: "2026-11-04", workDone: "추가 비용", costs: [], kind: "cost" }, ctx("u-field"))).toThrow(CommandError);
  });
});

describe("자료 가져오기", () => {
  it("가져오기는 그 묶음의 변화만큼만 기준선을 옮긴다 — 그 전 현장 보고 변화는 보고서에 남는다", () => {
    const r1 = submitFieldReport(createSeed(NOW), { idempotencyKey: "k2", siteId: "site-a", reportDate: "2026-11-04", workDone: "추가", costs: [{ category: "material", amount: 30_000_000, forecastImpact: "additional", note: "" }], reason: "design_change" }, ctx("u-manager"));
    const gap = (db: DemoDB) => siteFinancials(db, "site-a").expectedProfit - db.baseline["site-a"].expectedProfit;
    expect(gap(r1.db)).toBe(-30_000_000);
    const imp = importData(r1.db, { kind: "change", text: "현장,제목,금액,상태,요청일,결정일\nA현장,추가창,10000000,승인,2026-10-10,2026-10-20", idempotencyKey: "i1" }, ctx("u-manager"));
    expect(gap(imp.db)).toBe(-30_000_000); // 예전에는 0으로 덮어씀
    const u = undoImport(imp.db, { batchId: imp.result.batchId }, ctx("u-manager", new Date(NOW.getTime() + 1000)));
    expect(u.db.baseline["site-a"].expectedProfit).toBeCloseTo(r1.db.baseline["site-a"].expectedProfit, 6);
  });
  it("같은 파일 안 같은 줄은 한 번만, 미래 날짜는 거부", () => {
    const db = createSeed(NOW);
    const p = planImport(db, "crew", "현장,날짜,팀,구분,인원\nA현장,2026-10-20,창호1팀,외주,5\nA현장,2026-10-20,창호1팀,외주,5", "2026-11-04");
    expect(p.rows).toHaveLength(1);
    expect(p.duplicates[0].text).toContain("같은 내용");
    const f = planImport(db, "billing", "현장,구분,날짜,금액\nA현장,기성,2027-12-31,10000000", "2026-11-04");
    expect(f.errors.some((e) => e.message.includes("오늘 이후"))).toBe(true);
  });
  it("숫자·날짜 해석: 쉼표 위치·16진수·시각 붙은 날짜", () => {
    expect(parseWonCell("12,000")).toBe(12000);
    expect(Number.isNaN(parseWonCell("12,00"))).toBe(true);
    expect(Number.isNaN(parseQtyCell("1,5"))).toBe(true);
    expect(parseQtyCell("1,500.5")).toBe(1500.5);
    expect(normDate("2026-10-20 14:30")).toBe("2026-10-20");
    const p = planImport(createSeed(NOW), "crew", "현장,날짜,팀,구분,인원\nA현장,2026-10-20,창호1팀,외주,0x10", "2026-11-04");
    expect(p.errors.length).toBe(1);
  });
  it("팀 단가 가져오기를 취소해도 그 뒤 설정에서 넣은 다른 팀 단가는 남는다", () => {
    const imp = importData(createSeed(NOW), { kind: "rates", text: "팀,단가\n창호1팀,320000", idempotencyKey: "r1" }, ctx("u-manager"));
    const later = { ...imp.db, settings: { ...imp.db.settings!, teamRates: [...(imp.db.settings?.teamRates ?? []), { team: "나중팀", dayRate: 250_000 }] } };
    const u = undoImport(later, { batchId: imp.result.batchId }, ctx("u-manager"));
    expect(u.db.settings?.teamRates?.map((t) => t.team)).toEqual(["나중팀"]);
  });
});

describe("출퇴근", () => {
  it("하루에 두 현장을 오가도 월 출근일수는 1일", () => {
    const db = createSeed(NOW);
    db.attendance = [
      { id: "x1", siteId: "site-a", userId: "u-x", workDate: "2026-11-03", inAt: "2026-11-02T23:00:00.000Z", outAt: "2026-11-03T03:00:00.000Z", inGeo: { status: "none" } },
      { id: "x2", siteId: "site-b", userId: "u-x", workDate: "2026-11-03", inAt: "2026-11-03T04:00:00.000Z", outAt: "2026-11-03T08:00:00.000Z", inGeo: { status: "none" } },
    ] as DemoDB["attendance"];
    expect(periodSummary(db, "2026-11-01", "2026-11-30").find((r) => r.userId === "u-x")!.days).toBe(1);
  });
  it("야간 근무: 21:00 출근 → 다음 날 06:00 퇴근 요청을 승인할 수 있다", () => {
    const now = new Date("2026-11-04T01:00:00Z"); // 11/04 10:00 KST
    const db = createSeed(now);
    db.attendance = [...(db.attendance ?? []), { id: "night", siteId: "site-b", userId: "u-field", workDate: "2026-11-03", inAt: "2026-11-03T12:00:00.000Z", inGeo: { status: "none" } } as never];
    const q = requestAttendanceFix(db, { siteId: "site-b", workDate: "2026-11-03", kind: "missed_out", outTime: "06:00", reason: "야간 작업" }, ctx("u-field", now));
    const { db: d2 } = reviewAttendanceFix(q.db, { requestId: q.result.requestId, decision: "approve" }, ctx("u-manager", now));
    expect(d2.attendance!.find((r) => r.id === "night")!.outAt).toBe("2026-11-03T21:00:00.000Z"); // 11/04 06:00 KST
  });
});

describe("권한·상태 검증", () => {
  it("확인된 보고는 보완할 수 없고, 현장이 취소할 수도 없다", () => {
    const r = submitFieldReport(createSeed(NOW), { idempotencyKey: "k3", siteId: "site-a", reportDate: "2026-11-04", workDone: "작업" }, ctx("u-field"));
    const ok = reviewReport(r.db, { reportId: r.result.reportId, decision: "confirm" }, ctx("u-manager")).db;
    expect(() => supplementReport(ok, { reportId: r.result.reportId, text: "덧붙임" }, ctx("u-field"))).toThrow(CommandError);
    expect(() => authorize(FIELD, "voidReport", { reportId: r.result.reportId }, ok, NOW)).toThrow(ForbiddenError);
  });
  it("조치 담당자는 본사 직원이나 그 현장 담당만 (발주처 불가)", () => {
    const db = createSeed(NOW);
    const sig = computeSignals(db, NOW)[0];
    expect(() => createAction(db, { signal: sig, assigneeUserId: "u-partner" }, ctx("u-manager"))).toThrow(CommandError);
    const a = createAction(db, { signal: sig }, ctx("u-manager"));
    const id = a.db.actions.find((x) => x.signalKey === sig.key)!.id;
    expect(() => assignAction(a.db, id, "u-partner", undefined, ctx("u-manager"))).toThrow(CommandError);
    expect(() => assignAction(a.db, id, "u-manager", undefined, ctx("u-manager"))).not.toThrow();
  });
  it("기성·입금 날짜는 실제 달력 날짜이고 오늘 이후가 아니어야 한다 · 계약 120% 넘는 기성 거부", () => {
    const db = createSeed(NOW);
    expect(() => addBilling(db, { siteId: "site-a", amount: 10_000_000, billedDate: "2025-13-01" }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => addPayment(db, { siteId: "site-a", amount: 1_000_000, receivedDate: "2030-01-01" }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => addBilling(db, { siteId: "site-a", amount: 5_000_000_000, billedDate: "2026-11-01" }, ctx("u-manager"))).toThrow(/120%|1건 금액/);
  });
  it("발주처 요청 하나에 변경공사는 하나", () => {
    const db = createSeed(NOW);
    const pr = createPartnerRequest(db, { idempotencyKey: "p1", siteId: "site-a", type: "change_review", title: "창 추가", description: "3층 창 2개 추가 견적" }, ctx("u-partner"));
    const r1 = updatePartnerRequest(pr.db, pr.result.requestId, { status: "reviewing", registerChangeOrder: { title: "창 추가", amount: 5_000_000 } }, ctx("u-manager"));
    expect(() => updatePartnerRequest(r1.db, pr.result.requestId, { status: "answered", reply: "검토 완료", registerChangeOrder: { title: "창 추가", amount: 5_000_000 } }, ctx("u-manager"))).toThrow(/이미 등록/);
  });
  it("작업지시 기한은 오늘 이후만", () => {
    expect(() => createWorkOrder(createSeed(NOW), { siteId: "site-a", title: "점검", dueDate: "2026-10-01" }, ctx("u-manager"))).toThrow(CommandError);
  });
  it("예산 0원 항목에 쓴 돈은 ‘예산 없이 지출’ 신호", () => {
    const db = createSeed(NOW);
    db.budgets = db.budgets.map((b) => (b.siteId === "site-a" && b.category === "equipment" ? { ...b, amount: 0 } : b));
    const s = computeSignals(db, NOW).find((x) => x.key === "COST_OVERRUN:site-a:equipment");
    const eq = siteFinancials(db, "site-a").categories.find((c) => c.category === "equipment")!;
    if (eq.eac > 0) expect(s?.title).toContain("예산 없이");
  });
});

describe("표시", () => {
  it("서버가 알려 준 항목별 이유를 보여 준다", () => {
    expect(errorMessage(new CommandError("입력값을 확인해주세요.", "VALIDATION", { outTime: "아직 지나지 않은 시각이에요." }))).toBe("아직 지나지 않은 시각이에요.");
    expect(errorMessage(new CommandError("입력값을 확인해주세요.", "VALIDATION", { title: "필수" }))).toBe("입력값을 확인해주세요.");
  });
  it("‘단위 억 원’ 표에서는 1억 미만도 억으로", () => {
    expect(fmtEok(80_600_000, { unit: false })).toBe("0.81");
    expect(fmtEok(80_600_000)).toBe("8,060만 원");
  });
});
