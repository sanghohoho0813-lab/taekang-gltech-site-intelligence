"use client";

import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CircleAlert, CircleCheck, Info, Loader2 } from "lucide-react";
import type { Severity } from "@/lib/domain/types";
import { SEVERITY_LABEL } from "@/lib/domain/labels";
import { IS_LIVE } from "@/lib/mode";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "cta" | "primary" | "outline" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; block?: boolean }
>(function Button({ variant = "outline", size = "md", loading, icon, block, className, children, disabled, ...rest }, ref) {
  const base =
    "press inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap select-none disabled:opacity-50 disabled:pointer-events-none";
  const sizes: Record<Size, string> = {
    sm: "h-9 px-3 text-[0.82rem]",
    md: "h-11 px-4 text-[0.9rem]",
    lg: "h-[3.1rem] px-5 text-[1rem] font-bold",
  };
  const variants: Record<Variant, string> = {
    cta: "bg-cta text-cta-text font-bold shadow-sm hover:brightness-[1.06] active:brightness-95",
    primary: "bg-primary text-white hover:brightness-110",
    outline: "bg-surface text-ink border border-line-strong hover:bg-surface-2 hover:border-ink-3",
    ghost: "text-ink-2 hover:bg-surface-3",
    danger: "bg-surface text-err border border-err/40 hover:bg-err-bg",
    soft: "bg-active-soft text-theme-ink hover:brightness-[0.98] border border-transparent",
  };
  return (
    <button
      ref={ref}
      className={cx(base, sizes[size], variants[variant], block && "w-full", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" size={18} aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx("min-w-0 rounded-2xl border border-line bg-surface shadow-card", className)} {...rest}>
      {children}
    </As>
  );
}

export function CardHeader({ title, sub, right, className }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-4 pb-3", className)}>
      <div className="min-w-[min(100%,13rem)] flex-1">
        <h2 className="text-[1.05rem] font-bold text-ink leading-snug">{title}</h2>
        {sub && <p className="mt-0.5 text-[0.82rem] text-ink-3">{sub}</p>}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </div>
  );
}

type Tone = "neutral" | "ok" | "warn" | "err" | "info" | "theme" | "demo" | "dark";
export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-surface-3 text-ink-2 border-line",
    ok: "bg-ok-bg text-ok border-ok/20",
    warn: "bg-warn-bg text-warn border-warn/25",
    err: "bg-err-bg text-err border-err/25",
    info: "bg-info-bg text-info border-info/20",
    theme: "bg-active-soft text-theme-ink border-transparent",
    demo: "bg-[#FFF7D6] text-[#7A5200] border-[#F2D27A]",
    dark: "bg-ink text-white border-ink",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.75rem] font-semibold leading-5 whitespace-nowrap", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function DemoBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  // 실제 운영(LIVE) 데이터에는 가상 데이터 표시를 하지 않는다
  if (IS_LIVE) return null;
  return (
    <Badge tone="demo" className={className}>
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-[#C98A00]" />
      {compact ? "DEMO" : "DEMO · 가상 시연 데이터"}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const map = {
    high: { tone: "err" as const, Icon: AlertTriangle },
    medium: { tone: "warn" as const, Icon: CircleAlert },
    low: { tone: "info" as const, Icon: Info },
  }[severity];
  return (
    <Badge tone={map.tone} icon={<map.Icon size={13} aria-hidden />}>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "err" | "neutral" }) {
  const c = { ok: "bg-ok", warn: "bg-warn", err: "bg-err", neutral: "bg-ink-3" }[tone];
  return <span aria-hidden className={cx("inline-block size-2 rounded-full", c)} />;
}

export function ProgressBar({ value, tone = "theme", label, className, animate = true }: { value: number; tone?: "theme" | "ok" | "warn" | "err" | "neutral"; label?: string; className?: string; animate?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const c = { theme: "bg-active", ok: "bg-ok", warn: "bg-warn", err: "bg-err", neutral: "bg-ink-3" }[tone];
  return (
    <div className={cx("h-2 w-full rounded-full bg-surface-3 overflow-hidden", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full", c, animate && "anim-bar")} style={{ width: `${v}%` }} />
    </div>
  );
}

/** 값이 바뀌면 이전 값에서 새 값으로 숫자가 이동 (계산 결과를 보여주는 표시용 — 숫자를 지어내지 않는다) */
export function CountUp({ value, format, duration = 650, className }: { value: number; format: (v: number) => string; duration?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) return;
    const reduce = document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2300);
    if (reduce) {
      setShown(to);
      return () => clearTimeout(t);
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(p < 1 ? from + (to - from) * e : to);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [value, duration]);
  return (
    <span className={cx("num rounded-md transition-colors", flash && "bg-active-soft", className)} data-value={value}>
      {format(shown)}
    </span>
  );
}

export function EmptyState({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-10 px-6">
      {icon && <div className="text-ink-3 mb-1">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {desc && <p className="text-[0.85rem] text-ink-3 max-w-sm">{desc}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-xl bg-surface-3", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="p-5 md:p-8 space-y-5" aria-busy="true" aria-label="불러오는 중">
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "err" | "ok"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const m = {
    info: { c: "bg-info-bg border-info/20 text-ink-2", I: Info, ic: "text-info" },
    warn: { c: "bg-warn-bg border-warn/25 text-ink-2", I: AlertTriangle, ic: "text-warn" },
    err: { c: "bg-err-bg border-err/25 text-ink-2", I: CircleAlert, ic: "text-err" },
    ok: { c: "bg-ok-bg border-ok/20 text-ink-2", I: CircleCheck, ic: "text-ok" },
  }[tone];
  return (
    <div className={cx("flex gap-2.5 rounded-xl border px-3.5 py-3 text-[0.85rem]", m.c, className)} role={tone === "err" ? "alert" : undefined}>
      <m.I size={18} className={cx("shrink-0 mt-0.5", m.ic)} aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, required, hint, error, children, counter }: { label: string; htmlFor: string; required?: boolean; hint?: ReactNode; error?: string; children: ReactNode; counter?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[0.88rem] font-semibold text-ink">
          {label}
          {required && <span className="text-err ml-0.5" aria-hidden>*</span>}
        </label>
        {counter && <span className="text-[0.75rem] text-ink-3 num">{counter}</span>}
      </div>
      {children}
      {error ? (
        <p className="text-[0.8rem] font-medium text-err" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[0.78rem] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[0.95rem] text-ink placeholder:text-ink-3/80 transition-colors focus:border-active focus:outline-none focus:ring-3 focus:ring-active/20 disabled:bg-surface-3";

export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode; testId?: string }[]; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-surface-2 p-1 gap-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={o.testId}
            onClick={() => onChange(o.value)}
            className={cx(
              "press inline-flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap",
              size === "sm" ? "h-8 px-2.5 text-[0.78rem]" : "h-9 px-3 text-[0.85rem]",
              on ? "bg-surface text-ink shadow-sm ring-1 ring-line-strong" : "text-ink-3 hover:text-ink hover:bg-surface",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function KeyValue({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 py-1.5", className)}>
      <dt className="text-[0.85rem] text-ink-3">{k}</dt>
      <dd className="text-[0.92rem] font-semibold text-ink num text-right">{v}</dd>
    </div>
  );
}
