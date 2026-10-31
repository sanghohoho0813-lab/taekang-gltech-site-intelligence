/**
 * 도메인 명령 — 순수 함수: (db, input, ctx) → { db, result }
 * 모든 쓰기 경로는 여기를 거친다 (검증·중복저장 방지·활동로그·Proof Event).
 * 저장소(Repository)는 결과 db를 영속화만 한다.
 */
import type {
  ActionItem,
  ActionKpiSnapshot,
  ActionStatus,
  ChangeOrder,
  ChangeOrderStatus,
  CostCategory,
  CostEntry,
  CostReason,
  DemoDB,
  FieldReport,
  ForecastImpact,
  PartnerRequest,
  PartnerRequestStatus,
  ProofEvent,
  RiskSignal,
  RiskThresholds,
  SitePhoto,
} from "@/lib/domain/types";
import { siteFinancials, type SiteFinancials } from "@/lib/domain/calc";
import { ACTION_STATUS_LABEL, CATEGORY_LABEL, COST_CATEGORIES, PARTNER_STATUS_LABEL, REASON_LABEL } from "@/lib/domain/labels";
import { fmtEok, fmtMan, fmtPct } from "@/lib/domain/format";
import { DECISION_METHOD } from "@/lib/domain/risk";
import { uid } from "@/lib/domain/ids";

export interface Ctx {
  userId: string;
  now?: Date;
}

export class CommandError extends Error {
  constructor(
    message: string,
    public code: "VALIDATION" | "DUPLICATE" | "NOT_FOUND" | "STATE" = "VALIDATION",
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export const MAX_AMOUNT = 5_000_000_000; // 1건 50억 원 상한 (입력 오류 방지)

export function clone(db: DemoDB): DemoDB {
  return structuredClone(db);
}
export function nowIso(ctx: Ctx): string {
  return (ctx.now ?? new Date()).toISOString();
}
export function userName(db: DemoDB, id: string): string {
  const u = db.users.find((x) => x.id === id);
  return u ? `${u.name} ${u.title}`.trim() : id;
}
export function log(db: DemoDB, ctx: Ctx, type: string, summary: string, siteId?: string, link?: string) {
  db.activityLogs.unshift({ id: uid("log"), at: nowIso(ctx), by: ctx.userId, type, siteId, summary, link });
  if (db.activityLogs.length > 300) db.activityLogs.length = 300;
}
export function touch(db: DemoDB, ctx: Ctx) {
  db.rev += 1;
  db.updatedAt = nowIso(ctx);
}
export function claimKey(db: DemoDB, key: string | undefined) {
  if (!key) return;
  if (db.idempotencyKeys.includes(key)) throw new CommandError("이미 저장된 요청입니다. (중복 저장 방지)", "DUPLICATE");
  db.idempotencyKeys.push(key);
  if (db.idempotencyKeys.length > 500) db.idempotencyKeys.splice(0, db.idempotencyKeys.length - 500);
}
export function requireSite(db: DemoDB, siteId: string) {
  const s = db.sites.find((x) => x.id === siteId);
  if (!s) throw new CommandError("현장을 찾을 수 없습니다.", "NOT_FOUND");
  return s;
}
export function validateAmount(v: unknown, field = "amount"): number {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new CommandError("금액은 원 단위 정수로 입력해주세요.", "VALIDATION", { [field]: "원 단위 정수" });
  }
  if (v <= 0) throw new CommandError("금액은 0보다 커야 합니다.", "VALIDATION", { [field]: "0보다 큰 금액" });
  if (v > MAX_AMOUNT) throw new CommandError(`1건 금액은 ${fmtEok(MAX_AMOUNT)} 이하로 입력해주세요.`, "VALIDATION", { [field]: "상한 초과" });
  return v;
}

export function kpiSnapshot(f: SiteFinancials, at: string): ActionKpiSnapshot {
  return {
    at,
    eac: f.eac,
    expectedProfit: f.expectedProfit,
    marginPct: f.marginPct,
    adjustedContract: f.adjustedContract,
    pendingClaimAmount: f.pendingChangeAmount,
  };
}

// ───────────────────────── 현장 보고 + 원가 이벤트 ─────────────────────────

export interface CostLineInput {
  category: CostCategory;
  amount: number;
  forecastImpact: Exclude<ForecastImpact, "baseline">;
  note?: string;
  /** 노무비를 공수 × 일당으로 입력한 경우 (금액 = 공수 × 일당) */
  qty?: { manDays: number; dayRate: number };
}

export interface FieldReportInput {
  idempotencyKey: string;
  siteId: string;
  reportDate: string;
  workDone: string;
  issues?: string;
  tomorrowPlan?: string;
  photos?: { dataUrl: string; caption?: string }[];
  costs?: CostLineInput[];
  reason?: CostReason;
  reasonNote?: string;
  source?: "FIELD" | "PC";
  /** 오늘 기준 공정률 (선택, 0~100) */
  progressPct?: number;
}

export interface FieldReportResult {
  reportId: string;
  entryIds: string[];
  before: SiteFinancials;
  after: SiteFinancials;
  /** 공무 확인 대기로 저장되어 아직 손익에 반영되지 않았는지 */
  pendingReview?: boolean;
}

export function submitFieldReport(db0: DemoDB, input: FieldReportInput, ctx: Ctx): { db: DemoDB; result: FieldReportResult } {
  const errors: Record<string, string> = {};
  requireSite(db0, input.siteId);
  const costs = input.costs ?? [];
  if (!input.workDone?.trim() && costs.length === 0) errors.workDone = "오늘의 작업 내용을 입력하거나 비용을 추가해주세요.";
  if ((input.workDone ?? "").length > 500) errors.workDone = "작업 내용은 500자 이내";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate ?? "")) errors.reportDate = "보고일을 선택해주세요.";
  costs.forEach((c, i) => {
    if (!COST_CATEGORIES.includes(c.category)) errors[`costs.${i}.category`] = "비용 항목을 선택해주세요.";
    if (!Number.isInteger(c.amount) || c.amount <= 0) errors[`costs.${i}.amount`] = "0보다 큰 금액(원)을 입력해주세요.";
    else if (c.amount > MAX_AMOUNT) errors[`costs.${i}.amount`] = `${fmtEok(MAX_AMOUNT)} 이하로 입력해주세요.`;
    if (c.forecastImpact !== "additional" && c.forecastImpact !== "within_forecast") errors[`costs.${i}.impact`] = "비용 성격을 선택해주세요.";
    if (c.qty) {
      const { manDays, dayRate } = c.qty;
      if (!(manDays > 0) || manDays > 10_000 || !(dayRate > 0) || !Number.isInteger(dayRate)) errors[`costs.${i}.amount`] = "공수와 일당을 확인해주세요.";
      else if (Math.round(manDays * dayRate) !== c.amount) errors[`costs.${i}.amount`] = "금액이 공수 × 일당과 다릅니다.";
    }
  });
  if (input.progressPct !== undefined && (!Number.isFinite(input.progressPct) || input.progressPct < 0 || input.progressPct > 100)) errors.progressPct = "공정률은 0~100 사이";
  if (costs.length > 0 && !input.reason) errors.reason = "비용 발생 사유를 선택해주세요.";
  if ((input.photos ?? []).length > 3) errors.photos = "사진은 최대 3장";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const before = siteFinancials(db0, input.siteId);
  const reportId = uid("rpt");

  const photoIds: string[] = [];
  for (const p of input.photos ?? []) {
    const photo: SitePhoto = {
      id: uid("ph"),
      siteId: input.siteId,
      reportId,
      dataUrl: p.dataUrl,
      caption: p.caption ?? "현장 사진",
      createdAt: at,
      createdBy: ctx.userId,
    };
    db.photos.push(photo);
    photoIds.push(photo.id);
  }

  // 회사 설정이 '공무 확인 후 반영'이면 현장 입력 원가는 확인 대기로 저장 (손익 미반영)
  const pendingReview = (db.settings?.costApproval ?? "immediate") === "review" && (input.source ?? "FIELD") === "FIELD";
  const entryIds: string[] = [];
  for (const c of costs) {
    const entry: CostEntry = {
      id: uid("ce"),
      siteId: input.siteId,
      category: c.category,
      amount: c.amount,
      date: input.reportDate,
      forecastImpact: c.forecastImpact,
      reason: input.reason ?? "other",
      note: [c.note?.trim(), input.reasonNote?.trim()].filter(Boolean).join(" · ") || REASON_LABEL[input.reason ?? "other"],
      source: input.source ?? "FIELD",
      reportId,
      createdBy: ctx.userId,
      createdAt: at,
      status: pendingReview ? "pending" : "active",
      ...(c.qty ? { qty: { manDays: c.qty.manDays, dayRate: c.qty.dayRate } } : {}),
    };
    db.costEntries.push(entry);
    entryIds.push(entry.id);
  }

  const report: FieldReport = {
    id: reportId,
    siteId: input.siteId,
    reportDate: input.reportDate,
    workDone: input.workDone?.trim() ?? "",
    issues: input.issues?.trim() ?? "",
    tomorrowPlan: input.tomorrowPlan?.trim() ?? "",
    photoIds,
    costEntryIds: entryIds,
    createdBy: ctx.userId,
    createdAt: at,
    status: "submitted",
  };
  db.reports.unshift(report);

  const site = requireSite(db, input.siteId);
  if (input.progressPct !== undefined && Math.round(input.progressPct) !== site.progressPct) {
    log(db, ctx, "progress", `${site.shortName} 공정률 ${site.progressPct}% → ${Math.round(input.progressPct)}% (현장보고)`, input.siteId, `/sites/${input.siteId}`);
    site.progressPct = Math.round(input.progressPct);
  }
  const after = siteFinancials(db, input.siteId);
  const costSum = costs.reduce((s, c) => s + c.amount, 0);
  log(
    db,
    ctx,
    "report",
    costs.length
      ? pendingReview
        ? `${site.shortName} 현장보고 + 원가 ${costs.length}건 ${fmtMan(costSum)} 등록 → 본사 공무 확인 대기 (손익 미반영)`
        : `${site.shortName} 현장보고 + 원가 ${costs.length}건 ${fmtMan(costSum)} 등록 → EAC ${fmtEok(before.eac)} → ${fmtEok(after.eac)}`
      : `${site.shortName} 현장보고 등록 (원가 변동 없음)`,
    input.siteId,
    `/sites/${input.siteId}`,
  );
  touch(db, ctx);
  return { db, result: { reportId, entryIds, before, after, pendingReview } };
}

export function voidCostEntry(db0: DemoDB, entryId: string, reason: string, ctx: Ctx) {
  const db = clone(db0);
  const e = db.costEntries.find((x) => x.id === entryId);
  if (!e) throw new CommandError("원가 이벤트를 찾을 수 없습니다.", "NOT_FOUND");
  if (e.status === "voided") throw new CommandError("이미 무효 처리된 원가입니다.", "STATE");
  if (e.status === "rejected") throw new CommandError("공무가 반려한 원가는 무효 처리할 필요가 없습니다.", "STATE");
  if (e.source === "SEED") throw new CommandError("기준 발생원가(시드)는 무효 처리할 수 없습니다. Demo Reset을 사용하세요.", "STATE");
  const before = siteFinancials(db0, e.siteId);
  e.status = "voided";
  e.voidedAt = nowIso(ctx);
  e.voidedBy = ctx.userId;
  e.voidReason = reason || "되돌리기";
  const after = siteFinancials(db, e.siteId);
  log(db, ctx, "cost_void", `${CATEGORY_LABEL[e.category]} ${fmtMan(e.amount)} 무효 처리 (${e.voidReason}) → EAC ${fmtEok(before.eac)} → ${fmtEok(after.eac)}`, e.siteId, `/sites/${e.siteId}`);
  touch(db, ctx);
  return { db, result: { before, after } };
}

/** 현장보고 전체 되돌리기 (보고에 포함된 원가 이벤트를 모두 무효 처리) */
export function voidReport(db0: DemoDB, reportId: string, ctx: Ctx) {
  const db = clone(db0);
  const r = db.reports.find((x) => x.id === reportId);
  if (!r) throw new CommandError("현장보고를 찾을 수 없습니다.", "NOT_FOUND");
  if (r.status === "voided") throw new CommandError("이미 되돌린 보고입니다.", "STATE");
  const before = siteFinancials(db0, r.siteId);
  r.status = "voided";
  for (const id of r.costEntryIds) {
    const e = db.costEntries.find((x) => x.id === id);
    if (e && (e.status === "active" || e.status === "pending")) {
      e.status = "voided";
      e.voidedAt = nowIso(ctx);
      e.voidedBy = ctx.userId;
      e.voidReason = "현장보고 되돌리기";
    }
  }
  const after = siteFinancials(db, r.siteId);
  const site = requireSite(db, r.siteId);
  log(db, ctx, "report_void", `${site.shortName} 현장보고 되돌리기 → EAC ${fmtEok(before.eac)} → ${fmtEok(after.eac)}`, r.siteId, `/sites/${r.siteId}`);
  touch(db, ctx);
  return { db, result: { before, after } };
}

export function editCostEntry(
  db0: DemoDB,
  entryId: string,
  patch: { amount: number; category: CostCategory; note: string; forecastImpact?: Exclude<ForecastImpact, "baseline"> },
  ctx: Ctx,
) {
  const db = clone(db0);
  const e = db.costEntries.find((x) => x.id === entryId);
  if (!e) throw new CommandError("원가 이벤트를 찾을 수 없습니다.", "NOT_FOUND");
  if (e.status !== "active" && e.status !== "pending") throw new CommandError("무효·반려된 원가는 수정할 수 없습니다.", "STATE");
  if (e.source === "SEED") throw new CommandError("기준 발생원가(시드)는 수정할 수 없습니다.", "STATE");
  validateAmount(patch.amount);
  if (!COST_CATEGORIES.includes(patch.category)) throw new CommandError("비용 항목을 선택해주세요.");
  const before = siteFinancials(db0, e.siteId);
  e.editHistory = [...(e.editHistory ?? []), { at: nowIso(ctx), by: ctx.userId, before: { amount: e.amount, category: e.category, note: e.note } }];
  e.amount = patch.amount;
  e.category = patch.category;
  e.note = patch.note.trim() || e.note;
  if (patch.forecastImpact) e.forecastImpact = patch.forecastImpact;
  e.editedAt = nowIso(ctx);
  const after = siteFinancials(db, e.siteId);
  log(db, ctx, "cost_edit", `원가 수정 ${CATEGORY_LABEL[e.category]} → ${fmtMan(e.amount)} · EAC ${fmtEok(before.eac)} → ${fmtEok(after.eac)}`, e.siteId, `/sites/${e.siteId}`);
  touch(db, ctx);
  return { db, result: { before, after } };
}

// ───────────────────────── 위험 → 조치 → 결과 → Proof Event ─────────────────────────

export function createAction(
  db0: DemoDB,
  input: { signal: RiskSignal; title?: string; description?: string; assigneeUserId?: string; dueDate?: string; idempotencyKey?: string },
  ctx: Ctx,
) {
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const s = input.signal;
  const title = (input.title ?? s.recommendation.actionTitle).trim();
  if (!title) throw new CommandError("조치 제목을 입력해주세요.", "VALIDATION", { title: "필수" });
  const dup = db.actions.find((a) => a.signalKey === s.key && a.title === title && !["done", "dismissed"].includes(a.status));
  if (dup) throw new CommandError("같은 신호에 같은 조치가 이미 진행 중입니다.", "DUPLICATE");
  if (input.assigneeUserId && !db.users.some((u) => u.id === input.assigneeUserId)) throw new CommandError("담당자를 찾을 수 없습니다.");
  const at = nowIso(ctx);
  const f = siteFinancials(db0, s.siteId);
  const status: ActionStatus = input.assigneeUserId ? "assigned" : "recommended";
  const action: ActionItem = {
    id: uid("act"),
    signalKey: s.key,
    rule: s.rule,
    siteId: s.siteId,
    title,
    description: (input.description ?? s.recommendation.description).trim(),
    signalTitle: s.title,
    signalWhy: s.why,
    signalDetectedAt: s.detectedAt,
    causeEntryIds: s.causeEntryIds,
    assigneeUserId: input.assigneeUserId,
    dueDate: input.dueDate,
    status,
    createdAt: at,
    createdBy: ctx.userId,
    approvedBy: ctx.userId,
    kpiBefore: kpiSnapshot(f, at),
    notes: [],
    history: [{ at, by: ctx.userId, to: status, note: "규칙 기반 추천을 사람이 승인해 조치 생성" }],
  };
  db.actions.unshift(action);
  db.signalStates[s.key] = { status: "acknowledged", updatedAt: at, by: ctx.userId };
  const site = requireSite(db, s.siteId);
  log(
    db,
    ctx,
    "action",
    `${site.shortName} 조치 생성: ${title}${input.assigneeUserId ? ` → ${userName(db, input.assigneeUserId)} 배정` : ""}`,
    s.siteId,
    "/insights",
  );
  touch(db, ctx);
  return { db, result: { actionId: action.id } };
}

function requireAction(db: DemoDB, id: string) {
  const a = db.actions.find((x) => x.id === id);
  if (!a) throw new CommandError("조치를 찾을 수 없습니다.", "NOT_FOUND");
  return a;
}

export function assignAction(db0: DemoDB, actionId: string, assigneeUserId: string, dueDate: string | undefined, ctx: Ctx) {
  const db = clone(db0);
  const a = requireAction(db, actionId);
  if (a.status === "done") throw new CommandError("완료된 조치는 재배정할 수 없습니다.", "STATE");
  if (!db.users.some((u) => u.id === assigneeUserId)) throw new CommandError("담당자를 찾을 수 없습니다.");
  const from = a.status;
  a.assigneeUserId = assigneeUserId;
  a.dueDate = dueDate || a.dueDate;
  if (a.status === "recommended" || a.status === "on_hold") a.status = "assigned";
  a.history.push({ at: nowIso(ctx), by: ctx.userId, from, to: a.status, note: `담당자 ${userName(db, assigneeUserId)}` });
  log(db, ctx, "action", `조치 담당 배정: ${a.title} → ${userName(db, assigneeUserId)}`, a.siteId, "/insights");
  touch(db, ctx);
  return { db, result: {} };
}

const ALLOWED: Record<ActionStatus, ActionStatus[]> = {
  recommended: ["assigned", "in_progress", "on_hold", "dismissed"],
  assigned: ["in_progress", "on_hold", "dismissed"],
  in_progress: ["on_hold", "assigned"],
  on_hold: ["assigned", "in_progress", "dismissed"],
  done: [],
  dismissed: ["recommended"],
};

export function setActionStatus(db0: DemoDB, actionId: string, to: ActionStatus, note: string | undefined, ctx: Ctx) {
  const db = clone(db0);
  const a = requireAction(db, actionId);
  if (to === "done") throw new CommandError("완료는 결과 입력과 함께 처리합니다.", "STATE");
  if (!ALLOWED[a.status].includes(to)) {
    throw new CommandError(`'${ACTION_STATUS_LABEL[a.status]}' → '${ACTION_STATUS_LABEL[to]}' 변경은 할 수 없습니다.`, "STATE");
  }
  if (to === "dismissed" && !note?.trim()) throw new CommandError("무시 사유를 입력해주세요.", "VALIDATION", { note: "필수" });
  const from = a.status;
  a.status = to;
  a.history.push({ at: nowIso(ctx), by: ctx.userId, from, to, note });
  log(db, ctx, "action", `조치 상태: ${a.title} ${ACTION_STATUS_LABEL[from]} → ${ACTION_STATUS_LABEL[to]}`, a.siteId, "/insights");
  touch(db, ctx);
  return { db, result: {} };
}

export function addActionNote(db0: DemoDB, actionId: string, text: string, photoDataUrl: string | undefined, ctx: Ctx) {
  const db = clone(db0);
  const a = requireAction(db, actionId);
  if (!text.trim() && !photoDataUrl) throw new CommandError("메모 또는 사진을 추가해주세요.");
  let photoId: string | undefined;
  if (photoDataUrl) {
    photoId = uid("ph");
    db.photos.push({ id: photoId, siteId: a.siteId, actionId, dataUrl: photoDataUrl, caption: "조치 확인 사진", createdAt: nowIso(ctx), createdBy: ctx.userId });
  }
  a.notes.push({ at: nowIso(ctx), by: ctx.userId, text: text.trim(), photoId });
  log(db, ctx, "action_note", `조치 메모: ${a.title}`, a.siteId, "/my-actions");
  touch(db, ctx);
  return { db, result: {} };
}

export interface CompleteActionInput {
  result: string;
  claimAmount?: number;
  registerChangeOrder?: boolean;
  confirm?: boolean; // 관리자/대표가 결과 확인까지 함께 처리
  idempotencyKey?: string;
}

/** 변경공사 청구 건 이름: 조치 이름이 아니라 공사 범위로 (예: 설계변경 추가공사 — 변경 구간 유리 차액…) */
function changeOrderTitle(db: DemoDB, a: ActionItem): string {
  if (a.rule !== "UNBILLED_CHANGE") return `${a.title} — 청구 검토분`;
  const note = db.costEntries.find((e) => a.causeEntryIds.includes(e.id) && e.note.trim())?.note.replace(/\s*\(개략\)\s*$/, "").trim();
  return `설계변경 추가공사${note ? ` — ${note}` : ""}`;
}

export function completeAction(db0: DemoDB, actionId: string, input: CompleteActionInput, ctx: Ctx) {
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const a = requireAction(db, actionId);
  if (a.status === "done") throw new CommandError("이미 완료된 조치입니다.", "STATE");
  if (a.status === "dismissed") throw new CommandError("무시된 조치는 완료할 수 없습니다.", "STATE");
  if (!input.result?.trim()) throw new CommandError("조치 결과를 입력해주세요.", "VALIDATION", { result: "필수" });
  if (input.registerChangeOrder) validateAmount(input.claimAmount, "claimAmount");
  const at = nowIso(ctx);
  const site = requireSite(db, a.siteId);

  let coId: string | undefined;
  if (input.registerChangeOrder && input.claimAmount) {
    const co: ChangeOrder = {
      id: uid("co"),
      siteId: a.siteId,
      title: changeOrderTitle(db, a),
      amount: input.claimAmount,
      status: "review",
      requestedAt: at,
      sourceEntryIds: a.causeEntryIds,
      sourceActionId: a.id,
      note: "조치 결과로 등록된 변경공사 청구 검토 건 (직접비 기준) — 원청(발주처) 승인 전까지 계약·이익 미반영",
    };
    db.changeOrders.push(co);
    coId = co.id;
  }

  const from = a.status;
  a.status = "done";
  a.result = input.result.trim();
  a.claimAmount = input.registerChangeOrder ? input.claimAmount : undefined;
  a.changeOrderId = coId;
  a.completedAt = at;
  a.completedBy = ctx.userId;
  a.history.push({ at, by: ctx.userId, from, to: "done", note: input.result.trim() });

  const fAfter = siteFinancials(db, a.siteId);
  const responseMinutes = Math.max(0, Math.round((new Date(at).getTime() - new Date(a.signalDetectedAt).getTime()) / 60000));
  const confirmed = !!input.confirm;
  const proof: ProofEvent = {
    proof_event_id: uid("pe"),
    event_type: "RISK_RESPONSE",
    site_id: a.siteId,
    trigger: a.signalTitle,
    decision: a.title,
    decision_method: DECISION_METHOD,
    why: a.signalWhy,
    human_approval: { by: a.approvedBy, at: a.createdAt },
    action: `${a.title}${a.assigneeUserId ? ` (담당: ${userName(db, a.assigneeUserId)})` : ""}`,
    action_id: a.id,
    result: input.result.trim() + (coId ? ` · 변경공사 청구 검토 ${fmtMan(input.claimAmount ?? 0)} 등록(승인 전, 이익 미반영)` : ""),
    kpi_before: {
      "예상이익률": fmtPct(a.kpiBefore.marginPct),
      "예상이익": fmtEok(a.kpiBefore.expectedProfit),
      "총예상원가(EAC)": fmtEok(a.kpiBefore.eac),
      "청구 검토·승인대기 변경공사": fmtMan(a.kpiBefore.pendingClaimAmount),
    },
    kpi_after: {
      "예상이익률": fmtPct(fAfter.marginPct),
      "예상이익": fmtEok(fAfter.expectedProfit),
      "총예상원가(EAC)": fmtEok(fAfter.eac),
      "청구 검토·승인대기 변경공사": fmtMan(fAfter.pendingChangeAmount),
    },
    data_source: "DEMO_LOCAL",
    user_id: ctx.userId,
    created_at: at,
    result_confirmed_at: confirmed ? at : undefined,
    confirmed_by: confirmed ? ctx.userId : undefined,
    evidence_link: `/sites/${a.siteId}`,
    status: confirmed ? "confirmed" : "recorded",
    response_minutes: responseMinutes,
  };
  db.proofEvents.unshift(proof);
  a.proofEventId = proof.proof_event_id;
  log(db, ctx, "proof", `${site.shortName} 조치 완료 → Proof Event 기록 (${confirmed ? "결과 확인" : "확인 대기"})`, a.siteId, "/evidence");
  touch(db, ctx);
  return { db, result: { proofEventId: proof.proof_event_id, changeOrderId: coId } };
}

export function confirmProofEvent(db0: DemoDB, proofId: string, ctx: Ctx) {
  const db = clone(db0);
  const p = db.proofEvents.find((x) => x.proof_event_id === proofId);
  if (!p) throw new CommandError("Proof Event를 찾을 수 없습니다.", "NOT_FOUND");
  if (p.status === "confirmed") throw new CommandError("이미 결과 확인된 기록입니다.", "STATE");
  p.status = "confirmed";
  p.result_confirmed_at = nowIso(ctx);
  p.confirmed_by = ctx.userId;
  log(db, ctx, "proof", `Proof Event 결과 확인: ${p.decision}`, p.site_id, "/evidence");
  touch(db, ctx);
  return { db, result: {} };
}

// ───────────────────────── 파트너 포털 Closed Loop ─────────────────────────

export function createPartnerRequest(
  db0: DemoDB,
  input: { idempotencyKey: string; siteId: string; title: string; description: string; desiredDate?: string; type?: PartnerRequest["type"] },
  ctx: Ctx,
) {
  const errors: Record<string, string> = {};
  const user = db0.users.find((u) => u.id === ctx.userId);
  if (user?.role === "partner" && !user.partnerSiteIds?.includes(input.siteId)) throw new CommandError("이 현장에 대한 요청 권한이 없습니다.", "STATE");
  requireSite(db0, input.siteId);
  if (!input.title?.trim()) errors.title = "요청 제목을 입력해주세요.";
  if (input.title?.length > 80) errors.title = "제목은 80자 이내";
  if (!input.description?.trim()) errors.description = "요청 내용을 입력해주세요.";
  if (input.description?.length > 800) errors.description = "내용은 800자 이내";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const req: PartnerRequest = {
    id: uid("pr"),
    siteId: input.siteId,
    partnerUserId: ctx.userId,
    type: input.type ?? "change_review",
    title: input.title.trim(),
    description: input.description.trim(),
    desiredDate: input.desiredDate || undefined,
    status: "received",
    createdAt: at,
    updatedAt: at,
    history: [{ at, status: "received", by: ctx.userId }],
  };
  db.partnerRequests.unshift(req);
  const site = requireSite(db, input.siteId);
  log(db, ctx, "partner", `발주처 요청 접수: ${site.shortName} · ${req.title}`, input.siteId, "/insights");
  touch(db, ctx);
  return { db, result: { requestId: req.id } };
}

export function updatePartnerRequest(
  db0: DemoDB,
  requestId: string,
  input: { status: PartnerRequestStatus; reply?: string; registerChangeOrder?: { title: string; amount: number } },
  ctx: Ctx,
) {
  const db = clone(db0);
  const r = db.partnerRequests.find((x) => x.id === requestId);
  if (!r) throw new CommandError("요청을 찾을 수 없습니다.", "NOT_FOUND");
  const order: PartnerRequestStatus[] = ["received", "reviewing", "answered"];
  if (order.indexOf(input.status) <= order.indexOf(r.status)) throw new CommandError("이미 처리된 단계입니다.", "STATE");
  if (input.status === "answered" && !input.reply?.trim()) throw new CommandError("회신 내용을 입력해주세요.", "VALIDATION", { reply: "필수" });
  const at = nowIso(ctx);
  if (input.registerChangeOrder) {
    validateAmount(input.registerChangeOrder.amount, "coAmount");
    const co: ChangeOrder = {
      id: uid("co"),
      siteId: r.siteId,
      title: input.registerChangeOrder.title.trim() || r.title,
      amount: input.registerChangeOrder.amount,
      status: "review",
      requestedAt: at,
      sourceEntryIds: [],
      sourcePartnerRequestId: r.id,
      note: "발주처 요청에서 등록된 변경공사 검토 건 — 승인 전 계약·이익 미반영",
    };
    db.changeOrders.push(co);
    r.linkedChangeOrderId = co.id;
  }
  r.status = input.status;
  r.updatedAt = at;
  if (input.reply?.trim()) {
    r.reply = input.reply.trim();
    r.repliedBy = ctx.userId;
  }
  r.history.push({ at, status: input.status, by: ctx.userId, note: input.reply?.trim() });
  const site = requireSite(db, r.siteId);
  log(db, ctx, "partner", `발주처 요청 ${PARTNER_STATUS_LABEL[input.status]}: ${site.shortName} · ${r.title}`, r.siteId, "/partner");
  touch(db, ctx);
  return { db, result: {} };
}

// ───────────────────────── 정산: 변경공사·기성·입금 ─────────────────────────

export function setChangeOrderStatus(db0: DemoDB, coId: string, status: ChangeOrderStatus, approvedAmount: number | undefined, ctx: Ctx) {
  const db = clone(db0);
  const co = db.changeOrders.find((x) => x.id === coId);
  if (!co) throw new CommandError("변경공사를 찾을 수 없습니다.", "NOT_FOUND");
  if (co.status === "approved" || co.status === "rejected") throw new CommandError("이미 결정된 변경공사입니다.", "STATE");
  if (status === "review") throw new CommandError("검토 단계로 되돌릴 수 없습니다.", "STATE");
  const before = siteFinancials(db0, co.siteId);
  co.status = status;
  if (status === "approved") co.approvedAmount = validateAmount(approvedAmount ?? co.amount, "approvedAmount");
  if (status === "approved" || status === "rejected") co.decidedAt = nowIso(ctx);
  const after = siteFinancials(db, co.siteId);
  const site = requireSite(db, co.siteId);
  log(
    db,
    ctx,
    "change_order",
    status === "approved"
      ? `${site.shortName} 변경공사 승인 ${fmtMan(co.approvedAmount ?? 0)} → 변경 반영 계약 ${fmtEok(before.adjustedContract)} → ${fmtEok(after.adjustedContract)}, 이익률 ${fmtPct(before.marginPct)} → ${fmtPct(after.marginPct)}`
      : `${site.shortName} 변경공사 ${status === "submitted" ? "발주처 청구" : "반려"}: ${co.title}`,
    co.siteId,
    "/finance",
  );
  touch(db, ctx);
  return { db, result: { before, after } };
}

export function addBilling(db0: DemoDB, input: { siteId: string; amount: number; billedDate: string; idempotencyKey?: string }, ctx: Ctx) {
  requireSite(db0, input.siteId);
  validateAmount(input.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.billedDate)) throw new CommandError("청구일을 입력해주세요.", "VALIDATION", { billedDate: "필수" });
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const round = db.billings.filter((b) => b.siteId === input.siteId).length + 1;
  db.billings.push({ id: uid("bill"), siteId: input.siteId, round, amount: input.amount, billedDate: input.billedDate, status: "confirmed" });
  const site = requireSite(db, input.siteId);
  log(db, ctx, "billing", `${site.shortName} ${round}차 기성청구 확정 ${fmtMan(input.amount)}`, input.siteId, "/finance");
  touch(db, ctx);
  return { db, result: {} };
}

export function addPayment(db0: DemoDB, input: { siteId: string; amount: number; receivedDate: string; idempotencyKey?: string }, ctx: Ctx) {
  const f = siteFinancials(db0, input.siteId);
  validateAmount(input.amount);
  if (input.amount > f.outstanding) throw new CommandError(`수금액이 미수금(${fmtMan(f.outstanding)})보다 클 수 없습니다.`, "VALIDATION", { amount: "미수금 초과" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate)) throw new CommandError("입금일을 입력해주세요.", "VALIDATION", { receivedDate: "필수" });
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  db.payments.push({ id: uid("pay"), siteId: input.siteId, amount: input.amount, receivedDate: input.receivedDate });
  const site = requireSite(db, input.siteId);
  log(db, ctx, "payment", `${site.shortName} 입금 ${fmtMan(input.amount)} 등록 → 미수금 ${fmtMan(f.outstanding)} → ${fmtMan(f.outstanding - input.amount)}`, input.siteId, "/finance");
  touch(db, ctx);
  return { db, result: {} };
}

export function setThresholds(db0: DemoDB, t: RiskThresholds, ctx: Ctx) {
  const vals = Object.values(t);
  if (vals.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 365)) throw new CommandError("기준값은 0~365 범위 숫자");
  const db = clone(db0);
  db.thresholds = { ...t };
  log(db, ctx, "settings", "위험 판단 기준(DEMO) 변경");
  touch(db, ctx);
  return { db, result: {} };
}

// ───────────────────────── CSV 가져오기 ─────────────────────────

export interface CsvCostRow {
  line: number;
  site_code: string;
  date: string;
  category: CostCategory;
  amount: number;
  forecast_impact: Exclude<ForecastImpact, "baseline">;
  reason: CostReason;
  note: string;
}

export function importCostRows(db0: DemoDB, rows: CsvCostRow[], idempotencyKey: string, ctx: Ctx) {
  if (!rows.length) throw new CommandError("가져올 행이 없습니다.");
  const db = clone(db0);
  claimKey(db, idempotencyKey);
  const at = nowIso(ctx);
  const touched = new Set<string>();
  for (const r of rows) {
    const site = db.sites.find((s) => s.code === r.site_code);
    if (!site) throw new CommandError(`${r.line}행: 현장코드를 찾을 수 없습니다.`);
    db.costEntries.push({
      id: uid("ce"),
      siteId: site.id,
      category: r.category,
      amount: r.amount,
      date: r.date,
      forecastImpact: r.forecast_impact,
      reason: r.reason,
      note: r.note || "CSV 가져오기",
      source: "CSV",
      createdBy: ctx.userId,
      createdAt: at,
      status: "active",
    });
    touched.add(site.shortName);
  }
  log(db, ctx, "csv", `CSV 원가 ${rows.length}건 가져오기 (${[...touched].join(", ")})`, undefined, "/settings");
  touch(db, ctx);
  return { db, result: { count: rows.length } };
}
