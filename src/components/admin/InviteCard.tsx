"use client";

/**
 * 직원에게 가입 안내 보내기 (D-91) — 운영 관리 → 사용자.
 * 가입 신청 주소를 카카오톡·문자로 보내거나 QR·A4 안내문으로 보여 주면, 직원이 직접 신청하고 승인 담당이 승인한다(D-90).
 * 주소에 붙는 ‘누구용’(?k=)은 신청 화면에서 미리 골라 둘 뿐 — 역할·현장은 승인할 때 정한다(권한이 생기지 않음).
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Copy, MessageSquareText, Printer, QrCode } from "lucide-react";
import { helpPhoneOf } from "@/lib/domain/companyPhone";
import type { DemoDB } from "@/lib/domain/types";
import { INVITE_KINDS, inviteMessage, inviteUrl, type InviteKind } from "@/lib/domain/invite";
import { IS_LIVE } from "@/lib/mode";
import { Button, Card, CardHeader, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { copyText } from "./ShareLinks";
import { QrBox } from "./IntakeLinks";

/** 가입 신청 주소 — 이 운영 주소의 /signup (누구용은 미리 고르기만) */
export const signupUrl = (kind: InviteKind) => inviteUrl(typeof window === "undefined" ? "" : window.location.origin, kind);

export function InviteCard({ db, approver }: { db: DemoDB; approver: boolean }) {
  const [kind, setKind] = useState<InviteKind>("field");
  const [qrOpen, setQrOpen] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const url = signupUrl(kind);
  const phone = helpPhoneOf(db.settings);
  const message = inviteMessage(db.company.name, kind, url, phone);
  const copy = async (text: string, what: string) => {
    const ok = await copyText(text, hostRef.current);
    setStatus(ok ? { ok: true, text: `${what} 복사했습니다. 카카오톡·문자에 붙여 넣으세요.` } : { ok: false, text: "복사하지 못했습니다. 주소를 길게 눌러 직접 복사해 주세요." });
  };
  return (
    <Card data-testid="invite-card">
      <CardHeader
        title="직원에게 가입 안내 보내기"
        sub={
          approver
            ? "주소를 카카오톡·문자로 보내거나 QR·안내문을 보여 주면 직원이 직접 신청합니다. 신청은 아래 ‘가입 신청’에 들어오고, 승인해야만 로그인됩니다."
            : "주소를 보내 주면 직원이 직접 신청합니다. 승인은 가입 승인 담당(대표 권한 또는 지정된 본사 담당)이 합니다."
        }
      />
      <div className="space-y-3 px-5 pb-5 text-[0.88rem]" ref={hostRef}>
        {!IS_LIVE && <p className="rounded-xl bg-surface-2 px-3.5 py-2 text-[0.82rem] text-ink-3">시연판에는 가입 신청 화면이 없습니다 — 실제 운영 주소에서 이 안내를 보냅니다.</p>}
        <div role="radiogroup" aria-label="누구에게 보내나요" className="flex flex-wrap gap-1.5">
          {INVITE_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => (setKind(k.value), setStatus(null))}
              className={cx("press min-h-10 rounded-full border px-3.5 text-[0.84rem] font-bold", kind === k.value ? "border-active bg-active-soft text-theme-ink" : "border-line text-ink-2")}
              data-testid={`invite-kind-${k.value}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="invite-url" className="mb-1.5 block text-[0.82rem] font-bold text-ink-2">
            가입 신청 주소
          </label>
          <div className="flex flex-wrap gap-2">
            <input id="invite-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, "num min-w-0 flex-1 basis-[14rem] text-[0.82rem]")} data-testid="invite-url" />
            <Button icon={status?.ok ? <Check size={17} /> : <Copy size={17} />} onClick={() => void copy(url, "주소를")} data-testid="invite-copy">
              주소 복사
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="cta" icon={<MessageSquareText size={16} />} onClick={() => void copy(message, "보낼 글을")} data-testid="invite-copy-message">
            카톡에 보낼 글 복사
          </Button>
          <Button icon={<QrCode size={16} />} onClick={() => setQrOpen(true)} data-testid="invite-qr">
            QR 크게 보기
          </Button>
          <Link
            href={`/admin/invite?k=${kind}`}
            target="_blank"
            className="press inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-5 text-[0.92rem] font-bold text-ink"
            data-testid="invite-print"
          >
            <Printer size={16} aria-hidden /> 안내문 인쇄 (A4)
          </Link>
        </div>
        {status && (
          <p className={cx("rounded-xl px-3 py-2 font-semibold", status.ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-ink")} role="status" data-testid="invite-status">
            {status.text}
          </p>
        )}
        <details className="rounded-xl border border-line bg-surface-2 px-3.5 py-2">
          <summary className="cursor-pointer text-[0.82rem] font-bold text-ink-2">보낼 글 미리 보기</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[0.82rem] leading-relaxed text-ink-2" data-testid="invite-message">
            {message}
          </pre>
        </details>
        {!phone && <p className="text-[0.8rem] text-ink-3">회사 문의 전화번호를 넣으면 글과 안내문에 함께 들어갑니다 (운영 설정).</p>}
      </div>
      {qrOpen && (
        <Modal open onClose={() => setQrOpen(false)} title={`가입 신청 QR · ${INVITE_KINDS.find((k) => k.value === kind)!.label}`} description="직원이 휴대폰 카메라로 찍으면 가입 신청 화면이 열립니다" size="md" testId="invite-qr-dialog">
          <div className="space-y-3 text-center text-[0.9rem]">
            <QrBox text={url} label="가입 신청 QR" className="mx-auto size-56" />
            <p className="num text-[0.8rem] text-ink-3 [overflow-wrap:anywhere]">{url}</p>
          </div>
        </Modal>
      )}
    </Card>
  );
}
