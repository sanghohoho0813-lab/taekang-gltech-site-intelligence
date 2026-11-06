"use client";

/**
 * 쉬운 화면(현장 직원용) 공통 부품 — 60~70대도 어렵지 않게
 * 원칙: 한 화면에 질문 하나 · 큰 글자(19px 이상) · 누르는 곳은 높이 64px 이상 · 고르는 방식(타자 최소) · 쉬운 말
 */
import Link from "next/link";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { Check, ChevronLeft, Loader2, Minus, Plus } from "lucide-react";
import { cx } from "@/components/ui/primitives";

/** 화면 제목 + 설명 (질문형) */
export function EasyQuestion({ kicker, title, help, children, testId }: { kicker?: ReactNode; title: ReactNode; help?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <section className="space-y-5" data-testid={testId}>
      <header className="space-y-2">
        {kicker && <p className="text-[1rem] font-bold text-theme-ink">{kicker}</p>}
        <h2 className="text-[1.55rem] font-extrabold leading-snug tracking-tight text-ink">{title}</h2>
        {help && <p className="text-[1.05rem] leading-relaxed text-ink-2">{help}</p>}
      </header>
      {children}
    </section>
  );
}

/** 크게 고르는 버튼 (선택하면 굵은 테두리 + 체크) */
export function Choice({
  selected,
  onClick,
  icon,
  label,
  sub,
  testId,
  tone = "default",
  className,
}: {
  selected?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  testId?: string;
  tone?: "default" | "good" | "warn";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={cx(
        "press flex min-h-[4.25rem] w-full items-center gap-3.5 rounded-[1.4rem] border-2 px-4 py-3 text-left transition-colors",
        selected ? "border-active bg-active-soft shadow-card" : "border-line bg-surface hover:bg-surface-2",
        className,
      )}
    >
      {icon && (
        <span
          className={cx(
            "grid size-11 shrink-0 place-items-center rounded-full",
            tone === "good" ? "bg-ok-bg text-ok" : tone === "warn" ? "bg-warn-bg text-warn" : selected ? "bg-surface text-theme-ink" : "bg-surface-3 text-ink-2",
          )}
          aria-hidden
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[1.15rem] font-bold leading-snug text-ink">{label}</span>
        {sub && <span className="mt-0.5 block text-[0.95rem] leading-snug text-ink-2">{sub}</span>}
      </span>
      <span className={cx("grid size-8 shrink-0 place-items-center rounded-full border-2", selected ? "border-active bg-active text-white" : "border-line-strong bg-surface")} aria-hidden>
        {selected && <Check size={18} strokeWidth={3} />}
      </span>
    </button>
  );
}

/** 짧은 선택지(칩) — 여러 개 고를 수 있음 */
export function Chip({ selected, onClick, children, testId }: { selected?: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={cx(
        "press inline-flex min-h-[3.4rem] items-center gap-2 rounded-2xl border-2 px-4 py-2 text-left text-[1.08rem] font-bold leading-snug",
        selected ? "border-active bg-active-soft text-ink" : "border-line-strong bg-surface text-ink hover:bg-surface-2",
      )}
    >
      {selected && <Check size={19} strokeWidth={3} className="shrink-0 text-theme-ink" aria-hidden />}
      {children}
    </button>
  );
}

/** 홈 화면의 큰 메뉴 버튼 */
export function BigTile({
  href,
  onClick,
  icon,
  label,
  sub,
  badge,
  tone = "plain",
  testId,
}: {
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  tone?: "cta" | "plain" | "warn";
  testId?: string;
}) {
  const cls = cx(
    "press flex min-h-[5.5rem] w-full items-center gap-4 rounded-[1.75rem] px-5 py-4 text-left shadow-card",
    tone === "cta" ? "brand-band shadow-pop" : tone === "warn" ? "border border-warn/40 bg-warn-bg text-ink" : "border border-line bg-surface text-ink hover:bg-surface-2",
  );
  const inner = (
    <>
      <span className={cx("grid size-14 shrink-0 place-items-center rounded-full", tone === "cta" ? "bg-white text-[var(--t-cta)]" : tone === "warn" ? "bg-surface text-warn" : "bg-active-soft text-theme-ink")} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.3rem] font-extrabold leading-tight">{label}</span>
        {sub && <span className={cx("mt-1 block text-[1rem] leading-snug", tone === "cta" ? "text-white" : "text-ink-2")}>{sub}</span>}
      </span>
      {badge}
    </>
  );
  if (href)
    return (
      <Link href={href} className={cls} data-testid={testId}>
        {inner}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls} data-testid={testId}>
      {inner}
    </button>
  );
}

/**
 * 2칸 타일 (D-60) — 색 원 아이콘 + 큰 이름 + 짧은 설명. 현장 첫 화면의 할 일 모음.
 * tint: 할 일마다 다른 옅은 색 (테마 상태색 사용 — 다크 테마에서도 대비 유지)
 */
export function ActionTile({
  href,
  icon,
  label,
  sub,
  badge,
  tint = "theme",
  highlight = false,
  testId,
}: {
  href: string;
  icon: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  tint?: "theme" | "info" | "ok" | "warn";
  highlight?: boolean;
  testId?: string;
}) {
  const chip = { theme: "bg-active-soft text-theme-ink", info: "bg-info-bg text-info", ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn" }[tint];
  return (
    <Link
      href={href}
      className={cx("press relative flex min-h-[9.5rem] min-w-0 flex-col justify-between gap-3 rounded-[1.6rem] p-4 text-left shadow-card", highlight ? "border-2 border-warn/50 bg-warn-bg" : "border border-line bg-surface hover:bg-surface-2")}
      data-testid={testId}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={cx("grid size-12 shrink-0 place-items-center rounded-full", highlight ? "bg-surface text-warn" : chip)} aria-hidden>
          {icon}
        </span>
        {badge}
      </span>
      <span className="min-w-0">
        <span className="block text-[1.18rem] font-extrabold leading-tight text-ink [word-break:keep-all]">{label}</span>
        {sub && <span className="mt-1 line-clamp-2 text-[1rem] leading-snug text-ink-2">{sub}</span>}
      </span>
    </Link>
  );
}

/** − 숫자 + (큰 버튼) */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  label,
  format,
  testId,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit: string;
  label: string;
  format?: (v: number) => string;
  testId?: string;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  return (
    <div className="rounded-2xl border-2 border-line bg-surface p-3" role="group" aria-label={label} data-testid={testId}>
      <p className="mb-2 text-center text-[1.05rem] font-bold text-ink-2">{label}</p>
      <div className="grid grid-cols-[minmax(3.2rem,4.2rem)_minmax(0,1fr)_minmax(3.2rem,4.2rem)] items-center gap-2">
        <button type="button" onClick={() => set(value - step)} disabled={value <= min} className="press grid h-[4.2rem] place-items-center rounded-2xl bg-surface-3 text-ink disabled:opacity-35" aria-label={`${label} ${step} 줄이기`} data-testid={testId ? `${testId}-minus` : undefined}>
          <Minus size={30} strokeWidth={3} />
        </button>
        <output className="num text-center text-[2rem] font-extrabold leading-none text-ink" aria-live="polite">
          {format ? format(value) : value}
          <span className="ml-1 text-[1.15rem] font-bold text-ink-2">{unit}</span>
        </output>
        <button type="button" onClick={() => set(value + step)} disabled={value >= max} className="press grid h-[4.2rem] place-items-center rounded-2xl bg-surface-3 text-ink disabled:opacity-35" aria-label={`${label} ${step} 늘리기`} data-testid={testId ? `${testId}-plus` : undefined}>
          <Plus size={30} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}

/** 단계 표시 — 숫자 대신 이름으로 (작업 · 사진 · 문제 · 비용 · 확인) */
export function SectionBar({ sections, current, onBand = false }: { sections: string[]; current: number; onBand?: boolean }) {
  return (
    <ol className="flex gap-1.5" aria-label="진행 단계">
      {sections.map((s, i) => (
        <li key={s} className="min-w-0 flex-1" aria-current={i === current ? "step" : undefined}>
          <span className={cx("block h-2 rounded-full", onBand ? (i <= current ? "bg-white" : "bg-white/30") : i <= current ? "bg-active" : "bg-surface-3")} />
          <span
            className={cx(
              "mt-1 block truncate text-center text-[0.9rem]",
              // 띠 위에서는 글자를 모두 흰색으로 (대비 4.5:1 이상), 지금 단계는 굵게·밑줄
              onBand ? cx("text-white", i === current ? "font-extrabold underline decoration-2 underline-offset-4" : "font-semibold") : cx("font-bold", i === current ? "text-theme-ink" : i < current ? "text-ink-2" : "text-ink-3"),
            )}
          >
            {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 현장 화면 머리 띠 (D-61) — 첫 화면과 같은 브랜드 색 띠. 화면 위·양옆 끝까지 (부모의 px-4·pt-5를 상쇄).
 * 띠 위 글자는 모두 흰색 (주 버튼 색은 테마마다 흰 글자 대비 4.5:1 이상으로 맞춰져 있음).
 */
export function EasyPageHead({ title, sub, icon, children, testId }: { title?: ReactNode; sub?: ReactNode; icon?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <header className="brand-band -mx-4 -mt-5 space-y-2 rounded-b-[2rem] px-5 pb-6 pt-5" data-testid={testId}>
      {title && (
        <h1 className="flex items-center gap-2 text-[1.7rem] font-extrabold leading-tight text-white">
          {icon}
          {title}
        </h1>
      )}
      {sub && <p className="text-[1.08rem] leading-relaxed text-white">{sub}</p>}
      {children}
    </header>
  );
}

/** 화면 아래 고정 버튼 (이전 · 다음) — 엄지로 누르기 쉬운 위치 */
export function EasyBar({
  onBack,
  backLabel = "이전",
  onNext,
  nextLabel = "다음",
  nextDisabled,
  loading,
  nextTestId,
  sticky = true,
  embedded = false,
  hint,
  className,
}: {
  onBack?: () => void;
  backLabel?: string;
  onNext?: () => void;
  nextLabel?: ReactNode;
  nextDisabled?: boolean;
  loading?: boolean;
  nextTestId?: string;
  sticky?: boolean;
  /** 아래에서 올라오는 창 안에서 쓸 때 (하단 메뉴 위가 아니라 창 바닥에 고정) */
  embedded?: boolean;
  hint?: ReactNode;
  /** 마법사 맨 아래에 붙일 때 mt-auto 등 (D-65) */
  className?: string;
}) {
  return (
    <div className={cx("z-20 -mx-4 border-t border-line bg-surface/97 px-4 pb-3 pt-3 backdrop-blur", sticky && (embedded ? "sticky bottom-0" : "sticky bottom-[calc(4.9rem+env(safe-area-inset-bottom))] lg:bottom-0"), className)}>
      {hint && <p className="mb-2 text-center text-[0.98rem] font-semibold text-warn">{hint}</p>}
      <div className={cx("grid gap-2.5", onBack && onNext ? "grid-cols-[1fr_1.8fr]" : "grid-cols-1")}>
        {onBack && (
          <button type="button" onClick={onBack} className="press inline-flex h-[4rem] items-center justify-center gap-1 rounded-full border-2 border-line-strong bg-surface text-[1.15rem] font-bold text-ink" data-testid="easy-back">
            <ChevronLeft size={24} aria-hidden /> {backLabel}
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled || loading}
            aria-busy={loading || undefined}
            // 못 누를 때는 흐리게(햇빛에서 안 보임) 대신 회색 바탕 + 진한 글자 (D-65)
            className="press inline-flex h-[4rem] items-center justify-center gap-2 rounded-full bg-cta text-[1.25rem] font-extrabold text-cta-text shadow-card disabled:bg-surface-3 disabled:text-ink-2 disabled:shadow-none"
            data-testid={nextTestId ?? "easy-next"}
          >
            {loading && <Loader2 className="animate-spin" size={22} aria-hidden />}
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** 크게 보여주는 숫자 (금액 읽어주기) */
export function BigNumber({ children, sub, testId }: { children: ReactNode; sub?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-3 text-center" data-testid={testId}>
      <p className="num text-[2rem] font-extrabold leading-tight text-ink">{children}</p>
      {sub && <p className="mt-0.5 text-[1rem] text-ink-2">{sub}</p>}
    </div>
  );
}

/** 말로 입력 안내 */
export function VoiceHint() {
  return <p className="text-[0.98rem] text-ink-2">글자 대신 말로 입력하려면 휴대폰 키보드의 🎤 마이크 버튼을 누르세요.</p>;
}

export const easyTextareaCls =
  "w-full rounded-2xl border-2 border-line-strong bg-surface px-4 py-3 text-[1.15rem] leading-relaxed text-ink placeholder:text-ink-3 focus:border-active focus:outline-none focus:ring-4 focus:ring-active/20";

/** 마법사 하단 줄을 화면 아래쪽으로 — 짧은 단계에서 화면 가운데에 떠 있지 않게 (sticky는 그대로 · D-65) */
export function AtBottom({ bar }: { bar: ReactNode }) {
  return isValidElement<{ className?: string }>(bar) ? cloneElement(bar, { className: cx(bar.props.className, "mt-auto") }) : bar;
}
