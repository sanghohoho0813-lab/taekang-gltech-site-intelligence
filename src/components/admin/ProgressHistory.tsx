"use client";

/**
 * 공정 진행 이력 (본사 · D-71) — 현장 보고로 바뀐 단계 진행률과 엑셀로 옮긴 지난 기록을 날짜별로.
 * 공사일보·발주처 월간 보고서와 같은 기록을 읽는다. 금액 없음.
 * 엑셀로 옮긴 기록은 단계마다 ‘엑셀 이관’ 꼬리표, 앞 기록이 없는 첫 값은 ‘첫 기록’(0%에서 올라간 것으로 보이지 않게).
 * 본사는 그날 이관 기록을 지울 수 있다 (7일이 지나 통째 취소가 안 될 때 고치는 길 · 뒤 기록은 앞 값으로 다시 이어짐).
 */
import Link from "next/link";
import { useState } from "react";
import { ChevronDown, History, Trash2 } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { run } from "@/lib/data/store";
import { errorMessage } from "@/lib/data/commands";
import { useToast } from "@/components/ui/Toast";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { IMPORTED_LABEL, stageChangeText } from "@/lib/domain/dailylog";
import { progressHistory } from "@/lib/domain/partnerFeed";
import type { DemoDB, Site } from "@/lib/domain/types";
import { Badge, Button, Card, CardHeader, EmptyState, cx } from "@/components/ui/primitives";

const FIRST = 8;

export function ProgressHistory({ db, site }: { db: DemoDB; site: Site }) {
  const { role } = useMe();
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const removeDay = async (date: string) => {
    const ids = db.reports.filter((r) => r.siteId === site.id && r.reportDate === date && r.importBatchId && r.status !== "voided").map((r) => r.id);
    setBusy(true);
    try {
      for (const id of ids) await run("voidReport", { reportId: id });
      toast.push({ tone: "ok", title: `${fmtDate(date)} 엑셀 이관 기록을 지웠습니다`, desc: "지금 공정률은 그대로입니다. 바른 값은 자료 이관에서 다시 넣으세요." });
      setAsk(null);
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "지우지 못했습니다.") });
    } finally {
      setBusy(false);
    }
  };
  const days = progressHistory(db, site.id, todayIso());
  const hq = role === "ceo" || role === "manager";
  const shown = all ? days.slice(0, 120) : days.slice(0, FIRST);
  return (
    <Card data-testid="progress-history">
      <CardHeader
        title="공정 진행 이력"
        sub={`현장 보고로 바뀐 진행률${hq ? "과 엑셀로 옮긴 지난 기록" : ""} · 공사일보·발주처 월간 보고서와 같은 기록`}
        right={
          hq ? (
            <Link href="/data?kind=progress#import" className="press inline-flex min-h-11 items-center rounded-xl px-2 text-[0.82rem] font-bold text-theme-ink underline underline-offset-4" data-testid="progress-history-import">
              지난 기록 엑셀로 넣기
            </Link>
          ) : undefined
        }
      />
      {days.length === 0 ? (
        <EmptyState icon={<History size={26} />} title="아직 공정 진행 이력이 없습니다." desc="현장 보고로 단계 진행률이 바뀌면 여기에 날짜별로 쌓입니다." />
      ) : (
        <ol className="divide-y divide-line px-5 pb-3" data-testid="progress-history-list">
          {shown.map((d) => (
            <li key={d.date} className="grid gap-1 py-2.5 @min-[560px]:grid-cols-[8.5rem_1fr]" data-testid="progress-history-day" data-imported={d.imported ? "1" : "0"}>
              <div className="flex flex-wrap items-center gap-1.5 text-[0.8rem] font-semibold text-ink-2">
                <span className="num">{fmtDate(d.date)}</span>
                {d.imported && <Badge tone="neutral">{IMPORTED_LABEL}</Badge>}
                {hq && d.changes.some((c) => c.imported) && ask !== d.date && (
                  <button type="button" onClick={() => setAsk(d.date)} className="press inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[0.74rem] font-bold text-ink-3 hover:bg-surface-3 [@media(pointer:coarse)]:min-h-11" data-testid="progress-history-remove" aria-label={`${fmtDate(d.date)} 엑셀 이관 기록 지우기`}>
                    <Trash2 size={13} aria-hidden /> 지우기
                  </button>
                )}
              </div>
              {/* items-start: 날짜 칸이 두 줄이어도 조각이 세로로 늘어나지 않게 */}
              <p className="flex flex-wrap items-start gap-1.5">
                {d.changes.map((c) => (
                  <span key={c.stage} className={cx("num rounded-md px-2 py-0.5 text-[0.78rem] [overflow-wrap:anywhere]", c.first ? "border border-dashed border-line bg-surface-2" : "bg-surface-3")} data-testid="progress-history-change" data-first={c.first ? "1" : "0"}>
                    <b className="font-semibold">{c.stage}</b> {stageChangeText(c)}
                    {c.imported && !d.imported && <span className="ml-1 text-[0.7rem] font-bold text-ink-3">· {IMPORTED_LABEL}</span>}
                  </span>
                ))}
              </p>
              {ask === d.date && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-warn-bg px-2.5 py-1.5 text-[0.78rem] @min-[560px]:col-start-2" data-testid="progress-history-remove-ask">
                  <span className="font-semibold text-ink-2">이 날 엑셀 이관 기록을 지울까요? 현장 보고는 그대로 두고, 지금 공정률도 바뀌지 않습니다.</span>
                  <Button size="sm" variant="ghost" onClick={() => setAsk(null)} className="[@media(pointer:coarse)]:min-h-11">
                    그대로 두기
                  </Button>
                  <Button size="sm" variant="danger" loading={busy} onClick={() => removeDay(d.date)} className="[@media(pointer:coarse)]:min-h-11" data-testid="progress-history-remove-confirm">
                    지우기
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {days.length > FIRST && (
        <div className="px-5 pb-4">
          <Button size="sm" variant="ghost" icon={<ChevronDown size={15} className={cx("transition-transform", all && "rotate-180")} />} onClick={() => setAll((x) => !x)} className="[@media(pointer:coarse)]:min-h-11" data-testid="progress-history-more">
            {all ? "접기" : `모두 보기 (${days.length}개 날짜)`}
          </Button>
        </div>
      )}
    </Card>
  );
}
