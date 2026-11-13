/**
 * 월 마감 (D-78 첫 달 리허설) — 한 달을 닫을 때 공무·대표가 보는 한 장.
 * 금액·원가·노무·출퇴근은 다른 화면과 같은 계산(siteFinancials·laborEstimate·periodSummary)을 그대로 쓴다 — 숫자가 화면마다 달라지지 않게.
 * 날짜는 모두 한국 날짜(YYYY-MM-DD). ‘이번 달’이면 오늘까지만 센다.
 */
import type { CostCategory, DemoDB, Site } from "./types";
import { COST_CATEGORIES } from "./labels";
import { siteFinancials } from "./calc";
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

export type CloseItemKind = "cost" | "report" | "noreport" | "checkout" | "fix" | "order" | "request" | "change" | "settle" | "completion" | "overlap";
export interface CloseItem {
  kind: CloseItemKind;
  date?: string;
  text: string;
  href: string;
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
  profit: CloseSiteProfit[];
  labor: LaborSite[];
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
const WORKDAY = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0;

/** 이 달에 일한(또는 진행 중이던) 현장 — 준공 현장도 이 달 안에 끝났으면 넣는다 */
export function closeSites(db: DemoDB, from: string, to: string): Site[] {
  return db.sites.filter((s) => s.startDate <= to && (s.status === "active" || (s.endDate >= from && s.startDate <= to) || (db.attendance ?? []).some((a) => a.siteId === s.id && inRange(a.workDate, from, to))));
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
  const totals = { billed: sum((m) => m.billed), received: sum((m) => m.received), outstandingAtEnd: sum((m) => m.outstandingAtEnd), costTotal: sum((m) => m.costTotal), pending: sum((m) => m.pending.amount), changeApproved: sum((m) => m.changeApproved) };

  // ── 이익 변화 이유 (이 달에 생긴 일만 · 더하면 맞도록) ──
  const profit: CloseSiteProfit[] = sites.map((site) => {
    const events: CloseProfitEvent[] = [];
    for (const e of db.costEntries.filter((x) => x.siteId === site.id && x.status === "active" && x.forecastImpact === "additional" && inRange(x.date, from, to)))
      events.push({ date: e.date, amount: -e.amount, text: `추가 원가 — ${e.note || "사유 미기재"}` });
    for (const c of db.changeOrders.filter((x) => x.siteId === site.id && x.status === "approved" && x.decidedAt && inRange(kst(x.decidedAt), from, to))) {
      const amt = c.approvedAmount ?? c.amount;
      events.push({ date: kst(c.decidedAt!), amount: amt, text: `변경공사 승인 — ${c.title}${amt < 0 ? " (감액)" : ""}` });
      if (c.addedCost) events.push({ date: kst(c.decidedAt!), amount: -c.addedCost.amount, text: `변경공사 원가 — ${c.title}` });
    }
    events.sort((a, x) => a.date.localeCompare(x.date));
    const f = siteFinancials(db, site.id);
    const base = db.baseline[site.id]?.expectedProfit;
    return { site, events, net: events.reduce((a, e) => a + e.amount, 0), expectedProfit: f.expectedProfit, sinceBaseline: base === undefined ? 0 : f.expectedProfit - base };
  });

  // ── 노무 (준공 현장도 이 달에 일했으면) ──
  const labor = sites.map((s) => laborEstimate(db, s, from, to)).filter((r) => r.teams.length > 0 || r.actual > 0);

  // ── 출퇴근 (사람별 · 문제 있는 날짜까지) ──
  const att = (db.attendance ?? []).filter((r) => inRange(r.workDate, from, to));
  const rows = periodSummary(db, from, to, today);
  const people: ClosePerson[] = rows.map((row) => {
    const mine = att.filter((r) => r.userId === row.userId);
    const overlap = new Set<string>();
    const byDay = new Map<string, typeof mine>();
    for (const r of mine) byDay.set(r.workDate, [...(byDay.get(r.workDate) ?? []), r]);
    for (const [d, list] of byDay) {
      const iv = list.filter((r) => r.outAt).map((r) => [new Date(r.inAt).getTime(), new Date(r.outAt!).getTime()] as const).sort((a, x) => a[0] - x[0]);
      for (let i = 1; i < iv.length; i++) if (iv[i][0] < iv[i - 1][1]) overlap.add(d);
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
  if (unconfirmed.length) items.push({ kind: "report", text: `확인 안 한 현장 보고 ${unconfirmed.length}건 (${[...new Set(unconfirmed.map((r) => short(r.reportDate)))].slice(0, 5).join(" · ")}${unconfirmed.length > 5 ? " …" : ""})`, href: "/orders?tab=reports" });
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
  const completedSites = sites.filter((s) => s.status === "completed" && (!s.warranty?.completedDate || inRange(s.warranty.completedDate, from, to)));
  for (const s of completedSites) {
    const remaining = siteFinancials(db, s.id).remaining;
    if (remaining > 0) items.push({ kind: "settle", text: `${s.shortName} 준공 — 잔여 예상원가 ${Math.round(remaining / 10_000).toLocaleString("ko-KR")}만 원이 남아 있어 이익이 계획값 그대로입니다. 남은 비용을 넣거나 잔여예상을 0으로 마감하세요`, href: `/sites/${s.id}?tab=cost` });
    if (!s.warranty?.completedDate) items.push({ kind: "completion", text: `${s.shortName} — 상태는 준공인데 준공일이 없습니다`, href: `/sites/${s.id}?tab=requests` });
  }
  return { month, from, to, ended, money, totals, profit, labor, people, items, completedSites };
}
