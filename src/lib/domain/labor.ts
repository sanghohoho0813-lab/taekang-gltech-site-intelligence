/**
 * 투입·인건비 추정 (계약 별지 제1호 모듈 04 · 검수 S4) — 결정론적 계산, AI 아님
 * - 추정 인건비 = 작업 인원(출력) 인원일 × 팀 기준 단가 (단가가 없으면 회사 기본 일당)
 * - 실제 노무비 = 현장 보고·CSV·공무 확인으로 들어온 노무비 (확인 대기 포함, 취소·반려 제외)
 * - 비교는 ‘출력 기록을 쓰기 시작한 날’부터 (그 전 노무비와 비교하면 항상 틀어지므로)
 * 급여·법정 근로시간 확정이 아니다 (계약 제9조) — 원천자료 누락·불일치를 찾는 용도
 */
import type { CrewCheck, DemoDB, Site } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { isOpenShift, minutesOf } from "./attendance";

export type LaborFlagKind = "no_actual" | "actual_over" | "estimate_over" | "no_crew" | "rate_missing" | "hours_uncertain";

export const LABOR_FLAG_LABEL: Record<LaborFlagKind, string> = {
  no_actual: "노무비 입력 없음",
  actual_over: "실제 노무비가 추정보다 많음",
  estimate_over: "추정이 실제보다 많음 (입력 누락?)",
  no_crew: "출력 기록 없이 노무비만 있음",
  rate_missing: "팀 단가 미설정",
  hours_uncertain: "퇴근 누락으로 근무시간 불확실",
};

export interface LaborTeamRow {
  team: string;
  kind: CrewCheck["kind"];
  days: number;
  personDays: number;
  dayRate: number;
  rateSet: boolean;
  estimate: number;
}

export interface LaborSite {
  site: Site;
  from: string;
  to: string;
  /** 비교 시작일 (출력 기록 시작일과 기간 시작 중 늦은 날) */
  compareFrom: string;
  teams: LaborTeamRow[];
  estimate: number;
  actual: number;
  /** 실제 중 공무 확인 대기 */
  actualPending: number;
  /** 보고된 공수 합계 (인원 × 일수로 입력된 노무비) */
  reportedManDays: number;
  staffDays: number;
  staffMinutes: number;
  noCheckout: number;
  /** 노무 실행예산 · 누계 실제 노무비 (전체 기간) */
  laborBudget: number;
  laborToDate: number;
  flags: { kind: LaborFlagKind; text: string }[];
}

/** 이보다 차이가 크고(원) 비율도 20% 넘으면 불일치 */
const GAP_WON = 500_000;
const GAP_RATIO = 1.2;

export function teamRate(db: DemoDB, team: string): { rate: number; set: boolean } {
  const t = (db.settings?.teamRates ?? []).find((x) => x.team.toLowerCase() === team.toLowerCase());
  return t ? { rate: t.dayRate, set: true } : { rate: db.settings?.laborDayRate ?? DEFAULT_SETTINGS.laborDayRate, set: false };
}

const fmt = (n: number) => `${Math.round(n / 10_000).toLocaleString("ko-KR")}만 원`;

export function laborEstimate(db: DemoDB, site: Site, from: string, to: string): LaborSite {
  const allCrew = (db.crewChecks ?? []).filter((c) => c.siteId === site.id);
  const firstCrew = allCrew.map((c) => c.workDate).sort()[0];
  const compareFrom = firstCrew && firstCrew > from ? firstCrew : from;
  const crew = allCrew.filter((c) => c.workDate >= compareFrom && c.workDate <= to);
  const byTeam = new Map<string, LaborTeamRow>();
  const teamDays = new Map<string, Set<string>>();
  for (const c of crew) {
    const key = c.team.toLowerCase();
    const r = teamRate(db, c.team);
    const row = byTeam.get(key) ?? { team: c.team, kind: c.kind, days: 0, personDays: 0, dayRate: r.rate, rateSet: r.set, estimate: 0 };
    const ds = teamDays.get(key) ?? new Set<string>();
    ds.add(c.workDate);
    teamDays.set(key, ds);
    row.days = ds.size;
    row.personDays += c.headcount;
    row.estimate = row.personDays * row.dayRate;
    byTeam.set(key, row);
  }
  const teams = [...byTeam.values()].sort((a, b) => b.estimate - a.estimate);
  const estimate = teams.reduce((a, t) => a + t.estimate, 0);
  const labor = db.costEntries.filter((e) => e.siteId === site.id && e.category === "labor" && (e.status === "active" || e.status === "pending"));
  const inWindow = labor.filter((e) => e.date >= compareFrom && e.date <= to);
  const actual = inWindow.reduce((a, e) => a + e.amount, 0);
  const actualPending = inWindow.filter((e) => e.status === "pending").reduce((a, e) => a + e.amount, 0);
  const reportedManDays = Math.round(inWindow.reduce((a, e) => a + (e.qty?.manDays ?? 0), 0) * 10) / 10;
  const att = (db.attendance ?? []).filter((r) => r.siteId === site.id && r.workDate >= from && r.workDate <= to);
  const staffDays = new Set(att.map((r) => `${r.userId}|${r.workDate}`)).size;
  const staffMinutes = att.reduce((a, r) => a + (minutesOf(r) ?? 0), 0);
  const noCheckout = att.filter((r) => !r.outAt && !isOpenShift(r)).length;
  const laborBudget = db.budgets.find((b) => b.siteId === site.id && b.category === "labor")?.amount ?? 0;
  const laborToDate = labor.filter((e) => e.status === "active").reduce((a, e) => a + e.amount, 0);

  const flags: LaborSite["flags"] = [];
  if (estimate > 0 && actual === 0) flags.push({ kind: "no_actual", text: `출력 기준 추정 ${fmt(estimate)}인데 같은 기간 노무비 입력이 없습니다` });
  else if (actual > estimate * GAP_RATIO && actual - estimate >= GAP_WON && crew.length > 0) flags.push({ kind: "actual_over", text: `실제 ${fmt(actual)} > 추정 ${fmt(estimate)} — 출력 인원 누락 또는 단가 차이 확인` });
  else if (estimate > actual * GAP_RATIO && estimate - actual >= GAP_WON && actual > 0) flags.push({ kind: "estimate_over", text: `추정 ${fmt(estimate)} > 실제 ${fmt(actual)} — 노무비 입력 누락 가능` });
  if (crew.length === 0 && actual > 0) flags.push({ kind: "no_crew", text: `노무비 ${fmt(actual)}이 들어왔는데 같은 기간 작업 인원(출력) 기록이 없습니다` });
  for (const t of teams.filter((x) => !x.rateSet)) flags.push({ kind: "rate_missing", text: `${t.team} — 팀 단가가 없어 기본 일당 ${fmt(t.dayRate)}으로 계산` });
  if (noCheckout > 0) flags.push({ kind: "hours_uncertain", text: `직원 퇴근 누락 ${noCheckout}건 — 근무시간 합계가 실제보다 적을 수 있습니다` });

  return { site, from, to, compareFrom, teams, estimate, actual, actualPending, reportedManDays, staffDays, staffMinutes, noCheckout, laborBudget, laborToDate, flags };
}


/** 확인이 필요한 현장 수 (단가 미설정·시간 불확실 제외) — 대표 처리 대기용 */
export function laborAttentionCount(db: DemoDB, from: string, to: string): number {
  return db.sites
    .filter((s) => s.status === "active")
    .map((s) => laborEstimate(db, s, from, to))
    .filter((l) => l.flags.some((f) => f.kind === "no_actual" || f.kind === "actual_over" || f.kind === "estimate_over" || f.kind === "no_crew")).length;
}
