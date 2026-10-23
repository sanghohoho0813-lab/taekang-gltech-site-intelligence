/** 회사 로고 마크(참고 시안의 T자 막대형 마크를 단순화) + 워드마크 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="3" y="5" width="26" height="5" rx="1.5" fill="var(--brand-mark)" />
      <rect x="13.5" y="12" width="5" height="16" rx="1.5" fill="var(--brand-mark)" />
      <rect x="6" y="12" width="4" height="10" rx="1.2" fill="var(--brand-mark)" opacity=".55" />
      <rect x="22" y="12" width="4" height="13" rx="1.2" fill="var(--brand-mark)" opacity=".75" />
    </svg>
  );
}

export function Logo({ onDark = true, compact = false }: { onDark?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <LogoMark />
      {!compact && (
        <div className="min-w-0 leading-none">
          <p className={`whitespace-nowrap text-[0.86rem] font-extrabold tracking-[0.06em] ${onDark ? "text-shell-strong" : "text-ink"}`}>TAEKANG GLTECH</p>
          <p className="mt-1 whitespace-nowrap text-[0.6rem] font-bold tracking-[0.2em] text-wordmark">SITE INTELLIGENCE</p>
        </div>
      )}
    </div>
  );
}
