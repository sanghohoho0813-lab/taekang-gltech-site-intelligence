/**
 * 월 마감 기록 (D-82) — 공무 ‘마감’ → 대표 ‘확인’ → 마감 뒤 바뀐 것 알림.
 * 데이터는 잠그지 않는다(잠글지는 대표 결정 D-78 대기). 대신 마감할 때의 숫자를 남겨 두고,
 * 그 뒤에 그 달 날짜로 들어오거나 바뀐 원가·기성·입금·출퇴근 시간·출력 추정을 지금 숫자와 비교해 보여 준다.
 */
import type { DemoDB, MonthCloseRecord, MonthCloseSnapshot } from "./types";
import { CATEGORY_LABEL } from "./labels";
import { closeSites, monthBounds, monthClose, previousMonth, type MonthCloseReport } from "./monthClose";
import { siteFinancials } from "./calc";
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
    // 기성·입금은 달 마지막 날까지 전부 — 지난 달 날짜로 들어온 것도 ‘월말 미수’를 바꾸므로 (D-82 점검: 9/25 기성이 0건으로 셈)
    billings: db.billings.filter((x) => !!x.billedDate && x.billedDate <= to).map((x) => [x.id, x.siteId, x.status, x.amount, "", x.billedDate].join("|")),
    payments: db.payments.filter((x) => !!x.receivedDate && x.receivedDate <= to).map((x) => [x.id, x.siteId, "received", x.amount, "", x.receivedDate].join("|")),
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
  /** 기준 — 마감 때 숫자인지, 대표가 확인할 때 숫자인지 */
  basis: "close" | "confirm";
}

type Key = { id: string; siteId: string; status: string; amount: number; category: string; date: string };
const parse = (k: string): Key => {
  const [id, siteId, status, amount, category, date] = k.split("|");
  return { id, siteId, status, amount: Number(amount), category, date };
};
const STATUS = { active: "반영", pending: "공무 확인 대기", rejected: "반려", voided: "취소", confirmed: "확정", draft: "초안", received: "입금" } as Record<string, string>;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * 마감(또는 대표 확인) 뒤에 그 달 숫자가 바뀐 것 — 지금 계산과 기준 숫자를 비교한다.
 * 대표가 확인했으면 확인 때 숫자가 기준 (확인한 변경과 새 변경을 나누려고 · D-82 점검).
 */
export function changesAfterClose(db: DemoDB, rec: MonthCloseRecord, today: string): ChangesAfterClose {
  const now = closeSnapshot(db, monthClose(db, rec.month, today));
  return { ...compareSnapshots(db, rec.month, rec.confirmSnapshot ?? rec.snapshot, now, rec.confirmedAt ?? rec.closedAt), basis: rec.confirmSnapshot ? "confirm" : "close" };
}

/** 두 숫자 묶음 비교 — 들어온·바뀐·빠진 원가·기성·입금, 출력 추정, 근무시간, 그리고 설명되지 않는 숫자 변화 */
export function compareSnapshots(db: DemoDB, month: string, before: MonthCloseSnapshot, now: MonthCloseSnapshot, since: string): ChangesAfterClose {
  const { from } = monthBounds(month);
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
  // 지난 기록(다시 연 마감)은 지문을 비워 둔다 — 지문이 없으면 이벤트는 숫자 변화로만 찾는다
  const hasKeys = before.keys.costs.length + before.keys.billings.length + before.keys.payments.length > 0 || now.keys.costs.length + now.keys.billings.length + now.keys.payments.length === 0;
  for (const [k, word] of hasKeys ? kinds : []) {
    const was = new Map(before.keys[k].map((x) => [parse(x).id, parse(x)]));
    const is = new Map(now.keys[k].map((x) => [parse(x).id, parse(x)]));
    const href = (x: Key) => (k === "costs" ? `/sites/${x.siteId}?tab=cost` : "/finance");
    const what = (x: Key) => `${site(x.siteId)} ${k === "costs" ? (CATEGORY_LABEL[x.category as keyof typeof CATEGORY_LABEL] ?? "원가") : word} ${fmtMan(x.amount)} (${md(x.date)}${k !== "costs" && x.date < from ? " · 월말 미수에 영향" : ""})`;
    const at = (id: string) => {
      if (k !== "costs") return undefined;
      const e = db.costEntries.find((c) => c.id === id);
      return e ? [e.createdAt, e.reviewedAt, e.editedAt, e.voidedAt].filter((t): t is string => !!t && t > since).sort().at(-1) : undefined;
    };
    // 기성이 계약(승인 변경 포함)을 넘으면 같이 알린다 (D-82 대표 점검 — 판교 104%)
    const over = (x: Key) => {
      if (k !== "billings") return "";
      const f = siteFinancials(db, x.siteId);
      const billed = db.billings.filter((b) => b.siteId === x.siteId && b.status === "confirmed").reduce((a, b) => a + b.amount, 0);
      return f.adjustedContract > 0 && billed > f.adjustedContract ? ` · 누계 기성 ${Math.round((billed / f.adjustedContract) * 1000) / 10}% (계약 초과 ${fmtMan(billed - f.adjustedContract)} · 승인 변경공사 포함 계약 기준)` : "";
    };
    for (const [id, x] of is) {
      const y = was.get(id);
      // 마감 뒤 들어왔다가 취소·반려된 것은 숫자에 영향이 없다 (가져오기 취소 등 · D-82 점검)
      if (!y && (x.status === "voided" || x.status === "rejected")) continue;
      if (!y) events.push({ at: at(id), siteId: x.siteId, text: `${word} 들어옴 · ${what(x)}${x.status !== "active" && x.status !== "confirmed" && x.status !== "received" ? ` · ${STATUS[x.status] ?? x.status}` : ""}${over(x)}`, href: href(x) });
      else if (y.status !== x.status || y.amount !== x.amount || y.category !== x.category || y.date !== x.date)
        events.push({
          at: at(id),
          siteId: x.siteId,
          text: `${word} 바뀜 · ${what(x)} — ${[y.amount !== x.amount ? `${fmtMan(y.amount)} → ${fmtMan(x.amount)}` : "", y.status !== x.status ? `${STATUS[y.status] ?? y.status} → ${STATUS[x.status] ?? x.status}` : "", y.category !== x.category && k === "costs" ? `${CATEGORY_LABEL[y.category as keyof typeof CATEGORY_LABEL]} → ${CATEGORY_LABEL[x.category as keyof typeof CATEGORY_LABEL]}` : "", y.date !== x.date ? `발생일 ${md(y.date)} → ${md(x.date)}` : ""].filter(Boolean).join(" · ")}${over(x)}`,
          href: href(x),
        });
    }
    for (const [id, y] of was)
      if (!is.has(id)) {
        // 다른 달로 옮긴 원가 (발생일 고침)
        const moved = k === "costs" ? db.costEntries.find((c) => c.id === id) : undefined;
        events.push({ at: moved ? at(id) : undefined, siteId: y.siteId, text: moved ? `원가 다른 달로 옮김 · ${what(y)} → ${md(moved.date)}` : `${word} 빠짐 · ${what(y)} (가져오기 취소 등)`, href: href(y) });
      }
  }
  // 출력 추정이 바뀌었으면 (늦게 들어온 작업 인원·팀 단가 변경)
  for (const d of diffs.filter((x) => x.label === "출력 기준 노무 추정")) events.push({ siteId: d.siteId, text: `출력 기준 노무 추정 바뀜 · ${d.name} ${fmtMan(d.before)} → ${fmtMan(d.after)} (늦게 들어온 작업 인원·팀 단가)`, href: `/labor?month=${month}` });
  // 원가·기성·입금 이벤트로 설명되지 않는 숫자 변화도 센다 (팀 붙이기로 입력 노무비가 바뀐 경우 등 · D-82 점검 M2)
  const explained = new Set(events.map((e) => e.siteId));
  for (const d of diffs) if (d.label !== "출력 기준 노무 추정" && !explained.has(d.siteId)) events.push({ siteId: d.siteId, text: `숫자 바뀜 · ${d.name} ${d.label} ${fmtMan(d.before)} → ${fmtMan(d.after)}${d.label === "입력된 노무비" ? " (팀 붙이기·외주비 팀 바뀜)" : ""}`, href: d.label === "입력된 노무비" ? `/labor?month=${month}` : `/close?month=${month}` });
  const people = now.people
    .map((p) => ({ userId: p.userId, name: p.name, before: before.people.find((x) => x.userId === p.userId)?.minutes ?? 0, after: p.minutes }))
    .concat(before.people.filter((x) => !now.people.some((p) => p.userId === x.userId)).map((x) => ({ userId: x.userId, name: x.name, before: x.minutes, after: 0 })))
    .filter((p) => p.before !== p.after);
  events.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return { diffs, events, people, count: events.length + people.length, basis: "close" };
}

/** 바뀐 것을 한 줄씩 (대표 확인 이력에 남김) */
export const changeLines = (ch: ChangesAfterClose): string[] => [...ch.events.map((e) => e.text), ...ch.people.map((p) => `출퇴근 시간 바뀜 · ${p.name} ${minutesText(p.before)} → ${minutesText(p.after)}`)];

export interface CloseState {
  month: string;
  state: "open" | "closed" | "confirmed";
  changes: number;
}

/**
 * 대시보드 처리 대기·아침 알림용 — 끝난 최근 3개월의 마감 상태 (지난달만 보면 12월에 10월이 사라지던 문제 · D-82 점검).
 * 그 달에 일한 현장이 없으면(새 회사) 마감할 것이 없다 — 월 마감 화면과 같은 기준(closeSites).
 */
export function closeStatuses(db: DemoDB, today: string, back = 3): CloseState[] {
  const out: CloseState[] = [];
  // 앱을 쓰기 전 달은 마감하라고 하지 않는다 (첫 운영 달부터 · 지난 자료 가져오기·시작 전 원가는 빼고)
  const used = [
    ...db.reports.filter((r) => !r.importBatchId).map((r) => r.createdAt),
    ...db.costEntries.filter((e) => e.source !== "SEED" && !e.importBatchId).map((e) => e.createdAt),
    ...(db.attendance ?? []).map((a) => a.inAt),
  ]
    .filter(Boolean)
    .sort()[0];
  const startedOn = used ? used.slice(0, 10) : today;
  let month = previousMonth(today);
  for (let i = 0; i < back; i++, month = previousMonth(`${month}-01`)) {
    const { from, to } = monthBounds(month);
    const rec = currentClose(db, month);
    if (!rec) {
      if (to >= startedOn && closeSites(db, from, to).length) out.push({ month, state: "open", changes: 0 });
      continue;
    }
    out.push({ month, state: rec.confirmedAt ? "confirmed" : "closed", changes: changesAfterClose(db, rec, today).count });
  }
  return out;
}

/** 지난달 상태 (앞 버전과 같은 모양) */
export function closeStatus(db: DemoDB, today: string): CloseState | null {
  return closeStatuses(db, today, 1)[0] ?? null;
}

/** 그 날짜가 마감한 달이면 그 마감 (원가 승인·고치기 때 알리기) */
export function closedMonthOf(db: Pick<DemoDB, "monthCloses">, date: string | undefined): MonthCloseRecord | undefined {
  return date ? currentClose(db, date.slice(0, 7)) : undefined;
}

export const minutesText = (m: number) => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
