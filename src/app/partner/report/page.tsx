"use client";

/**
 * 발주처 월간 공정 보고서 (D-68) — 포털 ‘확장 예정’이던 월간 진행 리포트를 실제 기능으로.
 * 공정 단계 진척·공개 사진·요청/하자보수 처리·다음 달 예정 공정만. 계약·원가·기성 금액, 사람 이름, 현장 보고 원문은 넣지 않는다.
 * 발주처 계정은 서버가 만든 공정 변화(62일)만 받으므로 이번 달·지난달 두 달만 고를 수 있다.
 */
import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { PARTNER_STATUS_LABEL, PARTNER_TYPE_LABEL } from "@/lib/domain/labels";
import { PARTNER_FEED_KEEP_DAYS, defectProgress, partnerMonthly, partnerProgressFeed, partnerRepairView } from "@/lib/domain/partnerFeed";
import type { DemoDB, PartnerRequest } from "@/lib/domain/types";
import { Badge, Button, DemoBadge, EmptyState, PageSkeleton, ProgressBar, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { LogoMark } from "@/components/shell/Logo";
import { SampleDataBanner } from "@/components/shell/AppShell";

const monthOf = (d: string) => d.slice(0, 7);
const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${mo === 1 ? y - 1 : y}-${String(mo === 1 ? 12 : mo - 1).padStart(2, "0")}`;
};
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;

export default function PartnerReportPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const { db, role, userId } = useMe();
  const q = useSearchParams();
  const router = useRouter();
  if (!db) return <PageSkeleton />;
  if (role === "field") {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="access-denied">
        <Lock size={28} className="mx-auto text-ink-3" />
        <h1 className="mt-3 text-[1.25rem] font-bold">현장직원 역할에서는 발주처 보고서를 볼 수 없습니다</h1>
        <Link href="/field">
          <Button variant="cta" className="mt-5">현장 홈으로</Button>
        </Link>
      </div>
    );
  }
  const preview = role !== "partner";
  const partner = preview ? db.users.find((u) => u.role === "partner" && !u.inactive && (u.partnerSiteIds ?? []).some((id) => db.sites.some((s) => s.id === id))) : db.users.find((u) => u.id === userId);
  const sites = db.sites.filter((s) => partner?.partnerSiteIds?.includes(s.id));
  if (!partner || !sites.length) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16" data-testid="partner-report">
        <EmptyState title="볼 수 있는 현장이 없습니다" action={<Link href="/partner"><Button>포털로</Button></Link>} />
      </div>
    );
  }
  const today = todayIso();
  const thisMonth = monthOf(today);
  const months = [thisMonth, prevMonth(thisMonth)];
  const month = months.includes(q.get("month") ?? "") ? q.get("month")! : thisMonth;
  const site = sites.find((s) => s.id === q.get("site")) ?? sites[0];
  const go = (patch: { site?: string; month?: string }) => {
    const p = new URLSearchParams({ site: patch.site ?? site.id, month: patch.month ?? month });
    router.replace(`/partner/report?${p.toString()}`);
  };
  return (
    <>
      <SampleDataBanner />
      <div className="min-h-[calc(100dvh-var(--demo-bar-h))] bg-[#F6F5F3] print:bg-white" data-testid="partner-report">
        <header className="no-print sticky top-[var(--demo-bar-h)] z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="mx-auto flex min-h-16 max-w-[960px] flex-wrap items-center gap-2 px-4 py-2">
            <Link href="/partner" className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[0.9rem] font-bold text-ink-2 hover:bg-surface-3" data-testid="report-back">
              <ArrowLeft size={17} aria-hidden /> 포털
            </Link>
            {sites.length > 1 && (
              <span className="block min-w-0 max-w-[14rem]">
                <label htmlFor="pr-site" className="sr-only">현장</label>
                <select id="pr-site" className={cx(inputCls, "h-10 py-1")} value={site.id} onChange={(e) => go({ site: e.target.value })} data-testid="report-site">
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.shortName}</option>
                  ))}
                </select>
              </span>
            )}
            <Segmented label="보고 달" value={month} onChange={(m) => go({ month: m })} options={months.map((m, i) => ({ value: m, label: i === 0 ? `이번 달 (${Number(m.slice(5))}월)` : `지난달 (${Number(m.slice(5))}월)`, testId: `report-month-${i}` }))} />
            <span className="ml-auto flex items-center gap-2">
              <DemoBadge compact />
              <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="report-print">
                인쇄·PDF
              </Button>
            </span>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[960px] px-4 py-6 print:max-w-none print:p-0">
          {preview && (
            <p className="no-print mb-3 rounded-xl bg-active-soft px-3.5 py-2 text-[0.84rem] font-semibold text-theme-ink" data-testid="report-preview">
              관리자 미리보기 — ‘{partner.name} {partner.title}’에게 보이는 보고서입니다. 인쇄하면 발주처용 사본이 됩니다.
            </p>
          )}
          <Report db={db} siteId={site.id} month={month} partnerUserId={partner.id} preview={preview} today={today} />
        </main>
      </div>
    </>
  );
}

function Report({ db, siteId, month, partnerUserId, preview, today }: { db: DemoDB; siteId: string; month: string; partnerUserId: string; preview: boolean; today: string }) {
  const site = db.sites.find((s) => s.id === siteId)!;
  // 발주처 계정은 서버가 만든 공정 변화만 · 본사 미리보기·시연은 같은 계산을 바로 한다
  const feed = useMemo(() => db.partnerFeed?.[siteId] ?? partnerProgressFeed(db, siteId, today, PARTNER_FEED_KEEP_DAYS), [db, siteId, today]);
  const r = useMemo(() => partnerMonthly(db, siteId, month, feed, partnerUserId), [db, siteId, month, feed, partnerUserId]);
  const current = month === today.slice(0, 7);
  // 지난달을 골라도 ‘이번 달’이라고 쓰던 문제 — 달 이름으로 (D-68 점검 반영)
  const mName = `${Number(month.slice(5, 7))}월`;
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
          <p className="font-bold" data-testid="report-site-name">{site.name}</p>
          <p className="num text-ink-2" data-testid="report-month">{monthLabel(month)} ({fmtDate(r.from)} ~ {fmtDate(current ? today : r.to)}{current ? " · 작성일 기준" : ""})</p>
          {!IS_LIVE && <p className="mt-0.5 text-[0.74rem] font-bold text-[#7A5200]">DEMO · 가상 시연 데이터</p>}
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="요약">
        <Kpi label="전체 공정률 (오늘 기준)" value={`${site.progressPct}%`} sub={r.overall ? `${mName} ${r.overall.from}% → ${r.overall.to}%` : undefined} testId="report-kpi-progress" />
        <Kpi label={`${mName}에 진척된 단계`} value={`${r.stages.length}개`} testId="report-kpi-stages" />
        <Kpi label={`${mName} 공개 사진`} value={`${r.photos.length}장`} testId="report-kpi-photos" />
        <Kpi label="요청 처리" value={`${r.counts.answered}건 회신`} sub={`접수 ${r.counts.received} · 진행 중 ${r.counts.open}`} testId="report-kpi-requests" />
      </section>

      <Section title="1. 공정 단계별 진행">
        {site.stages.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3" data-testid="report-no-stages">이 현장에는 아직 공정 단계가 정해지지 않았습니다.</p>
        ) : (
        <div className="@container">
        <table className="w-full border-collapse text-[0.85rem]" data-testid="report-stages">
          <thead>
            <tr className="border-b border-line text-left text-[0.76rem] text-ink-3">
              <th className="py-2 font-semibold">공정 단계</th>
              <th className="hidden py-2 font-semibold @min-[30rem]:table-cell print:table-cell">계획 기간</th>
              <th className="whitespace-nowrap py-2 text-right font-semibold">{mName} 변화</th>
              <th className="w-[26%] whitespace-nowrap py-2 text-right font-semibold">오늘 기준</th>
            </tr>
          </thead>
          <tbody>
            {site.stages.map((st) => {
              const ch = r.stages.find((x) => x.stage === st.name);
              return (
                <tr key={st.id} className="border-b border-line/70 align-top" data-testid="report-stage-row">
                  <td className="py-2 pr-2 font-semibold [overflow-wrap:anywhere]">{st.name}</td>
                  <td className="num hidden whitespace-nowrap py-2 pr-2 text-[0.78rem] text-ink-2 @min-[30rem]:table-cell print:table-cell">{fmtDate(st.startDate).slice(2)} ~ {fmtDate(st.endDate).slice(2)}</td>
                  <td className="num whitespace-nowrap py-2 text-right">{ch ? <b className={ch.to >= ch.from ? "text-theme-ink" : "text-err"}>{ch.to >= ch.from ? "+" : "−"}{Math.abs(ch.to - ch.from)}%p</b> : <span className="text-ink-3">—</span>}</td>
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
        {r.stages.length === 0 && site.stages.length > 0 && (
          <p className="mt-2 text-[0.82rem] text-ink-2" data-testid="report-no-change">{mName}에 현장 보고로 바뀐 공정 진행률이 없습니다.{preview && !IS_LIVE ? " (시연: 현장 보고에서 공정 단계 진척을 바꾸면 들어갑니다)" : ""}</p>
        )}
        <p className="mt-2 text-[0.74rem] text-ink-3">‘{mName} 변화’는 현장 보고로 바뀐 진행률이며, 태강지엘텍 확인 전 보고도 포함합니다. 공정률은 현장 기준이며 기성(대금 청구) 비율과 다를 수 있습니다.</p>
      </Section>

      <Section title="2. 공정 사진" sub={r.photos.length ? `태강지엘텍이 공개한 사진 ${r.photos.length}장` : undefined}>
        {r.photos.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3" data-testid="report-no-photos">{mName}에 공개된 공정 사진이 없습니다.{preview ? ` 본사 사진대장에서 ‘발주처 공개’를 켜면 들어갑니다${IS_LIVE ? "" : " (시연: 사진대장 ‘예시 사진 넣기’)"}.` : ""}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
            {r.photos.map((p) => (
              <li key={p.id} className="break-inside-avoid overflow-hidden rounded-xl border border-line" data-testid="report-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt={p.shared?.caption || "공정 사진"} className="aspect-[4/3] w-full bg-surface-2 object-cover print:object-contain" />
                <p className="px-2 py-1.5 text-[0.78rem]">
                  <span className="num block whitespace-nowrap text-ink-3">{fmtDate(p.createdAt)}</span>
                  {p.shared?.caption && <span className="line-clamp-2 [overflow-wrap:anywhere]">{p.shared.caption}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="3. 요청·하자보수 처리" sub={`${r.counts.defects ? `하자보수 ${r.counts.defects}건 · 보수 회신 ${r.counts.repaired}건 · 확인 ${r.counts.confirmed}건 · ` : ""}처리 상태는 작성일 기준`}>
        {r.requests.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3">이 달에 주고받은 요청이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line" data-testid="report-requests">
            {r.requests.map((x) => (
              <RequestRow key={x.id} db={db} r={x} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`4. 다음 달 예정 공정`}>
        {r.next.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3">다음 달에 계획된 미완료 공정이 없습니다.</p>
        ) : (
          <ul className="space-y-1.5 text-[0.86rem]" data-testid="report-next">
            {r.next.map((n) => (
              <li key={n.name} className="flex flex-wrap items-baseline justify-between gap-2">
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
        {!IS_LIVE && " DEMO 화면의 현장·사진·요청은 가상 시연 데이터입니다."}
      </footer>
    </article>
  );
}

function RequestRow({ db, r }: { db: DemoDB; r: PartnerRequest }) {
  const repair = db.partnerRepairs?.[r.id] ?? partnerRepairView(db, r);
  // 포털과 같은 말 (D-68 점검 반영)
  const prog = r.type === "defect" && repair ? defectProgress(r, repair) : null;
  const state = prog ? prog.label : r.confirmedAt ? "확인 완료" : PARTNER_STATUS_LABEL[r.status];
  const done = prog ? prog.step >= 3 : !!r.confirmedAt || r.status === "answered";
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-[0.85rem]" data-testid="report-request">
      <span className="min-w-0">
        <span className="mr-1.5 text-[0.74rem] font-bold text-theme-ink">{PARTNER_TYPE_LABEL[r.type]}</span>
        <b className="[overflow-wrap:anywhere]">{r.title}</b>
        <span className="num block text-[0.76rem] text-ink-3">
          접수 {fmtDate(r.createdAt)}
          {r.location ? ` · ${r.location}` : ""}
        </span>
      </span>
      <Badge tone={done ? "ok" : "theme"}>{state}</Badge>
    </li>
  );
}

function Kpi({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 print:bg-white" data-testid={testId}>
      <p className="text-[0.74rem] font-semibold text-ink-3">{label}</p>
      <p className="num text-[1.3rem] font-extrabold leading-tight">{value}</p>
      {sub && <p className="num text-[0.74rem] text-ink-2">{sub}</p>}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
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
