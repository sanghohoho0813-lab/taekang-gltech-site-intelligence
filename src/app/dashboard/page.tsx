"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, CircleDollarSign, TrendingUp, Receipt, ShieldAlert, ChevronRight, ClipboardPen, ArrowRight } from "lucide-react";
import { useDb, useRole } from "@/lib/data/store";
import { useFinancials, usePortfolio, useSignals, siteHealth, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Button, Card, CardHeader, CountUp, DemoBadge, EmptyState, PageSkeleton, ProgressBar, SeverityBadge, cx } from "@/components/ui/primitives";
import { AiReadyButton, Freshness, HealthPill, MethodChip, ProgressRing, StatCard } from "@/components/domain/Widgets";
import { BillingBars, MarginBars } from "@/components/domain/Charts";
import { fmtEok, fmtMan, fmtPct, fmtPp, fmtRelative } from "@/lib/domain/format";
import { CATEGORY_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import { EasyHome } from "@/components/easy/EasyHome";
import { TodayReports } from "@/components/domain/TodayReports";
import { PendingBoard } from "@/components/domain/PendingBoard";
import { IS_LIVE, BASE_LABEL } from "@/lib/mode";

export default function DashboardPage() {
  const role = useRole();
  if (role === "field") return <EasyHome />;
  return <CeoDashboard />;
}

function CeoDashboard() {
  const db = useDb();
  const fin = useFinancials(db);
  const total = usePortfolio(db);
  const signals = useSignals(db);
  const [tab, setTab] = useState<"all" | "risk" | "ok">("all");

  const baselineProfit = useMemo(() => (db ? Object.values(db.baseline).reduce((s, b) => s + b.expectedProfit, 0) : 0), [db]);
  const baselineAdj = useMemo(() => (db ? Object.values(db.baseline).reduce((s, b) => s + b.adjustedContract, 0) : 0), [db]);

  if (!db || !total) return <PageSkeleton />;

  const high = signals.filter((s) => s.severity === "high").length;
  const medium = signals.filter((s) => s.severity === "medium").length;
  const low = signals.filter((s) => s.severity === "low").length;
  const baseMargin = baselineAdj ? (baselineProfit / baselineAdj) * 100 : 0;

  const sites = db.sites
    .map((s) => ({ s, f: fin[s.id], h: siteHealth(signals, s.id) }))
    .filter(({ h }) => (tab === "all" ? true : tab === "risk" ? h === "high" || h === "medium" : h === "ok" || h === "low"));
  const recentReports = db.reports.filter((r) => r.status === "submitted").slice(0, 4);
  const longReceivable = signals.filter((s) => s.rule === "RECEIVABLE_OVERDUE").length;

  return (
    <PageBody>
      <PageHeader
        eyebrow="건설의 오늘을, 더 나은 내일로"
        title={
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span>
              태강지엘텍 <span className="text-theme-ink">AX</span>
            </span>
            <span className="hidden h-7 w-px self-center bg-line-strong @min-[760px]:block" aria-hidden />
            <span className="text-[0.9rem] font-semibold leading-snug text-ink-3 @min-[760px]:max-w-[22rem]">현장 원가 한 번 입력 → 손익·위험·조치까지 이어지는 현장 수익관리</span>
          </span>
        }
        right={
          <>
            <DemoBadge />
            <Link href="/field">
              <Button variant="cta" icon={<ClipboardPen size={18} />}>현장 보고 입력</Button>
            </Link>
          </>
        }
      />
      <Freshness />

      {IS_LIVE && db.sites.length === 0 && <GettingStarted userCount={db.users.filter((u) => !u.inactive).length} />}

      <div className="stagger grid gap-3 @min-[1080px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1.6fr)]" data-tour="kpi-strip" data-testid="kpi-strip">
        <ProfitHero
          profit={total.expectedProfit}
          marginPct={total.marginPct}
          diff={total.expectedProfit - baselineProfit}
          rows={db.sites
            .filter((s) => s.status !== "completed" && fin[s.id])
            .map((s) => ({ id: s.id, name: s.shortName, margin: fin[s.id].marginPct, plan: fin[s.id].plannedMarginPct }))}
        />
        <div className="grid grid-cols-2 gap-3 @min-[760px]:grid-cols-4 @min-[1080px]:grid-cols-2">
          <StatCard label="운영 현장" value={`${total.activeCount}곳`} sub={IS_LIVE ? `전체 ${total.siteCount}곳 중 진행 중` : `가상 현장 ${total.siteCount}곳 · 진행 중`} icon={<Building2 size={20} />} href="/sites" />
          <StatCard
            label="총 계약 규모"
            value={<CountUp value={total.adjustedContract} format={(v) => fmtEok(v)} />}
            sub={total.pendingChangeAmount > 0 ? `승인 변경 포함 · 대기 변경공사 ${fmtEok(total.pendingChangeAmount)} 미반영` : "승인 변경 포함 · 부가세 별도"}
            icon={<CircleDollarSign size={20} />}
            group="growth"
            href="/finance"
          />
          <StatCard
            label="미수금"
            value={<CountUp value={total.outstanding} format={(v) => fmtEok(v)} />}
            sub={`확정 기성 − 수금 · ${longReceivable ? `장기 미수 ${longReceivable}개 현장` : "장기 미수 없음"}`}
            icon={<Receipt size={20} />}
            group="growth"
            href="/finance"
          />
          <StatCard label="위험 알림" value={`${signals.length}건`} sub={`규칙 기반 · 경고 ${high} · 주의 ${medium} · 확인 ${low}`} icon={<ShieldAlert size={20} />} group="ax" href="/insights" testId="kpi-risk" />
        </div>
      </div>

      <div className="grid gap-5">
        <Card>
          <CardHeader
            title="현장별 손익 현황"
            sub={`기준(${BASE_LABEL}) 평균 이익률 ${fmtPct(baseMargin)} → 현재 ${fmtPct(total.marginPct)} · 단위 억 원, 부가세 별도`}
            right={
              <div className="flex gap-1" role="tablist" aria-label="현장 필터">
                {(
                  [
                    ["all", `전체 ${db.sites.length}`],
                    ["risk", "주의·경고"],
                    ["ok", "정상·확인"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cx("press rounded-full px-3 py-1 text-[0.78rem] font-bold", tab === k ? "bg-active-soft text-theme-ink ring-1 ring-active/30" : "text-ink-3 hover:bg-surface-3")}
                  >
                    {l}
                  </button>
                ))}
              </div>
            }
          />
          {sites.length === 0 ? (
            db.sites.length === 0 ? <EmptyState title="등록된 현장이 없습니다." desc="운영 관리에서 첫 현장을 등록하면 손익이 계산됩니다." /> : <EmptyState title="해당 조건의 현장이 없습니다." desc="필터를 '전체'로 바꿔보세요." />
          ) : (
            <>
            <ul className="divide-y divide-line border-t border-line @min-[760px]:hidden" data-testid="site-list-mobile">
              {sites.map(({ s, f, h }) => (
                <li key={s.id}>
                  <Link href={`/sites/${s.id}`} className="row-hover block px-5 py-3.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <b className="text-ink">{s.shortName}</b> <span className="text-[0.75rem] text-ink-3">{s.workType}</span>
                      </span>
                      <HealthPill health={h} />
                    </span>
                    <span className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 text-[0.75rem] text-ink-3">
                      <span>
                        예상 총원가
                        <b className="block text-[0.95rem] text-ink num">
                          <CountUp value={f.eac} format={(v) => fmtEok(v, { unit: false })} />
                        </b>
                      </span>
                      <span>
                        예상이익
                        <b className={cx("block text-[0.95rem] num", f.expectedProfit < 0 ? "text-err" : "text-ink")}>
                          <CountUp value={f.expectedProfit} format={(v) => fmtEok(v, { unit: false })} />
                        </b>
                      </span>
                      <span>
                        이익률
                        <b className={cx("block text-[0.95rem] num", f.marginPct < f.plannedMarginPct - 2.99 ? "text-err" : "text-ink")}>
                          <CountUp value={f.marginPct} format={(v) => fmtPct(v)} />
                        </b>
                      </span>
                      <ProgressRing value={s.progressPct} label={`${s.shortName} 공정률`} size={48} />
                    </span>

                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto scroll-thin @min-[760px]:block">
              <table className="w-full min-w-[44rem] text-[0.86rem]" data-testid="site-table">
                <thead>
                  <tr className="border-y border-line bg-surface-2 text-left text-[0.75rem] font-semibold text-ink-3">
                    <th className="px-5 py-2.5">현장</th>
                    <th className="px-3 py-2.5 text-right" title="승인된 변경계약 포함">계약금액</th>
                    <th className="px-3 py-2.5 text-right">총예상원가(EAC)</th>
                    <th className="px-3 py-2.5 text-right">예상이익</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right">이익률 (계획→현재)</th>
                    <th className="px-3 py-2.5 w-36">공정률</th>
                    <th className="px-5 py-2.5">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map(({ s, f, h }) => (
                    <tr key={s.id} className="row-hover border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/sites/${s.id}`} className="group block" data-testid={`site-row-${s.id}`}>
                          <span className="font-bold text-ink group-hover:text-theme-ink">{s.shortName}</span>
                          <span className="ml-1.5 text-[0.75rem] text-ink-3">{s.workType}</span>
                          <span className="block max-w-[17rem] truncate text-[0.75rem] text-ink-3">{s.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right num">{fmtEok(f.adjustedContract, { unit: false })}</td>
                      <td className="px-3 py-3 text-right num font-semibold">
                        <CountUp value={f.eac} format={(v) => fmtEok(v, { unit: false })} />
                      </td>
                      <td className={cx("px-3 py-3 text-right num font-bold", f.expectedProfit < 0 ? "text-err" : "text-ink")}>
                        <CountUp value={f.expectedProfit} format={(v) => fmtEok(v, { unit: false })} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right num">
                        <span className="text-ink-3">{fmtPct(f.plannedMarginPct)} → </span>
                        <b className={cx(f.marginPct < f.plannedMarginPct - 2.99 ? "text-err" : "text-ink")}>
                          <CountUp value={f.marginPct} format={(v) => fmtPct(v)} />
                        </b>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={s.progressPct} label={`${s.shortName} 공정률`} />
                          <span className="w-9 text-right text-[0.78rem] font-semibold num">{s.progressPct}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <HealthPill health={h} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Card>

      </div>

      <PendingBoard db={db} />
      <TodayReports db={db} />

      <div className="grid gap-5 @min-[760px]:grid-cols-2 @min-[1080px]:grid-cols-3">
        <Card>
          <CardHeader
            title="위험 알림"
            sub="데이터 변경 시 자동 재계산"
            right={
              <Link href="/insights" className="press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.78rem] font-bold text-theme-ink hover:bg-active-soft">
                전체 <ChevronRight size={15} />
              </Link>
            }
          />
          <div className="px-5 pb-2">
            <MethodChip />
          </div>
          {signals.length === 0 ? (
            <EmptyState title="감지된 위험이 없습니다." />
          ) : (
            <ul className="divide-y divide-line px-2 pb-2">
              {signals.slice(0, 5).map((s) => {
                const action = db.actions.find((a) => a.signalKey === s.key && a.status !== "dismissed");
                return (
                  <li key={s.key}>
                    <Link href={action ? "/insights" : `/insights#${encodeURIComponent(s.key)}`} className="row-hover flex items-start gap-3 rounded-xl px-3 py-2.5">
                      <SeverityBadge severity={s.severity} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.85rem] font-semibold leading-snug text-ink">{s.title}</span>
                        <span className="block text-[0.74rem] text-ink-3">
                          {RULE_LABEL[s.rule]} · {fmtRelative(s.detectedAt)}
                          {action && <> · 조치 {action.status === "done" ? "완료" : "진행"}</>}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mx-4 mb-4 rounded-xl bg-surface-2 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[0.82rem] font-bold text-ink">권장 조치 (규칙 기반)</p>
              <AiReadyButton />
            </div>
            {signals[0] ? (
              <p className="mt-1.5 text-[0.82rem] text-ink-2">
                <b>{signals[0].recommendation.actionTitle}</b> — {signals[0].recommendation.description}
              </p>
            ) : (
              <p className="mt-1.5 text-[0.82rem] text-ink-3">현재 권장 조치가 없습니다.</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="현장별 예상이익률" sub="계획(계약 시 실행예산 기준) vs 현재" />
          <div className="px-5 pb-5">
            <MarginBars rows={db.sites.map((s) => ({ label: s.shortName, planned: fin[s.id].plannedMarginPct, current: fin[s.id].marginPct }))} target={db.thresholds.targetMarginPct} />
          </div>
        </Card>
        <Card>
          <CardHeader title="기성·수금 현황" sub="확정 기성청구액과 실제 입금액은 다른 개념입니다" />
          <div className="px-5 pb-5">
            <BillingBars rows={db.sites.map((s) => ({ label: s.shortName, billed: fin[s.id].billed, received: fin[s.id].received, outstanding: fin[s.id].outstanding }))} />
          </div>
        </Card>
        <Card className="@min-[760px]:col-span-2 @min-[1080px]:col-span-3">
          <CardHeader
            title="최근 현장 보고"
            right={
              <Link href="/field" className="press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.78rem] font-bold text-theme-ink hover:bg-active-soft">
                현장 보고 <ArrowRight size={15} />
              </Link>
            }
          />
          <ul className="divide-y divide-line px-2 pb-2">
            {recentReports.map((r) => {
              const site = db.sites.find((s) => s.id === r.siteId)!;
              const costs = db.costEntries.filter((e) => r.costEntryIds.includes(e.id) && e.status === "active");
              const sum = costs.filter((e) => e.forecastImpact === "additional").reduce((a, e) => a + e.amount, 0);
              return (
                <li key={r.id}>
                  <Link href={`/sites/${r.siteId}`} className="row-hover block rounded-xl px-3 py-2.5">
                    <span className="flex items-center gap-2 text-[0.74rem] text-ink-3">
                      <b className="text-ink">{site.shortName}</b> {userLabel(db, r.createdBy)} · {fmtRelative(r.createdAt)}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-[0.84rem] text-ink-2">{r.workDone}</span>
                    {costs.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        {costs.map((e) => (
                          <span key={e.id} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[0.7rem] font-semibold text-ink-2">
                            {CATEGORY_LABEL[e.category]} {fmtMan(e.amount)}
                          </span>
                        ))}
                        {sum > 0 && <span className="rounded-md bg-err-bg px-1.5 py-0.5 text-[0.7rem] font-bold text-err">예상 총원가 +{fmtMan(sum)}</span>}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <p className="text-[0.75rem] text-ink-3">
        {IS_LIVE ? (
          <>* 예상이익은 본사 관리비를 빼기 전 현장 이익입니다. 위험 기준(이익률 하락 {fmtPp(-db.thresholds.marginDropPp)}, 목표 이익률 {db.thresholds.targetMarginPct}%)은 설정에서 바꿀 수 있습니다.</>
        ) : (
          <>* 모든 현장·금액·인물은 가상 시연 데이터이며 (주)태강지엘텍의 실제 실적이 아닙니다. 이익률 하락 기준 {fmtPp(-db.thresholds.marginDropPp)}, 목표 이익률 {db.thresholds.targetMarginPct}%는 DEMO 설정값입니다.</>
        )}
      </p>
    </PageBody>
  );
}

/** LIVE 첫 사용: 현장이 하나도 없을 때 시작 순서 안내 */
function GettingStarted({ userCount }: { userCount: number }) {
  const steps = [
    { n: 1, t: "직원·발주처 계정 추가", d: "현장소장·공무 담당 계정을 만들면 임시 비밀번호가 나옵니다.", href: "/admin?tab=members", done: userCount > 1, cta: "사용자 추가" },
    { n: 2, t: "첫 현장 등록", d: "원 계약금액·실행예산(5개 항목)·현장 담당을 넣으면 계획 이익률이 계산됩니다. 진행 중인 현장이면 등록 뒤 ‘자료 이관·점검’에서 지난 기성·변경공사·출력을 한 번에 넣으세요.", href: "/admin?tab=sites", done: false, cta: "현장 등록" },
    { n: 3, t: "시범 운영 준비 점검", d: "현장 위치·담당·직원별 첫 로그인·휴대폰 점검·위치 동의를 한 화면에서 확인하고, 직원 로그인 쪽지를 인쇄합니다.", href: "/launch", done: false, cta: "준비 점검" },
    { n: 4, t: "현장소장 첫 보고", d: "현장소장이 휴대폰으로 로그인해 작업·추가 비용을 보고하면 이 화면이 바뀝니다.", href: "/admin?tab=settings", done: false, cta: "반영 방식 확인" },
  ];
  return (
    <Card data-testid="getting-started">
      <CardHeader title="시작하기 — 4단계" sub="실제 현장 1곳으로 먼저 시작하는 것을 권장합니다" />
      <ol className="grid gap-3 px-5 pb-5 @min-[700px]:grid-cols-2 @min-[1100px]:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className={cx("rounded-2xl border p-4", s.done ? "border-ok/30 bg-ok-bg" : "border-line bg-surface-2")}>
            <p className="text-[0.75rem] font-bold text-theme-ink">{s.done ? "완료" : `${s.n}단계`}</p>
            <p className="mt-0.5 font-bold">{s.t}</p>
            <p className="mt-1 text-[0.8rem] text-ink-2">{s.d}</p>
            <Link href={s.href} className="mt-3 inline-block">
              <Button size="sm" variant={s.done ? "ghost" : "cta"}>
                {s.cta}
              </Button>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}


/**
 * 대표 카드 (D-60) — 회사 전체 예상이익을 크게, 현장별 이익률을 계획 대비 막대로.
 * 숫자는 손익 엔진 그대로(규칙 기반 계산), 금액 단위 억 원.
 */
function ProfitHero({ profit, marginPct, diff, rows }: { profit: number; marginPct: number; diff: number; rows: { id: string; name: string; margin: number; plan: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.margin, r.plan])) * 1.15;
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <Link href="/report" className="shell-band lift relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-[1.6rem] p-5 shadow-pop @min-[760px]:p-6" data-testid="kpi-profit">
      <span className="flex items-center gap-2 text-[0.84rem] font-semibold text-white/80">
        <TrendingUp size={18} aria-hidden /> 예상이익 합계 · 평균 이익률
      </span>
      <span className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="num text-[2.35rem] font-extrabold leading-none tracking-[-0.02em]">
          <CountUp value={profit} format={(v) => fmtEok(v)} />
        </span>
        <span className="num pb-1 text-[1.05rem] font-bold text-white/90">평균 {fmtPct(marginPct)}</span>
      </span>
      <span className="num text-[0.84rem] text-white/80">
        기준({BASE_LABEL}) 대비 {diff === 0 ? "변동 없음" : `${diff > 0 ? "▲" : "▼"} ${fmtMan(Math.abs(diff))}`}
      </span>
      {rows.length > 0 && (
        <ul className="mt-1 space-y-2" aria-label="현장별 이익률 (계획 대비)">
          {rows.map((r) => {
            const low = r.margin < r.plan - 2.99;
            return (
              <li key={r.id} className="grid grid-cols-[3.6rem_minmax(0,1fr)_3.2rem] items-center gap-2 text-[0.8rem]">
                <span className="truncate font-semibold text-white/90">{r.name}</span>
                <span className="relative h-2.5 rounded-full bg-white/15">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: w(r.margin), background: low ? "#F6C15B" : "#FFFFFF" }} />
                  <span className="absolute -inset-y-1 w-0.5 rounded bg-white/70" style={{ left: w(r.plan) }} title={`계획 ${fmtPct(r.plan)}`} />
                </span>
                <span className={cx("num text-right font-bold", low ? "text-[#F6C15B]" : "text-white")}>{fmtPct(r.margin)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <span className="mt-auto inline-flex items-center gap-1 text-[0.8rem] font-semibold text-white/80">
        막대 = 현재 이익률 · 세로선 = 계획 · 대표 보고서 보기 <ArrowRight size={14} aria-hidden />
      </span>
    </Link>
  );
}
