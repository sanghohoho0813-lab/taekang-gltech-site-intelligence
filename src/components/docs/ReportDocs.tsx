"use client";

/**
 * 발주처 제출 문서 (월간 공정 보고서 · 준공 보고서) — 화면(포털·본사)과 보고서 링크(D-73)가 같은 컴포넌트로 그린다.
 * 받는 값은 문서 내용(doc)뿐이라 링크에서는 저장해 둔 내용 그대로 나온다. 금액·사람 이름·요청 내용은 doc에 없다.
 * 사진은 번호만 받고 photoSrc가 주소를 준다 — 주소가 없으면(공개를 끈 사진) 그 사진은 빼고 그린다.
 */
import type { ReactNode } from "react";
import { IS_LIVE } from "@/lib/mode";
import { fmtDate } from "@/lib/domain/format";
import { completionTitle, type CompletionDoc, type MonthlyDoc } from "@/lib/domain/share";
import { Badge, ProgressBar, cx } from "@/components/ui/primitives";
import { LogoMark } from "@/components/shell/Logo";

export type PhotoSrc = (id: string) => string | null | undefined;

const monthKo = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const monthDot = (m: string) => `${m.slice(0, 4)}.${m.slice(5, 7)}`;

function DemoMark({ sample }: { sample?: boolean }) {
  if (IS_LIVE && !sample) return null;
  return <p className="mt-0.5 text-[0.74rem] font-bold text-[#7A5200]">DEMO · 가상 시연 데이터</p>;
}

export function MonthlyDocView({
  doc,
  photoSrc,
  live,
  requests,
  hints,
}: {
  doc: MonthlyDoc;
  photoSrc: PhotoSrc;
  /** 지금 데이터로 그리는 화면 (‘오늘 기준’) — 링크는 저장해 둔 내용이라 ‘작성일 기준’ */
  live?: boolean;
  /** 요청 목록 — 로그인한 화면에서만 (링크에는 건수만 나온다) */
  requests?: ReactNode;
  /** 화면 전용 안내 (본사 미리보기) */
  hints?: { noChange?: string; noPhotos?: string };
}) {
  const current = doc.month === doc.asOf.slice(0, 7);
  const mName = `${Number(doc.month.slice(5, 7))}월`;
  // 링크는 저장해 둔 내용 — ‘오늘’이 아니라 ‘작성일’ (날짜는 머리말에)
  const asOf = live ? "오늘 기준" : "작성일 기준";
  const changed = doc.stages.filter((s) => s.change).length;
  const photos = doc.photos.flatMap((p) => {
    const src = photoSrc(p.id);
    return src ? [{ ...p, src }] : [];
  });
  const c = doc.counts;
  return (
    <article className="rounded-2xl border border-line bg-surface p-6 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-8" data-testid="report-body">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink pb-4">
        <div className="flex items-center gap-3">
          <LogoMark size={34} />
          <div>
            <p className="text-[0.8rem] font-extrabold tracking-[0.06em] text-ink-2">TAEKANG GLTECH</p>
            <h1 className="text-[1.45rem] font-extrabold leading-tight">월간 공정 보고서</h1>
          </div>
        </div>
        <div className="text-right text-[0.85rem]">
          <p className="font-bold" data-testid="report-site-name">{doc.siteName}</p>
          <p className="num text-ink-2" data-testid="report-month">
            {monthKo(doc.month)} ({fmtDate(doc.from)} ~ {fmtDate(current ? doc.asOf : doc.to)}
            {current ? " · 작성일 기준" : ""})
          </p>
          {/* 지난달 보고서에서도 맞게 — 남은 날 없이 날짜만, 계약서 기준임을 밝힌다 (D-70 점검 반영) */}
          {doc.warranty && <p className="num text-[0.78rem] text-ink-2" data-testid="report-warranty">{doc.warranty}</p>}
          {!live && <p className="num text-[0.78rem] text-ink-2" data-testid="report-asof">작성일 {fmtDate(doc.asOf)}</p>}
          <DemoMark sample={doc.sample} />
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="요약">
        <Kpi label={`전체 공정률 (${asOf})`} value={`${doc.progressPct}%`} sub={doc.overall ? `${mName} ${doc.overall.from}% → ${doc.overall.to}%` : undefined} testId="report-kpi-progress" />
        <Kpi label={`${mName}에 진척된 단계`} value={`${changed}개`} testId="report-kpi-stages" />
        <Kpi label={`${mName} 공개 사진`} value={`${photos.length}장`} testId="report-kpi-photos" />
        <Kpi label="요청 처리" value={`${c.answered}건 회신`} sub={`접수 ${c.received} · 진행 중 ${c.open}`} testId="report-kpi-requests" />
      </section>

      <Section title="1. 공정 단계별 진행">
        {doc.stages.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3" data-testid="report-no-stages">이 현장에는 아직 공정 단계가 정해지지 않았습니다.</p>
        ) : (
          <div className="@container">
            <table className="w-full border-collapse text-[0.85rem]" data-testid="report-stages">
              <thead>
                <tr className="border-b border-line text-left text-[0.76rem] text-ink-3">
                  <th className="py-2 font-semibold">공정 단계</th>
                  <th className="hidden py-2 font-semibold @min-[30rem]:table-cell print:table-cell">계획 기간</th>
                  <th className="whitespace-nowrap py-2 text-right font-semibold">{mName} 변화</th>
                  <th className="w-[26%] whitespace-nowrap py-2 text-right font-semibold">{asOf}</th>
                </tr>
              </thead>
              <tbody>
                {doc.stages.map((st, i) => {
                  const ch = st.change;
                  return (
                    <tr key={`${st.name}-${i}`} className="border-b border-line/70 align-top" data-testid="report-stage-row">
                      <td className="py-2 pr-2 font-semibold [overflow-wrap:anywhere]">{st.name}</td>
                      <td className="num hidden whitespace-nowrap py-2 pr-2 text-[0.78rem] text-ink-2 @min-[30rem]:table-cell print:table-cell print:text-[8.5pt]">
                        {fmtDate(st.startDate).slice(2)} ~ {fmtDate(st.endDate).slice(2)}
                      </td>
                      <td className="num whitespace-nowrap py-2 text-right">
                        {ch ? (
                          <b className={ch.to >= ch.from ? "text-theme-ink" : "text-err"}>
                            {ch.to >= ch.from ? "+" : "−"}
                            {Math.abs(ch.to - ch.from)}%p
                          </b>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="py-2 pl-2">
                        <span className="num block whitespace-nowrap text-right font-bold">{st.progressPct}%</span>
                        <ProgressBar value={st.progressPct} className="mt-1 print:[print-color-adjust:exact] print:[-webkit-print-color-adjust:exact]" label={`${st.name} 진행률`} tone={st.progressPct === 100 ? "ok" : "theme"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {changed === 0 && doc.stages.length > 0 && (
          <p className="mt-2 text-[0.82rem] text-ink-2" data-testid="report-no-change">
            {mName}에 바뀐 공정 진행률이 없습니다.{hints?.noChange ?? ""}
          </p>
        )}
        <p className="mt-2 text-[0.74rem] text-ink-3">‘{mName} 변화’는 현장 보고·공정 기록으로 바뀐 진행률이며, 태강지엘텍 확인 전 보고도 포함합니다. 공정률은 현장 기준이며 기성(대금 청구) 비율과 다를 수 있습니다.</p>
      </Section>

      <Section title="2. 공정 사진" sub={photos.length ? `태강지엘텍이 공개한 사진 ${photos.length}장` : undefined}>
        {photos.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3" data-testid="report-no-photos">
            {mName}에 공개된 공정 사진이 없습니다.{hints?.noPhotos ?? ""}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
            {photos.map((p) => (
              <li key={p.id} className="break-inside-avoid overflow-hidden rounded-xl border border-line" data-testid="report-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.caption || "공정 사진"} className="aspect-[4/3] w-full bg-surface-2 object-cover print:object-contain" />
                <p className="px-2 py-1.5 text-[0.78rem]">
                  <span className="num block whitespace-nowrap text-ink-3">{fmtDate(p.at)}</span>
                  {p.caption && <span className="line-clamp-2 [overflow-wrap:anywhere]">{p.caption}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="3. 요청·하자보수 처리" sub={`${c.defects ? `하자보수 ${c.defects}건 · 보수 회신 ${c.repaired}건 · 확인 ${c.confirmed}건 · ` : ""}처리 상태는 작성일 기준`}>
        {requests ?? (
          <dl className="grid gap-x-6 sm:grid-cols-2 print:grid-cols-2" data-testid="report-request-counts">
            <Row k={`${mName} 접수`} v={`${c.received}건`} />
            <Row k={`${mName} 회신`} v={`${c.answered}건`} />
            <Row k="진행 중" v={`${c.open}건`} />
            <Row k="하자보수" v={c.defects ? `${c.defects}건 (보수 회신 ${c.repaired} · 확인 ${c.confirmed})` : "없음"} />
          </dl>
        )}
      </Section>

      <Section title="4. 다음 달 예정 공정">
        {doc.next.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3">다음 달에 계획된 미완료 공정이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5 text-[0.86rem]" data-testid="report-next">
            {doc.next.map((n) => (
              <li key={n.name} className="flex flex-wrap items-baseline justify-between gap-2 [break-inside:avoid]">
                <b className="[overflow-wrap:anywhere]">{n.name}</b>
                <span className="num text-ink-2">
                  {fmtDate(n.startDate)} ~ {fmtDate(n.endDate)} · 현재 {n.progressPct}%
                  {n.late && <b className="ml-1.5 text-warn" data-testid="report-next-late">계획보다 늦음</b>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="mt-6 border-t border-line pt-3 text-[0.74rem] leading-relaxed text-ink-3 [break-before:avoid] [break-inside:avoid]">
        이 보고서에는 계약·공사비·기성 금액과 내부 메모가 들어가지 않습니다. 태강지엘텍 시스템에 기록된 현장 보고·공개 사진·요청 처리 기록으로 자동 작성했습니다.
        {(!IS_LIVE || doc.sample) && " DEMO 화면의 현장·사진·요청은 가상 시연 데이터입니다."}
      </footer>
    </article>
  );
}

export function CompletionDocView({
  doc,
  photoSrc,
  internal,
}: {
  doc: CompletionDoc;
  photoSrc: PhotoSrc;
  /** 본사 화면 전용 표시 (인쇄·링크에는 없음): 단계별 계획 대비, 보고서에 넣지 않은 준공 뒤 사진·하자 수 */
  internal?: { late: Record<string, boolean | undefined>; photosAfter: number; defectsAfter: number };
}) {
  const done = doc.stages.filter((s) => s.progressPct >= 100).length;
  const title = completionTitle(doc);
  const d = doc.defects;
  const photos = doc.photos.flatMap((p) => {
    const src = photoSrc(p.id);
    return src ? [{ ...p, src }] : [];
  });
  return (
    <article className="rounded-2xl border border-line bg-surface p-5 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-8" data-testid="completion-body">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink pb-4">
        <div className="flex items-center gap-3">
          <LogoMark size={34} />
          <div>
            <p className="text-[0.8rem] font-extrabold tracking-[0.06em] text-ink-2">{doc.company}</p>
            <h1 className="text-[1.45rem] font-extrabold leading-tight" data-testid="completion-title">{title}</h1>
          </div>
        </div>
        <div className="text-right text-[0.85rem]">
          <p className="font-bold" data-testid="completion-site">{doc.siteName}</p>
          <p className="text-ink-2">{doc.clientName}</p>
          <p className="num whitespace-nowrap text-ink-2">작성일 {fmtDate(doc.asOf)}</p>
          <DemoMark sample={doc.sample} />
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="요약">
        <Kpi nowrap label="공사 기간" value={`${doc.days.toLocaleString("ko-KR")}일`} sub={`${fmtDate(doc.from)} ~ ${doc.completedDate ? fmtDate(doc.completedDate) : "진행 중"}`} testId="completion-kpi-period" />
        <Kpi nowrap label="공정률" value={`${doc.progressPct}%`} sub={`공정 단계 ${done}/${doc.stages.length} 완료`} testId="completion-kpi-progress" />
        <Kpi nowrap label="공정 사진" value={`${photos.length}장`} sub={photos.length ? "기간에 고르게" : "실은 사진 없음"} testId="completion-kpi-photos" />
        <Kpi
          nowrap
          label="하자보수"
          value={d.total ? `${d.total}건` : "없음"}
          sub={d.total ? (d.open ? `처리 완료 ${d.total - d.open} · 진행 중 ${d.open}` : "모두 처리 완료") : "하자 요청 없음"}
          testId="completion-kpi-defects"
        />
      </section>

      <Section title="1. 공사 개요">
        <dl className="grid gap-x-6 sm:grid-cols-2" data-testid="completion-overview">
          <Row k="현장명" v={doc.siteName} />
          <Row k="발주처" v={doc.clientName} />
          <Row k="공종" v={doc.workType} />
          <Row k="지역" v={doc.region || "—"} />
          <Row k="착공일" v={fmtDate(doc.startDate)} nowrap />
          <Row k={doc.completedDate ? "준공(인도)일" : "준공 예정일"} v={fmtDate(doc.completedDate ?? doc.endDate)} nowrap />
          {doc.warranty && <Row k="하자보증" v={doc.warranty.replace(/^하자보증\(계약서 기준\):\s*/, "계약서 기준 · ")} wide />}
        </dl>
      </Section>

      <Section title="2. 공정 단계별 완료" sub="완료일: 현장 기록 기준">
        {doc.stages.length === 0 ? (
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
                {doc.stages.map((st) => (
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
                          {doc.completedDate && <span className="whitespace-nowrap text-[0.74rem] text-warn">준공 시점 미완료</span>}
                        </span>
                      ) : st.doneDate ? (
                        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          <b className="whitespace-nowrap">{fmtDate(st.doneDate)}</b>
                          {/* 계획 대비는 본사 화면에서만 — 제출 문서에 ‘늦음’이 찍혀 지체 근거로 읽히지 않게 (D-72 점검 반영) */}
                          {internal && <span className="no-print">{internal.late[st.id] ? <Badge tone="warn">계획보다 늦음</Badge> : <Badge tone="ok">계획 안</Badge>}</span>}
                        </span>
                      ) : (
                        <span className="font-semibold">
                          완료{internal && <span className="no-print text-[0.74rem] font-normal text-ink-3"> · 날짜 기록 없음</span>}
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

      <Section title="3. 월별 공정률" sub={`월말 기준 전체 공정률 · 마지막 달은 ${doc.completedDate ? "준공일" : "작성일"} 기준`}>
        <ol className="grid grid-cols-2 gap-2 [break-inside:avoid] sm:grid-cols-6 print:grid-cols-6" data-testid="completion-months">
          {doc.emptyLead && (
            <li className="rounded-lg border border-dashed border-line px-2.5 py-2 text-center sm:col-span-2 print:col-span-2" data-testid="completion-month-lead">
              <p className="num whitespace-nowrap text-[0.74rem] text-ink-3">
                {monthDot(doc.emptyLead.from)} ~ {monthDot(doc.emptyLead.to)}
              </p>
              <p className="py-0.5 text-[0.8rem] font-semibold text-ink-3">기록 없음</p>
            </li>
          )}
          {doc.months.map((m) => (
            <li key={m.month} className="rounded-lg border border-line px-2.5 py-2 text-center" data-testid="completion-month">
              <p className="num whitespace-nowrap text-[0.74rem] text-ink-3">{monthDot(m.month)}</p>
              <p className={cx("num whitespace-nowrap", m.pct === null ? "py-0.5 text-[0.8rem] font-semibold text-ink-3" : "text-[1.05rem] font-extrabold")}>{m.pct === null ? "기록 없음" : `${m.pct}%`}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="4. 공정 사진" sub={photos.length ? `${photos.length}장` : undefined}>
        {!!internal?.photosAfter && (
          <p className="no-print mb-2 text-[0.8rem] text-ink-3" data-testid="completion-photos-after">준공일 뒤 사진 {internal.photosAfter}장은 넣지 않았습니다.</p>
        )}
        {photos.length === 0 ? (
          <>
            <p className="text-[0.85rem] text-ink-3" data-testid="completion-no-photos">공정 사진 없음</p>
            {internal && <p className="no-print mt-1 text-[0.8rem] text-ink-3">사진대장에서 ‘발주처 공개’를 켠 사진만 들어갑니다.</p>}
          </>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3" data-testid="completion-photos">
            {photos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-xl border border-line [break-inside:avoid]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.caption || "공정 사진"} className="aspect-[4/3] w-full bg-surface-2 object-cover print:object-contain" />
                <p className="px-2 py-1 text-[0.74rem] text-ink-2">
                  <span className="num whitespace-nowrap">{fmtDate(p.at)}</span>
                  {p.caption ? ` · ${p.caption}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="5. 하자·요청 처리" sub={doc.completedDate ? "준공일까지 접수된 것" : undefined}>
        {!!internal?.defectsAfter && (
          <p className="no-print mb-2 text-[0.8rem] text-ink-3" data-testid="completion-defects-after">
            준공일 뒤 접수된 하자 {internal.defectsAfter}건은 하자보증 기간 요청이라 넣지 않았습니다 (하자보수 화면에서 관리).
          </p>
        )}
        <dl className="grid gap-x-6 sm:grid-cols-2" data-testid="completion-defects">
          <Row k="하자보수 요청" v={d.total ? `${d.total}건` : "없음"} />
          <Row k="처리 완료" v={d.total ? `${d.total - d.open}건 (발주처 확인 ${d.confirmed}건)` : "—"} />
          <Row k="진행 중" v={`${d.open}건`} />
          <Row k="보수까지 평균" v={d.avgDays === null ? "—" : `${d.avgDays}일`} />
          <Row k="그 밖의 요청" v={doc.requests.total ? `${doc.requests.total}건 · 회신 ${doc.requests.answered}건 (견적·주문 등)` : "없음"} wide />
        </dl>
      </Section>

      {/* 제출·확인 서명란 (원청 제출 문서) */}
      <section className="mt-6 grid gap-3 [break-inside:avoid] sm:grid-cols-2 print:grid-cols-2" aria-label="제출·확인" data-testid="completion-sign">
        <div className="rounded-xl border border-line px-4 py-3 text-[0.84rem]">
          <p className="text-[0.76rem] font-bold text-ink-3">제출</p>
          <p className="mt-1 font-bold">{doc.company}</p>
          <p className="mt-4 text-ink-2">담당 ______________ (인)</p>
        </div>
        <div className="rounded-xl border border-line px-4 py-3 text-[0.84rem]">
          <p className="text-[0.76rem] font-bold text-ink-3">확인</p>
          <p className="mt-1 font-bold">{doc.clientName}</p>
          <p className="mt-4 text-ink-2">담당 ______________ (인)</p>
        </div>
      </section>

      <p className="mt-6 border-t border-line pt-3 text-[0.74rem] text-ink-3">
        이 보고서는 현장 보고·공정 기록·발주처 요청 처리 기록으로 자동 작성했습니다. 공정률은 현장 기준이며 기성(대금 청구) 비율과 다를 수 있습니다. 하자보증 기간은 계약서 기준입니다.
      </p>
    </article>
  );
}

function Kpi({ label, value, sub, testId, nowrap }: { label: string; value: string; sub?: string; testId: string; nowrap?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 print:bg-white" data-testid={testId}>
      <p className="text-[0.74rem] font-semibold text-ink-3">{label}</p>
      <p className={cx("num font-extrabold leading-tight", nowrap ? "whitespace-nowrap text-[1.2rem]" : "text-[1.3rem]")}>{value}</p>
      {sub && <p className="num text-[0.74rem] text-ink-2">{sub}</p>}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      {/* 인쇄: 절 전체를 한 쪽에 묶지 않고 제목만 다음 내용과 붙인다 — 1쪽 절반이 비던 문제 (D-68 점검 반영) */}
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
