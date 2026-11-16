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
  actual_over: "입력이 추정보다 많음",
  estimate_over: "추정이 입력보다 많음 (입력 누락?)",
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
  /** 이 팀으로 입력된 노무비(외주 팀이면 외주비 포함) + 노무 정산에서 이 팀 몫 (D-81) */
  entered: number;
  /** 그중 공무 확인 대기 */
  enteredPending: number;
}

/** 팀 이름 맞추기 — 앞뒤 공백·대소문자 무시 */
export const teamKey = (t: string | undefined) => (t ?? "").trim().toLowerCase();

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
  /** 팀을 정하지 않고 들어온 노무비 (D-81 — 어느 팀 몫인지 모름) */
  untagged: number;
  /** 출력에 없는 팀 이름으로 들어온 노무비 · 외주 팀이 아닌 이름이 붙은 외주비 (외주비는 비교에 넣지 않음) */
  otherTeams: { team: string; amount: number; category: "labor" | "subcontract" }[];
  /** 외주 팀 이름이 붙은 외주비 (그 팀 입력에 들어감) */
  subTagged: number;
  /** 팀 미지정 외주비 전체 · 그중 외주 팀 몫으로 센 금액 (외주 팀의 남은 추정까지만) */
  subUntagged: number;
  subCovered: number;
  /** 외주 팀 몫으로 센 외주비 = subTagged + subCovered */
  subcontractCounted: number;
  /** 비교에 쓰는 입력 = 노무비 + 외주 팀 몫 외주비 — 투입·인건비·월 마감·정산·CSV가 모두 이 값 (D-81 점검) */
  compared: number;
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
    const row = byTeam.get(key) ?? { team: c.team, kind: c.kind, days: 0, personDays: 0, dayRate: r.rate, rateSet: r.set, estimate: 0, entered: 0, enteredPending: 0 };
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
  // 팀별 입력 (D-81) — 노무비는 팀이 붙은 것, 외주 팀은 그 팀 이름이 붙은 외주비까지. 노무 정산은 팀별로 나눈 금액을 그 팀에 더한다
  const sub = db.costEntries.filter((e) => e.siteId === site.id && e.category === "subcontract" && (e.status === "active" || e.status === "pending") && e.date >= compareFrom && e.date <= to);
  let untagged = 0;
  const other = new Map<string, { team: string; amount: number; category: "labor" | "subcontract" }>();
  const toOther = (team: string, amount: number, category: "labor" | "subcontract") => {
    const k = `${category}|${teamKey(team)}`;
    const o = other.get(k) ?? { team: team.trim(), amount: 0, category };
    o.amount += amount;
    other.set(k, o);
  };
  const addTo = (team: string, amount: number, pending: boolean) => {
    const row = byTeam.get(teamKey(team));
    if (row) {
      row.entered += amount;
      if (pending) row.enteredPending += amount;
    } else toOther(team, amount, "labor");
  };
  for (const e of inWindow) {
    if (e.settle?.teams?.length) {
      let rest = e.amount;
      for (const t of e.settle.teams) {
        addTo(t.team, t.amount, e.status === "pending");
        rest -= t.amount;
      }
      if (rest > 0) untagged += rest;
    } else if (e.team?.trim()) addTo(e.team, e.amount, e.status === "pending");
    else untagged += e.amount;
  }
  // 외주비 — 외주 팀 이름이 붙으면 그 팀 입력, 팀이 없으면 외주 팀의 남은 추정만큼 외주 팀 몫으로 센다.
  // 직영 팀·출력에 없는 이름이 붙은 외주비는 ‘출력 기록에 없는 팀’ 줄에 보이고 비교에는 넣지 않는다 (사라지지 않게 · D-81 점검)
  let subTagged = 0;
  let subUntagged = 0;
  for (const e of sub) {
    const row = e.team?.trim() ? byTeam.get(teamKey(e.team)) : undefined;
    if (row && row.kind === "subcontract") {
      row.entered += e.amount;
      if (e.status === "pending") row.enteredPending += e.amount;
      subTagged += e.amount;
    } else if (e.team?.trim()) toOther(e.team, e.amount, "subcontract");
    else subUntagged += e.amount;
  }
  const subRoom = teams.filter((t) => t.kind === "subcontract").reduce((a, t) => a + Math.max(0, t.estimate - t.entered), 0);
  const subCovered = Math.min(subRoom, subUntagged);
  const subcontractCounted = subTagged + subCovered;
  const compared = actual + subcontractCounted;
  const att = (db.attendance ?? []).filter((r) => r.siteId === site.id && r.workDate >= from && r.workDate <= to);
  const staffDays = new Set(att.map((r) => `${r.userId}|${r.workDate}`)).size;
  const staffMinutes = att.reduce((a, r) => a + (minutesOf(r) ?? 0), 0);
  const noCheckout = att.filter((r) => !r.outAt && !isOpenShift(r)).length;
  const laborBudget = db.budgets.find((b) => b.siteId === site.id && b.category === "labor")?.amount ?? 0;
  const laborToDate = labor.filter((e) => e.status === "active").reduce((a, e) => a + e.amount, 0);

  const flags: LaborSite["flags"] = [];
  const subNote = subcontractCounted > 0 ? ` (외주비 ${fmt(subcontractCounted)} 포함)` : "";
  if (estimate > 0 && compared === 0) flags.push({ kind: "no_actual", text: `출력 기준 추정 ${fmt(estimate)}인데 같은 기간 노무비 입력이 없습니다` });
  else if (compared > estimate * GAP_RATIO && compared - estimate >= GAP_WON && crew.length > 0) flags.push({ kind: "actual_over", text: `입력 ${fmt(compared)}${subNote} > 추정 ${fmt(estimate)} — 출력 인원 누락 또는 단가 차이 확인` });
  else if (estimate > compared * GAP_RATIO && estimate - compared >= GAP_WON && compared > 0) flags.push({ kind: "estimate_over", text: `추정 ${fmt(estimate)} > 입력 ${fmt(compared)}${subNote} — 노무비 입력 누락 가능` });
  if (crew.length === 0 && actual > 0) flags.push({ kind: "no_crew", text: `노무비 ${fmt(actual)}이 들어왔는데 같은 기간 작업 인원(출력) 기록이 없습니다` });
  for (const t of teams.filter((x) => !x.rateSet)) flags.push({ kind: "rate_missing", text: `${t.team} — 팀 단가가 없어 기본 일당 ${fmt(t.dayRate)}으로 계산` });
  if (noCheckout > 0) flags.push({ kind: "hours_uncertain", text: `직원 퇴근 누락 ${noCheckout}건 — 근무시간 합계가 실제보다 적을 수 있습니다` });

  return { site, from, to, compareFrom, teams, estimate, actual, actualPending, reportedManDays, staffDays, staffMinutes, noCheckout, untagged, otherTeams: [...other.values()], subTagged, subUntagged, subCovered, subcontractCounted, compared, laborBudget, laborToDate, flags };
}


/** 확인이 필요한 현장 수 (단가 미설정·시간 불확실 제외) — 대표 처리 대기용 */
export function laborAttentionCount(db: DemoDB, from: string, to: string): number {
  return db.sites
    .filter((s) => s.status === "active")
    .map((s) => laborEstimate(db, s, from, to))
    .filter((l) => l.flags.some((f) => f.kind === "no_actual" || f.kind === "actual_over" || f.kind === "estimate_over" || f.kind === "no_crew")).length;
}

/**
 * 현장의 팀 이름 목록 (D-81) — 작업 인원(출력)에 나온 팀을 ‘최근 30일 인원일’이 많은 순으로 (같으면 최근 순).
 * 회사 팀 단가에만 있는 팀(extra)은 그 현장에 출력 기록이 하나도 없을 때만 뒤에 붙인다 (다른 현장 팀이 섞이지 않게 · D-81 점검).
 */
export function siteTeams(db: Pick<DemoDB, "crewChecks">, siteId: string, extra: string[] = []): { team: string; kind?: CrewCheck["kind"] }[] {
  const mine = (db.crewChecks ?? []).filter((c) => c.siteId === siteId);
  const anchor = mine.reduce((a, c) => (c.workDate > a ? c.workDate : a), "");
  const since = anchor ? shiftIso(anchor, -29) : "";
  const seen = new Map<string, { team: string; kind?: CrewCheck["kind"]; last: string; recent: number }>();
  for (const c of mine) {
    const k = teamKey(c.team);
    const cur = seen.get(k) ?? { team: c.team.trim(), kind: c.kind, last: "", recent: 0 };
    if (c.workDate > cur.last) Object.assign(cur, { team: c.team.trim(), kind: c.kind, last: c.workDate });
    if (c.workDate >= since) cur.recent += c.headcount;
    seen.set(k, cur);
  }
  const list: { team: string; kind?: CrewCheck["kind"] }[] = [...seen.values()].sort((a, b) => b.recent - a.recent || b.last.localeCompare(a.last)).map(({ team, kind }) => ({ team, kind }));
  if (!list.length)
    for (const t of extra)
      if (t.trim() && !seen.has(teamKey(t))) {
        seen.set(teamKey(t), { team: t.trim(), last: "", recent: 0 });
        list.push({ team: t.trim() });
      }
  return list;
}

function shiftIso(d: string, days: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** 띄어쓰기·괄호 설명을 뺀 이름 — ‘창호1 팀’, ‘창호1팀(외주)’를 ‘창호1팀’으로 짐작할 때만 쓴다 (집계는 정확한 이름으로) */
const looseKey = (t: string) => teamKey(t).replace(/\([^)]*\)/g, "").replace(/\s+/g, "");

/**
 * 메모에 팀 이름이 하나만 있으면 그 팀 (D-81 · ‘창호1팀 주간 노무’) — 둘 이상이거나 없으면 모름.
 * ‘비직영’, ‘직영 아님’처럼 아니라는 말은 세지 않고, ‘창호1팀장’처럼 긴 이름 안의 짧은 이름은 따로 나올 때만 센다.
 */
export function guessTeam(note: string, teams: { team: string }[]): string | undefined {
  let n = (note ?? "").toLowerCase();
  const hits: string[] = [];
  for (const t of [...teams].filter((x) => x.team.trim()).sort((a, b) => b.team.trim().length - a.team.trim().length)) {
    const name = t.team.trim().toLowerCase();
    let i = n.indexOf(name);
    let hit = false;
    while (i >= 0) {
      const after = n.slice(i + name.length).trimStart();
      if (n[i - 1] !== "비" && !/^(아님|아닌|제외|말고)/.test(after)) hit = true;
      i = n.indexOf(name, i + 1);
    }
    if (hit) hits.push(t.team.trim());
    n = n.split(name).join(" ".repeat(name.length));
  }
  return hits.length === 1 ? hits[0] : undefined;
}

export interface UntaggedCost {
  entryId: string;
  date: string;
  amount: number;
  note: string;
  category: "labor" | "subcontract";
  /** 지금 붙은 팀 (출력에 없는 이름이거나 외주비에 직영 팀이 붙은 경우) */
  current?: string;
  /** 메모·비슷한 이름으로 짐작한 팀 */
  guess?: string;
  /** 고를 수 있는 팀 — 노무비는 모든 팀, 외주비는 외주 팀 */
  options: string[];
}

/**
 * 팀이 없거나 팀이 맞지 않는 노무비·외주비 (D-81 점검) — 투입·인건비의 ‘팀 붙이기’ 창 목록.
 * 노무 정산 건(팀별 금액은 정산 창에서 정함)·취소·반려 건은 뺀다.
 */
export function untaggedCosts(db: DemoDB, siteId: string, from?: string, to?: string): UntaggedCost[] {
  const teams = siteTeams(db, siteId);
  if (!teams.length) return [];
  const all = teams.map((t) => t.team);
  const subs = teams.filter((t) => t.kind === "subcontract").map((t) => t.team);
  const keys = new Set(all.map(teamKey));
  const subKeys = new Set(subs.map(teamKey));
  return db.costEntries
    .filter((e) => e.siteId === siteId && (e.category === "labor" || e.category === "subcontract") && !e.settle && (e.status === "active" || e.status === "pending") && (!from || e.date >= from) && (!to || e.date <= to))
    .flatMap((e): UntaggedCost[] => {
      const options = e.category === "labor" ? all : subs;
      if (!options.length) return [];
      const cur = e.team?.trim();
      if (cur && (e.category === "labor" ? keys : subKeys).has(teamKey(cur))) return [];
      const guess = (cur ? options.find((o) => looseKey(o) === looseKey(cur)) : undefined) ?? guessTeam(e.note, options.map((team) => ({ team })));
      return [{ entryId: e.id, date: e.date, amount: e.amount, note: e.note, category: e.category as "labor" | "subcontract", ...(cur ? { current: cur } : {}), ...(guess ? { guess } : {}), options }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 팀이 붙지 않은 노무비·외주비 중 메모로 팀을 알 수 있는 것 (D-81 · 이미 쌓인 자료에 한 번에 팀 붙이기) */
export function teamGuesses(db: DemoDB, siteId: string, from?: string, to?: string): { entryId: string; team: string; amount: number; date: string; note: string; category: "labor" | "subcontract" }[] {
  return untaggedCosts(db, siteId, from, to)
    .filter((u) => !u.current && u.guess)
    .map((u) => ({ entryId: u.entryId, team: u.guess!, amount: u.amount, date: u.date, note: u.note, category: u.category }));
}
