"use client";

/** 모든 차트는 실제 DB 계산값만 그린다 (라벨·값·단위 표시 — 가짜 그래프 금지). */
import { fmtEok, fmtPct } from "@/lib/domain/format";
import { cx } from "@/components/ui/primitives";
import { IS_LIVE } from "@/lib/mode";

export function MarginBars({
  rows,
  target,
}: {
  rows: { label: string; planned: number; current: number; href?: string }[];
  target: number;
}) {
  const max = Math.max(20, ...rows.flatMap((r) => [r.planned, r.current])) * 1.1;
  return (
    <div className="space-y-3.5" role="table" aria-label="현장별 계획 대비 현재 예상이익률">
      {rows.map((r) => {
        const down = r.current < r.planned - 0.05;
        return (
          <div key={r.label} role="row" className="grid grid-cols-[4.2rem_1fr] items-center gap-3">
            <span role="rowheader" className="text-[0.85rem] font-bold text-ink">{r.label}</span>
            <div role="cell" className="space-y-1">
              <div className="relative space-y-1">
              <span className="absolute -top-1 -bottom-1 z-10 w-0.5 rounded bg-ink-2/70" style={{ left: `${(target / max) * 100}%` }} aria-hidden />
              <div className="relative h-3 rounded-full bg-surface-3">
                <div className="anim-bar absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--t-chart-2)_35%,#D5DAE0)]" style={{ width: `${(r.planned / max) * 100}%` }} />
              </div>
              <div className="relative h-3 rounded-full bg-surface-3">
                <div className={cx("anim-bar absolute inset-y-0 left-0 rounded-full", down ? "bg-err" : "bg-chart-1")} style={{ width: `${(Math.max(0, r.current) / max) * 100}%` }} />
              </div>
              </div>
              <div className="flex justify-between text-[0.75rem] text-ink-3 num">
                <span>
                  계획 {fmtPct(r.planned)} → <b className={cx(down ? "text-err" : "text-ink")}>현재 {fmtPct(r.current)}</b>
                </span>
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[0.72rem] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-[color-mix(in_srgb,var(--t-chart-2)_35%,#D5DAE0)]" />계획 이익률</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-chart-1" />현재 예상이익률</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-ink-2" />목표 {target}%{IS_LIVE ? "" : " (DEMO 기준)"}</span>
      </div>
    </div>
  );
}

export function BillingBars({ rows }: { rows: { label: string; billed: number; received: number; outstanding: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.billed)) * 1.08;
  return (
    <div className="overflow-hidden">
      <div className="grid h-44 items-end gap-3 border-b border-line px-1" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }} role="img" aria-label="현장별 기성청구·수금·미수 금액">
        {rows.map((r) => (
          <div key={r.label} className="flex h-full min-w-0 items-end justify-center gap-1">
            {[
              { v: r.billed, c: "bg-chart-2", t: "확정 기성" },
              { v: r.received, c: "bg-chart-3", t: "수금" },
              { v: r.outstanding, c: "bg-chart-1", t: "미수" },
            ].map((b) => (
              <div key={b.t} className="flex h-full min-w-0 max-w-8 flex-1 flex-col items-center justify-end" title={`${r.label} ${b.t} ${fmtEok(b.v)}`}>
                <span className="mb-1 text-[0.6rem] font-semibold leading-none text-ink-3 num whitespace-nowrap">{fmtEok(b.v, { unit: false, digits: 1 }).replace("억", "")}</span>
                <div className={cx("w-full rounded-t-md origin-bottom [animation:tk-fade-up_600ms_ease-out_both]", b.c)} style={{ height: `${Math.max(2, (b.v / max) * 80)}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="grid gap-3 px-1 pt-2 text-center text-[0.8rem] font-bold text-ink" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((r) => (
          <span key={r.label}>{r.label}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-2" />확정 기성청구</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-3" />수금</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-1" />미수금</span>
        <span>막대 위 숫자 단위: 억 원 · 부가세 별도</span>
      </div>
    </div>
  );
}

export function Donut({ value, label, size = 132, stroke = 14, sub }: { value: number; label: string; size?: number; stroke?: number; sub?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label} ${Math.round(v)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--t-active-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--t-active)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset 800ms cubic-bezier(.22,.61,.36,1)" }}
        />
      </svg>
      <div className="absolute text-center leading-tight">
        <p className="text-[0.72rem] font-semibold text-ink-3">{label}</p>
        <p className="text-[1.6rem] font-extrabold text-ink num">{Math.round(v)}%</p>
        {sub && <p className="text-[0.65rem] text-ink-3">{sub}</p>}
      </div>
    </div>
  );
}

/** 계약금액 = 발생원가 + 잔여예상원가 + 예상이익 분해 바 (현장 손익 엔진 Signature) */
export function ProfitStack({ incurred, remaining, profit, contract }: { incurred: number; remaining: number; profit: number; contract: number }) {
  const total = Math.max(contract, incurred + remaining);
  const pct = (v: number) => `${(Math.max(0, v) / total) * 100}%`;
  const loss = profit < 0;
  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-xl ring-1 ring-line" role="img" aria-label={`발생원가 ${fmtEok(incurred)}, 잔여예상원가 ${fmtEok(remaining)}, 예상이익 ${fmtEok(profit)}`}>
        <div className="grid place-items-center bg-chart-2-fill text-[0.72rem] font-bold text-chart-2-text transition-[width] duration-700" style={{ width: pct(incurred) }}>
          <span className="truncate px-1">발생 {fmtEok(incurred, { unit: false, digits: 2 })}</span>
        </div>
        <div className="grid place-items-center bg-[color-mix(in_srgb,var(--t-chart-2)_45%,#C9CFD6)] text-[0.72rem] font-bold text-ink transition-[width] duration-700" style={{ width: pct(remaining) }}>
          <span className="truncate px-1">잔여 {fmtEok(remaining, { unit: false, digits: 2 })}</span>
        </div>
        {!loss && (
          <div className="grid place-items-center bg-chart-1-fill text-[0.72rem] font-bold text-chart-1-text transition-[width] duration-700" style={{ width: pct(profit) }}>
            <span className="truncate px-1">이익 {fmtEok(profit, { unit: false, digits: 2 })}</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.72rem] text-ink-3 num">
        <span>0</span>
        <span>{loss ? `EAC가 변경 반영 계약금액을 초과 (손실 ${fmtEok(-profit)})` : `변경 반영 계약금액 ${fmtEok(contract)}`}</span>
      </div>
    </div>
  );
}
