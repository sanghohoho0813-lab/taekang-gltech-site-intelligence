/**
 * 월 마감 (D-78 첫 달 리허설) — 한 달을 닫을 때 공무·대표가 보는 한 장.
 * 금액·원가·노무·출퇴근은 다른 화면과 같은 계산(siteFinancials·laborEstimate·periodSummary)을 그대로 쓴다 — 숫자가 화면마다 달라지지 않게.
 * 날짜는 모두 한국 날짜(YYYY-MM-DD). ‘이번 달’이면 오늘까지만 센다.
 */
import type { CostCategory, CostEntry, DemoDB, Site } from "./types";
import { CATEGORY_LABEL, CO_STATUS_LABEL, COST_CATEGORIES, IMPACT_LABEL, REASON_LABEL } from "./labels";
import { activeAt, entryEacImpact, siteEacImpacts, siteFinancials } from "./calc";
import { laborEstimate, type LaborSite } from "./labor";
import { isOpenShift, minutesOf, overlapPairs, periodSummary, type MonthRow } from "./attendance";
import { todayIso } from "./format";

export interface CloseSiteMoney {
  site: Site;
  /** 이 달 확정 기성 */
  billed: number;
  /** 이 달 입금 */
  received: number;
  /** 달 마지막 날 기준 미수 (그날까지 확정 기성 − 그날까지 입금) */
  outstandingAtEnd: number;
  /** 이 달 원가 (공무 확인까지 끝난 것 · 발생일 기준) */
  cost: Record<CostCategory, number>;
  costTotal: number;
  /** 이 달 원가 중 공무 확인 대기 */
  pending: { n: number; amount: number };
  /** 이 달 원가 중 반려 */
  rejected: number;
  /** 이 달 승인한 변경공사 (승인 금액) */
  changeApproved: number;
}

export interface CloseProfitEvent {
  date: string;
  /** 예상이익에 미친 금액 (+ 늘어남 · − 줄어듦) */
  amount: number;
  text: string;
  /** 원가 때문이면 그 원가 (D-84 — 그 원가로 청구한 변경공사를 옆에 보여 준다) */
  entryId?: string;
}

export interface CloseSiteProfit {
  site: Site;
  events: CloseProfitEvent[];
  net: number;
  /** 지금 예상이익 · 기준(현장 등록) 대비 */
  expectedProfit: number;
  sinceBaseline: number;
}

export type CloseItemKind = "cost" | "report" | "noreport" | "checkout" | "fix" | "order" | "request" | "change" | "settle" | "completion" | "overlap" | "labor";
export interface CloseItem {
  kind: CloseItemKind;
  date?: string;
  text: string;
  href: string;
  /** 이 화면에서 바로 처리할 수 있는 일 (D-79) — 노무 정산·준공 원가 마감 */
  /** 현장 단위(노무 정산·원가 마감)는 siteId, 사람 단위(출퇴근 겹침 정리)는 userId */
  action?: { kind: "settleLabor" | "closeout" | "fixOverlap"; siteId?: string; userId?: string };
}

/** 노무 한 줄 + 월 마감 정산 상태 (D-79) */
export interface CloseLabor extends LaborSite {
  /** 이 달 노무 정산 (있으면) */
  settled?: CostEntry;
  /** 정산 뒤에 같은 달로 더 들어온 노무비 */
  afterSettle: { n: number; amount: number };
  /** 출력 기준 추정 − 입력(노무비 + 외주 팀 몫 외주비) (+ 면 입력이 모자람) */
  shortfall: number;
  /** 정산 버튼을 보여 줄지 — 달이 끝났고, 추정보다 적게 들어왔고, 아직 정산 안 함 */
  canSettle: boolean;
  /** 외주 팀 몫으로 센 외주비 (= subcontractCounted) — 입력에 들어 있다 (노무비·외주비 이중 계상 방지) */
  subcontractCovered: number;
  /** 정산 기본값 = 팀별 기본값의 합 (팀이 없으면 모자람) */
  suggested: number;
  /** 팀별 기본값의 합이 현장 전체 모자람보다 큰 만큼 — 어떤 팀은 추정보다 많이 들어왔다는 뜻 (팀 이름·단가 확인) */
  planOver: number;
  /** 정산한 뒤에도 팀별로 남은 차이 (일부 팀만 넣었거나 덜 넣은 경우) */
  teamLeft: { team: string; amount: number }[];
  /** 정산한 뒤에 다시 생긴 모자람 (출력 추가·정산 때 셈한 확인 대기 노무비 반려 등) */
  reShort: number;
  /**
   * 팀별 정산 안 (D-81) — 팀마다 남은 필요액(추정 − 그 팀 입력)에서, 팀 미지정 외주비는 외주 팀끼리,
   * 팀 미지정·출력에 없는 이름의 노무비는 모든 팀끼리 남은 필요액 비율로 나눠 뺀다 (이미 찬 팀 몫이 버려지지 않게).
   */
  teamPlan: { team: string; kind: "direct" | "subcontract"; estimate: number; entered: number; share: number; suggest: number }[];
}

/** 추정과 입력의 차이를 ‘모자람’으로 볼 기준 — 투입·인건비 화면(labor.ts)과 같은 값 */
export const LABOR_GAP_WON = 500_000;
const LABOR_GAP_RATIO = 1.2;
export function laborShort(l: Pick<LaborSite, "estimate" | "compared">): boolean {
  return l.estimate > 0 && (l.compared === 0 || (l.estimate > l.compared * LABOR_GAP_RATIO && l.estimate - l.compared >= LABOR_GAP_WON));
}

/** 정산 기본값은 천 원 단위로 */
const k1 = (n: number) => Math.round(n / 1000) * 1000;

/** 팀별 정산 안 — CloseLabor.teamPlan 설명 참고 */
export function teamPlanFor(l: LaborSite): CloseLabor["teamPlan"] {
  const need = l.teams.map((t) => Math.max(0, t.estimate - t.entered));
  // 1) 팀 미지정 외주비 중 외주 팀 몫으로 센 금액 → 외주 팀끼리 (subCovered ≤ 외주 팀 필요액 합)
  const subIdx = l.teams.map((t, i) => (t.kind === "subcontract" ? i : -1)).filter((i) => i >= 0);
  const subNeed = subIdx.reduce((a, i) => a + need[i], 0);
  const subShare = l.teams.map((_, i) => (subIdx.includes(i) && subNeed > 0 ? (l.subCovered * need[i]) / subNeed : 0));
  // 2) 팀 미지정 노무비 + 출력에 없는 이름의 노무비 → 모든 팀끼리, 남은 필요액 비율로 (필요액을 넘지 않게)
  const pool = l.untagged + l.otherTeams.filter((o) => o.category === "labor").reduce((a, o) => a + o.amount, 0);
  const rest = need.map((n, i) => Math.max(0, n - subShare[i]));
  const restSum = rest.reduce((a, b) => a + b, 0);
  const laborShare = rest.map((r) => (restSum > 0 ? Math.min(r, (pool * r) / restSum) : 0));
  return l.teams.map((t, i) => ({ team: t.team, kind: t.kind, estimate: t.estimate, entered: t.entered, share: Math.round(subShare[i] + laborShare[i]), suggest: k1(Math.max(0, rest[i] - laborShare[i])) }));
}

export interface ClosePerson {
  row: MonthRow;
  name: string;
  /** 퇴근 누락 날짜 (정정 전) */
  missedOut: string[];
  outside: string[];
  noLocation: string[];
  /** 같은 날 두 현장 기록 시간이 겹치는 날 — 근무시간이 두 번 셈 */
  overlap: string[];
  sites: string[];
}

export interface MonthCloseReport {
  month: string;
  from: string;
  to: string;
  /** 달이 끝났나 (지난달) */
  ended: boolean;
  money: CloseSiteMoney[];
  totals: { billed: number; received: number; outstandingAtEnd: number; costTotal: number; pending: number; changeApproved: number };
  /** 달이 끝난 뒤에 손익에 들어온 이 달 날짜 원가 (D-79 — 인쇄해 둔 마감본과 숫자가 달라지는 이유) */
  late: { n: number; amount: number };
  /** 달이 끝난 뒤에 넣은 이 달 날짜 기성·입금 (넣은 시각이 남은 것만 · D-83) */
  lateMoney: { n: number; billed: number; received: number };
  profit: CloseSiteProfit[];
  labor: CloseLabor[];
  people: ClosePerson[];
  items: CloseItem[];
  /** 이 달에 준공한 현장 (준공 보고서) */
  completedSites: Site[];
}

const pad = (n: number) => String(n).padStart(2, "0");
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}
/** 고를 수 있는 달 — 이번 달부터 가장 이른 현장 착공 달까지 (최대 24개월) · 월 마감·대표 보고서 */
export function monthOptions(db: Pick<DemoDB, "sites">, today: string): string[] {
  if (!db.sites.length) return [today.slice(0, 7)];
  const first = db.sites.map((s) => s.startDate).sort()[0].slice(0, 7);
  const out: string[] = [];
  for (let m = today.slice(0, 7); m >= first && out.length < 24; m = previousMonth(`${m}-01`)) out.push(m);
  return out;
}

/** 지난달 (YYYY-MM) */
export function previousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}
const kst = (iso: string) => todayIso(new Date(iso));
const inRange = (d: string | undefined, from: string, to: string) => !!d && d >= from && d <= to;
const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const man = (n: number) => `${Math.round(n / 10_000).toLocaleString("ko-KR")}만 원`;
const WORKDAY = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0;

/** 이 달에 일한(또는 진행 중이던) 현장 — 준공 현장도 이 달 안에 끝났으면 넣는다 */
export function closeSites(db: DemoDB, from: string, to: string): Site[] {
  // 준공한 다음 달에 들어온 입금·기성·원가·재추정·변경공사도 그 달 마감에 나오도록 (D-79 대표 점검 — 11월 판교 입금 3,500만이 11월 마감에서 빠짐)
  const touched = (id: string) =>
    (db.attendance ?? []).some((a) => a.siteId === id && inRange(a.workDate, from, to)) ||
    db.billings.some((x) => x.siteId === id && x.status === "confirmed" && inRange(x.billedDate, from, to)) ||
    db.payments.some((x) => x.siteId === id && inRange(x.receivedDate, from, to)) ||
    db.costEntries.some((e) => e.siteId === id && e.status !== "voided" && (inRange(e.date, from, to) || inRange(kst(activeAt(e)), from, to))) ||
    (db.forecastChanges ?? []).some((c) => c.siteId === id && inRange(kst(c.at), from, to)) ||
    db.changeOrders.some((c) => c.siteId === id && !!c.decidedAt && inRange(kst(c.decidedAt), from, to));
  // 착공 전 달이라도 그 달 날짜로 돈·원가가 있으면 넣는다 — 자재 선발주처럼 착공 전 발생일 원가가 어느 달에도 안 잡혀 월 합 ≠ 누계가 되던 문제 (D-85)
  return db.sites.filter((s) => touched(s.id) || (s.startDate <= to && (s.status === "active" || s.endDate >= from)));
}

/**
 * 예상이익을 바꾼 일 — 기간 안에 ‘손익에 들어온’ 날 기준 (D-79 대표 점검: 계획 안 집행이 잔여예상을 넘어 이익을 바꿔도 빠지던 문제).
 * - 원가: 추가 원가는 전액, 계획 안 집행은 잔여예상을 넘은 만큼 (공무 확인 방식이면 확인한 날)
 * - 변경공사 승인 (+) · 그 예상 원가 (−)
 * - 잔여예상 재추정·준공 원가 마감 (예상 총원가 변화)
 */
export function profitEvents(db: DemoDB, siteId: string, from: string, to: string): CloseProfitEvent[] {
  const events: CloseProfitEvent[] = [];
  const impacts = siteEacImpacts(db, siteId);
  // 기준선에 넣은(지난 자료로 가져온) 묶음의 원가·변경공사는 ‘앱을 쓰기 전’ 일이라 이익을 바꾼 일로 세지 않는다 — 기준선과 두 번 세던 문제 (D-85)
  const historyBatches = new Set((db.importBatches ?? []).filter((b) => !b.undoneAt && (b.baselineDelta?.[siteId] || b.prevBaseline?.[siteId])).map((b) => b.id));
  const history = (x: { importBatchId?: string }) => !!x.importBatchId && historyBatches.has(x.importBatchId);
  for (const e of db.costEntries.filter((x) => x.siteId === siteId && x.status === "active" && !history(x))) {
    const when = kst(activeAt(e));
    if (!inRange(when, from, to)) continue;
    // 재추정 전에 넘었던 금액(frozenOver)은 그대로 — 재추정 뒤 지금 기준으로 다시 넘은 금액은 더한다 (D-83 버그 배시 M1)
    const impact = (impacts.get(e.id) ?? 0) + (e.frozenOver ?? 0);
    if (impact <= 0) continue;
    const occurred = e.date !== when ? ` (발생 ${short(e.date)})` : "";
    events.push(
      e.forecastImpact === "additional"
        ? { date: when, amount: -impact, text: `추가 원가 — ${e.note || "사유 미기재"}${occurred}`, entryId: e.id }
        : { date: when, amount: -impact, text: `잔여예상을 넘은 집행 — ${CATEGORY_LABEL[e.category]} ${e.note || ""}${occurred}`.replace(/\s+/g, " ").trim(), entryId: e.id },
    );
  }
  // 변경공사는 받은 날(결정일) 기준 (D-84). 다만 현장 등록(기준) 뒤에 넣은 승인의 받은 날이 등록 전이면 등록한 날로 센다 —
  // 기준에 들어 있지 않은 이익 변화가 ‘이익을 바꾼 일’에서 빠지던 문제 (D-87 무작위 점검). 등록 전에 넣은 승인은 기준에 들어 있다
  const site = db.sites.find((s) => s.id === siteId);
  // 기준 시각 — 숫자 맞추기 점검(integrity)과 같은 규칙 (등록 시각이 없으면 자료 시작 시각)
  const baseAt = site?.baselineAt ?? db.seededAt;
  const baseDay = baseAt ? kst(baseAt) : null;
  const coDay = (c: { decidedAt?: string; statusChangedAt?: string }) => {
    const d = kst(c.decidedAt!);
    return baseDay && baseAt && d < baseDay && c.statusChangedAt && c.statusChangedAt > baseAt ? baseDay : d;
  };
  for (const c of db.changeOrders.filter((x) => x.siteId === siteId && x.status === "approved" && x.decidedAt && !history(x) && inRange(coDay(x), from, to))) {
    const amt = c.approvedAmount ?? c.amount;
    const when = coDay(c);
    const decided = kst(c.decidedAt!);
    const occurred = decided !== when ? ` (받은 날 ${short(decided)} · 현장 등록 전)` : "";
    events.push({ date: when, amount: amt, text: `변경공사 승인 — ${c.title}${amt < 0 ? " (감액)" : ""}${occurred}` });
    if (c.addedCost) events.push({ date: when, amount: -c.addedCost.amount, text: `변경공사 원가 — ${c.title}${occurred}` });
  }
  // 잔여예상을 다시 잡아 예상 총원가가 바뀐 일 (준공 원가 마감 포함 · D-79)
  for (const c of (db.forecastChanges ?? []).filter((x) => x.siteId === siteId && inRange(kst(x.at), from, to) && x.eacBefore !== x.eacAfter))
    events.push({ date: kst(c.at), amount: c.eacBefore - c.eacAfter, text: `${c.closeout ? "준공 원가 마감" : "잔여예상 재추정"} — ${c.note}` });
  // 원가 고침·취소·보고 되돌림·가져오기 취소·원 계약 변경 등 — 그때 남긴 조정 (D-85)
  for (const a of (db.profitAdjustments ?? []).filter((x) => x.siteId === siteId && inRange(kst(x.at), from, to)))
    events.push({ date: kst(a.at), amount: a.amount, text: a.text, ...(a.entryId ? { entryId: a.entryId } : {}) });
  return events.sort((a, x) => a.date.localeCompare(x.date));
}

export function monthClose(db: DemoDB, month: string, today = todayIso()): MonthCloseReport {
  const b = monthBounds(month);
  const from = b.from;
  const to = b.to < today ? b.to : today;
  const ended = b.to < today;
  const sites = closeSites(db, from, to);
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? "알 수 없음";

  // ── 금액 ──
  const money: CloseSiteMoney[] = sites.map((site) => {
    const bills = db.billings.filter((x) => x.siteId === site.id && x.status === "confirmed");
    const pays = db.payments.filter((x) => x.siteId === site.id);
    const entries = db.costEntries.filter((e) => e.siteId === site.id && inRange(e.date, from, to));
    const cost = Object.fromEntries(COST_CATEGORIES.map((c) => [c, entries.filter((e) => e.status === "active" && e.category === c).reduce((a, e) => a + e.amount, 0)])) as Record<CostCategory, number>;
    const pend = entries.filter((e) => e.status === "pending");
    return {
      site,
      billed: bills.filter((x) => inRange(x.billedDate, from, to)).reduce((a, x) => a + x.amount, 0),
      received: pays.filter((x) => inRange(x.receivedDate, from, to)).reduce((a, x) => a + x.amount, 0),
      outstandingAtEnd: bills.filter((x) => x.billedDate <= to).reduce((a, x) => a + x.amount, 0) - pays.filter((x) => x.receivedDate <= to).reduce((a, x) => a + x.amount, 0),
      cost,
      costTotal: COST_CATEGORIES.reduce((a, c) => a + cost[c], 0),
      pending: { n: pend.length, amount: pend.reduce((a, e) => a + e.amount, 0) },
      rejected: entries.filter((e) => e.status === "rejected").length,
      changeApproved: db.changeOrders.filter((c) => c.siteId === site.id && c.status === "approved" && c.decidedAt && inRange(kst(c.decidedAt), from, to)).reduce((a, c) => a + (c.approvedAmount ?? c.amount), 0),
    };
  });
  const sum = (f: (m: CloseSiteMoney) => number) => money.reduce((a, m) => a + f(m), 0);
  const lateEntries = ended ? db.costEntries.filter((e) => e.status === "active" && inRange(e.date, from, to) && kst(activeAt(e)) > b.to) : [];
  const late = { n: lateEntries.length, amount: lateEntries.reduce((a, e) => a + e.amount, 0) };
  const lateBills = ended ? db.billings.filter((x) => x.status === "confirmed" && inRange(x.billedDate, from, to) && !!x.createdAt && kst(x.createdAt) > b.to) : [];
  const latePays = ended ? db.payments.filter((x) => inRange(x.receivedDate, from, to) && !!x.createdAt && kst(x.createdAt) > b.to) : [];
  const lateMoney = { n: lateBills.length + latePays.length, billed: lateBills.reduce((a, x) => a + x.amount, 0), received: latePays.reduce((a, x) => a + x.amount, 0) };
  const totals = { billed: sum((m) => m.billed), received: sum((m) => m.received), outstandingAtEnd: sum((m) => m.outstandingAtEnd), costTotal: sum((m) => m.costTotal), pending: sum((m) => m.pending.amount), changeApproved: sum((m) => m.changeApproved) };

  // ── 이익 변화 이유 (이 달에 생긴 일만 · 더하면 맞도록) ──
  const profit: CloseSiteProfit[] = sites.map((site) => {
    const events = profitEvents(db, site.id, from, to);
    const f = siteFinancials(db, site.id);
    const base = db.baseline[site.id]?.expectedProfit;
    return { site, events, net: events.reduce((a, e) => a + e.amount, 0), expectedProfit: f.expectedProfit, sinceBaseline: base === undefined ? 0 : f.expectedProfit - base };
  });

  // ── 노무 (준공 현장도 이 달에 일했으면) ──
  const labor: CloseLabor[] = sites
    .map((s) => laborEstimate(db, s, from, to))
    .filter((r) => r.teams.length > 0 || r.actual > 0 || r.subcontractCounted > 0)
    .map((l) => {
      const settled = db.costEntries.find((e) => e.siteId === l.site.id && e.settle?.month === month && (e.status === "active" || e.status === "pending"));
      const later = settled
        ? // 공무가 정산 경고를 보고 승인했거나 본사가 직접 넣은 것은 이미 안 것 — 지울 길 없이 남던 항목 (D-82 공무 점검)
          db.costEntries.filter((e) => e.siteId === l.site.id && e.category === "labor" && e.id !== settled.id && !e.settle && (e.status === "active" || e.status === "pending") && inRange(e.date, from, to) && e.createdAt > settled.createdAt && !(e.reviewedAt && e.reviewedAt > settled.createdAt) && e.source !== "PC")
        : [];
      // 팀별 기본값 (D-81) — 입력·외주비 셈은 labor.ts 한 곳에서 (투입·인건비·정산 창·CSV와 같은 숫자)
      const teamPlan = teamPlanFor(l);
      const shortfall = l.estimate - l.compared;
      const suggested = teamPlan.length ? teamPlan.reduce((a, t) => a + t.suggest, 0) : Math.max(0, shortfall);
      // 정산 때 남겨 둔 모자람(일부러 일부만 넣은 경우)보다 더 모자라졌을 때만 다시 알린다
      const leftAtSettle = settled?.settle ? Math.max(0, settled.settle.estimate - settled.settle.actualBefore - settled.amount) : 0;
      const reShort = settled ? Math.max(0, shortfall - leftAtSettle) : 0;
      return {
        ...l,
        settled,
        afterSettle: { n: later.length, amount: later.reduce((a, e) => a + e.amount, 0) },
        shortfall,
        canSettle: ended && !settled && laborShort(l),
        subcontractCovered: l.subcontractCounted,
        suggested,
        planOver: Math.max(0, suggested - Math.max(0, shortfall)) >= 10_000 ? suggested - Math.max(0, shortfall) : 0,
        teamLeft: settled ? teamPlan.filter((t) => t.suggest >= LABOR_GAP_WON).map((t) => ({ team: t.team, amount: t.suggest })) : [],
        teamPlan,
        reShort: reShort >= LABOR_GAP_WON ? reShort : 0,
      };
    });

  // ── 출퇴근 (사람별 · 문제 있는 날짜까지) ──
  const att = (db.attendance ?? []).filter((r) => inRange(r.workDate, from, to));
  const rows = periodSummary(db, from, to, today);
  const people: ClosePerson[] = rows.map((row) => {
    const mine = att.filter((r) => r.userId === row.userId);
    // 시간이 겹치는 기록 — 같은 날뿐 아니라 자정을 넘긴 야간 기록과 다음 날 기록도 (D-79 버그 배시 m-1) · 출퇴근 현황과 같은 계산 (D-80)
    const overlap = new Set(overlapPairs(db, from, to, row.userId).map((o) => o.workDate));
    return {
      row,
      name: name(row.userId),
      missedOut: mine.filter((r) => minutesOf(r) === null && !isOpenShift(r, today)).map((r) => r.workDate).sort(),
      outside: [...new Set(mine.filter((r) => [r.inGeo, r.outGeo].some((g) => g?.status === "outside")).map((r) => r.workDate))].sort(),
      noLocation: [...new Set(mine.filter((r) => r.inGeo.status === "none").map((r) => r.workDate))].sort(),
      overlap: [...overlap].sort(),
      sites: [...new Set(mine.map((r) => db.sites.find((s) => s.id === r.siteId)?.shortName ?? ""))].filter(Boolean),
    };
  });

  // ── 닫기 전에 볼 것 ──
  const items: CloseItem[] = [];
  const pendingCosts = db.costEntries.filter((e) => e.status === "pending" && e.date <= to);
  if (pendingCosts.length) items.push({ kind: "cost", text: `공무 확인 대기 원가 ${pendingCosts.length}건 — 확인해야 이 달 원가에 들어갑니다`, href: "/admin?tab=review" });
  const unconfirmed = db.reports.filter((r) => r.status !== "voided" && !r.importBatchId && !r.review && inRange(r.reportDate, from, to));
  if (unconfirmed.length) {
    const sn = (id: string) => db.sites.find((x) => x.id === id)?.shortName ?? "";
    const labels = [...new Set(unconfirmed.map((r) => `${sn(r.siteId)} ${short(r.reportDate)}`.trim()))];
    items.push({ kind: "report", text: `확인 안 한 현장 보고 ${unconfirmed.length}건 (${labels.slice(0, 5).join(" · ")}${labels.length > 5 ? " …" : ""})`, href: "/orders?tab=reports" });
  }
  for (const site of sites) {
    // 출근 기록은 있는데 그날 작업 보고가 없는 날 (사진·비용만 보낸 날은 보고 없음으로 본다)
    const worked = [...new Set(att.filter((a) => a.siteId === site.id).map((a) => a.workDate))].filter(WORKDAY);
    const reported = new Set(db.reports.filter((r) => r.siteId === site.id && r.status !== "voided" && !r.kind).map((r) => r.reportDate));
    const missing = worked.filter((d) => !reported.has(d) && d < today).sort();
    if (missing.length) items.push({ kind: "noreport", date: missing[0], text: `${site.shortName} — 출근했는데 현장 보고가 없는 날 ${missing.length}일 (${missing.slice(0, 5).map(short).join(" · ")}${missing.length > 5 ? " …" : ""})`, href: `/daily?site=${site.id}&date=${missing[0]}` });
  }
  for (const p of people) {
    if (p.missedOut.length) items.push({ kind: "checkout", date: p.missedOut[0], text: `${p.name} 퇴근 누락 ${p.missedOut.length}일 (${p.missedOut.map(short).join(" · ")}) — 정정하거나 근태 수정 요청을 받아 주세요`, href: `/attendance?date=${p.missedOut[0]}` });
    if (p.overlap.length) items.push({ kind: "overlap", date: p.overlap[0], text: `${p.name} 같은 날 두 현장 기록 시간이 겹침 ${p.overlap.length}일 (${p.overlap.slice(0, 5).map(short).join(" · ")}${p.overlap.length > 5 ? " …" : ""}) — 근무시간이 두 번 셉니다`, href: `/attendance?date=${p.overlap[0]}`, action: { kind: "fixOverlap", userId: p.row.userId } });
  }
  const fixes = (db.attendanceRequests ?? []).filter((q) => q.status === "pending" && q.workDate <= to);
  if (fixes.length) items.push({ kind: "fix", text: `근태 수정 요청 ${fixes.length}건 승인·반려 전`, href: "/orders?tab=fixes" });
  const openOrders = (db.workOrders ?? []).filter((w) => w.status !== "confirmed" && kst(w.createdAt) <= to);
  if (openOrders.length) items.push({ kind: "order", text: `끝나지 않은 작업지시 ${openOrders.length}건 (${openOrders.slice(0, 3).map((w) => w.title).join(" · ")}${openOrders.length > 3 ? " …" : ""})`, href: "/orders" });
  const openRequests = db.partnerRequests.filter((r) => r.type !== "defect" && r.status !== "answered" && kst(r.createdAt) <= to);
  if (openRequests.length) items.push({ kind: "request", text: `회신 안 한 고객 요청 ${openRequests.length}건`, href: "/insights#requests" });
  const waitingCo = db.changeOrders.filter((c) => (c.status === "review" || c.status === "submitted") && kst(c.requestedAt) <= to);
  // 현장·금액·단계까지 — 누가 결정할 일인지 보이게, 누르면 그 변경공사로 (D-82 대표 점검)
  if (waitingCo.length)
    items.push({
      kind: "change",
      text: `결정 전 변경공사 ${waitingCo.length}건 (${waitingCo.map((c) => `${db.sites.find((s) => s.id === c.siteId)?.shortName ?? ""} ${c.title} ${man(c.amount)} · ${CO_STATUS_LABEL[c.status]} · ${short(kst(c.requestedAt))} 요청`).join(" / ")}) — 승인되기 전에는 계약·이익에 들어가지 않습니다`,
      href: `/finance#co-${waitingCo[0].id}`,
    });
  // 노무 — 달이 끝났는데 출력 기준 추정보다 노무비가 모자라면 (정산하면 빠진다) · 정산 뒤 같은 달 노무비가 더 들어오면 겹침 확인 (D-79)
  for (const l of labor) {
    if (ended && l.canSettle)
      items.push({ kind: "labor", text: `${l.site.shortName} — 출력 기준 노무 추정 ${man(l.estimate)}보다 입력된 노무비${l.subcontractCovered > 0 ? `(외주 팀 외주비 ${man(l.subcontractCovered)} 포함)` : ""}가 ${man(l.shortfall)} 적습니다. 빠진 노무비를 넣거나 차액을 정산하세요`, href: `/close?month=${month}#close-labor`, action: { kind: "settleLabor", siteId: l.site.id } });
    if (ended && l.reShort > 0)
      items.push({ kind: "labor", text: `${l.site.shortName} — 노무 정산 뒤에 다시 ${man(l.reShort)} 모자랍니다 (출력이 더 들어왔거나, 정산 때 셈한 노무비가 반려됐거나, 팀 단가가 바뀜). 빠진 노무비를 넣거나 정산 건을 되돌린 뒤 다시 넣으세요`, href: `/sites/${l.site.id}?tab=cost` });
    if (l.settled && l.afterSettle.n > 0)
      items.push({ kind: "labor", text: `${l.site.shortName} — 노무 정산(${short(kst(l.settled.createdAt))}) 뒤에 같은 달 노무비 ${l.afterSettle.n}건(${man(l.afterSettle.amount)})이 더 들어왔습니다. 정산과 겹치지 않는지 확인하세요`, href: `/sites/${l.site.id}?tab=cost` });
  }
  const completedSites = sites.filter((s) => s.status === "completed" && (!s.warranty?.completedDate || inRange(s.warranty.completedDate, from, to)));
  // 준공 원가 — 준공한 달이 지나도 마감할 때까지 매달 띄운다 (D-79 · 준공한 달에 못 닫으면 다음 달 화면에서 사라지던 문제)
  for (const s of db.sites.filter((x) => x.status === "completed" && (!x.warranty?.completedDate || x.warranty.completedDate <= to) && x.startDate <= to)) {
    const remaining = siteFinancials(db, s.id).remaining;
    // 준공일 이후에 한 원가 마감만 인정 (진행 중에 잘못 남긴 표시로 알림이 꺼지지 않게)
    const closed = (db.forecastChanges ?? []).some((c) => c.siteId === s.id && c.closeout && (!s.warranty?.completedDate || kst(c.at) >= s.warranty.completedDate));
    const when = s.warranty?.completedDate && s.warranty.completedDate < from ? ` (${Number(s.warranty.completedDate.slice(5, 7))}월 준공)` : "";
    if (remaining > 0 && !closed) items.push({ kind: "settle", text: `${s.shortName} 준공${when} — 잔여 예상원가 ${man(remaining)}이 남아 있어 이익이 계획값 그대로입니다. 남은 비용을 넣거나 원가를 마감하세요`, href: `/sites/${s.id}?tab=cost`, action: { kind: "closeout", siteId: s.id } });
    // 마감 때 청구서 대기로 남긴 금액 — 청구서가 오면 원가로 넣고, 안 오면 0으로 정리할 때까지 매달 (D-79 공무 점검 M3)
    else if (remaining > 0 && closed) items.push({ kind: "settle", text: `${s.shortName} 준공${when} — 원가 마감 때 청구서 대기로 남긴 ${man(remaining)}이 있습니다. 청구서가 오면 원가로 넣고, 안 오면 0으로 정리하세요`, href: `/sites/${s.id}?tab=cost`, action: { kind: "closeout", siteId: s.id } });
  }
  for (const s of completedSites) if (!s.warranty?.completedDate) items.push({ kind: "completion", text: `${s.shortName} — 상태는 준공인데 준공일이 없습니다`, href: `/sites/${s.id}?tab=requests` });
  return { month, from, to, ended, money, totals, late, lateMoney, profit, labor, people, items, completedSites };
}


const STATUS_LABEL: Record<CostEntry["status"], string> = { active: "확정", pending: "공무 확인 대기", rejected: "반려", voided: "취소" };
const SOURCE_LABEL: Record<CostEntry["source"], string> = { FIELD: "현장 보고", PC: "본사 입력", CSV: "가져오기", SEED: "기준 자료" };

/**
 * 이달 원가 CSV (D-79) — 발생일이 이 달인 원가 전부(취소·반려 포함 · 상태 칸으로 구분).
 * 공무가 금액을 고친 건은 ‘처음 금액’과 공무 메모를 함께 적는다 (세금계산서 기준 조정 등).
 */
export function monthCostRows(db: DemoDB, month: string, today = todayIso()): (string | number)[][] {
  const b = monthBounds(month);
  const to = b.to < today ? b.to : today;
  const site = (id: string) => db.sites.find((x) => x.id === id)?.shortName ?? "";
  const name = (id?: string) => (id ? (db.users.find((u) => u.id === id)?.name ?? "") : "");
  const rows = db.costEntries
    .filter((e) => e.date >= b.from && e.date <= to)
    .sort((a, x) => a.date.localeCompare(x.date) || site(a.siteId).localeCompare(site(x.siteId)) || a.createdAt.localeCompare(x.createdAt))
    // 팀별로 나눈 노무 정산은 팀마다 한 줄 (엑셀에서 팀별로 더할 수 있게 · 금액 합은 그 건과 같음 · D-81 점검)
    .flatMap((e) => {
      const parts: { team: string; amount: number; note: string }[] = e.settle?.teams?.length
        ? (() => {
            const rest = e.amount - e.settle!.teams!.reduce((a, t) => a + t.amount, 0);
            return [...e.settle!.teams!.map((t, i) => ({ team: t.team, amount: t.amount, note: `${e.note} [팀별 ${i + 1}/${e.settle!.teams!.length}]` })), ...(rest > 0 ? [{ team: "", amount: rest, note: `${e.note} [팀 미지정분]` }] : [])];
          })()
        : [{ team: e.team ?? "", amount: e.amount, note: e.note }];
      return parts.map((p) => ({ e, ...p }));
    })
    .map(({ e, team, amount, note }) => {
      const first = e.editHistory?.[0]?.before;
      return [
        e.date,
        kst(e.createdAt),
        site(e.siteId),
        CATEGORY_LABEL[e.category],
        team,
        amount,
        IMPACT_LABEL[e.forecastImpact],
        REASON_LABEL[e.reason],
        note,
        e.settle ? "본사 입력 (노무 정산)" : SOURCE_LABEL[e.source],
        name(e.createdBy),
        STATUS_LABEL[e.status],
        e.reviewedAt ? `${kst(e.reviewedAt)} ${name(e.reviewedBy)}`.trim() : "",
        first && first.amount !== e.amount ? first.amount : "",
        [e.reviewNote, e.status === "voided" ? e.voidReason : ""].filter(Boolean).join(" · "),
      ];
    });
  return [["발생일", "입력일", "현장", "항목", "팀", "금액(원)", "성격", "사유", "메모", "입력 경로", "입력한 사람", "상태", "공무 확인", "처음 금액(고치기 전)", "공무 메모·취소 사유"], ...rows];
}

/**
 * 노무비를 확인할 때 — 이 현장의 같은 달 또는 지난달 노무를 이미 정산했으면 그 정산 건 (D-79 공무 점검 M5).
 * 현장이 지난달 몫 노무비를 오늘 날짜로 보내면 같은 달로 안 잡혀 정산과 두 번 들어가던 것을 공무가 승인 전에 알아보게.
 */
export function settledLaborFor(db: DemoDB, e: Pick<CostEntry, "id" | "siteId" | "category" | "date">): CostEntry | undefined {
  if (e.category !== "labor") return undefined;
  const month = e.date.slice(0, 7);
  const prev = previousMonth(e.date);
  const early = Number(e.date.slice(8, 10)) <= 20;
  return db.costEntries.find((x) => x.id !== e.id && x.siteId === e.siteId && !!x.settle && (x.status === "active" || x.status === "pending") && (x.settle.month === month || (early && x.settle.month === prev)));
}
