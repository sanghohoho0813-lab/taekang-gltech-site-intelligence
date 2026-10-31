"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogIn } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Button, Field, Notice, inputCls } from "@/components/ui/primitives";
import { api } from "@/lib/live/api";
import { homeFor } from "@/lib/nav";
import type { RoleId } from "@/lib/domain/types";

function safeNext(v: string | null): string | null {
  // 같은 사이트 안의 경로만 허용 (외부 주소로 보내는 공격 방지)
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : null;
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    void api<{ needsSetup: boolean }>("/api/setup").then((r) => setNeedsSetup(!!r.data?.needsSetup));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await api<{ me: { role: RoleId; mustChangePassword: boolean } }>("/api/auth/login", { body: { email, password } });
    if (!r.ok || !r.data) {
      setError(r.error);
      setBusy(false);
      return;
    }
    const { role, mustChangePassword } = r.data.me;
    window.location.assign(mustChangePassword ? "/account?force=1" : (safeNext(params.get("next")) ?? homeFor(role)));
  };

  return (
    <AuthFrame title="로그인" desc="현장 수익·공정관리 — 회사에서 받은 계정으로 로그인하세요.">
      {needsSetup && (
        <Notice tone="info" title="아직 회사 설정 전입니다">
          처음 사용이라면{" "}
          <Link href="/setup" className="font-bold underline">
            회사 설정
          </Link>
          부터 진행하세요.
        </Notice>
      )}
      <form onSubmit={submit} className="mt-3 space-y-4" noValidate data-testid="login-form">
        <Field label="이메일" htmlFor="l-email">
          <input id="l-email" type="email" autoComplete="username" inputMode="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="비밀번호" htmlFor="l-pw" error={error ?? undefined}>
          <input id="l-pw" type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" variant="cta" size="lg" block loading={busy} icon={<LogIn size={18} />} data-testid="login-submit">
          로그인
        </Button>
        <p className="text-center text-[0.78rem] text-ink-3">비밀번호를 잊었다면 회사 관리자에게 초기화를 요청하세요.</p>
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
