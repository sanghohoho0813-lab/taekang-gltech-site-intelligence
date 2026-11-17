"use client";

/**
 * 돈 기록 바로잡기 (D-89) — 기성·수금 화면.
 * - VoidMoneyButton: 잘못 넣은 기성·입금 취소 (이유 · 숫자에서 빠지고 ‘취소한 기록’에 남음)
 * - VoidedList: 취소한 기성·입금 (누가·언제·왜)
 * - WithheldFields: 입금 등록 창 안 — 발주처가 이번에 떼고 준 돈 (없음 · 유보금 · 공제)
 * - WithheldCard: 유보금(받을 돈)·공제(받지 못한 돈) 목록 · 유보금 받음 · 취소 · 따로 등록
 * 본사 화면에서만 (현장·발주처에는 돈 자체가 내려가지 않음).
 */
import { useState } from "react";
import { ChevronDown, HandCoins, Undo2, XCircle } from "lucide-react";
import { userLabel } from "@/lib/data/hooks";
import { Badge, Button, Card, CardHeader, Field, Notice, cx, inputCls } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CommandError } from "@/lib/data/commands";
import { run } from "@/lib/data/store";
import { siteFinancials } from "@/lib/domain/calc";
import { fmtDate, fmtDateTime, fmtMan, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { DEDUCTION_LABEL, adjustmentLabel, retentionLeft } from "@/lib/domain/receivables";
import type { DeductionType, DemoDB, PaymentReceived, ProgressBilling, ReceivableAdjustment } from "@/lib/domain/types";
import { ClosedMonthHint } from "@/components/domain/ClosedMonthHint";

const digits = (v: string) => v.replace(/[^\d]/g, "");
const commas = (v: string) => (digits(v) ? Number(digits(v)).toLocaleString("ko-KR") : "");
const siteName = (db: DemoDB, id: string) => db.sites.find((s) => s.id === id)?.shortName ?? "";
const DEDUCTION_TYPES: DeductionType[] = ["delay_penalty", "setoff", "other"];

// ───────────── 기성·입금 취소 ─────────────

export function VoidMoneyButton({ db, kind, rec }: { db: DemoDB; kind: "billing" | "payment"; rec: ProgressBilling | PaymentReceived }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="press inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[0.74rem] font-semibold text-ink-3 hover:bg-surface-2 hover:text-err" onClick={() => setOpen(true)} data-testid="money-void" data-kind={kind}>
        <XCircle size={13} aria-hidden />
        취소
      </button>
      {open && <VoidMoneyModal db={db} kind={kind} rec={rec} onClose={() => setOpen(false)} />}
    </>
  );
}

function VoidMoneyModal({ db, kind, rec, onClose }: { db: DemoDB; kind: "billing" | "payment"; rec: ProgressBilling | PaymentReceived; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const date = kind === "billing" ? (rec as ProgressBilling).billedDate : (rec as PaymentReceived).receivedDate;
  const retentionPay = kind === "payment" && !!(rec as PaymentReceived).retentionId;
  const linked = kind === "payment" ? (db.receivableAdjustments ?? []).find((a) => a.paymentId === rec.id && !a.voidedAt) : undefined;
  const what = kind === "billing" ? `${siteName(db, rec.siteId)} ${(rec as ProgressBilling).round ? `${(rec as ProgressBilling).round}차 ` : ""}기성 ${fmtMan(rec.amount)} (${fmtDate(date)})` : `${siteName(db, rec.siteId)} 입금 ${fmtMan(rec.amount)} (${fmtDate(date)})`;
  return (
    <Modal
      open
      onClose={onClose}
      title={kind === "billing" ? "기성 취소" : "입금 취소"}
      description={what}
      size="sm"
      testId="money-void-modal"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await run("voidMoneyRecord", { kind, id: rec.id, reason, idempotencyKey: key });
                toast.push({ tone: "ok", title: `${kind === "billing" ? "기성" : "입금"}을 취소했습니다`, desc: "숫자에서 빠지고, ‘취소한 기록’에 이유와 함께 남았습니다" });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? { msg: e.message, fields: e.fieldErrors } : { msg: "취소하지 못했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="money-void-confirm"
          >
            취소하기
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <p>잘못 넣은 {kind === "billing" ? "기성" : "입금"}을 숫자에서 뺍니다. 기록은 지우지 않고 ‘취소한 기록’에 누가·언제·왜와 함께 남습니다. 금액이 틀렸으면 취소한 뒤 바른 금액으로 다시 넣으세요.</p>
        {kind === "billing" && <p className="text-[0.8rem] text-ink-3">뒤 기성의 차수는 날짜 순서로 다시 매겨집니다.</p>}
        {retentionPay && <p className="text-[0.8rem] font-semibold text-warn">유보금을 받아 만든 입금입니다 — 취소하면 그 유보금이 다시 ‘받을 돈’으로 돌아갑니다.</p>}
        {linked && (
          <p className="text-[0.8rem] font-semibold text-warn" data-testid="money-void-linked">
            이 입금과 함께 넣은 {linked.kind === "retention" ? "유보금" : "공제"} {fmtMan(linked.amount)}은 그대로 남습니다 — 그것도 잘못 넣었으면 아래 ‘유보금 · 공제’에서 따로 취소하세요.
          </p>
        )}
        <ClosedMonthHint db={db} date={date} action="취소하면" what={kind === "billing" ? "기성" : "입금"} />
        <Field label="취소하는 이유" htmlFor="money-void-reason" required error={err?.fields?.reason} counter={`${Array.from(reason).length}/200`}>
          <input id="money-void-reason" className={inputCls} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={kind === "billing" ? "예: 같은 기성을 두 번 넣음" : "예: 금액 단위 잘못 (9천만 → 9억)"} data-testid="money-void-reason" />
        </Field>
        {err && !err.fields?.reason && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}

/** 취소한 기성·입금 (접어 둠) */
export function VoidedList({ db, kind }: { db: DemoDB; kind: "billing" | "payment" }) {
  const [open, setOpen] = useState(false);
  const list = (db.voidedMoney ?? []).filter((v) => v.kind === kind).sort((a, b) => b.voidedAt.localeCompare(a.voidedAt));
  if (!list.length) return null;
  return (
    <div className="border-t border-line px-5 pb-3 pt-2">
      <button type="button" className="inline-flex items-center gap-1 text-[0.8rem] font-semibold text-ink-2" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid={`voided-toggle-${kind}`}>
        <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} aria-hidden />
        취소한 {kind === "billing" ? "기성" : "입금"} {list.length}건
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 text-[0.8rem]" data-testid={`voided-list-${kind}`}>
          {list.map((v) => (
            <li key={v.id} className="text-ink-2">
              <b>{siteName(db, v.siteId)}</b> <s className="num">{fmtMan(v.record.amount)}</s> <span className="text-ink-3">({fmtDate(kind === "billing" ? (v.record as ProgressBilling).billedDate : (v.record as PaymentReceived).receivedDate)})</span> — {v.reason}{" "}
              <span className="text-[0.72rem] text-ink-3">
                ({userLabel(db, v.voidedBy)} {fmtDateTime(v.voidedAt)})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────── 입금 창 안: 발주처가 뗀 돈 ─────────────

export interface WithheldValue {
  kind: "" | "retention" | "deduction";
  amountText: string;
  deductionType: DeductionType | "";
  note: string;
  dueDate: string;
}
export const EMPTY_WITHHELD: WithheldValue = { kind: "", amountText: "", deductionType: "", note: "", dueDate: "" };

/** 입금 등록 창의 ‘발주처가 떼고 준 돈’ 칸 — 보낼 값(없으면 undefined) */
export function withheldArgs(w: WithheldValue) {
  if (!w.kind) return undefined;
  return {
    kind: w.kind,
    amount: Number(digits(w.amountText)),
    note: w.note,
    ...(w.kind === "deduction" ? { deductionType: (w.deductionType || undefined) as DeductionType | undefined } : {}),
    ...(w.kind === "retention" && w.dueDate ? { dueDate: w.dueDate } : {}),
  };
}

export function WithheldFields({ value, onChange, outstanding, pay, errors }: { value: WithheldValue; onChange: (v: WithheldValue) => void; outstanding: number; pay: number; errors?: Record<string, string> }) {
  const set = (p: Partial<WithheldValue>) => onChange({ ...value, ...p });
  const amt = Number(digits(value.amountText));
  const after = outstanding - pay - (value.kind === "deduction" ? amt : 0);
  return (
    <fieldset className="space-y-2.5 rounded-xl border border-line px-3.5 py-3" data-testid="pay-withheld">
      <legend className="px-1 text-[0.84rem] font-semibold">발주처가 이번에 떼고 준 돈이 있나요?</legend>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["", "없음"],
            ["retention", "유보금 (나중에 받음)"],
            ["deduction", "공제 (받지 못함)"],
          ] as const
        ).map(([k, label]) => (
          <label key={k || "none"} className={cx("cursor-pointer rounded-lg border px-3 py-1.5 text-[0.84rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-active/40", value.kind === k ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
            <input type="radio" name="pay-withheld-kind" className="sr-only" checked={value.kind === k} onChange={() => set({ kind: k })} data-testid={`pay-withheld-kind-${k || "none"}`} />
            {label}
          </label>
        ))}
      </div>
      {value.kind && (
        <>
          <p className="text-[0.78rem] text-ink-3">
            {value.kind === "retention"
              ? "유보금: 하자보수·준공 뒤 받기로 하고 남겨 둔 돈입니다. 미수금에 남지만 ‘오래된 미수’ 알림에서는 빠집니다 (받을 날이 지나면 다시 셈)."
              : "공제: 지체상금·발주처 자재 상계처럼 받지 못하는 돈입니다. 미수금에서 빠지고 예상이익도 그만큼 줄어 ‘이익을 바꾼 일’에 남습니다."}
          </p>
          {value.kind === "deduction" && (
            <Field label="공제 종류" htmlFor="pay-withheld-type" required error={errors?.deductionType}>
              <select id="pay-withheld-type" className={inputCls} value={value.deductionType} onChange={(e) => set({ deductionType: e.target.value as DeductionType })} data-testid="pay-withheld-type">
                <option value="" disabled>
                  고르기
                </option>
                {DEDUCTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DEDUCTION_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={value.kind === "retention" ? "유보금 (원)" : "공제 금액 (원)"} htmlFor="pay-withheld-amount" required error={errors?.withheldAmount} hint={amt ? `= ${fmtMan(amt)} · 등록하면 미수금 ${fmtMan(outstanding)} → ${fmtMan(after)}${value.kind === "retention" ? ` (그중 유보금 ${fmtMan(amt)})` : ""}` : undefined}>
            <input id="pay-withheld-amount" inputMode="numeric" className={cx(inputCls, "num text-right")} value={value.amountText} onChange={(e) => set({ amountText: commas(e.target.value) })} data-testid="pay-withheld-amount" />
          </Field>
          {value.kind === "retention" && (
            <Field label="받을 예정일 (선택)" htmlFor="pay-withheld-due" error={errors?.dueDate} hint="비워 두면 받을 때까지 ‘오래된 미수’에서 뺍니다">
              <input id="pay-withheld-due" type="date" className={cx(inputCls, "w-auto")} value={value.dueDate} onChange={(e) => set({ dueDate: e.target.value })} data-testid="pay-withheld-due" />
            </Field>
          )}
          <Field label={value.kind === "deduction" ? "공제 사유" : "메모 (선택)"} htmlFor="pay-withheld-note" required={value.kind === "deduction"} error={errors?.note} counter={`${Array.from(value.note).length}/200`}>
            <input id="pay-withheld-note" className={inputCls} value={value.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} placeholder={value.kind === "deduction" ? "예: 공기 지연 6일 지체상금 — 원청 공문 11/10" : "예: 하자보수 유보 5% — 준공 후 지급"} data-testid="pay-withheld-note" />
          </Field>
        </>
      )}
    </fieldset>
  );
}

// ───────────── 유보금·공제 카드 ─────────────

export function WithheldCard({ db }: { db: DemoDB }) {
  const [adding, setAdding] = useState(false);
  const [release, setRelease] = useState<ReceivableAdjustment | null>(null);
  const [voiding, setVoiding] = useState<ReceivableAdjustment | null>(null);
  const [showDone, setShowDone] = useState(false);
  const all = db.receivableAdjustments ?? [];
  const live = all.filter((a) => !a.voidedAt);
  const open = live.filter((a) => a.kind === "retention" && retentionLeft(a) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const deductions = live.filter((a) => a.kind === "deduction").sort((a, b) => b.date.localeCompare(a.date));
  const done = [...all.filter((a) => a.voidedAt), ...live.filter((a) => a.kind === "retention" && retentionLeft(a) <= 0)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const openSum = open.reduce((s, a) => s + retentionLeft(a), 0);
  const dedSum = deductions.reduce((s, a) => s + a.amount, 0);
  const today = todayIso();
  const roundOf = (id?: string) => {
    const b = id ? db.billings.find((x) => x.id === id) : undefined;
    return b ? ` · ${b.round}차 기성` : "";
  };
  return (
    <Card id="withheld" className="scroll-mt-24" data-testid="withheld-card">
      <CardHeader
        title="유보금 · 공제"
        sub="발주처가 기성에서 떼고 준 돈. 유보금은 나중에 받을 돈(미수에 남음), 공제(지체상금·상계)는 받지 못하는 돈(미수·예상이익에서 빠짐)입니다."
        right={
          <Button size="sm" icon={<HandCoins size={15} />} onClick={() => setAdding(true)} disabled={!db.sites.length} data-testid="withheld-add">
            유보금·공제 등록
          </Button>
        }
      />
      {!open.length && !deductions.length && <p className="px-5 pb-4 text-[0.84rem] text-ink-3">없습니다. 입금이 기성보다 적게 들어왔으면 ‘입금 등록’에서 뗀 돈을 함께 적거나 여기서 따로 등록하세요.</p>}
      {open.length > 0 && (
        <section className="border-t border-line" data-testid="withheld-retention">
          <h3 className="px-5 pt-3 pb-1 text-[0.9rem] font-bold">
            받을 유보금 {open.length}건 · <span className="num">{fmtMan(openSum)}</span>
          </h3>
          <ul className="divide-y divide-line">
            {open.map((a) => {
              const left = retentionLeft(a);
              const late = !!a.dueDate && a.dueDate < today;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[0.84rem]" data-testid="withheld-row" data-kind="retention">
                  <span className="shrink-0 font-semibold">{siteName(db, a.siteId)}</span>
                  <span className="min-w-0 flex-1 basis-[14rem] text-ink-2">
                    {fmtDate(a.date)} 뗌{roundOf(a.billingId)}
                    {a.dueDate && <span className={cx(late && "font-semibold text-warn")}> · 받을 날 {fmtDate(a.dueDate)}{late ? " 지남" : ""}</span>}
                    {a.note && <span className="text-ink-3"> · {a.note}</span>}
                    {(a.released ?? []).length > 0 && <span className="text-ink-3"> · 받음 {fmtMan((a.released ?? []).reduce((s, x) => s + x.amount, 0))}</span>}
                  </span>
                  <b className="num shrink-0">{fmtMan(left)}</b>
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="soft" onClick={() => setRelease(a)} data-testid="withheld-release">
                      받음
                    </Button>
                    {!(a.released ?? []).length && (
                      <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={() => setVoiding(a)} data-testid="withheld-void">
                        취소
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {deductions.length > 0 && (
        <section className="border-t border-line" data-testid="withheld-deductions">
          <h3 className="px-5 pt-3 pb-1 text-[0.9rem] font-bold">
            공제 (받지 못함) {deductions.length}건 · <span className="num">{fmtMan(dedSum)}</span>
          </h3>
          <ul className="divide-y divide-line">
            {deductions.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[0.84rem]" data-testid="withheld-row" data-kind="deduction">
                <span className="shrink-0 font-semibold">{siteName(db, a.siteId)}</span>
                <span className="min-w-0 flex-1 basis-[14rem] text-ink-2">
                  <Badge tone="neutral">{DEDUCTION_LABEL[a.deductionType ?? "other"]}</Badge> {fmtDate(a.date)}
                  {roundOf(a.billingId)} · {a.note}
                </span>
                <b className="num shrink-0">−{fmtMan(a.amount)}</b>
                <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={() => setVoiding(a)} data-testid="withheld-void">
                  취소
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {done.length > 0 && (
        <div className="border-t border-line px-5 pb-3 pt-2">
          <button type="button" className="inline-flex items-center gap-1 text-[0.8rem] font-semibold text-ink-2" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} data-testid="withheld-done-toggle">
            <ChevronDown size={14} className={cx("transition-transform", showDone && "rotate-180")} aria-hidden />
            다 받은 유보금 · 취소한 기록 {done.length}건
          </button>
          {showDone && (
            <ul className="mt-1.5 space-y-1 text-[0.8rem] text-ink-2">
              {done.map((a) => (
                <li key={a.id}>
                  <b>{siteName(db, a.siteId)}</b> {adjustmentLabel(a)} <span className="num">{fmtMan(a.amount)}</span> ({fmtDate(a.date)}) —{" "}
                  {a.voidedAt ? (
                    <>
                      취소: {a.voidReason} <span className="text-[0.72rem] text-ink-3">({userLabel(db, a.voidedBy)} {fmtDateTime(a.voidedAt)})</span>
                    </>
                  ) : (
                    <>다 받음 ({(a.released ?? []).map((r) => fmtDate(r.date)).join(", ")})</>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {adding && <AdjustmentModal db={db} onClose={() => setAdding(false)} />}
      {release && <ReleaseModal db={db} a={release} onClose={() => setRelease(null)} />}
      {voiding && <VoidAdjustmentModal db={db} a={voiding} onClose={() => setVoiding(null)} />}
    </Card>
  );
}

function AdjustmentModal({ db, onClose }: { db: DemoDB; onClose: () => void }) {
  const toast = useToast();
  const [siteId, setSiteId] = useState(db.sites[0]?.id ?? "");
  const [w, setW] = useState<WithheldValue>({ ...EMPTY_WITHHELD, kind: "deduction" });
  const [date, setDate] = useState(todayIso());
  const [billingId, setBillingId] = useState("");
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  const f = siteId ? siteFinancials(db, siteId) : null;
  const bills = db.billings.filter((b) => b.siteId === siteId && b.status === "confirmed").sort((a, b) => b.billedDate.localeCompare(a.billedDate));
  return (
    <Modal
      open
      onClose={onClose}
      title="유보금·공제 등록"
      description="입금 없이 공문으로 받은 지체상금, 지난 기성에서 뗀 유보금 등"
      size="sm"
      testId="withheld-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            loading={busy}
            disabled={!w.kind}
            onClick={async () => {
              const a = withheldArgs(w);
              if (!a) return;
              setBusy(true);
              try {
                await run("addReceivableAdjustment", { siteId, date, ...a, ...(billingId ? { billingId } : {}), idempotencyKey: key });
                toast.push({ tone: "ok", title: `${a.kind === "retention" ? "유보금" : "공제"}을 등록했습니다`, desc: a.kind === "deduction" ? "미수금과 예상이익에서 빠지고 ‘이익을 바꾼 일’에 남았습니다" : "미수금에 남고 ‘오래된 미수’ 알림에서는 빠집니다" });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? { msg: e.message, fields: e.fieldErrors } : { msg: "저장하지 못했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="withheld-confirm"
          >
            등록
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <Field label="현장" htmlFor="wh-site">
          <select id="wh-site" className={inputCls} value={siteId} onChange={(e) => (setSiteId(e.target.value), setBillingId(""))} data-testid="withheld-site">
            {db.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="발주처가 뗀 날" htmlFor="wh-date" error={err?.fields?.date}>
          <input id="wh-date" type="date" className={cx(inputCls, "w-auto")} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} data-testid="withheld-date" />
        </Field>
        {bills.length > 0 && (
          <Field label="어느 기성에서 (선택)" htmlFor="wh-bill">
            <select id="wh-bill" className={inputCls} value={billingId} onChange={(e) => setBillingId(e.target.value)}>
              <option value="">고르지 않음</option>
              {bills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.round}차 {fmtDate(b.billedDate)} {fmtMan(b.amount)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {f && <WithheldFields value={w} onChange={setW} outstanding={f.outstanding} pay={0} errors={err?.fields} />}
        <ClosedMonthHint db={db} date={date} action="넣으면" what="유보금·공제" />
        {/* 칸 아래에 이미 보인 오류는 다시 보이지 않는다 */}
        {err && !["withheldAmount", "note", "deductionType", "dueDate", "date"].some((k) => err.fields?.[k]) && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}

function ReleaseModal({ db, a, onClose }: { db: DemoDB; a: ReceivableAdjustment; onClose: () => void }) {
  const toast = useToast();
  const left = retentionLeft(a);
  const [amountText, setAmountText] = useState(left.toLocaleString("ko-KR"));
  const [date, setDate] = useState(todayIso());
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = Number(digits(amountText));
  return (
    <Modal
      open
      onClose={onClose}
      title="유보금 받음"
      description={`${siteName(db, a.siteId)} · ${fmtDate(a.date)}에 뗀 유보금 · 남은 ${fmtMan(left)}`}
      size="sm"
      testId="release-modal"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="cta"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await run("releaseRetention", { id: a.id, date, amount, idempotencyKey: key });
                toast.push({ tone: "ok", title: `유보금 ${fmtMan(amount)}을 받았습니다`, desc: "입금 이력에 ‘유보금 받음’으로 들어갔습니다" });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? e.message : "저장하지 못했습니다. 다시 눌러 주세요.");
              } finally {
                setBusy(false);
              }
            }}
            data-testid="release-confirm"
          >
            받음으로 등록
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <Field label="받은 금액 (원)" htmlFor="rel-amount" hint={amount && amount < left ? `남은 유보금 ${fmtMan(left - amount)}은 계속 받을 돈으로 남습니다` : "나눠 받으면 받은 만큼만 적으세요"}>
          <input id="rel-amount" inputMode="numeric" className={cx(inputCls, "num text-right")} value={amountText} onChange={(e) => setAmountText(commas(e.target.value))} data-testid="release-amount" />
        </Field>
        <Field label="받은 날" htmlFor="rel-date">
          <input id="rel-date" type="date" className={cx(inputCls, "w-auto")} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} data-testid="release-date" />
        </Field>
        <p className="text-[0.78rem] text-ink-3">발주처가 유보금에서도 떼고 줬으면(지체상금 등) 받은 만큼만 등록하고, 남은 유보금을 취소한 뒤 공제로 등록하세요.</p>
        {err && <Notice tone="err">{err}</Notice>}
      </div>
    </Modal>
  );
}

function VoidAdjustmentModal({ db, a, onClose }: { db: DemoDB; a: ReceivableAdjustment; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${a.kind === "retention" ? "유보금" : "공제"} 취소`}
      description={`${siteName(db, a.siteId)} ${adjustmentLabel(a)} ${fmtMan(a.amount)} (${fmtDate(a.date)})`}
      size="sm"
      testId="withheld-void-modal"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await run("voidReceivableAdjustment", { id: a.id, reason, idempotencyKey: key });
                toast.push({ tone: "ok", title: "취소했습니다", desc: a.kind === "deduction" ? "미수금과 예상이익이 돌아오고 ‘공제 취소’가 남았습니다" : "그 금액은 다시 일반 미수로 셉니다" });
                onClose();
              } catch (e) {
                setErr(e instanceof CommandError ? { msg: e.message, fields: e.fieldErrors } : { msg: "취소하지 못했습니다. 다시 눌러 주세요." });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="withheld-void-confirm"
          >
            취소하기
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[0.88rem]">
        <Field label="취소하는 이유" htmlFor="wh-void-reason" required error={err?.fields?.reason} counter={`${Array.from(reason).length}/200`}>
          <input id="wh-void-reason" className={inputCls} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="예: 발주처가 지체상금을 면제함" data-testid="withheld-void-reason" />
        </Field>
        {err && !err.fields?.reason && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}
