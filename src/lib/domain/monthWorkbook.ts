/**
 * 월 마감 엑셀 (D-87) — 세무사·회계 담당에게 넘기는 한 달 자료.
 * 시트: 안내 · 현장별 요약 · 기성 · 입금 · 월말 미수 · 원가 · 변경공사 · 노무 · 이익을 바꾼 일.
 *
 * 숫자는 화면 ‘월 마감’과 같은 계산(monthClose)에서만 가져온다. 만든 뒤 시트에 적힌 숫자를 다시 읽어 더해
 * 월 마감 합계와 같은지 맞춰 보고(checks), 그 결과를 ‘안내’ 시트에 적는다 — 숫자 맞추기 점검(빨강)에도 같은 대조가 들어간다.
 */
import type { DemoDB } from "./types";
import { monthBounds, monthClose, monthCostRows, profitEvents, type MonthCloseReport } from "./monthClose";
import { currentClose, changesAfterClose } from "./closeRecord";
import { siteFinancials } from "./calc";
import { CATEGORY_LABEL, CO_STATUS_LABEL } from "./labels";
import { approvalBasisText, coEvidenceOf } from "./changeOrders";
import { activeAdjustments, adjustmentLabel, deductedTotal } from "./receivables";
import { fmtDateTime, todayIso } from "./format";
import type { SheetSpec } from "./xlsx";

const EVIDENCE_SHORT: Record<string, string> = { contract: "변경계약서", letter: "공문·메일", estimate: "견적·내역서", other: "기타" };

const SITE_STATUS: Record<string, string> = { active: "진행", completed: "준공", hold: "보류" };
const kst = (iso: string) => todayIso(new Date(iso));
const n = (v: number) => String(Math.round(v));
/** 부가세 10% (원 단위 반올림) — 계산값. 실제 세금계산서·통장과 맞춰 보는 참고 */
const vat = (v: number) => Math.round(v / 10);
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
// 한 번만 만든다 — 줄마다 새로 만들면 1년치에서 느려진다 (D-85 · D-87 점검)
const HM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const isoMinute = (iso: string) => {
  const d = new Date(iso);
  return `${todayIso(d)} ${HM.format(d)}`;
};

export interface WorkbookCheck {
  label: string;
  /** 엑셀에 적힌 숫자 */
  sheet: number;
  /** 화면(월 마감) 숫자 */
  screen: number;
  ok: boolean;
}

/** 화면(월 마감) 숫자 — 내려받은 파일을 다시 읽어 맞출 때 쓴다 */
export interface WorkbookExpect {
  billed: number;
  received: number;
  outstanding: number;
  cost: number;
  pending: number;
  changeApproved: number;
  profitNet: number;
  /** 이달 발주처 공제 (D-89) */
  deducted: number;
}

export interface MonthWorkbook {
  expect: WorkbookExpect;
  /** 진행중 · 마감전 · 대표확인전 · 확인뒤변경 · 대표확인 — 파일 이름·안내에 */
  stage: "진행중" | "마감전" | "대표확인전" | "확인뒤변경" | "대표확인";
  sheets: SheetSpec[];
  checks: WorkbookCheck[];
  ok: boolean;
  filename: string;
}

/** 시트의 한 열(머리글 다음 ~ 합계 줄 전) 숫자 합 */
const colSum = (rows: string[][], col: number, until = rows.length) => rows.slice(1, until).reduce((a, r) => a + (Number(r[col]) || 0), 0);

export function monthWorkbook(db: DemoDB, month: string, today = todayIso(), opts: { by?: string; now?: Date; report?: MonthCloseReport; light?: boolean } = {}): MonthWorkbook {
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
  // 이 파일 숫자가 언제 기준인지 — 끝난 달은 월말, 진행 중인 달은 오늘 (점검 반영: 진행 중인 달 머리글이 ‘월말’이던 문제)
  const asOf = r.ended ? "월말" : `오늘(${to.slice(5).replace("-", "/")})`;
  const rec = currentClose(db, month);
  // 숫자 맞추기 점검에서 부를 때(light)는 마감 뒤 바뀐 것을 세지 않는다 — 단계 문구에만 쓰이고 달마다 월 마감을 다시 계산해 느리다 (D-87 점검)
  const changed = rec && !opts.light ? changesAfterClose(db, rec, today).count : 0;
  const stage = !r.ended ? "진행중" : !rec ? "마감전" : !rec.confirmedAt ? "대표확인전" : changed ? "확인뒤변경" : "대표확인";

  // ── 현장별 요약 — 계약·변경공사·예상이익은 그 달 말 기준 (대표 보고서 달별 보기와 같은 계산 · 점검 반영: 오늘 숫자가 지난달 파일에 들어가던 문제) ──
  const sumHead = ["현장", "현장 상태", "원 계약금액", `승인 변경공사 누계(${asOf})`, `계약금액(변경 포함·${asOf})`, "이달 기성", "이달 입금", `${asOf} 미수`, "이달 원가(확정)", "공무 확인 대기 원가", "이달 승인 변경공사", `${asOf} 예상이익`, "이달 예상이익 변화", "지금 예상이익(참고)"];
  const coApprovedBy = (siteId: string, day: string) =>
    db.changeOrders.filter((c) => c.siteId === siteId && c.status === "approved" && c.decidedAt && kst(c.decidedAt) <= day).reduce((a, c) => a + (c.approvedAmount ?? c.amount), 0);
  const sumRows = r.money.map((m) => {
    const f = siteFinancials(db, m.site.id);
    const p = r.profit.find((x) => x.site.id === m.site.id);
    const after = r.ended ? profitEvents(db, m.site.id, nextDay(to), today).reduce((a, e) => a + e.amount, 0) : 0;
    const coEnd = coApprovedBy(m.site.id, to);
    return [m.site.shortName || m.site.name, SITE_STATUS[m.site.status] ?? m.site.status, n(f.contractAmount), n(coEnd), n(f.contractAmount + coEnd), n(m.billed), n(m.received), n(m.outstandingAtEnd), n(m.costTotal), n(m.pending.amount), n(m.changeApproved), n(f.expectedProfit - after), n(p?.net ?? 0), n(f.expectedProfit)];
  });
  const sumTotal = ["합계", "", ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((c) => n(sumRows.reduce((a, x) => a + Number(x[c]), 0)))];
  const summary: string[][] = [sumHead, ...sumRows, sumTotal];

  // ── 기성 (확정 · 청구일 기준) ──
  const bills = db.billings
    .filter((x) => x.status === "confirmed" && siteIds.has(x.siteId) && inMonth(x.billedDate))
    .sort((a, x) => a.billedDate.localeCompare(x.billedDate) || siteName(a.siteId).localeCompare(siteName(x.siteId)) || a.round - x.round);
  const billRows = bills.map((x) => [x.billedDate, siteName(x.siteId), `${x.round}회`, n(x.amount), n(vat(x.amount)), n(x.amount + vat(x.amount)), clientOf(x.siteId), x.createdAt ? isoMinute(x.createdAt) : "", userName(x.createdBy), lateMark(x.createdAt)]);
  const billSum = bills.reduce((a, x) => a + x.amount, 0);
  const billVat = bills.reduce((a, x) => a + vat(x.amount), 0);
  const billing: string[][] = [["청구일", "현장", "회차", "공급가액(원)", "부가세 10%(계산)", "합계(공급대가·계산)", "발주처", "넣은 시각", "넣은 사람", "비고"], ...billRows, ["합계", "", "", n(billSum), n(billVat), n(billSum + billVat), "", "", "", ""]];

  // ── 입금 (입금일 기준) ──
  const pays = db.payments.filter((x) => siteIds.has(x.siteId) && inMonth(x.receivedDate)).sort((a, x) => a.receivedDate.localeCompare(x.receivedDate) || siteName(a.siteId).localeCompare(siteName(x.siteId)));
  const roundOf = (id?: string) => {
    const bill = id ? db.billings.find((x) => x.id === id) : undefined;
    return bill ? `${bill.round}회` : "";
  };
  const payRows = pays.map((x) => [x.receivedDate, siteName(x.siteId), roundOf(x.billingId), n(x.amount), n(x.amount + vat(x.amount)), clientOf(x.siteId), x.createdAt ? isoMinute(x.createdAt) : "", userName(x.createdBy), lateMark(x.createdAt)]);
  const paySum = pays.reduce((a, x) => a + x.amount, 0);
  const payment: string[][] = [["입금일", "현장", "연결 기성", "입금액(부가세 제외 환산)", "부가세 포함 환산(×1.1·계산)", "발주처", "넣은 시각", "넣은 사람", "비고"], ...payRows, ["합계", "", "", n(paySum), n(pays.reduce((a, x) => a + x.amount + vat(x.amount), 0)), "", "", "", ""]];

  // ── 월말 미수 (월말까지 확정 기성 누계 − 월말까지 입금 누계 − 월말까지 발주처 공제 · D-89) ──
  //    열 순서는 그대로(파일 다시 읽기 대조가 4번째 열을 본다) — 공제·유보금은 뒤에 붙인다
  const arRows = r.money.map((m) => {
    const billed = db.billings.filter((x) => x.siteId === m.site.id && x.status === "confirmed" && x.billedDate <= to).reduce((a, x) => a + x.amount, 0);
    const recv = db.payments.filter((x) => x.siteId === m.site.id && x.receivedDate <= to).reduce((a, x) => a + x.amount, 0);
    const ded = deductedTotal(db, m.site.id, to);
    const ar = billed - recv - ded;
    const lastPay = db.payments.filter((x) => x.siteId === m.site.id && x.receivedDate <= to).map((x) => x.receivedDate).sort().pop() ?? "";
    return [m.site.shortName || m.site.name, n(billed), n(recv), n(ar), n(ar + vat(ar)), lastPay, m.site.clientName ?? "", n(ded), n(m.retentionAtEnd)];
  });
  const receivable: string[][] = [
    ["현장", `${asOf}까지 확정 기성 누계(공급가액)`, `${asOf}까지 입금 누계(부가세 제외)`, `${asOf} 미수(공급가액 · 기성 − 입금 − 공제)`, "미수 부가세 포함(×1.1·계산)", "마지막 입금일", "발주처", `${asOf}까지 발주처 공제 누계(받지 못함)`, `미수 중 유보금(${asOf} · 나중에 받을 돈)`],
    ...arRows,
    ["합계", n(colSum([[], ...arRows], 1)), n(colSum([[], ...arRows], 2)), n(colSum([[], ...arRows], 3)), n(colSum([[], ...arRows], 4)), "", "", n(colSum([[], ...arRows], 7)), n(colSum([[], ...arRows], 8))],
  ];

  // ── 유보·공제 (D-89) — 이달 발주처가 뗀 금액(뗀 날 기준) · 이달 받은 유보금 ──
  const adjs = activeAdjustments(db).filter((a) => siteIds.has(a.siteId));
  const wRows = [
    ...adjs.filter((a) => inMonth(a.date)).map((a) => ({ d: a.date, row: [a.date, siteName(a.siteId), adjustmentLabel(a), n(a.kind === "deduction" ? a.amount : 0), n(a.kind === "retention" ? a.amount : 0), "", roundOf(a.billingId), a.dueDate ?? "", a.note, userName(a.createdBy)] })),
    ...adjs.flatMap((a) => (a.released ?? []).filter((x) => inMonth(x.date)).map((x) => ({ d: x.date, row: [x.date, siteName(a.siteId), "유보금 받음 (입금으로 등록)", "", "", n(x.amount), roundOf(a.billingId), "", a.note, userName(x.by)] }))),
  ].sort((a, x) => a.d.localeCompare(x.d) || String(a.row[1]).localeCompare(String(x.row[1])));
  const withheld: string[][] = [
    ["날짜", "현장", "구분", "공제(받지 못함 · 원)", "유보금 뗌(나중에 받음 · 원)", "유보금 받음(원 · 입금 시트에도 있음)", "연결 기성", "유보금 받을 예정일", "사유·메모", "넣은 사람"],
    ...wRows.map((x) => x.row),
    ["합계", "", "", n(colSum([[], ...wRows.map((x) => x.row)], 3)), n(colSum([[], ...wRows.map((x) => x.row)], 4)), n(colSum([[], ...wRows.map((x) => x.row)], 5)), "", "", "", ""],
  ];

  // ── 원가 (발생일 기준 · 모든 상태 — 합계는 ‘확정’만) ──
  const costRaw = monthCostRows(db, month, today).map((row) => row.map((v) => (typeof v === "number" ? n(v) : String(v ?? ""))));
  const STATUS_COL = costRaw[0].indexOf("상태");
  const AMOUNT_COL = costRaw[0].indexOf("금액(원)");
  const confirmedCost = costRaw.slice(1).filter((row) => row[STATUS_COL] === "확정").reduce((a, row) => a + (Number(row[AMOUNT_COL]) || 0), 0);
  const costTotalRow = costRaw[0].map((_, i) => (i === 0 ? "확정 합계" : i === AMOUNT_COL ? n(confirmedCost) : ""));
  // 확정 줄과 합계 → 그 아래에 합계에 넣지 않은 줄(대기·반려·취소)을 따로 (점검 반영: 한 열에 섞여 SUM·피벗이 틀리던 문제)
  const confirmedRows = costRaw.slice(1).filter((row) => row[STATUS_COL] === "확정");
  const otherRows = costRaw.slice(1).filter((row) => row[STATUS_COL] !== "확정");
  const blank = costRaw[0].map(() => "");
  const cost: string[][] = [
    costRaw[0],
    ...confirmedRows,
    costTotalRow,
    ...(otherRows.length ? [blank, costRaw[0].map((_, i) => (i === 0 ? "↓ 합계에 넣지 않은 줄 (공무 확인 대기·반려·취소) — 참고만" : "")), ...otherRows] : []),
  ];
  // 원가 항목별 (현장 × 자재·노무·외주·장비·경비) — 공사원가명세서용 (월 마감 화면과 같은 숫자)
  const cats = Object.keys(r.money[0]?.cost ?? {}) as (keyof (typeof r.money)[number]["cost"])[];
  const catHead = ["현장", ...cats.map((c) => CATEGORY_LABEL[c]), "합계(확정)"];
  const catRows = r.money.map((m) => [m.site.shortName || m.site.name, ...cats.map((c) => n(m.cost[c])), n(m.costTotal)]);
  const byCategory: string[][] = [catHead, ...catRows, ["합계", ...cats.map((_, i) => n(catRows.reduce((a, x) => a + Number(x[i + 1]), 0))), n(catRows.reduce((a, x) => a + Number(x[x.length - 1]), 0))]];

  // 변경공사 증빙 파일 (D-88) — 종류별 개수 · 승인됐는데 서면이 없으면 ‘서면 없음’
  // 파일 이름·올린 날도 (세무사가 종이 서류와 맞춰 보게 · D-88 점검) — 3개까지, 나머지는 ‘외 N개’
  const evidenceText = (c: (typeof db.changeOrders)[number], approved: boolean) => {
    const ev = coEvidenceOf(db, c.id);
    const by = new Map<string, number>();
    for (const e of ev) by.set(EVIDENCE_SHORT[e.docType] ?? "기타", (by.get(EVIDENCE_SHORT[e.docType] ?? "기타") ?? 0) + 1);
    const count = [...by].map(([k, v]) => `${k} ${v}`).join(" · ");
    const names = ev.slice(0, 3).map((e) => `${e.fileName}(${kst(e.createdAt).slice(5).replace("-", "/")})`).join(", ") + (ev.length > 3 ? ` 외 ${ev.length - 3}개` : "");
    const list = count ? `${count} — ${names}` : "";
    const written = ev.some((e) => e.docType === "contract" || e.docType === "letter");
    if (!approved || written) return list;
    const kept = c.paperKept ? `서면 원본 종이 보관: ${c.paperKept.note}` : "승인 서면 없음";
    return list ? `${list} (${kept})` : kept;
  };
  // ── 변경공사 (월말까지 등록 · 이달 결정했거나 월말에 결정 전) — 상태는 그 달 말 기준 (점검 반영: 다음 달 승인이 지난달 파일에 ‘승인’으로 보이던 문제) ──
  const cos = db.changeOrders
    .filter((c) => {
      if (!siteIds.has(c.siteId)) return false;
      const decided = c.decidedAt ? kst(c.decidedAt) : null;
      const openAtEnd = kst(c.requestedAt) <= to && (!decided || decided > to);
      return openAtEnd || (!!decided && inMonth(decided));
    })
    .sort((a, x) => siteName(a.siteId).localeCompare(siteName(x.siteId)) || a.requestedAt.localeCompare(x.requestedAt));
  const coRows = cos.map((c) => {
    const decided = c.decidedAt ? kst(c.decidedAt) : null;
    const decidedByEnd = !!decided && decided <= to;
    const submittedByEnd = !!c.submittedAt && kst(c.submittedAt) <= to;
    const endStatus = decidedByEnd ? CO_STATUS_LABEL[c.status] : submittedByEnd ? CO_STATUS_LABEL.submitted : CO_STATUS_LABEL.review;
    const approvedHere = c.status === "approved" && !!decided && inMonth(decided) ? (c.approvedAmount ?? c.amount) : null;
    const later = !decidedByEnd && c.status !== "review" && c.status !== "submitted" ? ` (${decided ? `${decided} ` : ""}${CO_STATUS_LABEL[c.status]})` : "";
    return [
      siteName(c.siteId),
      c.title,
      n(c.amount),
      c.status === "approved" && decidedByEnd ? n(c.approvedAmount ?? c.amount) : "",
      endStatus,
      `${CO_STATUS_LABEL[c.status]}${later ? "" : ""}`,
      kst(c.requestedAt),
      submittedByEnd ? kst(c.submittedAt!) : "",
      decidedByEnd ? decided! : "",
      c.approvalBasis && decidedByEnd ? approvalBasisText(c, coEvidenceOf(db, c.id)) : "",
      [c.decisionNote, c.note].filter(Boolean).join(" · ") + later,
      approvedHere === null ? "" : n(approvedHere),
      evidenceText(c, c.status === "approved"),
    ];
  });
  const change: string[][] = [["현장", "제목", "청구 금액", `승인 금액(${asOf})`, `${asOf} 상태`, "지금 상태", "등록일", `발주처 청구일(${asOf}까지)`, `결정일(${asOf}까지)`, "승인 근거", "사유·메모", "이달 승인 금액", "증빙 파일(지금 · 시스템에 보관)"], ...coRows, ["합계 (이달 승인)", "", "", "", "", "", "", "", "", "", "", n(coRows.reduce((a, x) => a + (Number(x[11]) || 0), 0)), ""]];

  // ── 노무 — 근무 기록 기준 추정은 관리용 참고 숫자 (확정 노무비·급여가 아님 · 점검 반영) ──
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
  const labor: string[][] = [
    ["현장", "추정 인건비 (출퇴근·출력 기준 · 참고 — 급여 아님)", "입력된 노무비(원가 · 비교 대상)", "모자람(추정 − 입력)", "노무 정산", "정산 금액(원가에 들어감)", "정산 발생일", "정산한 사람"],
    ...laborRows,
    ...(laborRows.length ? [["합계", n(colSum([[], ...laborRows], 1)), n(colSum([[], ...laborRows], 2)), n(colSum([[], ...laborRows], 3)), "", n(colSum([[], ...laborRows], 5)), "", ""]] : []),
  ];

  // ── 이익을 바꾼 일 — 날짜는 손익에 들어온 날(공무 확인·승인 받은 날) · 관리용 숫자 ──
  const evRows = r.profit.flatMap((p) => p.events.map((e) => [e.date, p.site.shortName || p.site.name, n(e.amount), e.text]));
  const events: string[][] = [["손익에 들어온 날", "현장", "예상이익에 미친 금액(원)", "내용 (괄호 안은 실제 발생일·받은 날)"], ...evRows, ["합계", "", n(evRows.reduce((a, x) => a + Number(x[2]), 0)), ""]];

  // ── 대조 — 서로 따로 만든 시트끼리, 그리고 화면(월 마감) 숫자와 (같은 숫자를 자기와 비교하지 않게 · D-87 점검) ──
  //   기성·입금·미수·원가·변경공사 시트는 자료에서 바로 만들고, 현장별 요약·원가 항목별은 월 마감 계산에서 만든다
  const last = (rows: string[][], col: number) => Number(rows[rows.length - 1][col]) || 0;
  const confirmedSheet = confirmedRows.reduce((a, row) => a + (Number(row[AMOUNT_COL]) || 0), 0);
  const pendingSheet = otherRows.filter((row) => row[STATUS_COL] === "공무 확인 대기").reduce((a, row) => a + (Number(row[AMOUNT_COL]) || 0), 0);
  const CAT_COL = costRaw[0].indexOf("항목");
  const catGap = cats.reduce((a, c, i) => {
    const fromCost = confirmedRows.filter((row) => row[CAT_COL] === CATEGORY_LABEL[c]).reduce((x, row) => x + (Number(row[AMOUNT_COL]) || 0), 0);
    return a + Math.abs(fromCost - (Number(byCategory[byCategory.length - 1][i + 1]) || 0));
  }, 0);
  const profitNet = r.profit.reduce((a, p) => a + p.net, 0);
  const billSheet = colSum(billing, 3, billing.length - 1);
  const paySheet = colSum(payment, 3, payment.length - 1);
  const arSheet = last(receivable, 3);
  const dedSheet = last(withheld, 3);
  const coSheet = last(change, 11);
  const evSheet = last(events, 2);
  const checks: WorkbookCheck[] = [
    { label: "이달 기성: 기성 시트 = 화면", sheet: billSheet, screen: r.totals.billed },
    { label: "이달 기성: 현장별 요약 = 기성 시트", sheet: last(summary, 5), screen: billSheet },
    { label: "이달 입금: 입금 시트 = 화면", sheet: paySheet, screen: r.totals.received },
    { label: "이달 입금: 현장별 요약 = 입금 시트", sheet: last(summary, 6), screen: paySheet },
    { label: "미수: 미수 시트 = 화면", sheet: arSheet, screen: r.totals.outstandingAtEnd },
    { label: "미수: 현장별 요약 = 미수 시트", sheet: last(summary, 7), screen: arSheet },
    { label: "이달 발주처 공제: 유보·공제 시트 = 화면", sheet: dedSheet, screen: r.totals.deducted },
    { label: "이달 원가: 원가 시트 ‘확정’ 줄 = 화면", sheet: confirmedSheet, screen: r.totals.costTotal },
    { label: "이달 원가: 현장별 요약 = 원가 시트", sheet: last(summary, 8), screen: confirmedSheet },
    { label: "원가 항목별 시트 = 원가 시트(항목마다 더한 값) — 차이 합", sheet: catGap, screen: 0 },
    { label: "공무 확인 대기: 원가 시트 대기 줄 = 화면", sheet: pendingSheet, screen: r.totals.pending },
    { label: "이달 승인 변경공사: 변경공사 시트 = 화면", sheet: coSheet, screen: r.totals.changeApproved },
    { label: "이달 승인 변경공사: 현장별 요약 = 변경공사 시트", sheet: last(summary, 10), screen: coSheet },
    { label: "이익을 바꾼 일: 현장별 요약 = 이익을 바꾼 일 시트", sheet: last(summary, 12), screen: evSheet },
  ].map((c) => ({ ...c, ok: Math.round(c.sheet) === Math.round(c.screen) }));
  const ok = checks.every((c) => c.ok);

  // ── 안내 ──
  const closeText = rec
    ? [`공무 마감 ${isoMinute(rec.closedAt)} ${userName(rec.closedBy)}`, rec.confirmedAt ? `대표 확인 ${isoMinute(rec.confirmedAt)} ${userName(rec.confirmedBy)}` : "대표 확인 전", changed ? `마감 뒤 바뀐 것 ${changed}건 — 이 파일은 지금 숫자` : "마감 뒤 바뀐 것 없음"].join(" · ")
    : "";
  const STAGE_NOTE: Record<typeof stage, string> = {
    진행중: `진행 중인 달입니다(${to}까지의 숫자). 장부에 넣지 마세요.`,
    마감전: "공무 마감 전입니다 — 숫자가 바뀔 수 있어 가마감 자료로만 쓰세요.",
    대표확인전: "공무 마감은 끝났고 대표 확인 전입니다.",
    확인뒤변경: "대표 확인 뒤 바뀐 것이 있어 확인 때 숫자와 다릅니다.",
    대표확인: "공무 마감·대표 확인이 끝난 자료입니다.",
  };
  const now = opts.now ?? new Date();
  const items = r.items.slice(0, 12).map((it, i) => [i === 0 ? `닫기 전에 볼 것 ${r.items.length}건` : "", it.text]);
  const info: string[][] = [
    ["항목", "내용"],
    ["자료", "태강 현장관리 — 월 마감 자료 (세무·회계 전달용)"],
    ["회사", db.company.name],
    ["대상 월", `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 (${from} ~ ${b.to})${r.ended ? "" : ` · 진행 중 — ${to}까지`}`],
    ["만든 시각", `${isoMinute(now.toISOString())}${opts.by ? ` · ${userName(opts.by)}` : ""}`],
    ["마감 상태", rec ? `${STAGE_NOTE[stage]} (${closeText})` : STAGE_NOTE[stage]],
    ...(items.length ? items : r.ended ? [["닫기 전에 볼 것", "없음"]] : []),
    ["숫자 대조", ok ? `이 파일의 합계 ${checks.length}개를 프로그램이 ‘월 마감’ 화면 숫자와 맞춰 봤습니다 — 모두 같음. (통장·홈택스·세금계산서와 맞춘 것은 아닙니다)` : `화면과 다른 숫자 ${checks.filter((c) => !c.ok).length}개 — 이 파일을 쓰지 말고 회사에 알려 주세요: ${checks.filter((c) => !c.ok).map((c) => c.label).join(", ")}`],
    ...(r.late.n ? [["달이 끝난 뒤 들어온 원가", `이 달 날짜 원가 ${r.late.n}건 ${n(r.late.amount)}원 — 마감 뒤 들어와 인쇄해 둔 마감본과 다를 수 있음`]] : []),
    ...(r.lateMoney.n ? [["달이 끝난 뒤 넣은 기성·입금", `${r.lateMoney.n}건 (기성 ${n(r.lateMoney.billed)}원 · 입금 ${n(r.lateMoney.received)}원)`]] : []),
    ["", ""],
    ["금액 기준", "모든 금액은 공급가액(부가세 별도)입니다. 입금은 받은 돈을 부가세 제외로 환산해 넣은 금액이라 통장 입금액은 대개 ‘부가세 포함 환산’ 칸(×1.1)과 비슷합니다. 부가세 칸은 10%로 계산한 참고값입니다 — 세금계산서·통장 금액과 맞춰 보세요."],
    ["날짜 기준", "기성은 확정 기성의 청구일 · 입금은 입금일 · 원가는 발생일 기준이고, 원가 합계는 공무 확인이 끝난 ‘확정’만 셉니다(대기·반려·취소 줄은 원가 시트 아래에 따로)."],
    ["", `미수 = ${asOf}까지 확정 기성 누계 − ${asOf}까지 입금 누계 − ${asOf}까지 발주처 공제(지체상금·상계 등 받지 못하는 돈). 미수 중 유보금은 나중에 받을 돈입니다. 계약·변경공사·예상이익은 ${asOf} 기준(지금 숫자는 ‘참고’ 칸). 변경공사는 승인 전에는 계약·이익에 들어가지 않습니다.`],
    ["관리용 숫자", "예상이익 · 이익을 바꾼 일 · 노무 추정 인건비는 경영 관리용 숫자이고 장부 숫자가 아닙니다. 노무 추정은 출퇴근·작업 인원 기준 추정이라 급여·원천세·지급명세서에 쓰지 마세요."],
    ["변경공사 증빙", "변경공사 시트의 ‘증빙 파일’ 칸은 시스템에 올려 둔 변경계약서·공문·견적서 파일 수입니다. 파일 자체는 회사에 요청하시면 보내 드립니다."],
    ["", "숫자가 장부와 다르면 회사(공무 담당)에 알려 주시면 고쳐서 다시 보내 드립니다."],
    ["", ""],
    ["시트", "현장별 요약 · 기성 · 입금 · 미수 · 유보·공제 · 원가 · 원가 항목별 · 변경공사 · 노무 · 이익을 바꾼 일"],
  ];

  const sheets: SheetSpec[] = [
    { name: "안내", rows: info, widths: [22, 110], header: true, wrap: true, typed: false },
    // textCols — 사람이 적은 글(현장·제목·메모·사유·팀·이름)은 늘 글자로 (메모의 전화번호·날짜 모양 글이 숫자·날짜로 바뀌지 않게 · D-87 점검)
    { name: "현장별 요약", rows: summary, widths: [16, 9, 15, 17, 18, 14, 14, 14, 15, 15, 15, 15, 15, 16], header: true, textCols: [0, 1] },
    { name: "기성", rows: billing, widths: [12, 16, 7, 15, 15, 17, 20, 17, 10, 18], header: true, textCols: [1, 2, 6, 7, 8, 9] },
    { name: "입금", rows: payment, widths: [12, 16, 9, 20, 22, 20, 17, 10, 18], header: true, textCols: [1, 2, 5, 6, 7, 8] },
    { name: r.ended ? "월말 미수" : "미수(오늘)", rows: receivable, widths: [16, 24, 24, 26, 22, 13, 20, 24, 24], header: true, textCols: [0, 6] },
    { name: "유보·공제", rows: withheld, widths: [12, 16, 26, 18, 20, 22, 10, 14, 34, 10], header: true, textCols: [1, 2, 6, 8, 9] },
    { name: "원가", rows: cost, widths: [26, 17, 14, 10, 10, 14, 12, 12, 30, 16, 10, 12, 20, 14, 24], header: true, textCols: costRaw[0].map((h, i) => (["발생일", "입력일", "금액(원)", "처음 금액(고치기 전)"].includes(h) ? -1 : i)).filter((i) => i >= 0) },
    { name: "원가 항목별", rows: byCategory, widths: [16, ...cats.map(() => 14), 16], header: true, textCols: [0] },
    { name: "변경공사", rows: change, widths: [16, 26, 14, 14, 16, 16, 12, 16, 14, 14, 30, 14, 24], header: true, textCols: [0, 1, 4, 5, 9, 10, 12] },
    { name: "노무", rows: labor, widths: [16, 26, 22, 18, 16, 18, 12, 12], header: true, textCols: [0, 4, 7] },
    { name: "이익을 바꾼 일", rows: events, widths: [14, 16, 18, 60], header: true, textCols: [1, 3] },
  ];
  const company = (db.company.name || "회사").replace(/[^\w가-힣]/g, "");
  const expect: WorkbookExpect = { billed: r.totals.billed, received: r.totals.received, outstanding: r.totals.outstandingAtEnd, cost: r.totals.costTotal, pending: r.totals.pending, changeApproved: r.totals.changeApproved, profitNet, deducted: r.totals.deducted };
  return { sheets, checks, ok, stage, expect, filename: `월마감_${month}_${stage}_${company}.xlsx` };
}

/**
 * 내려받을 파일을 다시 읽어 합계가 화면과 같은지 (D-87 점검 — 만든 문자열이 아니라 실제로 쓴 엑셀 칸을 읽는다).
 * 숫자 칸이 글자로 바뀌었거나 글자가 깨졌으면 여기서 다르게 나온다.
 */
export async function verifyWorkbookFile(bytes: Uint8Array, w: MonthWorkbook): Promise<WorkbookCheck[]> {
  const { readXlsx } = await import("./xlsx");
  const sheets = await readXlsx(bytes);
  const rows = (name: string) => sheets.find((x) => x.name === name)?.rows ?? [];
  const lastNum = (name: string, col: number) => {
    const r = rows(name);
    return Number((r[r.length - 1] ?? [])[col] ?? NaN);
  };
  const cost = rows("원가");
  const head = cost[0] ?? [];
  const amt = head.indexOf("금액(원)");
  const st = head.indexOf("상태");
  const total = cost.find((r) => r[0] === "확정 합계");
  const pending = cost.filter((r) => r[st] === "공무 확인 대기").reduce((a, r) => a + (Number(r[amt]) || 0), 0);
  const ar = sheets.find((x) => x.name === "월말 미수" || x.name === "미수(오늘)")?.name ?? "월말 미수";
  return [
    { label: "파일: 기성", sheet: lastNum("기성", 3), screen: w.expect.billed },
    { label: "파일: 입금", sheet: lastNum("입금", 3), screen: w.expect.received },
    { label: "파일: 미수", sheet: lastNum(ar, 3), screen: w.expect.outstanding },
    { label: "파일: 이달 발주처 공제", sheet: lastNum("유보·공제", 3), screen: w.expect.deducted },
    { label: "파일: 원가(확정)", sheet: Number(total?.[amt] ?? NaN), screen: w.expect.cost },
    { label: "파일: 공무 확인 대기", sheet: pending, screen: w.expect.pending },
    { label: "파일: 이달 승인 변경공사", sheet: lastNum("변경공사", 11), screen: w.expect.changeApproved },
    { label: "파일: 이익을 바꾼 일", sheet: lastNum("이익을 바꾼 일", 2), screen: w.expect.profitNet },
    { label: "파일: 현장별 요약 기성", sheet: lastNum("현장별 요약", 5), screen: w.expect.billed },
    { label: "파일: 현장별 요약 원가", sheet: lastNum("현장별 요약", 8), screen: w.expect.cost },
  ].map((c) => ({ ...c, ok: Number.isFinite(c.sheet) && Math.round(c.sheet) === Math.round(c.screen) }));
}
