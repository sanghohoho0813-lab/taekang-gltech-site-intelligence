import type {
  ActionStatus,
  ChangeOrderStatus,
  CostCategory,
  CostReason,
  ForecastImpact,
  PartnerRequestStatus,
  RoleId,
  Severity,
  SignalRule,
} from "./types";

export const COST_CATEGORIES: CostCategory[] = ["material", "labor", "subcontract", "equipment", "overhead"];

export const CATEGORY_LABEL: Record<CostCategory, string> = {
  material: "자재비",
  labor: "노무비(인건비)",
  subcontract: "외주비",
  equipment: "장비비",
  overhead: "현장경비",
};

export const CATEGORY_SHORT: Record<CostCategory, string> = {
  material: "자재",
  labor: "노무",
  subcontract: "외주",
  equipment: "장비",
  overhead: "경비",
};

export const IMPACT_LABEL: Record<ForecastImpact, string> = {
  baseline: "기준 발생원가",
  additional: "예상 외 추가원가",
  within_forecast: "계획 내 집행",
};

export const IMPACT_HELP: Record<ForecastImpact, string> = {
  baseline: "기준 시점에 이미 잔여예상원가 산정에 반영된 발생원가입니다.",
  additional: "원래 예상에 없던 비용입니다. 총예상원가(EAC)가 그만큼 늘어납니다.",
  within_forecast: "원래 예상하던 비용을 집행한 것입니다. 잔여예상원가에서 빠지므로 EAC는 변하지 않습니다.",
};

export const REASON_LABEL: Record<CostReason, string> = {
  design_change: "설계변경·발주처 요청",
  price_increase: "자재 단가 상승",
  quantity_increase: "물량 증가",
  rework: "재시공·하자 보수",
  schedule: "공기 지연·돌관 작업",
  planned: "계획된 집행",
  other: "기타",
};

export const ROLE_LABEL: Record<RoleId, string> = {
  ceo: "대표자",
  manager: "본사관리자",
  field: "현장직원",
  partner: "발주처·협력사",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "경고",
  medium: "주의",
  low: "확인",
};

export const RULE_LABEL: Record<SignalRule, string> = {
  MARGIN_DROP: "이익률 하락",
  COST_OVERRUN: "원가항목 예산 초과",
  COST_VS_PROGRESS: "공정 대비 원가 과다",
  UNBILLED_CHANGE: "설계변경 청구 검토",
  RECEIVABLE_OVERDUE: "미수금 장기화",
  PENDING_CHANGE_ORDER: "미승인 변경공사",
  BELOW_TARGET_MARGIN: "목표 이익률 미달",
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  recommended: "추천됨",
  assigned: "배정됨",
  in_progress: "진행 중",
  done: "완료",
  on_hold: "보류",
  dismissed: "무시",
};

export const CO_STATUS_LABEL: Record<ChangeOrderStatus, string> = {
  review: "청구 검토 중",
  submitted: "발주처 청구(승인 대기)",
  approved: "승인(계약 반영)",
  rejected: "반려",
};

export const PARTNER_STATUS_LABEL: Record<PartnerRequestStatus, string> = {
  received: "접수됨",
  reviewing: "검토 중",
  answered: "회신 완료",
};

export const RULE_VERSION = "RULE v1";
