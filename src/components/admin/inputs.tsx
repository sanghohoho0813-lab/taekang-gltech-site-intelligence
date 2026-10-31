"use client";

/** 운영 관리 화면 공통 입력 — 원 단위 금액(쉼표 표시), 0~100% */
import { fmtMan } from "@/lib/domain/format";
import { Field, cx, inputCls } from "@/components/ui/primitives";

export const toWon = (text: string) => {
  const d = text.replace(/[^\d]/g, "");
  return d ? Number(d) : NaN;
};
export const wonText = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "" : v.toLocaleString("ko-KR"));

export function MoneyField({ id, label, value, onChange, error, required, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; required?: boolean; hint?: string }) {
  const n = toWon(value);
  return (
    <Field label={label} htmlFor={id} required={required} error={error} hint={hint ?? (Number.isFinite(n) && n > 0 ? `= ${fmtMan(n)}` : undefined)}>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        className={cx(inputCls, "num text-right")}
        value={value}
        onChange={(e) => {
          const d = e.target.value.replace(/[^\d]/g, "");
          onChange(d ? Number(d).toLocaleString("ko-KR") : "");
        }}
      />
    </Field>
  );
}

export function PctInput({ id, value, onChange, label }: { id: string; value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      id={id}
      type="number"
      min={0}
      max={100}
      step={1}
      aria-label={label}
      className={cx(inputCls, "num w-24 text-right")}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))))}
    />
  );
}
