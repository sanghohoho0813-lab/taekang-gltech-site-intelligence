"use client";

/** 화면을 그리다가 난 오류 — 다시 시도·처음 화면, 운영 모드에서는 오류 기록으로 자동 보냄 (D-47) */
import { useEffect } from "react";
import { reportClientError } from "@/lib/browser/errorReport";
import { IS_LIVE } from "@/lib/mode";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, "render");
  }, [error]);
  return (
    <main id="main" className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col justify-center gap-4 px-5 py-10" data-testid="app-error">
      <h1 className="text-[1.6rem] font-extrabold">화면을 여는 중에 문제가 생겼어요</h1>
      <p className="text-[1.1rem] leading-relaxed text-ink-2">{IS_LIVE ? "본사 오류 기록으로 자동으로 알렸어요. 아래 ‘다시 시도’를 눌러 보세요. 계속되면 본사에 전화해 주세요." : "아래 ‘다시 시도’를 눌러 보세요."}</p>
      <button type="button" onClick={reset} className="press min-h-[3.6rem] rounded-2xl bg-cta text-[1.15rem] font-extrabold text-cta-text">
        다시 시도
      </button>
      <a href="/" className="press flex min-h-[3.6rem] items-center justify-center rounded-2xl border-2 border-line-strong bg-surface text-[1.1rem] font-bold">
        처음 화면으로
      </a>
    </main>
  );
}
