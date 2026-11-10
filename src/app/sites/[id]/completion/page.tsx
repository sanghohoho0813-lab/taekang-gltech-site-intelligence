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
import { todayIso } from "@/lib/domain/format";
import { completionReport } from "@/lib/domain/completion";
import { completionDocFrom, completionTitle, shareTitle } from "@/lib/domain/share";
import { Button, DemoBadge, EmptyState, PageSkeleton } from "@/components/ui/primitives";
import { CompletionDocView } from "@/components/docs/ReportDocs";
import { ShareLinkButton } from "@/components/admin/ShareLinks";

export default function CompletionReportPage() {
  const { id } = useParams<{ id: string }>();
  const { db, role } = useMe();
  const today = todayIso();
  const r = useMemo(() => (db ? completionReport(db, id, today) : null), [db, id, today]);
  // 화면과 보고서 링크가 같은 문서를 쓴다 (D-73)
  const doc = useMemo(() => (db && r ? completionDocFrom(db, r, today) : null), [db, r, today]);
  const src = useMemo(() => new Map((r?.photos ?? []).map((p) => [p.id, p.dataUrl])), [r]);
  if (!db) return <PageSkeleton />;
  if (role !== "ceo" && role !== "manager")
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <EmptyState icon={<Lock size={26} />} title="본사만 볼 수 있습니다" desc="준공 보고서는 본사가 발주처에 내는 문서입니다." />
      </div>
    );
  if (!r || !doc) return <EmptyState title="현장을 찾을 수 없습니다" action={<Link href="/sites"><Button>현장 관리로</Button></Link>} />;
  const { site } = r;
  const unfinished = r.stages.filter((s) => s.progressPct < 100).length;
  const title = completionTitle(doc);
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
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <DemoBadge compact />
              <ShareLinkButton
                kind="completion"
                siteId={site.id}
                title={shareTitle(doc)}
                company={db.company.name}
                note={r.finished ? undefined : `지금 보내면 ‘${title}’ 제목으로 나갑니다 (${r.completedDate ? `공정률 ${site.progressPct}% · 끝나지 않은 단계 ${unfinished}개` : "준공일을 넣기 전"}). 준공 보고서로 보내려면 준공일과 공정률 마감을 먼저 해 주세요.`}
              />
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
          <CompletionDocView
            doc={doc}
            photoSrc={(pid) => src.get(pid)}
            internal={{ late: Object.fromEntries(r.stages.map((st) => [st.id, st.late])), photosAfter: r.photosAfter, defectsAfter: r.defectsAfter }}
          />
        </div>
      </div>
    </>
  );
}
