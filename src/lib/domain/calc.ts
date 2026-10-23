/**
 * 현장 손익 계산 엔진 — 결정론적 코드 (LLM에 산술을 맡기지 않는다).
 *
 * EAC(총예상원가) = Σ_c ( 발생원가_c + 잔여예상원가_c )
 *   발생원가_c   = Σ 유효 원가이벤트 (category = c)
 *   잔여예상_c   = max(0, 기준 잔여예상_c − Σ 유효 '계획 내 집행' 이벤트_c)
 * 조정 계약금액 = 계약금액 + Σ 승인(approved) 변경공사
 * 예상이익     = 조정 계약금액 − EAC
 * 예상이익률   = 예상이익 / 조정 계약금액 × 100
 * 미수금       = Σ 확정 기성청구 − Σ 실제 수금
 */
import type { CostCategory, CostEntry, DemoDB, FinancialSnapshot } from "./types";
import { COST_CATEGORIES } from "./labels";

export interface CategoryBreakdown {
  category: CostCategory;
  budget: number;
  incurred: number;
  remaining: number;
  eac: number;
  variance: number; // eac - budget (양수 = 초과)
  variancePct: number;
}

export interface SiteFinancials extends FinancialSnapshot {
  siteId: string;
  plannedMarginPct: number;
  plannedCost: number;
  costProgressPct: number; // 발생원가 / EAC
  physicalProgressPct: number;
  pendingChangeAmount: number; // 승인 전 변경공사(검토·청구 중) — 이익 미반영
  categories: CategoryBreakdown[];
  billed: number;
  received: number;
  outstanding: number;
}

export function activeEntries(entries: CostEntry[], siteId: string): CostEntry[] {
  return entries.filter((e) => e.siteId === siteId && e.status === "active");
}

export function categoryBreakdown(db: DemoDB, siteId: string): CategoryBreakdown[] {
  const entries = activeEntries(db.costEntries, siteId);
  return COST_CATEGORIES.map((category) => {
    const budget = db.budgets.find((b) => b.siteId === siteId && b.category === category)?.amount ?? 0;
    const forecast = db.forecasts.find((f) => f.siteId === siteId && f.category === category)?.remaining ?? 0;
    const inCat = entries.filter((e) => e.category === category);
    const incurred = inCat.reduce((s, e) => s + e.amount, 0);
    const consumedWithin = inCat.filter((e) => e.forecastImpact === "within_forecast").reduce((s, e) => s + e.amount, 0);
    const remaining = Math.max(0, forecast - consumedWithin);
    const eac = incurred + remaining;
    const variance = eac - budget;
    return {
      category,
      budget,
      incurred,
      remaining,
      eac,
      variance,
      variancePct: budget > 0 ? (variance / budget) * 100 : 0,
    };
  });
}

export function siteFinancials(db: DemoDB, siteId: string): SiteFinancials {
  const site = db.sites.find((s) => s.id === siteId);
  const contract = db.contracts.find((c) => c.siteId === siteId);
  if (!site || !contract) throw new Error(`현장을 찾을 수 없습니다: ${siteId}`);

  const categories = categoryBreakdown(db, siteId);
  const incurred = categories.reduce((s, c) => s + c.incurred, 0);
  const remaining = categories.reduce((s, c) => s + c.remaining, 0);
  const eac = incurred + remaining;

  const cos = db.changeOrders.filter((co) => co.siteId === siteId);
  const approvedChange = cos.filter((co) => co.status === "approved").reduce((s, co) => s + (co.approvedAmount ?? co.amount), 0);
  const pendingChangeAmount = cos
    .filter((co) => co.status === "review" || co.status === "submitted")
    .reduce((s, co) => s + co.amount, 0);

  const adjustedContract = contract.contractAmount + approvedChange;
  const expectedProfit = adjustedContract - eac;
  const marginPct = adjustedContract > 0 ? (expectedProfit / adjustedContract) * 100 : 0;
  const plannedMarginPct =
    contract.contractAmount > 0 ? ((contract.contractAmount - contract.plannedCostTotal) / contract.contractAmount) * 100 : 0;

  const billed = db.billings.filter((b) => b.siteId === siteId && b.status === "confirmed").reduce((s, b) => s + b.amount, 0);
  const received = db.payments.filter((p) => p.siteId === siteId).reduce((s, p) => s + p.amount, 0);

  return {
    siteId,
    contractAmount: contract.contractAmount,
    approvedChange,
    adjustedContract,
    incurred,
    remaining,
    eac,
    expectedProfit,
    marginPct,
    plannedMarginPct,
    plannedCost: contract.plannedCostTotal,
    costProgressPct: eac > 0 ? (incurred / eac) * 100 : 0,
    physicalProgressPct: site.progressPct,
    pendingChangeAmount,
    categories,
    billed,
    received,
    outstanding: billed - received,
  };
}

export function snapshotOf(f: SiteFinancials): FinancialSnapshot {
  return {
    contractAmount: f.contractAmount,
    approvedChange: f.approvedChange,
    adjustedContract: f.adjustedContract,
    incurred: f.incurred,
    remaining: f.remaining,
    eac: f.eac,
    expectedProfit: f.expectedProfit,
    marginPct: f.marginPct,
  };
}

export interface PortfolioTotals {
  siteCount: number;
  activeCount: number;
  contractAmount: number;
  adjustedContract: number;
  eac: number;
  expectedProfit: number;
  marginPct: number;
  billed: number;
  received: number;
  outstanding: number;
  pendingChangeAmount: number;
}

export function portfolioTotals(db: DemoDB): PortfolioTotals {
  const fs = db.sites.map((s) => siteFinancials(db, s.id));
  const sum = (k: keyof SiteFinancials) => fs.reduce((s, f) => s + (f[k] as number), 0);
  const adjustedContract = sum("adjustedContract");
  const expectedProfit = sum("expectedProfit");
  return {
    siteCount: db.sites.length,
    activeCount: db.sites.filter((s) => s.status === "active").length,
    contractAmount: sum("contractAmount"),
    adjustedContract,
    eac: sum("eac"),
    expectedProfit,
    marginPct: adjustedContract > 0 ? (expectedProfit / adjustedContract) * 100 : 0,
    billed: sum("billed"),
    received: sum("received"),
    outstanding: sum("outstanding"),
    pendingChangeAmount: sum("pendingChangeAmount"),
  };
}

/**
 * 원가 이벤트 1건이 EAC에 미치는 영향 (보고서·이력 표시용).
 * additional → +amount, within_forecast → 0 (잔여예상 범위 내), baseline → 0
 */
export function entryEacImpact(db: DemoDB, entry: CostEntry): number {
  if (entry.status !== "active") return 0;
  if (entry.forecastImpact === "additional") return entry.amount;
  if (entry.forecastImpact === "within_forecast") {
    // 잔여예상을 초과해 집행된 부분은 EAC를 증가시킨다
    const forecast = db.forecasts.find((f) => f.siteId === entry.siteId && f.category === entry.category)?.remaining ?? 0;
    const within = activeEntries(db.costEntries, entry.siteId)
      .filter((e) => e.category === entry.category && e.forecastImpact === "within_forecast")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let left = forecast;
    for (const e of within) {
      const used = Math.min(left, e.amount);
      left -= used;
      if (e.id === entry.id) return e.amount - used;
    }
  }
  return 0;
}

/** 변경공사가 모두 승인된다고 가정한 시뮬레이션 (화면에서 '미반영 시뮬레이션'으로만 표시) */
export function simulateApprovedClaims(f: SiteFinancials): { adjustedContract: number; expectedProfit: number; marginPct: number } {
  const adjustedContract = f.adjustedContract + f.pendingChangeAmount;
  const expectedProfit = adjustedContract - f.eac;
  return { adjustedContract, expectedProfit, marginPct: adjustedContract > 0 ? (expectedProfit / adjustedContract) * 100 : 0 };
}
