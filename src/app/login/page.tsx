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
import { safeNext } from "@/lib/live/safeNext";
import type { RoleId } from "@/lib/domain/types";


const LAST_ID = "tk-site-intel:last-login";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  // 이 휴대폰에 이미 로그인된 사람 — 로그인 쪽지 QR로 다른 사람이 들어오면 앞 사람을 정리하고 바꾼다 (D-68)
  const [current, setCurrent] = useState<{ id: string; email: string; name: string; role: RoleId; mustChangePassword: boolean } | null>(null);

  useEffect(() => {
    void api<{ needsSetup: boolean }>("/api/setup").then((r) => setNeedsSetup(!!r.data?.needsSetup));
    void api<{ me: { id: string; email: string; name: string; role: RoleId; mustChangePassword: boolean } }>("/api/auth/me").then((r) => setCurrent(r.ok && r.data?.me ? r.data.me : null));
    // 이 휴대폰에서 마지막으로 쓴 아이디를 미리 채워 둔다 (비밀번호는 저장하지 않음)
    // 로그인 쪽지 QR로 들어오면 그 사람 아이디를 채운다 (D-67) — 없으면 이 휴대폰에서 마지막으로 쓴 아이디
    const fromQr = params.get("id")?.trim().toLowerCase();
    if (fromQr && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(fromQr)) {
      setEmail(fromQr);
      return;
    }
    try {
      const last = localStorage.getItem(LAST_ID);
      if (last) setEmail(last);
    } catch {
      // 무시
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // 다른 사람으로 바꿔 로그인: 앞 사람의 이 휴대폰 알림 구독·보관 중인 출퇴근 좌표를 지우고 로그아웃한 뒤 로그인 (로그아웃 버튼과 같은 정리)
    if (current && current.email.toLowerCase() !== email.trim().toLowerCase()) {
      await import("@/lib/browser/outbox").then((m) => m.scrubQueuedLocation(current.id)).catch(() => {});
      await import("@/lib/browser/push").then((m) => m.unsubscribeThisDevice()).catch(() => {});
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      setCurrent(null);
    }
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
      {current && (
        <div className="mt-3 rounded-2xl border-2 border-line bg-surface-2 px-4 py-3.5 text-[1.05rem]" data-testid="login-current">
          <p className="font-bold text-ink">이 휴대폰은 지금 {current.name}님으로 로그인되어 있어요.</p>
          <button
            type="button"
            onClick={() => window.location.assign(current.mustChangePassword ? "/account?force=1" : (safeNext(params.get("next")) ?? homeFor(current.role)))}
            className="press mt-2.5 inline-flex min-h-12 w-full items-center justify-center rounded-full border-2 border-line-strong bg-surface px-4 text-[1.08rem] font-extrabold"
            data-testid="login-continue"
          >
            {current.name}님으로 계속하기
          </button>
          <p className="mt-2 text-[0.98rem] text-ink-2">다른 분이면 아래에 아이디·비밀번호를 넣으세요. 앞 사람은 이 휴대폰에서 로그아웃됩니다.</p>
        </div>
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
            {/* 비밀번호가 틀렸을 때만 — 인터넷·서버 오류에는 엉뚱한 안내가 되지 않게 (D-65) */}
            {/비밀번호가 맞지/.test(error) && <span className="mt-1 block text-[0.98rem] font-semibold text-ink-2">‘보기’를 눌러 비밀번호를 확인해 보세요.</span>}
          </p>
        )}
        <button type="submit" disabled={busy} aria-busy={busy || undefined} className="press inline-flex h-[4rem] w-full items-center justify-center gap-2 rounded-full bg-cta text-[1.3rem] font-extrabold text-cta-text shadow-card disabled:opacity-60" data-testid="login-submit">
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
