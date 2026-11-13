"use client";

/**
 * 하자 접수 안내문 (D-74) — 본사가 A4 한 장으로 인쇄해 관리사무소·발주처에 전한다. QR을 찍으면 접수 화면이 열린다.
 * 금액·사람 이름 없음. 무상·유상, 하자 기간은 적지 않는다 (계약서 기준).
 */
import Link from "next/link";
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { intakeState } from "@/lib/domain/intake";
import { Button, DemoBadge, EmptyState, PageSkeleton } from "@/components/ui/primitives";
import { LogoMark } from "@/components/shell/Logo";
import { QrBox, intakePlace, intakeUrl } from "@/components/admin/IntakeLinks";

export default function IntakeNoticePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const q = useSearchParams();
  const { db, role } = useMe();
  if (!db) return <PageSkeleton />;
  if (role !== "ceo" && role !== "manager")
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <EmptyState icon={<Lock size={26} />} title="본사만 볼 수 있습니다" desc="하자 접수 안내문은 본사가 인쇄해 전하는 문서입니다." />
      </div>
    );
  const site = db.sites.find((s) => s.id === id);
  const intake = (db.intakes ?? []).find((i) => i.id === q.get("link") && i.siteId === id);
  if (!site || !intake || intakeState(intake) !== "open")
    return (
      <EmptyState
        title="열려 있는 접수 링크를 찾을 수 없습니다"
        desc="닫은 링크는 안내문을 인쇄할 수 없습니다."
        action={
          <Link href={`/sites/${id}?tab=requests`}>
            <Button>현장 상세로</Button>
          </Link>
        }
      />
    );
  const url = intakeUrl(intake.token);
  const phone = db.settings?.publicPhone;
  const place = intakePlace(db, intake);
  return (
    <div className="print-plain bg-[#F6F5F3] print:bg-white" data-testid="intake-notice">
      <header className="no-print border-b border-line bg-surface/95">
        <div className="mx-auto flex min-h-16 max-w-[820px] flex-wrap items-center gap-2 px-4 py-2">
          <Link href={`/sites/${site.id}?tab=requests`} className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[0.9rem] font-bold text-ink-2 hover:bg-surface-3">
            <ArrowLeft size={17} aria-hidden /> {site.shortName}
          </Link>
          <span className="text-[0.8rem] text-ink-3">하자 접수 안내문 · {intake.label} <span className="text-ink-3">(이 이름은 인쇄되지 않습니다)</span></span>
          {!phone && (
            <span className="basis-full rounded-xl bg-warn-bg px-3 py-1.5 text-[0.82rem] font-semibold text-ink sm:basis-auto" data-testid="intake-notice-nophone">
              회사 전화번호가 없습니다 — 현장 상세 ‘하자 접수 링크’에서 넣으면 안내문에 인쇄됩니다.
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <DemoBadge compact />
            <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="intake-notice-print">
              인쇄·PDF
            </Button>
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-[820px] px-4 py-6 print:max-w-none print:p-0">
        <article className="rounded-2xl border border-line bg-surface p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-12" data-testid="intake-notice-body">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-ink pb-4">
            <LogoMark size={36} />
            <p className="text-[1.05rem] font-extrabold tracking-[0.02em] text-ink">{db.company.name}</p>
            {phone && (
              <p className="num ml-auto text-[1.05rem] font-extrabold" data-testid="intake-notice-phone">
                ☎ {phone}
              </p>
            )}
          </header>
          <h1 className="mt-6 text-center text-[3rem] font-extrabold leading-tight tracking-[-0.01em] print:mt-5 print:text-[36pt]">하자 접수 안내</h1>
          <p className="mt-3 text-center text-[1.3rem] font-bold [overflow-wrap:anywhere] print:mt-2" data-testid="intake-notice-site">{place}</p>
          <p className="mx-auto mt-3 max-w-[34rem] text-center text-[1.05rem] leading-relaxed text-ink-2">창문·유리·실리콘(코킹) 등에 문제가 있으면 아래 QR로 접수해 주세요. 사진과 함께 보내 주시면 더 빨리 확인합니다.</p>

          <div className="mt-7 flex flex-col items-center gap-3 print:mt-5 print:gap-2">
            <QrBox text={url} label="하자 접수 QR" className="size-[15rem] print:size-[68mm]" />
            <p className="text-[1.2rem] font-extrabold">휴대폰 카메라로 QR을 비춰 주세요</p>
            <p className="num max-w-full text-center text-[0.86rem] text-ink-2 [overflow-wrap:anywhere]" data-testid="intake-notice-url">{url}</p>
          </div>

          <ol className="mx-auto mt-7 max-w-[36rem] space-y-3 text-[1.05rem] print:mt-5 print:space-y-2">
            {["QR을 찍으면 접수 화면이 열립니다 (앱 설치·로그인 없음).", "문제가 있는 곳과 내용을 적고, 사진을 넣고, 연락받으실 번호를 적어 보냅니다.", "접수 번호와 ‘진행 확인 주소’가 화면에 나옵니다. 주소를 보관해 두면 보수 진행과 답변을 볼 수 있습니다."].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[0.95rem] font-extrabold text-white print:border print:border-ink print:bg-white print:text-ink">{i + 1}</span>
                <span className="leading-relaxed">{t}</span>
              </li>
            ))}
          </ol>

          {phone && (
            <p className="mt-7 rounded-2xl border-2 border-ink px-5 py-3 text-center text-[1.2rem] font-extrabold [break-inside:avoid] print:mt-5 print:py-2" data-testid="intake-notice-call">
              전화 접수 <span className="num">☎ {phone}</span>
            </p>
          )}

          <p className="mt-7 border-t border-line pt-3 text-[0.84rem] leading-relaxed text-ink-3 [break-inside:avoid] print:mt-4 print:pt-2">
            급한 일은 전화로 알려 주세요. 접수하신 이름·연락처는 하자 처리와 연락에만 쓰고, 처리가 끝난 뒤 일정 기간이 지나면 지웁니다.
            {!IS_LIVE && " DEMO — 가상 시연 데이터이며 이 QR은 시연 브라우저에서만 열립니다."}
          </p>
        </article>
      </div>
    </div>
  );
}
