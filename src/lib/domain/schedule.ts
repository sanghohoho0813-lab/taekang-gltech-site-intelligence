/**
 * 공정 일정 — 계획 대비 실제 (결정론적 계산, AI 아님)
 * - 계획 진척(%) = 오늘이 공정 기간의 몇 %를 지났는지 (단계별 기간을 가중치로 합산)
 * - 실제 진척(%) = 현장 공정률
 * - 늦은 일수 ≈ (계획 − 실제) × 전체 공기 — 표준 ‘일정 차이’ 계산을 일수로 바꾼 값
 * - 지연 비용 추정 = 늦은 일수 × (현장경비 실행예산 ÷ 공기) — 인건비·장비 대기비는 제외한 단순 계산
 */
import type { DemoDB, Site, SiteStage } from "./types";
import { shiftDate } from "./attendance";

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY);

export type StageStatus = "done" | "on_track" | "ahead" | "behind" | "overdue" | "not_started_late" | "upcoming";

export interface StagePlan {
  stage: SiteStage;
  plannedPct: number;
  actualPct: number;
  /** 계획 − 실제 (%p) */
  gapPp: number;
  status: StageStatus;
  /** 기한이 지난 일수 (끝나지 않은 단계) */
  overdueDays: number;
}

export interface SitePlan {
  site: Site;
  hasStages: boolean;
  plannedPct: number;
  actualPct: number;
  gapPp: number;
  /** +면 늦음, −면 앞섬 (일) */
  delayDays: number;
  totalDays: number;
  plannedEnd: string;
  forecastEnd: string;
  status: "behind" | "on_track" | "ahead" | "no_plan";
  stages: StagePlan[];
  /** 현장경비 실행예산 기준 하루 경비 (원) — 금액 권한이 없으면 0 */
  dailyOverhead: number;
  delayCost: number;
  /** 최근 14일 중 출근 기록이 하나도 없는 날 (출퇴근 기록을 쓰기 시작한 뒤, 일요일 제외) */
  noAttendanceDays: string[];
}

/** 이 이상 늦으면 '늦음' (%p) */
export const BEHIND_PP = 5;
const STAGE_BEHIND_PP = 10;

export function plannedPctOf(st: Pick<SiteStage, "startDate" | "endDate">, today: string): number {
  const total = Math.max(1, days(st.startDate, st.endDate));
  const done = days(st.startDate, today);
  return Math.max(0, Math.min(100, Math.round((done / total) * 1000) / 10));
}

export function stagePlan(st: SiteStage, today: string): StagePlan {
  const plannedPct = plannedPctOf(st, today);
  const actualPct = st.progressPct;
  const gapPp = Math.round((plannedPct - actualPct) * 10) / 10;
  const overdueDays = actualPct < 100 ? Math.max(0, days(st.endDate, today)) : 0;
  let status: StageStatus;
  if (actualPct >= 100) status = "done";
  else if (overdueDays > 0) status = "overdue";
  // 시작일 전이라도 이미 진척이 있으면 ‘앞서 시작’ (‘시작 전’으로 보이지 않게 · D-65)
  else if (today < st.startDate) status = actualPct > 0 ? "ahead" : "upcoming";
  else if (actualPct === 0 && days(st.startDate, today) >= 3) status = "not_started_late";
  else if (gapPp >= STAGE_BEHIND_PP) status = "behind";
  else if (gapPp <= -STAGE_BEHIND_PP) status = "ahead";
  else status = "on_track";
  return { stage: st, plannedPct, actualPct, gapPp, status, overdueDays };
}

export function sitePlan(db: DemoDB, site: Site, today: string): SitePlan {
  const stages = site.stages.map((st) => stagePlan(st, today));
  const totalDays = Math.max(1, days(site.startDate, site.endDate));
  // 단계별 기간을 가중치로 계획 진척 합산 (단계가 없으면 현장 전체 기간 기준)
  const weights = site.stages.map((st) => Math.max(1, days(st.startDate, st.endDate)));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const plannedPct = site.stages.length ? Math.round((stages.reduce((a, s, i) => a + s.plannedPct * weights[i], 0) / wsum) * 10) / 10 : plannedPctOf(site, today);
  const actualPct = site.progressPct;
  const gapPp = Math.round((plannedPct - actualPct) * 10) / 10;
  const delayDays = Math.round((gapPp / 100) * totalDays);
  const forecastEnd = shiftDate(site.endDate, Math.max(0, delayDays));
  const overhead = db.budgets.find((b) => b.siteId === site.id && b.category === "overhead")?.amount ?? 0;
  const dailyOverhead = overhead > 0 ? Math.round(overhead / totalDays) : 0;
  const status: SitePlan["status"] = !site.stages.length && today < site.startDate ? "no_plan" : gapPp >= BEHIND_PP ? "behind" : gapPp <= -BEHIND_PP ? "ahead" : "on_track";
  return {
    site,
    hasStages: site.stages.length > 0,
    plannedPct,
    actualPct,
    gapPp,
    delayDays,
    totalDays,
    plannedEnd: site.endDate,
    forecastEnd,
    status,
    stages,
    dailyOverhead,
    delayCost: Math.max(0, delayDays) * dailyOverhead,
    noAttendanceDays: noAttendanceDays(db, site, today),
  };
}

/** 진행 중인 공정이 있는데 아무도 출근하지 않은 날 (출퇴근 기록을 쓰기 시작한 날부터, 일요일 제외, 오늘 제외) */
export function noAttendanceDays(db: DemoDB, site: Site, today: string, window = 14): string[] {
  const recs = (db.attendance ?? []).filter((r) => r.siteId === site.id);
  if (recs.length === 0) return [];
  const first = recs.map((r) => r.workDate).sort()[0];
  const out: string[] = [];
  for (let i = window; i >= 1; i--) {
    const d = shiftDate(today, -i);
    if (d < first || d < site.startDate || d > site.endDate) continue;
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue;
    const active = site.stages.length === 0 || site.stages.some((st) => st.startDate <= d && d <= st.endDate && st.progressPct < 100);
    if (active && !recs.some((r) => r.workDate === d)) out.push(d);
  }
  return out;
}

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  done: "완료",
  on_track: "계획대로",
  ahead: "앞섬",
  behind: "늦음",
  overdue: "기한 지남",
  not_started_late: "시작 안 함",
  upcoming: "시작 전",
};

/**
 * 단계 진행률을 기간으로 가중한 전체 공정률 (반올림) — 단계가 없으면 null.
 * 단계를 100%·60%로 넣어도 전체 공정률은 0%로 남아 발주처 포털까지 0%가 나가던 문제 (D-77 리허설).
 */
export function stagesWeightedPct(stages: Pick<SiteStage, "startDate" | "endDate" | "progressPct">[]): number | null {
  if (!stages.length) return null;
  const weights = stages.map((st) => Math.max(1, days(st.startDate, st.endDate)));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  return Math.round(stages.reduce((a, st, i) => a + (Math.max(0, Math.min(100, st.progressPct ?? 0)) * weights[i]) / wsum, 0));
}

/** 현장 보고에서 단계 진척을 바꿨을 때 현장 공정률에 더할 값 (단계 기간 가중) — 현장 공정률이 갑자기 튀지 않게 변화량만 반영 */
export function siteProgressDelta(site: Site, changes: { stageId: string; progressPct: number }[]): number {
  const weights = site.stages.map((st) => Math.max(1, days(st.startDate, st.endDate)));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let delta = 0;
  site.stages.forEach((st, i) => {
    const c = changes.find((x) => x.stageId === st.id);
    if (c) delta += ((c.progressPct - st.progressPct) * weights[i]) / wsum;
  });
  return delta;
}

/** 공정 단계 완료일 맞추기 — 100%가 되면 그날을 남기고, 100% 아래로 내려가면 지운다 (D-72) */
export function syncStageDone(site: { stages: SiteStage[] }, date: string): void {
  site.stages = site.stages.map((st) => {
    if (st.progressPct >= 100) return st.doneOn ? st : { ...st, doneOn: date };
    if (!st.doneOn) return st;
    const { doneOn: _d, ...rest } = st;
    void _d;
    return rest;
  });
}
