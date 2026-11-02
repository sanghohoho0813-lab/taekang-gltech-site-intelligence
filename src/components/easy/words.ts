/** 현장 직원 화면에서 쓰는 쉬운 말 (본사 화면 용어와 1:1 대응) */
import type { ActionStatus, CostCategory, CostReason, SignalRule } from "@/lib/domain/types";

export const EASY_CATEGORY: Record<CostCategory, { label: string; sub: string }> = {
  material: { label: "자재", sub: "유리·프레임·실링재 등" },
  labor: { label: "사람 (인건비)", sub: "추가 인원·야간·주말 작업" },
  subcontract: { label: "협력업체 (외주)", sub: "외주 시공·가공·설치팀" },
  equipment: { label: "장비", sub: "크레인·스카이·곤돌라 등" },
  overhead: { label: "기타 경비", sub: "운반비·식대·소모품 등" },
};

export const EASY_CATEGORY_ORDER: CostCategory[] = ["material", "labor", "equipment", "subcontract", "overhead"];

export const EASY_REASON: Record<CostReason, string> = {
  design_change: "설계 변경 · 원청 지시",
  price_increase: "자재 값이 올랐음",
  quantity_increase: "물량이 늘었음",
  rework: "다시 시공 (하자·재작업)",
  schedule: "공사 지연 · 급하게 진행",
  planned: "원래 계획에 있던 지출",
  other: "기타",
};

export const EASY_REASON_ORDER: CostReason[] = ["design_change", "quantity_increase", "price_increase", "rework", "schedule", "planned", "other"];

/** 문제·위험 빠른 선택 */
export const ISSUE_CHIPS = ["비·강풍 때문에 작업 중지", "자재가 늦게 들어옴", "인력이 부족함", "도면·설계가 바뀜", "안전 위험이 있음", "장비 고장", "원청이 작업을 추가로 지시함"];

/** 현장에 공정 단계가 아직 없을 때 보여줄 창호·유리·커튼월 기본 작업 */
export const DEFAULT_WORK = ["자재 반입·정리", "앵커·브라켓 설치", "프레임(창틀) 설치", "유리 시공", "실링·마감", "보수·하자 처리"];

/** 작업이 없던 날 */
export const NO_WORK = "작업 없음 (우천·대기)";

/** 본사 요청 처리 결과 빠른 선택 */
export function resultChips(rule: SignalRule): string[] {
  if (rule === "UNBILLED_CHANGE")
    return ["원청에 서면 작업지시서를 받음", "변경 구간 사진·물량을 정리함", "본사 공무에 변경견적을 요청함", "원청과 회의록을 남김"];
  if (rule === "COST_OVERRUN" || rule === "COST_VS_PROGRESS")
    return ["초과 원인을 확인함", "남은 발주 단가·물량을 다시 확인함", "협력업체와 단가를 다시 협의함", "본사 공무에 내용을 보고함"];
  return ["현장 확인을 마침", "원인을 확인함", "본사와 통화로 협의함", "문제 없음을 확인함"];
}

export const EASY_ACTION_STATUS: Record<ActionStatus, string> = {
  recommended: "아직 시작 안 함",
  assigned: "아직 시작 안 함",
  in_progress: "하는 중",
  on_hold: "잠시 멈춤",
  done: "끝냄",
  dismissed: "취소됨",
};

/** "11월 5일 (화)" */
export function easyDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`;
}

/** 기한까지 남은 날 — "3일 남음" / "오늘까지" / "2일 지남" */
export function dueText(dueIso: string, today: string): { text: string; late: boolean } {
  const a = new Date(`${dueIso.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${today}T00:00:00`).getTime();
  const days = Math.round((a - b) / 86_400_000);
  if (days > 0) return { text: `${days}일 남음`, late: false };
  if (days === 0) return { text: "오늘까지", late: false };
  return { text: `${-days}일 지남`, late: true };
}

/** 만 원 단위 금액을 읽기 쉽게 — 30000000 → "3,000만 원", 3600000 → "360만 원", 1.2억 → "1억 2,000만 원" */
export function easyWon(won: number): string {
  if (!Number.isFinite(won) || won <= 0) return "0원";
  const man = Math.round(won / 10_000);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString("ko-KR")}만 원` : `${eok}억 원`;
  if (man > 0) return `${man.toLocaleString("ko-KR")}만 원`;
  return `${Math.round(won).toLocaleString("ko-KR")}원`;
}
