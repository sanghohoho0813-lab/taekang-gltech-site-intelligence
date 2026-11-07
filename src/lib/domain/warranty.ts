/**
 * 하자보증 기간 (D-70) — 현장별 준공(인도)일 + 계약서 기준 보증 개월.
 * 법정 기간을 단정하지 않는다: 기간은 본사가 계약서를 보고 넣는다. 금액(보증금·증권 금액)은 다루지 않는다.
 */
import type { Site } from "./types";

export type WarrantyState = "none" | "pending" | "active" | "soon" | "expired";
/** 만료 전 점검을 챙길 기간 */
export const WARRANTY_SOON_DAYS = 60;

export const WARRANTY_LABEL: Record<WarrantyState, string> = {
  none: "보증 기간 미입력",
  pending: "준공 전",
  active: "보증 중",
  soon: "만료 임박",
  expired: "보증 끝남",
};

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * 준공일 + n개월 − 1일 (예: 2026-11-30 + 24개월 → 2028-11-29).
 * 끝나는 달에 같은 날이 없으면 그 달 말일 (민법 제160조 제3항 · 예: 1월 31일 + 1개월 → 2월 28일 · D-70 점검 반영)
 */
export function warrantyEnd(completedDate: string, months: number): string {
  const [y, m, d] = completedDate.split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  if (d > last) return new Date(Date.UTC(ty, tm, last)).toISOString().slice(0, 10);
  return new Date(Date.UTC(ty, tm, d) - 86_400_000).toISOString().slice(0, 10);
}

export interface WarrantyStatus {
  state: WarrantyState;
  months?: number;
  startDate?: string;
  endDate?: string;
  /** 만료까지 남은 날 (끝났으면 음수) */
  daysLeft?: number;
}

export function warrantyStatus(site: Pick<Site, "warranty">, today: string): WarrantyStatus {
  const w = site.warranty;
  if (!w) return { state: "none" };
  if (!w.completedDate) return { state: "pending", months: w.months };
  const endDate = warrantyEnd(w.completedDate, w.months);
  const daysLeft = dayDiff(today, endDate);
  const state: WarrantyState = daysLeft < 0 ? "expired" : daysLeft <= WARRANTY_SOON_DAYS ? "soon" : "active";
  return { state, months: w.months, startDate: w.completedDate, endDate, daysLeft };
}

/** 하자 요청이 보증 기간 안인지 (접수일 기준) — 준공 전 접수는 ‘시공 중’ */
export type DefectWarranty = "in" | "before" | "after";
export const DEFECT_WARRANTY_LABEL: Record<DefectWarranty, string> = {
  in: "보증 기간 안",
  before: "준공 전 접수",
  after: "보증 기간 밖",
};
export function defectWarranty(site: Pick<Site, "warranty"> | undefined, receivedDate: string): DefectWarranty | undefined {
  const w = site?.warranty;
  if (!w) return undefined;
  if (!w.completedDate || receivedDate < w.completedDate) return "before";
  return receivedDate <= warrantyEnd(w.completedDate, w.months) ? "in" : "after";
}

/** “2년” · “18개월” */
export function monthsText(months: number): string {
  return months % 12 === 0 ? `${months / 12}년` : `${months}개월`;
}
