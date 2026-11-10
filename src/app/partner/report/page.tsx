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
import { feedForMonth, monthlyDocFrom, shareMonths } from "@/lib/domain/share";
import type { DemoDB, PartnerRequest } from "@/lib/domain/types";
import { Badge, Button, DemoBadge, EmptyState, PageSkeleton, Segmented, cx, inputCls } from "@/components/ui/primitives";
import { SampleDataBanner } from "@/components/shell/AppShell";
import { MonthlyDocView } from "@/components/docs/ReportDocs";
import { ShareLinkButton } from "@/components/admin/ShareLinks";

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
  const me = db.users.find((u) => u.id === userId);
  const partners = db.users.filter((u) => u.role === "partner" && !u.inactive);
  const hasPartner = (id: string) => partners.some((u) => (u.partnerSiteIds ?? []).includes(id));
  // 본사는 모든 현장의 보고서를 만들 수 있다 — 발주처 계정이 없는 현장도 링크로 보낼 수 있게 (D-73). 발주처는 본인 현장만
  const sites = preview ? db.sites : db.sites.filter((s) => me?.partnerSiteIds?.includes(s.id));
  if (!sites.length || (!preview && !me)) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16" data-testid="partner-report">
        <EmptyState title="볼 수 있는 현장이 없습니다" action={<Link href="/partner"><Button>포털로</Button></Link>} />
      </div>
    );
  }
  const today = todayIso();
  const thisMonth = monthOf(today);
  const recent = [thisMonth, prevMonth(thisMonth)];
  // 본사 미리보기 기본값: 발주처 계정이 있는 첫 현장
  const site = sites.find((s) => s.id === q.get("site")) ?? (preview ? sites.find((s) => hasPartner(s.id)) : undefined) ?? sites[0];
  // 이 현장을 보는 발주처 (본사 미리보기: 그 계정에 보이는 요청 목록 · 계정이 없으면 현장 전체 요청)
  const partner = preview ? partners.find((u) => (u.partnerSiteIds ?? []).includes(site.id)) : me;
  // 발주처 계정은 이번 달·지난달만 (서버가 62일치 공정 변화만 보냄) · 본사는 착공한 달부터 — 지난 달 보고서를 다시 보내 달라는 요청에 (D-73)
  const older = preview ? shareMonths(site, today).filter((m) => !recent.includes(m)) : [];
  const months = [...recent, ...older];
  const asked = q.get("month");
  const month = months.includes(asked ?? "") ? asked! : thisMonth;
  // 볼 수 없는 달 주소로 들어오면 조용히 이번 달을 보여 주지 않고 알린다 (D-71 점검 반영)
  const outOfRange = !!asked && !months.includes(asked);
  const go = (patch: { site?: string; month?: string }) => {
    const p = new URLSearchParams({ site: patch.site ?? site.id, month: patch.month ?? month });
    router.replace(`/partner/report?${p.toString()}`);
  };
  return (
    <>
      <SampleDataBanner />
      <div className="min-h-[calc(100dvh-var(--demo-bar-h))] bg-[#F6F5F3] print:bg-white" data-testid="partner-report">
        {/* 휴대폰에서는 머리를 고정하지 않는다 — 큰 글씨에서 화면 3분의 1을 가리던 문제 (D-69 점검 반영) */}
        <header className="no-print top-[var(--demo-bar-h)] z-30 border-b border-line bg-surface/95 backdrop-blur lg:sticky">
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
            <Segmented label="보고 달" value={month} onChange={(m) => go({ month: m })} options={recent.map((m, i) => ({ value: m, label: i === 0 ? `이번 달 (${Number(m.slice(5))}월)` : `지난달 (${Number(m.slice(5))}월)`, testId: `report-month-${i}` }))} />
            {older.length > 0 && (
              <span className="block">
                <label htmlFor="pr-older" className="sr-only">그 전 달 보고서</label>
                <select id="pr-older" className={cx(inputCls, "h-10 w-auto py-1", older.includes(month) && "border-active font-bold")} value={older.includes(month) ? month : ""} onChange={(e) => e.target.value && go({ month: e.target.value })} data-testid="report-month-older">
                  <option value="">그 전 달…</option>
                  {older.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
              </span>
            )}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <DemoBadge compact />
              {preview && <ShareLinkButton kind="monthly" siteId={site.id} month={month} title={`${site.shortName} ${Number(month.slice(5))}월 공정 보고서`} company={db.company.name} />}
              <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="report-print">
                인쇄·PDF
              </Button>
            </span>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[960px] px-4 py-6 print:max-w-none print:p-0">
          {outOfRange && (
            <p className="no-print mb-3 rounded-xl bg-warn-bg px-3.5 py-2 text-[0.84rem] font-semibold text-ink-2" data-testid="report-month-range">
              {preview ? "보고서는 착공한 달부터 이번 달까지 볼 수 있습니다" : "보고서는 이번 달과 지난달만 볼 수 있습니다"} — {Number(month.slice(5))}월 보고서를 보여 드립니다.{preview ? "" : " 그 전 기록은 태강지엘텍에 요청해 주세요."}
            </p>
          )}
          {preview && (
            <p className="no-print mb-3 rounded-xl bg-active-soft px-3.5 py-2 text-[0.84rem] font-semibold text-theme-ink" data-testid="report-preview">
              {partner ? `관리자 미리보기 — ‘${partner.name} ${partner.title}’에게 보이는 보고서입니다.` : "관리자 미리보기 — 이 현장에는 발주처 계정이 없습니다."} 인쇄하면 발주처용 사본이 되고, ‘링크로 보내기’로 카카오톡·문자에 보낼 주소를 만들 수 있습니다 (링크에는 요청 내용 없이 건수만).
            </p>
          )}
          <Report db={db} siteId={site.id} month={month} partnerUserId={partner?.id} preview={preview} today={today} />
        </main>
      </div>
    </>
  );
}

function Report({ db, siteId, month, partnerUserId, preview, today }: { db: DemoDB; siteId: string; month: string; partnerUserId?: string; preview: boolean; today: string }) {
  const site = db.sites.find((s) => s.id === siteId)!;
  // 발주처 계정은 서버가 만든 공정 변화만 · 본사 미리보기·시연은 같은 계산을 바로 한다 (본사는 그 달을 담을 만큼 · D-73)
  const feed = useMemo(() => db.partnerFeed?.[siteId] ?? (preview ? feedForMonth(db, siteId, month, today) : partnerProgressFeed(db, siteId, today, PARTNER_FEED_KEEP_DAYS)), [db, siteId, month, today, preview]);
  const r = useMemo(() => partnerMonthly(db, siteId, month, feed, partnerUserId), [db, siteId, month, feed, partnerUserId]);
  // 화면과 보고서 링크가 같은 문서를 쓴다 (D-73)
  const doc = useMemo(() => monthlyDocFrom(db, site, r, today), [db, site, r, today]);
  const src = useMemo(() => new Map(r.photos.map((p) => [p.id, p.dataUrl])), [r]);
  return (
    <MonthlyDocView
      doc={doc}
      live
      photoSrc={(id) => src.get(id)}
      hints={{
        noChange: preview && !IS_LIVE ? " (시연: 현장 보고에서 공정 단계 진척을 바꾸면 들어갑니다)" : "",
        noPhotos: preview ? ` 본사 사진대장에서 ‘발주처 공개’를 켜면 들어갑니다${IS_LIVE ? "" : " (시연: 사진대장 ‘예시 사진 넣기’)"}.` : "",
      }}
      requests={
        r.requests.length === 0 ? (
          <p className="text-[0.85rem] text-ink-3">이 달에 주고받은 요청이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line" data-testid="report-requests">
            {r.requests.map((x) => (
              <RequestRow key={x.id} db={db} r={x} />
            ))}
          </ul>
        )
      }
    />
  );
}

function RequestRow({ db, r }: { db: DemoDB; r: PartnerRequest }) {
  const redone = db.partnerRequests.some((x) => x.reopenedFrom === r.id);
  const repair = db.partnerRepairs?.[r.id] ?? partnerRepairView(db, r);
  // 포털과 같은 말 (D-68 점검 반영)
  const prog = r.type === "defect" ? defectProgress(r, repair) : null;
  const state = prog ? prog.label : r.confirmedAt ? "확인 완료" : PARTNER_STATUS_LABEL[r.status];
  const done = prog ? prog.step >= 3 : !!r.confirmedAt || r.status === "answered";
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-[0.85rem] [break-inside:avoid]" data-testid="report-request">
      <span className="min-w-0">
        <span className="mr-1.5 text-[0.74rem] font-bold text-theme-ink">{PARTNER_TYPE_LABEL[r.type]}</span>
        <b className="[overflow-wrap:anywhere]">{r.title}</b>
        <span className="num block text-[0.76rem] text-ink-3">
          접수 {fmtDate(r.createdAt)}
          {r.location ? ` · ${r.location}` : ""}
          {r.reopenedFrom ? " · 다시 요청" : ""}
          {redone ? " · 다시 요청함" : ""}
        </span>
      </span>
      <Badge tone={done ? "ok" : "theme"}>{state}</Badge>
    </li>
  );
}
