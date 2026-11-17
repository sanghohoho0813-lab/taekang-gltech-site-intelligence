/**
 * 돈 기록 바로잡기 (D-89) — 본사만(권한은 server/authz).
 * - voidMoneyRecord: 잘못 넣은 기성·입금 취소 (이유 필수). 숫자에서 빠지고 ‘취소한 기성·입금’에 그대로 남는다.
 *   입금과 함께 넣은 유보금·공제도 같이 취소할 수 있다(withLinked · 화면 기본값) — 다시 넣으면 두 번 잡히던 문제 (D-89 사용성 점검)
 * - addPayment: 입금 등록 + (선택) 발주처가 떼고 준 금액 — 유보금(나중에 받음) 또는 공제(지체상금·상계 · 받지 못함)를 한 번에
 * - addReceivableAdjustment: 유보금·공제만 따로 (입금 없이 공문으로 받은 지체상금 등)
 * - voidReceivableAdjustment: 유보금·공제 취소 (이유 필수 · 받은 기록이 있는 유보금은 그 입금을 먼저 취소)
 * - releaseRetention: 유보금 받음 → 입금을 만든다 (나눠 받을 수 있음)
 * 공제는 예상이익을 줄이므로 registry에서 reconcileProfit로 감싸 ‘이익을 바꾼 일’에 남긴다(그 시각).
 */
import type { DeductionType, DemoDB, PaymentReceived, ReceivableAdjustment } from "@/lib/domain/types";
import { siteFinancials } from "@/lib/domain/calc";
import { fmtMan } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { DEDUCTION_LABEL, adjustmentLabel, deductedTotal, retentionLeft, retentionOpen } from "@/lib/domain/receivables";
import { CommandError, claimKey, clone, log, nowIso, pastCalendarDate, requireSite, tidyName, touch, validateAmount, type Ctx } from "./commands";
import { renumberRounds } from "./importCommands";

const NOTE_MAX = 200;
const text = (v: unknown, max = 1000) => (typeof v === "string" ? tidyName(v, max) : "");
const len = (s: string) => Array.from(s).length;
const DEDUCTION_TYPES = new Set<DeductionType>(["delay_penalty", "setoff", "other"]);

function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function reasonOf(v: unknown): string {
  const r = text(v);
  if (len(r) < 2) throw new CommandError("취소하는 이유를 적어 주세요 (예: 금액 단위 잘못 넣음).", "VALIDATION", { reason: "이유 필수" });
  if (len(r) > NOTE_MAX) throw new CommandError(`${NOTE_MAX}자 이내`, "VALIDATION", { reason: `${NOTE_MAX}자 이내` });
  return r;
}

/** 그날까지의 미수 (기성 − 입금 − 공제 · 뗀 날 기준) */
function arAt(db: DemoDB, siteId: string, day: string): number {
  return (
    db.billings.filter((b) => b.siteId === siteId && b.status === "confirmed" && b.billedDate <= day).reduce((a, b) => a + b.amount, 0) -
    db.payments.filter((p) => p.siteId === siteId && p.receivedDate <= day).reduce((a, p) => a + p.amount, 0) -
    deductedTotal(db, siteId, day)
  );
}

/** 같은 요청을 다시 보낸 것 — 검사보다 먼저 */
function alreadySaved(db0: DemoDB, key: string | undefined) {
  if (key && db0.idempotencyKeys.includes(key)) throw new CommandError("이미 저장된 요청입니다. (중복 저장 방지)", "DUPLICATE");
}

// ───────────── 기성·입금 취소 ─────────────

export interface VoidMoneyInput {
  kind: "billing" | "payment";
  id: string;
  reason: string;
  /** 입금 취소: 이 입금과 함께 넣은 유보금·공제도 같이 취소 */
  withLinked?: boolean;
  idempotencyKey?: string;
}

export function voidMoneyRecord(db0: DemoDB, input: VoidMoneyInput, ctx: Ctx) {
  alreadySaved(db0, input?.idempotencyKey);
  const kind = input?.kind;
  if (kind !== "billing" && kind !== "payment") throw new CommandError("무엇을 취소할지 확인해 주세요.", "VALIDATION");
  const rec = kind === "billing" ? db0.billings.find((b) => b.id === input.id) : db0.payments.find((p) => p.id === input.id);
  if (!rec) throw new CommandError(`${kind === "billing" ? "기성" : "입금"} 기록을 찾을 수 없습니다 (이미 취소했을 수 있습니다).`, "NOT_FOUND");
  const reason = reasonOf(input.reason);
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const site = requireSite(db, rec.siteId);
  const renumbered: string[] = [];
  const linked: string[] = [];
  if (kind === "billing") {
    db.billings = db.billings.filter((b) => b.id !== rec.id);
    // 기성을 빼면 입금·공제가 기성보다 많아지는지 — 그러면 입금(또는 공제)을 먼저 정리
    const f = siteFinancials(db, rec.siteId);
    if (f.outstanding < 0) throw new CommandError(`이 기성을 취소하면 입금·공제(${fmtMan(f.received + f.deducted)})가 기성(${fmtMan(f.billed)})보다 많아집니다 — 관련 입금을 먼저 취소해 주세요.`, "STATE");
    // 유보금은 미수 안의 돈 — 미수보다 커지면 받을 수도 정리할 수도 없게 된다 (D-89 점검)
    const held = retentionOpen(db, rec.siteId);
    if (held > f.outstanding) throw new CommandError(`이 기성을 취소하면 남은 미수(${fmtMan(f.outstanding)})가 받을 유보금(${fmtMan(held)})보다 작아집니다 — 유보금을 먼저 정리해 주세요.`, "STATE");
    // 회차를 날짜 순서로 다시 매긴다 — 바뀐 회차는 기록에 남긴다 (마감한 달 엑셀의 회차와 달라질 수 있어서 · D-89 사용성 점검)
    const before = new Map(db.billings.filter((b) => b.siteId === rec.siteId).map((b) => [b.id, b.round]));
    renumberRounds(db, [rec.siteId]);
    for (const b of db.billings.filter((x) => x.siteId === rec.siteId).sort((x, y) => x.billedDate.localeCompare(y.billedDate))) {
      const was = before.get(b.id);
      if (was && was !== b.round) renumbered.push(`${Number(b.billedDate.slice(5, 7))}/${Number(b.billedDate.slice(8, 10))} ${was}차→${b.round}차`);
    }
  } else {
    db.payments = db.payments.filter((p) => p.id !== rec.id);
    // 유보금을 받은 입금이면 그 유보금이 다시 열린다
    const pay = rec as PaymentReceived;
    if (pay.retentionId) {
      const r = (db.receivableAdjustments ?? []).find((a) => a.id === pay.retentionId);
      if (r) r.released = (r.released ?? []).filter((x) => x.paymentId !== pay.id);
    }
    // 입금과 함께 넣은 유보금·공제 — 같이 취소하면(화면 기본값) 다시 넣을 때 두 번 잡히지 않는다. 안 고르면 그대로 둔다(발주처가 뗀 사실은 맞을 때)
    if (input.withLinked === true) {
      for (const a of (db.receivableAdjustments ?? []).filter((x) => x.paymentId === pay.id && !x.voidedAt)) {
        a.voidedAt = nowIso(ctx);
        a.voidedBy = ctx.userId;
        a.voidReason = `입금 취소와 함께 — ${reason}`;
        linked.push(`${adjustmentLabel(a)} ${fmtMan(a.amount)}`);
      }
    }
  }
  (db.voidedMoney ??= []).push({ id: rec.id, kind, siteId: rec.siteId, record: { ...rec }, voidedAt: nowIso(ctx), voidedBy: ctx.userId, reason });
  const what = kind === "billing" ? `기성 ${(rec as { round?: number }).round ? `${(rec as { round: number }).round}차 ` : ""}${fmtMan(rec.amount)} (${(rec as { billedDate: string }).billedDate})` : `입금 ${fmtMan(rec.amount)} (${(rec as PaymentReceived).receivedDate})`;
  log(db, ctx, kind, `${site.shortName} ${what} 취소 — ${reason}${linked.length ? ` · 함께 취소: ${linked.join(", ")}` : ""}${renumbered.length ? ` · 회차 다시 매김: ${renumbered.join(", ")}` : ""}`, rec.siteId, "/finance");
  touch(db, ctx);
  return { db, result: { id: rec.id, renumbered, linked } };
}

// ───────────── 유보금·공제 ─────────────

export interface AdjustmentInput {
  siteId: string;
  kind: "retention" | "deduction";
  deductionType?: DeductionType;
  amount: number;
  /** 발주처가 떼고 준 날 */
  date: string;
  note?: string;
  billingId?: string;
  /** 유보금 받을 예정일 (선택) */
  dueDate?: string;
  idempotencyKey?: string;
}

/** 검사하고 기록을 만든다 (db는 이미 복사본) */
function pushAdjustment(db: DemoDB, input: AdjustmentInput, ctx: Ctx, paymentId?: string): ReceivableAdjustment {
  const errors: Record<string, string> = {};
  if (input.kind !== "retention" && input.kind !== "deduction") errors.kind = "유보금인지 공제인지 골라 주세요.";
  if (input.kind === "deduction" && !DEDUCTION_TYPES.has(input.deductionType as DeductionType)) errors.deductionType = "공제 종류를 골라 주세요.";
  let amount = 0;
  try {
    amount = validateAmount(input.amount, "withheldAmount");
  } catch (e) {
    if (e instanceof CommandError) Object.assign(errors, e.fieldErrors);
    else throw e;
  }
  if (!pastCalendarDate(input.date, ctx)) errors.date = "날짜를 확인해 주세요 (오늘 이후 날짜는 안 됩니다).";
  const note = text(input.note);
  if (input.kind === "deduction" && len(note) < 2) errors.note = "공제 사유를 적어 주세요 (예: 공기 지연 12일 지체상금 — 원청 공문 11/14).";
  else if (len(note) > NOTE_MAX) errors.note = `${NOTE_MAX}자 이내`;
  if (input.billingId !== undefined && input.billingId !== null && input.billingId !== "" && !db.billings.some((b) => b.id === input.billingId && b.siteId === input.siteId)) errors.billingId = "같은 현장의 기성 회차를 골라 주세요.";
  if (input.dueDate !== undefined && input.dueDate !== null && input.dueDate !== "") {
    if (input.kind !== "retention") errors.dueDate = "받을 예정일은 유보금에만 적습니다.";
    else if (!isDate(input.dueDate)) errors.dueDate = "날짜 형식을 확인해 주세요.";
    else if (typeof input.date === "string" && input.dueDate < input.date) errors.dueDate = "뗀 날 이후로 적어 주세요.";
  }
  if (Object.keys(errors).length) throw new CommandError(errors.withheldAmount ?? errors.note ?? "입력값을 확인해주세요.", "VALIDATION", errors);
  // 미수보다 큰 유보·공제는 받을 돈보다 많이 뗀 것 — 단위 실수 · 기성을 먼저 넣어야 함.
  // 이미 잡힌 유보금은 빼고 본다 (유보금에서 떼는 공제면 그 유보금을 먼저 정리 · D-89 점검: 유보금이 미수보다 커져 받을 수 없게 되던 문제)
  const f = siteFinancials(db, input.siteId);
  const held = retentionOpen(db, input.siteId);
  const room = f.outstanding - held;
  if (amount > room)
    throw new CommandError(
      held > 0
        ? `${input.kind === "retention" ? "유보금이" : "공제가"} 유보금이 아닌 미수(${fmtMan(Math.max(0, room))} · 미수 ${fmtMan(f.outstanding)} 중 유보금 ${fmtMan(held)})보다 큽니다 — 유보금에서 떼는 것이면 ‘유보금 · 공제’에서 그 유보금을 먼저 정리해 주세요.`
        : `${input.kind === "retention" ? "유보금이" : "공제가"} 미수금(${fmtMan(f.outstanding)})보다 큽니다 — 기성을 먼저 넣었는지, 금액 단위를 확인해 주세요.`,
      "VALIDATION",
      { withheldAmount: "미수 초과" },
    );
  // 그날까지의 미수로도 본다 — 기성보다 앞선 날짜로 떼면 지난달 월말 미수가 음수가 된다 (D-89 점검)
  if (typeof input.date === "string" && amount > arAt(db, input.siteId, input.date) - retentionOpen(db, input.siteId, input.date))
    throw new CommandError(`${input.date}까지의 미수보다 큽니다 — 날짜(그 기성 뒤인지)를 확인해 주세요.`, "VALIDATION", { date: "기성보다 앞선 날짜" });
  const adj: ReceivableAdjustment = {
    id: uid("radj"),
    siteId: input.siteId,
    kind: input.kind,
    ...(input.kind === "deduction" ? { deductionType: input.deductionType } : {}),
    amount,
    date: input.date,
    note,
    ...(input.billingId ? { billingId: input.billingId } : {}),
    ...(input.kind === "retention" && input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(paymentId ? { paymentId } : {}),
    createdAt: nowIso(ctx),
    createdBy: ctx.userId,
  };
  (db.receivableAdjustments ??= []).push(adj);
  return adj;
}

export function addReceivableAdjustment(db0: DemoDB, input: AdjustmentInput, ctx: Ctx) {
  alreadySaved(db0, input?.idempotencyKey);
  const site = requireSite(db0, input?.siteId);
  const db = clone(db0);
  const adj = pushAdjustment(db, input, ctx);
  claimKey(db, input.idempotencyKey);
  const f = siteFinancials(db, site.id);
  log(db, ctx, "payment", `${site.shortName} ${adjustmentLabel(adj)} ${fmtMan(adj.amount)} (${adj.date})${adj.note ? ` — ${adj.note}` : ""} → 미수금 ${fmtMan(f.outstanding)}`, site.id, "/finance#withheld");
  touch(db, ctx);
  return { db, result: { id: adj.id } };
}

export interface PaymentInput {
  siteId: string;
  amount: number;
  receivedDate: string;
  /** 이번 입금에서 발주처가 뗀 금액 (선택) */
  withheld?: Omit<AdjustmentInput, "siteId" | "date" | "idempotencyKey">;
  idempotencyKey?: string;
}

/** 입금 등록 (+ 발주처가 뗀 금액) — 한 번에 저장(둘 중 하나가 틀리면 아무것도 저장 안 됨) */
export function addPayment(db0: DemoDB, input: PaymentInput, ctx: Ctx) {
  alreadySaved(db0, input?.idempotencyKey);
  const site = requireSite(db0, input?.siteId);
  const f0 = siteFinancials(db0, site.id);
  validateAmount(input.amount);
  if (input.amount > f0.outstanding) throw new CommandError(`수금액이 미수금(${fmtMan(f0.outstanding)})보다 클 수 없습니다.`, "VALIDATION", { amount: "미수금 초과" });
  // 유보금을 받은 것이면 ‘유보금 · 공제’의 ‘받음’으로 — 일반 입금은 유보금을 뺀 미수까지 (D-89 점검)
  if (f0.retention > 0 && input.amount > f0.outstanding - f0.retention)
    throw new CommandError(`입금이 유보금을 뺀 미수(${fmtMan(f0.outstanding - f0.retention)})보다 큽니다 — 유보금(${fmtMan(f0.retention)})을 받은 것이면 아래 ‘유보금 · 공제’에서 ‘받음’으로 넣어 주세요.`, "VALIDATION", { amount: "유보금 포함" });
  if (!pastCalendarDate(input.receivedDate, ctx)) throw new CommandError("입금일을 확인해주세요 (오늘 이후 날짜는 안 됩니다).", "VALIDATION", { receivedDate: "날짜 확인" });
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const pay: PaymentReceived = { id: uid("pay"), siteId: site.id, amount: input.amount, receivedDate: input.receivedDate, createdAt: nowIso(ctx), createdBy: ctx.userId };
  db.payments.push(pay);
  const w = input.withheld;
  const adj = w ? pushAdjustment(db, { ...w, siteId: site.id, date: input.receivedDate }, ctx, pay.id) : undefined;
  const f = siteFinancials(db, site.id);
  log(db, ctx, "payment", `${site.shortName} 입금 ${fmtMan(input.amount)} 등록${adj ? ` · ${adjustmentLabel(adj)} ${fmtMan(adj.amount)}${adj.note ? ` (${adj.note})` : ""}` : ""} → 미수금 ${fmtMan(f0.outstanding)} → ${fmtMan(f.outstanding)}`, site.id, "/finance");
  touch(db, ctx);
  return { db, result: { id: pay.id, ...(adj ? { adjustmentId: adj.id } : {}) } };
}

export function voidReceivableAdjustment(db0: DemoDB, input: { id: string; reason: string; idempotencyKey?: string }, ctx: Ctx) {
  alreadySaved(db0, input?.idempotencyKey);
  const a0 = (db0.receivableAdjustments ?? []).find((a) => a.id === input?.id);
  if (!a0 || a0.voidedAt) throw new CommandError("유보금·공제 기록을 찾을 수 없습니다 (이미 취소했을 수 있습니다).", "NOT_FOUND");
  const reason = reasonOf(input.reason);
  // 나눠 받은 유보금을 취소하면 ‘남은 유보금 정리’ — 받은 입금은 그대로, 남은 금액은 일반 미수로 (유보금에서 지체상금을 뗄 때 등 · D-89 점검)
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const a = db.receivableAdjustments!.find((x) => x.id === a0.id)!;
  a.voidedAt = nowIso(ctx);
  a.voidedBy = ctx.userId;
  a.voidReason = reason;
  const site = requireSite(db, a.siteId);
  log(db, ctx, "payment", `${site.shortName} ${adjustmentLabel(a)} ${fmtMan(a.amount)} (${a.date}) 취소 — ${reason}`, a.siteId, "/finance#withheld");
  touch(db, ctx);
  return { db, result: { id: a.id } };
}

/** 유보금 받음 — 입금을 만든다 (금액을 줄여 나눠 받을 수 있음) */
export function releaseRetention(db0: DemoDB, input: { id: string; date: string; amount: number; idempotencyKey?: string }, ctx: Ctx) {
  alreadySaved(db0, input?.idempotencyKey);
  const a0 = (db0.receivableAdjustments ?? []).find((a) => a.id === input?.id);
  if (!a0 || a0.voidedAt || a0.kind !== "retention") throw new CommandError("유보금 기록을 찾을 수 없습니다.", "NOT_FOUND");
  const left = retentionLeft(a0);
  if (left <= 0) throw new CommandError("이미 다 받은 유보금입니다.", "STATE");
  const amount = validateAmount(input.amount);
  if (amount > left) throw new CommandError(`남은 유보금(${fmtMan(left)})보다 큽니다.`, "VALIDATION", { amount: "유보금 초과" });
  if (!pastCalendarDate(input.date, ctx)) throw new CommandError("받은 날을 확인해 주세요 (오늘 이후 날짜는 안 됩니다).", "VALIDATION", { date: "날짜 확인" });
  if (input.date < a0.date) throw new CommandError("유보금을 뗀 날 이후로 적어 주세요.", "VALIDATION", { date: "뗀 날 이후" });
  const f0 = siteFinancials(db0, a0.siteId);
  if (amount > f0.outstanding) throw new CommandError(`미수금(${fmtMan(f0.outstanding)})보다 큽니다 — 기성·공제를 확인해 주세요.`, "STATE");
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const pay: PaymentReceived = { id: uid("pay"), siteId: a0.siteId, amount, receivedDate: input.date, retentionId: a0.id, createdAt: nowIso(ctx), createdBy: ctx.userId };
  db.payments.push(pay);
  const a = db.receivableAdjustments!.find((x) => x.id === a0.id)!;
  a.released = [...(a.released ?? []), { date: input.date, amount, paymentId: pay.id, at: nowIso(ctx), by: ctx.userId }];
  const site = requireSite(db, a.siteId);
  log(db, ctx, "payment", `${site.shortName} 유보금 받음 ${fmtMan(amount)} (${input.date})${left > amount ? ` · 남은 유보금 ${fmtMan(left - amount)}` : ""} → 입금으로 등록`, a.siteId, "/finance#withheld");
  touch(db, ctx);
  return { db, result: { paymentId: pay.id } };
}

export { DEDUCTION_LABEL };
