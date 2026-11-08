"use client";

/**
 * 공정 변화 기록 (본사 · D-71) — 현장 보고로 바뀐 단계 진행률과 엑셀로 옮긴 지난 기록을 날짜별로.
 * 발주처 월간 보고서·공사일보와 같은 기록을 읽는다. 금액 없음.
 */
import Link from "next/link";
import { useState } from "react";
import { History } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { progressHistory } from "@/lib/domain/partnerFeed";
import type { DemoDB, Site } from "@/lib/domain/types";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui/primitives";

const FIRST = 8;

export function ProgressHistory({ db, site }: { db: DemoDB; site: Site }) {
  const { role } = useMe();
  const [all, setAll] = useState(false);
  const days = progressHistory(db, site.id, todayIso());
  const hq = role === "ceo" || role === "manager";
  const shown = all ? days.slice(0, 120) : days.slice(0, FIRST);
  return (
    <Card data-testid="progress-history">
      <CardHeader
        title="공정 변화 기록"
        sub="현장 보고로 바뀐 진행률과 엑셀로 옮긴 지난 기록 · 공사일보·발주처 월간 보고서와 같은 기록"
        right={
          hq ? (
            <Link href="/data" className="press inline-flex min-h-11 items-center rounded-xl px-2 text-[0.82rem] font-bold text-theme-ink underline underline-offset-4" data-testid="progress-history-import">
              지난 기록 엑셀로 넣기
            </Link>
          ) : undefined
        }
      />
      {days.length === 0 ? (
        <EmptyState icon={<History size={26} />} title="아직 공정 변화 기록이 없습니다." desc="현장 보고로 단계 진행률이 바뀌면 여기에 날짜별로 쌓입니다." />
      ) : (
        <ol className="divide-y divide-line px-5 pb-3" data-testid="progress-history-list">
          {shown.map((d) => (
            <li key={d.date} className="grid gap-1 py-2.5 @min-[560px]:grid-cols-[8.5rem_1fr]" data-testid="progress-history-day" data-imported={d.imported ? "1" : "0"}>
              <p className="flex flex-wrap items-center gap-1.5 text-[0.8rem] font-semibold text-ink-2">
                <span className="num">{fmtDate(d.date)}</span>
                {d.imported && <Badge tone="neutral">지난 기록</Badge>}
              </p>
              <p className="flex flex-wrap gap-1.5">
                {d.changes.map((c) => (
                  <span key={c.stage} className="num rounded-md bg-surface-3 px-2 py-0.5 text-[0.78rem] [overflow-wrap:anywhere]">
                    <b className="font-semibold">{c.stage}</b> {c.from}% → {c.to}%
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ol>
      )}
      {days.length > FIRST && (
        <div className="px-5 pb-4">
          <Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)} data-testid="progress-history-more">
            {all ? "접기" : `전체 ${days.length}일 보기`}
          </Button>
        </div>
      )}
    </Card>
  );
}
