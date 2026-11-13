"use client";

/** 운영 관리 화면 공통 입력 — 원 단위 금액(쉼표 표시), 0~100% */
import { fmtMan, parseKoreanWon } from "@/lib/domain/format";
import { Field, cx, inputCls } from "@/components/ui/primitives";

/** 금액 칸 글 → 원 (‘18억’·‘1억 8천만’도 읽는다 · D-77) */
export const toWon = (text: string) => parseKoreanWon(text);
const HAS_UNIT = /[조억만천백]/;
export const wonText = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "" : v.toLocaleString("ko-KR"));

export function MoneyField({ id, label, value, onChange, error, required, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; required?: boolean; hint?: string }) {
  const n = toWon(value);
  const bad = value.trim() !== "" && !Number.isFinite(n);
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      error={error ?? (bad ? "숫자로 적거나 ‘18억’, ‘1억 8천만’처럼 적어 주세요" : undefined)}
      hint={hint ?? (Number.isFinite(n) && n > 0 ? `= ${fmtMan(n)}` : "원 단위 숫자 또는 ‘18억’처럼")}
    >
      <input
        id={id}
        inputMode={HAS_UNIT.test(value) ? "text" : "numeric"}
        autoComplete="off"
        className={cx(inputCls, "num text-right")}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          // ‘억·만·천’을 치는 중이면 글 그대로 두고 칸을 벗어날 때 숫자로 바꾼다 · 숫자만이면 바로 쉼표
          if (HAS_UNIT.test(v)) return onChange(v);
          const d = v.replace(/[^\d]/g, "");
          onChange(d ? Number(d).toLocaleString("ko-KR") : "");
        }}
        onBlur={() => {
          if (HAS_UNIT.test(value) && Number.isFinite(n)) onChange(n.toLocaleString("ko-KR"));
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
