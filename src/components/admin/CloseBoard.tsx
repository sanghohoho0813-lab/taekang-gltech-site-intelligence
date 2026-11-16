"use client";

/**
 * 월 마감 (D-78 첫 달 리허설) — 공무가 한 달을 닫고, 대표가 그 달을 한 장으로 보는 화면.
 * 리허설에서 10월 마감에 75~100분과 엑셀이 들던 일(현장별 이달 원가·이달 기성·노무 추정·퇴근 누락 날짜·남은 일)을 한곳에 모았다.
 * 숫자는 다른 화면과 같은 계산을 그대로 쓴다 (monthClose).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, Download, Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Notice, PageSkeleton, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { LABOR_GAP_WON, laborShort, monthClose, monthCostRows, previousMonth, type CloseItem, type CloseItemKind, type CloseLabor } from "@/lib/domain/monthClose";
import { fmtDate, fmtMan, todayIso } from "@/lib/domain/format";
import { CATEGORY_LABEL, COST_CATEGORIES } from "@/lib/domain/labels";
import { toCsv } from "@/lib/domain/csv";
import { siteFinancials } from "@/lib/domain/calc";
import type { DemoDB } from "@/lib/domain/types";
import { uid } from "@/lib/domain/ids";
import { downloadCsv } from "@/lib/browser/download";
import { ForecastModal } from "./SitesAdmin";
import { OverlapFixModal } from "./OverlapFix";
import { MoneyField, toWon, wonText } from "./inputs";

const ITEM_LABEL: Record<CloseItemKind, string> = {
  cost: "원가",
  report: "보고",
  noreport: "보고 없음",
  checkout: "퇴근",
  overlap: "근무시간",
  fix: "근태",
  order: "작업지시",
  request: "고객 요청",
  change: "변경공사",
  settle: "준공 원가",
  completion: "준공일",
  labor: "노무",
};
const short = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const won = (v: number) => (v === 0 ? "—" : fmtMan(v, { unit: false }));
const signed = (v: number) => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}${fmtMan(Math.abs(v))}`);

export function CloseBoard() {
  const { db } = useMe();
  const today = todayIso();
  const months = useMemo(() => {
    if (!db?.sites.length) return [today.slice(0, 7)];
    const first = db.sites.map((s) => s.startDate).sort()[0].slice(0, 7);
    const out: string[] = [];
    for (let m = today.slice(0, 7); m >= first && out.length < 24; m = previousMonth(`${m}-01`)) out.push(m);
    return out;
  }, [db, today]);
  const [month, setMonth] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("month");
    if (q && /^\d{4}-\d{2}$/.test(q)) setMonth(q);
  }, []);
  const chosen = month || (months.includes(previousMonth(today)) ? previousMonth(today) : months[0]);
  const r = useMemo(() => (db ? monthClose(db, chosen, today) : null), [db, chosen, today]);
  const [settling, setSettling] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [overlapUser, setOverlapUser] = useState<string | null>(null);
  if (!db || !r) return <PageSkeleton />;
  const label = `${chosen.slice(0, 4)}년 ${Number(chosen.slice(5))}월`;
  const settleRow = settling ? r.labor.find((l) => l.site.id === settling) : undefined;
  const closeSite = closing ? db.sites.find((x) => x.id === closing) : undefined;
  const openAction = (a: NonNullable<CloseItem["action"]>) => (a.kind === "settleLabor" ? setSettling(a.siteId ?? null) : a.kind === "closeout" ? setClosing(a.siteId ?? null) : setOverlapUser(a.userId ?? null));

  return (
    <PageBody className="print-full">
      <PageHeader
        title={`월 마감 · ${label}`}
        desc="한 달을 닫기 전에 — 이달 기성·입금·원가·노무·출퇴근을 한 장에 모으고, 닫기 전에 볼 것을 맨 위에 둡니다. 숫자는 기성·수금, 투입·인건비, 출퇴근 현황과 같은 계산입니다."
        right={
          <div className="no-print flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[0.84rem] font-semibold text-ink-2">
              달
              <select className={cx(inputCls, "h-10 w-auto py-1")} value={chosen} onChange={(e) => setMonth(e.target.value)} data-testid="close-month">
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m.slice(0, 4)}년 {Number(m.slice(5))}월{m === today.slice(0, 7) ? " (진행 중)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Button icon={<Download size={17} />} onClick={() => downloadCsv(`월마감_원가_${chosen}.csv`, toCsv(monthCostRows(db, chosen, today)))} data-testid="close-csv">
              이달 원가 CSV
            </Button>
            <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="close-print">
              인쇄·PDF
            </Button>
          </div>
        }
      />
      {!r.ended && (
        <Notice tone="info" className="no-print">
          이번 달은 아직 끝나지 않았습니다 — {fmtDate(r.from)}부터 오늘({fmtDate(r.to)})까지만 셉니다.
        </Notice>
      )}

      {/* 1. 닫기 전에 볼 것 */}
      <Card data-testid="close-items">
        <CardHeader
          title={r.items.length ? `닫기 전에 볼 것 ${r.items.length}건` : "닫기 전에 볼 것 없음"}
          sub={r.items.length ? "누르면 처리하는 화면으로 갑니다. 노무 정산·준공 원가 마감은 여기서 바로 할 수 있습니다. 처리하면 이 목록에서 빠집니다." : "이 달에 남은 확인·처리 거리가 없습니다."}
        />
        {r.items.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {r.items.map((it, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-4 sm:flex-nowrap" data-testid="close-item-row">
                <Link href={it.href} className="row-hover flex min-w-0 flex-1 basis-[18rem] items-start gap-3 px-5 py-3 text-[0.88rem]" data-testid="close-item" data-kind={it.kind}>
                  <Badge tone={it.kind === "settle" || it.kind === "overlap" || it.kind === "checkout" || it.kind === "labor" ? "warn" : "neutral"} className="mt-0.5 shrink-0">
                    {ITEM_LABEL[it.kind]}
                  </Badge>
                  <span className="min-w-0 flex-1 text-ink">{it.text}</span>
                  {!it.action && <ArrowRight size={16} className="no-print mt-0.5 shrink-0 text-ink-3" aria-hidden />}
                </Link>
                {it.action && (
                  <Button size="sm" variant="soft" className="no-print mb-3 ml-5 shrink-0 sm:my-0 sm:ml-0" onClick={() => openAction(it.action!)} data-testid={it.action.kind === "settleLabor" ? "close-settle-open" : it.action.kind === "closeout" ? "close-closeout-open" : "close-overlap-open"}>
                    {it.action.kind === "settleLabor" ? "차액 정산" : it.action.kind === "closeout" ? "원가 마감" : "겹침 정리"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-5 pb-4 text-[0.88rem] text-ok">
            <CircleCheck size={18} aria-hidden /> 이대로 닫아도 됩니다.
          </p>
        )}
      </Card>

      {/* 2. 금액 */}
      <Card data-testid="close-money">
        <CardHeader title={`${label} 금액`} sub="단위 만 원 · 부가세 별도 · 원가는 발생일 기준이며 공무 확인까지 끝난 것만 셉니다" />
        <div tabIndex={0} role="region" aria-label="이달 금액 표 (가로 스크롤)" className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[46rem] text-[0.84rem]">
            <thead>
              <tr className="text-left text-[0.74rem] text-ink-3">
                {["현장", "확정 기성", "입금", "월말 미수", "원가 (확정)", "확인 대기 원가", "승인 변경공사"].map((h, i) => (
                  <th key={h} className={cx("px-3 py-2 font-semibold first:pl-5", i > 0 && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {r.money.map((m) => (
                <tr key={m.site.id} className="border-t border-line" data-testid="close-money-row">
                  <td className="px-3 py-2.5 pl-5 font-bold">
                    {m.site.shortName}
                    {m.site.status === "completed" && <Badge className="ml-1.5">준공</Badge>}
                  </td>
                  <td className="px-3 py-2.5 text-right">{won(m.billed)}</td>
                  <td className="px-3 py-2.5 text-right">{won(m.received)}</td>
                  <td className={cx("px-3 py-2.5 text-right", m.outstandingAtEnd > 0 && "font-bold")}>{won(m.outstandingAtEnd)}</td>
                  <td className="px-3 py-2.5 text-right" title={COST_CATEGORIES.filter((c) => m.cost[c]).map((c) => `${CATEGORY_LABEL[c]} ${fmtMan(m.cost[c])}`).join(" · ")}>
                    {won(m.costTotal)}
                  </td>
                  <td className={cx("px-3 py-2.5 text-right", m.pending.n > 0 && "font-bold text-warn")}>{m.pending.n ? `${won(m.pending.amount)} (${m.pending.n}건)` : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{m.changeApproved ? `${m.changeApproved > 0 ? "+" : "−"}${won(Math.abs(m.changeApproved))}` : "—"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong font-bold" data-testid="close-money-total">
                <td className="px-3 py-2.5 pl-5">합계</td>
                <td className="px-3 py-2.5 text-right">{won(r.totals.billed)}</td>
                <td className="px-3 py-2.5 text-right">{won(r.totals.received)}</td>
                <td className="px-3 py-2.5 text-right">{won(r.totals.outstandingAtEnd)}</td>
                <td className="px-3 py-2.5 text-right">{won(r.totals.costTotal)}</td>
                <td className="px-3 py-2.5 text-right">{won(r.totals.pending)}</td>
                <td className="px-3 py-2.5 text-right">{r.totals.changeApproved ? `${r.totals.changeApproved > 0 ? "+" : "−"}${won(Math.abs(r.totals.changeApproved))}` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {r.late.n > 0 && (
          <p className="mx-5 mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[0.8rem] text-ink-2" data-testid="close-late">
            달이 끝난 뒤에 넣거나 확인한 {Number(chosen.slice(5))}월 날짜 원가 {r.late.n}건({fmtMan(r.late.amount)})이 포함돼 있습니다 — 그 전에 인쇄해 둔 마감본과 숫자가 다를 수 있습니다.
          </p>
        )}
        <p className="px-5 pt-2 pb-4 text-[0.76rem] text-ink-3">
          원가 항목별: {r.money.map((m) => `${m.site.shortName} ${COST_CATEGORIES.filter((c) => m.cost[c]).map((c) => `${CATEGORY_LABEL[c]} ${fmtMan(m.cost[c])}`).join(" · ") || "없음"}`).join(" / ")}
        </p>
      </Card>

      {/* 3. 이익 변화 이유 */}
      <Card data-testid="close-profit">
        <CardHeader title="이달 예상이익을 바꾼 일" sub="이 달에 손익에 들어온 날 기준 — 추가 원가, 잔여예상을 넘은 집행, 변경공사 승인·그 원가, 잔여예상 재추정·준공 원가 마감. 계획 안에서 잔여예상 안으로 쓴 돈은 이익을 바꾸지 않습니다. 더하면 이달 변화가 됩니다." />
        <ul className="divide-y divide-line border-t border-line">
          {r.profit.map((p) => (
            <li key={p.site.id} className="px-5 py-3" data-testid="close-profit-site">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[0.9rem]">
                <b>{p.site.shortName}</b>
                <span className={cx("num font-bold", p.net < 0 ? "text-err" : p.net > 0 ? "text-ok" : "text-ink-3")}>이달 {signed(p.net)}</span>
                <span className="text-[0.78rem] text-ink-3 num">
                  · 오늘 기준 예상이익 {fmtMan(p.expectedProfit)} (현장 등록 대비 {signed(p.sinceBaseline)})
                </span>
              </p>
              {p.events.length ? (
                <ul className="mt-1 space-y-0.5 text-[0.82rem] text-ink-2">
                  {p.events.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="num w-10 shrink-0 text-ink-3">{short(e.date)}</span>
                      <span className={cx("num w-24 shrink-0 text-right font-semibold", e.amount < 0 ? "text-err" : "text-ok")}>{signed(e.amount)}</span>
                      <span className="min-w-0">{e.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-0.5 text-[0.82rem] text-ink-3">이달에 예상이익을 바꾼 일이 없습니다.</p>
              )}
            </li>
          ))}
          {r.profit.length === 0 && <EmptyState title="이 달에 일한 현장이 없습니다" />}
        </ul>
      </Card>

      {/* 4. 노무 */}
      <Card data-testid="close-labor" id="close-labor" className="scroll-mt-24">
        <CardHeader
          title="노무 — 출력 인원 × 팀 단가 추정과 입력된 노무비"
          sub="추정은 확정 노무비·급여가 아닙니다. 입력이 모자라면 빠진 노무비를 넣거나 ‘차액 정산’으로 한 번에 맞추세요 (현장·달마다 한 번)."
          right={
            <Link href={`/labor?month=${chosen}`} className="no-print press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.8rem] font-bold text-theme-ink hover:bg-active-soft">
              투입·인건비 <ArrowRight size={15} />
            </Link>
          }
        />
        {r.labor.length ? (
          <div tabIndex={0} role="region" aria-label="노무 표 (가로 스크롤)" className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[44rem] text-[0.84rem]">
              <thead>
                <tr className="text-left text-[0.74rem] text-ink-3">
                  {["현장", "출력 인원일", "추정 인건비", "입력된 노무비", "차이", "정리"].map((h, i) => (
                    <th key={h} className={cx("px-3 py-2 font-semibold first:pl-5", i > 0 && i < 5 && "text-right", i === 5 && "no-print")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="num">
                {r.labor.map((l) => {
                  // 입력 = 노무비 + 외주 팀 몫 외주비 — 투입·인건비·정산 창·CSV와 같은 숫자 (D-80·D-81 점검)
                  const gap = l.compared - l.estimate;
                  return (
                    <tr key={l.site.id} className="border-t border-line" data-testid="close-labor-row" data-site={l.site.id}>
                      <td className="px-3 py-2.5 pl-5 font-bold">{l.site.shortName}</td>
                      <td className="px-3 py-2.5 text-right">{l.teams.reduce((a, t) => a + t.personDays, 0)}</td>
                      <td className="px-3 py-2.5 text-right">{won(l.estimate)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {won(l.compared)}
                        {l.actualPending > 0 && <span className="block text-[0.72rem] font-semibold text-warn">확인 대기 {fmtMan(l.actualPending)}</span>}
                      </td>
                      <td className={cx("px-3 py-2.5 text-right font-semibold", Math.abs(gap) > Math.max(1_000_000, l.estimate * 0.2) && "text-warn")}>
                        {signed(gap)}
                        {l.subcontractCovered > 0 && <span className="block text-[0.72rem] font-medium text-ink-3">외주비 {fmtMan(l.subcontractCovered)} 포함</span>}
                      </td>
                      <td className="no-print px-3 py-2 font-sans">
                        {l.settled ? (
                          <span className="inline-flex flex-wrap items-center gap-1 text-[0.78rem] text-ink-2" data-testid="close-settled">
                            <Badge tone="ok">정산함</Badge> {fmtMan(l.settled.amount)} · {short(l.settled.date)}자{todayIso(new Date(l.settled.createdAt)) !== l.settled.date ? ` · ${short(todayIso(new Date(l.settled.createdAt)))} 입력` : ""}
                            {l.settled.settle?.teams?.length ? <span className="block w-full text-[0.74rem] text-ink-3" data-testid="close-settled-teams">{l.settled.settle.teams.map((t) => `${t.team} ${fmtMan(t.amount)}`).join(" · ")}</span> : null}
                            {l.teamLeft.length > 0 && (
                              <span className="block w-full text-[0.74rem] font-semibold text-warn" data-testid="close-team-left">
                                팀별로 남은 차이: {l.teamLeft.map((t) => `${t.team} ${fmtMan(t.amount)}`).join(" · ")}
                              </span>
                            )}
                          </span>
                        ) : l.canSettle ? (
                          <Button size="sm" variant="soft" onClick={() => setSettling(l.site.id)} data-testid="close-settle-row">
                            차액 정산
                          </Button>
                        ) : !r.ended && laborShort(l) ? (
                          <span className="text-[0.78rem] text-ink-3">달이 끝나면 정산</span>
                        ) : (
                          <span className="text-[0.78rem] text-ink-3">—</span>
                        )}
                        {l.reShort > 0 && <span className="mt-1 block text-[0.74rem] font-semibold text-warn">정산 뒤 다시 {fmtMan(l.reShort)} 모자람</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="이 달 작업 인원(출력) 기록이 없습니다" />
        )}
      </Card>

      {/* 5. 출퇴근 */}
      <Card data-testid="close-people">
        <CardHeader
          title="출퇴근 — 사람별"
          sub="급여·공수 정산 근거. 문제 있는 날짜를 함께 적었습니다 — 정정한 뒤 다시 보면 빠집니다."
          right={
            <Link href={`/attendance?date=${r.to}`} className="no-print press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.8rem] font-bold text-theme-ink hover:bg-active-soft">
              출퇴근 현황·CSV <ArrowRight size={15} />
            </Link>
          }
        />
        {r.people.length ? (
          <div tabIndex={0} role="region" aria-label="출퇴근 표 (가로 스크롤)" className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[48rem] text-[0.84rem]">
              <thead>
                <tr className="text-left text-[0.74rem] text-ink-3">
                  {["이름", "현장", "출근일수", "근무시간", "퇴근 누락", "현장 밖", "위치 없음", "시간 겹침", "정정"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.people.map((p) => (
                  <tr key={p.row.userId} className="border-t border-line align-top" data-testid="close-person">
                    <td className="px-3 py-2.5 pl-5 font-bold">{p.name}</td>
                    <td className="px-3 py-2.5 text-ink-2">{p.sites.join(" · ")}</td>
                    <td className="px-3 py-2.5 num">{p.row.days}일</td>
                    <td className="px-3 py-2.5 num">{(p.row.minutes / 60).toFixed(1)}h</td>
                    {[p.missedOut, p.outside, p.noLocation, p.overlap].map((ds, i) => (
                      <td key={i} className={cx("px-3 py-2.5 num", ds.length > 0 && "font-semibold text-warn")}>
                        {ds.length ? ds.map(short).join(" · ") : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 num">{p.row.corrected || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="이 달 출퇴근 기록이 없습니다" />
        )}
      </Card>

      {/* 6. 보낼 문서 */}
      <Card className="no-print" data-testid="close-docs">
        <CardHeader title="이달 문서" sub="발주처에 보낼 월간 보고서(금액 없음)·사진대장·주간 보고, 그리고 내부 대표 보고서" />
        <ul className="divide-y divide-line border-t border-line">
          {r.money.map((m) => (
            <li key={m.site.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[0.86rem]">
              <b className="mr-1">{m.site.shortName}</b>
              <Link href={`/partner/report?site=${m.site.id}&month=${chosen}`} className="press rounded-lg bg-surface-2 px-2.5 py-1.5 font-semibold text-theme-ink" data-testid="close-doc-monthly">
                발주처 월간 보고서
              </Link>
              <Link href={`/photos?site=${m.site.id}&month=${chosen}`} className="press rounded-lg bg-surface-2 px-2.5 py-1.5 font-semibold text-theme-ink" data-testid="close-doc-photos">
                사진대장 ({Number(chosen.slice(5))}월)
              </Link>
              <Link href={`/daily?site=${m.site.id}&view=week&date=${r.to}`} className="press rounded-lg bg-surface-2 px-2.5 py-1.5 font-semibold text-theme-ink">
                주간 보고
              </Link>
              {m.site.status === "completed" && (
                <Link href={`/sites/${m.site.id}/completion`} className="press rounded-lg bg-surface-2 px-2.5 py-1.5 font-semibold text-theme-ink">
                  준공 보고서
                </Link>
              )}
            </li>
          ))}
          <li className="px-5 py-3 text-[0.86rem]">
            <Link href="/report" className="press rounded-lg bg-surface-2 px-2.5 py-1.5 font-semibold text-theme-ink">
              대표 보고서 (현장 등록 이후 전체)
            </Link>
          </li>
        </ul>
      </Card>
      <p className="text-[0.75rem] text-ink-3">* 기준: {fmtDate(r.from)} ~ {fmtDate(r.to)} · 금액은 원 단위로 저장된 값을 만 원으로 줄여 보여 줍니다.</p>
      {settleRow && <LaborSettleModal db={db} row={settleRow} month={chosen} onClose={() => setSettling(null)} />}
      {closeSite && <ForecastModal db={db} site={closeSite} closeout onClose={() => setClosing(null)} />}
      {overlapUser && <OverlapFixModal db={db} from={r.from} to={r.to} userId={overlapUser} onClose={() => setOverlapUser(null)} />}
    </PageBody>
  );
}

/**
 * 노무 차액 정산 (D-79) — 출력 인원 × 팀 단가 추정과 그 달 입력된 노무비의 차이를 한 건으로 넣는다.
 * 본사 입력이라 바로 원가에 반영된다. 실제 지급액을 알면 그 금액으로 고쳐 넣는다.
 */
function LaborSettleModal({ db, row, month, onClose }: { db: DemoDB; row: CloseLabor; month: string; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(() => wonText(row.suggested));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key] = useState(() => uid("idem"));
  // 팀별로 나눠 넣기 (D-81) — 팀마다 기본값은 ‘추정 − 그 팀 입력 − 팀 미지정분 나눈 몫’
  const hasPlan = row.teamPlan.length > 0;
  const [byTeam, setByTeam] = useState(hasPlan);
  const [teamAmt, setTeamAmt] = useState<Record<string, string>>(() => Object.fromEntries(row.teamPlan.map((t) => [t.team, t.suggest > 0 ? wonText(t.suggest) : ""])));
  const teamWon = row.teamPlan.map((t) => {
    const v = (teamAmt[t.team] ?? "").trim() ? toWon(teamAmt[t.team]) : 0;
    return { team: t.team, amount: v };
  });
  const teamBad = byTeam && teamWon.some((t) => !Number.isFinite(t.amount) || t.amount < 0);
  const teamSum = teamWon.reduce((a, t) => a + (Number.isFinite(t.amount) && t.amount > 0 ? t.amount : 0), 0);
  const n = byTeam ? (teamBad ? NaN : teamSum) : toWon(amount);
  // 기본값보다 50만 원 넘게 덜 넣는 팀 — 정산은 한 번뿐이라 미리 알린다 (D-81 점검)
  const under = byTeam && !teamBad ? row.teamPlan.map((t, i) => ({ team: t.team, left: t.suggest - teamWon[i].amount })).filter((t) => t.left >= LABOR_GAP_WON) : [];
  const m = Number(month.slice(5));
  // 예상이익에 주는 영향 — 노무 잔여예상 안이면 이익은 그대로, 넘으면 넘은 만큼 줄어든다
  const laborLeft = siteFinancials(db, row.site.id).categories.find((c) => c.category === "labor")?.remaining ?? 0;
  const put = Number.isFinite(n) && n > 0 ? n : 0;
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const teams = byTeam ? teamWon.filter((t) => t.amount > 0) : undefined;
      await run("settleLabor", { siteId: row.site.id, month, amount: Number.isFinite(n) ? n : 0, note, ...(teams?.length ? { teams } : {}), idempotencyKey: key });
      toast.push({ tone: "ok", title: `${row.site.shortName} ${m}월 노무 정산을 넣었습니다`, desc: `${fmtMan(Number.isFinite(n) ? n : 0)} · ${m}월 원가에 바로 반영` });
      onClose();
    } catch (e) {
      if (e instanceof CommandError) setErrors(e.fieldErrors);
      toast.push({ tone: "err", title: e instanceof Error ? e.message : "넣지 못했습니다" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`노무 차액 정산 · ${row.site.shortName} ${m}월`}
      description="출력(작업 인원) 기준 추정과 그 달 입력된 노무비의 차이를 한 건으로 넣습니다(팀별 금액은 그 건 안에 나눠 남음). 본사 입력이라 바로 원가에 반영되고, 같은 현장·같은 달에는 한 번만 넣을 수 있습니다."
      size="lg"
      testId="settle-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} disabled={!Number.isFinite(n) || n <= 0 || note.trim().length < 2} data-testid="settle-save">
            정산 넣기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[30rem] text-[0.84rem]">
            <thead>
              <tr className="text-left text-[0.74rem] text-ink-3">
                {["팀", "인원일 × 단가", "추정", "팀으로 입력", "차이"].map((h, i) => (
                  <th key={h} className={cx("px-3 py-2 font-semibold", i > 0 && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {row.teams.map((t) => (
                <tr key={t.team} className="border-t border-line" data-testid="settle-team-row">
                  <td className="px-3 py-2 font-sans">
                    {t.team} {!t.team.includes(t.kind === "subcontract" ? "외주" : "직영") && <span className="text-[0.72rem] text-ink-3">{t.kind === "subcontract" ? "외주" : "직영"}</span>}
                    {!t.rateSet && <span className="ml-1 text-[0.72rem] text-warn">(기본 일당)</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-2">
                    {t.personDays} × {fmtMan(t.dayRate)}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtMan(t.estimate)}</td>
                  <td className="px-3 py-2 text-right">{t.entered ? fmtMan(t.entered) : "—"}</td>
                  <td className={cx("px-3 py-2 text-right font-semibold", t.estimate - t.entered >= LABOR_GAP_WON && "text-warn")}>{t.entered >= t.estimate ? (t.entered === t.estimate ? "0" : `+${fmtMan(t.entered - t.estimate)}`) : `−${fmtMan(t.estimate - t.entered)}`}</td>
                </tr>
              ))}
              {row.untagged > 0 && (
                <tr className="border-t border-line text-ink-2" data-testid="settle-untagged">
                  <td className="px-3 py-2 font-sans" colSpan={3}>
                    팀 미지정 노무비 <span className="text-[0.72rem] text-ink-3">(팀마다 남은 차이 비율로 나눠 봄)</span>
                  </td>
                  <td className="px-3 py-2 text-right">{fmtMan(row.untagged)}</td>
                  <td />
                </tr>
              )}
              {row.otherTeams.map((o) => (
                <tr key={`${o.category}|${o.team}`} className="border-t border-line text-ink-2" data-testid="settle-other-team">
                  <td className="px-3 py-2 font-sans" colSpan={3}>
                    {o.team}{" "}
                    <span className="text-[0.72rem] text-warn">{o.category === "labor" ? "노무비 · 출력에 없는 팀 이름 (팀 미지정처럼 나눠 봄)" : "외주비 · 외주 팀이 아닌 이름 — 비교에 넣지 않음"}</span>
                  </td>
                  <td className={cx("px-3 py-2 text-right", o.category === "subcontract" && "text-ink-3 line-through")}>{fmtMan(o.amount)}</td>
                  <td />
                </tr>
              ))}
              {row.subCovered > 0 && (
                <tr className="border-t border-line text-ink-2">
                  <td className="px-3 py-2 font-sans" colSpan={3}>
                    팀 미지정 외주비 <span className="text-[0.72rem] text-ink-3">(외주 팀 몫으로 봄{row.subUntagged > row.subCovered ? ` · ${fmtMan(row.subUntagged)} 중` : ""})</span>
                  </td>
                  <td className="px-3 py-2 text-right">{fmtMan(row.subCovered)}</td>
                  <td />
                </tr>
              )}
              <tr className="border-t-2 border-line-strong font-bold">
                <td className="px-3 py-2 font-sans" colSpan={2}>
                  합계{row.actualPending > 0 ? <span className="ml-1 text-[0.72rem] font-normal text-ink-3">(확인 대기 {fmtMan(row.actualPending)} 포함)</span> : null}
                </td>
                <td className="px-3 py-2 text-right">{fmtMan(row.estimate)}</td>
                <td className="px-3 py-2 text-right" data-testid="settle-total-input">{fmtMan(row.compared)}</td>
                <td className={cx("px-3 py-2 text-right", row.shortfall > 0 && "text-warn")}>{row.shortfall > 0 ? `−${fmtMan(row.shortfall)}` : row.shortfall < 0 ? `+${fmtMan(-row.shortfall)}` : "0"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[0.78rem] text-ink-3">
          기간 {fmtDate(row.compareFrom)} ~ {fmtDate(row.to)} · 출력 기록을 쓰기 시작한 날부터 셉니다. 넣는 날짜는 {fmtDate(row.to)}입니다. 입력은 노무비와 외주 팀 몫 외주비를 더한 값입니다.
          {row.teams.some((t) => t.kind === "direct") && " 급여로 따로 나가는 직영 인원이 있으면 그 팀 금액에서 빼고 넣으세요."}
          {(row.untagged > 0 || row.subUntagged > 0 || row.otherTeams.length > 0) && " 팀이 없거나 이름이 맞지 않는 원가는 투입·인건비 화면의 ‘팀 붙이기’로 팀을 붙이면 팀별 차이가 정확해집니다."}
        </p>
        {put > 0 && (
          <p className={cx("rounded-lg px-3 py-2 text-[0.82rem]", put > laborLeft ? "bg-warn-bg text-ink" : "bg-surface-2 text-ink-2")} data-testid="settle-effect">
            {put > laborLeft
              ? `노무 잔여예상 ${fmtMan(laborLeft)}을 넘어 예상이익이 ${fmtMan(put - laborLeft)} 줄어듭니다.`
              : `예상이익 변화 없음 — 계획 안 집행이라 노무 잔여예상만 줄어듭니다 (${fmtMan(laborLeft)} → ${fmtMan(laborLeft - put)}).`}
          </p>
        )}
        {hasPlan && (
          <label className="flex items-center gap-2 text-[0.86rem] font-semibold">
            <input
              type="checkbox"
              className="size-5"
              checked={byTeam}
              onChange={(e) => {
                // 끌 때 지금 팀별 합계를 한 금액 칸으로 가져온다 (기본값으로 돌아가던 문제 · D-81 점검)
                if (!e.target.checked && !teamBad && teamSum > 0) setAmount(wonText(teamSum));
                setByTeam(e.target.checked);
              }}
              data-testid="settle-byteam"
            />
            팀별로 나눠 넣기
            <span className="font-normal text-ink-3">— 팀별 노무비가 원가 목록·CSV에 남습니다</span>
          </label>
        )}
        {byTeam ? (
          <div className="space-y-2" data-testid="settle-teams">
            {row.teamPlan.map((t) => (
              <div key={t.team} className="flex items-center gap-3">
                <label htmlFor={`settle-team-${t.team}`} className="min-w-0 flex-1 text-[0.86rem] font-semibold">
                  {t.team}
                  <span className="block text-[0.74rem] font-normal text-ink-3">
                    기본 {fmtMan(t.suggest)}
                    {t.share > 0 ? ` · 팀 미지정분 중 이 팀 몫으로 본 ${fmtMan(t.share)} 뺌` : ""}
                  </span>
                </label>
                <div className="w-40 shrink-0">
                  <input
                    id={`settle-team-${t.team}`}
                    inputMode="numeric"
                    className={cx(inputCls, "num text-right")}
                    value={teamAmt[t.team] ?? ""}
                    placeholder="0"
                    onChange={(e) => setTeamAmt({ ...teamAmt, [t.team]: e.target.value })}
                    data-testid="settle-team-amount"
                  />
                  {(teamAmt[t.team] ?? "").trim() && Number.isFinite(toWon(teamAmt[t.team])) && <span className="mt-0.5 block text-right text-[0.72rem] text-ink-3">= {fmtMan(toWon(teamAmt[t.team]))}</span>}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-line pt-2 text-[0.9rem] font-bold">
              <span>넣을 노무비 합계</span>
              <span className="num" data-testid="settle-team-sum">{teamBad ? "금액 확인" : fmtMan(teamSum)}</span>
            </div>
            {(errors.teams || errors.amount) && <p className="text-[0.8rem] text-err">{errors.teams || errors.amount}</p>}
            {row.planOver > 0 && (
              <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.8rem] text-ink" data-testid="settle-plan-over">
                팀별 기본값의 합이 현장 전체 모자람({fmtMan(Math.max(0, row.shortfall))})보다 {fmtMan(row.planOver)} 큽니다 — {row.teams.filter((t) => t.entered > t.estimate).map((t) => `${t.team} 입력이 추정보다 ${fmtMan(t.entered - t.estimate)} 많음`).join(" · ") || "어떤 팀 입력이 추정보다 많습니다"}. 팀 이름·단가가 맞는지 확인한 뒤 넣으세요.
              </p>
            )}
            {under.length > 0 && (
              <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.8rem] text-ink" data-testid="settle-under">
                {under.map((t) => `${t.team} ${fmtMan(t.left)}`).join(" · ")}은 이번에 넣지 않습니다. 이 달 정산은 한 번만이라, 남은 차이는 월 마감 줄에 ‘팀별로 남은 차이’로 남고 고치려면 정산을 되돌린 뒤 다시 넣어야 합니다.
              </p>
            )}
            <p className="text-[0.76rem] text-ink-3">추정입니다 — 팀별 실제 지급액(노무비 명세·세금계산서)을 알면 그 금액으로 고쳐 넣으세요. 넣지 않을 팀은 비워 두세요.</p>
          </div>
        ) : (
          <>
            <MoneyField id="settle-amount" label="넣을 노무비" value={amount} onChange={setAmount} error={errors.amount || errors.teams} required hint="추정입니다 — 실제 지급액(노무비 명세·세금계산서)을 알면 그 금액으로 고쳐 넣으세요" />
            {hasPlan && <p className="text-[0.76rem] text-warn">한 금액으로 넣으면 이 정산은 ‘팀 미지정’으로 남아 팀별 차이에 들어가지 않습니다(나중에 팀을 붙이려면 되돌린 뒤 다시).</p>}
          </>
        )}
        <Field label="근거 메모 (원가 목록·CSV에 남음)" htmlFor="settle-note" error={errors.note} required>
          <input id="settle-note" className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="예) 10월 노무비 명세 기준 · 협력업체 확인" />
        </Field>
      </div>
    </Modal>
  );
}
