/**
 * 월 마감 (D-78 첫 달 리허설) — 한 달을 닫을 때 공무·대표가 보는 한 장.
 * 금액·원가·노무·출퇴근은 다른 화면과 같은 계산(siteFinancials·laborEstimate·periodSummary)을 그대로 쓴다 — 숫자가 화면마다 달라지지 않게.
 * 날짜는 모두 한국 날짜(YYYY-MM-DD). ‘이번 달’이면 오늘까지만 센다.
 */
import type { CostCategory, CostEntry, DemoDB, Site } from "./types";
import { CATEGORY_LABEL, COST_CATEGORIES, IMPACT_LABEL, REASON_LABEL } from "./labels";
import { activeAt, entryEacImpact, siteFinancials } from "./calc";
import { laborEstimate, type LaborSite } from "./labor";
import { isOpenShift, minutesOf, periodSummary, type MonthRow } from "./attendance";
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
  action?: { kind: "settleLabor" | "closeout"; siteId: string };
}

/** 노무 한 줄 + 월 마감 정산 상태 (D-79) */
export interface CloseLabor extends LaborSite {
  /** 이 달 노무 정산 (있으면) */
  settled?: CostEntry;
  /** 정산 뒤에 같은 달로 더 들어온 노무비 */
  afterSettle: { n: number; amount: number };
  /** 출력 기준 추정 − 입력된 노무비 (+ 면 입력이 모자람) */
  shortfall: number;
  /** 정산 버튼을 보여 줄지 — 달이 끝났고, 추정보다 적게 들어왔고, 아직 정산 안 함 */
  canSettle: boolean;
  /** 외주 팀 추정 중 이 기간 외주비로 이미 들어온 금액 — 정산 기본값에서 뺀다 (노무비·외주비 이중 계상 방지) */
  subcontractCovered: number;
  /** 정산 기본값 = 모자람 − 외주비로 들어온 외주 팀 몫 */
  suggested: number;
  /** 정산한 뒤에 다시 생긴 모자람 (출력 추가·정산 때 셈한 확인 대기 노무비 반려 등) */
  reShort: number;
}

/** 추정과 입력의 차이를 ‘모자람’으로 볼 기준 — 투입·인건비 화면(labor.ts)과 같은 값 */
const LABOR_GAP_WON = 500_000;
const LABOR_GAP_RATIO = 1.2;
export function laborShort(l: Pick<LaborSite, "estimate" | "actual">): boolean {
  return l.estimate > 0 && (l.actual === 0 || (l.estimate > l.actual * LABOR_GAP_RATIO && l.estimate - l.actual >= LABOR_GAP_WON));
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
  return db.sites.filter((s) => s.startDate <= to && (s.status === "active" || (s.endDate >= from && s.startDate <= to) || touched(s.id)));
}

/**
 * 예상이익을 바꾼 일 — 기간 안에 ‘손익에 들어온’ 날 기준 (D-79 대표 점검: 계획 안 집행이 잔여예상을 넘어 이익을 바꿔도 빠지던 문제).
 * - 원가: 추가 원가는 전액, 계획 안 집행은 잔여예상을 넘은 만큼 (공무 확인 방식이면 확인한 날)
 * - 변경공사 승인 (+) · 그 예상 원가 (−)
 * - 잔여예상 재추정·준공 원가 마감 (예상 총원가 변화)
 */
export function profitEvents(db: DemoDB, siteId: string, from: string, to: string): CloseProfitEvent[] {
  const events: CloseProfitEvent[] = [];
  for (const e of db.costEntries.filter((x) => x.siteId === siteId && x.status === "active")) {
    const when = kst(activeAt(e));
    if (!inRange(when, from, to)) continue;
    const impact = entryEacImpact(db, e);
    if (impact <= 0) continue;
    const occurred = e.date !== when ? ` (발생 ${short(e.date)})` : "";
    events.push(
      e.forecastImpact === "additional"
        ? { date: when, amount: -impact, text: `추가 원가 — ${e.note || "사유 미기재"}${occurred}` }
        : { date: when, amount: -impact, text: `잔여예상을 넘은 집행 — ${CATEGORY_LABEL[e.category]} ${e.note || ""}${occurred}`.replace(/\s+/g, " ").trim() },
    );
  }
  for (const c of db.changeOrders.filter((x) => x.siteId === siteId && x.status === "approved" && x.decidedAt && inRange(kst(x.decidedAt), from, to))) {
    const amt = c.approvedAmount ?? c.amount;
    events.push({ date: kst(c.decidedAt!), amount: amt, text: `변경공사 승인 — ${c.title}${amt < 0 ? " (감액)" : ""}` });
    if (c.addedCost) events.push({ date: kst(c.decidedAt!), amount: -c.addedCost.amount, text: `변경공사 원가 — ${c.title}` });
  }
  // 잔여예상을 다시 잡아 예상 총원가가 바뀐 일 (준공 원가 마감 포함 · D-79)
  for (const c of (db.forecastChanges ?? []).filter((x) => x.siteId === siteId && inRange(kst(x.at), from, to) && x.eacBefore !== x.eacAfter))
    events.push({ date: kst(c.at), amount: c.eacBefore - c.eacAfter, text: `${c.closeout ? "준공 원가 마감" : "잔여예상 재추정"} — ${c.note}` });
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
    .filter((r) => r.teams.length > 0 || r.actual > 0)
    .map((l) => {
      const settled = db.costEntries.find((e) => e.siteId === l.site.id && e.settle?.month === month && (e.status === "active" || e.status === "pending"));
      const later = settled
        ? db.costEntries.filter((e) => e.siteId === l.site.id && e.category === "labor" && e.id !== settled.id && !e.settle && (e.status === "active" || e.status === "pending") && inRange(e.date, from, to) && e.createdAt > settled.createdAt)
        : [];
      const subEstimate = l.teams.filter((t) => t.kind === "subcontract").reduce((a, t) => a + t.estimate, 0);
      const subCost = db.costEntries.filter((e) => e.siteId === l.site.id && e.category === "subcontract" && (e.status === "active" || e.status === "pending") && e.date >= l.compareFrom && e.date <= l.to).reduce((a, e) => a + e.amount, 0);
      const subcontractCovered = Math.min(subEstimate, subCost);
      const shortfall = l.estimate - l.actual;
      // 정산 때 남겨 둔 모자람(일부러 일부만 넣은 경우)보다 더 모자라졌을 때만 다시 알린다
      const leftAtSettle = settled?.settle ? Math.max(0, settled.settle.estimate - settled.settle.actualBefore - settled.amount) : 0;
      const reShort = settled ? Math.max(0, shortfall - leftAtSettle) : 0;
      return {
        ...l,
        settled,
        afterSettle: { n: later.length, amount: later.reduce((a, e) => a + e.amount, 0) },
        shortfall,
        canSettle: ended && !settled && laborShort(l),
        subcontractCovered,
        suggested: Math.max(0, shortfall - subcontractCovered),
        reShort: reShort >= LABOR_GAP_WON ? reShort : 0,
      };
    });

  // ── 출퇴근 (사람별 · 문제 있는 날짜까지) ──
  const att = (db.attendance ?? []).filter((r) => inRange(r.workDate, from, to));
  const rows = periodSummary(db, from, to, today);
  const people: ClosePerson[] = rows.map((row) => {
    const mine = att.filter((r) => r.userId === row.userId);
    // 시간이 겹치는 기록 — 같은 날뿐 아니라 자정을 넘긴 야간 기록과 다음 날 기록도 (D-79 버그 배시 m-1)
    const overlap = new Set<string>();
    const iv = mine.filter((r) => r.outAt).map((r) => ({ d: r.workDate, a: new Date(r.inAt).getTime(), b: new Date(r.outAt!).getTime() })).sort((x, y) => x.a - y.a);
    let maxEnd = -Infinity;
    for (const x of iv) {
      if (x.a < maxEnd) overlap.add(x.d);
      maxEnd = Math.max(maxEnd, x.b);
    }
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
    if (p.overlap.length) items.push({ kind: "overlap", date: p.overlap[0], text: `${p.name} 같은 날 두 현장 기록 시간이 겹침 ${p.overlap.length}일 (${p.overlap.slice(0, 5).map(short).join(" · ")}) — 근무시간이 두 번 셉니다`, href: `/attendance?date=${p.overlap[0]}` });
  }
  const fixes = (db.attendanceRequests ?? []).filter((q) => q.status === "pending" && q.workDate <= to);
  if (fixes.length) items.push({ kind: "fix", text: `근태 수정 요청 ${fixes.length}건 승인·반려 전`, href: "/orders?tab=fixes" });
  const openOrders = (db.workOrders ?? []).filter((w) => w.status !== "confirmed" && kst(w.createdAt) <= to);
  if (openOrders.length) items.push({ kind: "order", text: `끝나지 않은 작업지시 ${openOrders.length}건 (${openOrders.slice(0, 3).map((w) => w.title).join(" · ")}${openOrders.length > 3 ? " …" : ""})`, href: "/orders" });
  const openRequests = db.partnerRequests.filter((r) => r.type !== "defect" && r.status !== "answered" && kst(r.createdAt) <= to);
  if (openRequests.length) items.push({ kind: "request", text: `회신 안 한 고객 요청 ${openRequests.length}건`, href: "/insights#requests" });
  const waitingCo = db.changeOrders.filter((c) => (c.status === "review" || c.status === "submitted") && kst(c.requestedAt) <= to);
  if (waitingCo.length) items.push({ kind: "change", text: `결정 전 변경공사 ${waitingCo.length}건 (${waitingCo.map((c) => c.title).join(" · ")}) — 승인되기 전에는 계약·이익에 들어가지 않습니다`, href: "/finance" });
  // 노무 — 달이 끝났는데 출력 기준 추정보다 노무비가 모자라면 (정산하면 빠진다) · 정산 뒤 같은 달 노무비가 더 들어오면 겹침 확인 (D-79)
  for (const l of labor) {
    if (ended && l.canSettle)
      items.push({ kind: "labor", text: `${l.site.shortName} — 출력 기준 노무 추정 ${man(l.estimate)}보다 입력된 노무비가 ${man(l.shortfall)} 적습니다. 빠진 노무비를 넣거나 차액을 정산하세요`, href: `/close?month=${month}#close-labor`, action: { kind: "settleLabor", siteId: l.site.id } });
    if (ended && l.reShort > 0)
      items.push({ kind: "labor", text: `${l.site.shortName} — 노무 정산 뒤에 다시 ${man(l.reShort)} 모자랍니다 (출력이 더 들어왔거나 정산 때 셈한 노무비가 반려됨). 정산 건을 고치거나 빠진 노무비를 넣으세요`, href: `/sites/${l.site.id}?tab=cost` });
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
  return { month, from, to, ended, money, totals, late, profit, labor, people, items, completedSites };
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
    .map((e) => {
      const first = e.editHistory?.[0]?.before;
      return [
        e.date,
        kst(e.createdAt),
        site(e.siteId),
        CATEGORY_LABEL[e.category],
        e.amount,
        IMPACT_LABEL[e.forecastImpact],
        REASON_LABEL[e.reason],
        e.note,
        e.settle ? "본사 입력 (노무 정산)" : SOURCE_LABEL[e.source],
        name(e.createdBy),
        STATUS_LABEL[e.status],
        e.reviewedAt ? `${kst(e.reviewedAt)} ${name(e.reviewedBy)}`.trim() : "",
        first && first.amount !== e.amount ? first.amount : "",
        [e.reviewNote, e.status === "voided" ? e.voidReason : ""].filter(Boolean).join(" · "),
      ];
    });
  return [["발생일", "입력일", "현장", "항목", "금액(원)", "성격", "사유", "메모", "입력 경로", "입력한 사람", "상태", "공무 확인", "처음 금액(고치기 전)", "공무 메모·취소 사유"], ...rows];
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
