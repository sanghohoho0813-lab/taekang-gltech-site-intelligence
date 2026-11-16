/**
 * 월 마감 기록 명령 (D-82) — 본사만. 대표 확인은 대표만(authz CEO_ONLY).
 * 데이터를 잠그지 않는다 — 마감 뒤 그 달 날짜로 들어온 것은 ‘마감 뒤 바뀐 것’으로 보여 준다 (잠글지는 대표 결정 D-78).
 */
import type { DemoDB, MonthCloseRecord } from "@/lib/domain/types";
import { monthBounds, monthClose } from "@/lib/domain/monthClose";
import { changeLines, changesAfterClose, closeSnapshot, currentClose } from "@/lib/domain/closeRecord";
import { fmtDate, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { CommandError, claimKey, clone, log, nowIso, tidyName, touch, userName, type Ctx } from "./commands";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const isMonth = (m: unknown): m is string => typeof m === "string" && MONTH.test(m);
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
/** 다시 연 기록은 달마다 최근 10개만 (다른 달의 유효한 마감을 지우지 않게 · D-82 점검) */
const KEEP_REOPENED_PER_MONTH = 10;
/** 메모 — 폭 없는 문자를 빼고 공백을 정리 (빈칸만 있는 이유가 통과하던 문제 · D-82 점검) */
const tidyNote = (v: unknown) => (typeof v === "string" ? tidyName(v, 1000) : "");

export interface CloseMonthInput {
  month: string;
  note?: string;
  /** ‘닫기 전에 볼 것’이 남아 있어도 알고 마감한다 — 본 건수를 보낸다 (그 사이 늘었으면 다시 보게) */
  ackOpen?: number;
  idempotencyKey?: string;
}

export function closeMonth(db0: DemoDB, input: CloseMonthInput, ctx: Ctx) {
  if (input.idempotencyKey && db0.idempotencyKeys.includes(input.idempotencyKey)) throw new CommandError("이미 저장된 요청입니다. (중복 저장 방지)", "DUPLICATE");
  const today = todayIso(ctx.now);
  if (!isMonth(input?.month)) throw new CommandError("달을 확인해 주세요.", "VALIDATION", { month: "YYYY-MM" });
  if (monthBounds(input.month).to >= today) throw new CommandError("달이 끝난 뒤에 마감할 수 있습니다.", "VALIDATION", { month: "진행 중" });
  const note = tidyNote(input.note);
  if (note.length > 300) throw new CommandError("메모는 300자까지예요.", "VALIDATION", { note: "300자" });
  const cur = currentClose(db0, input.month);
  if (cur) throw new CommandError(`${monthLabel(input.month)}은 이미 마감했습니다 (${fmtDate(cur.closedAt)} ${userName(db0, cur.closedBy)}). 고치려면 다시 연 뒤 마감하세요.`, "STATE");
  const report = monthClose(db0, input.month, today);
  if (!report.money.length && !report.people.length) throw new CommandError(`${monthLabel(input.month)}에 일한 현장이 없어 마감할 것이 없습니다.`, "STATE");
  // 남은 일을 알고 닫는다 — 왜 남기는지 적게 한다 (다음 달에 무엇을 이어서 볼지)
  if (report.items.length && input.ackOpen !== report.items.length)
    throw new CommandError(
      typeof input.ackOpen === "number" && input.ackOpen > 0 ? `그 사이 남은 일이 ${report.items.length}건으로 바뀌었습니다. 다시 보고 마감해 주세요.` : `닫기 전에 볼 것 ${report.items.length}건이 남아 있습니다. 그대로 마감하려면 확인하고 남기는 이유를 적어 주세요.`,
      "VALIDATION",
      { ackOpen: `${report.items.length}건 남음` },
    );
  if (report.items.length && note.length < 2) throw new CommandError("남기는 이유를 적어 주세요 (예: 변경공사 대표 결정 대기 · 청구서 오면 11월에 반영).", "VALIDATION", { note: "남기는 이유" });
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const rec: MonthCloseRecord = { id: uid("mcl"), month: input.month, closedAt: nowIso(ctx), closedBy: ctx.userId, ...(note ? { note } : {}), snapshot: closeSnapshot(db0, report) };
  db.monthCloses = [rec, ...(db.monthCloses ?? [])];
  log(db, ctx, "month_close", `${monthLabel(input.month)} 마감${report.items.length ? ` (남긴 일 ${report.items.length}건${note ? ` — ${note}` : ""})` : ""} · 대표 확인 대기`, undefined, `/close?month=${input.month}`);
  touch(db, ctx);
  return { db, result: { id: rec.id, openItems: report.items.length } };
}

export interface ConfirmMonthCloseInput {
  month: string;
  note?: string;
  /** 마감 뒤(또는 지난 확인 뒤) 바뀐 것을 보고 확인한다 — 본 건수를 보낸다 (그 사이 늘었으면 다시 보게) */
  ackChanges?: number;
}

export function confirmMonthClose(db0: DemoDB, input: ConfirmMonthCloseInput, ctx: Ctx) {
  if (!isMonth(input?.month)) throw new CommandError("달을 확인해 주세요.", "VALIDATION", { month: "YYYY-MM" });
  const cur = currentClose(db0, input.month);
  if (!cur) throw new CommandError(`${monthLabel(input.month)}은 아직 마감하지 않았습니다. 공무가 마감한 뒤 확인할 수 있습니다.`, "STATE");
  const today = todayIso(ctx.now);
  const changes = changesAfterClose(db0, cur, today);
  // 이미 확인했으면 — 그 뒤 바뀐 것이 있을 때만 ‘바뀐 것 보고 확인’ (다시 열고 닫지 않아도 되게 · D-82 공무·대표 점검)
  if (cur.confirmedAt && changes.count === 0) throw new CommandError(`${monthLabel(input.month)} 마감은 이미 확인했습니다 (${fmtDate(cur.confirmedAt)}) — 그 뒤 바뀐 것이 없습니다.`, "STATE");
  const note = tidyNote(input.note);
  if (note.length > 300) throw new CommandError("메모는 300자까지예요.", "VALIDATION", { note: "300자" });
  if (changes.count > 0 && input.ackChanges !== changes.count)
    throw new CommandError(
      typeof input.ackChanges === "number" && input.ackChanges > 0 ? `그 사이 바뀐 것이 ${changes.count}건으로 늘었습니다. 다시 보고 확인해 주세요.` : `${cur.confirmedAt ? "확인" : "마감"} 뒤 바뀐 것이 ${changes.count}건 있습니다. 보고 확인하거나, 공무에게 다시 열어 마감하라고 하세요.`,
      "VALIDATION",
      { ackChanges: `${changes.count}건` },
    );
  const db = clone(db0);
  const rec = currentClose(db, input.month)!;
  const at = nowIso(ctx);
  const again = !!rec.confirmedAt;
  rec.confirmedAt = at;
  rec.confirmedBy = ctx.userId;
  rec.confirmNote = note || undefined;
  if (!rec.confirmNote) delete rec.confirmNote;
  rec.confirmations = [...(rec.confirmations ?? []), { at, by: ctx.userId, ...(note ? { note } : {}), changes: changeLines(changes).slice(0, 30) }];
  // 확인할 때 숫자 — 이 뒤로는 이것과 비교한다. 마감 때 지문은 더 쓰지 않으니 비워 기록을 가볍게
  rec.confirmSnapshot = closeSnapshot(db0, monthClose(db0, input.month, today));
  rec.snapshot = { ...rec.snapshot, keys: { costs: [], billings: [], payments: [] } };
  log(db, ctx, "month_close", `${monthLabel(input.month)} 마감 대표 ${again ? "다시 확인" : "확인"}${changes.count ? ` (바뀐 것 ${changes.count}건 보고 확인)` : ""}${note ? ` — ${note}` : ""}`, undefined, `/close?month=${input.month}`);
  touch(db, ctx);
  return { db, result: { id: rec.id, changes: changes.count } };
}

export interface ReopenMonthCloseInput {
  month: string;
  reason: string;
}

export function reopenMonthClose(db0: DemoDB, input: ReopenMonthCloseInput, ctx: Ctx) {
  if (!isMonth(input?.month)) throw new CommandError("달을 확인해 주세요.", "VALIDATION", { month: "YYYY-MM" });
  const cur = currentClose(db0, input.month);
  if (!cur) throw new CommandError(`${monthLabel(input.month)}은 마감한 기록이 없습니다.`, "STATE");
  const reason = tidyNote(input.reason);
  if (reason.length < 2) throw new CommandError("다시 여는 이유를 적어 주세요.", "VALIDATION", { reason: "필수" });
  if (reason.length > 300) throw new CommandError("이유는 300자까지예요.", "VALIDATION", { reason: "300자" });
  // 대표가 확인한 마감은 대표만 다시 연다 (확인한 숫자가 모르게 바뀌지 않게)
  const role = db0.users.find((u) => u.id === ctx.userId)?.role;
  if (cur.confirmedAt && role !== "ceo") throw new CommandError("대표가 확인한 마감은 대표만 다시 열 수 있습니다.", "STATE");
  const db = clone(db0);
  const rec = currentClose(db, input.month)!;
  rec.reopenedAt = nowIso(ctx);
  rec.reopenedBy = ctx.userId;
  rec.reopenReason = reason;
  // 다시 연 기록은 비교에 쓰지 않으니 지문을 비우고, 그 달의 다시 연 기록은 최근 10개만
  const empty = { costs: [], billings: [], payments: [] };
  rec.snapshot = { ...rec.snapshot, keys: empty };
  if (rec.confirmSnapshot) rec.confirmSnapshot = { ...rec.confirmSnapshot, keys: empty };
  const old = (db.monthCloses ?? []).filter((r) => r.month === input.month && r.reopenedAt).sort((a, b) => b.closedAt.localeCompare(a.closedAt)).slice(KEEP_REOPENED_PER_MONTH);
  if (old.length) db.monthCloses = (db.monthCloses ?? []).filter((r) => !old.includes(r));
  log(db, ctx, "month_close", `${monthLabel(input.month)} 마감 다시 엶 — ${reason}`, undefined, `/close?month=${input.month}`);
  touch(db, ctx);
  return { db, result: { id: rec.id } };
}
