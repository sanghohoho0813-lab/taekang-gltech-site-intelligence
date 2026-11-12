"use client";

/**
 * 하자 접수 링크의 받는 사람 화면 틀 (D-74) — 메뉴·로그인 없이 회사 이름과 내용만. 휴대폰에서 한 손으로 쓰도록 좁고 크게.
 * 회사 전화번호(본사가 넣어 둔 경우)는 머리말에 늘 보인다 — 계정이 없는 사람에게 전화는 하나뿐인 다른 길이다 (점검 10차).
 */
import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, Phone, X } from "lucide-react";
import { IS_LIVE } from "@/lib/mode";
import { telHref } from "@/lib/domain/intake";
import { LogoMark } from "@/components/shell/Logo";

/** 전화 걸기 — 누르면 전화 앱이 열린다 */
export function CallButton({ phone, label, className }: { phone: string; label?: string; className?: string }) {
  return (
    <a href={telHref(phone)} className={`press num inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong bg-surface px-3.5 text-[0.92rem] font-bold text-ink ${className ?? ""}`} data-testid="public-phone">
      <Phone size={16} aria-hidden />
      {label ? `${label} ` : ""}
      {phone}
    </a>
  );
}

/** ‘전화로 알려 주세요’ 뒤에 붙는 한 줄 — 번호가 있으면 누를 수 있게, 없으면 회사 이름만 */
export function CallHint({ company, phone, className }: { company?: string; phone?: string; className?: string }) {
  if (!phone) return null;
  return (
    <p className={`flex flex-wrap items-center gap-2 text-[0.88rem] text-ink-2 ${className ?? ""}`}>
      {company && <span className="whitespace-nowrap font-semibold text-ink">{company}</span>}
      <CallButton phone={phone} />
    </p>
  );
}

export function PublicShell({ company, phone, sub, sample, children, testId, state }: { company: string; phone?: string; sub: string; sample?: boolean; children: ReactNode; testId: string; state: string }) {
  return (
    <div className="min-h-dvh bg-[#F6F5F3]" data-testid={testId} data-state={state}>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-14 max-w-[560px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
          <LogoMark size={26} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.95rem] font-extrabold leading-tight [overflow-wrap:anywhere]" data-testid="public-company">{company}</p>
            <p className="text-[0.78rem] text-ink-2">{sub}</p>
          </div>
          {phone && <CallButton phone={phone} />}
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

/** 열 수 없는 주소·닫힌 링크·오류 — 회사와 전화번호를 알면 어디에 전화할지 보여 준다 */
export function PublicMessage({ title, desc, children, testId, state, company, phone }: { title: string; desc: string; children?: ReactNode; testId: string; state: string; company?: string; phone?: string }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-[#F6F5F3] px-5 py-10" data-testid={testId} data-state={state}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 text-center shadow-card">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-surface-3 text-ink-2">
          <CircleAlert size={24} aria-hidden />
        </span>
        <h1 className="mt-4 text-[1.2rem] font-extrabold leading-snug" data-testid="public-gone-title">{title}</h1>
        <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-2">{desc}</p>
        {company && (
          <p className="mt-4 text-[0.98rem] font-extrabold" data-testid="public-gone-company">
            {company}
          </p>
        )}
        {phone && <CallButton phone={phone} label="전화" className="mt-2" />}
        {children}
      </div>
    </main>
  );
}

/** 불러오는 동안 — 내부 화면의 뼈대 대신 같은 틀과 한 줄 안내 */
export function PublicLoading({ testId }: { testId: string }) {
  return (
    <div className="min-h-dvh bg-[#F6F5F3]" data-testid={testId} data-state="loading">
      <div className="h-14 border-b border-line bg-surface" />
      <p className="mx-auto max-w-[560px] px-4 py-10 text-center text-[0.95rem] text-ink-2" role="status">
        불러오는 중…
      </p>
    </div>
  );
}

/** 사진 — 누르면 화면 가득 크게 (다시 누르거나 닫기·Esc로 닫는다). 잘리지 않게 전체가 보인다 */
export function ZoomPhoto({ src, alt, className, testId }: { src: string; alt: string; className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`press block w-full overflow-hidden bg-surface-2 ${className ?? ""}`} aria-label={`${alt} 크게 보기`} data-testid={testId}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="size-full object-contain" />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-3" onClick={() => setOpen(false)} data-testid="photo-zoom">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid size-12 place-items-center rounded-full bg-white/15 text-white" aria-label="닫기" autoFocus>
            <X size={24} />
          </button>
        </div>
      )}
    </>
  );
}
