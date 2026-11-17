/**
 * 숫자 맞추기 점검 (D-85) — 같은 기준의 돈 숫자가 화면마다 같은지, 장부에 이상한 줄이 없는지 데이터로 확인한다.
 *
 * err (화면끼리 숫자가 다름 — 생기면 안 되는 일):
 *  - 월 마감(달별)을 모두 더한 기성·입금·원가 = 현장 누계(대시보드·현장 상세·기성·수금) · 이번 달 월말 미수 = 지금 미수
 *  - 대표 보고서·월 마감 ‘이익을 바꾼 일’의 합 = 기준(현장 등록) 대비 지금 예상이익 변화
 *  - 대시보드 합계 = 현장별 합 · 승인 변경공사 합 = 계약 반영 변경 · 한 원가를 두 변경공사로 청구하지 않음
 * warn (장부에 있을 수 있지만 사람이 확인할 줄):
 *  - 같은 현장·같은 날·같은 항목·같은 금액 원가 2건 이상(중복 입력 의심) · 같은 날 같은 금액 기성·입금 2건 이상
 *  - 입금 누계가 확정 기성보다 많음 · 누계 기성이 계약(승인 변경 포함)보다 많음
 *  - 날짜가 오늘 이후이거나 원가 발생일이 착공 전
 *
 * 금액은 화면에 그대로 쓰는 계산 함수(siteFinancials·portfolioTotals·monthClose·profitEvents)를 불러 비교한다 — 따로 셈하지 않는다.
 */
import type { DemoDB } from "./types";
import { portfolioTotals, siteFinancials } from "./calc";
import { monthClose, monthCostRows, previousMonth, profitEvents } from "./monthClose";
import { monthWorkbook } from "./monthWorkbook";
import { coByEntry } from "./changeOrders";
import { CATEGORY_LABEL } from "./labels";
import { fmtMan } from "./format";

export interface IntegrityCheck {
  key: string;
  level: "ok" | "warn" | "err";
  title: string;
  detail?: string;
  href?: string;
  siteId?: string;
}

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 돈·원가 기록이 있는 가장 이른 달부터 이번 달까지 (월 마감을 모두 더하는 범위) */
export function moneyMonths(db: DemoDB, today: string): string[] {
  const dates = [
    ...db.costEntries.filter((e) => e.status === "active").map((e) => e.date),
    ...db.costEntries.filter((e) => e.status === "active").map((e) => kst(e.reviewedAt && e.reviewedAt > e.createdAt ? e.reviewedAt : e.createdAt)),
    ...db.billings.filter((b) => b.status === "confirmed").map((b) => b.billedDate),
    ...db.payments.map((p) => p.receivedDate),
    ...db.changeOrders.filter((c) => c.decidedAt).map((c) => kst(c.decidedAt!)),
    ...(db.forecastChanges ?? []).map((c) => kst(c.at)),
  ].filter((d) => d && d <= today);
  const first = (dates.sort()[0] ?? today).slice(0, 7);
  const out: string[] = [];
  for (let m = today.slice(0, 7); m >= first; m = previousMonth(`${m}-01`)) out.push(m);
  return out.reverse();
}

export function moneyIntegrity(db: DemoDB, today: string): IntegrityCheck[] {
  const out: IntegrityCheck[] = [];
  const months = moneyMonths(db, today);
  const reports = months.map((m) => monthClose(db, m, today));
  const thisMonth = reports[reports.length - 1];

  // ── err: 월 마감 합 = 현장 누계 ──
  const bad: string[] = [];
  for (const site of db.sites) {
    const f = siteFinancials(db, site.id);
    const sum = { billed: 0, received: 0, cost: 0 };
    for (const r of reports)
      for (const m of r.money.filter((x) => x.site.id === site.id)) {
        sum.billed += m.billed;
        sum.received += m.received;
        sum.cost += m.costTotal;
      }
    const diffs = [
      sum.billed !== f.billed ? `기성 달별 합 ${fmtMan(sum.billed)} · 누계 ${fmtMan(f.billed)}` : "",
      sum.received !== f.received ? `입금 달별 합 ${fmtMan(sum.received)} · 누계 ${fmtMan(f.received)}` : "",
      sum.cost !== f.incurred ? `원가 달별 합 ${fmtMan(sum.cost)} · 발생원가 ${fmtMan(f.incurred)}` : "",
    ].filter(Boolean);
    const now = thisMonth?.money.find((x) => x.site.id === site.id);
    if (now && now.outstandingAtEnd !== f.outstanding) diffs.push(`이번 달 월말 미수 ${fmtMan(now.outstandingAtEnd)} · 지금 미수 ${fmtMan(f.outstanding)}`);
    if (diffs.length) bad.push(`${site.shortName}: ${diffs.join(" / ")}`);
  }
  out.push(
    bad.length
      ? { key: "month-sum", level: "err", title: "월 마감을 모두 더한 숫자가 현장 누계와 다릅니다", detail: bad.join(" · "), href: "/close" }
      : { key: "month-sum", level: "ok", title: `월 마감 ${months.length}개월을 더한 기성·입금·원가·미수 = 현장 누계` },
  );

  // ── err: 이달 원가 CSV(엑셀)의 ‘확정’ 줄 합 = 그 달 월 마감 원가 ──
  const csvBad: string[] = [];
  months.forEach((m, i) => {
    const rows = monthCostRows(db, m, today);
    const head = rows[0] as string[];
    const amt = head.indexOf("금액(원)");
    const st = head.indexOf("상태");
    const csv = rows.slice(1).filter((r) => r[st] === "확정").reduce((a, r) => a + Number(r[amt]), 0);
    const screen = reports[i].money.reduce((a, x) => a + x.costTotal, 0);
    if (csv !== screen) csvBad.push(`${m}: CSV ${fmtMan(csv)} · 월 마감 ${fmtMan(screen)}`);
  });
  out.push(
    csvBad.length
      ? { key: "csv", level: "err", title: "이달 원가 CSV 합이 월 마감 원가와 다릅니다", detail: csvBad.join(" · "), href: "/close" }
      : { key: "csv", level: "ok", title: "이달 원가 CSV(확정 줄) 합 = 월 마감 원가 (모든 달)" },
  );

  // ── err: 월 마감 엑셀(세무·회계용)의 합계 = 월 마감 화면 (D-87) — 시트에 적힌 숫자를 다시 읽어 맞춘다 ──
  const xlsxBad: string[] = [];
  months.forEach((m, i) => {
    const w = monthWorkbook(db, m, today, { report: reports[i] });
    for (const c of w.checks.filter((x) => !x.ok)) xlsxBad.push(`${m} ${c.label}: 엑셀 ${fmtMan(c.sheet)} · 화면 ${fmtMan(c.screen)}`);
  });
  out.push(
    xlsxBad.length
      ? { key: "xlsx", level: "err", title: "월 마감 엑셀 합계가 화면과 다릅니다", detail: xlsxBad.slice(0, 6).join(" · "), href: "/close" }
      : { key: "xlsx", level: "ok", title: "월 마감 엑셀(기성·입금·미수·원가·변경공사·이익 변화) 합계 = 월 마감 화면 (모든 달)" },
  );

  // ── err: 이익을 바꾼 일 합 = 기준 대비 예상이익 변화 ──
  const unexplained: string[] = [];
  for (const site of db.sites) {
    const base = db.baseline[site.id];
    if (!base) continue;
    const from = kst(site.baselineAt ?? db.seededAt ?? "2000-01-01T00:00:00Z");
    const ev = profitEvents(db, site.id, from, today).reduce((a, e) => a + e.amount, 0);
    const actual = siteFinancials(db, site.id).expectedProfit - base.expectedProfit;
    if (ev !== actual) unexplained.push(`${site.shortName}: 이익을 바꾼 일 합 ${fmtMan(ev)} · 기준 대비 실제 ${fmtMan(actual)} (차이 ${fmtMan(actual - ev)})`);
  }
  out.push(
    unexplained.length
      ? { key: "profit-events", level: "err", title: "‘이익을 바꾼 일’을 더해도 예상이익 변화와 맞지 않습니다", detail: unexplained.join(" · "), href: "/report" }
      : { key: "profit-events", level: "ok", title: "‘이익을 바꾼 일’ 합 = 현장 등록 기준 대비 예상이익 변화 (모든 현장)" },
  );

  // ── err: 대시보드 합계 = 현장 합 · 변경공사 ──
  const t = portfolioTotals(db);
  const fs = db.sites.map((s) => siteFinancials(db, s.id));
  const sumOf = (k: "adjustedContract" | "eac" | "expectedProfit" | "billed" | "received" | "outstanding") => fs.reduce((a, f) => a + f[k], 0);
  const tDiff = (["adjustedContract", "eac", "expectedProfit"] as const).filter((k) => (t as unknown as Record<string, number>)[k] !== undefined && (t as unknown as Record<string, number>)[k] !== sumOf(k));
  out.push(
    tDiff.length
      ? { key: "portfolio", level: "err", title: "대시보드 합계가 현장별 합과 다릅니다", detail: tDiff.join(", "), href: "/dashboard" }
      : { key: "portfolio", level: "ok", title: "대시보드 합계(계약·예상 총원가·예상이익) = 현장별 합" },
  );
  const doubled = new Map<string, string[]>();
  for (const c of db.changeOrders) if (c.status !== "rejected") for (const id of c.sourceEntryIds) doubled.set(id, [...(doubled.get(id) ?? []), c.title]);
  const dup = [...doubled.entries()].filter(([, v]) => v.length > 1);
  const claimMap = coByEntry(db);
  out.push(
    dup.length
      ? { key: "co-double", level: "err", title: `한 원가를 변경공사 두 건 이상으로 청구 ${dup.length}건`, detail: dup.slice(0, 5).map(([, v]) => v.join(" · ")).join(" / "), href: "/finance#co-board" }
      : { key: "co-double", level: "ok", title: `변경공사 근거 원가 ${claimMap.size}건 — 두 번 청구 없음` },
  );

  // ── warn: 중복 입력 의심 ──
  const group = <T,>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return [...m.values()].filter((g) => g.length > 1);
  };
  const site = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";
  const costDup = group(
    db.costEntries.filter((e) => (e.status === "active" || e.status === "pending") && e.source !== "SEED" && !e.settle),
    (e) => `${e.siteId}|${e.date}|${e.category}|${e.amount}`,
  );
  out.push(
    costDup.length
      ? {
          key: "cost-dup",
          level: "warn",
          title: `같은 날·같은 항목·같은 금액 원가 ${costDup.length}묶음 — 두 번 넣었는지 확인`,
          detail: costDup
            .slice(0, 6)
            .map((g) => `${site(g[0].siteId)} ${md(g[0].date)} ${CATEGORY_LABEL[g[0].category]} ${fmtMan(g[0].amount)} × ${g.length}`)
            .join(" · "),
          href: "/admin?tab=review",
        }
      : { key: "cost-dup", level: "ok", title: "같은 날·같은 항목·같은 금액 원가 중복 없음" },
  );
  const billDup = group(db.billings.filter((b) => b.status === "confirmed"), (b) => `${b.siteId}|${b.billedDate}|${b.amount}`);
  const payDup = group(db.payments, (p) => `${p.siteId}|${p.receivedDate}|${p.amount}`);
  out.push(
    billDup.length + payDup.length
      ? {
          key: "money-dup",
          level: "warn",
          title: `같은 날 같은 금액 기성 ${billDup.length}묶음 · 입금 ${payDup.length}묶음 — 두 번 넣었는지 확인`,
          detail: [...billDup.map((g) => `${site(g[0].siteId)} 기성 ${md(g[0].billedDate)} ${fmtMan(g[0].amount)} × ${g.length}`), ...payDup.map((g) => `${site(g[0].siteId)} 입금 ${md(g[0].receivedDate)} ${fmtMan(g[0].amount)} × ${g.length}`)].slice(0, 6).join(" · "),
          href: "/finance",
        }
      : { key: "money-dup", level: "ok", title: "같은 날 같은 금액 기성·입금 중복 없음" },
  );

  // ── warn: 금액 관계 ──
  const over = fs.filter((f) => f.received > f.billed).map((f) => `${site(f.siteId)} 입금 ${fmtMan(f.received)} > 기성 ${fmtMan(f.billed)}`);
  const overContract = fs.filter((f) => f.adjustedContract > 0 && f.billed > f.adjustedContract).map((f) => `${site(f.siteId)} 기성 ${fmtMan(f.billed)} > 계약 ${fmtMan(f.adjustedContract)}`);
  out.push(
    over.length + overContract.length
      ? { key: "money-over", level: "warn", title: "입금이 기성보다 많거나 기성이 계약보다 많은 현장", detail: [...over, ...overContract].join(" · "), href: "/finance" }
      : { key: "money-over", level: "ok", title: "입금 ≤ 기성 ≤ 계약(승인 변경 포함)" },
  );

  // ── warn: 날짜 ──
  const future = [
    ...db.costEntries.filter((e) => e.status !== "voided" && e.date > today).map((e) => `${site(e.siteId)} 원가 ${md(e.date)}`),
    ...db.billings.filter((b) => b.billedDate > today).map((b) => `${site(b.siteId)} 기성 ${md(b.billedDate)}`),
    ...db.payments.filter((p) => p.receivedDate > today).map((p) => `${site(p.siteId)} 입금 ${md(p.receivedDate)}`),
  ];
  const beforeStart = db.costEntries
    .filter((e) => (e.status === "active" || e.status === "pending") && e.source !== "SEED")
    .filter((e) => {
      const s = db.sites.find((x) => x.id === e.siteId);
      return !!s && e.date < s.startDate;
    })
    .map((e) => `${site(e.siteId)} ${md(e.date)} ${fmtMan(e.amount)}`);
  out.push(
    future.length + beforeStart.length
      ? { key: "dates", level: "warn", title: `오늘 이후 날짜 ${future.length}건 · 착공 전 발생일 원가 ${beforeStart.length}건`, detail: [...future, ...beforeStart.map((x) => `착공 전 ${x}`)].slice(0, 8).join(" · "), href: "/data" }
      : { key: "dates", level: "ok", title: "날짜 이상 없음 (오늘 이후 · 착공 전 원가 없음)" },
  );
  return out;
}
