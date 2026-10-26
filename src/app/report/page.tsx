"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Printer, ArrowRight } from "lucide-react";
import { useMe, useFinancials, usePortfolio, useSignals, userLabel } from "@/lib/data/hooks";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Notice, PageSkeleton, SeverityBadge, cx } from "@/components/ui/primitives";
import { Delta, MethodChip } from "@/components/domain/Widgets";
import { Clock } from "@/components/shell/Clock";
import { entryEacImpact, simulateApprovedClaims } from "@/lib/domain/calc";
import { ACTION_STATUS_LABEL, CATEGORY_LABEL, CO_STATUS_LABEL, IMPACT_LABEL, REASON_LABEL, RULE_LABEL } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime, fmtEok, fmtMan, fmtPct, fmtPp } from "@/lib/domain/format";
import { receivableAging } from "@/lib/domain/risk";

export default function ReportPage() {
  const { db } = useMe();
  const fin = useFinancials(db);
  const total = usePortfolio(db);
  const signals = useSignals(db);

  const base = useMemo(() => {
    if (!db) return null;
    const b = Object.values(db.baseline);
    const profit = b.reduce((s, x) => s + x.expectedProfit, 0);
    const adj = b.reduce((s, x) => s + x.adjustedContract, 0);
    return { profit, adj, margin: adj ? (profit / adj) * 100 : 0 };
  }, [db]);

  if (!db || !total || !base) return <PageSkeleton />;

  const sessionEntries = db.costEntries.filter((e) => e.source !== "SEED").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sessionReports = db.reports.filter((r) => !r.id.startsWith("rpt-seed")).slice(0, 10);
  const doneActions = db.actions.filter((a) => a.status === "done");
  const openActions = db.actions.filter((a) => ["recommended", "assigned", "in_progress", "on_hold"].includes(a.status));
  const unhandled = signals.filter((s) => !db.actions.some((a) => a.signalKey === s.key && a.status !== "dismissed"));

  // 핵심 요약 — 데이터에서 자동 생성 (사람이 지어낸 문장 아님)
  const bullets: { tone: "err" | "ok" | "warn" | "info"; text: string }[] = [];
  for (const s of db.sites) {
    const f = fin[s.id];
    const b = db.baseline[s.id];
    if (b && Math.abs(f.marginPct - b.marginPct) >= 0.05) {
      const add = sessionEntries.filter((e) => e.siteId === s.id && e.status === "active" && e.forecastImpact === "additional");
      const reasons = [...new Set(add.map((e) => REASON_LABEL[e.reason]))].join("·");
      bullets.push({
        tone: f.marginPct < b.marginPct ? "err" : "ok",
        text: `${s.shortName} 예상이익률 ${fmtPct(b.marginPct)} → ${fmtPct(f.marginPct)} (${fmtPp(f.marginPct - b.marginPct)}), 예상이익 ${fmtEok(b.expectedProfit)} → ${fmtEok(f.expectedProfit)}${add.length ? ` — ${reasons} 추가원가 ${fmtMan(add.reduce((x, e) => x + e.amount, 0))}` : ""}`,
      });
    }
  }
  for (const a of doneActions) {
    const s = db.sites.find((x) => x.id === a.siteId);
    bullets.push({ tone: "ok", text: `${s?.shortName} ‘${a.title}’ 완료${a.claimAmount ? ` — 변경공사 청구 검토 ${fmtMan(a.claimAmount)} 등록 (발주처 승인 전, 이익 미반영)` : ""}` });
  }
  for (const a of openActions.slice(0, 3)) {
    const s = db.sites.find((x) => x.id === a.siteId);
    bullets.push({ tone: "warn", text: `${s?.shortName} ‘${a.title}’ ${ACTION_STATUS_LABEL[a.status]} — 담당 ${userLabel(db, a.assigneeUserId)}` });
  }
  if (unhandled.length) bullets.push({ tone: "info", text: `조치가 없는 위험 신호 ${unhandled.length}건 — ${unhandled.slice(0, 2).map((s) => s.title).join(" / ")}` });
  if (!bullets.length) bullets.push({ tone: "info", text: "기준(데모 초기) 이후 손익 변화가 없습니다. 모바일 현장보고로 원가를 입력하면 이 보고서가 자동으로 갱신됩니다." });

  return (
    <PageBody className="print-full">
      <PageHeader
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <DemoBadge /> 생성 시각 <Clock />
          </span>
        }
        title="대표자 보고서 · 현장 수익 현황"
        desc="모든 수치는 저장된 원가·계약·기성 데이터에서 자동 계산됩니다. 기준 = 데모 초기 상태 (가상 시연 데이터 · 실제 실적 아님)."
        right={
          <Button icon={<Printer size={17} />} onClick={() => window.print()} className="no-print">
            인쇄 / PDF
          </Button>
        }
      />

      <Card className="print-card" data-tour="report-summary" data-testid="report-summary">
        <CardHeader title="1. 요약" sub="기준(데모 초기) 대비 현재" right={<MethodChip />} />
        <div className="grid grid-cols-2 gap-3 px-5 @min-[900px]:grid-cols-4">
          <Tile label="예상이익 합계" before={fmtEok(base.profit)} after={fmtEok(total.expectedProfit)} delta={<Delta value={total.expectedProfit - base.profit} format={(v) => fmtMan(v)} />} />
          <Tile label="평균 예상이익률" before={fmtPct(base.margin)} after={fmtPct(total.marginPct)} delta={<span className={cx("font-bold num", total.marginPct < base.margin - 0.05 ? "text-err" : "text-ink-3")}>{fmtPp(total.marginPct - base.margin)}</span>} />
          <Tile label="위험 신호" after={`${signals.length}건`} delta={<span className="text-ink-3">경고 {signals.filter((s) => s.severity === "high").length} · 주의 {signals.filter((s) => s.severity === "medium").length} · 확인 {signals.filter((s) => s.severity === "low").length}</span>} />
          <Tile label="조치 · Proof Event" after={`${doneActions.length}/${doneActions.length + openActions.length} 완료`} delta={<span className="text-ink-3">Proof {db.proofEvents.length}건 (확인 {db.proofEvents.filter((p) => p.status === "confirmed").length})</span>} />
        </div>
        <ul className="space-y-1.5 px-5 py-4" data-testid="report-bullets">
          {bullets.map((b, i) => (
            <li key={i} className={cx("flex gap-2 rounded-lg px-3 py-2 text-[0.86rem]", { err: "bg-err-bg", ok: "bg-ok-bg", warn: "bg-warn-bg", info: "bg-info-bg" }[b.tone])}>
              <span aria-hidden>•</span>
              <span className="text-ink">{b.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="print-card">
        <CardHeader title="2. 현장별 변경 전후 손익" sub="단위 억 원 · 부가세 별도 · 승인 전 변경공사는 이익 미반영" />
        <div tabIndex={0} role="region" aria-label="현장별 변경 전후 손익 표 (가로 스크롤)" className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[50rem] text-[0.84rem]" data-testid="report-compare">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-left text-[0.74rem] font-semibold text-ink-3">
                <th className="px-5 py-2.5">현장</th>
                <th className="px-3 py-2.5 text-right">조정 계약</th>
                <th className="px-3 py-2.5 text-right">EAC 기준 → 현재</th>
                <th className="px-3 py-2.5 text-right">예상이익 기준 → 현재</th>
                <th className="px-3 py-2.5 text-right">이익률 기준 → 현재</th>
                <th className="px-3 py-2.5 text-right">승인 대기 변경</th>
                <th className="px-5 py-2.5 text-right">미수금</th>
              </tr>
            </thead>
            <tbody>
              {db.sites.map((s) => {
                const f = fin[s.id];
                const b = db.baseline[s.id];
                const sim = simulateApprovedClaims(f);
                const changed = b && b.eac !== f.eac;
                return (
                  <tr key={s.id} className={cx("border-b border-line", changed && "bg-err-bg/40")}>
                    <td className="px-5 py-2.5 font-bold">
                      <Link href={`/sites/${s.id}`} className="hover:text-theme-ink hover:underline">
                        {s.shortName}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right num">{fmtEok(f.adjustedContract, { unit: false })}</td>
                    <td className="px-3 py-2.5 text-right num">
                      {fmtEok(b.eac, { unit: false })} → <b>{fmtEok(f.eac, { unit: false })}</b>
                    </td>
                    <td className="px-3 py-2.5 text-right num">
                      {fmtEok(b.expectedProfit, { unit: false })} → <b className={cx(f.expectedProfit < b.expectedProfit && "text-err")}>{fmtEok(f.expectedProfit, { unit: false })}</b>
                    </td>
                    <td className="px-3 py-2.5 text-right num">
                      {fmtPct(b.marginPct)} → <b className={cx(f.marginPct < b.marginPct - 0.05 && "text-err")}>{fmtPct(f.marginPct)}</b>
                    </td>
                    <td className="px-3 py-2.5 text-right num">
                      {f.pendingChangeAmount ? (
                        <>
                          {fmtMan(f.pendingChangeAmount)}
                          <span className="block text-[0.7rem] text-ink-3">승인 시 {fmtPct(sim.marginPct)} (시뮬레이션)</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-2.5 text-right num">{fmtEok(f.outstanding, { unit: false })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 @min-[1000px]:grid-cols-2">
        <Card className="print-card">
          <CardHeader title="3. 관련 현장보고 · 원가 이벤트" sub="데모 초기 이후 입력분" />
          {sessionEntries.length === 0 && sessionReports.length === 0 ? (
            <EmptyState title="입력된 현장보고가 없습니다." action={<Link href="/field"><Button size="sm" icon={<ArrowRight size={15} />}>현장 보고</Button></Link>} />
          ) : (
            <ul className="divide-y divide-line px-5 pb-3" data-testid="report-entries">
              {sessionEntries.map((e) => {
                const s = db.sites.find((x) => x.id === e.siteId);
                const report = db.reports.find((r) => r.id === e.reportId);
                const impact = entryEacImpact(db, e);
                return (
                  <li key={e.id} className={cx("py-2.5 text-[0.84rem]", e.status === "voided" && "opacity-55")}>
                    <p className="flex flex-wrap items-center gap-1.5">
                      <b>{s?.shortName}</b> {CATEGORY_LABEL[e.category]} <b className="num">{fmtMan(e.amount)}</b>
                      <Badge tone={e.forecastImpact === "additional" ? "err" : "neutral"}>{IMPACT_LABEL[e.forecastImpact]}</Badge>
                      {e.status === "voided" ? <Badge>무효</Badge> : <span className="text-[0.74rem] font-bold text-err num">EAC {impact ? `+${fmtMan(impact)}` : "변동 없음"}</span>}
                    </p>
                    <p className="text-[0.75rem] text-ink-3">
                      {fmtDateTime(e.createdAt)} · {REASON_LABEL[e.reason]} · {userLabel(db, e.createdBy)}
                    </p>
                    {report?.workDone && <p className="mt-0.5 line-clamp-2 text-[0.78rem] text-ink-2">현장보고: {report.workDone}</p>}
                  </li>
                );
              })}
              {sessionReports
                .filter((r) => r.costEntryIds.length === 0)
                .map((r) => (
                  <li key={r.id} className="py-2.5 text-[0.82rem]">
                    <b>{db.sites.find((x) => x.id === r.siteId)?.shortName}</b> 현장보고 (원가 없음) · <span className="text-ink-3">{fmtDateTime(r.createdAt)}</span>
                    <p className="line-clamp-1 text-ink-2">{r.workDone}</p>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card className="print-card">
          <CardHeader title="4. 위험 분석" sub="규칙 기반 진단 — 실제 AI 모델 아님" />
          {signals.length === 0 ? (
            <EmptyState title="위험 신호 없음" />
          ) : (
            <ul className="divide-y divide-line px-5 pb-3">
              {signals.map((s) => (
                <li key={s.key} className="py-2.5 text-[0.84rem]">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={s.severity} /> <b>{s.title}</b>
                  </p>
                  <p className="text-[0.75rem] text-ink-3">
                    {RULE_LABEL[s.rule]} · 기준: {s.threshold} · 권장: {s.recommendation.actionTitle}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="print-card">
        <CardHeader title="5. 조치 상태 · Proof Event" sub="Trigger → Decision → 사람 승인 → Action → Result → KPI 전후" right={<Link href="/evidence" className="no-print"><Button size="sm">Evidence 전체</Button></Link>} />
        {db.actions.length === 0 ? (
          <EmptyState title="조치가 없습니다." />
        ) : (
          <div tabIndex={0} role="region" aria-label="조치 상태 표 (가로 스크롤)" className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[48rem] text-[0.83rem]" data-testid="report-actions">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-[0.74rem] font-semibold text-ink-3">
                  <th className="px-5 py-2.5">조치</th>
                  <th className="px-3 py-2.5">현장</th>
                  <th className="px-3 py-2.5">담당</th>
                  <th className="px-3 py-2.5">상태</th>
                  <th className="px-3 py-2.5">결과</th>
                  <th className="px-5 py-2.5">Proof Event</th>
                </tr>
              </thead>
              <tbody>
                {db.actions.map((a) => {
                  const p = db.proofEvents.find((x) => x.proof_event_id === a.proofEventId);
                  return (
                    <tr key={a.id} className="border-b border-line align-top">
                      <td className="px-5 py-2.5 font-semibold">{a.title}</td>
                      <td className="px-3 py-2.5">{db.sites.find((s) => s.id === a.siteId)?.shortName}</td>
                      <td className="px-3 py-2.5">{userLabel(db, a.assigneeUserId)}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={a.status === "done" ? "ok" : "theme"}>{ACTION_STATUS_LABEL[a.status]}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-ink-2">{a.result ?? "—"}</td>
                      <td className="px-5 py-2.5 text-[0.76rem]">
                        {p ? (
                          <>
                            <Badge tone={p.status === "confirmed" ? "ok" : "warn"}>{p.status === "confirmed" ? "결과 확인" : "확인 대기"}</Badge>
                            <span className="mt-1 block num text-ink-3">
                              이익률 {String(p.kpi_before["예상이익률"])} → {String(p.kpi_after["예상이익률"])} · 대응 {p.response_minutes ? `${p.response_minutes}분` : "1분 미만"}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 @min-[1000px]:grid-cols-2">
        <Card className="print-card">
          <CardHeader title="6. 미수 · 변경공사" />
          <ul className="divide-y divide-line px-5 pb-3 text-[0.84rem]">
            {db.sites.map((s) => {
              const aging = receivableAging(db, s.id);
              const cos = db.changeOrders.filter((c) => c.siteId === s.id);
              return (
                <li key={s.id} className="py-2.5">
                  <p>
                    <b>{s.shortName}</b> 미수 <b className="num">{fmtEok(fin[s.id].outstanding)}</b>
                    {aging.map((a) => (
                      <span key={a.billingId} className={cx("ml-1.5 text-[0.75rem] num", a.ageDays > db.thresholds.receivableDays ? "font-bold text-err" : "text-ink-3")}>
                        ({a.round}차 {fmtMan(a.unpaid)} · {a.ageDays}일)
                      </span>
                    ))}
                  </p>
                  {cos.map((c) => (
                    <p key={c.id} className="text-[0.76rem] text-ink-3">
                      변경공사 「{c.title}」 {fmtMan(c.amount)} · {CO_STATUS_LABEL[c.status]} · {fmtDate(c.requestedAt)}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="print-card">
          <CardHeader title="7. 다음 권장 조치 (규칙 기반)" />
          {unhandled.length === 0 ? (
            <EmptyState title="모든 위험 신호에 조치가 배정되었습니다." />
          ) : (
            <ul className="space-y-2 px-5 pb-4">
              {unhandled.map((s) => (
                <li key={s.key} className="rounded-lg bg-surface-2 px-3 py-2 text-[0.84rem]">
                  <b>{s.recommendation.actionTitle}</b> <span className="text-ink-3">— {s.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Notice tone="warn" title="보고서 해석 주의">
        본 보고서는 DEMO(가상 시연 데이터)와 규칙 기반 계산 결과이며, AI 모델 예측이나 실증 성과가 아닙니다. 실제 개선율은 Baseline 확보 후 12주 실증에서만 산출합니다.
      </Notice>
    </PageBody>
  );
}

function Tile({ label, before, after, delta }: { label: string; before?: string; after: string; delta?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-[0.75rem] font-semibold text-ink-3">{label}</p>
      {before && <p className="num text-[0.78rem] text-ink-3">기준 {before}</p>}
      <p className="text-[1.35rem] font-extrabold leading-tight num">{after}</p>
      {delta && <p className="mt-0.5 text-[0.76rem]">{delta}</p>}
    </div>
  );
}
