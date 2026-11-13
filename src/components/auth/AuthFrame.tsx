"use client";

import type { ReactNode } from "react";
import { LogoMark } from "@/components/shell/Logo";

/** 로그인·최초 설정·계정 화면 공통 틀 — 브랜드 색 머리 띠 위로 카드가 겹쳐 올라온다 (D-60) */
export function AuthFrame({ title, desc, children, wide = false }: { title: string; desc?: ReactNode; children: ReactNode; wide?: boolean }) {
  const width = wide ? "max-w-[34rem]" : "max-w-[26rem]";
  return (
    <main id="main" className="min-h-dvh bg-canvas">
      <div className="brand-band px-4 pb-20 pt-10">
        <div className={`mx-auto w-full ${width}`}>
          <div className="flex items-center gap-2.5">
            <span className="grid size-11 place-items-center rounded-2xl bg-white shadow-card" aria-hidden>
              <LogoMark size={28} />
            </span>
            <div className="leading-tight">
              <p className="text-[0.95rem] font-extrabold tracking-[0.08em] text-white">TAEKANG GLTECH</p>
              <p className="text-[0.66rem] font-bold tracking-[0.2em] text-white">SITE INTELLIGENCE</p>
            </div>
          </div>
          <p className="mt-6 text-[1.45rem] font-extrabold leading-snug [text-wrap:balance]">현장 출퇴근·보고·공정을 한곳에서</p>
        </div>
      </div>
      <div className={`mx-auto -mt-12 w-full px-4 pb-10 ${width}`}>
        <div className="rounded-[1.75rem] border border-line bg-surface p-6 shadow-pop sm:p-7">
          <h1 className="text-[1.65rem] font-extrabold text-ink">{title}</h1>
          {desc && <p className="mt-1.5 text-[1.02rem] leading-relaxed text-ink-2">{desc}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}
