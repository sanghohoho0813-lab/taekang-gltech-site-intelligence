/**
 * TAEKANG SITE INTELLIGENCE — 도메인 타입
 * 모든 금액 단위: 원(KRW), 공급가액 기준(부가세 별도).
 * 이 MVP의 데이터는 전부 DEMO(가상 시연 데이터)이다.
 */

export type RoleId = "ceo" | "manager" | "field" | "partner";

export interface DemoUser {
  id: string;
  role: RoleId;
  name: string;
  title: string;
  /** 파트너 사용자가 볼 수 있는 현장 */
  partnerSiteIds?: string[];
}

export type CostCategory = "material" | "labor" | "subcontract" | "equipment" | "overhead";

/**
 * 원가 이벤트가 EAC(총예상원가)에 반영되는 방식.
 * - baseline: 기준 시점에 이미 잔여예상원가 산정에 반영된 발생원가 (시드)
 * - additional: 예상 외 추가원가 → 발생원가 증가, 잔여예상 유지 → EAC 증가
 * - within_forecast: 계획 내 집행 → 발생원가 증가, 잔여예상 차감 → EAC 불변
 */
export type ForecastImpact = "baseline" | "additional" | "within_forecast";

export type CostReason =
  | "design_change" // 설계변경·발주처 요청
  | "price_increase" // 자재 단가 상승
  | "quantity_increase" // 물량 증가
  | "rework" // 재시공·하자
  | "schedule" // 공기 지연·돌관
  | "planned" // 계획된 집행
  | "other";

export type SiteStatus = "active" | "completed" | "hold";

export interface Site {
  id: string;
  code: string;
  name: string;
  shortName: string;
  workType: string;
  region: string;
  clientId: string;
  clientName: string;
  status: SiteStatus;
  startDate: string; // ISO date
  endDate: string;
  progressPct: number; // 물리적 공정률 (%)
  managerUserId: string;
  fieldUserId: string;
  stages: SiteStage[];
  illustration: "logistics" | "office" | "civic";
}

export interface SiteStage {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progressPct: number;
}

export interface SiteContract {
  siteId: string;
  contractAmount: number; // 원 계약금액 (공급가액)
  signedDate: string;
  /** 계약 시점 계획 이익률 산정의 기준이 된 실행예산 총액 */
  plannedCostTotal: number;
}

export interface CostBudget {
  siteId: string;
  category: CostCategory;
  amount: number;
}

export interface CostForecast {
  siteId: string;
  category: CostCategory;
  /** 기준 시점의 완료까지 잔여 예상원가 */
  remaining: number;
  basisDate: string;
  note?: string;
}

export interface CostEntry {
  id: string;
  siteId: string;
  category: CostCategory;
  amount: number;
  date: string; // 발생일 (ISO date)
  forecastImpact: ForecastImpact;
  reason: CostReason;
  note: string;
  source: "SEED" | "FIELD" | "PC" | "CSV";
  reportId?: string;
  createdBy: string;
  createdAt: string;
  status: "active" | "voided";
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  editedAt?: string;
  editHistory?: { at: string; by: string; before: { amount: number; category: CostCategory; note: string } }[];
}

export interface FieldReport {
  id: string;
  siteId: string;
  reportDate: string;
  workDone: string;
  issues: string;
  tomorrowPlan: string;
  photoIds: string[];
  costEntryIds: string[];
  createdBy: string;
  createdAt: string;
  status: "submitted" | "voided";
}

export interface SitePhoto {
  id: string;
  siteId: string;
  reportId?: string;
  actionId?: string;
  dataUrl: string;
  caption: string;
  createdAt: string;
  createdBy: string;
}

export type ChangeOrderStatus = "review" | "submitted" | "approved" | "rejected";

export interface ChangeOrder {
  id: string;
  siteId: string;
  title: string;
  amount: number; // 청구(요청) 금액 — approved 전에는 계약금액에 가산하지 않음
  approvedAmount?: number;
  status: ChangeOrderStatus;
  requestedAt: string;
  decidedAt?: string;
  sourceEntryIds: string[];
  sourceActionId?: string;
  sourcePartnerRequestId?: string;
  note: string;
}

export interface ProgressBilling {
  id: string;
  siteId: string;
  round: number;
  amount: number;
  billedDate: string;
  status: "confirmed" | "draft";
}

export interface PaymentReceived {
  id: string;
  siteId: string;
  billingId?: string;
  amount: number;
  receivedDate: string;
}

export type PartnerRequestStatus = "received" | "reviewing" | "answered";

export interface PartnerRequest {
  id: string;
  siteId: string;
  partnerUserId: string;
  type: "change_review" | "schedule" | "other";
  title: string;
  description: string;
  desiredDate?: string;
  status: PartnerRequestStatus;
  createdAt: string;
  updatedAt: string;
  reply?: string;
  repliedBy?: string;
  linkedChangeOrderId?: string;
  history: { at: string; status: PartnerRequestStatus; by: string; note?: string }[];
}

export type SignalRule =
  | "MARGIN_DROP"
  | "COST_OVERRUN"
  | "COST_VS_PROGRESS"
  | "UNBILLED_CHANGE"
  | "RECEIVABLE_OVERDUE"
  | "PENDING_CHANGE_ORDER"
  | "BELOW_TARGET_MARGIN";

export type Severity = "high" | "medium" | "low";

export interface RiskSignal {
  key: string; // 안정 식별자: RULE:siteId[:detail]
  rule: SignalRule;
  siteId: string;
  severity: Severity;
  title: string;
  summary: string;
  why: string[]; // 근거 2~4개
  dataUsed: string[];
  threshold: string;
  metric: { label: string; before?: string; current: string };
  recommendation: { actionTitle: string; description: string };
  detectedAt: string;
  causeEntryIds: string[];
  amountAtRisk?: number;
}

export type ActionStatus = "recommended" | "assigned" | "in_progress" | "done" | "on_hold" | "dismissed";

export interface ActionKpiSnapshot {
  at: string;
  eac: number;
  expectedProfit: number;
  marginPct: number;
  adjustedContract: number;
  pendingClaimAmount: number;
}

export interface ActionItem {
  id: string;
  signalKey: string;
  rule: SignalRule;
  siteId: string;
  title: string;
  description: string;
  /** 조치 생성 당시 위험 신호의 제목·근거·감지 시각 (신호는 파생값이므로 사본 보관) */
  signalTitle: string;
  signalWhy: string[];
  signalDetectedAt: string;
  causeEntryIds: string[];
  assigneeUserId?: string;
  dueDate?: string;
  status: ActionStatus;
  createdAt: string;
  createdBy: string;
  approvedBy: string; // 사람 승인(조치 생성 = 관리자 승인)
  kpiBefore: ActionKpiSnapshot;
  notes: { at: string; by: string; text: string; photoId?: string }[];
  history: { at: string; by: string; from?: ActionStatus; to: ActionStatus; note?: string }[];
  result?: string;
  claimAmount?: number;
  changeOrderId?: string;
  completedAt?: string;
  completedBy?: string;
  proofEventId?: string;
}

export type ProofEventStatus = "recorded" | "confirmed";

export interface ProofEvent {
  proof_event_id: string;
  event_type: "RISK_RESPONSE" | "PARTNER_REQUEST";
  site_id: string;
  trigger: string;
  decision: string;
  decision_method: string;
  why: string[];
  human_approval: { by: string; at: string };
  action: string;
  action_id: string;
  result: string;
  kpi_before: Record<string, string | number>;
  kpi_after: Record<string, string | number>;
  data_source: "DEMO_LOCAL";
  user_id: string;
  created_at: string;
  result_confirmed_at?: string;
  confirmed_by?: string;
  evidence_link: string;
  status: ProofEventStatus;
  response_minutes?: number;
}

export interface ActivityLog {
  id: string;
  at: string;
  by: string;
  type: string;
  siteId?: string;
  summary: string;
  link?: string;
}

export interface SignalState {
  status: "open" | "acknowledged";
  updatedAt: string;
  by: string;
}

export interface FinancialSnapshot {
  contractAmount: number;
  approvedChange: number;
  adjustedContract: number;
  incurred: number;
  remaining: number;
  eac: number;
  expectedProfit: number;
  marginPct: number;
}

export interface RiskThresholds {
  targetMarginPct: number;
  marginDropPp: number;
  overrunPct: number;
  costProgressGapPp: number;
  receivableDays: number;
  changeOrderPendingDays: number;
}

export interface DemoDB {
  version: 1;
  rev: number;
  seededAt: string;
  updatedAt: string;
  company: { name: string; product: string; tagline: string };
  users: DemoUser[];
  sites: Site[];
  contracts: SiteContract[];
  budgets: CostBudget[];
  forecasts: CostForecast[];
  costEntries: CostEntry[];
  reports: FieldReport[];
  photos: SitePhoto[];
  changeOrders: ChangeOrder[];
  billings: ProgressBilling[];
  payments: PaymentReceived[];
  partnerRequests: PartnerRequest[];
  signalStates: Record<string, SignalState>;
  actions: ActionItem[];
  proofEvents: ProofEvent[];
  activityLogs: ActivityLog[];
  baseline: Record<string, FinancialSnapshot>;
  thresholds: RiskThresholds;
  idempotencyKeys: string[];
}
