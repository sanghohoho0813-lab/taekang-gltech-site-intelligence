"use client";

/**
 * 대표 보고서 — 달별 보기 (D-83 · D-82 대표 점검 ‘대표 보고서 달별 보기·마감 상태’).
 * 숫자는 월 마감과 같은 계산(monthClose)과 같은 마감 기록(closeRecord)을 그대로 쓴다 — 화면마다 숫자가 달라지지 않게.
 * 금액은 만 원 단위로 반올림해 보여 준다 (작은 달 숫자가 ‘0.36억’처럼 뭉개지거나 0.1만이 섞이던 문제 · D-82·D-83 점검).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck, Lock, Printer } from "lucide-react";
import { userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, cx, inputCls } from "@/components/ui/primitives";
import { Clock } from "@/components/shell/Clock";
import type { DemoDB } from "@/lib/domain/types";
import { laborShort, monthClose, profitEvents, type MonthCloseReport } from "@/lib/domain/monthClose";
import { changesAfterClose, currentClose, firstUseDate, type ChangesAfterClose } from "@/lib/domain/closeRecord";
import { siteFinancials } from "@/lib/domain/calc";
import { computeSignals } from "@/lib/domain/risk";
import { CLAIMABLE_REASONS, coBoard, coByEntry, coStageText, rejectedByEntry } from "@/lib/domain/changeOrders";
import { CATEGORY_LABEL, COST_CATEGORIES, REASON_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtMan, fmtPct } from "@/lib/domain/format";
import { IS_LIVE } from "@/lib/mode";

const ml = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
/** 만 원 단위로 반올림 */
const man = (v: number) => fmtMan(Math.round(v / 10_000) * 10_000);
const zero = (v: number) => Math.round(v / 10_000) === 0;
const signed = (v: number) => (zero(v) ? "0" : `${v > 0 ? "+" : "−"}${man(Math.abs(v))}`);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

interface Todo {
  text: string;
  href: string;
  tone: "warn" | "err" | "info";
}

/** 대표가 정할 일 (D-83 대표 점검) — 마감 확인·계약 초과 기성·결정 전 변경공사·준공 원가·노무 정산·기성 청구 지연 */
function ceoTodos(db: DemoDB, r: MonthCloseReport, ch: ChangesAfterClose | null, today: string): Todo[] {
  const out: Todo[] = [];
  const rec = currentClose(db, r.month);
  const m = Number(r.month.slice(5));
  if (rec && !rec.confirmedAt) out.push({ tone: "warn", text: `${m}월 마감 확인 (${fmtDate(rec.closedAt)} ${userLabel(db, rec.closedBy)} 마감${ch?.count ? ` · 마감 뒤 바뀐 것 ${ch.count}건` : ""})`, href: `/close?month=${r.month}` });
  if (rec?.confirmedAt && ch?.count) out.push({ tone: "warn", text: `${m}월 확인 뒤 바뀐 것 ${ch.count}건 — 보고 다시 확인`, href: `/close?month=${r.month}#close-changes` });
  for (const mny of r.money) {
    const f = siteFinancials(db, mny.site.id);
    if (f.adjustedContract > 0 && f.billed > f.adjustedContract) {
      const last = db.billings.filter((b) => b.siteId === mny.site.id && b.status === "confirmed").sort((a, b) => (b.createdAt ?? b.billedDate).localeCompare(a.createdAt ?? a.billedDate))[0];
      out.push({
        tone: "err",
        text: `${mny.site.shortName} 누계 기성 ${man(f.billed)} — 계약(승인 변경 포함) ${man(f.adjustedContract)}보다 ${man(f.billed - f.adjustedContract)} 많음${last ? ` · 마지막 ${md(last.billedDate)}자${last.createdAt ? ` (${fmtDate(last.createdAt)} ${userLabel(db, last.createdBy)} 입력)` : ""}` : ""} — 변경공사 근거인지 입력 실수인지 확인`,
        href: "/finance",
      });
    }
  }
  // 결정 전 변경공사는 공무·발주처의 일이라 여기서 뺀다 (‘닫기 전에 볼 것’에 있음 · D-84 대표 점검)
  for (const it of r.items.filter((i) => i.kind === "settle")) out.push({ tone: "warn", text: it.text, href: it.href });
  // 청구 안 한 설계변경 추가 원가 (D-84) — 청구하지 않으면 그대로 이익 감소 · 이 달 말까지 생긴 것만 (지난달 보고서가 나중에 바뀌지 않게)
  const ids0 = new Set(r.money.map((x) => x.site.id));
  const board = coBoard(db, today);
  const unclaimed = board.unclaimed.filter((e) => ids0.has(e.siteId) && e.date <= r.to);
  // 반려됐는데 다시 청구할지·손실로 정리할지 안 정한 것 — 대표가 정할 일 (D-84 대표 점검)
  for (const x of board.decided.filter((d) => d.reclaimUndecided && ids0.has(d.co.siteId)))
    out.push({ tone: "warn", text: `${x.site?.shortName ?? ""} 변경공사 ‘${x.co.title}’ ${man(x.co.amount)} 반려${x.co.decisionNote ? ` (${x.co.decisionNote})` : ""} — 근거를 보강해 다시 청구할지, 손실로 정리할지`, href: `/finance#co-${x.co.id}` });
  if (unclaimed.length)
    out.push({ tone: "warn", text: `변경공사로 청구 안 한 설계변경 추가 원가 ${unclaimed.length}건 ${man(unclaimed.reduce((a, e) => a + e.amount, 0))} (${unclaimed.slice(0, 3).map((e) => `${db.sites.find((x) => x.id === e.siteId)?.shortName ?? ""} ${e.note || ""}`.trim()).join(" · ")}) — 청구할지 정하기`, href: "/finance#co-unclaimed" });
  for (const l of r.labor.filter((x) => x.canSettle)) out.push({ tone: "warn", text: `${l.site.shortName} 노무 — 출력 기준 추정보다 입력이 ${man(l.shortfall)} 적음 · 명세가 오면 넣거나 차액 정산`, href: `/close?month=${r.month}#close-labor` });
  const ids = new Set(r.money.map((x) => x.site.id));
  for (const s of computeSignals(db, new Date(`${today}T03:00:00Z`)).filter((x) => x.rule === "BILLING_LAG" && ids.has(x.siteId))) out.push({ tone: "warn", text: `${s.title} — ${s.summary}`, href: "/finance" });
  return out;
}

export function MonthlyReport({ db, month, months, today, onMonth, focusSelect }: { db: DemoDB; month: string; months: string[]; today: string; onMonth: (m: string) => void; focusSelect?: boolean }) {
  const r = monthClose(db, month, today);
  const rec = currentClose(db, month);
  const ch = rec ? changesAfterClose(db, rec, today) : null;
  const base = rec ? (rec.confirmSnapshot ?? rec.snapshot) : null;
  const baseLabel = rec?.confirmSnapshot ? "대표 확인 때" : "마감 때";
  const profitNet = r.profit.reduce((a, p) => a + p.net, 0);
  const baseProfitNet = base && base.sites.length && base.sites.every((s) => s.profitNet !== undefined) ? base.sites.reduce((a, s) => a + (s.profitNet ?? 0), 0) : undefined;
  const events = r.profit.flatMap((p) => p.events.map((e) => ({ ...e, site: p.site.shortName, siteId: p.site.id }))).sort((a, b) => a.date.localeCompare(b.date));
  const costByCat = COST_CATEGORIES.map((c) => ({ c, v: r.money.reduce((a, m) => a + m.cost[c], 0) })).filter((x) => x.v);
  const running = !r.ended;
  const started = firstUseDate(db);
  const beforeApp = !!started && r.to < started;
  // 월 마감과 같은 기준 — 달이 끝났고, 많이 모자라고(20%·50만 원), 아직 정산 전 (D-83 버그 배시)
  const laborDue = r.labor.filter((l) => r.ended && laborShort(l) && !l.settled);
  // 지난달 말 미수 + 이달 기성 − 이달 입금 − 이달 발주처 공제(D-89) = 월말 미수 (대시보드 ‘지금 미수’와 다른 이유)
  const prevOut = r.money.reduce((a, m) => a + (m.outstandingAtEnd - m.billed + m.received + m.deducted), 0);
  const nowOut = r.money.reduce((a, m) => a + siteFinancials(db, m.site.id).outstanding, 0);
  const todos = ceoTodos(db, r, ch, today);
  // 원가 → 그 원가로 청구한 변경공사 (D-84 — 같은 현장의 아무 변경공사가 아니라 그 원가의 것)
  const claimedBy = coByEntry(db);
  const rejectedBy = rejectedByEntry(db);
  const rows = new Map(r.money.map((m) => [m.site.id, siteRow(db, r, m.site.id, today)]));

  // 핵심 요약 — 데이터에서 자동 생성 (사람이 지어낸 문장 아님)
  const bullets: { tone: "err" | "ok" | "warn" | "info"; text: string }[] = [];
  for (const p of r.profit.filter((x) => !zero(x.net)))
    bullets.push({ tone: p.net < 0 ? "err" : "ok", text: `${p.site.shortName} 이달 예상이익 ${signed(p.net)} — ${p.events.map((e) => e.text.split(" — ")[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(" · ")}` });
  if (laborDue.length) bullets.push({ tone: "info", text: `노무 — ${laborDue.map((l) => `${l.site.shortName} 입력이 추정보다 ${man(l.shortfall)} 적음`).join(" · ")}. 실제 노무비가 실행예산 안이면 이익은 그대로이고, 넘으면 넘은 만큼 줄어듭니다` });
  const lateBits = [r.late.n ? `원가 ${r.late.n}건 ${man(r.late.amount)}` : "", r.lateMoney.billed ? `기성 ${man(r.lateMoney.billed)}` : "", r.lateMoney.received ? `입금 ${man(r.lateMoney.received)}` : ""].filter(Boolean);
  if (r.ended && lateBits.length) bullets.push({ tone: "info", text: `달이 끝난 뒤에 넣은 ${Number(month.slice(5))}월 날짜 ${lateBits.join(" · ")} — 그때 인쇄한 숫자와 다를 수 있습니다` });
  if (!bullets.length) bullets.push({ tone: "info", text: "이달 예상이익을 바꾼 일이 없습니다." });
  // 맨 위 한 줄 총평
  const worst = [...r.profit].sort((a, b) => a.net - b.net)[0];
  const headline = beforeApp
    ? `${ml(month)}은 앱을 쓰기 전 달입니다 — 가져온 지난 자료만 있습니다.`
    : `${running ? "진행 중 · " : ""}기성 ${man(r.totals.billed)} · 입금 ${man(r.totals.received)} · 원가 ${man(r.totals.costTotal)} · 예상이익 ${signed(profitNet)}${worst && worst.net < 0 && !zero(worst.net) ? ` (${worst.site.shortName} ${signed(worst.net)})` : ""} · 대표가 정할 일 ${todos.length}건`;

  return (
    <PageBody className="print-full">
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            생성 시각 <Clock />
          </span>
        }
        title={`대표 보고서 · ${ml(month)}`}
        desc={`${ml(month)} 한 달 — 기성·입금·원가·이익을 바꾼 일·노무. 숫자는 월 마감·기성·수금·투입·인건비와 같은 계산입니다.${IS_LIVE ? "" : " (가상 시연 데이터 · 실제 실적 아님)"}`}
        right={
          <div className="no-print flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[0.84rem] font-semibold text-ink-2">
              보기
              <select className={cx(inputCls, "h-10 w-auto py-1")} value={month} autoFocus={focusSelect} onChange={(e) => onMonth(e.target.value)} data-testid="report-month">
                <option value="">누계 (지금)</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {ml(m)}
                    {m === today.slice(0, 7) ? " (진행 중)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Button icon={<Printer size={17} />} onClick={() => window.print()}>
              인쇄·PDF
            </Button>
          </div>
        }
      />

      <p className="num rounded-xl bg-surface-2 px-4 py-3 text-[0.95rem] font-bold text-ink" data-testid="report-month-headline">
        {headline}
      </p>

      {/* 마감 상태 */}
      <Card data-testid="report-month-close" data-state={rec ? (rec.confirmedAt ? "confirmed" : "closed") : beforeApp ? "before-app" : r.ended ? "open" : "running"}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 text-[0.88rem]">
          {rec ? (
            <>
              <Lock size={16} aria-hidden />
              <span className="font-semibold">
                {Number(month.slice(5))}월 마감 {fmtDateTime(rec.closedAt)} {userLabel(db, rec.closedBy)}
              </span>
              {rec.confirmedAt ? (
                <Badge tone={ch?.count ? "warn" : "ok"} icon={ch?.count ? undefined : <CircleCheck size={13} />}>
                  대표 확인 {fmtDateTime(rec.confirmedAt)} {userLabel(db, rec.confirmedBy)}
                  {ch?.count ? ` · 확인 뒤 바뀜 ${ch.count}건` : ""}
                </Badge>
              ) : (
                <Badge tone="warn">대표 확인 대기{ch?.count ? ` · 마감 뒤 바뀜 ${ch.count}건` : ""}</Badge>
              )}
            </>
          ) : beforeApp ? (
            <span className="font-semibold text-ink-2">앱을 쓰기 전 달 — 가져온 지난 자료(이관)만 있습니다</span>
          ) : r.ended ? (
            <span className="font-semibold text-warn">아직 마감하지 않은 달입니다 — 숫자가 바뀔 수 있습니다</span>
          ) : (
            <span className="font-semibold text-ink-2">진행 중인 달 — {fmtDate(r.from)}부터 오늘({fmtDate(r.to)})까지</span>
          )}
          <Link href={`/close?month=${month}`} className="no-print ml-auto inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.82rem] font-bold text-theme-ink hover:bg-active-soft">
            월 마감에서 보기 <ArrowRight size={15} />
          </Link>
        </div>
        {(rec?.note || rec?.confirmNote) && (
          <p className="border-t border-line px-5 py-2 text-[0.82rem] text-ink-2">{[rec?.note ? `마감 메모: ${rec.note}` : "", rec?.confirmNote ? `대표 메모: ${rec.confirmNote}` : ""].filter(Boolean).join(" · ")}</p>
        )}
        {ch && ch.count > 0 && (
          <ul className="space-y-0.5 border-t border-line px-5 py-2 text-[0.82rem] text-ink-2" data-testid="report-month-changes">
            {[...ch.events.map((e) => e.text), ...ch.people.map((p) => `출퇴근 시간 바뀜 · ${p.name}`)].slice(0, 6).map((t, i) => (
              <li key={i}>• {t}</li>
            ))}
            {ch.events.length + ch.people.length > 6 && <li>… 나머지는 월 마감에서</li>}
          </ul>
        )}
      </Card>

      {/* 대표가 정할 일 */}
      <Card className="print-card" data-testid="report-month-todos">
        <CardHeader title={todos.length ? `대표가 정할 일 ${todos.length}건` : "대표가 정할 일 없음"} sub={todos.length ? "누르면 그 화면으로 갑니다" : "마감 확인·계약 초과 기성·결정 전 변경공사·노무 정산·준공 원가·기성 청구 지연을 살핍니다"} />
        {todos.length > 0 && (
          <ol className="divide-y divide-line border-t border-line text-[0.86rem]">
            {todos.map((t, i) => (
              <li key={i}>
                <Link href={t.href} className={cx("row-hover flex gap-2 px-5 py-2.5", t.tone === "err" && "font-semibold text-err")} data-testid="report-month-todo">
                  <span className="num shrink-0 text-ink-3">{i + 1}.</span>
                  <span className="min-w-0 flex-1">{t.text}</span>
                  <ArrowRight size={15} className="no-print mt-0.5 shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* 1. 이달 요약 */}
      <Card className="print-card" data-testid="report-month-summary">
        <CardHeader title="1. 이달 요약" sub={base ? `만 원 단위 · ${baseLabel} 숫자와 지금이 다르면 같이 보입니다` : "만 원 단위 · 부가세 별도"} />
        <div className="grid grid-cols-2 gap-2.5 px-5 @min-[900px]:grid-cols-3">
          <Tile label="이달 기성" value={r.totals.billed} base={base?.totals.billed} baseLabel={baseLabel} testId="rm-billed" />
          <Tile label="이달 입금" value={r.totals.received} base={base?.totals.received} baseLabel={baseLabel} testId="rm-received" />
          <Tile label={running ? "오늘 미수" : "월말 미수"} value={r.totals.outstandingAtEnd} base={base?.totals.outstandingAtEnd} baseLabel={baseLabel} testId="rm-outstanding" />
          <Tile label="이달 원가" value={r.totals.costTotal} base={base?.totals.costTotal} baseLabel={baseLabel} sub={r.totals.pending ? `확인 대기 ${man(r.totals.pending)} 별도` : undefined} testId="rm-cost" />
          <Tile label="이달 예상이익 변화" value={profitNet} base={baseProfitNet} baseLabel={baseLabel} signedValue sub="아래 3번을 더한 값" testId="rm-profit" />
          <Tile label="이달 승인 변경공사" value={r.totals.changeApproved} testId="rm-change" />
        </div>
        <p className="num px-5 pt-2 text-[0.8rem] text-ink-2" data-testid="rm-outstanding-why">
          {running ? "오늘 미수" : "월말 미수"} = 지난달 말 미수 {man(prevOut)} + 이달 기성 {man(r.totals.billed)} − 이달 입금 {man(r.totals.received)}
          {r.totals.deducted ? ` − 이달 발주처 공제 ${man(r.totals.deducted)}` : ""}
          {r.totals.retentionAtEnd ? ` · 그중 유보금 ${man(r.totals.retentionAtEnd)} (나중에 받을 돈)` : ""}
          {!running && !zero(nowOut - r.totals.outstandingAtEnd) ? ` · 지금 미수는 ${man(nowOut)} (그 뒤 기성·입금·공제 반영)` : ""}
        </p>
        <ul className="space-y-1.5 px-5 py-4" data-testid="report-month-bullets">
          {bullets.map((b, i) => (
            <li key={i} className={cx("flex gap-2 rounded-lg px-3 py-2 text-[0.86rem]", { err: "bg-err-bg", ok: "bg-ok-bg", warn: "bg-warn-bg", info: "bg-info-bg" }[b.tone])}>
              <span aria-hidden>•</span>
              <span className="text-ink">{b.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 2. 현장별 */}
      <Card data-testid="report-month-sites">
        <CardHeader title="2. 현장별" sub={`이달 숫자 · 예상이익은 ${running ? "오늘" : "월말"} → 지금 · 노무는 입력 − 출력 기준 추정`} />
        {r.money.length ? (
          <>
            {/* 휴대폰 — 현장마다 카드 (넓은 표가 가로로 넘어가 이익 변화가 안 보이던 문제 · D-83 점검) */}
            <ul className="divide-y divide-line border-t border-line sm:hidden" data-testid="rm-site-cards">
              {r.money.map((m) => {
                const row = rows.get(m.site.id)!;
                return (
                  <li key={m.site.id} className="space-y-1 px-5 py-3 text-[0.86rem]">
                    <p className="flex items-baseline justify-between gap-2 font-bold">
                      <span>
                        {m.site.shortName}
                        {m.site.status === "completed" && <span className="ml-1 text-[0.74rem] font-normal text-ink-3">준공</span>}
                      </span>
                      <span className={cx("num whitespace-nowrap", row.net < 0 ? "text-err" : row.net > 0 ? "text-ok" : "text-ink-3")}>이익 {signed(row.net)}</span>
                    </p>
                    <p className="num text-ink-2">
                      기성 {zero(m.billed) ? "—" : man(m.billed)} · 입금 {zero(m.received) ? "—" : man(m.received)} · 미수 {man(m.outstandingAtEnd)} · 원가 {zero(m.costTotal) ? "—" : man(m.costTotal)}
                    </p>
                    <p className="num text-[0.8rem] text-ink-3">
                      예상이익 {man(row.endProfit)}
                      {!zero(row.endProfit - row.f.expectedProfit) && ` → 지금 ${man(row.f.expectedProfit)}`} ({fmtPct(row.f.marginPct)}){row.labor !== null ? ` · 노무 ${signed(row.labor)}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div tabIndex={0} role="region" aria-label="현장별 표 (가로 스크롤)" className="hidden overflow-x-auto border-t border-line sm:block">
              <table className="w-full min-w-[56rem] text-[0.84rem]">
                <thead>
                  <tr className="text-left text-[0.74rem] text-ink-3">
                    {["현장", "이달 기성", "이달 입금", running ? "오늘 미수" : "월말 미수", "이달 원가", "이달 이익 변화", `예상이익 ${running ? "오늘" : "월말"} → 지금`, "노무 (입력 − 추정)"].map((h, i) => (
                      <th key={h} className={cx("whitespace-nowrap px-3 py-2 font-semibold first:pl-5", i > 0 && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="num">
                  {r.money.map((m) => {
                    const row = rows.get(m.site.id)!;
                    const l = r.labor.find((x) => x.site.id === m.site.id);
                    return (
                      <tr key={m.site.id} className="border-t border-line" data-testid="rm-site-row" data-site={m.site.id}>
                        <td className="whitespace-nowrap px-3 py-2.5 pl-5 font-sans font-bold">
                          {m.site.shortName}
                          {m.site.status === "completed" && <span className="ml-1 text-[0.72rem] font-normal text-ink-3">준공</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">{zero(m.billed) ? "—" : man(m.billed)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">{zero(m.received) ? "—" : man(m.received)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">{man(m.outstandingAtEnd)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">{zero(m.costTotal) ? "—" : man(m.costTotal)}</td>
                        <td className={cx("whitespace-nowrap px-3 py-2.5 text-right font-semibold", row.net < 0 ? "text-err" : row.net > 0 ? "text-ok" : "text-ink-3")}>{signed(row.net)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {man(row.endProfit)}
                          {!zero(row.endProfit - row.f.expectedProfit) && <span className="text-ink-3"> → {man(row.f.expectedProfit)}</span>}
                          <span className="block text-[0.74rem] text-ink-3">지금 이익률 {fmtPct(row.f.marginPct)}</span>
                        </td>
                        <td className={cx("whitespace-nowrap px-3 py-2.5 text-right", l && r.ended && laborShort(l) && !l.settled && "font-semibold text-warn")}>
                          {row.labor !== null ? signed(row.labor) : "—"}
                          {l?.settled && <span className="block text-[0.72rem] text-ink-3">정산함</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState title="이 달에 일한 현장이 없습니다" />
        )}
      </Card>

      {/* 3. 이달 예상이익을 바꾼 일 */}
      <Card data-testid="report-month-events">
        <CardHeader title="3. 이달 예상이익을 바꾼 일" sub="손익에 들어온 날 기준 · 더하면 이달 예상이익 변화 · 계획 안 집행은 이익을 바꾸지 않아 빠집니다 · 이 달 날짜 원가라도 늦게 들어오면 들어온 달에 잡힙니다" />
        {events.length ? (
          <ul className="divide-y divide-line border-t border-line text-[0.86rem]">
            {events.map((e, i) => {
              const co = e.entryId ? claimedBy.get(e.entryId) : undefined;
              const rej = e.entryId && !co ? rejectedBy.get(e.entryId) : undefined;
              const entry = e.entryId && !co && !rej ? db.costEntries.find((x) => x.id === e.entryId) : undefined;
              const extra = !!entry && entry.forecastImpact === "additional";
              const canClaim = extra && !entry!.noClaim && CLAIMABLE_REASONS.has(entry!.reason);
              return (
                <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5" data-testid="rm-event">
                  <span className="num shrink-0 text-ink-3 sm:w-12">{md(e.date)}</span>
                  <span className="shrink-0 font-semibold sm:w-20">{e.site}</span>
                  <b className={cx("num ml-auto shrink-0 whitespace-nowrap sm:order-last", e.amount < 0 ? "text-err" : "text-ok")}>{signed(e.amount)}</b>
                  <span className="basis-full text-ink-2 sm:min-w-0 sm:flex-1 sm:basis-auto">
                    {e.text}
                    {co && (
                      <Link href={`/finance#co-${co.id}`} className="mt-0.5 block text-[0.8rem] font-semibold text-theme-ink" data-testid="rm-event-co">
                        {co.status === "approved"
                          ? `→ 변경공사 승인 ${man(co.approvedAmount ?? co.amount)}`
                          : `→ 변경공사 ${man(co.amount)} ${coStageText(co, today)}${co.nextFollowUp ? ` · 다음 확인 ${md(co.nextFollowUp)}` : ""} — 승인되면 이익에 더해집니다`}
                      </Link>
                    )}
                    {rej && (
                      <Link href={`/finance#co-${rej.id}`} className="mt-0.5 block text-[0.8rem] font-semibold text-err" data-testid="rm-event-co">
                        → 변경공사 반려{rej.decisionNote ? ` (${rej.decisionNote})` : ""} — 다시 청구할지 정하기
                      </Link>
                    )}
                    {canClaim && (
                      <Link href="/finance#co-unclaimed" className="mt-0.5 block text-[0.8rem] font-semibold text-warn" data-testid="rm-event-co">
                        → 변경공사로 청구 안 함 — 청구할지 정하기
                      </Link>
                    )}
                    {extra && entry!.noClaim && (
                      <span className="mt-0.5 block text-[0.8rem] text-ink-3" data-testid="rm-event-co">
                        → 청구 안 하기로 함: {entry!.noClaim.note}
                      </span>
                    )}
                    {extra && !entry!.noClaim && !CLAIMABLE_REASONS.has(entry!.reason) && (
                      <Link href="/finance#co-unclaimed" className="mt-0.5 block text-[0.8rem] text-ink-3" data-testid="rm-event-co">
                        → 변경공사 청구 안 함 ({REASON_LABEL[entry!.reason]} — 발주처 때문이면 청구할 수 있음)
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
            <li className="flex justify-between px-5 py-2.5 font-bold">
              <span>합계</span>
              <span className="num">{signed(profitNet)}</span>
            </li>
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-4 text-[0.86rem] text-ink-3">이 달에 예상이익을 바꾼 일이 없습니다.</p>
        )}
      </Card>

      {/* 4. 원가 항목별 */}
      <Card className="print-card" data-testid="report-month-costs">
        <CardHeader title="4. 이달 원가 항목별" sub="공무 확인까지 끝난 원가 · 발생일 기준" right={<Link href={`/close?month=${month}`} className="no-print text-[0.8rem] font-bold text-theme-ink">원가 CSV는 월 마감에서</Link>} />
        {costByCat.length ? (
          <ul className="flex flex-wrap border-t border-line">
            {costByCat.map(({ c, v }) => (
              <li key={c} className="min-w-[9rem] flex-1 border-b border-r border-line px-4 py-3 last:border-r-0">
                <span className="block text-[0.76rem] text-ink-3">{CATEGORY_LABEL[c]}</span>
                <b className="num whitespace-nowrap">{man(v)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-4 text-[0.86rem] text-ink-3">이 달 원가가 없습니다.</p>
        )}
      </Card>

      {/* 5. 남은 일 */}
      <Card data-testid="report-month-items">
        <CardHeader title={rec ? `5. 남은 일 ${r.items.length}건` : `5. 닫기 전에 볼 것 ${r.items.length}건`} sub="공무가 처리할 일 · 누르면 그 화면으로" />
        {r.items.length ? (
          <ul className="divide-y divide-line border-t border-line text-[0.84rem] text-ink-2">
            {r.items.slice(0, 10).map((it, i) => (
              <li key={i}>
                <Link href={it.href} className="row-hover block px-5 py-2">
                  {it.text}
                </Link>
              </li>
            ))}
            {r.items.length > 10 && <li className="px-5 py-2">… 외 {r.items.length - 10}건 (월 마감)</li>}
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-4 text-[0.86rem] text-ink-3">남은 일이 없습니다.</p>
        )}
      </Card>
    </PageBody>
  );
}

/** 현장 한 줄 — 이달 이익 변화, 월말(또는 오늘) 예상이익 = 지금 − 그 뒤에 이익을 바꾼 일, 노무 차이 */
function siteRow(db: DemoDB, r: MonthCloseReport, siteId: string, today: string) {
  const f = siteFinancials(db, siteId);
  const net = r.profit.find((x) => x.site.id === siteId)?.net ?? 0;
  const after = r.to < today ? profitEvents(db, siteId, nextDay(r.to), today).reduce((a, e) => a + e.amount, 0) : 0;
  const l = r.labor.find((x) => x.site.id === siteId);
  return { f, net, endProfit: f.expectedProfit - after, labor: l && (l.estimate || l.compared) ? l.compared - l.estimate : null };
}

function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

function Tile({ label, value, base, baseLabel = "마감 때", sub, signedValue, testId }: { label: string; value: number; base?: number; baseLabel?: string; sub?: ReactNode; signedValue?: boolean; testId?: string }) {
  const changed = base !== undefined && !zero(base - value);
  return (
    <div className="rounded-xl border border-line px-3.5 py-3" data-testid={testId}>
      <p className="text-[0.76rem] font-semibold text-ink-3">{label}</p>
      <p className={cx("num whitespace-nowrap text-[1.15rem] font-extrabold", signedValue && (value < 0 ? "text-err" : value > 0 ? "text-ok" : ""))}>{signedValue ? signed(value) : man(value)}</p>
      {changed && (
        <p className="num text-[0.76rem] font-semibold text-warn">
          {baseLabel} {signedValue ? signed(base!) : man(base!)} · 지금 {signed(value - base!)}
        </p>
      )}
      {sub && <p className="text-[0.74rem] text-ink-3">{sub}</p>}
    </div>
  );
}
