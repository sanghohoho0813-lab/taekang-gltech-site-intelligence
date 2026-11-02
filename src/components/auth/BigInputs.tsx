"use client";

/** 로그인·비밀번호 화면용 큰 입력칸 — 비밀번호 보기, 한글 자판·Caps Lock 경고 */
import { useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff } from "lucide-react";
import { cx } from "@/components/ui/primitives";

export const bigInputCls =
  "w-full h-[3.8rem] rounded-2xl border-2 border-line-strong bg-surface px-4 text-[1.2rem] text-ink placeholder:text-ink-3 focus:border-active focus:outline-none focus:ring-4 focus:ring-active/20";

const HANGUL = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

export function BigLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[1.1rem] font-bold text-ink">
      {children}
    </label>
  );
}

/** 입력이 한글로 들어가고 있으면 알려준다 (어르신이 가장 많이 막히는 지점) */
export function HangulWarning({ value }: { value: string }) {
  if (!HANGUL.test(value)) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[1.02rem] font-bold text-warn" role="alert">
      <AlertTriangle size={18} aria-hidden /> 한글로 입력되고 있어요. 키보드를 영어(ABC)로 바꿔 주세요.
    </p>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, show, onToggle, testId }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; show: boolean; onToggle: () => void; testId?: string }) {
  const [caps, setCaps] = useState(false);
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cx(bigInputCls, "pr-[6.2rem]")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
          data-testid={testId}
        />
        <button type="button" onClick={onToggle} className="press absolute right-1.5 top-1/2 inline-flex h-[3rem] -translate-y-1/2 items-center gap-1 rounded-xl px-3 text-[1rem] font-bold text-ink-2 hover:bg-surface-3" aria-pressed={show} aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}>
          {show ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
          {show ? "숨기기" : "보기"}
        </button>
      </div>
      <HangulWarning value={value} />
      {caps && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[1.02rem] font-bold text-warn" role="alert">
          <AlertTriangle size={18} aria-hidden /> 대문자 고정(Caps Lock)이 켜져 있어요.
        </p>
      )}
    </div>
  );
}

/** 새 비밀번호 조건을 입력하는 동안 바로 보여준다 */
export function PasswordRules({ value, confirm }: { value: string; confirm: string }) {
  const rules: [string, boolean][] = [
    ["8자 이상", value.length >= 8],
    ["영어 글자 포함", /[A-Za-z]/.test(value)],
    ["숫자 포함", /\d/.test(value)],
    ["두 번 똑같이 입력", !!value && value === confirm],
  ];
  return (
    <ul className="grid grid-cols-2 gap-2" aria-label="새 비밀번호 조건" data-testid="password-rules">
      {rules.map(([label, ok]) => (
        <li key={label} className={cx("flex items-center gap-1.5 rounded-xl px-3 py-2 text-[1rem] font-bold", ok ? "bg-ok-bg text-ok" : "bg-surface-3 text-ink-2")}>
          <Check size={18} strokeWidth={3} className={ok ? "" : "opacity-30"} aria-hidden /> {label}
        </li>
      ))}
    </ul>
  );
}
