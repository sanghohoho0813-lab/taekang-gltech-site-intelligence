/**
 * 입금 차액 정리 (D-89) — 유보금·공제 계산을 한 곳에서.
 *
 *   미수금        = 확정 기성 − 입금 − 공제
 *   그중 유보금    = 아직 안 받은 유보금 (미수 안에 있음 · 받을 날 전에는 ‘오래된 미수’로 세지 않음)
 *   예상이익       = 변경 반영 계약금액 − 공제 − 예상 총원가
 *
 * 공제(지체상금·상계)는 받지 못하는 돈이라 미수와 예상이익을 함께 줄인다. 유보금은 받을 돈이라 숫자는 그대로, 경과일 알림에서만 뺀다.
 * 날짜 기준: ‘upTo’(그날까지)를 주면 발주처가 뗀 날(date)·받은 날(released.date) 기준 — 월 마감 ‘월말 미수’와 같은 규칙.
 */
import type { DeductionType, DemoDB, ReceivableAdjustment } from "./types";

export const DEDUCTION_LABEL: Record<DeductionType, string> = {
  delay_penalty: "지체상금",
  setoff: "상계 (발주처 자재·비용 공제)",
  other: "그 밖의 공제",
};

/** 유보금·공제 기록 (취소한 것은 빼고) */
export function activeAdjustments(db: Pick<DemoDB, "receivableAdjustments">, siteId?: string): ReceivableAdjustment[] {
  return (db.receivableAdjustments ?? []).filter((a) => !a.voidedAt && (!siteId || a.siteId === siteId));
}

/** 공제 누계 (그날까지) */
export function deductedTotal(db: Pick<DemoDB, "receivableAdjustments">, siteId: string, upTo?: string): number {
  return activeAdjustments(db, siteId)
    .filter((a) => a.kind === "deduction" && (!upTo || a.date <= upTo))
    .reduce((s, a) => s + a.amount, 0);
}

/** 유보금 하나의 남은 금액 (그날까지 받은 것을 빼고) */
export function retentionLeft(a: ReceivableAdjustment, upTo?: string): number {
  if (a.kind !== "retention" || a.voidedAt || (upTo && a.date > upTo)) return 0;
  const got = (a.released ?? []).filter((r) => !upTo || r.date <= upTo).reduce((s, r) => s + r.amount, 0);
  return Math.max(0, a.amount - got);
}

/** 아직 안 받은 유보금 합 (그날까지) */
export function retentionOpen(db: Pick<DemoDB, "receivableAdjustments">, siteId: string, upTo?: string): number {
  return activeAdjustments(db, siteId).reduce((s, a) => s + retentionLeft(a, upTo), 0);
}

/** 받을 날이 아직 안 된 유보금 — ‘오래된 미수’ 경과일에서 뺄 금액 (받을 날을 안 적었으면 계속 기다리는 돈으로 본다) */
export function retentionNotDue(db: Pick<DemoDB, "receivableAdjustments">, siteId: string, today: string): number {
  return activeAdjustments(db, siteId)
    .filter((a) => a.kind === "retention" && (!a.dueDate || a.dueDate > today))
    .reduce((s, a) => s + retentionLeft(a), 0);
}

/** 이 기록의 한 줄 설명 */
export function adjustmentLabel(a: Pick<ReceivableAdjustment, "kind" | "deductionType">): string {
  return a.kind === "retention" ? "유보금" : `공제 · ${DEDUCTION_LABEL[a.deductionType ?? "other"]}`;
}
