"use client";

/** 본사 — 공정 일정 (계획 대비 실제·늦은 일수·준공 예상·지연 경비 추정·출근 공백) */
import { MetricTile } from "@/components/domain/Widgets";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CircleCheck } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { sitePlan, STAGE_STATUS_LABEL, type SitePlan, type StageStatus } from "@/lib/domain/schedule";
import { fmtDate, fmtMan, todayIso } from "@/lib/domain/format";
import { IS_LIVE } from "@/lib/mode";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Card, CardHeader, EmptyState, Notice, PageSkeleton, cx } from "@/components/ui/primitives";

const STAGE_TONE: Record<StageStatus, string> = {
  done: "bg-ok-bg text-ok",
  on_track: "bg-surface-3 text-ink-2",
  ahead: "bg-ok-bg text-ok",
  behind: "bg-warn-bg text-warn",
  overdue: "bg-err-bg text-err",
  not_started_late: "bg-err-bg text-err",
  upcoming: "bg-surface-3 text-ink-3",
};

/** 실제 막대 위에 계획 위치를 세로선으로 */
function PlanBar({ planned, actual, label }: { planned: number; actual: number; label: string }) {
  const behind = planned - actual >= 5;
  return (
    <div className="relative h-3 w-full rounded-full bg-surface-3" role="img" aria-label={`${label}: 계획 ${planned}% · 실제 ${actual}%`}>
      <div className={cx("h-full rounded-full", actual >= 100 ? "bg-ok" : behind ? "bg-warn" : "bg-active")} style={{ width: `${Math.min(100, actual)}%` }} />
      <div className="absolute -top-1 h-5 w-0.5 bg-ink" style={{ left: `calc(${Math.min(100, planned)}% - 1px)` }} title={`계획 ${planned}%`} />
    </div>
  );
}

export function ScheduleBoard() {
  const { db, canSeeMoney } = useMe();
  if (!db) return <PageSkeleton />;
  const today = todayIso();
  const plans = db.sites.filter((s) => s.status === "active").map((s) => sitePlan(db, s, today));
  const behind = plans.filter((p) => p.status === "behind");
  const overdue = plans.flatMap((p) => p.stages.filter((s) => s.status === "overdue" || s.status === "not_started_late").map((s) => ({ p, s })));
  const gaps = plans.filter((p) => p.noAttendanceDays.length > 0);

  return (
    <PageBody>
      <PageHeader
        title="공정 일정"
        desc="공정 단계 기간으로 오늘까지 ‘계획상 몇 %’여야 하는지 계산해 실제 공정률과 비교합니다. 계산 규칙이며 예측 AI가 아닙니다."
      />

      <div className="grid gap-3 @min-[760px]:grid-cols-3" data-testid="sched-summary">
        <SummaryTile tone={behind.length ? "err" : "ok"} label="계획보다 늦은 현장" value={`${behind.length}곳`} sub={behind.map((p) => `${p.site.shortName} 약 ${p.delayDays}일`).join(" · ") || "없음"} />
        <SummaryTile tone={overdue.length ? "err" : "ok"} label="기한 지났거나 시작 못 한 공정" value={`${overdue.length}개`} sub={overdue.slice(0, 3).map(({ p, s }) => `${p.site.shortName} ${s.stage.name}`).join(" · ") || "없음"} />
        <SummaryTile tone={gaps.length ? "warn" : "ok"} label="공정 중인데 출근 없는 날" value={`${gaps.reduce((a, p) => a + p.noAttendanceDays.length, 0)}일`} sub={gaps.map((p) => `${p.site.shortName} ${p.noAttendanceDays.length}일`).join(" · ") || "최근 14일 없음"} />
      </div>

      {plans.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarClock size={30} />} title="진행 중인 현장이 없습니다" />
        </Card>
      ) : (
        <div className="grid gap-5">
          {plans.map((p) => (
            <SiteSchedule key={p.site.id} p={p} canSeeMoney={canSeeMoney} today={today} />
          ))}
        </div>
      )}

      <Notice tone="info" title="계산 방법">
        계획 진척 = 공정 단계마다 기간 중 오늘까지 지난 비율을 기간 길이로 가중 합산 · 늦은 일수 ≈ (계획 − 실제) × 전체 공기 · 준공 예상 = 준공 예정 + 늦은 일수 · 지연 경비 추정 = 늦은 일수 × (현장경비 실행예산 ÷ 공기). 인건비·장비 대기비와 공정 간 선후 관계는 반영하지 않은 단순 계산입니다.
      </Notice>
    </PageBody>
  );
}

function SummaryTile({ tone, label, value, sub }: { tone: "ok" | "warn" | "err"; label: string; value: string; sub: string }) {
  return <MetricTile label={label} value={value} sub={sub} tone={tone === "ok" ? undefined : tone} />;
}

function SiteSchedule({ p, canSeeMoney, today }: { p: SitePlan; canSeeMoney: boolean; today: string }) {
  // 앞선 공정이 늦은 공정을 가려 '계획대로'로 보이지 않게, 기한 지난 공정은 따로 알린다
  const lateStages = p.stages.filter((s) => s.status === "overdue" || s.status === "not_started_late").length;
  const head =
    p.status === "behind" ? (
      <span className="inline-flex items-center gap-1 font-bold text-err">
        <AlertTriangle size={16} aria-hidden /> 계획보다 약 {p.delayDays}일 늦음
      </span>
    ) : p.status === "ahead" ? (
      <span className="inline-flex items-center gap-1 font-bold text-ok">
        <CircleCheck size={16} aria-hidden /> 계획보다 약 {-p.delayDays}일 앞섬
      </span>
    ) : lateStages > 0 ? (
      // 전체 진척은 계획 범위지만 기한 지난 공정이 있으면 초록 ‘계획대로’를 띄우지 않는다 (D-65)
      <span className="inline-flex items-center gap-1 font-bold text-warn">
        <AlertTriangle size={16} aria-hidden /> 전체는 계획 범위 · 일부 공정 지연
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 font-bold text-ok">
        <CircleCheck size={16} aria-hidden /> 계획대로
      </span>
    );
  return (
    <Card data-testid="sched-site" data-site={p.site.id} data-status={p.status}>
      <CardHeader
        title={
          <Link href={`/sites/${p.site.id}`} className="hover:underline">
            {p.site.shortName} · {p.site.workType}
          </Link>
        }
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {head}
            {lateStages > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-err-bg px-1.5 py-0.5 font-bold text-err" data-testid="sched-head-late">
                <AlertTriangle size={14} aria-hidden /> 기한 지난 공정 {lateStages}개
              </span>
            )}
            <span className="num">
              계획 {p.plannedPct}% · 실제 {p.actualPct}%
            </span>
            <span className="num">
              준공 예정 {fmtDate(p.plannedEnd)}
              {/* ‘계획대로’ 범위 안의 작은 차이는 빨간 예상일·지연 경비로 보이지 않는다 — 배지와 엇갈리던 문제 (D-77 리허설) */}
              {p.status === "behind" && p.delayDays > 0 && <b className="text-err"> → 예상 {fmtDate(p.forecastEnd)} (+{p.delayDays}일)</b>}
            </span>
          </span>
        }
      />
      <div className="space-y-3 px-5 pb-5">
        <PlanBar planned={p.plannedPct} actual={p.actualPct} label={`${p.site.shortName} 전체`} />
        {canSeeMoney && p.status === "behind" && p.delayDays > 0 && p.dailyOverhead > 0 && (
          <p className="rounded-xl bg-err-bg px-3 py-2 text-[0.84rem]" data-testid="sched-cost">
            지연 경비 추정 <b className="num">{fmtMan(p.delayCost)}</b> — 현장경비 하루 약 {fmtMan(p.dailyOverhead)} × {p.delayDays}일 (인건비·장비 대기비 제외)
          </p>
        )}
        {p.noAttendanceDays.length > 0 && (
          <p className="rounded-xl bg-warn-bg px-3 py-2 text-[0.84rem]" data-testid="sched-gap">
            최근 14일 중 공정이 진행 중인데 <b>출근 기록이 없는 날 {p.noAttendanceDays.length}일</b>: {p.noAttendanceDays.map((d) => d.slice(5).replace("-", "/")).join(", ")} ·{" "}
            <Link href="/attendance" className="font-semibold text-theme-ink underline">
              출퇴근 현황
            </Link>
          </p>
        )}
        {!p.hasStages ? (
          <p className="text-[0.84rem] text-ink-2" data-testid="sched-no-stages">
            공정 단계가 없어 현장 전체 기간으로만 계산했습니다. {IS_LIVE ? "운영 관리 → 현장 → 수정에서 공정 단계(이름·시작·종료)를 등록하면 단계별로 확인할 수 있습니다." : ""}
          </p>
        ) : (
          <>
          {/* 휴대폰: 공정마다 카드 (표는 넓은 화면에서만 · D-65) */}
          <ul className="space-y-2 @min-[760px]:hidden" aria-label={`${p.site.shortName} 공정`}>
            {p.stages.map((s) => (
              <li key={s.stage.id} className="rounded-2xl border border-line bg-surface-2/60 p-3" data-testid="sched-stage-card" data-status={s.status}>
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-[0.9rem] font-bold">{s.stage.name}</p>
                  <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[0.74rem] font-bold", STAGE_TONE[s.status])}>
                    {STAGE_STATUS_LABEL[s.status]}
                    {s.status === "overdue" ? ` ${s.overdueDays}일` : s.status === "behind" ? ` ${Math.round(s.gapPp)}%p` : ""}
                  </span>
                </div>
                <p className="num mt-0.5 text-[0.76rem] text-ink-3">
                  {fmtDate(s.stage.startDate)} ~ {fmtDate(s.stage.endDate)}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <PlanBar planned={s.plannedPct} actual={s.actualPct} label={s.stage.name} />
                  <span className="num shrink-0 text-[0.78rem]">
                    실제 <b>{s.actualPct}%</b> · 계획 {Math.round(s.plannedPct)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div tabIndex={0} role="region" aria-label="공정 표 (가로 스크롤)" className="relative hidden overflow-x-auto @min-[760px]:block">
            <table className="w-full min-w-[40rem] text-[0.84rem]">
              <thead>
                <tr className="text-left text-[0.74rem] text-ink-3">
                  <th className="py-2 pr-3 font-semibold">공정 단계</th>
                  <th className="py-2 pr-3 font-semibold">기간</th>
                  <th className="w-[42%] py-2 pr-3 font-semibold">실제(막대) · 계획(세로선)</th>
                  <th className="py-2 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {p.stages.map((s) => (
                  <tr key={s.stage.id} className="border-t border-line" data-testid="sched-stage" data-status={s.status}>
                    <td className="py-2.5 pr-3 font-semibold">{s.stage.name}</td>
                    <td className="num py-2.5 pr-3 text-ink-2">
                      {fmtDate(s.stage.startDate)} ~ {fmtDate(s.stage.endDate)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <PlanBar planned={s.plannedPct} actual={s.actualPct} label={s.stage.name} />
                        <span className="num w-32 shrink-0 text-right text-[0.78rem]">
                          실제 <b>{s.actualPct}%</b> · 계획 {Math.round(s.plannedPct)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <span className={cx("rounded-md px-1.5 py-0.5 text-[0.76rem] font-bold", STAGE_TONE[s.status])}>
                        {STAGE_STATUS_LABEL[s.status]}
                        {s.status === "overdue" ? ` ${s.overdueDays}일` : s.status === "behind" ? ` ${Math.round(s.gapPp)}%p` : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <p className="text-[0.76rem] text-ink-3">기준일 {fmtDate(today)} · 공정률은 현장 보고(공정별 진척)와 운영 관리에서 바뀝니다</p>
      </div>
    </Card>
  );
}
