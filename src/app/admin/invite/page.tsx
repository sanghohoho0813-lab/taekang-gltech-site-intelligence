"use client";

/**
 * 앱 가입 안내문 (D-91) — 본사가 A4 한 장으로 인쇄해 현장 사무실·본사에 붙이거나 나눠 준다. QR을 찍으면 가입 신청 화면이 열린다.
 * 신청만으로는 로그인되지 않고, 본사 가입 승인 담당이 승인해야 한다 (D-90). 사람 이름·금액 없음.
 */
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { IS_LIVE } from "@/lib/mode";
import { helpPhoneOf } from "@/lib/domain/companyPhone";
import { Button, DemoBadge, EmptyState, PageSkeleton } from "@/components/ui/primitives";
import { LogoMark } from "@/components/shell/Logo";
import { QrBox } from "@/components/admin/IntakeLinks";
import { signupUrl } from "@/components/admin/InviteCard";
import { inviteWho, isInviteKind, whoQuoted } from "@/lib/domain/invite";

export default function InviteNoticePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const q = useSearchParams();
  const { db, role } = useMe();
  if (!db) return <PageSkeleton />;
  if (role !== "ceo" && role !== "manager")
    return (
      <div className="mx-auto max-w-xl px-5 py-16">
        <EmptyState icon={<Lock size={26} />} title="본사만 볼 수 있습니다" desc="가입 안내문은 본사가 인쇄해 전하는 문서입니다." />
      </div>
    );
  const k = q.get("k");
  const kind = isInviteKind(k) ? k : "field";
  const who = inviteWho(kind);
  const url = signupUrl(kind);
  const phone = helpPhoneOf(db.settings);
  const steps = [
    "휴대폰 카메라로 QR을 비추면 가입 신청 화면이 열립니다 (앱 설치 없음).",
    `이름·휴대폰 번호·이메일(로그인 아이디)·비밀번호를 적고, ‘어떤 일로 쓰시나요?’에서 ${whoQuoted(kind)} 확인한 뒤 ‘가입 신청하기’를 누릅니다.`,
    "본사가 확인하고 승인하면 그 이메일과 비밀번호로 로그인됩니다. 승인 전에는 ‘승인 대기’라고 나옵니다.",
    "로그인한 뒤 ‘홈 화면에 추가’를 해 두면 앱처럼 바로 열립니다. 아이폰: 사파리 아래 공유 버튼 → 홈 화면에 추가 · 갤럭시: 크롬 오른쪽 위 ⋮ → 홈 화면에 추가",
  ];
  return (
    <div className="print-plain bg-[#F6F5F3] print:bg-white" data-testid="invite-notice">
      <header className="no-print border-b border-line bg-surface/95">
        <div className="mx-auto flex min-h-16 max-w-[820px] flex-wrap items-center gap-2 px-4 py-2">
          <Link href="/admin?tab=members" className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-[0.9rem] font-bold text-ink-2 hover:bg-surface-3">
            <ArrowLeft size={17} aria-hidden /> 운영 관리 · 사용자
          </Link>
          <span className="text-[0.8rem] text-ink-3">가입 안내문 · {who}용</span>
          {!phone && (
            <span className="basis-full rounded-xl bg-warn-bg px-3 py-1.5 text-[0.82rem] font-semibold text-ink sm:basis-auto" data-testid="invite-notice-nophone">
              회사 문의 전화번호가 없습니다 — 운영 설정에서 넣으면 안내문에 인쇄됩니다.
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <DemoBadge compact />
            <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="invite-notice-print">
              인쇄·PDF
            </Button>
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-[820px] px-4 py-6 print:max-w-none print:p-0">
        <article className="rounded-2xl border border-line bg-surface p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-12" data-testid="invite-notice-body">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-ink pb-4">
            <LogoMark size={36} />
            <p className="text-[1.05rem] font-extrabold tracking-[0.02em] text-ink">{db.company.name}</p>
            {phone && <p className="num ml-auto text-[1.05rem] font-extrabold">☎ {phone}</p>}
          </header>
          <h1 className="mt-6 text-center text-[2.6rem] font-extrabold leading-tight tracking-[-0.01em] print:mt-5 print:text-[32pt]">현장 관리 앱 가입 안내</h1>
          <p className="mt-3 text-center text-[1.3rem] font-bold print:mt-2" data-testid="invite-notice-who">
            {who}용
          </p>

          <div className="mt-7 flex flex-col items-center gap-3 print:mt-5 print:gap-2">
            <QrBox text={url} label="가입 신청 QR" className="size-[15rem] print:size-[68mm]" />
            <p className="text-[1.2rem] font-extrabold">휴대폰 카메라로 QR을 비춰 주세요</p>
            <p className="num max-w-full text-center text-[0.86rem] text-ink-2 [overflow-wrap:anywhere]" data-testid="invite-notice-url">
              {url}
            </p>
          </div>

          <ol className="mx-auto mt-7 max-w-[36rem] space-y-3 text-[1.05rem] print:mt-5 print:space-y-2">
            {steps.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-[0.95rem] font-extrabold text-white print:border print:border-ink print:bg-white print:text-ink">{i + 1}</span>
                <span className="leading-relaxed">{t}</span>
              </li>
            ))}
          </ol>

          {phone && (
            <p className="mt-7 rounded-2xl border-2 border-ink px-5 py-3 text-center text-[1.2rem] font-extrabold [break-inside:avoid] print:mt-5 print:py-2">
              가입이 안 되면 본사로 전화 <span className="num">☎ {phone}</span>
            </p>
          )}

          <p className="mt-7 border-t border-line pt-3 text-[0.84rem] leading-relaxed text-ink-3 [break-inside:avoid] print:mt-4 print:pt-2">
            비밀번호는 다른 사람에게 알려 주지 마세요. 적어 주신 이름·연락처는 가입 확인과 업무 연락에만 씁니다.
            {!IS_LIVE && " DEMO — 시연판에는 가입 신청 화면이 없습니다. 실제 운영 주소에서 인쇄하세요."}
          </p>
        </article>
      </div>
    </div>
  );
}
