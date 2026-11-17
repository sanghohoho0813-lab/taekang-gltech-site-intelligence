"use client";

/**
 * 백업 파일로 시작 (D-86) — 빈 시스템(새 계정·새 DB)에서 ‘전체 자료 백업’ 파일로 회사를 되살린다.
 * 태강지엘텍 명의 계정으로 옮길 때 쓰는 길. 고른 파일을 먼저 미리 보고(회사·백업 날짜·대표 이메일), 확인한 뒤 올린다.
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { ArchiveRestore, FileUp } from "lucide-react";
import { Button, Field, Notice, inputCls } from "@/components/ui/primitives";
import { api } from "@/lib/live/api";
import { peekBackup, restorePayload, type BackupPeek } from "@/lib/browser/backupFiles";
import { fmtDateTime } from "@/lib/domain/format";

interface Summary {
  companyName: string;
  exportedAt: string | null;
  counts: Record<string, number>;
  members: number;
  pendingMembers: number;
  /** 첫 로그인 전 — 현장 직원 / 본사 관리자 / 발주처 */
  pending: { field: number; manager: number; partner: number };
  photos: number;
  kiosks: number;
  integrity: { key: string; level: "ok" | "warn" | "err"; title: string }[];
}

export function RestoreSetup({ codeRequired, onDone }: { codeRequired: boolean; onDone?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; peek: BackupPeek; gz: Uint8Array } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [f, setF] = useState({ email: "", password: "", confirm: "", phone: "", setupCode: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Summary | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const pick = async (picked: File) => {
    setError(null);
    setFile(null);
    setBusy(true);
    try {
      const r = await peekBackup(picked);
      setFile({ name: picked.name, ...r });
      if (r.peek.ceoEmails.length === 1) setF((x) => ({ ...x, email: r.peek.ceoEmails[0] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "백업 파일을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!file) {
      setErrors({ file: "백업 파일을 골라 주세요." });
      return;
    }
    if (f.password !== f.confirm) {
      setErrors({ confirm: "비밀번호가 서로 다릅니다." });
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    // 큰 백업(압축 3MB 넘음)은 조각으로 먼저 올린다 — 서버 요청 한도 4.5MB
    const payload = await restorePayload(file.gz, f.setupCode, (d, t) => setProgress(`백업 파일 보내는 중 ${d}/${t}`));
    setProgress(null);
    if ("error" in payload) {
      setErrors(payload.fieldErrors ?? {});
      setError(payload.error);
      setBusy(false);
      return;
    }
    setProgress("자료를 되살리는 중…");
    const r = await api<{ summary: Summary }>("/api/setup/restore", {
      body: { ...payload, email: f.email, password: f.password, publicPhone: f.phone, setupCode: f.setupCode },
    });
    setProgress(null);
    setBusy(false);
    if (!r.ok || !r.data) {
      setErrors(r.fieldErrors);
      setError(r.error);
      return;
    }
    setDone(r.data.summary);
    onDone?.();
  };

  if (done) {
    const rows = Object.values(done.counts).reduce((a, b) => a + b, 0);
    const err = done.integrity.filter((c) => c.level === "err");
    return (
      <div className="space-y-4" data-testid="restore-done">
        <Notice tone="ok" title={`${done.companyName} 자료를 되살렸습니다`}>
          {done.exportedAt ? `${fmtDateTime(done.exportedAt)} 백업 · ` : ""}자료 {rows.toLocaleString("ko-KR")}건 · 사용자 {done.members}명
        </Notice>
        {err.length > 0 ? (
          <Notice tone="err" title={`숫자 맞추기 점검: 화면끼리 다른 숫자 ${err.length}건`}>
            원래 시스템에서도 같은 결과인지 확인하고, 이 화면을 캡처해 개발 담당에게 보내 주세요.
          </Notice>
        ) : (
          <p className="text-[0.86rem] text-ink-2" data-testid="restore-integrity-ok">
            숫자 맞추기 점검 — 화면끼리 다른 숫자 없음
          </p>
        )}
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-[0.92rem] font-bold">이어서 할 일</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-[0.88rem]">
            {done.pending.field > 0 && (
              <li>
                <b>현장 직원 {done.pending.field}명 로그인 쪽지 인쇄</b> — 비밀번호는 백업에 없어 ‘첫 로그인 전’입니다.{" "}
                <Link href="/launch" className="font-bold text-theme-ink underline">
                  시범 운영 준비
                </Link>
                에서 골라 인쇄하면 임시 비밀번호가 새로 들어갑니다.
              </li>
            )}
            {done.pending.manager + done.pending.partner > 0 && (
              <li>
                <b>
                  {[done.pending.manager ? `본사 관리자 ${done.pending.manager}명` : "", done.pending.partner ? `발주처 ${done.pending.partner}명` : ""].filter(Boolean).join(" · ")} 임시 비밀번호
                </b>{" "}
                —{" "}
                <Link href="/admin?tab=members" className="font-bold text-theme-ink underline">
                  운영 관리 → 사용자
                </Link>
                에서 사람마다 ‘비밀번호 초기화’를 누르면 임시 비밀번호가 나오고, 한꺼번에 로그인 쪽지로 인쇄됩니다.
              </li>
            )}
            {done.photos > 0 && (
              <li>
                <b>사진 {done.photos}장 원본 올리기</b> — 예전 시스템에서 받은 사진 백업(.zip)을 풀지 말고 그대로{" "}
                <Link href="/data#backup" className="font-bold text-theme-ink underline">
                  자료 이관·점검 → 전체 자료 백업
                </Link>
                의 ‘사진 백업 올리기’로 올립니다. 그 전에는 ‘사진 원본 없음’ 그림이 보입니다.
              </li>
            )}
            {done.kiosks > 0 && (
              <li>
                <b>현장 QR 단말기 {done.kiosks}대 다시 연결</b> — 단말기 비밀값은 옮겨지지 않습니다.{" "}
                <Link href="/attendance" className="font-bold text-theme-ink underline">
                  출퇴근
                </Link>
                에서 새로 등록하고 태블릿을 다시 연결하세요.
              </li>
            )}
            <li>대시보드·월 마감 숫자를 예전 시스템과 한 번 비교해 보세요.</li>
          </ol>
          <p className="mt-3 border-t border-line pt-3 text-[0.8rem] text-ink-3">
            옮겨지지 않는 것: 비밀번호·로그인 상태 · QR 단말기 연결 · 휴대폰 알림(직원이 다시 켭니다) · 하자 접수자에게 보낸 ‘진행 확인’ 주소. 이 화면은 다시 볼 수 없으니 필요하면 인쇄해 두세요.
          </p>
        </div>
        <Button variant="cta" size="lg" block onClick={() => window.location.assign("/dashboard")} data-testid="restore-go">
          대시보드로
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate data-testid="restore-form">
      <Notice tone="info" title="새 시스템(태강 명의 계정)으로 옮길 때">
        예전 시스템의 ‘자료 이관·점검 → 전체 자료 백업’에서 받은 파일(taekang_backup_….json.gz)을 넣습니다. 이 시스템이 비어 있을 때만 됩니다 — 이미 쓰고 있는 자료를 덮어쓰지 않습니다.
      </Notice>
      {error && <Notice tone="err" title={error} />}
      <Field label="백업 파일" htmlFor="r-file" required error={errors.file}>
        <input
          ref={fileRef}
          id="r-file"
          type="file"
          accept=".gz,.json,application/gzip,application/json"
          className="sr-only"
          data-testid="restore-file"
          onChange={(e) => {
            const x = e.target.files?.[0];
            e.target.value = "";
            if (x) void pick(x);
          }}
        />
        <Button type="button" icon={<FileUp size={16} />} onClick={() => fileRef.current?.click()} loading={busy && !file} data-testid="restore-pick">
          {file ? "다른 파일 고르기" : "백업 파일 고르기"}
        </Button>
      </Field>
      {file && (
        <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-[0.86rem]" data-testid="restore-peek">
          <p className="font-bold">{file.peek.companyName || "회사"}</p>
          <p className="text-ink-2">
            {file.peek.exportedAt ? `${fmtDateTime(file.peek.exportedAt)} 백업` : "백업 시각 없음"} · 자료 {file.peek.rows.toLocaleString("ko-KR")}건 · 사용자 {file.peek.members}명
          </p>
          <p className="mt-0.5 break-all text-[0.78rem] text-ink-3">{file.name}</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="대표 이메일 (백업 속 로그인 아이디)" htmlFor="r-email" required error={errors.email} hint={file && file.peek.ceoEmails.length > 1 ? `백업 속 대표: ${file.peek.ceoEmails.join(", ")}` : undefined}>
          <input id="r-email" type="email" className={inputCls} value={f.email} onChange={set("email")} autoComplete="username" data-testid="restore-email" />
        </Field>
        <Field label="회사 전화번호 (바꿀 때만)" htmlFor="r-phone" error={errors.publicPhone} hint="비워 두면 백업에 있던 번호 그대로">
          <input id="r-phone" type="tel" inputMode="tel" className={inputCls} value={f.phone} onChange={set("phone")} autoComplete="tel" />
        </Field>
        <Field label="새 비밀번호 (대표)" htmlFor="r-pw" required error={errors.password} hint="8자 이상, 영문·숫자 포함 — 예전 비밀번호는 옮겨지지 않습니다">
          <input id="r-pw" type="password" className={inputCls} value={f.password} onChange={set("password")} autoComplete="new-password" data-testid="restore-password" />
        </Field>
        <Field label="새 비밀번호 확인" htmlFor="r-pw2" required error={errors.confirm}>
          <input id="r-pw2" type="password" className={inputCls} value={f.confirm} onChange={set("confirm")} autoComplete="new-password" data-testid="restore-confirm" />
        </Field>
      </div>
      {codeRequired && (
        <Field label="설정 코드" htmlFor="r-code" required error={errors.setupCode} hint="배포 담당자에게 받은 설정 코드">
          <input id="r-code" className={inputCls} value={f.setupCode} onChange={set("setupCode")} autoComplete="off" />
        </Field>
      )}
      <Button type="submit" variant="cta" size="lg" block loading={busy && !!file} disabled={!file} icon={<ArchiveRestore size={18} />} data-testid="restore-submit">
        백업 파일로 시작하기
      </Button>
      {progress && (
        <p className="text-center text-[0.86rem] font-semibold text-theme-ink" role="status" data-testid="restore-progress">
          {progress}
        </p>
      )}
    </form>
  );
}
