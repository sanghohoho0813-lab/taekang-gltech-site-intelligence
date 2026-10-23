"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ClipboardPen, ChevronLeft, MapPin, CalendarDays, Info, Handshake, ShieldAlert, Image as ImageIcon } from "lucide-react";
import { useMe, useSignals, siteHealth, useFinancials, userLabel } from "@/lib/data/hooks";
import { PageBody } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, CountUp, DemoBadge, EmptyState, KeyValue, Notice, PageSkeleton, ProgressBar, SeverityBadge, cx } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { Facade } from "@/components/domain/Facade";
import { Donut, ProfitStack } from "@/components/domain/Charts";
import { Delta, HealthPill, MethodChip } from "@/components/domain/Widgets";
import { FieldReportForm } from "@/components/domain/FieldReportForm";
import { CostEntryList } from "@/components/domain/CostEntryList";
import { simulateApprovedClaims, type SiteFinancials } from "@/lib/domain/calc";
import { receivableAging } from "@/lib/domain/risk";
import { fmtDate, fmtDateTime, fmtEok, fmtMan, fmtManNum, fmtPct, fmtPp, fmtRelative } from "@/lib/domain/format";
import { CATEGORY_LABEL, CO_STATUS_LABEL, PARTNER_STATUS_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import type { DemoDB, Site } from "@/lib/domain/types";

type Tab = "overview" | "cost" | "progress" | "reports" | "contract" | "billing" | "requests" | "history";

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { db, canSeeMoney, role } = useMe();
  const fin = useFinancials(db);
  const signals = useSignals(db);
  const [tab, setTab] = useState<Tab>("overview");
  const [sheet, setSheet] = useState(false);

  if (!db) return <PageSkeleton />;
  const site = db.sites.find((s) => s.id === id);
  if (!site) {
    return (
      <PageBody>
        <EmptyState title="현장을 찾을 수 없습니다." desc="삭제되었거나 잘못된 주소입니다." action={<Link href="/sites"><Button>현장 목록</Button></Link>} />
      </PageBody>
    );
  }
  const f = fin[site.id];
  const siteSignals = signals.filter((s) => s.siteId === site.id);
  const health = siteHealth(signals, site.id);
  const tabs: { id: Tab; label: string; money?: boolean }[] = [
    { id: "overview", label: "개요" },
    { id: "cost", label: "원가" },
    { id: "progress", label: "공정" },
    { id: "reports", label: "보고·사진" },
    { id: "contract", label: "계약·변경", money: true },
    { id: "billing", label: "기성·입금", money: true },
    { id: "requests", label: "발주처 요청" },
    { id: "history", label: "이력" },
  ];
  const visibleTabs = tabs.filter((t) => !t.money || canSeeMoney);

  return (
    <PageBody className="pb-28 lg:pb-7">
      <div className="flex items-center gap-2 text-[0.8rem] text-ink-3">
        <Link href="/sites" className="press inline-flex items-center gap-0.5 rounded-lg px-1.5 py-1 font-semibold hover:bg-surface-3 hover:text-ink">
          <ChevronLeft size={16} /> 현장 관리
        </Link>
        <span aria-hidden>/</span>
        <span className="font-semibold text-ink-2">{site.shortName}</span>
      </div>

      {/* 헤더: 모바일은 참고 시안의 '현장 상세' 구성 */}
      <div className="grid gap-5 @min-[1000px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <Card className="order-2 overflow-hidden @min-[1000px]:order-1">
          <div className="relative">
            <Facade kind={site.illustration} className="h-44 @min-[520px]:h-52" />
            <span className="absolute right-3 top-3">
              <Badge tone="ok">진행 중</Badge>
            </span>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <HealthPill health={health} />
                <Badge>{site.workType}</Badge>
                <DemoBadge compact />
              </div>
              <h1 className="mt-2 text-[1.3rem] font-extrabold leading-snug text-ink" data-testid="site-title">{site.name}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.8rem] text-ink-3">
                <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden /> {site.region}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays size={14} aria-hidden /> {fmtDate(site.startDate)} ~ {fmtDate(site.endDate)}</span>
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Donut value={site.progressPct} label="공정률" size={112} stroke={12} />
              <dl className="min-w-0 flex-1">
                <KeyValue k="발주처" v={<span className="text-[0.82rem]">{site.clientName}</span>} />
                <KeyValue k="현장 담당" v={<span className="text-[0.82rem]">{userLabel(db, site.fieldUserId)}</span>} />
                {canSeeMoney && <KeyValue k="원가 진척률" v={fmtPct(f.costProgressPct)} />}
              </dl>
            </div>
            {role !== "partner" && (
              <div className="hidden lg:block">
                <Button variant="cta" size="lg" block icon={<ClipboardPen size={19} />} onClick={() => setSheet(true)} data-testid="open-report-sheet-pc">
                  현장 보고 · 비용 입력
                </Button>
              </div>
            )}
          </div>
        </Card>

        <div className="order-1 min-w-0 @min-[1000px]:order-2">{canSeeMoney ? <ProfitEngine db={db} site={site} f={f} /> : <FieldSiteSummary db={db} site={site} />}</div>
      </div>

      {canSeeMoney && siteSignals.length > 0 && (
        <Card>
          <CardHeader
            title={`이 현장의 위험 신호 ${siteSignals.length}건`}
            sub="데이터가 바뀌면 자동으로 다시 계산됩니다"
            right={
              <Link href="/insights">
                <Button size="sm" variant="soft" icon={<ShieldAlert size={15} />}>
                  위험 분석·조치
                </Button>
              </Link>
            }
          />
          <ul className="grid gap-2 px-5 pb-4 @min-[900px]:grid-cols-2">
            {siteSignals.map((s) => {
              const action = db.actions.find((a) => a.signalKey === s.key && a.status !== "dismissed");
              return (
                <li key={s.key} className="rounded-xl border border-line bg-surface-2 px-3.5 py-3" data-testid="site-signal">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={s.severity} />
                    <span className="text-[0.75rem] font-bold text-ink-3">{RULE_LABEL[s.rule]}</span>
                    {action && <Badge tone={action.status === "done" ? "ok" : "theme"}>조치 {action.status === "done" ? "완료" : "진행"}</Badge>}
                  </div>
                  <p className="mt-1 text-[0.88rem] font-semibold text-ink">{s.title}</p>
                  <p className="text-[0.76rem] text-ink-3">권장: {s.recommendation.actionTitle}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="sticky top-[calc(var(--demo-bar-h)+3.6rem)] z-20 -mx-4 border-b border-line bg-canvas/95 px-4 backdrop-blur lg:top-[calc(var(--demo-bar-h)+4rem)] @min-[760px]:-mx-7 @min-[760px]:px-7">
        <div className="flex gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label="현장 상세 탭">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "press relative shrink-0 px-3.5 py-3 text-[0.88rem] font-bold",
                tab === t.id ? "text-theme-ink" : "text-ink-3 hover:text-ink",
              )}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-active" aria-hidden />}
            </button>
          ))}
        </div>
      </div>

      <div className="anim-fade-up" key={tab}>
        {tab === "overview" && <OverviewTab db={db} site={site} f={f} canSeeMoney={canSeeMoney} />}
        {tab === "cost" && <CostTab db={db} site={site} f={f} canSeeMoney={canSeeMoney} />}
        {tab === "progress" && <ProgressTab site={site} f={f} canSeeMoney={canSeeMoney} />}
        {tab === "reports" && <ReportsTab db={db} site={site} />}
        {tab === "contract" && canSeeMoney && <ContractTab db={db} site={site} f={f} />}
        {tab === "billing" && canSeeMoney && <BillingTab db={db} site={site} f={f} />}
        {tab === "requests" && <RequestsTab db={db} site={site} />}
        {tab === "history" && <HistoryTab db={db} site={site} />}
      </div>

      {/* 모바일 하단 고정 CTA — 같은 Route에서 Sheet로 입력 (PC+Mobile 시연 시 PC 화면은 그대로 유지) */}
      {role !== "partner" && (
        <div className="fixed inset-x-0 bottom-[calc(3.9rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Button variant="cta" size="lg" block icon={<ClipboardPen size={19} />} onClick={() => setSheet(true)} data-testid="open-report-sheet">
            현장 보고 · 비용 입력
          </Button>
        </div>
      )}

      <Modal open={sheet} onClose={() => setSheet(false)} title={`현장 보고 · ${site.shortName}`} description="저장하면 공통 데이터에 기록되어 본사 손익·위험 분석에 즉시 반영됩니다." size="lg" testId="report-sheet">
        <FieldReportForm fixedSiteId={site.id} onClose={() => setSheet(false)} inSheet />
      </Modal>
    </PageBody>
  );
}

function ProfitEngine({ db, site, f }: { db: DemoDB; site: Site; f: SiteFinancials }) {
  const base = db.baseline[site.id];
  const sim = simulateApprovedClaims(f);
  const changed = base && (base.eac !== f.eac || base.adjustedContract !== f.adjustedContract);
  const [def, setDef] = useState(false);
  return (
    <Card className="flex h-full flex-col" data-tour="profit-engine" data-testid="profit-engine">
      <CardHeader
        title="현장 손익 엔진"
        sub="원가 이벤트 합산 → 총예상원가(EAC) → 예상이익 자동 재계산 · 단위 원, 부가세 별도"
        right={
          <button type="button" onClick={() => setDef(true)} className="press inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.78rem] font-bold text-ink-2 hover:bg-surface-3">
            <Info size={15} aria-hidden /> 지표 정의
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-3 px-5 @min-[900px]:grid-cols-4">
        <Metric label="조정 계약금액" value={<CountUp value={f.adjustedContract} format={(v) => fmtEok(v)} />} sub={f.approvedChange ? `승인 변경 +${fmtMan(f.approvedChange)}` : "승인 변경 없음"} testId="m-contract" />
        <Metric label="총예상원가 (EAC)" value={<CountUp value={f.eac} format={(v) => fmtEok(v)} />} sub={`발생 ${fmtEok(f.incurred)} + 잔여 ${fmtEok(f.remaining)}`} testId="m-eac" />
        <Metric
          label="예상이익"
          value={<CountUp value={f.expectedProfit} format={(v) => fmtEok(v)} />}
          sub={base ? <>기준 대비 <Delta value={f.expectedProfit - base.expectedProfit} format={(v) => fmtMan(v)} /></> : null}
          strong
          testId="m-profit"
        />
        <Metric
          label="예상이익률"
          value={<CountUp value={f.marginPct} format={(v) => fmtPct(v)} />}
          sub={<>계획 {fmtPct(f.plannedMarginPct)} · <span className={cx(f.marginPct < f.plannedMarginPct - 0.05 ? "text-err font-bold" : "")}>{fmtPp(f.marginPct - f.plannedMarginPct)}</span></>}
          strong
          testId="m-margin"
        />
      </div>
      <div className="px-5 pt-4">
        <ProfitStack incurred={f.incurred} remaining={f.remaining} profit={f.expectedProfit} contract={f.adjustedContract} />
        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[0.76rem] text-ink-2 num">
          EAC <b>{fmtEok(f.eac)}</b> = 발생원가 {fmtEok(f.incurred)} + 잔여예상원가 {fmtEok(f.remaining)} · 예상이익 <b>{fmtEok(f.expectedProfit)}</b> = 조정 계약 {fmtEok(f.adjustedContract)} − EAC · 이익률 = 예상이익 ÷ 조정 계약
        </p>
      </div>
      <div className="px-5 pt-4">
        <p className="mb-1.5 text-[0.78rem] font-bold text-ink-2">원가항목별 EAC vs 실행예산</p>
        <ul className="grid grid-cols-1 gap-x-5 gap-y-1.5 @min-[560px]:grid-cols-2" data-testid="category-mini">
          {f.categories.map((c) => {
            const over = c.variancePct > db.thresholds.overrunPct;
            return (
              <li key={c.category} className="grid grid-cols-[4.6rem_1fr_auto] items-center gap-2 text-[0.76rem]">
                <span className="font-semibold text-ink-2">{CATEGORY_LABEL[c.category].replace("(인건비)", "")}</span>
                <span className="relative h-2 rounded-full bg-surface-3">
                  <span className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", over ? "bg-err" : "bg-chart-2")} style={{ width: `${Math.min(100, (c.eac / Math.max(c.budget, c.eac)) * 100)}%` }} />
                  {c.eac > c.budget && <span className="absolute inset-y-[-3px] w-0.5 bg-ink" style={{ left: `${(c.budget / c.eac) * 100}%` }} aria-hidden />}
                </span>
                <span className={cx("num font-bold", over ? "text-err" : c.variance > 0 ? "text-warn" : "text-ink-3")}>{c.variance > 0 ? `+${fmtPct(c.variancePct)}` : "예산 내"}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-auto space-y-2 px-5 py-4">
        {changed && base && (
          <div className="anim-flash rounded-xl border border-err/25 bg-err-bg px-3.5 py-2.5 text-[0.82rem]" data-testid="change-banner">
            <p className="font-bold text-ink">기준(데모 초기) 대비 변화</p>
            <p className="num text-ink-2">
              EAC {fmtEok(base.eac)} → <b>{fmtEok(f.eac)}</b> ({f.eac - base.eac >= 0 ? "+" : "−"}
              {fmtMan(Math.abs(f.eac - base.eac))}) · 예상이익 {fmtEok(base.expectedProfit)} → <b>{fmtEok(f.expectedProfit)}</b> · 이익률 {fmtPct(base.marginPct)} → <b>{fmtPct(f.marginPct)}</b>
            </p>
          </div>
        )}
        {f.pendingChangeAmount > 0 && (
          <Notice tone="info" title={`승인 전 변경공사 ${fmtMan(f.pendingChangeAmount)} — 이익에 미반영`}>
            발주처 승인 시 예상이익률 {fmtPct(f.marginPct)} → {fmtPct(sim.marginPct)} (시뮬레이션 · 확정 아님)
          </Notice>
        )}
      </div>
      <Modal open={def} onClose={() => setDef(false)} title="지표 정의" size="md" footer={<Button onClick={() => setDef(false)}>닫기</Button>}>
        <dl className="space-y-3 text-[0.86rem] text-ink-2">
          {[
            ["발생원가", "지금까지 실제로 발생·집행된 원가의 합계 (유효한 원가 이벤트만, 무효 처리 제외)."],
            ["잔여예상원가", "완료까지 앞으로 들어갈 것으로 예상하는 원가. ‘계획 내 집행’ 원가가 들어오면 그만큼 줄어듭니다."],
            ["총예상원가 (EAC)", "Estimate At Completion. 발생원가 + 잔여예상원가. ‘예상 외 추가원가’는 EAC를 늘리고, ‘계획 내 집행’은 EAC를 바꾸지 않습니다 (중복 계산 금지)."],
            ["조정 계약금액", "원 계약금액 + 발주처가 승인한 변경계약 금액. 청구 검토·승인 대기 금액은 포함하지 않습니다."],
            ["예상이익 / 이익률", "조정 계약금액 − EAC, 이를 조정 계약금액으로 나눈 비율. 매출·입금액과는 다른 개념입니다."],
            ["계획 이익률", "계약 시점의 실행예산 기준 이익률 (계약금액 − 실행예산) ÷ 계약금액."],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-bold text-ink">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </Card>
  );
}

function Metric({ label, value, sub, strong, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; strong?: boolean; testId?: string }) {
  return (
    <div className={cx("rounded-xl border p-3", strong ? "border-active/30 bg-active-soft/60" : "border-line bg-surface-2")} data-testid={testId}>
      <p className="text-[0.75rem] font-semibold text-ink-3">{label}</p>
      <p className="mt-0.5 text-[1.45rem] font-extrabold leading-tight text-ink num">{value}</p>
      {sub && <p className="mt-0.5 text-[0.72rem] text-ink-3 num">{sub}</p>}
    </div>
  );
}

function FieldSiteSummary({ db, site }: { db: DemoDB; site: Site }) {
  const mine = db.costEntries.filter((e) => e.siteId === site.id && e.source !== "SEED" && e.status === "active");
  const sum = mine.reduce((s, e) => s + e.amount, 0);
  return (
    <Card data-tour="profit-engine" data-testid="field-site-summary">
      <CardHeader title="현장 원가 입력 현황" sub="현장직원 화면 · 권한 프리뷰" />
      <div className="space-y-3 px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-[0.75rem] font-semibold text-ink-3">이번 시연 중 입력한 원가</p>
            <p className="text-[1.4rem] font-extrabold num">{fmtMan(sum)}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-[0.75rem] font-semibold text-ink-3">공정률</p>
            <p className="text-[1.4rem] font-extrabold num">{site.progressPct}%</p>
          </div>
        </div>
        <Notice tone="info" title="손익·이익률은 대표·본사관리자에게만 표시됩니다">
          현장에서는 원가와 작업만 입력하고, 계약금액·예상이익은 본사 화면에서 자동 계산됩니다.
        </Notice>
      </div>
    </Card>
  );
}

function OverviewTab({ db, site, f, canSeeMoney }: { db: DemoDB; site: Site; f: SiteFinancials; canSeeMoney: boolean }) {
  const reports = db.reports.filter((r) => r.siteId === site.id && r.status === "submitted").slice(0, 3);
  return (
    <div className="grid gap-5 @min-[900px]:grid-cols-2">
      <Card>
        <CardHeader title="주요 공정" sub={`전체 공정률 ${site.progressPct}%`} />
        <ul className="space-y-3 px-5 pb-5">
          {site.stages.map((st, i) => (
            <li key={st.id} className="flex items-center gap-3">
              <span className={cx("grid size-8 shrink-0 place-items-center rounded-full text-[0.8rem] font-bold", st.progressPct === 100 ? "bg-ok-bg text-ok" : "bg-surface-3 text-ink-2")}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2 text-[0.86rem]">
                  <span className="truncate font-semibold">{st.name}</span>
                  <b className="num">{st.progressPct}%</b>
                </span>
                <ProgressBar value={st.progressPct} className="mt-1" label={`${st.name} 진행률`} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="최근 현장 보고" />
        {reports.length === 0 ? (
          <EmptyState title="보고가 없습니다." />
        ) : (
          <ul className="divide-y divide-line px-5 pb-3">
            {reports.map((r) => (
              <li key={r.id} className="py-2.5 text-[0.84rem]">
                <p className="text-[0.74rem] text-ink-3">{fmtDate(r.reportDate)} · {userLabel(db, r.createdBy)}</p>
                <p className="text-ink-2">{r.workDone}</p>
                {r.issues && <p className="mt-0.5 text-[0.78rem] text-warn">이슈: {r.issues}</p>}
              </li>
            ))}
          </ul>
        )}
        {canSeeMoney && (
          <div className="border-t border-line px-5 py-3 text-[0.8rem] text-ink-3">
            미수금 <b className="text-ink num">{fmtEok(f.outstanding)}</b> · 승인 대기 변경공사 <b className="text-ink num">{f.pendingChangeAmount ? fmtMan(f.pendingChangeAmount) : "없음"}</b>
          </div>
        )}
      </Card>
    </div>
  );
}

function CostTab({ db, site, f, canSeeMoney }: { db: DemoDB; site: Site; f: SiteFinancials; canSeeMoney: boolean }) {
  const entries = db.costEntries.filter((e) => e.siteId === site.id && e.source !== "SEED").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seedCount = db.costEntries.filter((e) => e.siteId === site.id && e.source === "SEED").length;
  return (
    <div className="space-y-5">
      {canSeeMoney && (
        <Card>
          <CardHeader title="원가항목별 예산 vs 총예상원가" sub="항목 EAC = 발생 + 잔여예상 · 예산 초과 5% 이상은 위험 신호" />
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[42rem] text-[0.85rem]" data-testid="cost-table">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-[0.75rem] font-semibold text-ink-3">
                  <th className="px-5 py-2.5">항목</th>
                  <th className="px-3 py-2.5 text-right">실행예산</th>
                  <th className="px-3 py-2.5 text-right">발생원가</th>
                  <th className="px-3 py-2.5 text-right">잔여예상</th>
                  <th className="px-3 py-2.5 text-right">항목 EAC</th>
                  <th className="px-5 py-2.5 text-right">예산 대비</th>
                </tr>
              </thead>
              <tbody>
                {f.categories.map((c) => (
                  <tr key={c.category} className="row-hover border-b border-line">
                    <td className="px-5 py-2.5 font-semibold">{CATEGORY_LABEL[c.category]}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtManNum(c.budget)}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtManNum(c.incurred)}</td>
                    <td className="px-3 py-2.5 text-right num">{fmtManNum(c.remaining)}</td>
                    <td className="px-3 py-2.5 text-right num font-bold">{fmtManNum(c.eac)}</td>
                    <td className={cx("px-5 py-2.5 text-right num font-bold", c.variancePct > db.thresholds.overrunPct ? "text-err" : c.variance > 0 ? "text-warn" : "text-ok")}>
                      {c.variance === 0 ? "0" : `${c.variance > 0 ? "+" : "−"}${fmtManNum(Math.abs(c.variance))}`} ({fmtPct(c.variancePct)})
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-2 font-bold">
                  <td className="px-5 py-2.5">합계</td>
                  <td className="px-3 py-2.5 text-right num">{fmtManNum(f.plannedCost)}</td>
                  <td className="px-3 py-2.5 text-right num">{fmtManNum(f.incurred)}</td>
                  <td className="px-3 py-2.5 text-right num">{fmtManNum(f.remaining)}</td>
                  <td className="px-3 py-2.5 text-right num">{fmtManNum(f.eac)}</td>
                  <td className="px-5 py-2.5 text-right num">{fmtManNum(f.eac - f.plannedCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="px-5 py-2.5 text-[0.72rem] text-ink-3">단위: 만 원 · 부가세 별도 · DEMO</p>
        </Card>
      )}
      <Card>
        <CardHeader title="원가 이벤트" sub={`현장보고·PC·CSV로 입력된 원가 · 기준 발생원가(시드) ${seedCount}건은 별도 집계`} />
        <div className="px-5 pb-3">
          <CostEntryList db={db} entries={entries} emptyText="시연 중 입력된 원가가 아직 없습니다. 모바일 ‘현장 보고 · 비용 입력’으로 추가해보세요." />
        </div>
      </Card>
    </div>
  );
}

function ProgressTab({ site, f, canSeeMoney }: { site: Site; f: SiteFinancials; canSeeMoney: boolean }) {
  return (
    <Card>
      <CardHeader title="공정 진행" sub={canSeeMoney ? `물리적 공정률 ${site.progressPct}% · 원가 진척률 ${fmtPct(f.costProgressPct)} (차이 ${fmtPp(f.costProgressPct - site.progressPct)})` : `공정률 ${site.progressPct}%`} />
      <ul className="divide-y divide-line px-5 pb-3">
        {site.stages.map((st) => (
          <li key={st.id} className="grid gap-1 py-3 @min-[560px]:grid-cols-[1fr_14rem] @min-[560px]:items-center">
            <div>
              <p className="text-[0.9rem] font-semibold">{st.name}</p>
              <p className="text-[0.75rem] text-ink-3 num">{fmtDate(st.startDate)} ~ {fmtDate(st.endDate)}</p>
            </div>
            <div className="flex items-center gap-2">
              <ProgressBar value={st.progressPct} label={`${st.name} 진행률`} tone={st.progressPct === 100 ? "ok" : "theme"} />
              <b className="w-10 text-right text-[0.82rem] num">{st.progressPct}%</b>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReportsTab({ db, site }: { db: DemoDB; site: Site }) {
  const reports = db.reports.filter((r) => r.siteId === site.id);
  return (
    <Card>
      <CardHeader title="현장 보고·사진" sub="사진은 이 브라우저 DEMO 저장소에 저장된 첨부만 표시" />
      {reports.length === 0 ? (
        <EmptyState icon={<ImageIcon size={28} />} title="보고가 없습니다." />
      ) : (
        <ul className="divide-y divide-line px-5 pb-3">
          {reports.map((r) => {
            const photos = db.photos.filter((p) => r.photoIds.includes(p.id));
            const costs = db.costEntries.filter((e) => r.costEntryIds.includes(e.id));
            return (
              <li key={r.id} className={cx("py-3", r.status === "voided" && "opacity-60")} data-testid="site-report">
                <p className="flex flex-wrap items-center gap-1.5 text-[0.75rem] text-ink-3">
                  {fmtDate(r.reportDate)} · {userLabel(db, r.createdBy)} · {fmtRelative(r.createdAt)}
                  {r.status === "voided" && <Badge>되돌림</Badge>}
                </p>
                <p className="mt-0.5 text-[0.88rem] text-ink">{r.workDone}</p>
                {r.issues && <p className="mt-1 rounded-lg bg-warn-bg px-2.5 py-1.5 text-[0.8rem] text-ink-2">⚠ {r.issues}</p>}
                {r.tomorrowPlan && <p className="mt-1 text-[0.78rem] text-ink-3">내일: {r.tomorrowPlan}</p>}
                {costs.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {costs.map((e) => (
                      <span key={e.id} className={cx("rounded-md bg-surface-3 px-1.5 py-0.5 text-[0.72rem] font-semibold", e.status === "voided" && "line-through")}>
                        {CATEGORY_LABEL[e.category]} {fmtMan(e.amount)}
                      </span>
                    ))}
                  </p>
                )}
                {photos.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {photos.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.id} src={p.dataUrl} alt={p.caption} className="size-20 rounded-lg border border-line object-cover" />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ContractTab({ db, site, f }: { db: DemoDB; site: Site; f: SiteFinancials }) {
  const contract = db.contracts.find((c) => c.siteId === site.id)!;
  const cos = db.changeOrders.filter((c) => c.siteId === site.id);
  return (
    <div className="grid gap-5 @min-[900px]:grid-cols-2">
      <Card>
        <CardHeader title="계약" sub="공급가액 · 부가세 별도" />
        <dl className="px-5 pb-4">
          <KeyValue k="원 계약금액" v={fmtWonEok(contract.contractAmount)} />
          <KeyValue k="승인된 변경계약" v={fmtWonEok(f.approvedChange)} />
          <KeyValue k="조정 계약금액" v={fmtWonEok(f.adjustedContract)} />
          <KeyValue k="실행예산 (계획 원가)" v={fmtWonEok(contract.plannedCostTotal)} />
          <KeyValue k="계획 이익률" v={fmtPct(f.plannedMarginPct)} />
          <KeyValue k="계약일" v={fmtDate(contract.signedDate)} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="변경공사" sub="승인(approved)된 금액만 계약에 반영" right={<Link href="/finance"><Button size="sm">정산에서 처리</Button></Link>} />
        {cos.length === 0 ? (
          <EmptyState title="변경공사가 없습니다." />
        ) : (
          <ul className="divide-y divide-line px-5 pb-3">
            {cos.map((c) => (
              <li key={c.id} className="py-2.5">
                <p className="flex flex-wrap items-center gap-1.5 text-[0.86rem]">
                  <b>{c.title}</b>
                  <Badge tone={c.status === "approved" ? "ok" : c.status === "rejected" ? "neutral" : "warn"}>{CO_STATUS_LABEL[c.status]}</Badge>
                </p>
                <p className="text-[0.78rem] text-ink-3 num">
                  {fmtMan(c.amount)} · {fmtDateTime(c.requestedAt)} · {c.status === "approved" ? "계약 반영" : "이익 미반영"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function fmtWonEok(v: number) {
  return `${fmtEok(v)} (${v.toLocaleString("ko-KR")}원)`;
}

function BillingTab({ db, site, f }: { db: DemoDB; site: Site; f: SiteFinancials }) {
  const bills = db.billings.filter((b) => b.siteId === site.id);
  const pays = db.payments.filter((p) => p.siteId === site.id);
  const aging = receivableAging(db, site.id);
  return (
    <div className="grid gap-5 @min-[900px]:grid-cols-2">
      <Card>
        <CardHeader title="기성청구 (확정)" sub={`누계 ${fmtEok(f.billed)} · 청구액 ≠ 입금액`} />
        <ul className="divide-y divide-line px-5 pb-3">
          {bills.map((b) => {
            const a = aging.find((x) => x.billingId === b.id);
            return (
              <li key={b.id} className="flex items-center justify-between py-2.5 text-[0.86rem]">
                <span>
                  <b>{b.round}차</b> <span className="text-ink-3">{fmtDate(b.billedDate)}</span>
                </span>
                <span className="text-right num">
                  {fmtMan(b.amount)}
                  {a && <span className={cx("block text-[0.72rem] font-bold", a.ageDays > db.thresholds.receivableDays ? "text-err" : "text-warn")}>미수 {fmtMan(a.unpaid)} · {a.ageDays}일</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardHeader title="입금" sub={`누계 ${fmtEok(f.received)} · 미수금 ${fmtEok(f.outstanding)}`} />
        <ul className="divide-y divide-line px-5 pb-3">
          {pays.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2.5 text-[0.86rem]">
              <span className="text-ink-3">{fmtDate(p.receivedDate)}</span>
              <b className="num">{fmtMan(p.amount)}</b>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function RequestsTab({ db, site }: { db: DemoDB; site: Site }) {
  const reqs = db.partnerRequests.filter((r) => r.siteId === site.id);
  return (
    <Card>
      <CardHeader title="발주처·협력사 요청함" sub="파트너 포털에서 등록된 요청" right={<Link href="/insights#requests"><Button size="sm" icon={<Handshake size={15} />}>요청 처리</Button></Link>} />
      {reqs.length === 0 ? (
        <EmptyState title="요청이 없습니다." />
      ) : (
        <ul className="divide-y divide-line px-5 pb-3">
          {reqs.map((r) => (
            <li key={r.id} className="py-2.5 text-[0.86rem]" data-testid="site-request">
              <p className="flex flex-wrap items-center gap-1.5">
                <b>{r.title}</b>
                <Badge tone={r.status === "answered" ? "ok" : r.status === "reviewing" ? "theme" : "warn"}>{PARTNER_STATUS_LABEL[r.status]}</Badge>
              </p>
              <p className="text-[0.78rem] text-ink-3">{fmtDateTime(r.createdAt)} · {userLabel(db, r.partnerUserId)}</p>
              {r.reply && <p className="mt-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[0.8rem]">회신: {r.reply}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HistoryTab({ db, site }: { db: DemoDB; site: Site }) {
  const logs = db.activityLogs.filter((l) => l.siteId === site.id);
  return (
    <Card>
      <CardHeader title="활동 이력" sub="모든 변경은 시간·사용자와 함께 기록" right={<MethodChip />} />
      {logs.length === 0 ? (
        <EmptyState title="이력이 없습니다." />
      ) : (
        <ol className="relative mx-5 mb-4 border-l-2 border-line pl-4">
          {logs.map((l) => (
            <li key={l.id} className="relative py-2">
              <span className="absolute -left-[1.42rem] top-3.5 size-2.5 rounded-full bg-active" aria-hidden />
              <p className="text-[0.74rem] text-ink-3 num">{fmtDateTime(l.at)} · {userLabel(db, l.by)}</p>
              <p className="text-[0.86rem] text-ink">{l.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
