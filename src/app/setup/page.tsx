"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Button, Field, Notice, inputCls } from "@/components/ui/primitives";
import { api } from "@/lib/live/api";

export default function SetupPage() {
  // error: 서버·DB에 닿지 못함 — ‘이미 설정이 끝났습니다’로 보여 계정도 없는 대표를 로그인으로 보내던 문제 (D-77 리허설)
  const [state, setState] = useState<"checking" | "open" | "done" | "error">("checking");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [f, setF] = useState({ companyName: "(주)태강지엘텍", name: "", email: "", phone: "", password: "", confirm: "", setupCode: "", withDemoData: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeRequired, setCodeRequired] = useState(false);

  const check = () => {
    setState("checking");
    void api<{ needsSetup: boolean; codeRequired?: boolean }>("/api/setup").then((r) => {
      if (!r.ok || !r.data) {
        setLoadError(r.error ?? "서버에 연결할 수 없습니다.");
        setState("error");
        return;
      }
      setCodeRequired(!!r.data.codeRequired);
      setState(r.data.needsSetup ? "open" : "done");
    });
  };
  useEffect(check, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (f.password !== f.confirm) {
      setErrors({ confirm: "비밀번호가 서로 다릅니다." });
      return;
    }
    // 회사 전화번호 — 로그인 쪽지·현장 화면·하자 접수 화면에 ‘모르면 본사로 전화’로 나간다. 비어 있으면 빈칸이 찍힌다 (D-77 리허설)
    if (!f.phone.trim()) {
      setErrors({ phone: "회사 전화번호를 넣어 주세요." });
      return;
    }
    setBusy(true);
    setError(null);
    const { phone, ...rest } = f;
    const r = await api("/api/setup", { body: { ...rest, publicPhone: phone } });
    if (!r.ok) {
      setErrors(r.fieldErrors);
      setError(r.error);
      setBusy(false);
      return;
    }
    window.location.assign("/dashboard");
  };

  if (state === "checking") return <AuthFrame title="확인 중…">{null}</AuthFrame>;
  if (state === "error")
    return (
      <AuthFrame title="서버에 연결하지 못했습니다" desc="설정이 끝났는지 아직 알 수 없습니다. 잠시 뒤 다시 시도하세요. 계속되면 배포 담당자에게 알려 주세요.">
        <Notice tone="err" title={loadError ?? "서버 오류"} />
        <Button variant="cta" size="lg" block onClick={check} data-testid="setup-retry">
          다시 시도
        </Button>
      </AuthFrame>
    );
  if (state === "done")
    return (
      <AuthFrame title="이미 설정이 끝났습니다" desc="회사 계정으로 로그인하세요.">
        <Button variant="cta" size="lg" block onClick={() => window.location.assign("/login")}>
          로그인으로
        </Button>
      </AuthFrame>
    );

  return (
    <AuthFrame wide title="회사 설정 (처음 1회)" desc="회사와 대표 계정을 만듭니다. 이후 직원 계정은 ‘운영 관리 → 사용자’에서 추가합니다.">
      <form onSubmit={submit} className="space-y-4" noValidate data-testid="setup-form">
        {error && <Notice tone="err" title={error} />}
        <Field label="회사명" htmlFor="s-co" required error={errors.companyName}>
          <input id="s-co" className={inputCls} value={f.companyName} onChange={set("companyName")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="대표 이름" htmlFor="s-name" required error={errors.name}>
            <input id="s-name" className={inputCls} value={f.name} onChange={set("name")} autoComplete="name" />
          </Field>
          <Field label="이메일 (로그인 아이디)" htmlFor="s-email" required error={errors.email}>
            <input id="s-email" type="email" className={inputCls} value={f.email} onChange={set("email")} autoComplete="username" />
          </Field>
          <Field label="회사 전화번호" htmlFor="s-phone" required error={errors.phone ?? errors.publicPhone} hint="현장 직원·발주처·하자 접수자가 ‘모르면 전화’할 번호 (예: 031-123-4567)">
            <input id="s-phone" type="tel" inputMode="tel" className={inputCls} value={f.phone} onChange={set("phone")} autoComplete="tel" data-testid="setup-phone" />
          </Field>
          <Field label="비밀번호" htmlFor="s-pw" required error={errors.password} hint="8자 이상, 영문·숫자 포함">
            <input id="s-pw" type="password" className={inputCls} value={f.password} onChange={set("password")} autoComplete="new-password" />
          </Field>
          <Field label="비밀번호 확인" htmlFor="s-pw2" required error={errors.confirm}>
            <input id="s-pw2" type="password" className={inputCls} value={f.confirm} onChange={set("confirm")} autoComplete="new-password" />
          </Field>
        </div>
        {codeRequired && (
          <Field label="설정 코드" htmlFor="s-code" required error={errors.setupCode} hint="배포할 때 환경변수 SETUP_CODE로 정한 값">
            <input id="s-code" className={inputCls} value={f.setupCode} onChange={set("setupCode")} autoComplete="off" />
          </Field>
        )}
        <label className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3 text-[0.86rem]">
          <input type="checkbox" checked={f.withDemoData} onChange={set("withDemoData")} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="setup-demo" />
          <span>
            <b>가상 현장 3곳으로 시작 (교육·시험 운영용)</b>
            <span className="block text-[0.76rem] text-ink-3">가상 직원 계정(manager@demo.local 등)이 같은 비밀번호로 만들어집니다. 실제 운영은 빈 상태로 시작하는 것을 권장합니다.</span>
          </span>
        </label>
        <Button type="submit" variant="cta" size="lg" block loading={busy} icon={<Building2 size={18} />} data-testid="setup-submit">
          회사 만들고 시작하기
        </Button>
      </form>
    </AuthFrame>
  );
}
