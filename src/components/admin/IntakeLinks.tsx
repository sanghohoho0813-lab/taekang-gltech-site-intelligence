"use client";

/**
 * 하자 접수 링크 (D-74) — 본사 화면.
 * - IntakeCard: 현장 상세 ‘하자 접수 링크’ (만들기 · QR·주소 다시 보기 · 안내문 인쇄 · 닫기·다시 열기 · 접수 건수 · 접수 화면에 보일 회사 전화번호)
 * - IntakeContact: 요청 목록에서 링크·전화로 들어온 접수의 접수자(이름·소속·전화)와 ‘접수자에게 알리기’(진행 확인 주소·보낼 글·문자) — 본사만 본다.
 *   계정이 없는 접수라 회신해도 알림이 가지 않는다. 그래서 본사가 지금 주소를 언제든 다시 보고 문자로 보낼 수 있게 했다 (점검 10차).
 * - PhoneDefectModal: 전화로 받은 하자 등록 · DiscardIntakeModal: 장난·중복 접수 버리기
 * 접수 주소는 접수만 되는 주소라 다시 볼 수 있다 (QR을 다시 인쇄해야 하므로).
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { Check, Copy, ExternalLink, MessageSquareText, Phone, PhoneIncoming, Printer, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { run } from "@/lib/data/store";
import { userLabel } from "@/lib/data/hooks";
import { errorMessage } from "@/lib/data/commands";
import { DISCARD_REASONS, type DiscardReason } from "@/lib/data/intakeCommands";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/domain/format";
import { INTAKE_CONTACT_KEEP_DAYS, INTAKE_DAILY_LIMIT, INTAKE_MAX_OPEN_PER_SITE, intakeCanConfirm, intakeContactLabel, intakeFullToday, intakeState, intakeVia, intakesOf, telHref } from "@/lib/domain/intake";
import type { DefectIntake, DemoDB, PartnerRequest } from "@/lib/domain/types";
import { uid } from "@/lib/domain/ids";
import { IS_LIVE } from "@/lib/mode";
import { qrPath } from "@/lib/geo/qrClient";
import { Badge, Button, Card, CardHeader, Field, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "./ShareLinks";

export const intakeUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/r/${token}`;
export const statusUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/r/s/${token}`;
/** 접수 화면·안내문에 보일 건물 이름 — 링크에 따로 적었으면 그 이름, 아니면 현장 이름 */
export const intakePlace = (db: DemoDB, i: Pick<DefectIntake, "place" | "siteId">) => i.place || db.sites.find((s) => s.id === i.siteId)?.name || "";

export function QrBox({ text, label, className }: { text: string; label: string; className?: string }) {
  const qr = qrPath(text);
  return (
    <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} className={cx("block", className)} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={qr.size + 4} height={qr.size + 4} fill="#fff" />
      <path d={qr.d} fill="#000" />
    </svg>
  );
}

/** 접수 화면·안내문에 보일 회사 전화번호 — 없으면 접수하는 사람이 전화할 곳을 알 수 없다. 여기서 바로 넣고 바꾼다 */
export function PublicPhoneRow({ db }: { db: DemoDB }) {
  const toast = useToast();
  const cur = db.settings?.publicPhone ?? "";
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(cur);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await run("setCompanySettings", { publicPhone: value.trim() });
      setEdit(false);
      toast.push({ tone: "ok", title: value.trim() ? "접수 화면에 전화번호가 표시됩니다" : "전화번호를 지웠습니다" });
    } catch (e) {
      setErr(errorMessage(e, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  if (!edit)
    return (
      <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-3.5 py-2.5 text-[0.86rem]", cur ? "bg-surface-2" : "border border-warn/40 bg-warn-bg/50")} data-testid="intake-phone-row">
        {cur ? (
          <p className="min-w-0 flex-1 basis-[14rem]">
            접수 화면·안내문에 보일 전화번호 <b className="num whitespace-nowrap text-ink" data-testid="intake-phone-value">{cur}</b>
          </p>
        ) : (
          <p className="min-w-0 flex-1 basis-[14rem] font-semibold text-ink">
            접수 화면에 보일 회사 전화번호가 없습니다. <span className="font-normal text-ink-2">접수하는 분이 급할 때 전화할 곳을 알 수 없습니다.</span>
          </p>
        )}
        <Button
          size="sm"
          variant={cur ? "ghost" : "cta"}
          onClick={() => {
            setValue(cur);
            setEdit(true);
          }}
          data-testid="intake-phone-edit"
        >
          {cur ? "바꾸기" : "전화번호 넣기"}
        </Button>
      </div>
    );
  return (
    <form
      className="rounded-xl bg-surface-2 px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="intake-phone-form"
    >
      <label htmlFor="intake-phone" className="mb-1 block text-[0.8rem] font-bold text-ink-2">
        접수 화면·안내문에 보일 회사 전화번호 <span className="font-normal text-ink-3">(모든 현장 공통 · 비우면 지움)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <input id="intake-phone" type="tel" inputMode="tel" value={value} onChange={(e) => setValue(e.target.value)} maxLength={20} placeholder="예: 031-123-4567" className={cx(inputCls, "num min-w-0 flex-1 basis-[10rem] text-[0.9rem]")} autoFocus data-testid="intake-phone-input" />
        <Button type="submit" variant="cta" loading={busy} data-testid="intake-phone-save">
          저장
        </Button>
        <Button type="button" onClick={() => setEdit(false)}>
          취소
        </Button>
      </div>
      {err && (
        <p role="alert" className="mt-1.5 text-[0.82rem] font-semibold text-err">
          {err}
        </p>
      )}
    </form>
  );
}

/** 현장 상세 — 이 현장의 하자 접수 링크 */
export function IntakeCard({ db, siteId }: { db: DemoDB; siteId: string }) {
  const toast = useToast();
  const list = intakesOf(db, siteId);
  const opened = list.filter((i) => intakeState(i) === "open");
  const closed = list.filter((i) => intakeState(i) !== "open");
  // 처음 만드는 링크는 보통 관리사무소에 준다 — 이름을 미리 넣어 둔다 (같은 이름이 열려 있으면 비워 둔다)
  const [label, setLabel] = useState(() => (opened.some((i) => i.label.replace(/\s+/g, "") === "관리사무소용") ? "" : "관리사무소용"));
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<DefectIntake | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const site = db.sites.find((s) => s.id === siteId);
  const now = new Date().toISOString();
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const l = label.trim();
      const p = place.trim();
      const r = await run("createIntake", { siteId, ...(l ? { label: l } : {}), ...(p ? { place: p } : {}) });
      setLabel("");
      setPlace("");
      // 만든 링크의 QR·주소를 바로 보여 준다 (명령 결과의 주소로 — 화면 데이터가 갱신되기 전에도)
      setShow({ id: r.intakeId, token: r.token, siteId, label: l || "하자 접수", ...(p ? { place: p } : {}), createdAt: now, createdBy: "", count: 0 });
    } catch (e) {
      setErr(errorMessage(e, "접수 링크를 만들지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  const close = async (i: DefectIntake) => {
    if (!window.confirm(`‘${i.label}’ 접수 링크를 닫을까요?\n닫으면 이 주소·QR로는 더 접수되지 않습니다 (붙여 둔 안내문도 쓸 수 없게 됩니다). 이미 들어온 접수는 그대로 처리합니다. 잘못 닫았으면 ‘다시 열기’로 되돌릴 수 있습니다.`)) return;
    try {
      await run("closeIntake", { intakeId: i.id });
      toast.push({ tone: "ok", title: "접수 링크를 닫았습니다", desc: "‘닫은 링크’에서 다시 열 수 있습니다." });
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "닫지 못했습니다.") });
    }
  };
  const reopen = async (i: DefectIntake) => {
    try {
      await run("reopenIntakeLink", { intakeId: i.id });
      toast.push({ tone: "ok", title: "접수 링크를 다시 열었습니다", desc: "같은 주소·QR로 다시 접수됩니다." });
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "다시 열지 못했습니다.") });
    }
  };
  const row = (i: DefectIntake) => {
    const open = intakeState(i) === "open";
    const full = open && intakeFullToday(db, i.id, now);
    return (
      <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5" data-testid="intake-row" data-state={open ? "open" : "closed"}>
        <div className="min-w-0 flex-1 basis-[13rem]">
          <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-bold">
            <span className="[overflow-wrap:anywhere]">{i.label}</span>
            <Badge tone={full ? "warn" : open ? "ok" : "neutral"}>{full ? `오늘 한도(${INTAKE_DAILY_LIMIT}건) 참 — 전화 안내 중` : open ? "접수 받는 중" : "닫음"}</Badge>
          </p>
          <p className="num mt-0.5 text-[0.78rem] text-ink-2">
            {i.place ? `건물 이름 ‘${i.place}’ · ` : ""}만든 날 {fmtDate(i.createdAt)} · {userLabel(db, i.createdBy)}
            {i.closedAt ? ` · 닫은 날 ${fmtDate(i.closedAt)}` : ""}
          </p>
        </div>
        <p className={cx("num text-[0.84rem]", i.count ? "font-bold text-theme-ink" : "text-ink-3")} data-testid="intake-count">
          {i.count ? `접수 ${i.count}건` : "접수 없음"}
          {!!i.voided && <span className="font-normal text-ink-3"> · 버림 {i.voided}</span>}
          {i.lastAt && <span className="font-normal text-ink-3"> · 마지막 {fmtDateTime(i.lastAt).slice(5)}</span>}
        </p>
        {open ? (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="soft" icon={<QrCode size={15} />} onClick={() => setShow(i)} data-testid="intake-show">
              QR·주소
            </Button>
            <Button size="sm" variant="ghost" onClick={() => close(i)} data-testid="intake-close">
              링크 닫기
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => reopen(i)} data-testid="intake-reopen">
            다시 열기
          </Button>
        )}
      </li>
    );
  };
  return (
    <Card id="intake" data-testid="intake-card">
      <CardHeader
        title="하자 접수 링크"
        sub="계정이 없는 관리사무소·발주처 담당이 QR·주소로 하자를 접수합니다 (위치·내용·사진·연락처) · 접수되면 ‘하자보수’에 들어오고 알림이 옵니다"
        right={
          <Button size="sm" icon={<PhoneIncoming size={15} />} onClick={() => setPhoneOpen(true)} data-testid="intake-phone-register">
            전화 받은 하자 등록
          </Button>
        }
      />
      <div className="space-y-3 px-5 pb-5">
        <PublicPhoneRow db={db} />
        {list.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-4 text-[0.86rem] text-ink-2" data-testid="intake-empty">
            아직 접수 링크가 없습니다. 아래에서 만들면 QR이 나옵니다. 준공할 때 안내문을 인쇄해 관리사무소에 전하거나, 주소를 문자로 보내 두세요.
          </p>
        ) : (
          <>
            {opened.length > 0 && (
              <ul className="divide-y divide-line border-y border-line" data-testid="intake-list">
                {opened.map(row)}
              </ul>
            )}
            {closed.length > 0 && (
              <details className="rounded-xl border border-line px-3.5" data-testid="intake-closed" open={opened.length === 0}>
                <summary className="flex min-h-11 cursor-pointer items-center text-[0.84rem] font-semibold text-ink-2">닫은 링크 {closed.length}개 보기</summary>
                <ul className="divide-y divide-line border-t border-line">{closed.map(row)}</ul>
              </details>
            )}
          </>
        )}
        {opened.length < INTAKE_MAX_OPEN_PER_SITE ? (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <span className="block min-w-0">
              <label htmlFor="intake-label" className="mb-1 block text-[0.8rem] font-bold text-ink-2">
                새 링크 이름 <span className="font-normal text-ink-3">(어디에 둘 것인지)</span>
              </label>
              <input id="intake-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} placeholder="예: 관리사무소용" className={cx(inputCls, "text-[0.88rem]")} data-testid="intake-label" />
            </span>
            <span className="block min-w-0">
              <label htmlFor="intake-place" className="mb-1 block text-[0.8rem] font-bold text-ink-2">
                접수 화면에 보일 건물 이름 <span className="font-normal text-ink-3">(선택)</span>
              </label>
              <input id="intake-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={40} placeholder={site ? `비우면 ‘${site.name.slice(0, 16)}${site.name.length > 16 ? "…" : ""}’` : ""} className={cx(inputCls, "text-[0.88rem]")} data-testid="intake-place" />
            </span>
            <Button type="submit" variant="cta" icon={<QrCode size={17} />} loading={busy} data-testid="intake-create">
              접수 링크 만들기
            </Button>
          </form>
        ) : (
          <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[0.84rem] text-ink-2" data-testid="intake-max">
            열린 링크가 {INTAKE_MAX_OPEN_PER_SITE}개(최대)입니다. 새로 만들려면 안 쓰는 링크를 닫으세요.
          </p>
        )}
        {err && (
          <p role="alert" className="rounded-xl bg-err-bg px-3.5 py-2 text-[0.84rem] font-semibold text-err" data-testid="intake-error">
            {err}
          </p>
        )}
        <p className="text-[0.76rem] leading-relaxed text-ink-3">
          접수 주소로는 접수만 됩니다 (다른 정보는 보이지 않음). 접수자 이름·연락처는 본사와, 작업지시에서 ‘연락처 보여 주기’를 고른 경우 그 보수 담당자만 봅니다. 처리가 끝나면 {INTAKE_CONTACT_KEEP_DAYS}일 뒤 지웁니다. 무상·유상 여부는 화면이 정하지 않습니다 (계약서 기준).
          {!IS_LIVE && " 시연판에서는 이 브라우저에서만 접수됩니다."}
        </p>
      </div>
      {show && <IntakeShowModal db={db} intake={show} siteId={siteId} onClose={() => setShow(null)} />}
      {phoneOpen && <PhoneDefectModal db={db} siteId={siteId} onClose={() => setPhoneOpen(false)} />}
    </Card>
  );
}

function IntakeShowModal({ db, intake, siteId, onClose }: { db: DemoDB; intake: DefectIntake; siteId: string; onClose: () => void }) {
  const url = intakeUrl(intake.token);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const message = `[${db.company.name}] ${intakePlace(db, intake)} 하자는 아래 주소에서 사진과 함께 접수해 주세요.\n${url}`;
  const copy = async (text: string, what: string) => {
    const ok = await copyText(text, bodyRef.current?.closest("dialog") ?? bodyRef.current);
    setStatus(ok ? { ok: true, text: `${what} 복사했습니다. 문자·카카오톡에 붙여 넣으세요.` } : { ok: false, text: "복사하지 못했습니다. 주소를 길게 눌러 직접 복사해 주세요." });
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
          <Button onClick={onClose} data-testid="intake-dialog-done">
            닫기
          </Button>
          <Link
            href={`/sites/${siteId}/intake?link=${intake.id}`}
            target="_blank"
            className="press inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-[0.92rem] font-bold text-cta-text shadow-card"
            data-testid="intake-print-link"
          >
            <Printer size={16} aria-hidden /> 안내문 인쇄
          </Link>
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
            <Button icon={status?.ok ? <Check size={17} /> : <Copy size={17} />} onClick={() => copy(url, "주소를")} data-testid="intake-copy">
              주소 복사
            </Button>
          </div>
          <Button className="mt-2" icon={<MessageSquareText size={16} />} onClick={() => copy(message, "보낼 글을")} data-testid="intake-copy-message">
            보낼 글 복사 (안내 문구 + 주소)
          </Button>
        </div>
        <p role="status" aria-live="polite" className={cx("min-h-[1.3rem] text-[0.84rem] font-semibold", status ? (status.ok ? "text-ok" : "text-err") : "text-ink-3")} data-testid="intake-copy-status">
          {status?.text ?? "이 주소·QR은 언제든 이 화면에서 다시 볼 수 있습니다."}
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-[0.8rem] leading-relaxed text-ink-2">
          <li>이 주소로는 접수만 됩니다. 회사 자료는 아무것도 보이지 않습니다.</li>
          <li>누구나 접수할 수 있는 주소입니다. 안내문은 관리사무소 안쪽처럼 관계자가 보는 곳에 붙여 주세요.</li>
        </ul>
      </div>
    </Modal>
  );
}

/** 접수자에게 보낼 글 — 지금 단계에 맞게 (금액 없음) */
function notifyMessage(db: DemoDB, req: PartnerRequest, url: string): string {
  const c = req.intake!;
  const done = intakeCanConfirm(req, db.workOrders ?? []);
  if (req.confirmedAt) return `[${db.company.name}] 하자 접수(접수 번호 ${c.no}) 진행은 아래 주소에서 보실 수 있습니다.\n${url}`;
  if (done && req.closedWithoutRepair) return `[${db.company.name}] 접수하신 하자(접수 번호 ${c.no})에 답변드렸습니다. 아래 주소에서 내용을 보시고 확인해 주세요.\n${url}`;
  if (done) return `[${db.company.name}] 접수하신 하자(접수 번호 ${c.no}) 보수를 마쳤습니다. 아래 주소에서 사진을 보시고 ‘잘 고쳐졌습니다’를 눌러 주세요.\n${url}`;
  if (req.status === "answered") return `[${db.company.name}] 접수하신 하자(접수 번호 ${c.no})에 답변드렸습니다. 아래 주소에서 보실 수 있습니다.\n${url}`;
  return `[${db.company.name}] 하자 접수(접수 번호 ${c.no}) 진행은 아래 주소에서 보실 수 있습니다.\n${url}`;
}

/**
 * 접수자에게 알리기 — 보낼 글(진행 확인 주소 포함)·복사·문자 앱 (회신 창의 다음 단계 · 점검 11차).
 * 진행 확인 주소가 없으면(옛 자료) ‘자세히·이력’에서 만들라고 안내한다.
 */
export function IntakeNotifyBox({ db, req }: { db: DemoDB; req: PartnerRequest }) {
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const c = req.intake;
  if (!c) return null;
  const url = req.statusToken ? statusUrl(req.statusToken) : "";
  if (!url) return <p className="text-[0.82rem] text-ink-2">진행 확인 주소가 아직 없습니다. 하자보수의 ‘자세히·이력’에서 주소를 만들어 보내 주세요.</p>;
  const message = notifyMessage(db, req, url);
  const copy = async () => {
    const ok = await copyText(message, ref.current);
    setStatus(ok ? "보낼 글을 복사했습니다. 문자·카카오톡에 붙여 넣으세요." : "복사하지 못했습니다. 글을 길게 눌러 직접 복사해 주세요.");
  };
  return (
    <div ref={ref} className="space-y-1.5" data-testid="intake-notify-box">
      <label htmlFor={`nmsg-${req.id}`} className="text-[0.8rem] font-bold text-ink-2">
        접수자에게 보낼 글 (진행 확인 주소 포함)
      </label>
      <textarea id={`nmsg-${req.id}`} readOnly rows={5} value={message} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, "h-auto resize-none py-1.5 text-[0.82rem] leading-relaxed [overflow-wrap:anywhere]")} data-testid="intake-notify-message" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="cta" icon={<Copy size={14} />} onClick={copy} data-testid="intake-notify-copy">
          보낼 글 복사
        </Button>
        {c.phone && (
          <a href={`sms:${c.phone.replace(/[^\d]/g, "")}?&body=${encodeURIComponent(message)}`} className="press inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-[0.8rem] font-bold" data-testid="intake-notify-sms">
            <MessageSquareText size={14} aria-hidden /> 문자 앱으로 보내기
          </a>
        )}
        {c.phone && (
          <a href={telHref(c.phone)} className="num inline-flex min-h-9 items-center gap-1 px-1 text-[0.8rem] font-bold text-theme-ink underline underline-offset-2">
            <Phone size={14} aria-hidden /> {c.phone}
          </a>
        )}
      </div>
      {status && (
        <p role="status" className="text-[0.8rem] font-semibold text-ink-2" data-testid="intake-notify-status">
          {status}
        </p>
      )}
    </div>
  );
}

/**
 * 요청 목록의 ‘링크 접수·전화 접수’ 표시 — 접수자 이름·소속·전화 (본사만) · 접수 번호 · 접수자에게 알리기.
 * 계정이 없는 접수라 회신해도 알림이 가지 않는다 — 보낼 글을 복사하거나 문자 앱을 열어 진행 확인 주소를 알려 준다.
 */
export function IntakeContact({ db, req }: { db: DemoDB; req: PartnerRequest }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [redo, setRedo] = useState(false);
  const [redoNote, setRedoNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const c = req.intake;
  if (!c) return null;
  const link = c.id !== "phone" ? db.intakes?.find((i) => i.id === c.id) : undefined;
  const wo = req.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === req.linkedWorkOrderId) : undefined;
  const reopened = db.partnerRequests.some((x) => x.reopenedFrom === req.id);
  const url = req.statusToken ? statusUrl(req.statusToken) : "";
  const message = url ? notifyMessage(db, req, url) : "";
  // 회신했는데 접수자가 아직 확인하지 않음 — 알림이 가지 않으니 본사가 알려야 한다
  const shouldNotify = req.status === "answered" && !req.confirmedAt && !reopened;
  const canDiscard = !wo && !req.confirmedAt && !reopened;
  const canRedo = req.status === "answered" && !reopened && intakeCanConfirm({ ...req, confirmedAt: undefined }, db.workOrders ?? []);
  const renew = async (first: boolean) => {
    if (!first && !window.confirm("진행 확인 주소를 바꿀까요?\n주소가 다른 사람에게 알려졌을 때만 누르세요. 접수자가 지금 가진 주소는 바로 못 쓰게 되고, 새 주소를 다시 보내야 합니다.")) return;
    setBusy(true);
    setErr(null);
    try {
      await run("renewIntakeStatus", { requestId: req.id });
      setOpen(true);
      if (!first) toast.push({ tone: "ok", title: "진행 확인 주소를 바꿨습니다", desc: "새 주소를 접수자에게 보내 주세요." });
    } catch (e) {
      setErr(errorMessage(e, "만들지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const ok = await copyText(message, ref.current);
    setStatus(ok ? "보낼 글을 복사했습니다. 문자·카카오톡에 붙여 넣으세요." : "복사하지 못했습니다. 글을 길게 눌러 직접 복사해 주세요.");
  };
  const discard = async (reason: DiscardReason) => {
    if (!window.confirm(`접수 번호 ${c.no} 건을 버릴까요? (${DISCARD_REASONS[reason]})\n접수와 사진을 지웁니다. 하자 건수·관리대장·보고서에 남지 않고, 되돌릴 수 없습니다.`)) return;
    try {
      await run("discardIntakeRequests", { requestIds: [req.id], reason });
      toast.push({ tone: "ok", title: `접수 번호 ${c.no} 건을 버렸습니다` });
    } catch (e) {
      toast.push({ tone: "err", title: errorMessage(e, "버리지 못했습니다.") });
    }
  };
  const sendRedo = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await run("reopenIntakeRequest", { requestId: req.id, note: redoNote });
      setRedo(false);
      setRedoNote("");
      toast.push({ tone: "ok", title: `다시 접수했습니다 — 접수 번호 ${r.no}`, desc: "하자보수 ‘본사 할 일’에 새 접수로 올라옵니다. 작업지시를 다시 보내 주세요." });
    } catch (e) {
      setErr(errorMessage(e, "다시 접수하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={ref} className={cx("mt-1.5 rounded-lg border px-2.5 py-2 text-[0.8rem]", shouldNotify ? "border-active bg-active-soft/40" : "border-line bg-surface-2")} data-testid="request-intake" data-notify={shouldNotify ? "1" : "0"}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone="info">{intakeVia(c)}</Badge>
        <span className="num font-semibold">접수 번호 {c.no}</span>
        <b className="[overflow-wrap:anywhere]" data-testid="request-intake-who">{intakeContactLabel(req)}</b>
        {c.phone ? (
          <a href={telHref(c.phone)} className="num inline-flex min-h-9 items-center gap-1 font-bold text-theme-ink underline underline-offset-2" data-testid="request-intake-phone">
            <Phone size={14} aria-hidden /> {c.phone}
          </a>
        ) : c.purgedAt ? (
          <span className="text-ink-3">연락처는 보관 기간이 지나 지웠습니다</span>
        ) : (
          <span className="text-ink-3">연락처 없음</span>
        )}
        {link && <span className="text-ink-3">· 접수 경로: {link.label}</span>}
      </p>
      {reopened ? (
        <p className="mt-1 text-[0.76rem] text-ink-3">다시 접수된 건으로 이어서 처리 중입니다.</p>
      ) : (
        <>
          {/* 회신한 뒤에만 한 번 알린다 — 카드마다 같은 문장이 되풀이되지 않게 (점검 10차) */}
          {shouldNotify && (
            <p className="mt-1 text-[0.78rem] font-semibold text-ink" data-testid="request-intake-hint">
              회신은 접수자의 ‘진행 확인’ 화면에 보이지만 알림은 가지 않습니다. 문자나 전화로 알려 주세요.
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {url ? (
              <>
                <Button size="sm" variant={shouldNotify ? "cta" : "soft"} icon={<MessageSquareText size={14} />} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="request-intake-notify">
                  접수자에게 알리기
                </Button>
                <a href={url} target="_blank" rel="noreferrer" className="press inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[0.78rem] font-semibold text-ink-2 underline underline-offset-2" data-testid="request-intake-open">
                  <ExternalLink size={13} aria-hidden /> 접수자 화면 보기
                </a>
              </>
            ) : (
              <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => renew(true)} loading={busy} data-testid="request-intake-renew">
                진행 확인 주소 만들기
              </Button>
            )}
            {canRedo && (
              <Button size="sm" variant="ghost" onClick={() => setRedo((v) => !v)} data-testid="request-intake-redo">
                다시 접수 (전화로 알려 옴)
              </Button>
            )}
            {canDiscard && (
              <span className="inline-flex items-center gap-1">
                <label htmlFor={`discard-${req.id}`} className="sr-only">
                  접수 번호 {c.no} 버리기
                </label>
                <select
                  id={`discard-${req.id}`}
                  value=""
                  onChange={(e) => {
                    const v = e.target.value as DiscardReason | "";
                    e.target.value = "";
                    if (v) void discard(v);
                  }}
                  className="h-9 rounded-full border border-line bg-surface px-2.5 text-[0.78rem] font-semibold text-ink-2"
                  data-testid="request-intake-discard"
                >
                  <option value="">버리기…</option>
                  {(Object.keys(DISCARD_REASONS) as DiscardReason[]).map((k) => (
                    <option key={k} value={k}>
                      {DISCARD_REASONS[k]}
                    </option>
                  ))}
                </select>
              </span>
            )}
            {err && <span className="font-semibold text-err">{err}</span>}
          </div>
          {open && url && (
            <div className="mt-2 rounded-lg border border-line bg-surface px-2.5 py-2" data-testid="request-intake-box">
              <label htmlFor={`msg-${req.id}`} className="text-[0.78rem] font-bold text-ink-2">
                접수자에게 보낼 글 (진행 확인 주소 포함)
              </label>
              <textarea id={`msg-${req.id}`} readOnly rows={6} value={message} onFocus={(e) => e.currentTarget.select()} className={cx(inputCls, "mt-1 h-auto resize-none py-1.5 text-[0.8rem] leading-relaxed [overflow-wrap:anywhere]")} data-testid="request-intake-message" />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="cta" icon={<Copy size={14} />} onClick={copy} data-testid="request-intake-copy">
                  보낼 글 복사
                </Button>
                {c.phone && (
                  <a href={`sms:${c.phone.replace(/[^\d]/g, "")}?&body=${encodeURIComponent(message)}`} className="press inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 text-[0.8rem] font-bold" data-testid="request-intake-sms">
                    <MessageSquareText size={14} aria-hidden /> 문자 앱으로 보내기
                  </a>
                )}
                <button type="button" onClick={() => renew(false)} className="press min-h-9 px-1 text-[0.76rem] text-ink-3 underline underline-offset-2" data-testid="request-intake-renew">
                  주소 바꾸기
                </button>
              </div>
              {status && (
                <p role="status" className="mt-1 text-[0.78rem] font-semibold text-ink-2" data-testid="request-intake-status">
                  {status}
                </p>
              )}
              <p className="mt-1 text-[0.74rem] text-ink-3">이 주소는 언제든 여기서 다시 볼 수 있습니다. ‘문자 앱으로 보내기’는 휴대폰에서 누르면 문자 앱이 열립니다.</p>
            </div>
          )}
          {redo && (
            <div className="mt-2 rounded-lg border border-line bg-surface px-2.5 py-2" data-testid="request-intake-redo-box">
              <label htmlFor={`redo-${req.id}`} className="text-[0.78rem] font-bold text-ink-2">
                접수자가 알려 온 내용 (아직 남은 문제)
              </label>
              <textarea id={`redo-${req.id}`} rows={2} value={redoNote} onChange={(e) => setRedoNote(e.target.value)} maxLength={300} placeholder="예: 비가 오니 같은 자리에서 다시 샌다고 함" className={cx(inputCls, "mt-1 h-auto resize-none py-1.5 text-[0.82rem]")} data-testid="request-intake-redo-note" />
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Button size="sm" variant="cta" loading={busy} onClick={sendRedo} data-testid="request-intake-redo-send">
                  다시 접수하기
                </Button>
                <Button size="sm" onClick={() => setRedo(false)}>
                  취소
                </Button>
              </div>
              <p className="mt-1 text-[0.74rem] text-ink-3">같은 접수에 이어 새 접수(접수 번호 {c.no.split("-").slice(0, 2).join("-")}-n)가 만들어지고, 접수자의 진행 확인 주소는 그대로 새 접수를 보여 줍니다.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 전화로 받은 하자 등록 — 링크 접수와 같은 목록에 들어가고, 진행 확인 주소를 문자로 보낼 수 있다 */
export function PhoneDefectModal({ db, siteId, defaultSiteId, onClose }: { db: DemoDB; siteId?: string; defaultSiteId?: string; onClose: () => void }) {
  const toast = useToast();
  const sites = db.sites;
  // 하자보수 화면에서 현장을 골라 둔 채 누르면 그 현장으로 (점검 11차)
  const [site, setSite] = useState(siteId ?? (defaultSiteId && sites.some((x) => x.id === defaultSiteId) ? defaultSiteId : sites[0]?.id) ?? "");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [org, setOrg] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => uid("idem"));
  const hasContact = !!(name.trim() || phone.trim());
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await run("registerPhoneDefect", { siteId: site, location, description, name, phone, org, consent, idempotencyKey: key });
      toast.push({ tone: "ok", title: `전화 접수를 등록했습니다 — 접수 번호 ${r.no}`, desc: "하자보수 ‘본사 할 일’에 올라왔습니다. 펼쳐서 ‘접수자에게 알리기’로 진행 확인 주소를 문자로 보낼 수 있습니다." });
      onClose();
    } catch (e) {
      const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors;
      if (fe && Object.keys(fe).length) setErrors(fe);
      else setErrors({ form: errorMessage(e, "등록하지 못했습니다.") });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="전화로 받은 하자 등록"
      description="전화로 들어온 하자도 같은 목록에서 처리합니다"
      size="md"
      testId="phone-defect-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" loading={busy} onClick={save} data-testid="phone-defect-save">
            등록
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!siteId && (
          <Field label="현장" htmlFor="pd-site" required>
            <select id="pd-site" className={inputCls} value={site} onChange={(e) => setSite(e.target.value)} data-testid="phone-defect-site">
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortName} · {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="어디에 문제가 있나요" htmlFor="pd-location" required error={errors.location}>
          <input id="pd-location" className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={60} placeholder="예: 3층 302호 거실 창" data-testid="phone-defect-location" />
        </Field>
        <Field label="어떤 문제인가요 (접수자의 진행 확인 화면에 그대로 보입니다)" htmlFor="pd-description" required error={errors.description}>
          <textarea id="pd-description" rows={3} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={800} placeholder="예: 비가 오면 창틀 아래로 물이 샌다고 함" data-testid="phone-defect-description" />
        </Field>
        <fieldset className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
          <legend className="px-1 text-[0.82rem] font-bold">전화한 분 (선택)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="이름" htmlFor="pd-name" error={errors.name}>
              <input id="pd-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} data-testid="phone-defect-name" />
            </Field>
            <Field label="전화번호" htmlFor="pd-phone" error={errors.phone}>
              <input id="pd-phone" type="tel" inputMode="tel" className={cx(inputCls, "num")} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="010-1234-5678" data-testid="phone-defect-phone" />
            </Field>
          </div>
          <Field label="소속" htmlFor="pd-org" error={errors.org}>
            <input id="pd-org" className={inputCls} value={org} onChange={(e) => setOrg(e.target.value)} maxLength={40} placeholder="예: 관리사무소" data-testid="phone-defect-org" />
          </Field>
          {hasContact && (
            <label className="flex items-start gap-2.5 text-[0.85rem]">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="phone-defect-consent" />
              <span>
                <b>이름·전화번호를 하자 처리와 연락에 쓰는 데 전화로 동의받았습니다</b>
                <span className="block text-[0.74rem] text-ink-3">처리가 끝나면 {INTAKE_CONTACT_KEEP_DAYS}일 뒤 이름·전화번호를 지웁니다.</span>
              </span>
            </label>
          )}
          {errors.consent && (
            <p role="alert" className="text-[0.82rem] font-semibold text-err">
              {errors.consent}
            </p>
          )}
        </fieldset>
        {errors.form && (
          <p role="alert" className="rounded-xl bg-err-bg px-3.5 py-2 text-[0.84rem] font-semibold text-err">
            {errors.form}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** 장난·중복 접수 여러 건 버리기 — 아직 손대지 않은(작업지시 전) 링크·전화 접수만 */
export function DiscardIntakeModal({ db, onClose }: { db: DemoDB; onClose: () => void }) {
  const toast = useToast();
  const list = db.partnerRequests.filter((r) => r.intake && !r.confirmedAt && !(r.linkedWorkOrderId && (db.workOrders ?? []).some((w) => w.id === r.linkedWorkOrderId)) && !db.partnerRequests.some((x) => x.reopenedFrom === r.id));
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState<DiscardReason>("spam");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const all = picked.length === list.length && list.length > 0;
  const go = async () => {
    if (!window.confirm(`고른 ${picked.length}건을 버릴까요? (${DISCARD_REASONS[reason]})\n접수와 사진을 지웁니다. 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await run("discardIntakeRequests", { requestIds: picked, reason });
      toast.push({ tone: "ok", title: `접수 ${r.discarded}건을 버렸습니다` });
      onClose();
    } catch (e) {
      setErr(errorMessage(e, "버리지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="장난·중복 접수 버리기"
      description="버린 접수는 사진까지 지워지고 하자 건수·관리대장·보고서에 남지 않습니다"
      size="md"
      testId="discard-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="cta" icon={<Trash2 size={16} />} disabled={!picked.length || busy} onClick={go} data-testid="discard-go">
            {picked.length ? `${picked.length}건 버리기` : "버릴 접수를 고르세요"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {list.length === 0 ? (
          <p className="text-[0.88rem] text-ink-2">버릴 수 있는 접수가 없습니다. (작업지시를 보냈거나 접수자가 확인한 접수는 회신으로 끝냅니다)</p>
        ) : (
          <>
            <label className="flex min-h-10 items-center gap-2.5 text-[0.86rem] font-bold">
              <input type="checkbox" checked={all} onChange={(e) => setPicked(e.target.checked ? list.map((r) => r.id) : [])} className="size-4 accent-[var(--t-active)]" data-testid="discard-all" />
              모두 고르기 ({list.length}건)
            </label>
            <ul className="max-h-[42vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {list.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-[0.84rem]">
                    <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id)))} className="mt-1 size-4 accent-[var(--t-active)]" data-testid="discard-pick" />
                    <span className="min-w-0">
                      <b className="num">{r.intake!.no}</b> <span className="text-ink-3">· {db.sites.find((s) => s.id === r.siteId)?.shortName} · {fmtRelative(r.createdAt)}</span>
                      <span className="block [overflow-wrap:anywhere]">
                        {r.location} — {r.description.slice(0, 60)}
                        {r.description.length > 60 ? "…" : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <fieldset>
              <legend className="mb-1 text-[0.82rem] font-bold">버리는 이유</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {(Object.keys(DISCARD_REASONS) as DiscardReason[]).map((k) => (
                  <label key={k} className="flex min-h-9 items-center gap-2 text-[0.86rem]">
                    <input type="radio" name="discard-reason" checked={reason === k} onChange={() => setReason(k)} className="size-4 accent-[var(--t-active)]" />
                    {DISCARD_REASONS[k]}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        {err && (
          <p role="alert" className="rounded-xl bg-err-bg px-3.5 py-2 text-[0.84rem] font-semibold text-err">
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}
