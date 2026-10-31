/**
 * 운영 관리 명령 — 현장 등록·수정, 잔여예상원가 재추정, 공정률, 회사 설정, 공무 원가 확인.
 * commands.ts와 같은 순수 함수 규칙: (db, input, ctx) → { db, result }
 */
import type { CompanySettings, CostCategory, CostForecast, DemoDB, Site, SiteStatus } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { siteFinancials, snapshotOf } from "@/lib/domain/calc";
import { CATEGORY_LABEL, COST_CATEGORIES } from "@/lib/domain/labels";
import { fmtEok, fmtMan, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { CommandError, MAX_AMOUNT, claimKey, clone, log, nowIso, requireSite, touch, validateAmount, type Ctx } from "./commands";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: SiteStatus[] = ["active", "hold", "completed"];

function nonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_AMOUNT;
}

// ───────────────────────── 현장 등록·수정 ─────────────────────────

export interface SaveSiteInput {
  /** 없으면 신규 등록 */
  id?: string;
  name: string;
  shortName: string;
  workType: string;
  region: string;
  clientName: string;
  status: SiteStatus;
  startDate: string;
  endDate: string;
  managerUserId?: string;
  fieldUserId?: string;
  /** 원 계약금액 (공급가액). 변경계약은 변경공사로 관리 */
  contractAmount: number;
  signedDate?: string;
  /** 실행예산 (원가 항목 5종) */
  budgets: Record<CostCategory, number>;
  stages?: { id?: string; name: string; startDate: string; endDate: string; progressPct?: number }[];
  illustration?: Site["illustration"];
  idempotencyKey?: string;
}

export function saveSite(db0: DemoDB, input: SaveSiteInput, ctx: Ctx) {
  const errors: Record<string, string> = {};
  const name = input.name?.trim() ?? "";
  const shortName = input.shortName?.trim() ?? "";
  if (!name) errors.name = "현장명을 입력해주세요.";
  if (name.length > 80) errors.name = "80자 이내";
  if (!shortName) errors.shortName = "약칭을 입력해주세요 (예: A현장).";
  if (shortName.length > 20) errors.shortName = "20자 이내";
  if (!input.clientName?.trim()) errors.clientName = "원청·발주처를 입력해주세요.";
  if (!DATE_RE.test(input.startDate ?? "")) errors.startDate = "착공일을 선택해주세요.";
  if (!DATE_RE.test(input.endDate ?? "")) errors.endDate = "준공 예정일을 선택해주세요.";
  if (DATE_RE.test(input.startDate ?? "") && DATE_RE.test(input.endDate ?? "") && input.endDate < input.startDate) errors.endDate = "준공 예정일이 착공일보다 빠릅니다.";
  if (!STATUSES.includes(input.status)) errors.status = "상태를 선택해주세요.";
  try {
    validateAmount(input.contractAmount, "contractAmount");
  } catch (e) {
    errors.contractAmount = e instanceof CommandError ? Object.values(e.fieldErrors)[0] ?? e.message : "계약금액 확인";
  }
  for (const c of COST_CATEGORIES) {
    if (!nonNegInt(input.budgets?.[c])) errors[`budgets.${c}`] = `${CATEGORY_LABEL[c]} 실행예산은 0 이상 원 단위 정수`;
  }
  const budgetSum = COST_CATEGORIES.reduce((s, c) => s + (nonNegInt(input.budgets?.[c]) ? input.budgets[c] : 0), 0);
  if (!errors["budgets.material"] && budgetSum <= 0) errors["budgets.material"] = "실행예산을 1개 항목 이상 입력해주세요.";
  if (input.signedDate && !DATE_RE.test(input.signedDate)) errors.signedDate = "계약일 형식";
  if (input.fieldUserId && !db0.users.some((u) => u.id === input.fieldUserId && u.role === "field")) errors.fieldUserId = "현장 담당자를 다시 선택해주세요.";
  if (input.managerUserId && !db0.users.some((u) => u.id === input.managerUserId && (u.role === "manager" || u.role === "ceo"))) errors.managerUserId = "본사 담당자를 다시 선택해주세요.";
  const stages = (input.stages ?? []).filter((s) => s.name?.trim());
  stages.forEach((s, i) => {
    if (!DATE_RE.test(s.startDate) || !DATE_RE.test(s.endDate) || s.endDate < s.startDate) errors[`stages.${i}`] = "공정 단계 기간을 확인해주세요.";
    if (s.progressPct !== undefined && (s.progressPct < 0 || s.progressPct > 100)) errors[`stages.${i}`] = "공정률은 0~100";
  });
  const dupShort = db0.sites.find((s) => s.shortName === shortName && s.id !== input.id);
  if (dupShort) errors.shortName = "같은 약칭의 현장이 있습니다.";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const isNew = !input.id;
  const id = input.id ?? uid("site");
  let site = db.sites.find((s) => s.id === id);
  if (!isNew && !site) throw new CommandError("현장을 찾을 수 없습니다.", "NOT_FOUND");

  const stageRows = stages.map((s) => ({ id: s.id ?? uid("stg"), name: s.name.trim(), startDate: s.startDate, endDate: s.endDate, progressPct: Math.round(s.progressPct ?? 0) }));
  if (!site) {
    const year = input.startDate.slice(0, 4);
    const seq = db.sites.filter((s) => s.code.includes(year)).length + 1;
    site = {
      id,
      code: `TK-${year}-${String(seq).padStart(3, "0")}`,
      name,
      shortName,
      workType: input.workType?.trim() || "창호·유리",
      region: input.region?.trim() || "",
      clientId: uid("client"),
      clientName: input.clientName.trim(),
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      progressPct: 0,
      managerUserId: input.managerUserId ?? "",
      fieldUserId: input.fieldUserId ?? "",
      stages: stageRows,
      illustration: input.illustration ?? "office",
    };
    db.sites.push(site);
  } else {
    Object.assign(site, {
      name,
      shortName,
      workType: input.workType?.trim() || site.workType,
      region: input.region?.trim() ?? site.region,
      clientName: input.clientName.trim(),
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      managerUserId: input.managerUserId ?? site.managerUserId,
      fieldUserId: input.fieldUserId ?? site.fieldUserId,
      stages: input.stages ? stageRows : site.stages,
      illustration: input.illustration ?? site.illustration,
    });
  }

  // 계약 — 원 계약금액과 실행예산 합계(계획 이익률의 기준)
  const contract = db.contracts.find((c) => c.siteId === id);
  const prevAmount = contract?.contractAmount;
  if (contract) {
    contract.contractAmount = input.contractAmount;
    contract.plannedCostTotal = budgetSum;
    if (input.signedDate) contract.signedDate = input.signedDate;
  } else {
    db.contracts.push({ siteId: id, contractAmount: input.contractAmount, signedDate: input.signedDate ?? input.startDate, plannedCostTotal: budgetSum });
  }
  // 실행예산
  for (const c of COST_CATEGORIES) {
    const b = db.budgets.find((x) => x.siteId === id && x.category === c);
    if (b) b.amount = input.budgets[c];
    else db.budgets.push({ siteId: id, category: c, amount: input.budgets[c] });
  }
  // 신규 현장: 잔여예상원가 = 실행예산 (아직 발생 원가 없음)
  if (isNew) {
    for (const c of COST_CATEGORIES) db.forecasts.push({ siteId: id, category: c, remaining: input.budgets[c], basisDate: todayIso(ctx.now), basisAt: at, note: "현장 등록 시 실행예산 기준" });
    db.baseline[id] = snapshotOf(siteFinancials(db, id));
  }

  log(
    db,
    ctx,
    "site",
    isNew
      ? `${shortName} 현장 등록 — 계약 ${fmtEok(input.contractAmount)} · 실행예산 ${fmtEok(budgetSum)}`
      : `${shortName} 현장 정보 수정${prevAmount !== undefined && prevAmount !== input.contractAmount ? ` — 원 계약 ${fmtEok(prevAmount)} → ${fmtEok(input.contractAmount)}` : ""}`,
    id,
    `/sites/${id}`,
  );
  touch(db, ctx);
  return { db, result: { siteId: id, created: isNew } };
}

// ───────────────────────── 잔여예상원가 재추정 ─────────────────────────

export interface UpdateForecastInput {
  siteId: string;
  /** 지금부터 준공까지 더 들어갈 원가 (항목별) */
  remaining: Record<CostCategory, number>;
  note?: string;
  idempotencyKey?: string;
}

export function updateForecast(db0: DemoDB, input: UpdateForecastInput, ctx: Ctx) {
  requireSite(db0, input.siteId);
  const errors: Record<string, string> = {};
  for (const c of COST_CATEGORIES) if (!nonNegInt(input.remaining?.[c])) errors[`remaining.${c}`] = `${CATEGORY_LABEL[c]}: 0 이상 원 단위 정수`;
  if ((input.note ?? "").length > 200) errors.note = "200자 이내";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const before = siteFinancials(db0, input.siteId);
  for (const c of COST_CATEGORIES) {
    const row: CostForecast = { siteId: input.siteId, category: c, remaining: input.remaining[c], basisDate: todayIso(ctx.now), basisAt: at, note: input.note?.trim() || "잔여예상 재추정" };
    const i = db.forecasts.findIndex((f) => f.siteId === input.siteId && f.category === c);
    if (i >= 0) db.forecasts[i] = row;
    else db.forecasts.push(row);
  }
  const after = siteFinancials(db, input.siteId);
  const site = requireSite(db, input.siteId);
  log(db, ctx, "forecast", `${site.shortName} 잔여예상원가 재추정 ${fmtEok(before.remaining)} → ${fmtEok(after.remaining)} · EAC ${fmtEok(before.eac)} → ${fmtEok(after.eac)}`, input.siteId, `/sites/${input.siteId}`);
  touch(db, ctx);
  return { db, result: { before, after } };
}

// ───────────────────────── 공정률 ─────────────────────────

export interface UpdateProgressInput {
  siteId: string;
  progressPct: number;
  stages?: { id: string; progressPct: number }[];
}

export function updateProgress(db0: DemoDB, input: UpdateProgressInput, ctx: Ctx) {
  requireSite(db0, input.siteId);
  const bad = (v: unknown) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100;
  if (bad(input.progressPct) || (input.stages ?? []).some((s) => bad(s.progressPct))) throw new CommandError("공정률은 0~100 사이로 입력해주세요.", "VALIDATION", { progressPct: "0~100" });
  const db = clone(db0);
  const site = requireSite(db, input.siteId);
  const prev = site.progressPct;
  site.progressPct = Math.round(input.progressPct);
  for (const s of input.stages ?? []) {
    const st = site.stages.find((x) => x.id === s.id);
    if (st) st.progressPct = Math.round(s.progressPct);
  }
  log(db, ctx, "progress", `${site.shortName} 공정률 ${prev}% → ${site.progressPct}%`, site.id, `/sites/${site.id}`);
  touch(db, ctx);
  return { db, result: { progressPct: site.progressPct } };
}

// ───────────────────────── 회사 설정 ─────────────────────────

export type CompanySettingsInput = Partial<CompanySettings> & { companyName?: string };

export function setCompanySettings(db0: DemoDB, input: CompanySettingsInput, ctx: Ctx) {
  const errors: Record<string, string> = {};
  if (input.costApproval !== undefined && input.costApproval !== "immediate" && input.costApproval !== "review") errors.costApproval = "반영 방식을 선택해주세요.";
  if (input.laborDayRate !== undefined && (!Number.isInteger(input.laborDayRate) || input.laborDayRate < 10_000 || input.laborDayRate > 5_000_000)) errors.laborDayRate = "일당은 1만~500만 원 사이 정수";
  if (input.companyName !== undefined && (!input.companyName.trim() || input.companyName.length > 60)) errors.companyName = "회사명 (60자 이내)";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  const prev = db.settings ?? DEFAULT_SETTINGS;
  db.settings = {
    costApproval: input.costApproval ?? prev.costApproval,
    laborDayRate: input.laborDayRate ?? prev.laborDayRate,
  };
  if (input.companyName) db.company = { ...db.company, name: input.companyName.trim() };
  log(db, ctx, "settings", `운영 설정 변경 — 원가 반영: ${db.settings.costApproval === "review" ? "본사 공무 확인 후" : "저장 즉시"} · 기본 일당 ${fmtMan(db.settings.laborDayRate)}`);
  touch(db, ctx);
  return { db, result: { settings: db.settings } };
}

// ───────────────────────── 공무 원가 확인 ─────────────────────────

export interface ReviewCostEntryInput {
  entryId: string;
  decision: "approve" | "reject";
  /** 승인 시 공무 확정 금액 (견적·세금계산서 기준). 없으면 현장 입력 금액 */
  amount?: number;
  note?: string;
}

export function reviewCostEntry(db0: DemoDB, input: ReviewCostEntryInput, ctx: Ctx) {
  const db = clone(db0);
  const e = db.costEntries.find((x) => x.id === input.entryId);
  if (!e) throw new CommandError("원가 이벤트를 찾을 수 없습니다.", "NOT_FOUND");
  if (e.status !== "pending") throw new CommandError("확인 대기 중인 원가가 아닙니다.", "STATE");
  if (input.decision === "reject" && !input.note?.trim()) throw new CommandError("반려 사유를 입력해주세요.", "VALIDATION", { note: "필수" });
  const before = siteFinancials(db0, e.siteId);
  const at = nowIso(ctx);
  if (input.decision === "approve") {
    if (input.amount !== undefined && input.amount !== e.amount) {
      validateAmount(input.amount);
      e.editHistory = [...(e.editHistory ?? []), { at, by: ctx.userId, before: { amount: e.amount, category: e.category, note: e.note } }];
      e.amount = input.amount;
      e.qty = undefined;
    }
    e.status = "active";
  } else {
    e.status = "rejected";
  }
  e.reviewedAt = at;
  e.reviewedBy = ctx.userId;
  e.reviewNote = input.note?.trim() || undefined;
  const after = siteFinancials(db, e.siteId);
  const site = requireSite(db, e.siteId);
  log(
    db,
    ctx,
    "cost_review",
    input.decision === "approve"
      ? `${site.shortName} ${CATEGORY_LABEL[e.category]} ${fmtMan(e.amount)} 공무 확인 → 손익 반영 (EAC ${fmtEok(before.eac)} → ${fmtEok(after.eac)})`
      : `${site.shortName} ${CATEGORY_LABEL[e.category]} ${fmtMan(e.amount)} 공무 반려 — ${e.reviewNote}`,
    e.siteId,
    `/sites/${e.siteId}`,
  );
  touch(db, ctx);
  return { db, result: { before, after } };
}
