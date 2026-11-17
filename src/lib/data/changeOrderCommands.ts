/**
 * 변경공사 회수 관리 명령 (D-84) — 본사만(권한은 server/authz).
 * - createChangeOrder: 추가 원가를 근거로(또는 근거 없이) 변경공사 청구 검토 건을 만든다. 반려된 건 다시 청구도 이것으로.
 * - logChangeOrder: 발주처 확인·독촉·답변·메모를 날짜와 함께 남기고 다음 확인할 날을 정한다.
 * 상태 바꾸기(발주처 청구·승인·반려)는 commands.setChangeOrderStatus (사유·다음 확인할 날 포함).
 * - addChangeOrderEvidence / removeChangeOrderEvidence (D-88): 날인한 변경계약서·공문·견적서를 사진·PDF로 붙이고 지운다 (지울 때는 이유).
 */
import type { ChangeOrder, ChangeOrderEvidence, DemoDB, EvidenceDocType } from "@/lib/domain/types";
import { EVIDENCE_DOC_LABEL, EVIDENCE_MAX_PER_CO, coByEntry, coOpen, followUpError, pushCoLog } from "@/lib/domain/changeOrders";
import { fmtEok, fmtMan, todayIso } from "@/lib/domain/format";
import { siteFinancials } from "@/lib/domain/calc";
import { uid } from "@/lib/domain/ids";
import { CommandError, claimKey, clone, dataUrlBytes, log, nowIso, pastCalendarDate, requireSite, tidyName, touch, validPdf, validPhoto, validateAmount, type Ctx } from "./commands";

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
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") errors.note = "메모 형식을 확인해 주세요.";
  // 금액 오류도 한 번에 (제목·금액이 둘 다 틀리면 두 번 눌러야 하던 문제 · D-84 버그 배시)
  let amount = 0;
  try {
    amount = validateAmount(input.amount, "amount");
    // 계약금액보다 큰 변경공사는 단위 실수일 가능성이 크다 (49.9억 · D-84 버그 배시)
    const f = siteFinancials(db0, site.id);
    if (f.adjustedContract > 0 && amount > f.adjustedContract) errors.amount = `현장 계약금액(${fmtEok(f.adjustedContract)})보다 큰 금액입니다. 금액 단위를 확인해 주세요.`;
  } catch (e) {
    if (e instanceof CommandError) Object.assign(errors, e.fieldErrors);
    else throw e;
  }
  if (Object.keys(errors).length) throw new CommandError(errors.amount && !errors.title ? errors.amount : "입력값을 확인해주세요.", "VALIDATION", errors);

  // 다시 청구 — 반려된 같은 현장 건, 한 번만
  let prev: ChangeOrder | undefined;
  if (input.reclaimOf !== undefined) {
    prev = db0.changeOrders.find((c) => c.id === input.reclaimOf);
    if (!prev || prev.siteId !== site.id) throw new CommandError("다시 청구할 변경공사를 찾을 수 없습니다.", "NOT_FOUND");
    if (prev.status !== "rejected") throw new CommandError("반려된 변경공사만 다시 청구할 수 있습니다.", "STATE");
    if (db0.changeOrders.some((c) => c.reclaimOf === prev!.id)) throw new CommandError("이미 다시 청구한 변경공사입니다.", "DUPLICATE");
  }
  // 다시 청구 때 근거를 비우면 이전 건의 원가 중 아직 살아 있는 추가 원가만 (모두 무효면 근거 없이 · D-84 버그 배시)
  const prevLive = (prev?.sourceEntryIds ?? []).filter((id) => db0.costEntries.some((e) => e.id === id && e.status === "active" && e.forecastImpact === "additional"));
  const ids = [...new Set(input.entryIds?.length ? input.entryIds : prevLive)];
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
  // ‘청구 안 함’으로 정했던 원가를 근거로 쓰면 그 표시는 지운다
  for (const e of db.costEntries) if (ids.includes(e.id) && e.noClaim) delete e.noClaim;
  log(db, ctx, "change_order", `${site.shortName} 변경공사 ${prev ? "다시 청구" : "청구 검토 등록"} ${fmtMan(amount)}: ${title}${ids.length ? ` (근거 추가 원가 ${ids.length}건 ${fmtMan(sum)})` : ""}`, site.id, `/finance#co-${co.id}`);
  touch(db, ctx);
  return { db, result: { id: co.id } };
}

export interface LogChangeOrderInput {
  coId: string;
  /** no_reclaim: 반려된 건을 다시 청구하지 않기로 정함 (사유 필수 · 대표 점검) */
  kind: "follow_up" | "client_reply" | "note" | "no_reclaim";
  /** 일어난 날 (YYYY-MM-DD) — 오늘 이전, 등록한 날 이후 */
  date: string;
  note: string;
  /** 다음 확인할 날 — 없음: 그대로 · null: 지움 · 날짜: 바꿈 (진행 중인 건만) */
  nextFollowUp?: string | null;
  idempotencyKey?: string;
}

const LOG_KINDS = new Set(["follow_up", "client_reply", "note", "no_reclaim"]);

export function logChangeOrder(db0: DemoDB, input: LogChangeOrderInput, ctx: Ctx) {
  const c0 = db0.changeOrders.find((c) => c.id === input.coId);
  if (!c0) throw new CommandError("변경공사를 찾을 수 없습니다.", "NOT_FOUND");
  const errors: Record<string, string> = {};
  if (!LOG_KINDS.has(input.kind as string)) errors.kind = "무슨 기록인지 골라 주세요.";
  const note = text(input.note);
  if (len(note) < 2) errors.note = "내용을 2자 이상 적어 주세요 (예: 담당 과장 통화 — 다음 주 검토 회의).";
  else if (len(note) > NOTE_MAX) errors.note = `${NOTE_MAX}자 이내`;
  const requested = new Date(new Date(c0.requestedAt).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`)) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date) errors.date = "날짜 형식을 확인해 주세요.";
  else if (!pastCalendarDate(input.date, ctx)) errors.date = "오늘이나 지난 날짜로 적어 주세요.";
  else if (input.date < requested) errors.date = "변경공사를 등록한 날 이후로 적어 주세요.";
  if (input.kind === "no_reclaim") {
    if (c0.status !== "rejected") errors.kind = "반려된 변경공사만 ‘다시 청구 안 함’으로 정리합니다.";
    else if (db0.changeOrders.some((c) => c.reclaimOf === c0.id)) errors.kind = "이미 다시 청구한 변경공사입니다.";
    else if (c0.noReclaim) errors.kind = "이미 ‘다시 청구 안 함’으로 정리했습니다.";
  } else if (input.kind !== "note" && !coOpen(c0)) errors.kind = "결정된 변경공사에는 메모만 남깁니다.";
  if (input.nextFollowUp !== undefined && !coOpen(c0)) errors.nextFollowUp = "결정된 변경공사에는 다음 확인할 날을 정하지 않습니다.";
  // 발주처에 청구한 건은 다음 확인할 날을 지우지 않는다 — 날짜가 없으면 아무도 챙기지 않던 문제 (D-84 점검)
  else if (input.nextFollowUp === null && c0.status === "submitted") errors.nextFollowUp = "발주처에 청구한 건은 다음 확인할 날이 있어야 합니다.";
  else {
    const fe = followUpError(input.nextFollowUp, todayIso(ctx.now));
    if (fe) errors.nextFollowUp = fe;
  }
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const co = db.changeOrders.find((c) => c.id === input.coId)!;
  pushCoLog(co, { at: nowIso(ctx), by: ctx.userId, date: input.date, kind: input.kind, note });
  if (input.kind === "no_reclaim") co.noReclaim = { at: nowIso(ctx), by: ctx.userId, note };
  if (input.nextFollowUp === null) delete co.nextFollowUp;
  else if (typeof input.nextFollowUp === "string") co.nextFollowUp = input.nextFollowUp;
  const site = db.sites.find((s) => s.id === co.siteId);
  log(db, ctx, "change_order", `${site?.shortName ?? ""} 변경공사 기록 — ${co.title}`, co.siteId, `/finance#co-${co.id}`);
  touch(db, ctx);
  return { db, result: { id: co.id } };
}

export interface DeclineClaimInput {
  /** 청구하지 않기로 할(또는 되돌릴) 추가 원가 */
  entryIds: string[];
  /** 왜 청구하지 않는지 (우리 책임·소액·관계 등) — 되돌릴 때는 없어도 됨 */
  note?: string;
  /** true면 ‘청구 안 함’을 되돌린다 */
  undo?: boolean;
  idempotencyKey?: string;
}

/** 추가 원가를 변경공사로 청구하지 않기로 정한다 (사유와 함께 · 되돌릴 수 있음) — 청구 안 한 목록·위험 신호·대표가 정할 일에서 빠진다 (D-84 공무 점검) */
export function declineClaim(db0: DemoDB, input: DeclineClaimInput, ctx: Ctx) {
  if (!Array.isArray(input.entryIds) || !input.entryIds.length || input.entryIds.some((x) => typeof x !== "string")) throw new CommandError("원가를 골라 주세요.", "VALIDATION", { entryIds: "원가" });
  if (input.entryIds.length > ENTRY_MAX) throw new CommandError(`한 번에 ${ENTRY_MAX}건까지`, "VALIDATION", { entryIds: `${ENTRY_MAX}건까지` });
  const undo = input.undo === true;
  const note = text(input.note);
  if (!undo && len(note) < 2) throw new CommandError("청구하지 않는 이유를 적어 주세요 (예: 자재 반입 지연은 우리 책임).", "VALIDATION", { note: "이유 필수" });
  if (len(note) > NOTE_MAX) throw new CommandError(`${NOTE_MAX}자 이내`, "VALIDATION", { note: `${NOTE_MAX}자 이내` });
  const used = new Set(db0.changeOrders.flatMap((c) => c.sourceEntryIds));
  const ids = [...new Set(input.entryIds)];
  for (const id of ids) {
    const e = db0.costEntries.find((x) => x.id === id);
    if (!e) throw new CommandError("원가를 찾을 수 없습니다.", "NOT_FOUND");
    if (e.status !== "active" || e.forecastImpact !== "additional") throw new CommandError("확정된 추가 원가만 정리할 수 있습니다.", "VALIDATION", { entryIds: "확정 추가 원가만" });
    if (used.has(id)) throw new CommandError("이미 변경공사의 근거로 쓴 원가입니다.", "STATE");
    if (undo ? !e.noClaim : !!e.noClaim) throw new CommandError(undo ? "‘청구 안 함’으로 정한 원가가 아닙니다." : "이미 ‘청구 안 함’으로 정한 원가입니다.", "STATE");
  }
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  for (const e of db.costEntries)
    if (ids.includes(e.id)) {
      if (undo) delete e.noClaim;
      else e.noClaim = { at, by: ctx.userId, note };
    }
  const first = db.costEntries.find((e) => e.id === ids[0])!;
  const sum = db.costEntries.filter((e) => ids.includes(e.id)).reduce((a, e) => a + e.amount, 0);
  const site = db.sites.find((s) => s.id === first.siteId);
  log(db, ctx, "change_order", `${site?.shortName ?? ""} 추가 원가 ${ids.length}건 ${fmtMan(sum)} ${undo ? "‘청구 안 함’ 되돌림" : `변경공사로 청구 안 함 — ${note}`}`, first.siteId, "/finance#co-board");
  touch(db, ctx);
  return { db, result: { n: ids.length } };
}

// ───────────── 증빙 파일 (D-88) ─────────────

const DOC_TYPES = new Set<EvidenceDocType>(["contract", "letter", "estimate", "other"]);
const CAPTION_MAX = 80;
const FILE_NAME_MAX = 100;

export interface AddEvidenceInput {
  coId: string;
  docType: EvidenceDocType;
  /** data:image/jpeg|png|webp;base64,… (사진 2.5MB) 또는 data:application/pdf;base64,… (PDF 3MB) */
  dataUrl: string;
  /** 올린 파일 이름 */
  fileName?: string;
  /** 설명 (예: 3층 방수 변경계약서 날인본) */
  caption?: string;
  idempotencyKey?: string;
}

/** 저장된 원본 형식의 확장자 — 파일 이름의 확장자는 늘 이것으로 (사진을 .html·.bat 이름으로 내려받지 않게 · D-88 점검) */
export function evidenceExt(dataUrl: string): string {
  const m = /^data:(image\/(jpeg|png|webp)|application\/pdf);/.exec(dataUrl);
  return !m ? ".jpg" : m[1] === "application/pdf" ? ".pdf" : m[2] === "jpeg" ? ".jpg" : `.${m[2]}`;
}

/** 파일 이름 — 경로·제어 글자는 빼고 100자까지, 확장자는 실제 형식으로 */
function cleanFileName(v: unknown, ext: string): string {
  const raw = typeof v === "string" ? tidyName(v.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, " "), FILE_NAME_MAX) : "";
  const base = raw.replace(/\.[A-Za-z0-9]{1,8}$/, "").trim() || "증빙";
  return `${Array.from(base).slice(0, FILE_NAME_MAX - ext.length).join("")}${ext}`;
}

/** 같은 요청을 다시 보낸 것 — 검사보다 먼저 (20번째 파일을 다시 보내면 ‘20개까지’로 실패처럼 보이던 문제 · D-88 점검) */
function alreadySaved(db0: DemoDB, key: string | undefined) {
  if (key && db0.idempotencyKeys.includes(key)) throw new CommandError("이미 저장된 요청입니다. (중복 저장 방지)", "DUPLICATE");
}

/** 변경공사에 증빙 파일(사진·PDF)을 붙인다 — 상태와 관계없이 (구두 승인 뒤 받은 서면도). 금액·이익은 바뀌지 않는다 */
export function addChangeOrderEvidence(db0: DemoDB, input: AddEvidenceInput, ctx: Ctx) {
  alreadySaved(db0, input?.idempotencyKey);
  const c0 = db0.changeOrders.find((c) => c.id === input?.coId);
  if (!c0) throw new CommandError("변경공사를 찾을 수 없습니다.", "NOT_FOUND");
  const errors: Record<string, string> = {};
  if (!DOC_TYPES.has(input.docType)) errors.docType = "무슨 자료인지 골라 주세요.";
  const pdf = validPdf(input.dataUrl);
  const photo = !pdf && validPhoto(input.dataUrl);
  if (!pdf && !photo) {
    const looksPdf = typeof input.dataUrl === "string" && input.dataUrl.startsWith("data:application/pdf");
    errors.dataUrl =
      looksPdf && input.dataUrl.length > 4_000_100
        ? "PDF가 3MB보다 큽니다. 스캔 해상도를 낮추거나 쪽을 나눠 올리거나, 종이를 사진으로 찍어 올려 주세요."
        : "사진(JPEG·PNG·WEBP)이나 PDF 파일만 올릴 수 있습니다.";
  }
  const caption = typeof input.caption === "string" ? tidyName(input.caption, 1000) : "";
  if (input.caption !== undefined && input.caption !== null && typeof input.caption !== "string") errors.caption = "설명 형식을 확인해 주세요.";
  else if (len(caption) > CAPTION_MAX) errors.caption = `${CAPTION_MAX}자 이내`;
  if (coEvidenceCount(db0, c0.id) >= EVIDENCE_MAX_PER_CO) errors.dataUrl = `변경공사 하나에 파일은 ${EVIDENCE_MAX_PER_CO}개까지입니다. 필요 없는 파일을 지우고 올려 주세요.`;
  if (Object.keys(errors).length) throw new CommandError(errors.dataUrl ?? "입력값을 확인해주세요.", "VALIDATION", errors);
  const kind: ChangeOrderEvidence["kind"] = pdf ? "pdf" : "image";
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const co = db.changeOrders.find((c) => c.id === c0.id)!;
  const ev: ChangeOrderEvidence = {
    id: uid("cev"),
    changeOrderId: co.id,
    siteId: co.siteId,
    kind,
    docType: input.docType,
    dataUrl: input.dataUrl,
    fileName: cleanFileName(input.fileName, evidenceExt(input.dataUrl)),
    caption,
    size: dataUrlBytes(input.dataUrl),
    createdAt: at,
    createdBy: ctx.userId,
  };
  (db.coEvidence ??= []).push(ev);
  pushCoLog(co, { at, by: ctx.userId, date: todayIso(ctx.now), kind: "evidence", note: `${EVIDENCE_DOC_LABEL[ev.docType]} 올림 — ${ev.fileName}${caption ? ` (${caption})` : ""}` });
  const site = db.sites.find((s) => s.id === co.siteId);
  log(db, ctx, "change_order", `${site?.shortName ?? ""} 변경공사 증빙 올림 — ${co.title}: ${EVIDENCE_DOC_LABEL[ev.docType]} ${ev.fileName}`, co.siteId, `/finance#co-${co.id}`);
  touch(db, ctx);
  return { db, result: { id: ev.id } };
}

function coEvidenceCount(db: DemoDB, coId: string) {
  return (db.coEvidence ?? []).filter((e) => e.changeOrderId === coId).length;
}

export interface RemoveEvidenceInput {
  evidenceId: string;
  /** 왜 지우는지 (잘못 올림 · 다른 현장 파일 등) — 변경공사 기록에 남는다 */
  reason: string;
  idempotencyKey?: string;
}

/** 증빙 파일을 지운다 — 원본도 지운다(다른 회사 서류를 잘못 올린 경우). 누가·왜 지웠는지는 변경공사 기록·활동 이력에 남는다 */
export function removeChangeOrderEvidence(db0: DemoDB, input: RemoveEvidenceInput, ctx: Ctx) {
  alreadySaved(db0, input?.idempotencyKey);
  const ev0 = (db0.coEvidence ?? []).find((e) => e.id === input?.evidenceId);
  if (!ev0) throw new CommandError("증빙 파일을 찾을 수 없습니다 (이미 지웠을 수 있습니다).", "NOT_FOUND");
  const reason = text(input.reason);
  if (len(reason) < 2) throw new CommandError("지우는 이유를 적어 주세요 (예: 다른 현장 서류를 잘못 올림).", "VALIDATION", { reason: "이유 필수" });
  if (len(reason) > NOTE_MAX) throw new CommandError(`${NOTE_MAX}자 이내`, "VALIDATION", { reason: `${NOTE_MAX}자 이내` });
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  db.coEvidence = (db.coEvidence ?? []).filter((e) => e.id !== ev0.id);
  const co = db.changeOrders.find((c) => c.id === ev0.changeOrderId);
  const at = nowIso(ctx);
  if (co) pushCoLog(co, { at, by: ctx.userId, date: todayIso(ctx.now), kind: "evidence", note: `${EVIDENCE_DOC_LABEL[ev0.docType] ?? "파일"} 지움 — ${ev0.fileName} (이유: ${reason})` });
  const site = db.sites.find((s) => s.id === ev0.siteId);
  log(db, ctx, "change_order", `${site?.shortName ?? ""} 변경공사 증빙 지움 — ${co?.title ?? ""}: ${ev0.fileName} (이유: ${reason})`, ev0.siteId, co ? `/finance#co-${co.id}` : "/finance#co-board");
  touch(db, ctx);
  return { db, result: { id: ev0.id } };
}
