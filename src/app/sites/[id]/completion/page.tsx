"use client";

/**
 * 준공 보고서 (발주처 제출용 · D-72) — 본사가 인쇄·PDF로 발주처에 낸다.
 * 공사 기간 전체: 개요 · 공정 단계별 완료일 · 월별 공정률 · 공개한 공정 사진 · 하자 처리 · 하자보증(계약서 기준).
 * 금액·사람 이름·현장 메모 없음. 기록에 없는 값은 ‘기록 없음’.
 */
import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock, Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { completionReport } from "@/lib/domain/completion";
import { Badge, Button, DemoBadge, EmptyState, PageSkeleton, ProgressBar, cx } from "@/components/ui/primitives";
import { LogoMark } from "@/components/shell/Logo";

const monthLabel = (m: string) => `${m.slice(0, 4)}.${m.slice(5, 7)}`;

export default function CompletionReportPage() {
  const { id } = useParams<{ id: string }>();
  const { db, role } = useMe();
  const today = todayIso();
  const r = useMemo(() => (db ? completionReport(db, id, today) : null), [db, id, today]);
  if (!db) return <PageSkeleton />;
  if (role !== "ceo" && role !== "manager")
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <EmptyState icon={<Lock size={26} />} title="본사만 볼 수 있습니다" desc="준공 보고서는 본사가 발주처에 내는 문서입니다." />
      </div>
    );
  if (!r) return <EmptyState title="현장을 찾을 수 없습니다" action={<Link href="/sites"><Button>현장 관리로</Button></Link>} />;
  const { site } = r;
  const done = r.stages.filter((s) => s.progressPct >= 100).length;
  return (
    <>
      {/* 본사 화면 안에서 연다 (메뉴·가상 데이터 표시는 화면 틀이 맡고, 인쇄하면 문서만 나온다) */}
      <div className="bg-[#F6F5F3] print:bg-white" data-testid="completion-report">
        <header className="no-print border-b border-line bg-surface/95">
          <div className="mx-auto flex min-h-16 max-w-[960px] flex-wrap items-center gap-2 px-4 py-2">
            <Link href={`/sites/${site.id}?tab=requests`} className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[0.9rem] font-bold text-ink-2 hover:bg-surface-3" data-testid="completion-back">
              <ArrowLeft size={17} aria-hidden /> {site.shortName}
            </Link>
            <span className="text-[0.8rem] text-ink-3">발주처 제출용 · 금액 없음</span>
            <span className="ml-auto flex items-center gap-2">
              <DemoBadge compact />
              <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="completion-print">
                인쇄·PDF
              </Button>
            </span>
          </div>
        </header>
        <div className="mx-auto max-w-[960px] px-4 py-6 print:max-w-none print:p-0">
          {!r.completedDate && (
            <p className="no-print mb-3 rounded-xl bg-warn-bg px-3.5 py-2 text-[0.84rem] font-semibold text-ink-2" data-testid="completion-not-done">
              아직 준공(인도)일이 없습니다 — 작성일 기준 ‘중간 정리’로 나옵니다. 준공하면 현장 상세 ‘발주처·하자보증’에서 준공일을 넣으세요.
            </p>
          )}
          <article className="rounded-2xl border border-line bg-surface p-6 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-8" data-testid="completion-body">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink pb-4">
              <div className="flex items-center gap-3">
                <LogoMark size={34} />
                <div>
                  <p className="text-[0.8rem] font-extrabold tracking-[0.06em] text-ink-2">TAEKANG GLTECH</p>
                  <h1 className="text-[1.45rem] font-extrabold leading-tight">{r.completedDate ? "준공 보고서" : "공사 진행 정리 (준공 전)"}</h1>
                </div>
              </div>
              <div className="text-right text-[0.85rem]">
                <p className="font-bold" data-testid="completion-site">{site.name}</p>
                <p className="text-ink-2">{site.clientName}</p>
                <p className="num text-ink-2">작성일 {fmtDate(today)}</p>
                {!IS_LIVE && <p className="mt-0.5 text-[0.74rem] font-bold text-[#7A5200]">DEMO · 가상 시연 데이터</p>}
              </div>
            </header>

            <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="요약">
              <Kpi label="공사 기간" value={`${fmtDate(r.from)} ~`} sub={r.completedDate ? `준공 ${fmtDate(r.completedDate)}` : `준공 예정 ${fmtDate(site.endDate)}`} testId="completion-kpi-period" />
              <Kpi label="공정률" value={`${site.progressPct}%`} sub={`공정 단계 ${done}/${r.stages.length} 완료`} testId="completion-kpi-progress" />
              <Kpi label="현장 보고" value={`${r.reportDays}일`} sub="앱으로 보고한 날" testId="completion-kpi-reports" />
              <Kpi label="하자 처리" value={`${r.defects.total - r.defects.open}/${r.defects.total}건`} sub={r.defects.open ? `진행 중 ${r.defects.open}건` : "남은 하자 없음"} testId="completion-kpi-defects" />
            </section>

            <Section title="1. 공사 개요">
              <dl className="grid gap-x-6 gap-y-1.5 text-[0.86rem] sm:grid-cols-2" data-testid="completion-overview">
                <Row k="현장명" v={site.name} />
                <Row k="발주처" v={site.clientName} />
                <Row k="공종" v={site.workType} />
                <Row k="지역" v={site.region || "—"} />
                <Row k="착공일" v={fmtDate(site.startDate)} />
                <Row k={r.completedDate ? "준공(인도)일" : "준공 예정일"} v={fmtDate(r.completedDate ?? site.endDate)} />
                {r.warranty && <Row k="하자보증" v={r.warranty.replace(/^하자보증\(계약서 기준\):\s*/, "계약서 기준 · ")} wide />}
              </dl>
            </Section>

            <Section title="2. 공정 단계별 완료" sub="완료일은 현장 보고·이관 기록에서 100%가 된 날">
              {r.stages.length === 0 ? (
                <p className="text-[0.85rem] text-ink-3">공정 단계가 정해지지 않았습니다.</p>
              ) : (
                <div className="@container">
                  <table className="w-full border-collapse text-[0.85rem]" data-testid="completion-stages">
                    <thead>
                      <tr className="border-b border-line text-left text-[0.76rem] text-ink-3">
                        <th className="py-2 font-semibold">공정 단계</th>
                        <th className="hidden py-2 font-semibold @min-[30rem]:table-cell print:table-cell">계획 기간</th>
                        <th className="py-2 text-right font-semibold">완료일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.stages.map((st) => (
                        <tr key={st.id} className="border-b border-line/70 align-top" data-testid="completion-stage">
                          <td className="py-2 pr-2">
                            <p className="font-semibold">{st.name}</p>
                            <p className="num text-[0.74rem] text-ink-3 @min-[30rem]:hidden print:hidden">
                              계획 {fmtDate(st.startDate)} ~ {fmtDate(st.endDate)}
                            </p>
                          </td>
                          <td className="num hidden py-2 text-ink-2 @min-[30rem]:table-cell print:table-cell">
                            {fmtDate(st.startDate)} ~ {fmtDate(st.endDate)}
                          </td>
                          <td className="num py-2 text-right">
                            {st.progressPct < 100 ? (
                              <span className="inline-flex items-center gap-2">
                                <span className="hidden w-20 sm:inline-block print:inline-block">
                                  <ProgressBar value={st.progressPct} label={`${st.name} 진행률`} />
                                </span>
                                <b>{st.progressPct}%</b>
                              </span>
                            ) : st.doneDate ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <b>{fmtDate(st.doneDate)}</b>
                                {st.late ? <Badge tone="warn">계획보다 늦음</Badge> : <Badge tone="ok">계획 안</Badge>}
                              </span>
                            ) : (
                              <span className="text-ink-3">완료 · 날짜 기록 없음</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="3. 월별 공정률" sub="월말 기준 전체 공정률 · 마지막 달은 작성일 기준">
              <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6 print:grid-cols-6" data-testid="completion-months">
                {r.months.map((m) => (
                  <li key={m.month} className="rounded-lg border border-line px-2.5 py-2 text-center" data-testid="completion-month">
                    <p className="num text-[0.74rem] text-ink-3">{monthLabel(m.month)}</p>
                    <p className={cx("num", m.pct === null ? "py-0.5 text-[0.8rem] font-semibold text-ink-3" : "text-[1.05rem] font-extrabold")}>{m.pct === null ? "기록 없음" : `${m.pct}%`}</p>
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="4. 공정 사진" sub={r.photoTotal ? `발주처에 공개한 사진 ${r.photoTotal}장 중 ${r.photos.length}장 (기간에 고르게)` : undefined}>
              {r.photos.length === 0 ? (
                <p className="text-[0.85rem] text-ink-3" data-testid="completion-no-photos">발주처에 공개한 공정 사진이 없습니다 — 사진대장에서 ‘발주처 공개’를 켜면 들어갑니다.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3" data-testid="completion-photos">
                  {r.photos.map((p) => (
                    <li key={p.id} className="overflow-hidden rounded-xl border border-line [break-inside:avoid]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.dataUrl} alt={p.shared?.caption || "공정 사진"} className="aspect-[4/3] w-full bg-surface-2 object-cover print:object-contain" />
                      <p className="px-2 py-1 text-[0.74rem] text-ink-2">
                        <span className="num">{fmtDate(p.createdAt)}</span>
                        {p.shared?.caption ? ` · ${p.shared.caption}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="5. 하자·요청 처리">
              <dl className="grid gap-x-6 gap-y-1.5 text-[0.86rem] sm:grid-cols-2" data-testid="completion-defects">
                <Row k="하자보수 요청" v={`${r.defects.total}건`} />
                <Row k="보수 완료 (발주처 확인 포함)" v={`${r.defects.repaired}건 · 발주처 확인 ${r.defects.confirmed}건`} />
                <Row k="진행 중" v={`${r.defects.open}건`} />
                <Row k="보수까지 평균" v={r.defects.avgDays === null ? "—" : `${r.defects.avgDays}일`} />
                <Row k="그 밖의 요청 (견적·주문 등)" v={`${r.requests.total}건 · 회신 ${r.requests.answered}건`} wide />
              </dl>
            </Section>

            <p className="mt-6 border-t border-line pt-3 text-[0.74rem] text-ink-3">
              이 보고서는 현장 보고·공정 기록·발주처 요청 처리 기록으로 자동 작성했습니다. 공정률은 현장 기준이며 기성(대금 청구) 비율과 다를 수 있습니다. 하자보증 기간은 계약서 기준입니다.
            </p>
          </article>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 print:bg-white" data-testid={testId}>
      <p className="text-[0.74rem] font-semibold text-ink-3">{label}</p>
      <p className="num text-[1.2rem] font-extrabold leading-tight [overflow-wrap:anywhere]">{value}</p>
      {sub && <p className="num text-[0.74rem] text-ink-2">{sub}</p>}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="flex flex-wrap items-baseline gap-x-2 border-b border-line pb-1.5 text-[1.02rem] font-extrabold [break-after:avoid]">
        {title}
        {sub && <span className="text-[0.78rem] font-semibold text-ink-3">{sub}</span>}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={cx("flex gap-3 border-b border-line/60 py-1", wide && "sm:col-span-2")}>
      <dt className="w-32 shrink-0 text-ink-3">{k}</dt>
      <dd className="min-w-0 font-semibold [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}
