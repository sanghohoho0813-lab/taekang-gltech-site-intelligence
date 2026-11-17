/**
 * 월 마감 엑셀 (D-87) — 세무사·회계 담당에게 넘기는 한 달 자료.
 * 시트: 안내 · 현장별 요약 · 기성 · 입금 · 월말 미수 · 원가 · 변경공사 · 노무 · 이익을 바꾼 일.
 *
 * 숫자는 화면 ‘월 마감’과 같은 계산(monthClose)에서만 가져온다. 만든 뒤 시트에 적힌 숫자를 다시 읽어 더해
 * 월 마감 합계와 같은지 맞춰 보고(checks), 그 결과를 ‘안내’ 시트에 적는다 — 숫자 맞추기 점검(빨강)에도 같은 대조가 들어간다.
 */
import type { DemoDB } from "@/lib/domain/types";
import { monthBounds, monthClose, monthCostRows, type MonthCloseReport } from "@/lib/domain/monthClose";
import { currentClose, changesAfterClose } from "@/lib/domain/closeRecord";
import { siteFinancials } from "@/lib/domain/calc";
import { CO_STATUS_LABEL } from "@/lib/domain/labels";
import { APPROVAL_BASIS_LABEL } from "@/lib/domain/changeOrders";
import { fmtDateTime, todayIso } from "@/lib/domain/format";
import type { SheetSpec } from "@/lib/domain/xlsx";

const SITE_STATUS: Record<string, string> = { active: "진행", completed: "준공", hold: "보류" };
const kst = (iso: string) => todayIso(new Date(iso));
const n = (v: number) => String(Math.round(v));

export interface WorkbookCheck {
  label: string;
  /** 엑셀에 적힌 숫자 */
  sheet: number;
  /** 화면(월 마감) 숫자 */
  screen: number;
  ok: boolean;
}

export interface MonthWorkbook {
  sheets: SheetSpec[];
  checks: WorkbookCheck[];
  ok: boolean;
  filename: string;
}

/** 시트의 한 열(머리글 다음 ~ 합계 줄 전) 숫자 합 */
const colSum = (rows: string[][], col: number, until = rows.length) => rows.slice(1, until).reduce((a, r) => a + (Number(r[col]) || 0), 0);

export function monthWorkbook(db: DemoDB, month: string, today = todayIso(), opts: { by?: string; now?: Date; report?: MonthCloseReport } = {}): MonthWorkbook {
  const r = opts.report ?? monthClose(db, month, today);
  const b = monthBounds(month);
  const from = r.from;
  const to = r.to;
  const siteIds = new Set(r.money.map((m) => m.site.id));
  const siteName = (id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";
  // 발주처(거래처) — 세무·회계는 거래처별로 맞춘다
  const clientOf = (id: string) => db.sites.find((s) => s.id === id)?.clientName ?? "";
  const userName = (id?: string) => (id ? (db.users.find((u) => u.id === id)?.name ?? "") : "");
  const inMonth = (d: string) => d >= from && d <= to;
  const lateMark = (createdAt?: string) => (r.ended && createdAt && kst(createdAt) > b.to ? "달이 끝난 뒤 넣음" : "");

  // ── 현장별 요약 ──
  const sumHead = ["현장", "현장 상태", "원 계약금액", "승인 변경공사 누계", "계약금액(변경 포함)", "이달 기성", "이달 입금", "월말 미수", "이달 원가(확정)", "공무 확인 대기 원가", "이달 승인 변경공사", "지금 예상이익", "이달 예상이익 변화"];
  const sumRows = r.money.map((m) => {
    const f = siteFinancials(db, m.site.id);
    const p = r.profit.find((x) => x.site.id === m.site.id);
    return [m.site.shortName || m.site.name, SITE_STATUS[m.site.status] ?? m.site.status, n(f.contractAmount), n(f.approvedChange), n(f.adjustedContract), n(m.billed), n(m.received), n(m.outstandingAtEnd), n(m.costTotal), n(m.pending.amount), n(m.changeApproved), n(f.expectedProfit), n(p?.net ?? 0)];
  });
  const sumTotal = ["합계", "", ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => n(sumRows.reduce((a, x) => a + Number(x[c]), 0)))];
  const summary: string[][] = [sumHead, ...sumRows, sumTotal];

  // ── 기성 (확정 · 청구일 기준) ──
  const bills = db.billings
    .filter((x) => x.status === "confirmed" && siteIds.has(x.siteId) && inMonth(x.billedDate))
    .sort((a, x) => a.billedDate.localeCompare(x.billedDate) || siteName(a.siteId).localeCompare(siteName(x.siteId)) || a.round - x.round);
  const billRows = bills.map((x) => [x.billedDate, siteName(x.siteId), `${x.round}회`, n(x.amount), clientOf(x.siteId), x.createdAt ? fmtDateTime(x.createdAt) : "", userName(x.createdBy), lateMark(x.createdAt)]);
  const billing: string[][] = [["청구일", "현장", "회차", "금액(원)", "발주처", "넣은 시각", "넣은 사람", "비고"], ...billRows, ["합계", "", "", n(bills.reduce((a, x) => a + x.amount, 0)), "", "", "", ""]];

  // ── 입금 (입금일 기준) ──
  const pays = db.payments.filter((x) => siteIds.has(x.siteId) && inMonth(x.receivedDate)).sort((a, x) => a.receivedDate.localeCompare(x.receivedDate) || siteName(a.siteId).localeCompare(siteName(x.siteId)));
  const roundOf = (id?: string) => {
    const bill = id ? db.billings.find((x) => x.id === id) : undefined;
    return bill ? `${bill.round}회` : "";
  };
  const payRows = pays.map((x) => [x.receivedDate, siteName(x.siteId), roundOf(x.billingId), n(x.amount), clientOf(x.siteId), x.createdAt ? fmtDateTime(x.createdAt) : "", userName(x.createdBy), lateMark(x.createdAt)]);
  const payment: string[][] = [["입금일", "현장", "연결 기성", "금액(원)", "발주처", "넣은 시각", "넣은 사람", "비고"], ...payRows, ["합계", "", "", n(pays.reduce((a, x) => a + x.amount, 0)), "", "", "", ""]];

  // ── 월말 미수 (월말까지 확정 기성 누계 − 월말까지 입금 누계) ──
  const arRows = r.money.map((m) => {
    const billed = db.billings.filter((x) => x.siteId === m.site.id && x.status === "confirmed" && x.billedDate <= to).reduce((a, x) => a + x.amount, 0);
    const recv = db.payments.filter((x) => x.siteId === m.site.id && x.receivedDate <= to).reduce((a, x) => a + x.amount, 0);
    const lastPay = db.payments.filter((x) => x.siteId === m.site.id && x.receivedDate <= to).map((x) => x.receivedDate).sort().pop() ?? "";
    return [m.site.shortName || m.site.name, n(billed), n(recv), n(billed - recv), lastPay, m.site.clientName ?? ""];
  });
  const receivable: string[][] = [["현장", "월말까지 확정 기성 누계", "월말까지 입금 누계", "월말 미수", "마지막 입금일", "발주처"], ...arRows, ["합계", n(colSum([[], ...arRows], 1)), n(colSum([[], ...arRows], 2)), n(colSum([[], ...arRows], 3)), "", ""]];

  // ── 원가 (발생일 기준 · 모든 상태 — 합계는 ‘확정’만) ──
  const costRaw = monthCostRows(db, month, today).map((row) => row.map((v) => (typeof v === "number" ? n(v) : String(v ?? ""))));
  const STATUS_COL = costRaw[0].indexOf("상태");
  const AMOUNT_COL = costRaw[0].indexOf("금액(원)");
  const SITE_COL = costRaw[0].indexOf("현장");
  const siteShorts = new Set(r.money.map((m) => m.site.shortName));
  const confirmedCost = costRaw.slice(1).filter((row) => row[STATUS_COL] === "확정" && siteShorts.has(row[SITE_COL])).reduce((a, row) => a + (Number(row[AMOUNT_COL]) || 0), 0);
  const costTotalRow = costRaw[0].map((_, i) => (i === 0 ? "확정 합계 (상태 ‘확정’ 줄만)" : i === AMOUNT_COL ? n(confirmedCost) : ""));
  const cost: string[][] = [...costRaw, costTotalRow];

  // ── 변경공사 (월말까지 등록 · 이달 결정했거나 월말에 결정 전) ──
  const cos = db.changeOrders
    .filter((c) => {
      if (!siteIds.has(c.siteId)) return false;
      const decided = c.decidedAt ? kst(c.decidedAt) : null;
      // 월말에 아직 결정 전이었던 것 + 이 달에 결정(승인·반려)한 것
      const openAtEnd = kst(c.requestedAt) <= to && (!decided || decided > to);
      return openAtEnd || (!!decided && inMonth(decided));
    })
    .sort((a, x) => siteName(a.siteId).localeCompare(siteName(x.siteId)) || a.requestedAt.localeCompare(x.requestedAt));
  const coRows = cos.map((c) => {
    const decidedIn = !!c.decidedAt && inMonth(kst(c.decidedAt));
    const approvedHere = c.status === "approved" && decidedIn ? (c.approvedAmount ?? c.amount) : null;
    return [
      siteName(c.siteId),
      c.title,
      n(c.amount),
      c.status === "approved" ? n(c.approvedAmount ?? c.amount) : "",
      CO_STATUS_LABEL[c.status],
      kst(c.requestedAt),
      c.submittedAt ? kst(c.submittedAt) : "",
      c.decidedAt ? kst(c.decidedAt) : "",
      c.approvalBasis ? APPROVAL_BASIS_LABEL[c.approvalBasis] : "",
      [c.decisionNote, c.note].filter(Boolean).join(" · "),
      approvedHere === null ? "" : n(approvedHere),
    ];
  });
  const change: string[][] = [["현장", "제목", "청구 금액", "승인 금액", "상태", "등록일", "발주처 청구일", "결정일", "승인 근거", "사유·메모", "이달 승인 금액"], ...coRows, ["합계 (이달 승인)", "", "", "", "", "", "", "", "", "", n(coRows.reduce((a, x) => a + (Number(x[10]) || 0), 0))]];

  // ── 노무 (출퇴근·출력 기준 추정 vs 입력 · 정산) ──
  const laborRows = r.labor.map((l) => [
    l.site.shortName || l.site.name,
    n(l.estimate),
    n(l.compared),
    n(Math.max(0, l.estimate - l.compared)),
    l.settled ? "정산함" : l.canSettle ? "정산 전 (모자람)" : "",
    l.settled ? n(l.settled.amount) : "",
    l.settled ? l.settled.date : "",
    l.settled ? userName(l.settled.createdBy) : "",
  ]);
  const labor: string[][] = [["현장", "근무 기록 기준 추정 인건비", "입력된 노무비(비교 대상)", "모자람", "노무 정산", "정산 금액", "정산 발생일", "정산한 사람"], ...laborRows];

  // ── 이익을 바꾼 일 ──
  const evRows = r.profit.flatMap((p) => p.events.map((e) => [e.date, p.site.shortName || p.site.name, n(e.amount), e.text]));
  const events: string[][] = [["날짜", "현장", "예상이익에 미친 금액(원)", "내용"], ...evRows, ["합계", "", n(evRows.reduce((a, x) => a + Number(x[2]), 0)), ""]];

  // ── 대조 — 엑셀에 적힌 숫자를 다시 읽어 화면 숫자와 ──
  const last = (rows: string[][], col: number) => Number(rows[rows.length - 1][col]) || 0;
  const checks: WorkbookCheck[] = [
    { label: "이달 기성 (요약 합계)", sheet: last(summary, 5), screen: r.totals.billed },
    { label: "이달 기성 (기성 시트)", sheet: colSum(billing, 3, billing.length - 1), screen: r.totals.billed },
    { label: "이달 입금 (요약 합계)", sheet: last(summary, 6), screen: r.totals.received },
    { label: "이달 입금 (입금 시트)", sheet: colSum(payment, 3, payment.length - 1), screen: r.totals.received },
    { label: "월말 미수 (요약 합계)", sheet: last(summary, 7), screen: r.totals.outstandingAtEnd },
    { label: "월말 미수 (미수 시트)", sheet: last(receivable, 3), screen: r.totals.outstandingAtEnd },
    { label: "이달 원가 (요약 합계)", sheet: last(summary, 8), screen: r.totals.costTotal },
    { label: "이달 원가 (원가 시트 ‘확정’ 줄)", sheet: confirmedCost, screen: r.totals.costTotal },
    { label: "공무 확인 대기 원가", sheet: last(summary, 9), screen: r.totals.pending },
    { label: "이달 승인 변경공사 (요약 합계)", sheet: last(summary, 10), screen: r.totals.changeApproved },
    { label: "이달 승인 변경공사 (변경공사 시트)", sheet: last(change, 10), screen: r.totals.changeApproved },
    { label: "이익을 바꾼 일 합 (요약 합계)", sheet: last(summary, 12), screen: r.profit.reduce((a, p) => a + p.net, 0) },
    { label: "이익을 바꾼 일 합 (시트)", sheet: last(events, 2), screen: r.profit.reduce((a, p) => a + p.net, 0) },
  ].map((c) => ({ ...c, ok: Math.round(c.sheet) === Math.round(c.screen) }));
  const ok = checks.every((c) => c.ok);

  // ── 안내 ──
  const rec = currentClose(db, month);
  const changed = rec ? changesAfterClose(db, rec, today).count : 0;
  const closeText = rec
    ? [`공무 마감 ${fmtDateTime(rec.closedAt)} ${userName(rec.closedBy)}`, rec.confirmedAt ? `대표 확인 ${fmtDateTime(rec.confirmedAt)} ${userName(rec.confirmedBy)}` : "대표 확인 전", changed ? `마감 뒤 바뀐 것 ${changed}건 — 이 파일은 지금 숫자` : "마감 뒤 바뀐 것 없음"].join(" · ")
    : r.ended
      ? "마감 전 — 숫자가 바뀔 수 있습니다"
      : "진행 중인 달 — 오늘까지의 숫자";
  const now = opts.now ?? new Date();
  const info: string[][] = [
    ["항목", "내용"],
    ["자료", "태강 현장관리 — 월 마감 자료 (세무·회계 전달용)"],
    ["회사", db.company.name],
    ["대상 월", `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 (${from} ~ ${b.to})${r.ended ? "" : ` · 진행 중 — ${to}까지`}`],
    ["만든 시각", `${fmtDateTime(now.toISOString())}${opts.by ? ` · ${userName(opts.by)}` : ""}`],
    ["마감 상태", closeText],
    ["숫자 대조", ok ? `이 파일의 합계 ${checks.length}개를 프로그램이 ‘월 마감’ 화면 숫자와 맞춰 봤습니다 — 모두 같음` : `화면과 다른 숫자 ${checks.filter((c) => !c.ok).length}개 — 개발 담당에게 알려 주세요: ${checks.filter((c) => !c.ok).map((c) => c.label).join(", ")}`],
    ...(r.late.n ? [["달이 끝난 뒤 들어온 원가", `이 달 날짜 원가 ${r.late.n}건 ${n(r.late.amount)}원 — 마감 뒤 들어와 인쇄해 둔 마감본과 다를 수 있음`]] : []),
    ...(r.lateMoney.n ? [["달이 끝난 뒤 넣은 기성·입금", `${r.lateMoney.n}건 (기성 ${n(r.lateMoney.billed)}원 · 입금 ${n(r.lateMoney.received)}원)`]] : []),
    ["", ""],
    ["기준", "기성은 확정 기성의 청구일 · 입금은 입금일 · 원가는 발생일 기준이고 합계는 공무 확인이 끝난 ‘확정’만 셉니다(대기·반려·취소 줄은 원가 시트에 보이기만)."],
    ["", "월말 미수 = 월말까지 확정 기성 누계 − 월말까지 입금 누계. 변경공사는 승인 전에는 계약·이익에 들어가지 않습니다."],
    ["", "금액은 입력한 그대로입니다(부가세 포함 여부는 회사가 넣는 기준을 따릅니다). 세금계산서·장부의 숫자와 다르면 화면 ‘월 마감’에서 그 줄을 찾아 고친 뒤 다시 받으세요."],
    ["", ""],
    ["시트", "현장별 요약 · 기성 · 입금 · 월말 미수 · 원가 · 변경공사 · 노무 · 이익을 바꾼 일"],
  ];

  const sheets: SheetSpec[] = [
    { name: "안내", rows: info, widths: [22, 100], header: true, wrap: true, typed: false },
    { name: "현장별 요약", rows: summary, widths: [16, 9, 15, 15, 15, 14, 14, 14, 15, 15, 15, 15, 15], header: true },
    { name: "기성", rows: billing, widths: [12, 16, 7, 15, 20, 17, 10, 18], header: true },
    { name: "입금", rows: payment, widths: [12, 16, 9, 15, 20, 17, 10, 18], header: true },
    { name: "월말 미수", rows: receivable, widths: [16, 20, 20, 15, 13, 20], header: true },
    { name: "원가", rows: cost, widths: [26, 17, 14, 10, 10, 14, 12, 12, 30, 16, 10, 12, 20, 14, 24], header: true },
    { name: "변경공사", rows: change, widths: [16, 26, 14, 14, 10, 12, 13, 12, 14, 30, 14], header: true },
    { name: "노무", rows: labor, widths: [16, 20, 20, 14, 16, 14, 12, 12], header: true },
    { name: "이익을 바꾼 일", rows: events, widths: [12, 16, 18, 60], header: true },
  ];
  return { sheets, checks, ok, filename: `월마감_${month}_${(db.company.name || "회사").replace(/[^\w가-힣]/g, "")}.xlsx` };
}

import { it as __it } from "vitest";
__it("helper", () => {});
