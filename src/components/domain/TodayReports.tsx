"use client";

/** 대표·관리자 — 오늘 현장 보고 현황 (어느 현장이 아직 보고하지 않았는지) */
import Link from "next/link";
import { CircleCheck, Clock3, ChevronRight } from "lucide-react";
import type { DemoDB } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { userLabel } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { Card, CardHeader, cx } from "@/components/ui/primitives";

function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);
}

export function TodayReports({ db }: { db: DemoDB }) {
  const today = todayIso();
  // 아직 착공 전인 현장은 ‘오늘 보고 없음’으로 세지 않는다 (D-77 리허설)
  const sites = db.sites.filter((s) => s.status === "active" && s.startDate <= today);
  if (sites.length === 0) return null;
  const pending = db.costEntries.filter((e) => e.status === "pending").length;
  const rows = sites.map((s) => {
    // 엑셀로 옮긴 지난 기록은 ‘마지막 보고’로 치지 않는다 (보고 끊긴 날수가 가려지던 문제 · D-71 점검 반영)
    const reports = db.reports.filter((r) => r.siteId === s.id && r.status !== "voided" && !r.importBatchId);
    const todays = reports.filter((r) => r.reportDate === today);
    const last = reports.map((r) => r.reportDate).sort().at(-1);
    const photos = todays.reduce((n, r) => n + r.photoIds.length, 0);
    const costs = todays.reduce((n, r) => n + r.costEntryIds.length, 0);
    const att = (db.attendance ?? []).filter((a) => a.siteId === s.id && a.workDate === today);
    const attIssue = att.some((a) => a.inGeo.status !== "inside");
    return { s, todays, last, photos, costs, att, attIssue };
  });
  const missing = rows.filter((r) => r.todays.length === 0).length;
  return (
    <Card data-testid="today-reports">
      <CardHeader
        title="오늘 현장 출근·보고"
        sub={missing ? `${rows.length}곳 중 ${missing}곳 아직 보고 없음` : `${rows.length}곳 모두 보고함`}
        right={
          <span className="flex flex-wrap items-center gap-1">
            {IS_LIVE && pending > 0 && (
              <Link href="/admin?tab=review" className="press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.8rem] font-bold text-theme-ink hover:bg-active-soft" data-testid="today-pending">
                공무 확인 대기 {pending}건 <ChevronRight size={15} />
              </Link>
            )}
            <Link href="/attendance" className="press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.8rem] font-bold text-theme-ink hover:bg-active-soft" data-testid="today-att-link">
              출퇴근 현황 <ChevronRight size={15} />
            </Link>
            <Link href="/schedule" className="press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.8rem] font-bold text-theme-ink hover:bg-active-soft" data-testid="today-sched-link">
              공정 일정 <ChevronRight size={15} />
            </Link>
            <Link href="/daily" className="press inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[0.8rem] font-bold text-theme-ink hover:bg-active-soft" data-testid="today-daily-link">
              공사일보 <ChevronRight size={15} />
            </Link>
          </span>
        }
      />
      <ul className="divide-y divide-line border-t border-line">
        {rows.map(({ s, todays, last, photos, costs, att, attIssue }) => {
          const ok = todays.length > 0;
          const gap = last ? daysBetween(last, today) : null;
          return (
            <li key={s.id}>
              <Link href={`/sites/${s.id}`} className="row-hover flex items-center gap-3 px-5 py-3" data-testid="today-report-row" data-reported={ok ? "1" : "0"}>
                {ok ? <CircleCheck size={20} className="shrink-0 text-ok" aria-hidden /> : <Clock3 size={20} className="shrink-0 text-warn" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.92rem] font-bold">{s.shortName}</span>
                  <span className="block truncate text-[0.78rem] text-ink-3">현장 담당 {userLabel(db, s.fieldUserId)}</span>
                  {/* 출근 상태는 따로 한 줄 — 휴대폰에서 이름 뒤로 잘려 안 보이던 문제 (D-65) */}
                  <span className={cx("block text-[0.78rem] font-semibold", att.length === 0 ? "text-warn" : attIssue ? "text-err" : "text-ok")} data-testid="today-att">
                    {att.length === 0 ? "출근 기록 없음" : attIssue ? `출근 ${att.length}명 · 위치 확인 필요` : `출근 ${att.length}명 · 현장 안`}
                  </span>
                </span>
                <span className={cx("shrink-0 text-right text-[0.8rem] font-semibold", ok ? "text-ok" : "text-warn")}>
                  {ok ? `보고 ${todays.length}건${photos ? ` · 사진 ${photos}` : ""}${costs ? ` · 비용 ${costs}` : ""}` : gap === null ? "보고 기록 없음" : gap === 1 ? "보고는 어제가 마지막" : `보고 ${gap}일째 없음`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
