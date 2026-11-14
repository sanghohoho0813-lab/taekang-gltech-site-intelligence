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
import { monthClose, monthCostRows, previousMonth, type CloseItemKind, type CloseLabor } from "@/lib/domain/monthClose";
import { fmtDate, fmtMan, todayIso } from "@/lib/domain/format";
import { CATEGORY_LABEL, COST_CATEGORIES } from "@/lib/domain/labels";
import { toCsv } from "@/lib/domain/csv";
import { uid } from "@/lib/domain/ids";
import { downloadCsv } from "@/lib/browser/download";
import { ForecastModal } from "./SitesAdmin";
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
  if (!db || !r) return <PageSkeleton />;
  const label = `${chosen.slice(0, 4)}년 ${Number(chosen.slice(5))}월`;
  const settleRow = settling ? r.labor.find((l) => l.site.id === settling) : undefined;
  const closeSite = closing ? db.sites.find((x) => x.id === closing) : undefined;
  const openAction = (a: { kind: "settleLabor" | "closeout"; siteId: string }) => (a.kind === "settleLabor" ? setSettling(a.siteId) : setClosing(a.siteId));

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
                  <Button size="sm" variant="soft" className="no-print mb-3 ml-5 shrink-0 sm:my-0 sm:ml-0" onClick={() => openAction(it.action!)} data-testid={it.action.kind === "settleLabor" ? "close-settle-open" : "close-closeout-open"}>
                    {it.action.kind === "settleLabor" ? "차액 정산" : "원가 마감"}
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
        <p className="px-5 pt-2 pb-4 text-[0.76rem] text-ink-3">
          원가 항목별: {r.money.map((m) => `${m.site.shortName} ${COST_CATEGORIES.filter((c) => m.cost[c]).map((c) => `${CATEGORY_LABEL[c]} ${fmtMan(m.cost[c])}`).join(" · ") || "없음"}`).join(" / ")}
        </p>
      </Card>

      {/* 3. 이익 변화 이유 */}
      <Card data-testid="close-profit">
        <CardHeader title="이달 예상이익을 바꾼 일" sub="계획 안의 집행은 이익을 바꾸지 않습니다 — 추가 원가·변경공사 승인만 모았습니다. 더하면 이달 변화가 됩니다." />
        <ul className="divide-y divide-line border-t border-line">
          {r.profit.map((p) => (
            <li key={p.site.id} className="px-5 py-3" data-testid="close-profit-site">
              <p className="flex flex-wrap items-baseline gap-x-2 text-[0.9rem]">
                <b>{p.site.shortName}</b>
                <span className={cx("num font-bold", p.net < 0 ? "text-err" : p.net > 0 ? "text-ok" : "text-ink-3")}>이달 {signed(p.net)}</span>
                <span className="text-[0.78rem] text-ink-3 num">
                  · 지금 예상이익 {fmtMan(p.expectedProfit)} (현장 등록 대비 {signed(p.sinceBaseline)})
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
                <p className="mt-0.5 text-[0.82rem] text-ink-3">이달에 이익을 바꾼 일이 없습니다 (계획 안에서 집행).</p>
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
                  const gap = l.actual - l.estimate;
                  return (
                    <tr key={l.site.id} className="border-t border-line" data-testid="close-labor-row" data-site={l.site.id}>
                      <td className="px-3 py-2.5 pl-5 font-bold">{l.site.shortName}</td>
                      <td className="px-3 py-2.5 text-right">{l.teams.reduce((a, t) => a + t.personDays, 0)}</td>
                      <td className="px-3 py-2.5 text-right">{won(l.estimate)}</td>
                      <td className="px-3 py-2.5 text-right">
                        {won(l.actual)}
                        {l.actualPending > 0 && <span className="block text-[0.72rem] font-semibold text-warn">확인 대기 {fmtMan(l.actualPending)}</span>}
                      </td>
                      <td className={cx("px-3 py-2.5 text-right font-semibold", Math.abs(gap) > Math.max(1_000_000, l.estimate * 0.2) && "text-warn")}>{signed(gap)}</td>
                      <td className="no-print px-3 py-2 font-sans">
                        {l.settled ? (
                          <span className="inline-flex flex-wrap items-center gap-1 text-[0.78rem] text-ink-2" data-testid="close-settled">
                            <Badge tone="ok">정산함</Badge> {fmtMan(l.settled.amount)} · {fmtDate(l.settled.date)}
                          </span>
                        ) : l.canSettle ? (
                          <Button size="sm" variant="soft" onClick={() => setSettling(l.site.id)} data-testid="close-settle-row">
                            차액 정산
                          </Button>
                        ) : (
                          <span className="text-[0.78rem] text-ink-3">—</span>
                        )}
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
      {settleRow && <LaborSettleModal row={settleRow} month={chosen} ended={r.ended} onClose={() => setSettling(null)} />}
      {closeSite && <ForecastModal db={db} site={closeSite} closeout onClose={() => setClosing(null)} />}
    </PageBody>
  );
}

/**
 * 노무 차액 정산 (D-79) — 출력 인원 × 팀 단가 추정과 그 달 입력된 노무비의 차이를 한 건으로 넣는다.
 * 본사 입력이라 바로 원가에 반영된다. 실제 지급액을 알면 그 금액으로 고쳐 넣는다.
 */
function LaborSettleModal({ row, month, ended, onClose }: { row: CloseLabor; month: string; ended: boolean; onClose: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(() => wonText(Math.max(0, row.shortfall)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key] = useState(() => uid("idem"));
  const n = toWon(amount);
  const m = Number(month.slice(5));
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      await run("settleLabor", { siteId: row.site.id, month, amount: Number.isFinite(n) ? n : 0, note, idempotencyKey: key });
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
      description="출력(작업 인원) 기준 추정과 그 달 입력된 노무비의 차이를 한 건으로 넣습니다. 본사 입력이라 바로 원가에 반영되고, 같은 현장·같은 달에는 한 번만 넣을 수 있습니다."
      size="md"
      testId="settle-form"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" onClick={save} loading={busy} disabled={!Number.isFinite(n) || n <= 0} data-testid="settle-save">
            정산 넣기
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!ended && <Notice tone="warn" title="이번 달은 아직 끝나지 않았습니다 — 오늘까지의 출력 기준입니다. 달이 끝난 뒤에 정산하는 것이 좋습니다." />}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[26rem] text-[0.84rem]">
            <thead>
              <tr className="text-left text-[0.74rem] text-ink-3">
                {["팀", "인원일", "단가", "추정"].map((h, i) => (
                  <th key={h} className={cx("px-3 py-2 font-semibold", i > 0 && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {row.teams.map((t) => (
                <tr key={t.team} className="border-t border-line">
                  <td className="px-3 py-2 font-sans">
                    {t.team}
                    {!t.rateSet && <span className="ml-1 text-[0.72rem] text-warn">(기본 일당)</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{t.personDays}</td>
                  <td className="px-3 py-2 text-right">{fmtMan(t.dayRate)}</td>
                  <td className="px-3 py-2 text-right">{fmtMan(t.estimate)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong font-bold">
                <td className="px-3 py-2 font-sans">출력 기준 추정</td>
                <td colSpan={3} className="px-3 py-2 text-right">{fmtMan(row.estimate)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-3 py-2 font-sans">그 달 입력된 노무비{row.actualPending > 0 ? ` (확인 대기 ${fmtMan(row.actualPending)} 포함)` : ""}</td>
                <td colSpan={3} className="px-3 py-2 text-right">{fmtMan(row.actual)}</td>
              </tr>
              <tr className="border-t border-line font-bold text-warn">
                <td className="px-3 py-2 font-sans">모자란 금액</td>
                <td colSpan={3} className="px-3 py-2 text-right">{fmtMan(row.shortfall)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[0.78rem] text-ink-3">
          기간 {fmtDate(row.compareFrom)} ~ {fmtDate(row.to)} · 출력 기록을 쓰기 시작한 날부터 셉니다. 넣는 날짜는 {fmtDate(row.to)}입니다.
        </p>
        <MoneyField id="settle-amount" label="넣을 노무비" value={amount} onChange={setAmount} error={errors.amount} required hint="추정입니다 — 실제 지급액(노무비 명세·세금계산서)을 알면 그 금액으로 고쳐 넣으세요" />
        <Field label="메모 (원가 목록·CSV에 남음)" htmlFor="settle-note" error={errors.note}>
          <input id="settle-note" className={inputCls} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="예) 10월 노무비 명세 기준 · 협력업체 확인" />
        </Field>
      </div>
    </Modal>
  );
}
