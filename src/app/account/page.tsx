"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Button, Field, Notice, inputCls } from "@/components/ui/primitives";
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
        <Notice tone="warn" title="처음 로그인 — 비밀번호를 바꿔주세요">
          관리자가 정한 임시 비밀번호로 로그인했습니다. 본인만 아는 비밀번호로 바꾼 뒤 사용할 수 있습니다.
        </Notice>
      )}
      {done && <Notice tone="ok" title="비밀번호를 바꿨습니다. 다른 기기의 로그인은 끊겼습니다." />}
      <form onSubmit={submit} className="mt-3 space-y-4" noValidate data-testid="password-form">
        <Field label="현재 비밀번호" htmlFor="a-cur" required error={errors.current}>
          <input id="a-cur" type="password" autoComplete="current-password" className={inputCls} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label="새 비밀번호" htmlFor="a-new" required error={errors.next} hint="8자 이상, 영문·숫자 포함">
          <input id="a-new" type="password" autoComplete="new-password" className={inputCls} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="새 비밀번호 확인" htmlFor="a-new2" required error={errors.confirm}>
          <input id="a-new2" type="password" autoComplete="new-password" className={inputCls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <Button type="submit" variant="cta" size="lg" block loading={busy} icon={<KeyRound size={18} />} data-testid="password-submit">
          비밀번호 바꾸기
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[0.85rem]">
        {me && !me.mustChangePassword && !force ? (
          <a href={homeFor(me.role)} className="font-semibold text-theme-ink hover:underline">
            ← 업무 화면으로
          </a>
        ) : (
          <span />
        )}
        <button type="button" onClick={() => void logout()} className="inline-flex items-center gap-1.5 font-semibold text-ink-3 hover:text-err">
          <LogOut size={15} /> 로그아웃
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
