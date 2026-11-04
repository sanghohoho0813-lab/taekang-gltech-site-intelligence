"use client";

/** 활동 이력 (계약 검수 S6 ‘변경이력·기본 내보내기’) — 누가·언제·무엇을 바꿨는지 회사 전체에서 찾기, CSV */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Download, Search } from "lucide-react";
import { useMe, userLabel } from "@/lib/data/hooks";
import { AUDIT_LIMIT, LOG_TYPE_LABEL, filterLogs, type AuditFilter } from "@/lib/domain/audit";
import { shiftDate } from "@/lib/domain/attendance";
import { toCsv } from "@/lib/domain/csv";
import { fmtDateTime, todayIso } from "@/lib/domain/format";
import type { ActivityLog } from "@/lib/domain/types";
import { downloadCsv } from "@/lib/browser/download";
import { IS_LIVE } from "@/lib/mode";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Notice, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";

type Period = "7" | "30" | "90" | "365";

export function AuditBoard() {
  const { db } = useMe();
  const [period, setPeriod] = useState<Period>("30");
  const [siteId, setSiteId] = useState("");
  const [userId, setUserId] = useState("");
  const [type, setType] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const to = todayIso();
  const from = shiftDate(to, -(Number(period) - 1));
  const filter: AuditFilter = useMemo(() => ({ from, to, siteId: siteId || undefined, userId: userId || undefined, type: type || undefined, q: q || undefined }), [from, to, siteId, userId, type, q]);
  const [server, setServer] = useState<{ logs: ActivityLog[]; truncated: boolean; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!IS_LIVE) return;
    const ctl = new AbortController();
    const p = new URLSearchParams({ from: filter.from, to: filter.to, ...(filter.siteId ? { site: filter.siteId } : {}), ...(filter.userId ? { user: filter.userId } : {}), ...(filter.type ? { type: filter.type } : {}), ...(filter.q ? { q: filter.q } : {}) });
    setLoading(true);
    fetch(`/api/activity?${p}`, { signal: ctl.signal, cache: "no-store" })
      .then(async (r) => (r.ok ? setServer(await r.json()) : setServer({ logs: [], truncated: false, error: (await r.json().catch(() => ({}))).error ?? "이력을 불러오지 못했습니다" })))
      .catch((e) => e?.name !== "AbortError" && setServer({ logs: [], truncated: false, error: "이력을 불러오지 못했습니다" }))
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [filter, db?.rev]);

  if (!db) return <PageSkeleton />;
  const result = IS_LIVE ? (server ?? { logs: [], truncated: false }) : filterLogs(db.activityLogs, filter);
  const site = (id?: string) => (id ? (db.sites.find((s) => s.id === id)?.shortName ?? "") : "");
  const csv = () =>
    downloadCsv(
      `활동이력_${from}_${to}.csv`,
      toCsv([["시각", "사람", "현장", "종류", "내용"], ...result.logs.map((l) => [fmtDateTime(l.at), userLabel(db, l.by), site(l.siteId), LOG_TYPE_LABEL[l.type] ?? l.type, l.summary])]),
    );
  const types = [...new Set([...Object.keys(LOG_TYPE_LABEL), ...db.activityLogs.map((l) => l.type)])];
  return (
    <PageBody>
      <PageHeader
        eyebrow={<DemoBadge compact />}
        title="활동 이력"
        desc="누가·언제·무엇을 바꿨는지 회사 전체에서 찾습니다. 이력은 지워지지 않습니다 (현장 보고·원가·출퇴근 정정·승인·설정·자료 가져오기 등)."
        right={
          <Button size="sm" icon={<Download size={15} />} onClick={csv} disabled={!result.logs.length} data-testid="audit-csv">
            CSV
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          <Segmented
            label="기간"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "7", label: "7일", testId: "audit-7" },
              { value: "30", label: "30일", testId: "audit-30" },
              { value: "90", label: "90일", testId: "audit-90" },
              { value: "365", label: "1년", testId: "audit-365" },
            ]}
          />
          <Select label="현장" value={siteId} onChange={setSiteId} testId="audit-site" options={[["", "전체 현장"], ...db.sites.map((s) => [s.id, s.shortName] as [string, string])]} />
          <Select label="사람" value={userId} onChange={setUserId} testId="audit-user" options={[["", "전체 사람"], ...db.users.map((u) => [u.id, `${u.name} ${u.title}`] as [string, string])]} />
          <Select label="종류" value={type} onChange={setType} testId="audit-type" options={[["", "전체 종류"], ...types.map((t) => [t, LOG_TYPE_LABEL[t] ?? t] as [string, string])]} />
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(qInput);
            }}
          >
            <label htmlFor="audit-q" className="sr-only">
              내용 검색
            </label>
            <input id="audit-q" className={cx(inputCls, "h-10 w-44 py-1")} value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="내용 검색" maxLength={60} data-testid="audit-q" />
            <Button size="sm" variant="ghost" type="submit" aria-label="검색" icon={<Search size={15} />} data-testid="audit-search" />
          </form>
        </div>
      </Card>
      {!IS_LIVE && <Notice tone="info">DEMO는 이 브라우저에 남은 최근 이력만 보입니다. 실제 운영에서는 서버에 쌓인 전체 이력(최대 1년)을 조건으로 찾습니다.</Notice>}
      {server?.error && <Notice tone="err">{server.error}</Notice>}
      <Card data-testid="audit-list">
        <CardHeader title={loading ? "불러오는 중…" : `${result.logs.length.toLocaleString("ko-KR")}건${result.truncated ? ` (최근 ${AUDIT_LIMIT.toLocaleString("ko-KR")}건까지 — 기간·조건을 줄이세요)` : ""}`} sub={`${from} ~ ${to}`} />
        {result.logs.length === 0 ? (
          <EmptyState title="조건에 맞는 이력이 없습니다" />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {result.logs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-5 py-2.5 text-[0.85rem]" data-testid="audit-row" data-type={l.type}>
                <span className="num w-36 shrink-0 text-[0.78rem] text-ink-3">{fmtDateTime(l.at)}</span>
                <span className="w-32 shrink-0 truncate font-semibold">{userLabel(db, l.by)}</span>
                <Badge tone="neutral">{LOG_TYPE_LABEL[l.type] ?? l.type}</Badge>
                {l.siteId && <span className="text-[0.78rem] font-bold text-ink-2">{site(l.siteId)}</span>}
                <span className="min-w-0 flex-1 basis-64 text-ink">{l.summary}</span>
                {l.link && (
                  <Link href={l.link} className="press shrink-0 rounded-lg px-1.5 py-0.5 text-[0.78rem] font-bold text-theme-ink hover:bg-active-soft" aria-label="해당 화면 열기">
                    <ChevronRight size={16} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageBody>
  );
}

function Select({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; testId: string }) {
  return (
    <label className="inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select className={cx(inputCls, "h-10 w-auto max-w-[12rem] py-1")} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
