import { describe, expect, it } from "vitest";
import { createSeed, DEMO_SCENARIO } from "@/lib/data/seed";
import { siteFinancials, portfolioTotals, simulateApprovedClaims, entryEacImpact } from "@/lib/domain/calc";
import { THEMES, themeTokens, contrast } from "@/lib/theme/themes";
import {
  submitFieldReport,
  voidReport,
  voidCostEntry,
  editCostEntry,
  createAction,
  setActionStatus,
  completeAction,
  confirmProofEvent,
  createPartnerRequest,
  updatePartnerRequest,
  setChangeOrderStatus,
  addPayment,
  CommandError,
} from "@/lib/data/commands";
import { computeSignals } from "@/lib/domain/risk";
import { fmtEok, fmtMan, fmtPct } from "@/lib/domain/format";

const NOW = new Date("2026-10-27T01:00:00.000Z");
const mgr = { userId: "u-manager", now: NOW };
const field = { userId: "u-field", now: NOW };

function scenarioInput(key = "k1") {
  return {
    idempotencyKey: key,
    siteId: DEMO_SCENARIO.siteId,
    reportDate: "2026-10-27",
    workDone: DEMO_SCENARIO.workDone,
    issues: DEMO_SCENARIO.issues,
    tomorrowPlan: DEMO_SCENARIO.tomorrowPlan,
    costs: DEMO_SCENARIO.costs.map((c) => ({ ...c, forecastImpact: "additional" as const })),
    reason: DEMO_SCENARIO.reason,
  };
}

describe("미팅 시나리오 — 가상 현장 A", () => {
  it("초기: 계약 10억 / EAC 8.5억(발생 5.1억 + 잔여 3.4억) / 예상이익 1.5억 / 15%", () => {
    const db = createSeed(NOW);
    const f = siteFinancials(db, "site-a");
    expect(f.contractAmount).toBe(1_000_000_000);
    expect(f.incurred).toBe(510_000_000);
    expect(f.remaining).toBe(340_000_000);
    expect(f.eac).toBe(850_000_000);
    expect(f.expectedProfit).toBe(150_000_000);
    expect(f.marginPct).toBeCloseTo(15, 10);
    expect(f.plannedMarginPct).toBeCloseTo(15, 10);
    expect(fmtEok(f.eac)).toBe("8.5억 원");
    expect(fmtPct(f.marginPct)).toBe("15%");
  });

  it("모바일 추가비용 3,000만 + 1,000만 → EAC 8.9억 / 예상이익 1.1억 / 11% / 이익 감소 4,000만", () => {
    const db0 = createSeed(NOW);
    const { db, result } = submitFieldReport(db0, scenarioInput(), field);
    const f = siteFinancials(db, "site-a");
    expect(f.eac).toBe(890_000_000);
    expect(f.expectedProfit).toBe(110_000_000);
    expect(f.marginPct).toBeCloseTo(11, 10);
    expect(result.before.expectedProfit - result.after.expectedProfit).toBe(40_000_000);
    expect(fmtEok(f.eac)).toBe("8.9억 원");
    expect(fmtEok(f.expectedProfit)).toBe("1.1억 원");
    expect(fmtMan(40_000_000)).toBe("4,000만 원");
    // 원본 db는 불변
    expect(siteFinancials(db0, "site-a").eac).toBe(850_000_000);
  });

  it("계획 내 집행은 EAC를 바꾸지 않는다 (중복 계산 금지)", () => {
    const db0 = createSeed(NOW);
    const { db } = submitFieldReport(
      db0,
      { ...scenarioInput("k-within"), costs: [{ category: "material", amount: 30_000_000, forecastImpact: "within_forecast" }], reason: "planned" },
      field,
    );
    const f = siteFinancials(db, "site-a");
    expect(f.incurred).toBe(540_000_000);
    expect(f.remaining).toBe(310_000_000);
    expect(f.eac).toBe(850_000_000);
    const e = db.costEntries.find((x) => x.source === "FIELD")!;
    expect(entryEacImpact(db, e)).toBe(0);
  });

  it("계획 내 집행이 잔여예상을 넘으면 초과분만 EAC에 반영", () => {
    const db0 = createSeed(NOW);
    const { db } = submitFieldReport(
      db0,
      { ...scenarioInput("k-over"), costs: [{ category: "equipment", amount: 25_000_000, forecastImpact: "within_forecast" }], reason: "planned" },
      field,
    );
    // 장비 잔여 2,000만 → 2,500만 집행 → 초과 500만
    expect(siteFinancials(db, "site-a").eac).toBe(855_000_000);
    const e = db.costEntries.find((x) => x.source === "FIELD")!;
    expect(entryEacImpact(db, e)).toBe(5_000_000);
  });

  it("중복 저장 방지: 같은 idempotencyKey는 거부", () => {
    const { db } = submitFieldReport(createSeed(NOW), scenarioInput("same"), field);
    expect(() => submitFieldReport(db, scenarioInput("same"), field)).toThrow(CommandError);
  });

  it("입력 검증: 0원·음수·사유 누락", () => {
    const db = createSeed(NOW);
    expect(() =>
      submitFieldReport(db, { ...scenarioInput("v1"), costs: [{ category: "material", amount: 0, forecastImpact: "additional" }] }, field),
    ).toThrow(/입력값/);
    expect(() => submitFieldReport(db, { ...scenarioInput("v2"), reason: undefined }, field)).toThrow(/입력값/);
  });

  it("되돌리기(보고 무효)·원가 수정·원가 무효", () => {
    const { db: d1, result } = submitFieldReport(createSeed(NOW), scenarioInput("u1"), field);
    const { db: d2 } = voidReport(d1, result.reportId, mgr);
    expect(siteFinancials(d2, "site-a").eac).toBe(850_000_000);

    const { db: d3 } = editCostEntry(d1, result.entryIds[0], { amount: 20_000_000, category: "material", note: "수정" }, mgr);
    expect(siteFinancials(d3, "site-a").eac).toBe(880_000_000);

    const { db: d4 } = voidCostEntry(d1, result.entryIds[1], "오입력", mgr);
    expect(siteFinancials(d4, "site-a").eac).toBe(880_000_000);
    expect(() => voidCostEntry(d4, result.entryIds[1], "x", mgr)).toThrow(/이미/);
  });
});

describe("규칙 기반 위험 감지", () => {
  it("초기 상태: A현장 신호 없음, B 미수·C 승인대기/목표미달", () => {
    const signals = computeSignals(createSeed(NOW), NOW);
    expect(signals.filter((s) => s.siteId === "site-a")).toHaveLength(0);
    expect(signals.some((s) => s.rule === "RECEIVABLE_OVERDUE" && s.siteId === "site-b")).toBe(true);
    expect(signals.some((s) => s.rule === "PENDING_CHANGE_ORDER" && s.siteId === "site-c")).toBe(true);
    expect(signals.some((s) => s.rule === "BELOW_TARGET_MARGIN" && s.siteId === "site-c")).toBe(true);
  });

  it("시나리오 후: 이익률 하락 15%→11%, 자재비 예산 초과, 설계변경 청구 검토", () => {
    const { db } = submitFieldReport(createSeed(NOW), scenarioInput(), field);
    const a = computeSignals(db, NOW).filter((s) => s.siteId === "site-a");
    const rules = a.map((s) => s.rule).sort();
    expect(rules).toEqual(["COST_OVERRUN", "MARGIN_DROP", "UNBILLED_CHANGE"]);
    const drop = a.find((s) => s.rule === "MARGIN_DROP")!;
    expect(drop.title).toContain("15% → 11%");
    expect(drop.title).toContain("−4%p");
    const unbilled = a.find((s) => s.rule === "UNBILLED_CHANGE")!;
    expect(unbilled.amountAtRisk).toBe(40_000_000);
    expect(unbilled.recommendation.actionTitle).toBe("추가공사 청구가능성 검토");
  });
});

describe("조치 → 완료 → Proof Event → 변경공사 (미승인은 이익 미반영)", () => {
  it("전체 Closed Loop", () => {
    let { db } = submitFieldReport(createSeed(NOW), scenarioInput(), field);
    const signal = computeSignals(db, NOW).find((s) => s.rule === "UNBILLED_CHANGE")!;
    ({ db } = createAction(db, { signal, assigneeUserId: "u-field", dueDate: "2026-10-30" }, mgr));
    const action = db.actions.find((a) => a.signalKey === signal.key)!;
    expect(action.status).toBe("assigned");
    expect(action.kpiBefore.marginPct).toBeCloseTo(11, 10);

    expect(() => createAction(db, { signal }, mgr)).toThrow(/이미/);

    ({ db } = setActionStatus(db, action.id, "in_progress", undefined, field));
    const later = new Date(NOW.getTime() + 15 * 60000);
    ({ db } = completeAction(
      db,
      action.id,
      { result: "발주처 변경 지시 공문·사진 확보, 청구 가능 판단", claimAmount: 40_000_000, registerChangeOrder: true, confirm: true },
      { userId: "u-manager", now: later },
    ));
    const done = db.actions.find((a) => a.id === action.id)!;
    expect(done.status).toBe("done");
    const pe = db.proofEvents[0];
    expect(pe.status).toBe("confirmed");
    expect(pe.data_source).toBe("DEMO_LOCAL");
    expect(pe.decision_method).toContain("규칙 기반");
    expect(pe.kpi_before["예상이익률"]).toBe("11%");
    expect(pe.response_minutes).toBe(15);
    for (const k of ["trigger", "decision", "decision_method", "human_approval", "action", "result", "kpi_before", "kpi_after", "data_source", "user_id", "created_at", "status"]) {
      expect(pe).toHaveProperty(k);
    }

    // 변경공사 '검토 중'은 이익에 반영되지 않는다
    const f = siteFinancials(db, "site-a");
    expect(f.expectedProfit).toBe(110_000_000);
    expect(f.pendingChangeAmount).toBe(40_000_000);
    expect(simulateApprovedClaims(f).marginPct).toBeCloseTo((150 / 1040) * 100, 6);
    // 청구 검토 신호는 해소
    expect(computeSignals(db, later).some((s) => s.rule === "UNBILLED_CHANGE")).toBe(false);

    // 승인되면 그때 계약금액에 가산
    const co = db.changeOrders.find((c) => c.sourceActionId === action.id)!;
    ({ db } = setChangeOrderStatus(db, co.id, "approved", 40_000_000, mgr));
    const f2 = siteFinancials(db, "site-a");
    expect(f2.adjustedContract).toBe(1_040_000_000);
    expect(f2.expectedProfit).toBe(150_000_000);
  });

  it("현장직원이 완료 → 확인 대기 → 관리자 결과 확인", () => {
    let { db } = submitFieldReport(createSeed(NOW), scenarioInput(), field);
    const signal = computeSignals(db, NOW).find((s) => s.rule === "COST_OVERRUN")!;
    ({ db } = createAction(db, { signal, assigneeUserId: "u-field" }, mgr));
    const id = db.actions[0].id;
    ({ db } = completeAction(db, id, { result: "잔여 유리 발주 단가 재견적 2곳 비교" }, field));
    expect(db.proofEvents[0].status).toBe("recorded");
    ({ db } = confirmProofEvent(db, db.proofEvents[0].proof_event_id, mgr));
    expect(db.proofEvents[0].status).toBe("confirmed");
  });
});

describe("파트너 요청 Closed Loop / 정산", () => {
  it("요청 등록 → 검토 → 회신, 파트너는 자기 현장만", () => {
    const partner = { userId: "u-partner", now: NOW };
    let { db } = createPartnerRequest(createSeed(NOW), { idempotencyKey: "p1", siteId: "site-a", title: "3층 유리 사양 변경 검토 요청", description: "삼중유리 적용 범위 확인 요청" }, partner);
    expect(() => createPartnerRequest(db, { idempotencyKey: "p2", siteId: "site-b", title: "x", description: "y" }, partner)).toThrow(/권한/);
    const id = db.partnerRequests[0].id;
    ({ db } = updatePartnerRequest(db, id, { status: "reviewing" }, mgr));
    expect(() => updatePartnerRequest(db, id, { status: "answered" }, mgr)).toThrow(/회신/);
    ({ db } = updatePartnerRequest(db, id, { status: "answered", reply: "변경 범위 확인, 견적 회신 예정", registerChangeOrder: { title: "3층 유리 사양 변경", amount: 25_000_000 } }, mgr));
    const r = db.partnerRequests.find((x) => x.id === id)!;
    expect(r.status).toBe("answered");
    expect(r.linkedChangeOrderId).toBeTruthy();
    expect(siteFinancials(db, "site-a").expectedProfit).toBe(150_000_000);
  });

  it("미수금 = 확정 기성 − 수금, 미수금 초과 입금 거부", () => {
    const db = createSeed(NOW);
    const f = siteFinancials(db, "site-b");
    expect(f.outstanding).toBe(150_000_000);
    expect(() => addPayment(db, { siteId: "site-b", amount: 200_000_000, receivedDate: "2026-10-27" }, mgr)).toThrow(/미수금/);
    const { db: d2 } = addPayment(db, { siteId: "site-b", amount: 50_000_000, receivedDate: "2026-10-27", idempotencyKey: "pay1" }, mgr);
    expect(siteFinancials(d2, "site-b").outstanding).toBe(100_000_000);
    expect(computeSignals(d2, NOW).some((s) => s.rule === "RECEIVABLE_OVERDUE" && s.siteId === "site-b")).toBe(false);
  });

  it("포트폴리오 합계", () => {
    const t = portfolioTotals(createSeed(NOW));
    expect(t.siteCount).toBe(3);
    expect(t.contractAmount).toBe(3_070_000_000);
    expect(t.expectedProfit).toBe(150_000_000 + 80_600_000 + 165_000_000);
  });
});

describe("Theme 대비 (WCAG AA 4.5:1)", () => {
  it("7개 Theme 모두 CTA·흰 글자 배지·강조 텍스트가 4.5:1 이상", () => {
    expect(THEMES).toHaveLength(7);
    for (const t of THEMES) {
      const k = themeTokens(t);
      expect(contrast(k.cta, "#FFFFFF"), `${t.id} cta`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k.solid, "#FFFFFF"), `${t.id} solid`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k.ink, k.activeSoft), `${t.id} ink/soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k.ink, "#FFFFFF"), `${t.id} ink/white`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k.chart1Label.fill, k.chart1Label.text), `${t.id} chart-1 label`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k.chart2Label.fill, k.chart2Label.text), `${t.id} chart-2 label`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k.wordmark, t.core.shell), `${t.id} wordmark/shell`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
