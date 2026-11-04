"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Notice } from "@/components/ui/primitives";
import { BigLabel, HangulWarning, PasswordInput, bigInputCls } from "@/components/auth/BigInputs";
import { api } from "@/lib/live/api";
import { homeFor } from "@/lib/nav";
import type { RoleId } from "@/lib/domain/types";

function safeNext(v: string | null): string | null {
  // 같은 사이트 안의 경로만 허용 (외부 주소로 보내는 공격 방지)
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : null;
}

const LAST_ID = "tk-site-intel:last-login";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    void api<{ needsSetup: boolean }>("/api/setup").then((r) => setNeedsSetup(!!r.data?.needsSetup));
    // 이 휴대폰에서 마지막으로 쓴 아이디를 미리 채워 둔다 (비밀번호는 저장하지 않음)
    try {
      const last = localStorage.getItem(LAST_ID);
      if (last) setEmail(last);
    } catch {
      // 무시
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError(!email.trim() ? "아이디(이메일)를 넣어 주세요." : "비밀번호를 넣어 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api<{ me: { role: RoleId; mustChangePassword: boolean } }>("/api/auth/login", { body: { email: email.trim(), password } });
    if (!r.ok || !r.data) {
      setError(r.error);
      setBusy(false);
      return;
    }
    try {
      localStorage.setItem(LAST_ID, email.trim().toLowerCase());
    } catch {
      // 무시
    }
    const { role, mustChangePassword } = r.data.me;
    window.location.assign(mustChangePassword ? "/account?force=1" : (safeNext(params.get("next")) ?? homeFor(role)));
  };

  return (
    <AuthFrame title="로그인" desc="회사에서 받은 아이디와 비밀번호를 넣으세요.">
      {needsSetup && (
        <Notice tone="info" title="아직 회사 설정 전입니다">
          처음 사용이라면{" "}
          <Link href="/setup" className="font-bold underline">
            회사 설정
          </Link>
          부터 진행하세요.
        </Notice>
      )}
      <form onSubmit={submit} className="mt-3 space-y-5" noValidate data-testid="login-form">
        <div>
          <BigLabel htmlFor="l-email">아이디 (이메일)</BigLabel>
          <input id="l-email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={bigInputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
          <HangulWarning value={email} />
        </div>
        <div>
          <BigLabel htmlFor="l-pw">비밀번호</BigLabel>
          <PasswordInput id="l-pw" value={password} onChange={setPassword} autoComplete="current-password" show={show} onToggle={() => setShow((v) => !v)} />
        </div>
        {error && (
          <p className="rounded-2xl bg-err-bg px-4 py-3 text-[1.08rem] font-bold leading-relaxed text-err" role="alert" data-testid="login-error">
            {error}
            <span className="mt-1 block text-[0.98rem] font-semibold text-ink-2">‘보기’를 눌러 비밀번호를 확인해 보세요.</span>
          </p>
        )}
        <button type="submit" disabled={busy} aria-busy={busy || undefined} className="press inline-flex h-[4rem] w-full items-center justify-center gap-2 rounded-2xl bg-cta text-[1.3rem] font-extrabold text-cta-text disabled:opacity-60" data-testid="login-submit">
          {busy ? <Loader2 size={22} className="animate-spin" aria-hidden /> : <LogIn size={22} aria-hidden />}
          로그인
        </button>
        <p className="text-center text-[1rem] leading-relaxed text-ink-2">
          한 번 로그인하면 쓰는 동안 이 휴대폰에서 계속 유지돼요.
          <br />
          비밀번호를 잊었다면 회사 관리자에게 초기화를 요청하세요.
        </p>
      </form>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
