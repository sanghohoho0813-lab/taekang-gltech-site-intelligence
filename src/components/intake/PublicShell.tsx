"use client";

/**
 * 하자 접수 링크의 받는 사람 화면 틀 (D-74) — 메뉴·로그인 없이 회사 이름과 내용만. 휴대폰에서 한 손으로 쓰도록 좁고 크게.
 */
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { IS_LIVE } from "@/lib/mode";
import { LogoMark } from "@/components/shell/Logo";

export function PublicShell({ company, sub, sample, children, testId, state }: { company: string; sub: string; sample?: boolean; children: ReactNode; testId: string; state: string }) {
  return (
    <div className="min-h-dvh bg-[#F6F5F3]" data-testid={testId} data-state={state}>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-14 max-w-[560px] items-center gap-3 px-4 py-2">
          <LogoMark size={26} />
          <div className="min-w-0">
            <p className="text-[0.95rem] font-extrabold leading-tight [overflow-wrap:anywhere]" data-testid="public-company">{company}</p>
            <p className="text-[0.78rem] text-ink-2">{sub}</p>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[560px] px-4 py-5">
        {(!IS_LIVE || sample) && (
          <p className="mb-3 rounded-xl bg-[#FFF6DA] px-3.5 py-2 text-[0.8rem] font-semibold text-[#6B4E00]" data-testid="public-demo">
            DEMO · 가상 시연 데이터입니다{!IS_LIVE && " — 이 브라우저에만 저장되고 실제로 접수되지 않습니다"}.
          </p>
        )}
        {children}
      </main>
    </div>
  );
}

/** 열 수 없는 주소·닫힌 링크·오류 */
export function PublicMessage({ title, desc, children, testId, state }: { title: string; desc: string; children?: ReactNode; testId: string; state: string }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-[#F6F5F3] px-5 py-10" data-testid={testId} data-state={state}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-card">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-3 text-ink-2">
          <CircleAlert size={24} aria-hidden />
        </span>
        <h1 className="mt-4 text-[1.2rem] font-extrabold leading-snug" data-testid="public-gone-title">{title}</h1>
        <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-2">{desc}</p>
        {children}
      </div>
    </main>
  );
}
