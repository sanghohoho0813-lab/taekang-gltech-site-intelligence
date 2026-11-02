"use client";

/**
 * 쉬운 화면(현장 직원용) 공통 부품 — 60~70대도 어렵지 않게
 * 원칙: 한 화면에 질문 하나 · 큰 글자(19px 이상) · 누르는 곳은 높이 64px 이상 · 고르는 방식(타자 최소) · 쉬운 말
 */
import Link from "next/link";
import type { ReactNode } from "react";
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
        "press flex min-h-[4.25rem] w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3 text-left transition-colors",
        selected ? "border-active bg-active-soft" : "border-line-strong bg-surface hover:bg-surface-2",
        className,
      )}
    >
      {icon && (
        <span
          className={cx(
            "grid size-11 shrink-0 place-items-center rounded-xl",
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
    "press flex min-h-[5.5rem] w-full items-center gap-4 rounded-3xl px-5 py-4 text-left shadow-card",
    tone === "cta" ? "bg-cta text-cta-text" : tone === "warn" ? "border-2 border-warn/50 bg-warn-bg text-ink" : "border-2 border-line bg-surface text-ink hover:bg-surface-2",
  );
  const inner = (
    <>
      <span className={cx("grid size-14 shrink-0 place-items-center rounded-2xl", tone === "cta" ? "bg-white/18" : tone === "warn" ? "bg-surface text-warn" : "bg-active-soft text-theme-ink")} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1.3rem] font-extrabold leading-tight">{label}</span>
        {sub && <span className={cx("mt-1 block text-[0.98rem] leading-snug", tone === "cta" ? "text-cta-text/90" : "text-ink-2")}>{sub}</span>}
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
      <div className="grid grid-cols-[4.2rem_1fr_4.2rem] items-center gap-2">
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
export function SectionBar({ sections, current }: { sections: string[]; current: number }) {
  return (
    <ol className="flex gap-1.5" aria-label="진행 단계">
      {sections.map((s, i) => (
        <li key={s} className="min-w-0 flex-1" aria-current={i === current ? "step" : undefined}>
          <span className={cx("block h-2 rounded-full", i < current ? "bg-active" : i === current ? "bg-active" : "bg-surface-3")} />
          <span className={cx("mt-1 block truncate text-center text-[0.9rem] font-bold", i === current ? "text-theme-ink" : i < current ? "text-ink-2" : "text-ink-3")}>{s}</span>
        </li>
      ))}
    </ol>
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
}) {
  return (
    <div className={cx("z-20 -mx-4 border-t border-line bg-surface/97 px-4 pb-3 pt-3 backdrop-blur", sticky && (embedded ? "sticky bottom-0" : "sticky bottom-[calc(4.9rem+env(safe-area-inset-bottom))] lg:bottom-0"))}>
      {hint && <p className="mb-2 text-center text-[0.98rem] font-semibold text-warn">{hint}</p>}
      <div className={cx("grid gap-2.5", onBack && onNext ? "grid-cols-[1fr_1.8fr]" : "grid-cols-1")}>
        {onBack && (
          <button type="button" onClick={onBack} className="press inline-flex h-[4rem] items-center justify-center gap-1 rounded-2xl border-2 border-line-strong bg-surface text-[1.15rem] font-bold text-ink" data-testid="easy-back">
            <ChevronLeft size={24} aria-hidden /> {backLabel}
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled || loading}
            aria-busy={loading || undefined}
            className="press inline-flex h-[4rem] items-center justify-center gap-2 rounded-2xl bg-cta text-[1.25rem] font-extrabold text-cta-text shadow-sm disabled:opacity-40"
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
