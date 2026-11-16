/**
 * 월 마감 기록 (D-82) — 공무 ‘마감’ → 대표 ‘확인’ → 마감 뒤 바뀐 것 알림.
 * 데이터는 잠그지 않는다(잠글지는 대표 결정 D-78 대기). 대신 마감할 때의 숫자를 남겨 두고,
 * 그 뒤에 그 달 날짜로 들어오거나 바뀐 원가·기성·입금·출퇴근 시간·출력 추정을 지금 숫자와 비교해 보여 준다.
 */
import type { DemoDB, MonthCloseRecord, MonthCloseSnapshot } from "./types";
import { CATEGORY_LABEL } from "./labels";
import { monthBounds, monthClose, previousMonth, type MonthCloseReport } from "./monthClose";
import { fmtMan } from "./format";

const inMonth = (d: string | undefined, from: string, to: string) => !!d && d >= from && d <= to;

/** 지금 유효한 마감 (다시 열지 않은 마지막 기록) */
export function currentClose(db: Pick<DemoDB, "monthCloses">, month: string): MonthCloseRecord | undefined {
  return (db.monthCloses ?? []).filter((r) => r.month === month && !r.reopenedAt).sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
}

/** 그 달의 이전 마감 기록 (다시 연 것) — 최근 순 */
export function pastCloses(db: Pick<DemoDB, "monthCloses">, month: string): MonthCloseRecord[] {
  return (db.monthCloses ?? []).filter((r) => r.month === month && r.reopenedAt).sort((a, b) => b.closedAt.localeCompare(a.closedAt));
}

/** 그 달의 원가·기성·입금 지문 */
export function monthKeys(db: DemoDB, month: string): MonthCloseSnapshot["keys"] {
  const { from, to } = monthBounds(month);
  return {
    costs: db.costEntries.filter((e) => inMonth(e.date, from, to)).map((e) => [e.id, e.siteId, e.status, e.amount, e.category, e.date].join("|")),
    billings: db.billings.filter((x) => inMonth(x.billedDate, from, to)).map((x) => [x.id, x.siteId, x.status, x.amount, "", x.billedDate].join("|")),
    payments: db.payments.filter((x) => inMonth(x.receivedDate, from, to)).map((x) => [x.id, x.siteId, "received", x.amount, "", x.receivedDate].join("|")),
  };
}

/** 마감할 때 남길 숫자 — 월 마감 화면과 같은 계산(monthClose) */
export function closeSnapshot(db: DemoDB, report: MonthCloseReport): MonthCloseSnapshot {
  const labor = new Map(report.labor.map((l) => [l.site.id, l]));
  const profit = new Map(report.profit.map((p) => [p.site.id, p]));
  return {
    totals: { billed: report.totals.billed, received: report.totals.received, outstandingAtEnd: report.totals.outstandingAtEnd, costTotal: report.totals.costTotal, pending: report.totals.pending },
    sites: report.money.map((m) => ({
      siteId: m.site.id,
      name: m.site.shortName,
      billed: m.billed,
      received: m.received,
      outstandingAtEnd: m.outstandingAtEnd,
      costTotal: m.costTotal,
      pending: m.pending.amount,
      laborEstimate: labor.get(m.site.id)?.estimate ?? 0,
      laborCompared: labor.get(m.site.id)?.compared ?? 0,
      expectedProfit: profit.get(m.site.id)?.expectedProfit ?? 0,
    })),
    people: report.people.map((p) => ({ userId: p.row.userId, name: p.name, days: p.row.days, minutes: p.row.minutes })),
    openItems: report.items.map((i) => i.text),
    keys: monthKeys(db, report.month),
  };
}

export interface CloseChange {
  /** 언제 생긴 일인지 알 수 있으면 (원가는 입력·확인·고친·취소 시각) */
  at?: string;
  siteId?: string;
  text: string;
  href: string;
}
export interface CloseDiffRow {
  siteId: string;
  name: string;
  label: string;
  before: number;
  after: number;
}
export interface ChangesAfterClose {
  /** 숫자가 바뀐 것 (현장·항목별 전 → 후) */
  diffs: CloseDiffRow[];
  /** 무엇이 들어오고 바뀌었는지 */
  events: CloseChange[];
  /** 사람별 출퇴근 시간 (분) 바뀐 것 */
  people: { userId: string; name: string; before: number; after: number }[];
  count: number;
}

type Key = { id: string; siteId: string; status: string; amount: number; category: string; date: string };
const parse = (k: string): Key => {
  const [id, siteId, status, amount, category, date] = k.split("|");
  return { id, siteId, status, amount: Number(amount), category, date };
};
const STATUS = { active: "반영", pending: "공무 확인 대기", rejected: "반려", voided: "취소", confirmed: "확정", draft: "초안", received: "입금" } as Record<string, string>;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 마감한 뒤에 그 달 숫자가 바뀐 것 — 지금 계산과 마감 때 숫자를 비교한다 */
export function changesAfterClose(db: DemoDB, rec: MonthCloseRecord, today: string): ChangesAfterClose {
  const now = closeSnapshot(db, monthClose(db, rec.month, today));
  const before = rec.snapshot;
  const site = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? before.sites.find((s) => s.siteId === id)?.name ?? "현장";
  const diffs: CloseDiffRow[] = [];
  const ids = [...new Set([...before.sites.map((s) => s.siteId), ...now.sites.map((s) => s.siteId)])];
  const FIELDS: [keyof MonthCloseSnapshot["sites"][number], string][] = [
    ["billed", "이달 기성"],
    ["received", "이달 입금"],
    ["outstandingAtEnd", "월말 미수"],
    ["costTotal", "이달 원가"],
    ["pending", "공무 확인 대기 원가"],
    ["laborEstimate", "출력 기준 노무 추정"],
    ["laborCompared", "입력된 노무비"],
  ];
  for (const id of ids) {
    const a = before.sites.find((s) => s.siteId === id);
    const b = now.sites.find((s) => s.siteId === id);
    for (const [f, label] of FIELDS) {
      const x = Number(a?.[f] ?? 0);
      const y = Number(b?.[f] ?? 0);
      if (x !== y) diffs.push({ siteId: id, name: site(id), label, before: x, after: y });
    }
  }
  const events: CloseChange[] = [];
  const kinds: [keyof MonthCloseSnapshot["keys"], string][] = [
    ["costs", "원가"],
    ["billings", "기성"],
    ["payments", "입금"],
  ];
  for (const [k, word] of kinds) {
    const was = new Map(before.keys[k].map((x) => [parse(x).id, parse(x)]));
    const is = new Map(now.keys[k].map((x) => [parse(x).id, parse(x)]));
    const href = (x: Key) => (k === "costs" ? `/sites/${x.siteId}?tab=cost` : "/finance");
    const what = (x: Key) => `${site(x.siteId)} ${k === "costs" ? (CATEGORY_LABEL[x.category as keyof typeof CATEGORY_LABEL] ?? "원가") : word} ${fmtMan(x.amount)} (${md(x.date)})`;
    const at = (id: string) => {
      if (k !== "costs") return undefined;
      const e = db.costEntries.find((c) => c.id === id);
      return e ? [e.createdAt, e.reviewedAt, e.editedAt, e.voidedAt].filter((t): t is string => !!t && t > rec.closedAt).sort().at(-1) : undefined;
    };
    for (const [id, x] of is) {
      const y = was.get(id);
      if (!y) events.push({ at: at(id), siteId: x.siteId, text: `${word} 들어옴 · ${what(x)}${x.status !== "active" && x.status !== "confirmed" && x.status !== "received" ? ` · ${STATUS[x.status] ?? x.status}` : ""}`, href: href(x) });
      else if (y.status !== x.status || y.amount !== x.amount || y.category !== x.category)
        events.push({
          at: at(id),
          siteId: x.siteId,
          text: `${word} 바뀜 · ${what(x)} — ${[y.amount !== x.amount ? `${fmtMan(y.amount)} → ${fmtMan(x.amount)}` : "", y.status !== x.status ? `${STATUS[y.status] ?? y.status} → ${STATUS[x.status] ?? x.status}` : "", y.category !== x.category && k === "costs" ? `${CATEGORY_LABEL[y.category as keyof typeof CATEGORY_LABEL]} → ${CATEGORY_LABEL[x.category as keyof typeof CATEGORY_LABEL]}` : ""].filter(Boolean).join(" · ")}`,
          href: href(x),
        });
    }
    for (const [id, y] of was) if (!is.has(id)) events.push({ siteId: y.siteId, text: `${word} 빠짐 · ${what(y)} (가져오기 취소 등)`, href: href(y) });
  }
  // 출력 추정이 바뀌었으면 (늦게 들어온 작업 인원·팀 단가 변경)
  for (const d of diffs.filter((x) => x.label === "출력 기준 노무 추정")) events.push({ siteId: d.siteId, text: `출력 기준 노무 추정 바뀜 · ${d.name} ${fmtMan(d.before)} → ${fmtMan(d.after)} (늦게 들어온 작업 인원·팀 단가)`, href: `/labor?month=${rec.month}` });
  const people = now.people
    .map((p) => ({ userId: p.userId, name: p.name, before: before.people.find((x) => x.userId === p.userId)?.minutes ?? 0, after: p.minutes }))
    .concat(before.people.filter((x) => !now.people.some((p) => p.userId === x.userId)).map((x) => ({ userId: x.userId, name: x.name, before: x.minutes, after: 0 })))
    .filter((p) => p.before !== p.after);
  events.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return { diffs, events, people, count: events.length + people.length };
}

/** 대시보드 처리 대기·아침 알림용 — 지난달 마감 상태 */
export function closeStatus(db: DemoDB, today: string): { month: string; state: "open" | "closed" | "confirmed"; changes: number } | null {
  const month = previousMonth(today);
  const { from, to } = monthBounds(month);
  // 그 달에 일한 현장이 없으면 (새 회사) 마감할 것이 없다
  const worked = db.sites.some((s) => s.startDate <= to && (s.status === "active" || db.costEntries.some((e) => e.siteId === s.id && inMonth(e.date, from, to)) || db.billings.some((b) => b.siteId === s.id && inMonth(b.billedDate, from, to))));
  const rec = currentClose(db, month);
  if (!rec) return worked ? { month, state: "open", changes: 0 } : null;
  return { month, state: rec.confirmedAt ? "confirmed" : "closed", changes: changesAfterClose(db, rec, today).count };
}

/** 그 날짜가 마감한 달이면 그 마감 (원가 승인·고치기 때 알리기) */
export function closedMonthOf(db: Pick<DemoDB, "monthCloses">, date: string | undefined): MonthCloseRecord | undefined {
  return date ? currentClose(db, date.slice(0, 7)) : undefined;
}

export const minutesText = (m: number) => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
