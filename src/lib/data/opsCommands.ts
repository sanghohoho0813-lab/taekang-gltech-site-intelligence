/**
 * 본사–현장 소통 명령 (DEMO·LIVE 공용 순수 함수)
 * - 근태 수정 요청 → 본사 승인·반려 (계약 검수 S2)
 * - 작업지시: 지시 → 접수 → 진행 → 완료 → 본사 확인/보완 요청 (S3, 모듈 02·03)
 * - 현장 보고 본사 확인·보완 요청 → 현장 보완 (S3)
 * 시각은 서버 시각(ctx.now). 모든 변경은 이력에 남는다.
 */
import { worksOnSite } from "@/lib/domain/types";
import type { AttendanceRecord, AttendanceRequest, DemoDB, WorkOrder } from "@/lib/domain/types";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { shiftDate } from "@/lib/domain/attendance";
import { CommandError, claimKey, clone, log, nowIso, requireSite, touch, userName, validPhoto, type Ctx } from "./commands";

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const kst = (date: string, hm: string) => new Date(`${date}T${hm}:00+09:00`).toISOString();
/** 퇴근 시각 — 출근보다 이른 시각이면 다음 날 퇴근(야간 근무)으로 본다 (D-66 점검 반영) */
const MAX_SHIFT_MS = 20 * 3_600_000;
const outIso = (date: string, hm: string, inAt: string) => {
  const t = kst(date, hm);
  return t > inAt ? t : new Date(new Date(t).getTime() + 86_400_000).toISOString();
};
const PHOTO = { test: (v: unknown) => validPhoto(v) };

export const FIX_KIND_LABEL: Record<AttendanceRequest["kind"], string> = {
  missed_in: "출근을 못 눌렀어요",
  missed_out: "퇴근을 못 눌렀어요",
  gps_issue: "위치(GPS)가 잘못 찍혔어요",
  wrong_time: "시각이 잘못 찍혔어요",
};

// ───────────────────────── 근태 수정 요청 ─────────────────────────

export interface FixRequestInput {
  siteId: string;
  workDate: string;
  kind: AttendanceRequest["kind"];
  inTime?: string;
  outTime?: string;
  reason: string;
  idempotencyKey?: string;
}

export function requestAttendanceFix(db0: DemoDB, input: FixRequestInput, ctx: Ctx) {
  const site = requireSite(db0, input.siteId);
  const at = nowIso(ctx);
  const today = todayIso(new Date(at));
  const errors: Record<string, string> = {};
  if (!(input.kind in FIX_KIND_LABEL)) errors.kind = "무엇이 잘못됐는지 골라 주세요.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate ?? "") || input.workDate > today || input.workDate < shiftDate(today, -7)) errors.workDate = "최근 7일 안의 날짜만 요청할 수 있어요.";
  if (input.inTime !== undefined && !HM.test(input.inTime)) errors.inTime = "출근 시각을 확인해 주세요.";
  if (input.outTime !== undefined && !HM.test(input.outTime)) errors.outTime = "퇴근 시각을 확인해 주세요.";
  if (input.kind === "missed_in" && !input.inTime) errors.inTime = "실제 출근 시각을 넣어 주세요.";
  if (input.kind === "missed_out" && !input.outTime) errors.outTime = "실제 퇴근 시각을 넣어 주세요.";
  if (input.inTime && input.outTime && input.outTime === input.inTime) errors.outTime = "출근과 퇴근 시각이 같아요.";
  if ((input.reason ?? "").trim().length < 2) errors.reason = "사유를 골라 주세요.";
  // 아직 오지 않은 시각으로는 요청할 수 없다
  if (!errors.workDate && input.inTime && HM.test(input.inTime) && kst(input.workDate, input.inTime) > at) errors.inTime = "아직 지나지 않은 시각이에요.";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const rec = (db0.attendance ?? []).find((r) => r.userId === ctx.userId && r.siteId === site.id && r.workDate === input.workDate);
  // 퇴근 시각: 출근보다 이르면 다음 날(야간 근무) — 아직 오지 않은 시각·20시간 넘는 근무는 받지 않는다
  const inRef = input.inTime ? kst(input.workDate, input.inTime) : rec?.inAt;
  if (input.outTime && inRef) {
    const out = outIso(input.workDate, input.outTime, inRef);
    if (out > at) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", { outTime: "아직 지나지 않은 시각이에요." });
    if (new Date(out).getTime() - new Date(inRef).getTime() > MAX_SHIFT_MS) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", { outTime: "근무가 20시간을 넘어요. 퇴근 시각을 확인해 주세요." });
  } else if (input.outTime && kst(input.workDate, input.outTime) > at) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", { outTime: "아직 지나지 않은 시각이에요." });
  if (input.kind === "missed_in" && rec) throw new CommandError("그날 출근 기록이 이미 있어요. ‘시각이 잘못 찍혔어요’로 요청해 주세요.", "STATE");
  if (input.kind !== "missed_in" && !rec) throw new CommandError("그날 출근 기록이 없어요. ‘출근을 못 눌렀어요’로 요청해 주세요.", "STATE");
  const waiting = (db0.attendanceRequests ?? []).find((q) => q.userId === ctx.userId && q.siteId === site.id && q.workDate === input.workDate && q.status === "pending");
  if (waiting)
    throw new CommandError(
      waiting.auto === "offline" ? "그날은 통신 불량으로 자동 등록된 ‘누른 시각 확인’이 본사 확인을 기다리고 있어요. 더 고칠 것이 있으면 본사에 전화해 주세요." : "그날 이미 본사 확인을 기다리는 요청이 있어요.",
      "DUPLICATE",
    );
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const req: AttendanceRequest = {
    id: uid("afr"),
    siteId: site.id,
    userId: ctx.userId,
    workDate: input.workDate,
    kind: input.kind,
    ...(input.inTime ? { inTime: input.inTime } : {}),
    ...(input.outTime ? { outTime: input.outTime } : {}),
    reason: input.reason.trim().slice(0, 200),
    status: "pending",
    createdAt: at,
    ...(rec ? { attendanceId: rec.id } : {}),
  };
  db.attendanceRequests = [...(db.attendanceRequests ?? []), req];
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 근태 수정 요청 — ${site.shortName} ${input.workDate} · ${FIX_KIND_LABEL[input.kind]} · ${req.reason}`, site.id, "/attendance");
  touch(db, ctx);
  return { db, result: { requestId: req.id } };
}

/** 본사 승인·반려 — 승인하면 출퇴근 기록을 고치거나(이력) 새로 만든다(위치 없음 + 요청 근거 표시) */
export function reviewAttendanceFix(db0: DemoDB, input: { requestId: string; decision: "approve" | "reject"; note?: string }, ctx: Ctx) {
  const db = clone(db0);
  db.attendanceRequests = [...(db.attendanceRequests ?? [])];
  db.attendance = [...(db.attendance ?? [])];
  const i = db.attendanceRequests.findIndex((q) => q.id === input.requestId);
  if (i < 0) throw new CommandError("요청을 찾을 수 없습니다.", "NOT_FOUND");
  const q = db.attendanceRequests[i];
  if (q.status !== "pending") throw new CommandError("이미 처리한 요청입니다.", "STATE");
  const note = (input.note ?? "").trim();
  if (input.decision === "reject" && note.length < 2) throw new CommandError("반려 사유를 적어주세요.", "VALIDATION", { note: "필수" });
  const at = nowIso(ctx);
  let attendanceId = q.attendanceId;
  if (input.decision === "approve") {
    const stamp = `현장 요청 승인 — ${FIX_KIND_LABEL[q.kind]} · ${q.reason}${note ? ` (${note})` : ""}`;
    // ‘출근을 못 눌렀어요’ 요청 뒤에 그날 출근을 실제로 눌렀다면 새 기록을 만들지 않고 그 기록의 출근 시각을 고친다
    // (같은 사람·현장·날에 출근 기록이 두 개 생기던 문제 · D-65 점검 반영)
    const existing = q.kind === "missed_in" ? db.attendance.findIndex((r) => r.userId === q.userId && r.siteId === q.siteId && r.workDate === q.workDate) : -1;
    if (existing >= 0) {
      const r = db.attendance[existing];
      const inAt = kst(q.workDate, q.inTime!);
      const outAt = q.outTime && !r.outAt ? outIso(q.workDate, q.outTime, inAt) : r.outAt;
      if (outAt && outAt <= inAt) throw new CommandError("요청한 출근 시각이 이미 기록된 퇴근 시각보다 늦습니다. 출퇴근 현황에서 직접 정정해 주세요.", "STATE");
      db.attendance[existing] = { ...r, inAt, ...(outAt ? { outAt } : {}), exceptionNote: stamp, corrections: [...(r.corrections ?? []), { at, by: ctx.userId, note: `${stamp} (그 뒤 누른 출근 기록의 시각을 고침)`, before: { inAt: r.inAt, ...(r.outAt ? { outAt: r.outAt } : {}) } }] };
      attendanceId = r.id;
    } else if (q.kind === "missed_in") {
      const rec: AttendanceRecord = {
        id: uid("att"),
        siteId: q.siteId,
        userId: q.userId,
        workDate: q.workDate,
        inAt: kst(q.workDate, q.inTime!),
        inGeo: { status: "none", reason: "skipped" },
        ...(q.outTime ? { outAt: outIso(q.workDate, q.outTime, kst(q.workDate, q.inTime!)) } : {}),
        fromRequestId: q.id,
        exceptionNote: stamp,
        corrections: [{ at, by: ctx.userId, note: stamp, before: { inAt: kst(q.workDate, q.inTime!) } }],
      };
      db.attendance.push(rec);
      attendanceId = rec.id;
    } else {
      const k = db.attendance.findIndex((r) => r.id === q.attendanceId);
      if (k < 0) throw new CommandError("고칠 출퇴근 기록을 찾을 수 없습니다.", "STATE");
      const r = db.attendance[k];
      const inAt = q.inTime ? kst(q.workDate, q.inTime) : r.inAt;
      const outAt = q.outTime ? outIso(q.workDate, q.outTime, inAt) : r.outAt;
      if (outAt && outAt <= inAt) throw new CommandError("퇴근 시각이 출근 시각보다 늦어야 합니다.", "VALIDATION");
      db.attendance[k] = {
        ...r,
        inAt,
        ...(outAt ? { outAt } : {}),
        // 통신 불량 자동 요청은 ‘시각’만 확인한 것 — 위치 의심 표시(현장 밖 등)는 그대로 둔다 (리뷰 반영 D-55)
        ...(q.auto === "offline" ? {} : { exceptionNote: stamp }),
        corrections: [...(r.corrections ?? []), { at, by: ctx.userId, note: stamp, before: { inAt: r.inAt, ...(r.outAt ? { outAt: r.outAt } : {}) } }],
      };
    }
  }
  db.attendanceRequests[i] = { ...q, status: input.decision === "approve" ? "approved" : "rejected", reviewedAt: at, reviewedBy: ctx.userId, ...(note ? { reviewNote: note } : {}), ...(attendanceId ? { attendanceId } : {}) };
  log(db, ctx, "attendance", `근태 수정 요청 ${input.decision === "approve" ? "승인" : "반려"} — ${userName(db, q.userId)} ${q.workDate}${note ? ` · ${note}` : ""}`, q.siteId, "/attendance");
  touch(db, ctx);
  return { db, result: { requestId: q.id, attendanceId } };
}

// ───────────────────────── 작업지시 ─────────────────────────

export interface WorkOrderInput {
  siteId: string;
  title: string;
  detail?: string;
  assigneeUserId?: string;
  dueDate?: string;
  urgent?: boolean;
  idempotencyKey?: string;
  /** 발주처 하자보수 요청에서 보내는 작업지시 (D-68) */
  partnerRequestId?: string;
}

export function createWorkOrder(db0: DemoDB, input: WorkOrderInput, ctx: Ctx) {
  const site = requireSite(db0, input.siteId);
  const errors: Record<string, string> = {};
  const title = (input.title ?? "").trim();
  if (title.length < 2 || title.length > 80) errors.title = "지시 제목 (2~80자)";
  if ((input.detail ?? "").length > 500) errors.detail = "내용은 500자 이내";
  const assignee = input.assigneeUserId || site.fieldUserId;
  const u = db0.users.find((x) => x.id === assignee);
  if (!u || u.inactive || u.role === "partner") errors.assigneeUserId = "받을 사람을 골라 주세요.";
  // 그 현장을 맡지 않은 현장 직원에게는 보내지 않는다 (현장 이름 없이 엉뚱한 사람에게 가던 문제 · D-65 점검 반영)
  else if (!worksOnSite(u, site)) errors.assigneeUserId = `${u.name}님은 ${site.shortName}을 맡고 있지 않습니다. 현장 담당이나 운영 관리에서 현장을 먼저 배정하세요.`;
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) errors.dueDate = "기한 날짜를 확인해 주세요.";
  // 이미 지난 날짜를 기한으로 주면 보내자마자 ‘(지남)’이 붙는다 (D-66 점검 반영)
  else if (input.dueDate && input.dueDate < todayIso(ctx.now)) errors.dueDate = "기한은 오늘이나 그 뒤로 정해 주세요.";
  const req0 = input.partnerRequestId ? db0.partnerRequests.find((r) => r.id === input.partnerRequestId) : undefined;
  if (input.partnerRequestId) {
    if (!req0 || req0.siteId !== site.id) throw new CommandError("하자보수 요청을 찾을 수 없습니다.", "NOT_FOUND");
    if (req0.type !== "defect") throw new CommandError("하자보수 요청만 작업지시로 보낼 수 있습니다.", "STATE");
    // 일정 안내로 먼저 회신한 하자도 작업지시는 보낼 수 있다 — ‘처리 끝’·발주처 확인이면 안 됨 (D-69 점검 반영)
    if (req0.closedWithoutRepair || req0.confirmedAt) throw new CommandError("이미 처리가 끝난 요청입니다.", "STATE");
    if (req0.linkedWorkOrderId && (db0.workOrders ?? []).some((w) => w.id === req0.linkedWorkOrderId)) throw new CommandError("이 요청으로 이미 보낸 작업지시가 있습니다.", "DUPLICATE");
  }
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const wo: WorkOrder = {
    id: uid("wo"),
    siteId: site.id,
    title,
    detail: (input.detail ?? "").trim(),
    assigneeUserId: assignee,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.urgent ? { urgent: true } : {}),
    status: "sent",
    createdAt: at,
    createdBy: ctx.userId,
    history: [{ at, by: ctx.userId, to: "sent" }],
  };
  if (req0) {
    wo.sourcePartnerRequestId = req0.id;
    if (req0.photoIds?.length) wo.refPhotoIds = [...req0.photoIds];
    const r = db.partnerRequests.find((x) => x.id === req0.id)!;
    r.linkedWorkOrderId = wo.id;
    r.updatedAt = at;
    if (r.status === "received") r.status = "reviewing";
    r.history.push({ at, status: r.status, by: ctx.userId, note: "보수 작업 배정" });
  }
  db.workOrders = [...(db.workOrders ?? []), wo];
  log(db, ctx, "order", `${site.shortName} 작업지시 — ${title} → ${userName(db, assignee)}${input.urgent ? " (긴급)" : ""}`, site.id, "/orders");
  touch(db, ctx);
  return { db, result: { workOrderId: wo.id } };
}

/** 현장: 접수 → 시작 → 완료 (완료는 메모·작업량·사진 중 하나 이상) */
export function workOrderStep(db0: DemoDB, input: { workOrderId: string; action: "receive" | "start" | "complete"; note?: string; qty?: string; photoDataUrls?: string[] }, ctx: Ctx) {
  const db = clone(db0);
  db.workOrders = [...(db.workOrders ?? [])];
  const i = db.workOrders.findIndex((w) => w.id === input.workOrderId);
  if (i < 0) throw new CommandError("작업지시를 찾을 수 없습니다.", "NOT_FOUND");
  const w = db.workOrders[i];
  const at = nowIso(ctx);
  const allowed: Record<typeof input.action, WorkOrder["status"][]> = { receive: ["sent"], start: ["sent", "received", "returned"], complete: ["sent", "received", "in_progress", "returned"] };
  if (!allowed[input.action].includes(w.status)) throw new CommandError("지금 상태에서는 할 수 없어요.", "STATE");
  let next: WorkOrder = { ...w };
  if (input.action === "receive") next.status = "received";
  if (input.action === "start") next.status = "in_progress";
  if (input.action === "complete") {
    const note = (input.note ?? "").trim().slice(0, 400);
    const qty = (input.qty ?? "").trim().slice(0, 40);
    const photos = (input.photoDataUrls ?? []).slice(0, 3);
    if (photos.some((p) => typeof p !== "string" || !PHOTO.test(p))) throw new CommandError("사진 형식을 확인해 주세요.", "VALIDATION");
    if (!note && !qty && photos.length === 0) throw new CommandError("한 일·작업량·사진 중 하나는 넣어 주세요.", "VALIDATION", { note: "필수" });
    const ids = photos.map((p) => {
      const id = uid("ph");
      db.photos.push({ id, siteId: w.siteId, dataUrl: p, caption: `작업지시 완료 · ${w.title}`, createdAt: at, createdBy: ctx.userId });
      return id;
    });
    next = { ...next, status: "done", doneNote: note || undefined, doneQty: qty || undefined, donePhotoIds: ids.length ? ids : w.donePhotoIds };
  }
  next.history = [...w.history, { at, by: ctx.userId, to: next.status, ...(input.action === "complete" && input.note ? { note: input.note.trim().slice(0, 120) } : {}) }];
  db.workOrders[i] = next;
  const word = { receive: "접수", start: "시작", complete: "완료" }[input.action];
  log(db, ctx, "order", `작업지시 ${word} — ${w.title}${input.qty ? ` · ${input.qty}` : ""}`, w.siteId, "/orders");
  touch(db, ctx);
  return { db, result: { workOrderId: w.id, status: next.status } };
}

/** 본사: 완료 확인 또는 보완 요청 (사유 필수) */
export function reviewWorkOrder(db0: DemoDB, input: { workOrderId: string; decision: "confirm" | "return"; note?: string }, ctx: Ctx) {
  const db = clone(db0);
  db.workOrders = [...(db.workOrders ?? [])];
  const i = db.workOrders.findIndex((w) => w.id === input.workOrderId);
  if (i < 0) throw new CommandError("작업지시를 찾을 수 없습니다.", "NOT_FOUND");
  const w = db.workOrders[i];
  if (w.status !== "done") throw new CommandError("완료 보고된 작업지시만 확인할 수 있습니다.", "STATE");
  const note = (input.note ?? "").trim();
  if (input.decision === "return" && note.length < 2) throw new CommandError("보완할 내용을 적어주세요.", "VALIDATION", { note: "필수" });
  const at = nowIso(ctx);
  const to: WorkOrder["status"] = input.decision === "confirm" ? "confirmed" : "returned";
  db.workOrders[i] = { ...w, status: to, ...(to === "returned" ? { returnNote: note } : {}), history: [...w.history, { at, by: ctx.userId, to, ...(note ? { note } : {}) }] };
  // 하자보수 작업지시를 다시 보수하게 하면, 발주처가 이미 ‘확인’했더라도 확인을 풀고 ‘추가 보수’로 남긴다 (D-68 점검 반영)
  if (to === "returned" && w.sourcePartnerRequestId) {
    const r = db.partnerRequests.find((x) => x.id === w.sourcePartnerRequestId);
    if (r?.confirmedAt) {
      delete r.confirmedAt;
      delete r.confirmNote;
      r.updatedAt = at;
      r.history.push({ at, status: r.status, by: ctx.userId, note: "추가 보수 (본사 보완 요청)" });
    }
  }
  log(db, ctx, "order", `작업지시 ${to === "confirmed" ? "확인" : "보완 요청"} — ${w.title}${note ? ` · ${note}` : ""}`, w.siteId, "/orders");
  touch(db, ctx);
  return { db, result: { workOrderId: w.id, status: to } };
}

// ───────────────────────── 현장 보고 확인·보완 ─────────────────────────

export function reviewReport(db0: DemoDB, input: { reportId: string; decision: "confirm" | "return"; note?: string }, ctx: Ctx) {
  const db = clone(db0);
  const r = db.reports.find((x) => x.id === input.reportId);
  if (!r) throw new CommandError("현장 보고를 찾을 수 없습니다.", "NOT_FOUND");
  if (r.status === "voided") throw new CommandError("취소된 보고입니다.", "STATE");
  const note = (input.note ?? "").trim();
  if (input.decision === "return" && note.length < 2) throw new CommandError("보완할 내용을 적어주세요.", "VALIDATION", { note: "필수" });
  r.review = { status: input.decision === "confirm" ? "confirmed" : "returned", at: nowIso(ctx), by: ctx.userId, ...(note ? { note: note.slice(0, 200) } : {}) };
  const site = db.sites.find((s) => s.id === r.siteId);
  log(db, ctx, "report", `${site?.shortName} 현장 보고 ${input.decision === "confirm" ? "확인" : "보완 요청"} — ${userName(db, r.createdBy)} ${r.reportDate}${note ? ` · ${note}` : ""}`, r.siteId, "/orders");
  touch(db, ctx);
  return { db, result: { reportId: r.id, status: r.review.status } };
}

/** 현장: 보완 요청 받은 보고에 내용·사진을 덧붙이면 다시 ‘확인 전’이 된다 */
export function supplementReport(db0: DemoDB, input: { reportId: string; text?: string; photoDataUrls?: string[] }, ctx: Ctx) {
  const db = clone(db0);
  const r = db.reports.find((x) => x.id === input.reportId);
  if (!r) throw new CommandError("현장 보고를 찾을 수 없습니다.", "NOT_FOUND");
  // 보완은 본사가 보완을 요청한 보고에만 — 확인된 보고를 보완해 확인 기록이 지워지던 문제 (D-66 점검 반영)
  if (r.status === "voided") throw new CommandError("취소한 보고는 보완할 수 없습니다.", "STATE");
  if (r.review?.status !== "returned") throw new CommandError("본사가 보완을 요청한 보고만 보완할 수 있습니다.", "STATE");
  const text = (input.text ?? "").trim().slice(0, 400);
  const photos = (input.photoDataUrls ?? []).slice(0, 3);
  if (photos.some((p) => typeof p !== "string" || !PHOTO.test(p))) throw new CommandError("사진 형식을 확인해 주세요.", "VALIDATION");
  if (!text && photos.length === 0) throw new CommandError("보완할 내용이나 사진을 넣어 주세요.", "VALIDATION", { text: "필수" });
  const at = nowIso(ctx);
  const ids = photos.map((p) => {
    const id = uid("ph");
    db.photos.push({ id, siteId: r.siteId, reportId: r.id, dataUrl: p, caption: "보완 사진", createdAt: at, createdBy: ctx.userId });
    return id;
  });
  r.supplements = [...(r.supplements ?? []), { at, by: ctx.userId, text, photoIds: ids }];
  r.photoIds = [...r.photoIds, ...ids];
  delete r.review;
  log(db, ctx, "report", `현장 보고 보완 — ${userName(db, ctx.userId)} ${r.reportDate}${text ? ` · ${text.slice(0, 40)}` : ""}`, r.siteId, "/orders");
  touch(db, ctx);
  return { db, result: { reportId: r.id } };
}
