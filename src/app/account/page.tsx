"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Notice } from "@/components/ui/primitives";
import { BigLabel, PasswordInput, PasswordRules } from "@/components/auth/BigInputs";
import { api } from "@/lib/live/api";
import { homeFor } from "@/lib/nav";
import { logout } from "@/lib/data/store";
import { ROLE_LABEL } from "@/lib/domain/labels";
import type { RoleId } from "@/lib/domain/types";

interface Me {
  name: string;
  title: string;
  email: string;
  role: RoleId;
  mustChangePassword: boolean;
}

function AccountForm() {
  const force = useSearchParams().get("force") === "1";
  const [me, setMe] = useState<Me | null>(null);
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    void api<{ me: Me }>("/api/auth/me").then((r) => {
      if (r.status === 401) window.location.assign("/login");
      else if (r.data) setMe(r.data.me);
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (f.next !== f.confirm) {
      setErrors({ confirm: "새 비밀번호가 서로 다릅니다." });
      return;
    }
    setBusy(true);
    const r = await api("/api/auth/password", { body: { current: f.current, next: f.next } });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.error?.includes("현재") ? { current: r.error } : { next: r.error ?? "변경 실패" });
      return;
    }
    setErrors({});
    setDone(true);
    setF({ current: "", next: "", confirm: "" });
    if (me && (force || me.mustChangePassword)) window.location.assign(homeFor(me.role));
  };

  return (
    <AuthFrame title="내 계정" desc={me ? `${me.name} ${me.title} · ${ROLE_LABEL[me.role]} · ${me.email}` : "불러오는 중…"}>
      {(force || me?.mustChangePassword) && (
        <Notice tone="warn" title="처음 한 번만 — 비밀번호를 바꿔 주세요">
          받은 임시 비밀번호를 먼저 넣고, 앞으로 쓸 비밀번호를 두 번 넣으세요. 영어 글자와 숫자를 섞어 8자 이상이면 됩니다.
        </Notice>
      )}
      {done && <Notice tone="ok" title="비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다." />}
      <form onSubmit={submit} className="mt-3 space-y-5" noValidate data-testid="password-form">
        <div>
          <BigLabel htmlFor="a-cur">{force || me?.mustChangePassword ? "받은 임시 비밀번호" : "지금 비밀번호"}</BigLabel>
          <PasswordInput id="a-cur" value={f.current} onChange={(v) => setF({ ...f, current: v })} autoComplete="current-password" show={show} onToggle={() => setShow((x) => !x)} />
          {errors.current && <p className="mt-1.5 text-[1.02rem] font-bold text-err">{errors.current}</p>}
        </div>
        <div>
          <BigLabel htmlFor="a-new">새 비밀번호</BigLabel>
          <PasswordInput id="a-new" value={f.next} onChange={(v) => setF({ ...f, next: v })} autoComplete="new-password" show={show} onToggle={() => setShow((x) => !x)} />
          {errors.next && <p className="mt-1.5 text-[1.02rem] font-bold text-err">{errors.next}</p>}
        </div>
        <div>
          <BigLabel htmlFor="a-new2">새 비밀번호 한 번 더</BigLabel>
          <PasswordInput id="a-new2" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" show={show} onToggle={() => setShow((x) => !x)} />
          {errors.confirm && <p className="mt-1.5 text-[1.02rem] font-bold text-err">{errors.confirm}</p>}
        </div>
        <PasswordRules value={f.next} confirm={f.confirm} />
        <button type="submit" disabled={busy} aria-busy={busy || undefined} className="press inline-flex h-[4rem] w-full items-center justify-center gap-2 rounded-full bg-cta text-[1.25rem] font-extrabold text-cta-text shadow-card disabled:opacity-60" data-testid="password-submit">
          <KeyRound size={22} aria-hidden /> 비밀번호 바꾸기
        </button>
      </form>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[1.02rem]">
        {me && !me.mustChangePassword && !force ? (
          <a href={homeFor(me.role)} className="press inline-flex h-12 items-center rounded-xl px-2 font-bold text-theme-ink underline underline-offset-4">
            ← 처음 화면으로
          </a>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => {
            // 한 번에 로그아웃되면 다시 아이디·비밀번호를 넣어야 해서 한 번 더 묻는다 (D-65)
            if (window.confirm("로그아웃할까요? 다음에 다시 아이디·비밀번호를 넣어야 해요.")) void logout();
          }}
          className="press inline-flex h-12 items-center gap-1.5 rounded-xl px-2 font-bold text-ink-2 hover:text-err"
        >
          <LogOut size={18} /> 로그아웃
        </button>
      </div>
    </AuthFrame>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountForm />
    </Suspense>
  );
}
