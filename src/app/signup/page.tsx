"use client";

/**
 * 회원가입 신청 (D-90) — 로그인 없이. 신청하면 ‘승인 대기’가 되고, 본사의 가입 승인 담당이 승인해야 로그인된다.
 * 큰 글씨·큰 칸 (현장 직원이 휴대폰으로 직접 신청), 한글 자판 경고, 비밀번호 보기.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { BigLabel, HangulWarning, PasswordInput, bigInputCls } from "@/components/auth/BigInputs";
import { Notice, cx } from "@/components/ui/primitives";
import { api } from "@/lib/live/api";
import { IS_LIVE } from "@/lib/mode";

type Kind = "field" | "manager" | "partner" | "other";
const KINDS: { value: Kind; label: string; help: string }[] = [
  { value: "field", label: "현장 직원", help: "출퇴근·현장 보고" },
  { value: "manager", label: "본사 직원", help: "공무·관리" },
  { value: "partner", label: "발주처·협력사", help: "공정·요청 확인" },
  { value: "other", label: "그 밖", help: "본사가 정해 줌" },
];

export default function SignupPage() {
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "", phone: "", title: "", kind: "" as Kind | "", note: "", agree: false });
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (IS_LIVE) void api<{ needsSetup: boolean }>("/api/setup").then((r) => setNeedsSetup(!!r.data?.needsSetup));
    // 본사가 보낸 안내 주소(?k=field|manager|partner)면 ‘어떤 일로’를 미리 골라 둔다 — 바꿀 수 있고, 역할은 승인할 때 본사가 정한다 (D-91)
    const k = new URLSearchParams(window.location.search).get("k");
    if (k === "field" || k === "manager" || k === "partner") setF((v) => (v.kind ? v : { ...v, kind: k }));
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const local: Record<string, string> = {};
    if (!f.name.trim()) local.name = "이름을 넣어 주세요.";
    if (!f.email.trim()) local.email = "로그인 아이디로 쓸 이메일을 넣어 주세요.";
    if (f.password !== f.confirm) local.confirm = "비밀번호가 서로 다릅니다.";
    if (!f.phone.trim()) local.phone = "휴대폰 번호를 넣어 주세요.";
    if (!f.kind) local.kind = "어떤 일로 쓰시는지 골라 주세요.";
    if (!f.agree) local.agree = "개인정보 수집·이용에 동의해야 신청할 수 있습니다.";
    if (Object.keys(local).length) {
      setErrors(local);
      setError(Object.values(local)[0]);
      return;
    }
    setBusy(true);
    setError(null);
    const { confirm: _c, ...body } = f;
    void _c;
    const r = await api<{ ok: true }>("/api/auth/signup", { body });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    setDone(true);
  };

  if (!IS_LIVE)
    return (
      <AuthFrame title="회원가입 신청" desc="시연(DEMO) 화면에는 회원가입이 없습니다.">
        <Link href="/dashboard" className="font-bold underline">
          시연 화면으로
        </Link>
      </AuthFrame>
    );

  if (done)
    return (
      <AuthFrame title="신청을 받았습니다" desc="본사에서 확인하고 승인하면 로그인할 수 있습니다.">
        <div className="space-y-4 text-[1.08rem] leading-relaxed" data-testid="signup-done">
          <p className="flex items-start gap-2 rounded-2xl bg-ok-bg px-4 py-3.5 font-bold text-ink">
            <CheckCircle2 size={24} className="mt-0.5 shrink-0 text-ok" aria-hidden />
            가입 신청이 접수되었습니다.
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-ink-2">
            <li>
              승인되면 <b className="text-ink">{f.email.trim().toLowerCase()}</b> 와 방금 정한 비밀번호로 로그인합니다.
            </li>
            <li>승인 전에 로그인하면 ‘승인 대기’라고 나옵니다.</li>
            <li>급하면 본사에 전화해 승인을 요청하세요.</li>
          </ul>
          <Link href="/login" className="press inline-flex h-[3.6rem] w-full items-center justify-center rounded-full border-2 border-line-strong bg-surface text-[1.15rem] font-extrabold" data-testid="signup-to-login">
            로그인 화면으로
          </Link>
        </div>
      </AuthFrame>
    );

  return (
    <AuthFrame title="회원가입 신청" desc="신청하면 본사가 확인한 뒤 승인합니다. 승인 전에는 로그인되지 않습니다." wide>
      {needsSetup && (
        <Notice tone="info" title="아직 회사 설정 전입니다">
          회사 설정이 끝난 뒤에 신청할 수 있습니다.
        </Notice>
      )}
      <form onSubmit={submit} className="mt-1 space-y-5" noValidate data-testid="signup-form">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <BigLabel htmlFor="su-name">이름</BigLabel>
            <input id="su-name" autoComplete="name" className={bigInputCls} value={f.name} onChange={set("name")} maxLength={40} aria-invalid={!!errors.name} />
            {errors.name && <FieldError text={errors.name} />}
          </div>
          <div>
            <BigLabel htmlFor="su-phone">휴대폰 번호</BigLabel>
            <input id="su-phone" type="tel" inputMode="tel" autoComplete="tel" className={bigInputCls} value={f.phone} onChange={set("phone")} placeholder="010-1234-5678" aria-invalid={!!errors.phone} />
            {errors.phone && <FieldError text={errors.phone} />}
          </div>
        </div>
        <div>
          <BigLabel htmlFor="su-email">이메일 (로그인 아이디)</BigLabel>
          <input id="su-email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={bigInputCls} value={f.email} onChange={set("email")} aria-invalid={!!errors.email} />
          <HangulWarning value={f.email} />
          {errors.email && <FieldError text={errors.email} />}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <BigLabel htmlFor="su-pw">비밀번호</BigLabel>
            <PasswordInput id="su-pw" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" show={show} onToggle={() => setShow((v) => !v)} />
            <p className="mt-1 text-[0.95rem] text-ink-3">8자 이상 · 영문과 숫자 함께</p>
            {errors.password && <FieldError text={errors.password} />}
          </div>
          <div>
            <BigLabel htmlFor="su-pw2">비밀번호 한 번 더</BigLabel>
            <PasswordInput id="su-pw2" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" show={show} onToggle={() => setShow((v) => !v)} />
            {errors.confirm && <FieldError text={errors.confirm} />}
          </div>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[1.1rem] font-bold text-ink">어떤 일로 쓰시나요?</legend>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <label key={k.value} className={cx("press cursor-pointer rounded-2xl border-2 px-3.5 py-3 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-active/20", f.kind === k.value ? "border-active bg-active-soft" : "border-line-strong")}>
                <input type="radio" name="su-kind" className="sr-only" checked={f.kind === k.value} onChange={() => setF({ ...f, kind: k.value })} data-testid={`su-kind-${k.value}`} />
                <span className="block text-[1.08rem] font-extrabold text-ink">{k.label}</span>
                <span className="block text-[0.92rem] text-ink-3">{k.help}</span>
              </label>
            ))}
          </div>
          {errors.kind && <FieldError text={errors.kind} />}
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <BigLabel htmlFor="su-title">소속·직함 (선택)</BigLabel>
            <input id="su-title" className={bigInputCls} value={f.title} onChange={set("title")} maxLength={40} placeholder="예: 현장소장 / OO건설 공무" />
          </div>
          <div>
            <BigLabel htmlFor="su-note">본사에 남길 말 (선택)</BigLabel>
            <input id="su-note" className={bigInputCls} value={f.note} onChange={set("note")} maxLength={200} placeholder="예: 물류센터 현장 근무" />
          </div>
        </div>
        <label className={cx("flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3.5 text-[1rem] leading-relaxed", errors.agree ? "border-err" : "border-line")} data-testid="su-agree">
          <input type="checkbox" className="mt-1 size-5 shrink-0" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />
          <span>
            <b className="text-ink">개인정보 수집·이용에 동의합니다 (필수)</b>
            <span className="mt-0.5 block text-[0.95rem] text-ink-2">
              가입 확인을 위해 이름·이메일·휴대폰 번호·소속을 받습니다. 본사의 가입 승인 담당만 봅니다. 승인되지 않으면 30일, 처리되지 않은 신청은 60일 뒤 지웁니다.
            </span>
          </span>
        </label>
        {error && (
          <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.05rem] font-bold leading-relaxed text-err" role="alert" data-testid="signup-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || needsSetup} aria-busy={busy || undefined} className="press inline-flex h-[4rem] w-full items-center justify-center gap-2 rounded-full bg-cta text-[1.3rem] font-extrabold text-cta-text shadow-card disabled:opacity-60" data-testid="signup-submit">
          {busy ? <Loader2 size={22} className="animate-spin" aria-hidden /> : <UserPlus size={22} aria-hidden />}
          가입 신청하기
        </button>
        <p className="text-center text-[1.02rem] text-ink-2">
          이미 계정이 있나요?{" "}
          <Link href="/login" className="font-bold text-theme-ink underline">
            로그인
          </Link>
        </p>
      </form>
    </AuthFrame>
  );
}

function FieldError({ text }: { text: string }) {
  return <p className="mt-1.5 text-[1rem] font-bold text-err">{text}</p>;
}
