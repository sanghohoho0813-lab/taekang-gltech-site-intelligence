"use client";

/**
 * 대표 보고서 — 달별 보기 (D-83 · D-82 대표 점검 ‘대표 보고서 달별 보기·마감 상태’).
 * 숫자는 월 마감과 같은 계산(monthClose)과 같은 마감 기록(closeRecord)을 그대로 쓴다 — 화면마다 숫자가 달라지지 않게.
 * 금액은 만 원 단위로 (작은 달 숫자가 ‘0.36억’처럼 뭉개지던 문제 · D-82 대표 점검).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CircleCheck, Lock, Printer } from "lucide-react";
import { userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, cx, inputCls } from "@/components/ui/primitives";
import { Clock } from "@/components/shell/Clock";
import type { DemoDB } from "@/lib/domain/types";
import { monthClose } from "@/lib/domain/monthClose";
import { changesAfterClose, currentClose } from "@/lib/domain/closeRecord";
import { siteFinancials } from "@/lib/domain/calc";
import { CATEGORY_LABEL, COST_CATEGORIES } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtMan, fmtPct } from "@/lib/domain/format";
import { IS_LIVE } from "@/lib/mode";

const ml = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const signed = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}${fmtMan(Math.abs(v))}`);

export function MonthlyReport({ db, month, months, today, onMonth }: { db: DemoDB; month: string; months: string[]; today: string; onMonth: (m: string) => void }) {
  const r = monthClose(db, month, today);
  const rec = currentClose(db, month);
  const ch = rec ? changesAfterClose(db, rec, today) : null;
  const base = rec ? (rec.confirmSnapshot ?? rec.snapshot) : null;
  const baseLabel = rec?.confirmSnapshot ? "대표 확인 때" : "마감 때";
  const profitNet = r.profit.reduce((a, p) => a + p.net, 0);
  const events = r.profit.flatMap((p) => p.events.map((e) => ({ ...e, site: p.site.shortName }))).sort((a, b) => a.date.localeCompare(b.date));
  const costByCat = COST_CATEGORIES.map((c) => ({ c, v: r.money.reduce((a, m) => a + m.cost[c], 0) })).filter((x) => x.v);
  const laborShort = r.labor.filter((l) => l.shortfall >= 500_000 && !l.settled);

  // 핵심 요약 — 데이터에서 자동 생성 (사람이 지어낸 문장 아님)
  const bullets: { tone: "err" | "ok" | "warn" | "info"; text: string }[] = [];
  for (const p of r.profit.filter((x) => x.net !== 0)) bullets.push({ tone: p.net < 0 ? "err" : "ok", text: `${p.site.shortName} 이달 예상이익 ${signed(p.net)} — ${p.events.map((e) => e.text.split(" — ")[0]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(" · ")}` });
  for (const l of laborShort) bullets.push({ tone: "warn", text: `${l.site.shortName} 노무 — 출력 기준 추정보다 입력이 ${fmtMan(l.shortfall)} 적고 아직 정산 전` });
  if (r.late.n && !rec) bullets.push({ tone: "info", text: `달이 끝난 뒤에 넣거나 확인한 ${Number(month.slice(5))}월 원가 ${r.late.n}건(${fmtMan(r.late.amount)}) 포함` });
  if (ch?.count) bullets.push({ tone: "warn", text: `${ch.basis === "confirm" ? "대표 확인" : "마감"} 뒤 바뀐 것 ${ch.count}건 — 월 마감에서 확인` });
  if (r.items.length) bullets.push({ tone: "info", text: `${rec ? "남은 일" : "닫기 전에 볼 것"} ${r.items.length}건 (${r.items.slice(0, 2).map((i) => i.text.split(" — ")[0]).join(" / ")}${r.items.length > 2 ? " …" : ""})` });
  if (!bullets.length) bullets.push({ tone: "info", text: "이달 예상이익을 바꾼 일과 남은 일이 없습니다." });

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
              <select className={cx(inputCls, "h-10 w-auto py-1")} value={month} onChange={(e) => onMonth(e.target.value)} data-testid="report-month">
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

      {/* 마감 상태 */}
      <Card data-testid="report-month-close" data-state={rec ? (rec.confirmedAt ? "confirmed" : "closed") : r.ended ? "open" : "running"}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5 text-[0.88rem]">
          {rec ? (
            <>
              <Lock size={16} aria-hidden />
              <span className="font-semibold">
                {Number(month.slice(5))}월 마감 {fmtDateTime(rec.closedAt)} {userLabel(db, rec.closedBy)}
              </span>
              {rec.confirmedAt ? (
                <Badge tone={ch?.count ? "warn" : "ok"} icon={ch?.count ? undefined : <CircleCheck size={13} />}>
                  대표 확인 {fmtDateTime(rec.confirmedAt)}
                  {ch?.count ? ` · 확인 뒤 바뀜 ${ch.count}건` : ""}
                </Badge>
              ) : (
                <Badge tone="warn">대표 확인 대기{ch?.count ? ` · 마감 뒤 바뀜 ${ch.count}건` : ""}</Badge>
              )}
            </>
          ) : r.ended ? (
            <span className="font-semibold text-warn">아직 마감하지 않은 달입니다 — 숫자가 바뀔 수 있습니다</span>
          ) : (
            <span className="font-semibold text-ink-2">진행 중인 달 — {fmtDate(r.from)}부터 오늘({fmtDate(r.to)})까지</span>
          )}
          <Link href={`/close?month=${month}`} className="no-print ml-auto inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.82rem] font-bold text-theme-ink hover:bg-active-soft">
            월 마감에서 보기 <ArrowRight size={15} />
          </Link>
        </div>
      </Card>

      {/* 1. 이달 요약 */}
      <Card className="print-card" data-testid="report-month-summary">
        <CardHeader title="1. 이달 요약" sub={base ? `${rec?.confirmSnapshot ? "대표가 확인한" : "마감 때"} 숫자와 지금이 다르면 같이 보입니다` : "만 원 단위 · 부가세 별도"} />
        <div className="grid grid-cols-2 gap-2.5 px-5 @min-[900px]:grid-cols-3">
          <Tile label="이달 기성" value={r.totals.billed} base={base?.totals.billed} baseLabel={baseLabel} testId="rm-billed" />
          <Tile label="이달 입금" value={r.totals.received} base={base?.totals.received} baseLabel={baseLabel} testId="rm-received" />
          <Tile label="월말 미수" value={r.totals.outstandingAtEnd} base={base?.totals.outstandingAtEnd} baseLabel={baseLabel} testId="rm-outstanding" />
          <Tile label="이달 원가" value={r.totals.costTotal} base={base?.totals.costTotal} baseLabel={baseLabel} sub={r.totals.pending ? `확인 대기 ${fmtMan(r.totals.pending)} 별도` : undefined} testId="rm-cost" />
          <Tile label="이달 예상이익 변화" value={profitNet} signedValue sub="아래 ‘이익을 바꾼 일’을 더한 값" testId="rm-profit" />
          <Tile label="이달 승인 변경공사" value={r.totals.changeApproved} testId="rm-change" />
        </div>
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
      <Card className="print-card" data-testid="report-month-sites">
        <CardHeader title="2. 현장별" sub="이달 숫자 · 예상이익은 지금 기준 (현장 등록 시점 계획 대비)" />
        {r.money.length ? (
          <div tabIndex={0} role="region" aria-label="현장별 표 (가로 스크롤)" className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[52rem] text-[0.84rem]">
              <thead>
                <tr className="text-left text-[0.74rem] text-ink-3">
                  {["현장", "이달 기성", "이달 입금", "월말 미수", "이달 원가", "이달 이익 변화", "지금 예상이익 (이익률)", "노무 (입력 − 추정)"].map((h, i) => (
                    <th key={h} className={cx("px-3 py-2 font-semibold first:pl-5", i > 0 && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="num">
                {r.money.map((m) => {
                  const p = r.profit.find((x) => x.site.id === m.site.id);
                  const l = r.labor.find((x) => x.site.id === m.site.id);
                  const f = siteFinancials(db, m.site.id);
                  return (
                    <tr key={m.site.id} className="border-t border-line" data-testid="rm-site-row" data-site={m.site.id}>
                      <td className="px-3 py-2.5 pl-5 font-sans font-bold">
                        {m.site.shortName}
                        {m.site.status === "completed" && <span className="ml-1 text-[0.72rem] font-normal text-ink-3">준공</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">{m.billed ? fmtMan(m.billed) : "—"}</td>
                      <td className="px-3 py-2.5 text-right">{m.received ? fmtMan(m.received) : "—"}</td>
                      <td className="px-3 py-2.5 text-right">{fmtMan(m.outstandingAtEnd)}</td>
                      <td className="px-3 py-2.5 text-right">{fmtMan(m.costTotal)}</td>
                      <td className={cx("px-3 py-2.5 text-right font-semibold", (p?.net ?? 0) < 0 ? "text-err" : (p?.net ?? 0) > 0 ? "text-ok" : "text-ink-3")}>{signed(p?.net ?? 0)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {fmtMan(f.expectedProfit)} <span className="text-[0.76rem] text-ink-3">({fmtPct(f.marginPct)})</span>
                      </td>
                      <td className={cx("px-3 py-2.5 text-right", l && l.compared - l.estimate <= -500_000 && !l.settled && "font-semibold text-warn")}>
                        {l ? (l.estimate || l.compared ? signed(l.compared - l.estimate) : "—") : "—"}
                        {l?.settled && <span className="block text-[0.72rem] text-ink-3">정산함</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="이 달에 일한 현장이 없습니다" />
        )}
      </Card>

      {/* 3. 이달 예상이익을 바꾼 일 */}
      <Card className="print-card" data-testid="report-month-events">
        <CardHeader title="3. 이달 예상이익을 바꾼 일" sub="손익에 들어온 날 기준 · 더하면 이달 예상이익 변화 · 계획 안 집행(잔여예상 안)은 이익을 바꾸지 않아 빠집니다" />
        {events.length ? (
          <ul className="divide-y divide-line border-t border-line text-[0.86rem]">
            {events.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5">
                <span className="num w-12 shrink-0 text-ink-3">{`${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))}`}</span>
                <span className="w-20 shrink-0 font-semibold">{e.site}</span>
                <span className="min-w-0 flex-1 text-ink-2">{e.text}</span>
                <b className={cx("num shrink-0", e.amount < 0 ? "text-err" : "text-ok")}>{signed(e.amount)}</b>
              </li>
            ))}
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
        <CardHeader title="4. 이달 원가 항목별" sub="공무 확인까지 끝난 원가 · 발생일 기준" right={<Link href={`/close?month=${month}`} className="no-print text-[0.8rem] font-bold text-theme-ink">이달 원가 CSV는 월 마감에서</Link>} />
        {costByCat.length ? (
          <ul className="flex flex-wrap border-t border-line">
            {costByCat.map(({ c, v }) => (
              <li key={c} className="min-w-[9rem] flex-1 border-b border-r border-line px-4 py-3 last:border-r-0">
                <span className="block text-[0.76rem] text-ink-3">{CATEGORY_LABEL[c]}</span>
                <b className="num">{fmtMan(v)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-4 text-[0.86rem] text-ink-3">이 달 원가가 없습니다.</p>
        )}
      </Card>

      {/* 5. 남은 일 */}
      <Card className="print-card" data-testid="report-month-items">
        <CardHeader title={rec ? `5. 남은 일 ${r.items.length}건` : `5. 닫기 전에 볼 것 ${r.items.length}건`} sub={rec?.note ? `마감 메모: ${rec.note}` : undefined} />
        {r.items.length ? (
          <ul className="space-y-1 border-t border-line px-5 py-3 text-[0.84rem] text-ink-2">
            {r.items.slice(0, 8).map((it, i) => (
              <li key={i}>• {it.text}</li>
            ))}
            {r.items.length > 8 && <li>… 외 {r.items.length - 8}건 (월 마감)</li>}
          </ul>
        ) : (
          <p className="border-t border-line px-5 py-4 text-[0.86rem] text-ink-3">남은 일이 없습니다.</p>
        )}
      </Card>
    </PageBody>
  );
}

function Tile({ label, value, base, baseLabel = "마감 때", sub, signedValue, testId }: { label: string; value: number; base?: number; baseLabel?: string; sub?: ReactNode; signedValue?: boolean; testId?: string }) {
  return (
    <div className="rounded-xl border border-line px-3.5 py-3" data-testid={testId}>
      <p className="text-[0.76rem] font-semibold text-ink-3">{label}</p>
      <p className={cx("num text-[1.15rem] font-extrabold", signedValue && (value < 0 ? "text-err" : value > 0 ? "text-ok" : ""))}>{signedValue ? signed(value) : fmtMan(value)}</p>
      {base !== undefined && base !== value && (
        <p className="num text-[0.76rem] font-semibold text-warn">
          {baseLabel} {fmtMan(base)} → 지금 ({signed(value - base)})
        </p>
      )}
      {sub && <p className="text-[0.74rem] text-ink-3">{sub}</p>}
    </div>
  );
}
