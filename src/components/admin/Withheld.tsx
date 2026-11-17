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
import { DEDUCTION_LABEL, adjustmentLabel, retentionLeft, vatExcludedPayment } from "@/lib/domain/receivables";
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
  // 함께 넣은 유보금·공제도 같이 취소 (기본) — 그대로 두면 다시 넣을 때 두 번 잡힌다 (D-89 사용성 점검)
  const [withLinked, setWithLinked] = useState(true);
  // 취소하면 뒤 기성의 회차가 바뀌는지 미리 보여 준다
  const later = kind === "billing" ? db.billings.filter((b) => b.siteId === rec.siteId && b.id !== rec.id && b.billedDate >= date && b.round > (rec as ProgressBilling).round) : [];
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
                const r = await run("voidMoneyRecord", { kind, id: rec.id, reason, ...(linked ? { withLinked } : {}), idempotencyKey: key });
                const extra = [r?.linked?.length ? `함께 취소: ${r.linked.join(", ")}` : "", r?.renumbered?.length ? `회차 바뀜: ${r.renumbered.join(", ")}` : ""].filter(Boolean).join(" · ");
                toast.push({ tone: "ok", title: `${kind === "billing" ? "기성" : "입금"}을 취소했습니다`, desc: extra || "숫자에서 빠지고, ‘취소한 기록’에 이유와 함께 남았습니다" });
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
        {later.length > 0 && (
          <p className="text-[0.8rem] font-semibold text-warn" data-testid="money-void-renumber">
            뒤 기성의 회차가 하나씩 당겨집니다: {later.sort((a, b) => a.round - b.round).map((b) => `${fmtDate(b.billedDate)} ${b.round}차→${b.round - 1}차`).join(", ")}. 이미 보낸 엑셀·공문의 회차와 달라질 수 있습니다.
          </p>
        )}
        {retentionPay && <p className="text-[0.8rem] font-semibold text-warn">유보금을 받아 만든 입금입니다 — 취소하면 그 유보금이 다시 ‘받을 돈’으로 돌아갑니다.</p>}
        {linked && (
          <label className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-[0.84rem]" data-testid="money-void-linked">
            <input type="checkbox" className="mt-1 size-4 shrink-0" checked={withLinked} onChange={(e) => setWithLinked(e.target.checked)} data-testid="money-void-linked-check" />
            <span>
              이 입금과 함께 넣은 <b>{adjustmentLabel(linked)} {fmtMan(linked.amount)}</b>도 취소
              <span className="block text-[0.76rem] text-ink-3">{withLinked ? "다시 넣을 때 입금 창에서 함께 적으세요 (그대로 두면 두 번 잡힙니다)." : "발주처가 뗀 것은 맞고 입금만 잘못 넣었을 때만 끄세요."}</span>
            </span>
          </label>
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
              <b>{siteName(db, v.siteId)}</b> {kind === "billing" && (v.record as ProgressBilling).round ? `${(v.record as ProgressBilling).round}차 ` : ""}<s className="num">{fmtMan(v.record.amount)}</s> <span className="text-ink-3">({fmtDate(kind === "billing" ? (v.record as ProgressBilling).billedDate : (v.record as PaymentReceived).receivedDate)})</span> — {v.reason}{" "}
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
  billingId: string;
  /** 상계: 그 돈을 원가(비용)로 이미 넣었나 — 넣었으면 공제가 아니라 입금 (이익이 두 번 줄지 않게) */
  inCost: "" | "yes" | "no";
}
export const EMPTY_WITHHELD: WithheldValue = { kind: "", amountText: "", deductionType: "", note: "", dueDate: "", billingId: "", inCost: "" };

/** 입금 등록 창의 ‘발주처가 떼고 준 돈’ 칸 — 보낼 값(없으면 undefined) */
export function withheldArgs(w: WithheldValue) {
  if (!w.kind) return undefined;
  return {
    kind: w.kind,
    amount: Number(digits(w.amountText)),
    note: w.note,
    ...(w.kind === "deduction" ? { deductionType: (w.deductionType || undefined) as DeductionType | undefined } : {}),
    ...(w.kind === "retention" && w.dueDate ? { dueDate: w.dueDate } : {}),
    ...(w.billingId ? { billingId: w.billingId } : {}),
  };
}

/** 저장 전에 막을 것 (상계인데 원가에 이미 넣은 돈) */
export function withheldBlocked(w: WithheldValue): boolean {
  return w.kind === "deduction" && w.deductionType === "setoff" && w.inCost !== "no";
}

/** 지체상금(부가세 없음)만큼을 빼고 통장 금액을 부가세 제외로 — 통장 = 1.1 × 입금 + 0.1 × 지체상금 */
export function vatExcluded(bank: number, w: WithheldValue): number {
  return vatExcludedPayment(bank, w.kind === "deduction" && w.deductionType === "delay_penalty" ? Number(digits(w.amountText)) : 0);
}

/** 준공일에서 N개월 뒤 (말일 넘김 방지) */
function monthsAfter(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export function WithheldFields({ db, siteId, value, onChange, pay, errors, standalone }: { db: DemoDB; siteId: string; value: WithheldValue; onChange: (v: WithheldValue) => void; pay: number; errors?: Record<string, string>; standalone?: boolean }) {
  const set = (p: Partial<WithheldValue>) => onChange({ ...value, ...p });
  const amt = Number(digits(value.amountText));
  const f = siteFinancials(db, siteId);
  const outstanding = f.outstanding;
  const after = outstanding - pay - (value.kind === "deduction" ? amt : 0);
  // 유보금 몫을 뺀 미수보다 많이 떼면 저장에서 막힌다 — 미리 보여 준다 (D-89 사용성 점검)
  const over = value.kind && amt > 0 && amt > outstanding - pay - f.retention;
  const endDate = db.sites.find((x) => x.id === siteId)?.endDate;
  const bills = db.billings.filter((b) => b.siteId === siteId && b.status === "confirmed").sort((a, b) => b.billedDate.localeCompare(a.billedDate));
  // 같은 금액의 유보금·공제가 이미 있으면 (입금 취소 뒤 다시 넣을 때 두 번 잡히던 문제)
  const same = value.kind && amt > 0 ? (db.receivableAdjustments ?? []).find((a) => !a.voidedAt && a.siteId === siteId && a.kind === value.kind && a.amount === amt) : undefined;
  const choices = (
    [
      ["", "없음"],
      ["retention", "유보금 (나중에 받음)"],
      ["deduction", "공제 (받지 못함)"],
    ] as const
  ).filter(([k]) => !standalone || k);
  return (
    <fieldset className="space-y-2.5 rounded-xl border border-line px-3.5 py-3" data-testid="pay-withheld">
      <legend className="px-1 text-[0.84rem] font-semibold">{standalone ? "무엇을 등록하나요?" : "발주처가 이번에 떼고 준 돈이 있나요?"}</legend>
      <div className="flex flex-wrap gap-1.5">
        {choices.map(([k, label]) => (
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
              <select id="pay-withheld-type" className={inputCls} value={value.deductionType} onChange={(e) => set({ deductionType: e.target.value as DeductionType, inCost: "" })} data-testid="pay-withheld-type">
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
          {value.kind === "deduction" && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[0.78rem] text-ink-2" data-testid="pay-withheld-not">
              <b>공제가 아닌 것</b> — 선급금 정산(선급금으로 이미 받은 돈)·직불(발주처가 하도급사에 바로 준 돈)은 받은 돈이라 <b>입금</b>으로 넣습니다(통장 금액 + 그 금액). 공제로 넣으면 예상이익이 잘못 줄어듭니다.
              {value.deductionType === "delay_penalty" && <span className="block pt-1">지체상금은 실제로 뗀 금액 그대로 적습니다(부가세가 붙지 않음).</span>}
              {(value.deductionType === "setoff" || value.deductionType === "other") && <span className="block pt-1">부가세를 뺀 금액으로 적습니다.</span>}
            </p>
          )}
          {value.kind === "deduction" && value.deductionType === "setoff" && (
            <fieldset className="space-y-1.5" data-testid="pay-withheld-incost">
              <legend className="text-[0.82rem] font-semibold">이 자재·비용을 원가(비용 입력)에 이미 넣었나요?</legend>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["no", "아니오 — 공제로 넣기"],
                    ["yes", "예, 이미 넣음"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className={cx("cursor-pointer rounded-lg border px-3 py-1.5 text-[0.82rem] font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-active/40", value.inCost === k ? "border-active bg-active-soft text-theme-ink" : "border-line")}>
                    <input type="radio" name="pay-withheld-incost" className="sr-only" checked={value.inCost === k} onChange={() => set({ inCost: k })} data-testid={`pay-withheld-incost-${k}`} />
                    {label}
                  </label>
                ))}
              </div>
              {value.inCost === "yes" && (
                <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.8rem] font-semibold text-ink" data-testid="pay-withheld-incost-msg">
                  원가에 이미 있는 돈을 공제로도 넣으면 예상이익이 두 번 줄어듭니다. 공제가 아니라 그 금액을 <b>입금에 더해</b> 넣으세요(발주처가 자재값을 기성에서 받아 간 것 = 우리가 자재값을 낸 것).
                </p>
              )}
            </fieldset>
          )}
          <Field
            label={value.kind === "retention" ? "유보금 (원)" : "공제 금액 (원)"}
            htmlFor="pay-withheld-amount"
            required
            error={errors?.withheldAmount}
            hint={amt && !over ? `= ${fmtMan(amt)} · 등록하면 미수금 ${fmtMan(outstanding)} → ${fmtMan(after)}${value.kind === "retention" ? ` (그중 유보금 ${fmtMan(f.retention + amt)})` : ""}` : undefined}
          >
            <input id="pay-withheld-amount" inputMode="numeric" className={cx(inputCls, "num text-right")} value={value.amountText} onChange={(e) => set({ amountText: commas(e.target.value) })} data-testid="pay-withheld-amount" />
          </Field>
          {over && !errors?.withheldAmount && (
            <p className="text-[0.8rem] font-semibold text-err" data-testid="pay-withheld-over">
              = {fmtMan(amt)} — {pay ? "입금과 합치면 " : ""}미수금 {fmtMan(outstanding)}
              {f.retention ? `(그중 이미 받을 유보금 ${fmtMan(f.retention)})` : ""}보다 많습니다. 금액 단위나 부가세 환산을 확인하세요.
            </p>
          )}
          {same && (
            <p className="rounded-lg bg-warn-bg px-3 py-2 text-[0.8rem] font-semibold text-ink" data-testid="pay-withheld-same">
              같은 금액의 {adjustmentLabel(same)} 기록이 이미 있습니다 ({fmtDate(same.date)}{same.note ? ` · ${same.note}` : ""}). 같은 것이면 다시 넣지 마세요.
            </p>
          )}
          {bills.length > 0 && (
            <Field label="어느 기성에서 뗐나요 (선택)" htmlFor="pay-withheld-bill" hint={value.kind === "retention" ? "고르면 엑셀·‘오래된 미수’에서 그 회차의 유보금으로 봅니다" : undefined}>
              <select id="pay-withheld-bill" className={inputCls} value={value.billingId} onChange={(e) => set({ billingId: e.target.value })} data-testid="pay-withheld-bill">
                <option value="">고르지 않음</option>
                {bills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.round}차 {fmtDate(b.billedDate)} {fmtMan(b.amount)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {value.kind === "retention" && (
            <Field label="받을 예정일" htmlFor="pay-withheld-due" error={errors?.dueDate}>
              <div className="flex flex-wrap items-center gap-1.5">
                <input id="pay-withheld-due" type="date" className={cx(inputCls, "w-auto")} value={value.dueDate} onChange={(e) => set({ dueDate: e.target.value })} data-testid="pay-withheld-due" />
                {endDate &&
                  ([6, 12, 24] as const).map((n) => (
                    <button key={n} type="button" className="press rounded-lg border border-line px-2.5 py-1.5 text-[0.78rem] font-semibold hover:bg-surface-2" onClick={() => set({ dueDate: monthsAfter(endDate, n) })} data-testid={`pay-withheld-due-${n}`}>
                      준공 후 {n < 12 ? `${n}개월` : `${n / 12}년`}
                    </button>
                  ))}
              </div>
              <p className={cx("mt-1 text-[0.76rem]", value.dueDate ? "text-ink-3" : "font-semibold text-warn")} data-testid="pay-withheld-due-hint">
                {value.dueDate
                  ? "이 날까지는 ‘오래된 미수’ 알림에서 빼고, 지나면 다시 알립니다."
                  : `비워 두면 받을 때까지 ‘오래된 미수’ 알림에서 계속 빠집니다${endDate ? ` — 준공(${fmtDate(endDate)}) 뒤 받기로 했으면 위 버튼으로 날짜를 넣으세요` : ""}.`}
              </p>
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
                    <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={() => setVoiding(a)} data-testid="withheld-void">
                      {(a.released ?? []).length ? "남은 금액 정리" : "취소"}
                    </Button>
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
  const [key] = useState(() => uid("idem"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; fields?: Record<string, string> } | null>(null);
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
          <Button onClick={onClose}>닫기</Button>
          <Button
            variant="cta"
            loading={busy}
            disabled={!w.kind || withheldBlocked(w)}
            onClick={async () => {
              const a = withheldArgs(w);
              if (!a) return;
              setBusy(true);
              try {
                await run("addReceivableAdjustment", { siteId, date, ...a, idempotencyKey: key });
                toast.push({ tone: "ok", title: `${a.kind === "retention" ? "유보금을" : "공제를"} 등록했습니다`, desc: a.kind === "deduction" ? "미수금과 예상이익에서 빠지고 ‘이익을 바꾼 일’에 남았습니다" : "미수금에 남고 ‘오래된 미수’ 알림에서는 빠집니다" });
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
          <select id="wh-site" className={inputCls} value={siteId} onChange={(e) => (setSiteId(e.target.value), setW((v) => ({ ...v, billingId: "" })))} data-testid="withheld-site">
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
        {siteId && <WithheldFields db={db} siteId={siteId} value={w} onChange={setW} pay={0} errors={err?.fields?.withheldAmount && err ? { ...err.fields, withheldAmount: err.msg } : err?.fields} standalone />}
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
          <Button onClick={onClose}>닫기</Button>
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
        <p className="text-[0.78rem] text-ink-3">발주처가 유보금에서 지체상금 등을 떼고 줬으면 받은 만큼만 등록한 뒤, 이 유보금의 ‘남은 금액 정리’를 누르고 뗀 금액을 공제로 등록하세요.</p>
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
      title={a.kind === "retention" && (a.released ?? []).length ? "남은 유보금 정리" : `${a.kind === "retention" ? "유보금" : "공제"} 취소`}
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
        {a.kind === "retention" && (a.released ?? []).length > 0 && <p>이미 받은 {fmtMan((a.released ?? []).reduce((s, r) => s + r.amount, 0))}은 입금으로 그대로 남고, 남은 {fmtMan(retentionLeft(a))}은 일반 미수가 됩니다(오래된 미수 알림에 다시 셈). 발주처가 뗀 것이면 이어서 공제로 등록하세요.</p>}
        <ClosedMonthHint db={db} date={a.date} action="취소하면" what={a.kind === "retention" ? "유보금" : "공제"} />
        <Field label="취소하는 이유" htmlFor="wh-void-reason" required error={err?.fields?.reason} counter={`${Array.from(reason).length}/200`}>
          <input id="wh-void-reason" className={inputCls} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="예: 발주처가 지체상금을 면제함" data-testid="withheld-void-reason" />
        </Field>
        {err && !err.fields?.reason && <Notice tone="err">{err.msg}</Notice>}
      </div>
    </Modal>
  );
}
