"use client";

import type { ReactNode } from "react";
import { LogoMark } from "@/components/shell/Logo";

/** 로그인·최초 설정·계정 화면 공통 틀 — 메뉴 없이 가운데 카드 */
export function AuthFrame({ title, desc, children, wide = false }: { title: string; desc?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,#F7F8FA,#E3E6EB)] px-4 py-10">
      <div className={wide ? "w-full max-w-[34rem]" : "w-full max-w-[26rem]"}>
        <div className="mb-5 flex items-center gap-2.5">
          <LogoMark size={34} />
          <div className="leading-tight">
            <p className="text-[0.95rem] font-extrabold tracking-[0.08em] text-ink">TAEKANG GLTECH</p>
            <p className="text-[0.66rem] font-bold tracking-[0.2em] text-theme-ink">SITE INTELLIGENCE</p>
          </div>
        </div>
        <div className="rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-7">
          <h1 className="text-[1.35rem] font-bold text-ink">{title}</h1>
          {desc && <p className="mt-1.5 text-[0.86rem] text-ink-3">{desc}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </main>
  );
}
