/**
 * 변경공사 회수 관리 명령 (D-84) — 본사만(권한은 server/authz).
 * - createChangeOrder: 추가 원가를 근거로(또는 근거 없이) 변경공사 청구 검토 건을 만든다. 반려된 건 다시 청구도 이것으로.
 * - logChangeOrder: 발주처 확인·독촉·답변·메모를 날짜와 함께 남기고 다음 확인할 날을 정한다.
 * 상태 바꾸기(발주처 청구·승인·반려)는 commands.setChangeOrderStatus (사유·다음 확인할 날 포함).
 */
import type { ChangeOrder, DemoDB } from "@/lib/domain/types";
import { coByEntry, coOpen, followUpError, pushCoLog } from "@/lib/domain/changeOrders";
import { fmtMan, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { CommandError, claimKey, clone, log, nowIso, pastCalendarDate, requireSite, tidyName, touch, validateAmount, type Ctx } from "./commands";

const TITLE_MAX = 80;
const NOTE_MAX = 200;
const ENTRY_MAX = 50;

const text = (v: unknown, max = 1000) => (typeof v === "string" ? tidyName(v, max) : "");
const len = (s: string) => Array.from(s).length;

export interface CreateChangeOrderInput {
  siteId: string;
  title: string;
  /** 발주처에 청구할 금액 (원) — 견적 기준. 근거 원가보다 큰 것이 보통 */
  amount: number;
  /** 근거가 되는 추가 원가 (같은 현장 · 확정된 추가 원가 · 진행 중·승인된 변경공사에 아직 안 묶인 것) */
  entryIds?: string[];
  note?: string;
  /** 반려된 변경공사를 다시 청구 — 근거 원가를 비우면 그 건의 원가를 그대로 쓴다 */
  reclaimOf?: string;
  idempotencyKey?: string;
}

export function createChangeOrder(db0: DemoDB, input: CreateChangeOrderInput, ctx: Ctx) {
  const site = requireSite(db0, input.siteId);
  const errors: Record<string, string> = {};
  const title = text(input.title);
  if (len(title) < 2) errors.title = "무슨 공사인지 2자 이상 적어 주세요.";
  else if (len(title) > TITLE_MAX) errors.title = `${TITLE_MAX}자 이내`;
  const note = text(input.note);
  if (len(note) > NOTE_MAX) errors.note = `${NOTE_MAX}자 이내`;
  if (input.entryIds !== undefined && (!Array.isArray(input.entryIds) || input.entryIds.some((x) => typeof x !== "string"))) errors.entryIds = "근거 원가 형식을 확인해 주세요.";
  else if ((input.entryIds?.length ?? 0) > ENTRY_MAX) errors.entryIds = `근거 원가는 ${ENTRY_MAX}건까지`;
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const amount = validateAmount(input.amount, "amount");

  // 다시 청구 — 반려된 같은 현장 건, 한 번만
  let prev: ChangeOrder | undefined;
  if (input.reclaimOf !== undefined) {
    prev = db0.changeOrders.find((c) => c.id === input.reclaimOf);
    if (!prev || prev.siteId !== site.id) throw new CommandError("다시 청구할 변경공사를 찾을 수 없습니다.", "NOT_FOUND");
    if (prev.status !== "rejected") throw new CommandError("반려된 변경공사만 다시 청구할 수 있습니다.", "STATE");
    if (db0.changeOrders.some((c) => c.reclaimOf === prev!.id)) throw new CommandError("이미 다시 청구한 변경공사입니다.", "DUPLICATE");
  }
  const ids = [...new Set(input.entryIds?.length ? input.entryIds : (prev?.sourceEntryIds ?? []))];
  const claimed = coByEntry(db0);
  for (const id of ids) {
    const e = db0.costEntries.find((x) => x.id === id);
    if (!e || e.siteId !== site.id) throw new CommandError("근거 원가를 찾을 수 없습니다 (같은 현장의 원가만).", "VALIDATION", { entryIds: "다른 현장·없는 원가" });
    if (e.status !== "active") throw new CommandError("확정된 원가만 근거로 쓸 수 있습니다 (확인 대기·취소·반려 원가 제외).", "VALIDATION", { entryIds: "확정 원가만" });
    if (e.forecastImpact !== "additional") throw new CommandError("‘추가 원가’로 들어온 원가만 근거로 쓸 수 있습니다.", "VALIDATION", { entryIds: "추가 원가만" });
    const other = claimed.get(id);
    if (other) throw new CommandError(`이미 다른 변경공사(‘${other.title}’)의 근거입니다 — 두 번 청구하지 않게 막았습니다.`, "DUPLICATE", { entryIds: "이미 청구함" });
  }

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const sum = ids.reduce((a, id) => a + (db.costEntries.find((e) => e.id === id)?.amount ?? 0), 0);
  const co: ChangeOrder = {
    id: uid("co"),
    siteId: site.id,
    title,
    amount,
    status: "review",
    requestedAt: at,
    sourceEntryIds: ids,
    note,
    createdBy: ctx.userId,
    ...(prev ? { reclaimOf: prev.id } : {}),
  };
  pushCoLog(co, { at, by: ctx.userId, date: todayIso(ctx.now), kind: "created", note: prev ? `반려된 ‘${prev.title}’ 다시 청구${note ? ` — ${note}` : ""}` : note || (ids.length ? `추가 원가 ${ids.length}건 ${fmtMan(sum)} 근거` : "근거 원가 없이 등록") });
  db.changeOrders.push(co);
  log(db, ctx, "change_order", `${site.shortName} 변경공사 ${prev ? "다시 청구" : "청구 검토 등록"} ${fmtMan(amount)}: ${title}${ids.length ? ` (근거 추가 원가 ${ids.length}건 ${fmtMan(sum)})` : ""}`, site.id, `/finance#co-${co.id}`);
  touch(db, ctx);
  return { db, result: { id: co.id } };
}

export interface LogChangeOrderInput {
  coId: string;
  kind: "follow_up" | "client_reply" | "note";
  /** 일어난 날 (YYYY-MM-DD) — 오늘 이전, 등록한 날 이후 */
  date: string;
  note: string;
  /** 다음 확인할 날 — 없음: 그대로 · null: 지움 · 날짜: 바꿈 (진행 중인 건만) */
  nextFollowUp?: string | null;
  idempotencyKey?: string;
}

const LOG_KINDS = new Set(["follow_up", "client_reply", "note"]);

export function logChangeOrder(db0: DemoDB, input: LogChangeOrderInput, ctx: Ctx) {
  const c0 = db0.changeOrders.find((c) => c.id === input.coId);
  if (!c0) throw new CommandError("변경공사를 찾을 수 없습니다.", "NOT_FOUND");
  const errors: Record<string, string> = {};
  if (!LOG_KINDS.has(input.kind as string)) errors.kind = "무슨 기록인지 골라 주세요.";
  const note = text(input.note);
  if (len(note) < 2) errors.note = "내용을 2자 이상 적어 주세요 (예: 담당 과장 통화 — 다음 주 검토 회의).";
  else if (len(note) > NOTE_MAX) errors.note = `${NOTE_MAX}자 이내`;
  const requested = new Date(new Date(c0.requestedAt).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  if (!pastCalendarDate(input.date, ctx)) errors.date = "오늘이나 지난 날짜로 적어 주세요.";
  else if (input.date < requested) errors.date = "변경공사를 등록한 날 이후로 적어 주세요.";
  if (input.nextFollowUp !== undefined && !coOpen(c0)) errors.nextFollowUp = "결정된 변경공사에는 다음 확인할 날을 정하지 않습니다.";
  else {
    const fe = followUpError(input.nextFollowUp, todayIso(ctx.now));
    if (fe) errors.nextFollowUp = fe;
  }
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const co = db.changeOrders.find((c) => c.id === input.coId)!;
  pushCoLog(co, { at: nowIso(ctx), by: ctx.userId, date: input.date, kind: input.kind, note });
  if (input.nextFollowUp === null) delete co.nextFollowUp;
  else if (typeof input.nextFollowUp === "string") co.nextFollowUp = input.nextFollowUp;
  const site = db.sites.find((s) => s.id === co.siteId);
  log(db, ctx, "change_order", `${site?.shortName ?? ""} 변경공사 기록 — ${co.title}`, co.siteId, `/finance#co-${co.id}`);
  touch(db, ctx);
  return { db, result: { id: co.id } };
}
