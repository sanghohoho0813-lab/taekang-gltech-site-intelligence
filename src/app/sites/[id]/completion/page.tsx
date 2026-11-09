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
  const unfinished = r.stages.length - done;
  const title = r.finished ? "준공 보고서" : r.completedDate ? "공사 정리 보고서" : "공사 진행 정리 (준공 전)";
  const d = r.defects;
  return (
    <>
      {/* 본사 화면 안에서 연다 (메뉴·가상 데이터 표시는 화면 틀이 맡고, 인쇄하면 문서만 나온다) */}
      <div className="bg-[#F6F5F3] print:bg-white" data-testid="completion-report" data-finished={r.finished ? "1" : "0"}>
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
          {/* 화면 안내 — 인쇄물에는 나오지 않는다 */}
          {!r.completedDate && (
            <p className="no-print mb-3 rounded-xl bg-warn-bg px-3.5 py-2 text-[0.84rem] font-semibold text-ink-2" data-testid="completion-not-done">
              아직 준공(인도)일이 없습니다 — 작성일 기준 ‘공사 진행 정리’로 나옵니다. 준공하면 현장 상세 ‘발주처·하자보증’에서 준공일을 넣으세요.
            </p>
          )}
          {r.completedDate && !r.finished && (
            <p className="no-print mb-3 rounded-xl bg-warn-bg px-3.5 py-2 text-[0.84rem] font-semibold text-ink-2" data-testid="completion-unfinished">
              준공일은 넣었지만 공정률이 100%가 아닙니다 (지금 {site.progressPct}% · 끝나지 않은 단계 {unfinished}개) — 제목이 ‘공사 정리 보고서’로 나옵니다. 운영 관리에서 공정률을 마감한 뒤 인쇄하세요.
            </p>
          )}
          {(r.emptyLead || r.stages.some((s) => s.progressPct >= 100 && !s.doneDate)) && (
            <p className="no-print mb-3 rounded-xl bg-info-bg px-3.5 py-2 text-[0.82rem] text-ink-2" data-testid="completion-gap-hint">
              앱을 쓰기 전 기간은 기록이 비어 있습니다. 지난 공정 진행을 ‘자료 이관 → 공정 진행 이력’에서 엑셀로 넣으면 월별 공정률·완료일이 채워집니다.
            </p>
          )}
          <article className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-8" data-testid="completion-body">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink pb-4">
              <div className="flex items-center gap-3">
                <LogoMark size={34} />
                <div>
                  <p className="text-[0.8rem] font-extrabold tracking-[0.06em] text-ink-2">{db.company.name}</p>
                  <h1 className="text-[1.45rem] font-extrabold leading-tight" data-testid="completion-title">{title}</h1>
                </div>
              </div>
              <div className="text-right text-[0.85rem]">
                <p className="font-bold" data-testid="completion-site">{site.name}</p>
                <p className="text-ink-2">{site.clientName}</p>
                <p className="num whitespace-nowrap text-ink-2">작성일 {fmtDate(today)}</p>
                {!IS_LIVE && <p className="mt-0.5 text-[0.74rem] font-bold text-[#7A5200]">DEMO · 가상 시연 데이터</p>}
              </div>
            </header>

            <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="요약">
              <Kpi label="공사 기간" value={`${r.days.toLocaleString("ko-KR")}일`} sub={`${fmtDate(r.from)} ~ ${r.completedDate ? fmtDate(r.completedDate) : "진행 중"}`} testId="completion-kpi-period" />
              <Kpi label="공정률" value={`${site.progressPct}%`} sub={`공정 단계 ${done}/${r.stages.length} 완료`} testId="completion-kpi-progress" />
              <Kpi label="공정 사진" value={`${r.photos.length}장`} sub={r.photos.length ? "기간에 고르게" : "실은 사진 없음"} testId="completion-kpi-photos" />
              <Kpi
                label="하자보수"
                value={d.total ? `${d.total}건` : "없음"}
                sub={d.total ? (d.open ? `처리 완료 ${d.total - d.open} · 진행 중 ${d.open}` : "모두 처리 완료") : "하자 요청 없음"}
                testId="completion-kpi-defects"
              />
            </section>

            <Section title="1. 공사 개요">
              <dl className="grid gap-x-6 sm:grid-cols-2" data-testid="completion-overview">
                <Row k="현장명" v={site.name} />
                <Row k="발주처" v={site.clientName} />
                <Row k="공종" v={site.workType} />
                <Row k="지역" v={site.region || "—"} />
                <Row k="착공일" v={fmtDate(site.startDate)} nowrap />
                <Row k={r.completedDate ? "준공(인도)일" : "준공 예정일"} v={fmtDate(r.completedDate ?? site.endDate)} nowrap />
                {r.warranty && <Row k="하자보증" v={r.warranty.replace(/^하자보증\(계약서 기준\):\s*/, "계약서 기준 · ")} wide />}
              </dl>
            </Section>

            <Section title="2. 공정 단계별 완료" sub="완료일: 현장 기록 기준">
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
                        <tr key={st.id} className="border-b border-line/70 align-top [break-inside:avoid]" data-testid="completion-stage">
                          <td className="py-2 pr-2">
                            <p className="font-semibold">{st.name}</p>
                            <p className="num text-[0.74rem] text-ink-3 @min-[30rem]:hidden print:hidden">
                              계획 <span className="whitespace-nowrap">{fmtDate(st.startDate)}</span> ~ <span className="whitespace-nowrap">{fmtDate(st.endDate)}</span>
                            </p>
                          </td>
                          <td className="num hidden whitespace-nowrap py-2 text-ink-2 @min-[30rem]:table-cell print:table-cell">
                            {fmtDate(st.startDate)} ~ {fmtDate(st.endDate)}
                          </td>
                          <td className="num py-2 text-right">
                            {st.progressPct < 100 ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
                                <span className="hidden w-20 sm:inline-block print:inline-block">
                                  <ProgressBar value={st.progressPct} label={`${st.name} 진행률`} />
                                </span>
                                <b className="whitespace-nowrap">{st.progressPct}%</b>
                                {r.completedDate && <span className="whitespace-nowrap text-[0.74rem] text-warn">준공 시점 미완료</span>}
                              </span>
                            ) : st.doneDate ? (
                              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                <b className="whitespace-nowrap">{fmtDate(st.doneDate)}</b>
                                {/* 계획 대비는 본사 화면에서만 — 제출 문서에 ‘늦음’이 찍혀 지체 근거로 읽히지 않게 (D-72 점검 반영) */}
                                <span className="no-print">{st.late ? <Badge tone="warn">계획보다 늦음</Badge> : <Badge tone="ok">계획 안</Badge>}</span>
                              </span>
                            ) : (
                              <span className="font-semibold">
                                완료<span className="no-print text-[0.74rem] font-normal text-ink-3"> · 날짜 기록 없음</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="3. 월별 공정률" sub={`월말 기준 전체 공정률 · 마지막 달은 ${r.completedDate ? "준공일" : "작성일"} 기준`}>
              <ol className="grid grid-cols-2 gap-2 [break-inside:avoid] sm:grid-cols-6 print:grid-cols-6" data-testid="completion-months">
                {r.emptyLead && (
                  <li className="rounded-lg border border-dashed border-line px-2.5 py-2 text-center sm:col-span-2 print:col-span-2" data-testid="completion-month-lead">
                    <p className="num whitespace-nowrap text-[0.74rem] text-ink-3">
                      {monthLabel(r.emptyLead.from)} ~ {monthLabel(r.emptyLead.to)}
                    </p>
                    <p className="py-0.5 text-[0.8rem] font-semibold text-ink-3">기록 없음</p>
                  </li>
                )}
                {r.months.map((m) => (
                  <li key={m.month} className="rounded-lg border border-line px-2.5 py-2 text-center" data-testid="completion-month">
                    <p className="num whitespace-nowrap text-[0.74rem] text-ink-3">{monthLabel(m.month)}</p>
                    <p className={cx("num whitespace-nowrap", m.pct === null ? "py-0.5 text-[0.8rem] font-semibold text-ink-3" : "text-[1.05rem] font-extrabold")}>{m.pct === null ? "기록 없음" : `${m.pct}%`}</p>
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="4. 공정 사진" sub={r.photos.length ? `${r.photos.length}장` : undefined}>
              {r.photosAfter > 0 && (
                <p className="no-print mb-2 text-[0.8rem] text-ink-3" data-testid="completion-photos-after">준공일 뒤 사진 {r.photosAfter}장은 넣지 않았습니다.</p>
              )}
              {r.photos.length === 0 ? (
                <>
                  <p className="text-[0.85rem] text-ink-3" data-testid="completion-no-photos">공정 사진 없음</p>
                  <p className="no-print mt-1 text-[0.8rem] text-ink-3">사진대장에서 ‘발주처 공개’를 켠 사진만 들어갑니다.</p>
                </>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3" data-testid="completion-photos">
                  {r.photos.map((p) => (
                    <li key={p.id} className="overflow-hidden rounded-xl border border-line [break-inside:avoid]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.dataUrl} alt={p.shared?.caption || "공정 사진"} className="aspect-[4/3] w-full bg-surface-2 object-cover print:object-contain" />
                      <p className="px-2 py-1 text-[0.74rem] text-ink-2">
                        <span className="num whitespace-nowrap">{fmtDate(p.createdAt)}</span>
                        {p.shared?.caption ? ` · ${p.shared.caption}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="5. 하자·요청 처리" sub={r.completedDate ? "준공일까지 접수된 것" : undefined}>
              {r.defectsAfter > 0 && <p className="no-print mb-2 text-[0.8rem] text-ink-3" data-testid="completion-defects-after">준공일 뒤 접수된 하자 {r.defectsAfter}건은 하자보증 기간 요청이라 넣지 않았습니다 (하자보수 화면에서 관리).</p>}
              <dl className="grid gap-x-6 sm:grid-cols-2" data-testid="completion-defects">
                <Row k="하자보수 요청" v={d.total ? `${d.total}건` : "없음"} />
                <Row k="처리 완료" v={d.total ? `${d.total - d.open}건 (발주처 확인 ${d.confirmed}건)` : "—"} />
                <Row k="진행 중" v={`${d.open}건`} />
                <Row k="보수까지 평균" v={d.avgDays === null ? "—" : `${d.avgDays}일`} />
                <Row k="그 밖의 요청" v={r.requests.total ? `${r.requests.total}건 · 회신 ${r.requests.answered}건 (견적·주문 등)` : "없음"} wide />
              </dl>
            </Section>

            {/* 제출·확인 서명란 (원청 제출 문서) */}
            <section className="mt-6 grid gap-3 [break-inside:avoid] sm:grid-cols-2 print:grid-cols-2" aria-label="제출·확인" data-testid="completion-sign">
              <div className="rounded-xl border border-line px-4 py-3 text-[0.84rem]">
                <p className="text-[0.76rem] font-bold text-ink-3">제출</p>
                <p className="mt-1 font-bold">{db.company.name}</p>
                <p className="mt-4 text-ink-2">담당 ______________ (인)</p>
              </div>
              <div className="rounded-xl border border-line px-4 py-3 text-[0.84rem]">
                <p className="text-[0.76rem] font-bold text-ink-3">확인</p>
                <p className="mt-1 font-bold">{site.clientName}</p>
                <p className="mt-4 text-ink-2">담당 ______________ (인)</p>
              </div>
            </section>

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
      <p className="num whitespace-nowrap text-[1.2rem] font-extrabold leading-tight">{value}</p>
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

function Row({ k, v, wide, nowrap }: { k: string; v: string; wide?: boolean; nowrap?: boolean }) {
  // 휴대폰: 이름 위·값 아래 (이름 칸 때문에 값이 한두 글자씩 끊기던 문제 · D-72 점검 반영)
  return (
    <div className={cx("flex flex-col gap-0.5 border-b border-line/60 py-1.5 text-[0.86rem] sm:flex-row sm:gap-3 print:flex-row print:gap-3", wide && "sm:col-span-2 print:col-span-2")}>
      <dt className="shrink-0 text-[0.78rem] text-ink-3 sm:w-28 sm:text-[0.86rem] print:w-28">{k}</dt>
      <dd className={cx("min-w-0 font-semibold", nowrap ? "num whitespace-nowrap" : "[overflow-wrap:anywhere]")}>{v}</dd>
    </div>
  );
}
