"use client";

/** 본사 — 투입·인건비 (계약 모듈 04 · 검수 S4): 출력 인원 × 팀 단가 = 추정 vs 실제 노무비, 누락·불일치 표시 */
import { MetricTile } from "@/components/domain/Widgets";
import { useEffect, useState } from "react";
import { AlertTriangle, Download, Save } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { downloadCsv } from "@/lib/browser/download";
import { run } from "@/lib/data/store";
import { CommandError } from "@/lib/data/commands";
import { LABOR_FLAG_LABEL, laborEstimate, type LaborSite } from "@/lib/domain/labor";
import { shiftDate } from "@/lib/domain/attendance";
import { closeSites, monthBounds, previousMonth } from "@/lib/domain/monthClose";
import { fmtDate, fmtMan, todayIso } from "@/lib/domain/format";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, EmptyState, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { toCsv } from "@/lib/domain/csv";

export function LaborBoard() {
  const { db } = useMe();
  // 지난달(월 마감) — 지난달을 볼 방법이 없어 10월 노무를 엑셀로 맞추던 문제 (D-78 첫 달 리허설). ?month=YYYY-MM 로 바로 연다
  const [period, setPeriod] = useState<string>("30d");
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("month");
    if (m && /^\d{4}-\d{2}$/.test(m)) setPeriod(m === todayIso().slice(0, 7) ? "month" : m === previousMonth(todayIso()) ? "last" : `m:${m}`);
  }, []);
  if (!db) return <PageSkeleton />;
  const today = todayIso();
  const picked = period === "last" ? previousMonth(today) : period.startsWith("m:") ? period.slice(2) : null;
  const from = picked ? monthBounds(picked).from : period === "month" ? `${today.slice(0, 8)}01` : shiftDate(today, -29);
  const to = picked ? monthBounds(picked).to : today;
  // 그 기간에 일한 현장 — 이미 준공한 현장도 (지난달에 끝난 현장의 노무가 빠지던 문제)
  const rows = closeSites(db, from, to).map((s) => laborEstimate(db, s, from, to)).filter((r) => r.site.status === "active" || r.teams.length > 0 || r.actual > 0);
  const csv = () => {
    const head = ["현장", "기간", "팀", "구분", "출력 일수", "인원일", "1인 1일 단가", "추정 인건비", "단가 설정"];
    const lines = rows.flatMap((r) => r.teams.map((t) => [r.site.shortName, `${r.compareFrom}~${r.to}`, t.team, t.kind === "direct" ? "직영" : "외주", t.days, t.personDays, t.dayRate, t.estimate, t.rateSet ? "팀 단가" : "기본 일당"]));
    const sum = rows.map((r) => [r.site.shortName, `${r.compareFrom}~${r.to}`, "합계", "", "", r.teams.reduce((a, t) => a + t.personDays, 0), "", r.estimate, `실제 노무비 ${r.actual}`]);
    downloadCsv(`투입인건비_${from}_${to}.csv`, toCsv([head, ...lines, [], ...sum]));
  };
  return (
    <PageBody>
      <PageHeader
        title="투입·인건비"
        desc="작업 인원(출력) 인원일 × 팀 단가로 인건비를 추정하고, 실제로 입력된 노무비와 나란히 보여줍니다. 추정은 확정 노무비·급여가 아니며, 누락·불일치를 찾는 용도입니다."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="기간"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "30d", label: "최근 30일", testId: "labor-30d" },
                { value: "month", label: "이번 달", testId: "labor-month" },
                { value: "last", label: "지난달", testId: "labor-last" },
                ...(period.startsWith("m:") ? [{ value: period, label: `${Number(period.slice(7))}월` }] : []),
              ]}
            />
            <Button size="sm" icon={<Download size={15} />} onClick={csv} data-testid="labor-csv">
              CSV
            </Button>
          </div>
        }
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState title="진행 중인 현장이 없습니다" />
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {rows.map((r) => (
            <SiteLabor key={r.site.id} r={r} />
          ))}
        </div>
      )}
      <Notice tone="info" title="계산 방법">
        추정 인건비 = 작업 인원(출력) 인원일 × 팀 기준 단가 (팀 단가가 없으면 회사 기본 일당). 실제 노무비 = 현장 보고·CSV·공무 확인으로 들어온 노무비(확인 대기 포함, 취소·반려 제외). 비교는 출력 기록을 쓰기 시작한 날부터입니다. 차이가 50만 원 이상이면서 20% 넘게 나면 ‘확인 필요’로 표시합니다. 급여·법정 근로시간 확정은 이 화면의 범위가 아닙니다.
      </Notice>
    </PageBody>
  );
}

function SiteLabor({ r }: { r: LaborSite }) {
  const { db } = useMe();
  const toast = useToast();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const diff = r.actual - r.estimate;
  const budgetPct = r.laborBudget > 0 ? Math.round((r.laborToDate / r.laborBudget) * 100) : null;
  const empty = r.teams.length === 0 && r.actual === 0;
  const saveRates = async () => {
    if (!db) return;
    const changed = Object.entries(edit).filter(([, v]) => v.trim());
    if (!changed.length) return;
    setBusy(true);
    try {
      const current = new Map((db.settings?.teamRates ?? []).map((t) => [t.team.toLowerCase(), t]));
      for (const [team, v] of changed) current.set(team.toLowerCase(), { team, dayRate: Number(v.replace(/[^\d]/g, "")) * 10_000 });
      await run("setCompanySettings", { teamRates: [...current.values()] });
      setEdit({});
      toast.push({ tone: "ok", title: "팀 단가를 저장했습니다" });
    } catch (e) {
      toast.push({ tone: "err", title: e instanceof CommandError ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="labor-site" data-site={r.site.id}>
      <CardHeader
        title={`${r.site.shortName} · ${r.site.workType}`}
        sub={
          <span className="num">
            비교 기간 {fmtDate(r.compareFrom)} ~ {fmtDate(r.to)}
            {r.compareFrom !== r.from ? " (출력 기록 시작일부터)" : ""}
          </span>
        }
      />
      <div className="space-y-3 px-5 pb-5">
        {empty ? (
          <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.84rem] text-ink-2" data-testid="labor-empty">
            이 기간 작업 인원(출력) 기록과 노무비 입력이 모두 없습니다. 현장소장 휴대폰의 ‘오늘 작업 인원 알리기’로 출력이 쌓이면 추정이 시작됩니다.
          </p>
        ) : (
        <div className="grid gap-2 @min-[760px]:grid-cols-3">
          <Stat label="추정 인건비 (출력 기준)" value={fmtMan(r.estimate)} sub={`${r.teams.reduce((a, t) => a + t.personDays, 0)}명·일`} testId="labor-estimate" />
          <Stat label="실제 입력 노무비" value={fmtMan(r.actual)} sub={r.actualPending ? `이 중 공무 확인 대기 ${fmtMan(r.actualPending)}` : r.reportedManDays ? `보고 공수 ${r.reportedManDays}` : "같은 기간"} testId="labor-actual" />
          {r.teams.length === 0 ? (
            <Stat label="차이 (실제 − 추정)" value="비교 불가" sub="출력 기록이 없어 추정할 수 없습니다" testId="labor-diff" />
          ) : (
          <Stat label="차이 (실제 − 추정)" value={`${diff > 0 ? "+" : diff < 0 ? "−" : ""}${fmtMan(Math.abs(diff))}`} sub={budgetPct !== null ? `노무 실행예산 대비 누계 ${budgetPct}%` : "실행예산 없음"} tone={r.flags.some((f) => ["actual_over", "estimate_over", "no_actual", "no_crew"].includes(f.kind)) ? "err" : "ok"} testId="labor-diff" />
          )}
        </div>
        )}
        {r.flags.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-warn-bg px-3.5 py-2.5 text-[0.84rem]" data-testid="labor-flags">
            {r.flags.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5" data-kind={f.kind}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                <span>
                  <b>{LABOR_FLAG_LABEL[f.kind]}</b> · {f.text}
                </span>
              </li>
            ))}
          </ul>
        )}
        {r.teams.length === 0 ? (
          !empty && <p className="text-[0.84rem] text-ink-3">이 기간 작업 인원(출력) 기록이 없습니다. 현장소장 휴대폰 ‘오늘 작업 인원 알리기’로 쌓입니다.</p>
        ) : (
          <div tabIndex={0} role="region" aria-label="팀별 인건비 표 (가로 스크롤)" className="relative overflow-x-auto">
            <table className="w-full min-w-[38rem] text-[0.84rem]">
              <thead>
                <tr className="text-left text-[0.74rem] text-ink-3">
                  {["팀", "출력 일수", "인원일", "1인 1일 단가 (만 원)", "추정 인건비"].map((h) => (
                    <th key={h} className="py-2 pr-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.teams.map((t) => (
                  <tr key={t.team} className="border-t border-line" data-testid="labor-team">
                    <td className="py-2 pr-3 font-semibold">
                      {t.team} <span className="text-[0.74rem] text-ink-3">{t.kind === "direct" ? "직영" : "외주"}</span>
                    </td>
                    <td className="num py-2 pr-3">{t.days}일</td>
                    <td className="num py-2 pr-3">{t.personDays}명·일</td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="block w-20 shrink-0">
                          <input
                            inputMode="numeric"
                            aria-label={`${t.team} 단가 (만 원)`}
                            className={cx(inputCls, "num h-9 py-1 text-right")}
                            value={edit[t.team] ?? String(Math.round(t.dayRate / 10_000))}
                            onChange={(e) => setEdit({ ...edit, [t.team]: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                            data-testid="labor-rate"
                          />
                        </span>
                        {!t.rateSet && <Badge tone="warn">기본 일당</Badge>}
                      </span>
                    </td>
                    <td className="num py-2 pr-3 font-bold">{fmtMan(t.estimate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.keys(edit).length > 0 && (
              <Button size="sm" variant="cta" className="mt-2" icon={<Save size={15} />} loading={busy} onClick={saveRates} data-testid="labor-rate-save">
                단가 저장
              </Button>
            )}
          </div>
        )}
        <p className="text-[0.8rem] text-ink-2" data-testid="labor-staff">
          직원 출퇴근 {r.staffDays}명·일 · 근무 {Math.floor(r.staffMinutes / 60)}시간 {r.staffMinutes % 60}분
          {r.noCheckout ? ` · 퇴근 누락 ${r.noCheckout}건 (시간 불확실)` : ""} — 직원 급여는 이 추정에 넣지 않습니다
        </p>
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: "ok" | "err"; testId?: string }) {
  return <MetricTile label={label} value={value} sub={sub} tone={tone === "ok" ? undefined : tone} testId={testId} compact />;
}
