"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ListChecks, ChevronRight, HardHat } from "lucide-react";
import { useMe, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Card, CardHeader, DemoBadge, EmptyState, PageSkeleton, ProgressBar, cx } from "@/components/ui/primitives";
import { FieldReportForm } from "./FieldReportForm";
import { CostEntryList } from "./CostEntryList";
import { fmtDate, fmtRelative } from "@/lib/domain/format";
import { Clock } from "@/components/shell/Clock";
import { ROLE_LABEL } from "@/lib/domain/labels";

/** /field — 현장직원 홈 (현장직원 역할의 /dashboard에서도 이 화면을 사용) */
export function FieldHome() {
  const { db, role, userId, user } = useMe();
  const mySites = useMemo(() => (!db ? [] : role === "field" ? db.sites.filter((s) => s.fieldUserId === userId) : db.sites), [db, role, userId]);
  const [selected, setSelected] = useState<string | null>(null);
  if (!db) return <PageSkeleton />;
  const siteId = selected ?? mySites[0]?.id;
  const site = db.sites.find((s) => s.id === siteId);
  const myActions = db.actions.filter((a) => a.assigneeUserId === userId && ["assigned", "in_progress"].includes(a.status));
  const reports = db.reports.filter((r) => (role === "field" ? r.createdBy === userId : true)).slice(0, 8);
  const myEntries = db.costEntries
    .filter((e) => e.source !== "SEED" && (role === "field" ? e.createdBy === userId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Clock compact /> <DemoBadge compact />
          </span>
        }
        title="현장 보고"
        desc={
          role === "field"
            ? `${user?.name} ${user?.title}님, 오늘 작업과 추가 비용을 한 번에 입력하면 본사 손익에 바로 반영됩니다.`
            : `${ROLE_LABEL[role]} 화면에서 현장 보고를 대리 입력합니다 (PC 입력으로 기록).`
        }
      />

      {myActions.length > 0 && (
        <Link href="/my-actions" className="lift flex items-center gap-3 rounded-2xl border border-active/40 bg-active-soft px-4 py-3" data-testid="field-actions-banner">
          <ListChecks size={22} className="text-theme-ink" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[0.92rem] font-bold text-ink">배정된 조치 {myActions.length}건</span>
            <span className="block truncate text-[0.8rem] text-ink-2">{myActions[0].title}</span>
          </span>
          <ChevronRight size={20} className="text-ink-3" />
        </Link>
      )}

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" role="tablist" aria-label="담당 현장">
        {mySites.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === siteId}
            onClick={() => setSelected(s.id)}
            className={cx(
              "press min-w-[12rem] shrink-0 rounded-2xl border px-4 py-3 text-left",
              s.id === siteId ? "border-active bg-surface shadow-card ring-2 ring-active/25" : "border-line bg-surface hover:bg-surface-2",
            )}
          >
            <span className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-ink-3">
              <HardHat size={14} aria-hidden /> {s.workType}
            </span>
            <span className="block text-[0.95rem] font-bold text-ink">{s.shortName}</span>
            <span className="mt-1.5 flex items-center gap-2">
              <ProgressBar value={s.progressPct} label={`${s.shortName} 공정률`} />
              <span className="text-[0.75rem] font-bold num">{s.progressPct}%</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 @min-[1000px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="현장 보고 작성" sub={site ? `${site.name}` : undefined} />
          <div className="px-5 pb-5">{site && <FieldReportForm key={site.id} fixedSiteId={site.id} />}</div>
        </Card>
        <div className="space-y-5">
          {site && (
            <Card>
              <CardHeader
                title="오늘 공정"
                sub="진행 중인 공정"
                right={
                  <Link href={`/sites/${site.id}`} className="press rounded-lg px-2 py-1 text-[0.78rem] font-bold text-theme-ink hover:bg-active-soft">
                    현장 상세
                  </Link>
                }
              />
              <ul className="space-y-3 px-5 pb-5">
                {site.stages.map((st, i) => (
                  <li key={st.id} className="flex items-center gap-3">
                    <span className={cx("grid size-8 shrink-0 place-items-center rounded-full text-[0.8rem] font-bold", st.progressPct === 100 ? "bg-ok-bg text-ok" : st.progressPct > 0 ? "bg-active-soft text-theme-ink" : "bg-surface-3 text-ink-3")}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[0.88rem] font-semibold">{st.name}</span>
                        <span className="text-[0.78rem] font-bold num">{st.progressPct}%</span>
                      </span>
                      <ProgressBar value={st.progressPct} className="mt-1" label={`${st.name} 진행률`} />
                      <span className="text-[0.7rem] text-ink-3 num">{fmtDate(st.startDate)} ~ {fmtDate(st.endDate)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="작성 이력 · 입력한 원가" sub="되돌리기·수정 가능 (무효 처리 시 이력 보존)" />
            <div className="px-5 pb-3">
              <CostEntryList db={db} entries={myEntries} showSite emptyText="아직 입력한 원가가 없습니다." />
            </div>
            <div className="border-t border-line px-5 py-3">
              <p className="mb-2 text-[0.8rem] font-bold text-ink-2">최근 현장 보고</p>
              {reports.length === 0 ? (
                <EmptyState title="작성한 보고가 없습니다." />
              ) : (
                <ul className="space-y-2">
                  {reports.map((r) => {
                    const s = db.sites.find((x) => x.id === r.siteId);
                    return (
                      <li key={r.id} className={cx("rounded-xl bg-surface-2 px-3 py-2 text-[0.8rem]", r.status === "voided" && "opacity-60")}>
                        <span className="flex flex-wrap items-center gap-1.5 text-ink-3">
                          <b className="text-ink">{s?.shortName}</b> {fmtDate(r.reportDate)} · {userLabel(db, r.createdBy)} · {fmtRelative(r.createdAt)}
                          {r.status === "voided" && <Badge>되돌림</Badge>}
                          {r.photoIds.length > 0 && <Badge tone="info">사진 {r.photoIds.length}</Badge>}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-ink-2">{r.workDone}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}
