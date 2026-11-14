/**
 * 운영 관리 명령 — 현장 등록·수정, 잔여예상원가 재추정, 공정률, 회사 설정, 공무 원가 확인.
 * commands.ts와 같은 순수 함수 규칙: (db, input, ctx) → { db, result }
 */
import { normalizeOfficePhone } from "@/lib/domain/intake";
import type { CompanySettings, CostCategory, CostEntry, CostForecast, DemoDB, ForecastChange, Site, SiteStatus } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { siteFinancials, snapshotOf } from "@/lib/domain/calc";
import { CATEGORY_LABEL, COST_CATEGORIES } from "@/lib/domain/labels";
import { fmtEok, fmtMan, todayIso } from "@/lib/domain/format";
import { stagesWeightedPct, syncStageDone } from "@/lib/domain/schedule";
import { uid } from "@/lib/domain/ids";
import { laborEstimate } from "@/lib/domain/labor";
import { monthBounds } from "@/lib/domain/monthClose";
import { CommandError, MAX_AMOUNT, MAX_CONTRACT, claimKey, clone, log, nowIso, pastCalendarDate, requireSite, touch, validateAmount, type Ctx } from "./commands";

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
  /** basePct: 수정 창을 열 때의 공정률 — 그 뒤 현장이 바꿨고 이 창에서는 손대지 않았으면 현장 값을 지킨다 (D-65 점검 반영) */
  stages?: { id?: string; name: string; startDate: string; endDate: string; progressPct?: number; basePct?: number }[];
  illustration?: Site["illustration"];
  /** ‘준공’으로 바꿀 때 하자보증 준공(인도)일 — 보증 기간은 넣었는데 준공일이 비어 있을 때만 (D-71) */
  warrantyCompletedDate?: string;
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
    validateAmount(input.contractAmount, "contractAmount", MAX_CONTRACT);
  } catch (e) {
    errors.contractAmount = e instanceof CommandError ? Object.values(e.fieldErrors)[0] ?? e.message : "계약금액 확인";
  }
  for (const c of COST_CATEGORIES) {
    if (!nonNegInt(input.budgets?.[c])) errors[`budgets.${c}`] = `${CATEGORY_LABEL[c]} 실행예산은 0 이상 원 단위 정수`;
  }
  const budgetSum = COST_CATEGORIES.reduce((s, c) => s + (nonNegInt(input.budgets?.[c]) ? input.budgets[c] : 0), 0);
  if (!errors["budgets.material"] && budgetSum <= 0) errors["budgets.material"] = "실행예산을 1개 항목 이상 입력해주세요.";
  if (input.signedDate && !DATE_RE.test(input.signedDate)) errors.signedDate = "계약일 형식";
  // 착공일을 하자보증 준공일 뒤로 옮기지 않게 (D-70 점검 반영)
  const wDone = input.id ? db0.sites.find((s) => s.id === input.id)?.warranty?.completedDate : undefined;
  if (wDone && DATE_RE.test(input.startDate ?? "") && input.startDate > wDone) errors.startDate = `하자보증 준공일(${wDone})보다 늦을 수 없습니다.`;
  // 현장 ‘준공’ ↔ 하자보증 준공일 (D-71): 보증 기간이 있고 준공일이 비어 있을 때만 같이 넣는다 — 이미 있는 준공일은 현장 상세에서 고친다
  const wSite = input.id ? db0.sites.find((s) => s.id === input.id) : undefined;
  const wDate = input.warrantyCompletedDate;
  if (wDate !== undefined && wDate !== null && wDate !== "") {
    if (typeof wDate !== "string" || !DATE_RE.test(wDate)) errors.warrantyCompletedDate = "날짜 형식을 확인해 주세요.";
    else if (input.status !== "completed") errors.warrantyCompletedDate = "현장 상태가 ‘준공’일 때만 넣을 수 있습니다.";
    // 이미 준공 상태인 현장을 고칠 때마다 오늘 날짜가 들어가지 않게 — ‘준공’으로 바꿀 때만 (D-71 점검 반영)
    else if (wSite?.status === "completed") errors.warrantyCompletedDate = "이미 준공 상태인 현장입니다 — 준공일은 현장 상세 ‘발주처·하자보증’에서 넣어 주세요.";
    else if (!wSite?.warranty) errors.warrantyCompletedDate = "하자보증 기간을 먼저 넣어 주세요 (현장 상세 ‘발주처·하자보증’).";
    else if (wSite.warranty.completedDate) errors.warrantyCompletedDate = "이미 준공일이 있습니다 — 현장 상세 ‘발주처·하자보증’에서 고치세요.";
    else if (wDate > todayIso(ctx.now)) errors.warrantyCompletedDate = "준공일은 오늘이나 그 전으로 넣어 주세요.";
    else if (!pastCalendarDate(wDate, ctx)) errors.warrantyCompletedDate = "없는 날짜입니다. 다시 골라 주세요.";
    else if (DATE_RE.test(input.startDate ?? "") && wDate < input.startDate) errors.warrantyCompletedDate = "준공일이 착공일보다 빠릅니다.";
  }
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

  const current = new Map((db0.sites.find((x) => x.id === input.id)?.stages ?? []).map((st) => [st.id, st.progressPct]));
  const stageRows = stages.map((s) => {
    const cur = s.id ? current.get(s.id) : undefined;
    const untouched = s.basePct !== undefined && Math.round(s.progressPct ?? 0) === Math.round(s.basePct);
    // 본사가 창을 연 사이 현장 보고로 공정률이 바뀌었고 이 창에서는 그대로 두었다면 → 현장 값 유지 (덮어쓰기 방지)
    const progressPct = cur !== undefined && untouched && cur !== s.basePct ? cur : Math.round(s.progressPct ?? 0);
    const doneOn = s.id ? db0.sites.find((x) => x.id === input.id)?.stages.find((x) => x.id === s.id)?.doneOn : undefined;
    return { id: s.id ?? uid("stg"), name: s.name.trim(), startDate: s.startDate, endDate: s.endDate, progressPct, ...(doneOn ? { doneOn } : {}) };
  });
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
      // 단계를 넣고 등록하면 전체 공정률도 단계에서 (기간 가중) — 0%로 남지 않게 (D-77 리허설)
      progressPct: stagesWeightedPct(stageRows) ?? 0,
      managerUserId: input.managerUserId ?? "",
      fieldUserId: input.fieldUserId ?? "",
      stages: stageRows,
      illustration: input.illustration ?? "office",
    };
    db.sites.push(site);
  } else {
    // 전체 공정률이 지금 단계 계산과 같았으면(본사가 따로 고치지 않음) 새 단계로 다시 계산 — 따로 고친 값은 지킨다 (D-77)
    const prevWeighted = stagesWeightedPct(site.stages);
    if (input.stages && (!site.progressManual || site.progressPct === 0 || (prevWeighted !== null && prevWeighted === site.progressPct))) {
      const next = stagesWeightedPct(stageRows);
      if (next !== null) site.progressPct = next;
    }
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
  syncStageDone(site, todayIso(ctx.now));
  const warrantyStart = !isNew && site.warranty && !site.warranty.completedDate && typeof wDate === "string" && wDate ? wDate : null;
  if (warrantyStart) site.warranty = { ...site.warranty!, completedDate: warrantyStart, setAt: at, setBy: ctx.userId };

  // 계약 — 원 계약금액과 실행예산 합계(계획 이익률의 기준)
  const contract = db.contracts.find((c) => c.siteId === id);
  const prevAmount = contract?.contractAmount;
  const prevBudgets = Object.fromEntries(COST_CATEGORIES.map((c) => [c, db.budgets.find((x) => x.siteId === id && x.category === c)?.amount])) as Record<string, number | undefined>;
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
    site.baselineAt = at;
  }
  // 현장에서 아직 아무것도 입력하지 않았는데 계약금액·실행예산을 고치면 = 등록 때 잘못 친 값을 바로잡는 것 —
  // 손익 기준(‘현장 등록 시점’)과 잔여예상원가를 새 값으로 다시 잡는다. 그대로 두면 대시보드·대표 보고서에 ‘기준 대비 ▲17억’이 영원히 남았다 (D-77 리허설)
  let rebased = false;
  const budgetsChanged = !isNew && COST_CATEGORIES.some((c) => prevBudgets[c] !== input.budgets[c]);
  if (!isNew && (prevAmount !== input.contractAmount || budgetsChanged)) {
    const live = db.costEntries.some((e) => e.siteId === id && (e.source === "FIELD" || e.source === "PC")) || db.reports.some((r) => r.siteId === id && !r.importBatchId);
    if (!live) {
      if (budgetsChanged) {
        db.forecasts = db.forecasts.filter((f) => f.siteId !== id);
        for (const c of COST_CATEGORIES) db.forecasts.push({ siteId: id, category: c, remaining: input.budgets[c], basisDate: todayIso(ctx.now), basisAt: at, note: "실행예산 수정 반영 (현장 입력 전)" });
      }
      db.baseline[id] = snapshotOf(siteFinancials(db, id));
      site.baselineAt = at;
      rebased = true;
    }
  }

  log(
    db,
    ctx,
    "site",
    isNew
      ? `${shortName} 현장 등록 — 계약 ${fmtEok(input.contractAmount)} · 실행예산 ${fmtEok(budgetSum)}`
      : `${shortName} 현장 정보 수정${prevAmount !== undefined && prevAmount !== input.contractAmount ? ` — 원 계약 ${fmtEok(prevAmount)} → ${fmtEok(input.contractAmount)}` : ""}${rebased ? " · 현장 입력 전이라 손익 기준을 새 값으로 다시 잡음" : ""}${warrantyStart ? ` · 하자보증 준공 ${warrantyStart.replace(/-/g, ".")}부터` : ""}`,
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
  /** 준공 현장 원가 마감 (D-79) — 월 마감 화면에서 ‘남은 예상원가를 정리’할 때 */
  closeout?: boolean;
  idempotencyKey?: string;
}

/** 잔여예상 재추정 이력 보관 개수 */
export const FORECAST_CHANGES_KEEP = 1000;

export function updateForecast(db0: DemoDB, input: UpdateForecastInput, ctx: Ctx) {
  requireSite(db0, input.siteId);
  const errors: Record<string, string> = {};
  for (const c of COST_CATEGORIES) if (!nonNegInt(input.remaining?.[c])) errors[`remaining.${c}`] = `${CATEGORY_LABEL[c]}: 0 이상 원 단위 정수`;
  if ((input.note ?? "").length > 200) errors.note = "200자 이내";
  // 준공 원가 마감은 이익을 크게 바꾸므로 왜 그렇게 닫는지 남긴다 (D-79 대표 점검 — 노무 0원인 채 메모 없이 0으로 닫혀 이익률 76%)
  else if (input.closeout === true && (input.note ?? "").trim().length < 2) errors.note = "마감 메모를 적어 주세요 (예: 남은 청구서 없음 — 협력업체 확인)";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  // 원가 마감은 준공한 현장만 — 진행 중 현장에 마감 표시가 남으면 나중에 준공해도 마감 알림이 안 떴다 (D-79 버그 배시 m-3)
  if (input.closeout === true && db0.sites.find((s) => s.id === input.siteId)?.status !== "completed") throw new CommandError("준공한 현장만 원가 마감할 수 있습니다. 진행 중이면 ‘잔여예상원가 재추정’을 쓰세요.", "STATE");

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const before = siteFinancials(db0, input.siteId);
  const closeout = input.closeout === true;
  const note = input.note?.trim() || (closeout ? "준공 원가 마감" : "잔여예상 재추정");
  for (const c of COST_CATEGORIES) {
    const row: CostForecast = { siteId: input.siteId, category: c, remaining: input.remaining[c], basisDate: todayIso(ctx.now), basisAt: at, note };
    const i = db.forecasts.findIndex((f) => f.siteId === input.siteId && f.category === c);
    if (i >= 0) db.forecasts[i] = row;
    else db.forecasts.push(row);
  }
  const after = siteFinancials(db, input.siteId);
  const site = requireSite(db, input.siteId);
  // 이익을 바꾼 재추정은 이력으로 남긴다 — 월 마감 ‘이달 예상이익을 바꾼 일’이 더해서 맞도록 (D-79)
  if (before.eac !== after.eac || closeout) {
    const change: ForecastChange = { id: uid("fc"), siteId: input.siteId, at, by: ctx.userId, note, eacBefore: before.eac, eacAfter: after.eac, ...(closeout ? { closeout: true as const } : {}) };
    db.forecastChanges = [change, ...(db.forecastChanges ?? [])].slice(0, FORECAST_CHANGES_KEEP);
  }
  log(db, ctx, "forecast", `${site.shortName} ${closeout ? "준공 원가 마감 — 잔여예상원가" : "잔여예상원가 재추정"} ${fmtEok(before.remaining)} → ${fmtEok(after.remaining)} · 예상 총원가 ${fmtEok(before.eac)} → ${fmtEok(after.eac)}`, input.siteId, `/sites/${input.siteId}`);
  touch(db, ctx);
  return { db, result: { before, after } };
}

// ───────────────────────── 월 마감 노무 정산 (D-79) ─────────────────────────

export interface SettleLaborInput {
  siteId: string;
  /** YYYY-MM */
  month: string;
  /** 넣을 노무비 (원) — 기본값은 화면이 ‘출력 기준 추정 − 입력된 노무비’로 채운다. 실제 지급액을 알면 그 금액으로 */
  amount: number;
  note?: string;
  idempotencyKey?: string;
}

/**
 * 한 달 노무비를 출력(작업 인원) 기준으로 맞춘다 — 본사 입력이라 바로 반영(공무 확인 끝난 것으로 기록).
 * 같은 현장·같은 달에 정산은 한 번만 (두 번 넣으면 노무비가 두 번 들어가므로). 고치려면 원가 목록에서 그 건을 고치거나 되돌린다.
 */
export function settleLabor(db0: DemoDB, input: SettleLaborInput, ctx: Ctx) {
  const site0 = requireSite(db0, input.siteId);
  // 같은 요청을 다시 보낸 것이면 ‘이미 넣었습니다’보다 먼저 중복으로 알린다 (D-79 버그 배시)
  if (input.idempotencyKey && db0.idempotencyKeys.includes(input.idempotencyKey)) throw new CommandError("이미 저장된 요청입니다. (중복 저장 방지)", "DUPLICATE");
  const errors: Record<string, string> = {};
  const today = todayIso(ctx.now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month ?? "")) errors.month = "달을 확인해 주세요.";
  // 달이 끝난 뒤에만 — 진행 중인 달에 정산하면 그 뒤 출력·반려로 생긴 모자람이 가려지고 다시 정산도 막혔다 (D-79 버그 배시 M-1)
  else if (monthBounds(input.month).to >= today) errors.month = "달이 끝난 뒤에 정산할 수 있습니다 — 그 달 출력·노무비가 아직 들어오는 중입니다.";
  if (!Number.isInteger(input.amount) || input.amount <= 0) errors.amount = "0보다 큰 금액(원)을 넣어 주세요.";
  else if (input.amount < 10_000) errors.amount = "1만 원 이상으로 넣어 주세요 (단위 확인).";
  else if (input.amount > MAX_AMOUNT) errors.amount = `${fmtEok(MAX_AMOUNT)} 이하로 넣어 주세요.`;
  // 추정으로 넣는 원가라 근거를 남긴다 (D-79 공무 점검 — 외주·직영이 섞인 추정을 그대로 넣기 쉬움)
  if ((input.note ?? "").length > 200) errors.note = "200자 이내";
  else if ((input.note ?? "").trim().length < 2) errors.note = "근거를 적어 주세요 (예: 10월 노무비 명세 기준 · 추정 계상, 명세 오면 고침)";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const b = monthBounds(input.month);
  const to = b.to;
  if (site0.startDate > to) throw new CommandError("그 달에는 아직 착공 전인 현장입니다.", "STATE");
  const dup = db0.costEntries.find((e) => e.siteId === input.siteId && e.settle?.month === input.month && (e.status === "active" || e.status === "pending"));
  if (dup) throw new CommandError(`${site0.shortName} ${Number(input.month.slice(5))}월 노무 정산은 이미 넣었습니다 (${fmtMan(dup.amount)}). 고치려면 원가 목록에서 그 건을 고치거나 되돌리세요.`, "STATE");
  const est = laborEstimate(db0, site0, b.from, to);
  if (est.estimate <= 0) throw new CommandError("그 달 작업 인원(출력) 기록이 없어 정산할 기준이 없습니다. 노무비는 현장 보고·원가 입력으로 넣어 주세요.", "STATE");

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const before = siteFinancials(db0, input.siteId);
  const m = Number(input.month.slice(5));
  const short = est.estimate - est.actual;
  const basis = `${m}월 출력 기준 노무 정산 (추정 ${fmtMan(est.estimate)} − 입력 ${fmtMan(est.actual)}${short > 0 && short !== input.amount ? ` = 모자람 ${fmtMan(short)} 중 ${fmtMan(input.amount)}` : ""})`;
  const entry: CostEntry = {
    id: uid("ce"),
    siteId: input.siteId,
    category: "labor",
    amount: input.amount,
    date: to,
    forecastImpact: "within_forecast",
    reason: "planned",
    note: [basis, input.note?.trim()].filter(Boolean).join(" · "),
    source: "PC",
    createdBy: ctx.userId,
    createdAt: at,
    status: "active",
    reviewedAt: at,
    reviewedBy: ctx.userId,
    settle: { month: input.month, estimate: est.estimate, actualBefore: est.actual },
  };
  db.costEntries.push(entry);
  const after = siteFinancials(db, input.siteId);
  log(db, ctx, "cost", `${site0.shortName} ${m}월 노무 정산 ${fmtMan(input.amount)} 입력 (출력 기준 추정 ${fmtMan(est.estimate)} · 그동안 입력 ${fmtMan(est.actual)})`, input.siteId, `/sites/${input.siteId}?tab=cost`);
  touch(db, ctx);
  return { db, result: { entryId: entry.id, before, after } };
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
  // 본사가 공정률을 고쳐 100%가 된 단계도 완료일을 남긴다 (준공 보고서 · D-72 점검 반영)
  syncStageDone(site, todayIso(ctx.now));
  // 전체를 단계 계산과 다르게 정했으면 표시 — 그 뒤 현장 보고가 단계 값으로 덮지 않게 (D-78)
  const weighted = stagesWeightedPct(site.stages);
  if (weighted !== null && weighted !== site.progressPct) site.progressManual = true;
  else delete site.progressManual;
  log(db, ctx, "progress", `${site.shortName} 공정률 ${prev}% → ${site.progressPct}%${site.progressManual ? " (본사 직접 지정 — 단계 계산과 다름)" : ""}`, site.id, `/sites/${site.id}`);
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
  if (input.attendanceMode !== undefined && input.attendanceMode !== "gps" && input.attendanceMode !== "qr") errors.attendanceMode = "출근 방식을 선택해주세요.";
  if (input.morningBrief !== undefined && typeof input.morningBrief !== "boolean") errors.morningBrief = "아침 알림 켜기·끄기를 골라 주세요.";
  if (input.briefSentOn !== undefined) errors.briefSentOn = "바꿀 수 없는 값입니다.";
  if (input.intakeSeq !== undefined) errors.intakeSeq = "바꿀 수 없는 값입니다.";
  // 하자 접수 화면·안내문에 보일 회사 전화번호 (비우면 지움 · D-74 점검 10차)
  const publicRaw = typeof input.publicPhone === "string" ? input.publicPhone.trim() : undefined;
  const publicPhone = publicRaw ? normalizeOfficePhone(publicRaw) : undefined;
  if (input.publicPhone !== undefined && typeof input.publicPhone !== "string") errors.publicPhone = "전화번호를 확인해 주세요. (예: 02-1234-5678)";
  else if (publicRaw && !publicPhone) errors.publicPhone = "전화번호를 확인해 주세요. (예: 02-1234-5678, 1588-1234)";
  if (input.teamRates !== undefined) {
    if (!Array.isArray(input.teamRates) || input.teamRates.length > 60) errors.teamRates = "팀 단가 목록을 확인해주세요.";
    else
      input.teamRates.forEach((t, i) => {
        if (!t || typeof t.team !== "string" || !t.team.trim() || t.team.length > 30) errors[`teamRates.${i}`] = "팀 이름 (30자 이내)";
        else if (!Number.isInteger(t.dayRate) || t.dayRate < 10_000 || t.dayRate > 2_000_000) errors[`teamRates.${i}`] = "단가는 1만~200만 원 사이 정수";
      });
  }
  const phone = input.helpPhone?.trim();
  if (phone && !/^[0-9+][0-9\- ]{6,18}[0-9]$/.test(phone)) errors.helpPhone = "전화번호 형식 (예: 02-1234-5678)";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  const prev = db.settings ?? DEFAULT_SETTINGS;
  db.settings = {
    costApproval: input.costApproval ?? prev.costApproval,
    laborDayRate: input.laborDayRate ?? prev.laborDayRate,
    ...(prev.sampleData ? { sampleData: true } : {}),
    ...((input.attendanceMode ?? prev.attendanceMode) ? { attendanceMode: input.attendanceMode ?? prev.attendanceMode } : {}),
    ...((input.teamRates ?? prev.teamRates)?.length ? { teamRates: (input.teamRates ?? prev.teamRates)!.map((t) => ({ team: t.team.trim(), dayRate: t.dayRate })) } : {}),
    ...((input.helpPhone !== undefined ? phone : prev.helpPhone) ? { helpPhone: input.helpPhone !== undefined ? phone : prev.helpPhone } : {}),
    // 개인위치정보 규칙은 여기서 바꾸지 않는다 (대표 전용 setLocationPolicy · D-43)
    ...(prev.location ? { location: prev.location } : {}),
    // 아침 알림: 끈 경우만 남긴다(기본 켬) · 보낸 날 기록은 매일 점검만 바꾼다 (D-72)
    ...((input.morningBrief ?? prev.morningBrief) === false ? { morningBrief: false } : {}),
    ...(prev.briefSentOn ? { briefSentOn: prev.briefSentOn } : {}),
    ...((input.publicPhone !== undefined ? publicPhone : prev.publicPhone) ? { publicPhone: input.publicPhone !== undefined ? publicPhone! : prev.publicPhone } : {}),
    // 접수 번호 일련번호는 접수가 들어올 때만 바뀐다
    ...(prev.intakeSeq ? { intakeSeq: prev.intakeSeq } : {}),
  };
  if (input.companyName) db.company = { ...db.company, name: input.companyName.trim() };
  log(db, ctx, "settings", `운영 설정 변경 — 원가 반영: ${db.settings.costApproval === "review" ? "본사 공무 확인 후" : "저장 즉시"} · 기본 일당 ${fmtMan(db.settings.laborDayRate)} · 출근 ${db.settings.attendanceMode === "qr" ? "현장 QR+GPS" : "GPS"}${(prev.morningBrief === false) !== (db.settings.morningBrief === false) ? ` · 아침 알림 ${db.settings.morningBrief === false ? "끔" : "켬"}` : ""}`);
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
      ? `${site.shortName} ${CATEGORY_LABEL[e.category]} ${fmtMan(e.amount)} 공무 확인 → 손익 반영 (예상 총원가 ${fmtEok(before.eac)} → ${fmtEok(after.eac)})`
      : `${site.shortName} ${CATEGORY_LABEL[e.category]} ${fmtMan(e.amount)} 공무 반려 — ${e.reviewNote}`,
    e.siteId,
    `/sites/${e.siteId}`,
  );
  touch(db, ctx);
  return { db, result: { before, after } };
}

// ───────────────────────── 하자보증 (D-70) ─────────────────────────

export interface WarrantyInput {
  siteId: string;
  /** 보증 기간 (개월, 계약서 기준) */
  months?: number;
  /** 준공·인도일 (비우면 ‘준공 전’) */
  completedDate?: string;
  note?: string;
  /** true면 보증 정보를 지운다 */
  clear?: boolean;
}

export function setSiteWarranty(db0: DemoDB, input: WarrantyInput, ctx: Ctx) {
  const site0 = db0.sites.find((s) => s.id === input.siteId);
  if (!site0) throw new CommandError("현장을 찾을 수 없습니다.", "NOT_FOUND");
  const db = clone(db0);
  const site = db.sites.find((s) => s.id === input.siteId)!;
  if (input.clear === true) {
    if (!site.warranty) throw new CommandError("지울 하자보증 정보가 없습니다.", "STATE");
    delete site.warranty;
    log(db, ctx, "site", `${site.shortName} 하자보증 정보 지움`, site.id, `/sites/${site.id}?tab=requests`);
    touch(db, ctx);
    return { db, result: {} };
  }
  const errors: Record<string, string> = {};
  // 형식이 틀린 값은 조용히 바꾸거나 버리지 않고 되돌려 보낸다 (D-70 점검 반영)
  const months = input.months;
  if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 120) errors.months = "보증 기간은 1~120개월로 넣어 주세요 (계약서 기준).";
  if (input.completedDate !== undefined && input.completedDate !== null && typeof input.completedDate !== "string") errors.completedDate = "날짜 형식을 확인해 주세요.";
  const completed = typeof input.completedDate === "string" ? input.completedDate.trim() : "";
  if (completed && !DATE_RE.test(completed)) errors.completedDate = "날짜 형식을 확인해 주세요.";
  else if (completed && completed > todayIso(ctx.now)) errors.completedDate = "준공일은 오늘이나 그 전으로 넣어 주세요.";
  else if (completed && !pastCalendarDate(completed, ctx)) errors.completedDate = "없는 날짜입니다. 다시 골라 주세요.";
  else if (completed && completed < site.startDate) errors.completedDate = "준공일이 착공일보다 빠릅니다.";
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") errors.note = "메모 형식을 확인해 주세요.";
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 80) errors.note = "메모는 80자 이내";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  // 기간·준공일이 그대로면 보낸 만료 알림 기록도 그대로 (메모만 고쳐도 같은 알림이 다시 가지 않게 · D-71)
  const prev = site.warranty;
  const keepNotices = prev?.notices?.length && prev.months === months && (prev.completedDate ?? "") === completed ? { notices: prev.notices } : {};
  site.warranty = { months: months as number, ...(completed ? { completedDate: completed } : {}), ...(note ? { note } : {}), setAt: nowIso(ctx), setBy: ctx.userId, ...keepNotices };
  log(db, ctx, "site", `${site.shortName} 하자보증 ${months}개월${completed ? ` · 준공 ${completed.replace(/-/g, ".")}` : " · 준공 전"}`, site.id, `/sites/${site.id}?tab=requests`);
  touch(db, ctx);
  return { db, result: {} };
}
