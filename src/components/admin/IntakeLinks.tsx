"use client";

/**
 * 하자 접수 링크 (D-74) — 본사 화면.
 * - IntakeCard: 현장 상세 ‘하자 접수 링크’ (만들기 · QR·주소 다시 보기 · 안내문 인쇄 · 닫기 · 접수 건수)
 * - IntakeContact: 요청 목록에서 링크로 들어온 접수의 접수자(이름·소속·전화) — 본사만 본다. 진행 확인 주소 다시 만들기.
 * 접수 주소는 접수만 되는 주소라 다시 볼 수 있다 (QR을 다시 인쇄해야 하므로).
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Copy, Phone, Printer, QrCode, RefreshCw } from "lucide-react";
import { run } from "@/lib/data/store";
import { userLabel } from "@/lib/data/hooks";
import { errorMessage } from "@/lib/data/commands";
import { fmtDate, fmtDateTime } from "@/lib/domain/format";
import { INTAKE_CONTACT_KEEP_DAYS, INTAKE_MAX_OPEN_PER_SITE, intakeContactLabel, intakeReplyMessage, intakeState, intakesOf } from "@/lib/domain/intake";
import type { DefectIntake, DemoDB, PartnerRequest } from "@/lib/domain/types";
import { IS_LIVE } from "@/lib/mode";
import { qrPath } from "@/lib/geo/qrClient";
import { Badge, Button, Card, CardHeader, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "./ShareLinks";

export const intakeUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/r/${token}`;

export function QrBox({ text, label, className }: { text: string; label: string; className?: string }) {
  const qr = qrPath(text);
  return (
    <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} className={cx("block", className)} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

/** 현장 상세 — 이 현장의 하자 접수 링크 */
export function IntakeCard({ db, siteId }: { db: DemoDB; siteId: string }) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<DefectIntake | null>(null);
  const list = intakesOf(db, siteId);
  const openCount = list.filter((i) => intakeState(i) === "open").length;
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await run("createIntake", { siteId, ...(label.trim() ? { label: label.trim() } : {}) });
      setLabel("");
      // 만든 링크의 QR·주소를 바로 보여 준다 (명령 결과의 주소로 — 화면 데이터가 갱신되기 전에도)
      setShow({ id: r.intakeId, token: r.token, siteId, label: label.trim() || "하자 접수", createdAt: new Date().toISOString(), createdBy: "", count: 0 });
    } catch (e) {
      setErr(errorMessage(e, "접수 링크를 만들지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  const close = async (i: DefectIntake) => {
    if (!window.confirm(`‘${i.label}’ 접수 링크를 닫을까요?\n닫으면 이 주소·QR로는 더 접수되지 않습니다 (붙여 둔 안내문도 쓸 수 없게 됩니다). 이미 들어온 접수는 그대로 처리합니다.`)) return;
    try {
      await run("closeIntake", { intakeId: i.id });
      toast.push({ tone: "ok", title: "접수 링크를 닫았습니다" });
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "닫지 못했습니다.") });
    }
  };
  return (
    <Card data-testid="intake-card">
      <CardHeader
        title="하자 접수 링크"
        sub="계정이 없는 발주처·관리사무소가 QR·주소로 하자를 접수합니다 (위치·내용·사진·연락처) · 접수되면 ‘하자보수’와 요청함에 들어오고 알림이 옵니다"
        right={openCount >= INTAKE_MAX_OPEN_PER_SITE ? <Badge tone="warn">열린 링크 {INTAKE_MAX_OPEN_PER_SITE}개 (최대)</Badge> : undefined}
      />
      <div className="space-y-3 px-5 pb-5">
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-4 text-[0.86rem] text-ink-2" data-testid="intake-empty">
            아직 접수 링크가 없습니다. 아래에서 만들면 QR이 나옵니다. 준공할 때 안내문을 인쇄해 관리사무소에 전하거나, 주소를 문자로 보내 두세요.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line" data-testid="intake-list">
            {list.map((i) => {
              const open = intakeState(i) === "open";
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" data-testid="intake-row" data-state={open ? "open" : "closed"}>
                  <div className="min-w-0 flex-1 basis-[13rem]">
                    <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-bold">
                      <span className="[overflow-wrap:anywhere]">{i.label}</span>
                      <Badge tone={open ? "ok" : "neutral"}>{open ? "접수 받는 중" : "닫음"}</Badge>
                    </p>
                    <p className="num mt-0.5 text-[0.78rem] text-ink-2">
                      만든 날 {fmtDate(i.createdAt)} · {userLabel(db, i.createdBy)}
                      {i.closedAt ? ` · 닫은 날 ${fmtDate(i.closedAt)}` : ""}
                    </p>
                  </div>
                  <p className={cx("num text-[0.84rem]", i.count ? "font-bold text-theme-ink" : "text-ink-3")} data-testid="intake-count">
                    {i.count ? `접수 ${i.count}건` : "접수 없음"}
                    {i.lastAt && <span className="font-normal text-ink-3"> · 마지막 {fmtDateTime(i.lastAt).slice(5)}</span>}
                  </p>
                  {open && (
                    <span className="flex flex-wrap gap-2">
                      <Button size="sm" variant="soft" icon={<QrCode size={15} />} onClick={() => setShow(i)} data-testid="intake-show">
                        QR·주소
                      </Button>
                      <Button size="sm" onClick={() => close(i)} data-testid="intake-close">
                        닫기
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {openCount < INTAKE_MAX_OPEN_PER_SITE && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <span className="block min-w-0 flex-1 basis-[12rem]">
              <label htmlFor="intake-label" className="mb-1 block text-[0.8rem] font-bold text-ink-2">
                새 접수 링크 이름 <span className="font-normal text-ink-3">(어디에 둘 것인지 · 선택)</span>
              </label>
              <input id="intake-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} placeholder="예: 관리사무소용" className={cx(inputCls, "text-[0.88rem]")} data-testid="intake-label" />
            </span>
            <Button type="submit" variant="cta" icon={<QrCode size={17} />} loading={busy} data-testid="intake-create">
              접수 링크 만들기
            </Button>
          </form>
        )}
        {err && (
          <p role="alert" className="rounded-xl bg-err-bg px-3.5 py-2 text-[0.84rem] font-semibold text-err" data-testid="intake-error">
            {err}
          </p>
        )}
        <p className="text-[0.76rem] text-ink-3">
          이 주소로는 접수만 됩니다 (다른 정보는 보이지 않음). 접수자 이름·연락처는 본사만 보고, 처리 끝난 뒤 {INTAKE_CONTACT_KEEP_DAYS}일이 지나면 지웁니다. 무상·유상 여부는 화면이 정하지 않습니다 (계약서 기준).
          {!IS_LIVE && " 시연판에서는 이 브라우저에서만 접수됩니다."}
        </p>
      </div>
      {show && <IntakeShowModal intake={show} siteId={siteId} onClose={() => setShow(null)} />}
    </Card>
  );
}

function IntakeShowModal({ intake, siteId, onClose }: { intake: DefectIntake; siteId: string; onClose: () => void }) {
  const url = intakeUrl(intake.token);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const copy = async () => {
    const ok = await copyText(url, bodyRef.current?.closest("dialog") ?? bodyRef.current);
    setStatus(ok ? { ok: true, text: "주소를 복사했습니다. 문자·카카오톡에 붙여 넣으세요." } : { ok: false, text: "복사하지 못했습니다. 주소를 길게 눌러 직접 복사해 주세요." });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`하자 접수 QR · ${intake.label}`}
      description="휴대폰 카메라로 찍으면 접수 화면이 열립니다"
      size="md"
      testId="intake-dialog"
      footer={
        <>
          <Link
            href={`/sites/${siteId}/intake?link=${intake.id}`}
            target="_blank"
            className="press inline-flex h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[0.9rem] font-semibold text-ink hover:bg-surface-2"
            data-testid="intake-print-link"
          >
            <Printer size={16} aria-hidden /> 안내문 인쇄
          </Link>
          <Button variant="cta" onClick={onClose} data-testid="intake-dialog-done">
            닫기
          </Button>
        </>
      }
    >
      <div className="space-y-3.5 text-[0.9rem]" ref={bodyRef}>
        <QrBox text={url} label="하자 접수 QR" className="mx-auto size-52" />
        <div>
          <label htmlFor="intake-url" className="mb-1.5 block text-[0.82rem] font-bold text-ink-2">
            접수 주소
          </label>
          <div className="flex flex-wrap gap-2">
            <input id="intake-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, "num min-w-0 flex-1 basis-[12rem] text-[0.82rem]")} data-testid="intake-url" />
            <Button icon={status?.ok ? <Check size={17} /> : <Copy size={17} />} onClick={copy} data-testid="intake-copy">
              주소 복사
            </Button>
          </div>
        </div>
        <p role="status" aria-live="polite" className={cx("min-h-[1.3rem] text-[0.84rem] font-semibold", status ? (status.ok ? "text-ok" : "text-err") : "text-ink-3")} data-testid="intake-copy-status">
          {status?.text ?? "이 주소·QR은 언제든 이 화면에서 다시 볼 수 있습니다."}
        </p>
        <p className="text-[0.8rem] text-ink-2">관리사무소·발주처 담당에게 문자로 보내거나, ‘안내문 인쇄’로 A4 한 장을 뽑아 전하세요.</p>
      </div>
    </Modal>
  );
}

/**
 * 요청 목록의 ‘링크 접수’ 표시 — 접수자 이름·소속·전화 (본사만) · 접수 번호 · 진행 확인 주소 다시 만들기.
 * 계정이 없는 접수라 회신해도 알림이 가지 않는다 — 접수자에게 전화·문자로 알리도록 안내한다.
 */
export function IntakeContact({ db, req }: { db: DemoDB; req: PartnerRequest }) {
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; no: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const c = req.intake;
  if (!c) return null;
  const renew = async () => {
    if (!window.confirm("진행 확인 주소를 새로 만들까요?\n접수자가 가진 앞의 주소는 더 열리지 않습니다. 새 주소를 문자로 보내 주세요.")) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await run("renewIntakeStatus", { requestId: req.id });
      setMade({ url: `${window.location.origin}/r/s/${r.statusToken}`, no: r.no });
    } catch (e) {
      setErr(errorMessage(e, "만들지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-[0.8rem]" data-testid="request-intake">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="info">링크 접수</Badge>
        <span className="num font-semibold">접수 번호 {c.no}</span>
        <b className="[overflow-wrap:anywhere]" data-testid="request-intake-who">{intakeContactLabel(req)}</b>
        {c.phone ? (
          <a href={`tel:${c.phone.replace(/[^\d]/g, "")}`} className="num inline-flex min-h-9 items-center gap-1 font-bold text-theme-ink underline underline-offset-2" data-testid="request-intake-phone">
            <Phone size={14} aria-hidden /> {c.phone}
          </a>
        ) : (
          <span className="text-ink-3">연락처는 보관 기간이 지나 지웠습니다</span>
        )}
      </p>
      <p className="mt-1 text-[0.76rem] text-ink-3">
        계정이 없는 접수입니다 — 회신하면 접수자의 ‘진행 확인’ 화면에 보이지만 알림은 가지 않습니다. 전화나 문자로 알려 주세요.
        {db.intakes?.find((i) => i.id === c.id) ? ` (${db.intakes.find((i) => i.id === c.id)!.label})` : ""}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<RefreshCw size={14} />} onClick={renew} loading={busy} data-testid="request-intake-renew">
          진행 확인 주소 다시 만들기
        </Button>
        {err && <span className="font-semibold text-err">{err}</span>}
      </div>
      {made && <RenewedBox company={db.company.name} url={made.url} no={made.no} />}
    </div>
  );
}

function RenewedBox({ company, url, no }: { company: string; url: string; no: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const message = intakeReplyMessage({ company, no, url });
  const copy = async () => {
    const ok = await copyText(message, ref.current);
    setStatus(ok ? "보낼 글을 복사했습니다. 문자에 붙여 넣으세요." : "복사하지 못했습니다. 글을 길게 눌러 직접 복사해 주세요.");
  };
  return (
    <div ref={ref} className="mt-2 rounded-lg border border-active bg-surface px-2.5 py-2" data-testid="request-intake-renewed">
      <p className="text-[0.78rem] font-bold text-ink-2">새 진행 확인 주소 (지금만 보입니다 — 접수자에게 문자로 보내 주세요)</p>
      <textarea readOnly rows={4} value={message} className={cx(inputCls, "mt-1 h-auto resize-none py-1.5 text-[0.8rem] leading-relaxed [overflow-wrap:anywhere]")} data-testid="request-intake-message" />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="cta" icon={<Copy size={14} />} onClick={copy} data-testid="request-intake-copy">
          보낼 글 복사
        </Button>
        {status && <span role="status" className="text-[0.78rem] font-semibold text-ink-2">{status}</span>}
      </div>
    </div>
  );
}
