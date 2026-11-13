"use client";

/**
 * 현장 직원 그림 안내 1장 (D-52) — 실제 휴대폰 화면 그림 + 번호 + 큰 글씨 설명. A4 한 장으로 인쇄해 나눠 준다.
 * 그림은 시연 화면(가상 데이터)이다. 본사 전화번호는 운영 설정의 ‘본사 전화’가 있으면 넣고, 없으면 빈칸(직접 기입).
 */
import Link from "next/link";
import { helpPhoneOf } from "@/lib/domain/companyPhone";
import { ChevronLeft, Printer } from "lucide-react";
import { useMe } from "@/lib/data/hooks";
import { QUICK_STEPS, QUICK_TIPS } from "@/lib/help/quick";
import { PageBody, PageHeader } from "@/components/shell/AppShell";
import { Button, PageSkeleton } from "@/components/ui/primitives";

/** ‘버튼 이름’을 굵게 */
const strong = (text: string) =>
  text.split(/(‘[^’]+’)/g).map((p, i) =>
    p.startsWith("‘") ? (
      <b key={i} className="font-extrabold text-ink">
        {p}
      </b>
    ) : (
      <span key={i}>{p}</span>
    ),
  );

export function QuickGuide() {
  const { db, role } = useMe();
  if (!db) return <PageSkeleton />;
  const phone = helpPhoneOf(db.settings);
  return (
    <PageBody>
      <PageHeader
        className="no-print"
        title="그림 안내 1장"
        desc={role === "field" ? "하루 순서대로 누르는 버튼을 그림으로 보여 드려요." : "현장 직원에게 나눠 줄 휴대폰 사용법 1장입니다. 인쇄해서 첫날 함께 보세요."}
        right={
          <span className="flex flex-wrap gap-2">
            <Link href="/help" className="press inline-flex h-11 items-center gap-1 rounded-xl border border-line-strong bg-surface px-3 text-[0.92rem] font-bold" data-testid="quick-back">
              <ChevronLeft size={18} aria-hidden /> 사용 안내
            </Link>
            <Button icon={<Printer size={17} />} onClick={() => window.print()} data-testid="quick-print">
              인쇄
            </Button>
          </span>
        }
      />
      <article className="quick-guide mx-auto w-full max-w-[52rem] rounded-2xl border border-line bg-surface px-4 py-5 text-ink @min-[760px]:px-8 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0" data-testid="quick-doc">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-2">
          <h2 className="text-[1.6rem] font-extrabold leading-tight print:text-[20pt]">현장 직원 휴대폰 사용법</h2>
          <p className="text-[0.86rem] font-semibold text-ink-2 print:text-[9pt]">하루 순서대로 · 화면의 버튼 이름 그대로</p>
        </header>
        <ol className="mt-3 grid grid-cols-1 gap-3 @min-[640px]:grid-cols-2 print:grid-cols-2 print:gap-2.5">
          {QUICK_STEPS.map((s) => (
            <li key={s.no} className="flex break-inside-avoid flex-col gap-2 rounded-xl border-2 border-line-strong p-3 print:gap-1.5 print:p-2.5" data-testid="quick-step" data-no={s.no}>
              <p className="flex items-start gap-2.5">
                <span className="num grid size-9 shrink-0 place-items-center rounded-full bg-ink text-[1.15rem] font-extrabold text-surface print:size-8 print:text-[13pt]" aria-hidden>
                  {s.no}
                </span>
                <span className="min-w-0 break-keep">
                  <span className="block text-[1.22rem] font-extrabold leading-snug print:text-[13.5pt]">
                    <span className="sr-only">{s.no}. </span>
                    {strong(s.title)}
                  </span>
                  <span className="mt-0.5 block text-[1.02rem] leading-relaxed text-ink-2 print:text-[10.5pt] print:leading-snug">{strong(s.text)}</span>
                </span>
              </p>
              <img src={s.img} alt={s.alt} className="mx-auto mt-auto block h-auto max-h-48 w-auto max-w-full rounded-lg border border-line object-contain print:max-h-[40mm]" data-testid="quick-img" />
            </li>
          ))}
        </ol>
        <section className="mt-3 break-inside-avoid rounded-xl bg-surface-2 px-4 py-3 print:bg-transparent print:px-0 print:py-1" aria-label="알아 두면 좋은 것">
          <ul className="space-y-1.5 text-[1.02rem] leading-relaxed print:space-y-0.5 print:text-[10.5pt]">
            {QUICK_TIPS.map((t) => (
              // 글머리 기호와 글을 나눠 둔다 — 글이 길면 ‘•’만 윗줄에 혼자 남던 문제 (D-77 리허설)
              <li key={t.text} className="flex items-start gap-2 break-keep">
                <span aria-hidden className="shrink-0">•</span>
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span>{strong(t.text)}</span>
                  {t.img && <img src={t.img} alt={t.alt ?? ""} className="h-9 w-auto rounded-md border border-line print:h-7" />}
                </span>
              </li>
            ))}
            <li className="flex items-start gap-2 font-bold" data-testid="quick-phone">
              <span aria-hidden className="shrink-0">•</span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                모르는 게 있으면 본사로 전화:{" "}
                {phone ? <span className="num text-[1.15rem] print:text-[12pt]">{phone}</span> : <>
                    <span className="inline-block w-48 border-b-2 border-ink-3" aria-hidden />
                    <span className="sr-only">(직접 적는 칸)</span>
                  </>}
              </span>
            </li>
          </ul>
        </section>
        <p className="mt-2 text-[0.74rem] text-ink-3 print:text-[7.5pt]">그림은 예시 화면입니다. 실제 화면은 이름·현장·시각이 다릅니다.</p>
      </article>
    </PageBody>
  );
}
