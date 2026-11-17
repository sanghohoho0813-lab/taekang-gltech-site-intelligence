/**
 * 현장 손익 계산 엔진 — 결정론적 코드 (LLM에 산술을 맡기지 않는다).
 *
 * EAC(예상 총원가) = Σ_c ( 발생원가_c + 잔여예상원가_c )
 *   발생원가_c   = Σ 유효 원가이벤트 (category = c)
 *   잔여예상_c   = max(0, 기준 잔여예상_c − Σ 유효 '계획 내 집행' 이벤트_c)
 * 변경 반영 계약금액 = 계약금액 + Σ 승인(approved) 변경공사
 * 예상이익     = 변경 반영 계약금액 − Σ 발주처 공제(지체상금·상계 · D-89) − 예상 총원가
 * 예상이익률   = 예상이익 / (변경 반영 계약금액 − 공제) × 100
 * 미수금       = Σ 확정 기성청구 − Σ 실제 수금 − Σ 공제   (그중 유보금은 받을 돈 · D-89)
 */
import type { CostCategory, CostEntry, DemoDB, FinancialSnapshot } from "./types";
import { COST_CATEGORIES } from "./labels";
import { deductedTotal, retentionOpen } from "./receivables";

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
  /** 발주처 공제 누계 (받지 못하는 돈 · 예상이익에서 뺌 · D-89) */
  deducted: number;
  /** 미수 중 아직 안 받은 유보금 (D-89) */
  retention: number;
}

export function activeEntries(entries: CostEntry[], siteId: string): CostEntry[] {
  return entries.filter((e) => e.siteId === siteId && e.status === "active");
}

/**
 * 원가가 손익에 들어온 시각 — 공무 확인 방식이면 확인한 시각, 아니면 입력 시각.
 * 재추정 전에 입력됐지만 재추정 뒤에 확인된 원가는 재추정 화면의 ‘발생’에 없었으므로 새 잔여예상에서 빠져야 한다 (D-79 대표 점검 —
 * 확인 대기 1,000만 원을 재추정 뒤 승인하면 잔여예상에서 안 빠져 이익이 1,000만 원 더 줄던 문제)
 */
export function activeAt(e: CostEntry): string {
  return e.reviewedAt && e.reviewedAt > e.createdAt ? e.reviewedAt : e.createdAt;
}

/** 잔여예상 재추정 이후에 손익에 들어온 원가인지 (재추정 전 집행분은 이미 새 잔여예상에 반영됨) */
function afterBasis(e: CostEntry, basisAt: string | undefined): boolean {
  return !basisAt || activeAt(e) >= basisAt;
}

export function categoryBreakdown(db: DemoDB, siteId: string): CategoryBreakdown[] {
  const entries = activeEntries(db.costEntries, siteId);
  return COST_CATEGORIES.map((category) => {
    const budget = db.budgets.find((b) => b.siteId === siteId && b.category === category)?.amount ?? 0;
    const fc = db.forecasts.find((f) => f.siteId === siteId && f.category === category);
    const forecast = fc?.remaining ?? 0;
    const inCat = entries.filter((e) => e.category === category);
    const incurred = inCat.reduce((s, e) => s + e.amount, 0);
    const consumedWithin = inCat.filter((e) => e.forecastImpact === "within_forecast" && afterBasis(e, fc?.basisAt)).reduce((s, e) => s + e.amount, 0);
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
  // 발주처가 떼고 주는 공제(지체상금·상계)는 받지 못하는 돈 — 예상이익에서 뺀다 (D-89). 계약금액(기성률·계약 초과 기준)은 그대로
  const deducted = deductedTotal(db, siteId);
  const revenue = adjustedContract - deducted;
  const expectedProfit = revenue - eac;
  const marginPct = revenue > 0 ? (expectedProfit / revenue) * 100 : 0;
  const plannedMarginPct =
    contract.contractAmount > 0 ? ((contract.contractAmount - contract.plannedCostTotal) / contract.contractAmount) * 100 : 0;

  const billed = db.billings.filter((b) => b.siteId === siteId && b.status === "confirmed").reduce((s, b) => s + b.amount, 0);
  const received = db.payments.filter((p) => p.siteId === siteId).reduce((s, p) => s + p.amount, 0);
  const outstanding = billed - received - deducted;

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
    outstanding,
    deducted,
    retention: Math.min(Math.max(0, outstanding), retentionOpen(db, siteId)),
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
    ...(f.deducted ? { deducted: f.deducted } : {}),
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
  deducted: number;
  retention: number;
  pendingChangeAmount: number;
}

export function portfolioTotals(db: DemoDB): PortfolioTotals {
  const fs = db.sites.map((s) => siteFinancials(db, s.id));
  const sum = (k: keyof SiteFinancials) => fs.reduce((s, f) => s + (f[k] as number), 0);
  const adjustedContract = sum("adjustedContract");
  const expectedProfit = sum("expectedProfit");
  const deducted = sum("deducted");
  return {
    siteCount: db.sites.length,
    activeCount: db.sites.filter((s) => s.status === "active").length,
    contractAmount: sum("contractAmount"),
    adjustedContract,
    eac: sum("eac"),
    expectedProfit,
    marginPct: adjustedContract - deducted > 0 ? (expectedProfit / (adjustedContract - deducted)) * 100 : 0,
    billed: sum("billed"),
    received: sum("received"),
    outstanding: sum("outstanding"),
    deducted,
    retention: sum("retention"),
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
    const fc = db.forecasts.find((f) => f.siteId === entry.siteId && f.category === entry.category);
    if (!afterBasis(entry, fc?.basisAt)) return 0;
    const forecast = fc?.remaining ?? 0;
    const within = activeEntries(db.costEntries, entry.siteId)
      .filter((e) => e.category === entry.category && e.forecastImpact === "within_forecast" && afterBasis(e, fc?.basisAt))
      .sort((a, b) => activeAt(a).localeCompare(activeAt(b)));
    let left = forecast;
    for (const e of within) {
      const used = Math.min(left, e.amount);
      left -= used;
      if (e.id === entry.id) return e.amount - used;
    }
  }
  return 0;
}

/**
 * 현장 원가 전부의 EAC 영향을 한 번에 (D-85 — 원가마다 같은 항목을 다시 정렬하던 O(n²)를 O(n log n)으로).
 * entryEacImpact와 같은 규칙: 추가 원가는 전액, 계획 안 집행은 잔여예상 기준 시각 뒤에 들어온 순서대로 잔여예상을 넘은 만큼.
 */
export function siteEacImpacts(db: DemoDB, siteId: string): Map<string, number> {
  const out = new Map<string, number>();
  const active = activeEntries(db.costEntries, siteId);
  for (const e of active) if (e.forecastImpact === "additional") out.set(e.id, e.amount);
  for (const c of COST_CATEGORIES) {
    const fc = db.forecasts.find((f) => f.siteId === siteId && f.category === c);
    const within = active.filter((e) => e.category === c && e.forecastImpact === "within_forecast" && afterBasis(e, fc?.basisAt)).sort((a, b) => activeAt(a).localeCompare(activeAt(b)));
    let left = fc?.remaining ?? 0;
    for (const e of within) {
      const used = Math.min(left, e.amount);
      left -= used;
      out.set(e.id, e.amount - used);
    }
  }
  return out;
}

/** 변경공사가 모두 승인된다고 가정한 시뮬레이션 (화면에서 '미반영 시뮬레이션'으로만 표시) */
export function simulateApprovedClaims(f: SiteFinancials): { adjustedContract: number; expectedProfit: number; marginPct: number } {
  const adjustedContract = f.adjustedContract + f.pendingChangeAmount;
  const expectedProfit = adjustedContract - f.eac;
  return { adjustedContract, expectedProfit, marginPct: adjustedContract > 0 ? (expectedProfit / adjustedContract) * 100 : 0 };
}
