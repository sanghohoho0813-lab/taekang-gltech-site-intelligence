/**
 * TAEKANG SITE INTELLIGENCE — 도메인 타입
 * 모든 금액 단위: 원(KRW), 공급가액 기준(부가세 별도).
 * 이 MVP의 데이터는 전부 DEMO(가상 시연 데이터)이다.
 */
import type { DeviceCheck } from "./device";
import type { Feedback } from "./feedback";

export type RoleId = "ceo" | "manager" | "field" | "partner";

export interface DemoUser {
  id: string;
  role: RoleId;
  name: string;
  title: string;
  /** 파트너 사용자가 볼 수 있는 현장 */
  partnerSiteIds?: string[];
  /** LIVE: 비활성(퇴사·접근 중지) 사용자 — 이력 표시용으로만 남는다 */
  inactive?: boolean;
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
  /** 출퇴근 확인용 현장 위치 (본사가 등록) */
  geo?: SiteGeo;
}

/** 현장 위치 + 인정 반경 */
export interface SiteGeo {
  lat: number;
  lng: number;
  /** 이 거리 안이면 '현장 안' (m) */
  radiusM: number;
  setAt: string;
  setBy: string;
}

/**
 * 위치 판정 (서버가 계산 — 화면이 보낸 판정은 믿지 않는다)
 * inside = 현장 안 · outside = 현장 밖 · weak = 위치 정확도가 낮아 판단 어려움 · none = 위치 없음(거부·실패) · nosite = 현장 위치 미등록
 */
export type GeoStatus = "inside" | "outside" | "weak" | "none" | "nosite";

export interface GeoStamp {
  status: GeoStatus;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  /** 현장 중심까지 거리 (m) */
  distanceM?: number;
  /** 위치가 없을 때 이유 */
  reason?: "denied" | "unavailable" | "timeout" | "unsupported" | "skipped";
  /** 보관 기간이 지났거나 본인이 동의를 철회해 좌표를 지움 (판정만 남음 · D-43) */
  purged?: true;
}

/** 출퇴근 기록 — 본인 휴대폰에서 출근·퇴근 버튼을 누를 때 1번씩 위치를 남긴다 (계속 추적하지 않음) */
export interface AttendanceRecord {
  id: string;
  siteId: string;
  userId: string;
  /** 근무일 (서버 기준, 한국 시간) */
  workDate: string;
  /** 출근 시각 (서버 시각) */
  inAt: string;
  inGeo: GeoStamp;
  /** 같은 휴대폰으로 여러 명이 출근하는지 확인용 (기기 무작위 번호) */
  inDevice?: string;
  /** 현장 QR 확인 결과 (현장 태블릿의 30초마다 바뀌는 QR) */
  inQr?: QrStamp;
  outAt?: string;
  outGeo?: GeoStamp;
  outDevice?: string;
  /** 직원 수정 요청을 본사가 승인해 만든 기록 (GPS 없음) */
  fromRequestId?: string;
  /** 본사가 승인한 예외 사유 (GPS 실패 등) — 위치 의심 표시 대신 이 사유를 보여준다 */
  exceptionNote?: string;
  /** 본사 정정 이력 (사유 필수) */
  corrections?: { at: string; by: string; note: string; before: { inAt: string; outAt?: string } }[];
}

/** QR 확인 결과 — ok = 방금 그 현장 단말기에 떠 있던 QR */
export interface QrStamp {
  status: "ok" | "expired" | "invalid" | "wrong_site" | "revoked";
  kioskId?: string;
}

/**
 * 현장 QR 단말기 (현장 사무실 태블릿)
 * secret은 서버와 그 태블릿만 안다 — 화면 데이터로는 절대 내려보내지 않는다.
 */
export interface Kiosk {
  id: string;
  siteId: string;
  name: string;
  secret?: string;
  createdAt: string;
  createdBy: string;
  /** 연결 코드(해시) — 태블릿이 한 번 쓰면 지운다 */
  pairHash?: string;
  pairExpiresAt?: string;
  pairedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  lastUsedAt?: string;
}

/**
 * 작업 인원 확인 (출력) — 현장소장·반장이 팀별 오늘 인원을 단체 사진·위치와 함께 보고
 * 직영이면 급여, 외주면 팀 기성 확인의 근거. 인건비 공수 보고와 자동 대조한다.
 */
export interface CrewCheck {
  id: string;
  siteId: string;
  /** 근무일 (서버 기준, 한국 시간) */
  workDate: string;
  /** 팀·업체 이름 (예: 유리 설치팀 / ○○산업) */
  team: string;
  kind: "direct" | "subcontract";
  headcount: number;
  photoId?: string;
  /** 같은 사진을 다른 날 다시 쓰는지 확인용 (사진 내용의 SHA-256) */
  photoHash?: string;
  geo?: GeoStamp;
  /** 보낸 시각 (서버) */
  at: string;
  by: string;
  /** 같은 날 같은 팀을 다시 보내면 인원이 바뀐 이력 */
  history?: { at: string; by: string; headcount: number }[];
  /** 본사가 출력일보에서 가져온 과거 기록 (사진·위치 확인 대상 아님) */
  imported?: boolean;
  importBatchId?: string;
}

export type ImportKind = "billing" | "change" | "crew" | "rates" | "cost";

/** 자료 가져오기 1회 — 7일 안에는 통째로 취소할 수 있도록 이전 값을 함께 남긴다 */
export interface ImportBatch {
  id: string;
  kind: ImportKind;
  at: string;
  by: string;
  count: number;
  skipped: number;
  siteIds: string[];
  /** 기준선을 다시 잡기 전 값 (취소 시 되돌림) */
  prevBaseline?: Record<string, FinancialSnapshot | null>;
  prevTeamRates?: { team: string; dayRate: number }[];
  undoneAt?: string;
  undoneBy?: string;
}

/** 위치 기록 동의 (개인위치정보 수집 동의) */
export interface LocationConsent {
  userId: string;
  at: string;
  /** 동의 문구 판 */
  version: number;
  /** 동의할 때 알린 보관 기간 (일, null = 회사가 정하는 기간) — 더 길어지면 다시 동의받음 */
  retentionDays?: number | null;
  /** 동의할 때 알린 볼 수 있는 사람 — 넓어지면 다시 동의받음 */
  viewers?: "ceo" | "hq";
}

/** 개인위치정보 운영 규칙 (대표가 정함 · D-43) */
export interface LocationPolicy {
  /** 좌표 보관 기간 (일). null = 아직 정하지 않음 (자동 삭제 안 함) */
  retentionDays: number | null;
  /** 좌표를 볼 수 있는 사람: ceo = 대표만, hq = 대표·관리자 (직원 본인은 언제나 자기 기록을 봄) */
  viewers: "ceo" | "hq";
  /** 마지막 자동 삭제 날짜 (하루 한 번) */
  purgedOn?: string;
  /** 규칙을 바꾼 시각 */
  updatedAt?: string;
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
  /** 재추정 시각 (ISO). 있으면 이 시각 이후 등록된 '실행예산 내 집행'만 잔여에서 차감 — 재추정 전 집행분 이중 차감 방지 */
  basisAt?: string;
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
  /** pending = 공무 확인 대기 (손익 미반영), rejected = 공무 반려 */
  status: "active" | "voided" | "pending" | "rejected";
  /** 노무비를 공수 × 일당으로 입력한 경우 */
  qty?: { manDays: number; dayRate: number };
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  editedAt?: string;
  editHistory?: { at: string; by: string; before: { amount: number; category: CostCategory; note: string } }[];
  /** 자료 가져오기 묶음 (가져오기 취소용) */
  importBatchId?: string;
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
  /** 보고를 보낸 곳 (현장 안/밖) */
  geo?: GeoStamp;
  /** 관련 본사 작업지시 */
  workOrderId?: string;
  /** 본사 확인 — confirmed = 확인, returned = 보완 요청 (없으면 확인 전) */
  review?: { status: "confirmed" | "returned"; at: string; by: string; note?: string };
  /** 보완 요청 뒤 현장이 덧붙인 내용 */
  supplements?: { at: string; by: string; text: string; photoIds: string[] }[];
  /** 이 보고로 바뀐 공정 단계 진척 (공사일보용) */
  stages?: { stageId: string; name: string; from: number; to: number }[];
}

/** 근태 수정 요청 (GPS 실패·출퇴근 누락·잘못 찍힘) — 직원이 사유와 함께 요청, 본사가 승인·반려 */
export interface AttendanceRequest {
  id: string;
  siteId: string;
  userId: string;
  workDate: string;
  kind: "missed_in" | "missed_out" | "gps_issue" | "wrong_time";
  /** 요청하는 출근·퇴근 시각 (한국 시간 HH:MM) */
  inTime?: string;
  outTime?: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  /** 승인으로 고치거나 만든 출퇴근 기록 */
  attendanceId?: string;
}

/** 본사 → 현장 작업지시: 지시 → 접수 → 진행 → 완료 → 본사 확인 (또는 보완 요청) */
export interface WorkOrder {
  id: string;
  siteId: string;
  title: string;
  detail: string;
  assigneeUserId: string;
  dueDate?: string;
  urgent?: boolean;
  status: "sent" | "received" | "in_progress" | "done" | "confirmed" | "returned";
  createdAt: string;
  createdBy: string;
  doneNote?: string;
  /** 작업량 (예: 유닛 10개) */
  doneQty?: string;
  donePhotoIds?: string[];
  returnNote?: string;
  history: { at: string; by: string; to: WorkOrder["status"]; note?: string }[];
}

export interface SitePhoto {
  id: string;
  siteId: string;
  reportId?: string;
  actionId?: string;
  /** 작업 인원(출력) 단체 사진 */
  crewId?: string;
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
  /** 자료 가져오기 묶음 (가져오기 취소용) */
  importBatchId?: string;
}

export interface ProgressBilling {
  id: string;
  siteId: string;
  round: number;
  amount: number;
  billedDate: string;
  status: "confirmed" | "draft";
  /** 자료 가져오기 묶음 (가져오기 취소용) */
  importBatchId?: string;
}

export interface PaymentReceived {
  id: string;
  siteId: string;
  billingId?: string;
  amount: number;
  receivedDate: string;
  /** 자료 가져오기 묶음 (가져오기 취소용) */
  importBatchId?: string;
}

export type PartnerRequestStatus = "received" | "reviewing" | "answered";

export interface PartnerRequest {
  id: string;
  siteId: string;
  partnerUserId: string;
  /** quote 견적 문의 · order 주문 요청 (계약 모듈 06·검수 S7) */
  type: "quote" | "order" | "change_review" | "schedule" | "other";
  title: string;
  description: string;
  /** 견적·주문: 품목·사양 / 수량 (자유 입력 — 예: “12장”, “약 40㎡”) */
  item?: string;
  qty?: string;
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
  data_source: "DEMO_LOCAL" | "LIVE";
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

/** 회사 운영 설정 (LIVE 운영에서 대표·관리자가 변경) */
export interface CompanySettings {
  /** 현장 입력 원가 반영 방식: immediate = 저장 즉시 손익 반영, review = 본사 공무 확인 후 반영 */
  costApproval: "immediate" | "review";
  /** 노무 공수 입력 시 기본 일당 (원) */
  laborDayRate: number;
  /** 최초 설정 때 '가상 현장으로 시작'을 고른 회사 — 화면에 가상 데이터 표시를 계속 띄운다 (운영 설정으로 끌 수 없음) */
  sampleData?: boolean;
  /** 현장 직원 화면의 '본사에 전화하기' 번호 (비우면 버튼 숨김) */
  helpPhone?: string;
  /** 출근 방식: gps = GPS만 / qr = 현장 QR + GPS (현장 태블릿 필요) */
  attendanceMode?: "gps" | "qr";
  /** 작업 인원(출력) 팀별 기준 단가 (1인 1일, 원) — 인건비 추정용 */
  teamRates?: { team: string; dayRate: number }[];
  /** 개인위치정보 보관 기간·볼 수 있는 사람 (없으면 기간 미정·대표와 관리자) */
  location?: LocationPolicy;
}

export const DEFAULT_SETTINGS: CompanySettings = { costApproval: "immediate", laborDayRate: 300_000 };

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
  settings?: CompanySettings;
  /** 출퇴근 기록 (이전 버전 DEMO 저장분에는 없을 수 있음) */
  attendance?: AttendanceRecord[];
  consents?: LocationConsent[];
  /** 휴대폰 점검 결과 — 사람마다 마지막 1개 (D-46) */
  deviceChecks?: DeviceCheck[];
  /** 현장·본사 앱 의견 (D-47) */
  feedback?: Feedback[];
  kiosks?: Kiosk[];
  crewChecks?: CrewCheck[];
  attendanceRequests?: AttendanceRequest[];
  workOrders?: WorkOrder[];
  importBatches?: ImportBatch[];
  /** LIVE: 현재 로그인 사용자 id (서버가 채움). DEMO에서는 없음 */
  me?: string;
  /** LIVE: 서버가 역할별로 걸러 보낸 데이터인지 */
  scope?: "full" | "field" | "partner";
}
