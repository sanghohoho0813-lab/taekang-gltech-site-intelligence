/**
 * 실제 자료 가져오기 명령 (계약 3단계 ‘실제 자료 연결’). 서버는 브라우저 미리보기를 믿지 않고 CSV 원문을 다시 검증한다.
 * 중복(이미 있는 기록)은 건너뛰고, 오류가 한 줄이라도 있으면 아무것도 넣지 않는다 (전부 아니면 전무).
 */
import type { ChangeOrder, CrewCheck, DemoDB, FieldReport, FinancialSnapshot, ImportBatch } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { siteFinancials, snapshotOf } from "@/lib/domain/calc";
import { fmtMan, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { IMPORT_SPECS, planImport, type BillingRow, type ChangeRow, type CostRow, type CrewRow, type ImportKind, type MaterialRow, type ProgressRow, type RateRow } from "@/lib/domain/importers";
import { CommandError, claimKey, clone, log, nowIso, touch, type Ctx } from "./commands";

export interface ImportDataInput {
  kind: ImportKind;
  text: string;
  idempotencyKey: string;
  /** 이관 자료를 ‘운영 중 변화’로 보지 않도록 손익 기준선을 다시 잡는다 (기본 켬) */
  rebaseline?: boolean;
}

const SNAP_KEYS = ["contractAmount", "approvedChange", "adjustedContract", "incurred", "remaining", "eac", "expectedProfit"] as const;

/** 기준선에 변화량을 더하거나(sign 1) 빼고(sign −1) 이익률은 다시 계산 */
function shiftSnap(b: FinancialSnapshot, d: Partial<FinancialSnapshot>, sign: 1 | -1): FinancialSnapshot {
  const out = { ...b };
  for (const k of SNAP_KEYS) out[k] = b[k] + sign * (d[k] ?? 0);
  out.marginPct = out.adjustedContract > 0 ? (out.expectedProfit / out.adjustedContract) * 100 : 0;
  return out;
}

/** 한국 시간 그날 오전 9시를 기록 시각으로 */
const isoOf = (date: string) => new Date(`${date}T09:00:00+09:00`).toISOString();

export function importData(db0: DemoDB, input: ImportDataInput, ctx: Ctx) {
  if (!input || !(input.kind in IMPORT_SPECS)) throw new CommandError("자료 종류를 선택해주세요.", "VALIDATION", { kind: "필수" });
  const plan = planImport(db0, input.kind, String(input.text ?? ""), todayIso(ctx.now));
  if (plan.errors.length) {
    const first = plan.errors[0];
    throw new CommandError(`${plan.errors.length}개 오류가 있어 아무것도 넣지 않았습니다. (${first.line}행 ${first.field}: ${first.message})`, "VALIDATION", { file: `${plan.errors.length}개 오류` });
  }
  if (!plan.rows.length) throw new CommandError("새로 넣을 행이 없습니다 — 모두 이미 있는 기록입니다.", "STATE");

  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  const at = nowIso(ctx);
  const sites = new Set<string>();
  const batchId = uid("imp");

  if (plan.kind === "billing") {
    for (const r of plan.rows as BillingRow[]) {
      sites.add(r.siteId);
      if (r.kind === "billing") db.billings.push({ id: uid("bill"), siteId: r.siteId, round: 0, amount: r.amount, billedDate: r.date, status: "confirmed", importBatchId: batchId });
      else db.payments.push({ id: uid("pay"), siteId: r.siteId, amount: r.amount, receivedDate: r.date, importBatchId: batchId });
    }
    // 차수는 청구일 순서로 다시 매긴다 (예전 기성을 나중에 넣어도 1차·2차가 맞도록)
    renumberRounds(db, sites);
  } else if (plan.kind === "change") {
    for (const r of plan.rows as ChangeRow[]) {
      sites.add(r.siteId);
      const co: ChangeOrder = {
        id: uid("co"),
        siteId: r.siteId,
        title: r.title,
        amount: r.amount,
        status: r.status,
        requestedAt: isoOf(r.requestedDate),
        sourceEntryIds: [],
        note: r.note ? `${r.note} (자료 가져오기)` : "자료 가져오기 — 기존 변경공사 이관",
        importBatchId: batchId,
        ...(r.status === "approved" ? { approvedAmount: r.approvedAmount ?? r.amount } : {}),
        ...(r.status === "approved" || r.status === "rejected" ? { decidedAt: isoOf(r.decidedDate ?? r.requestedDate) } : {}),
      };
      db.changeOrders.push(co);
    }
  } else if (plan.kind === "crew") {
    db.crewChecks = db.crewChecks ?? [];
    for (const r of plan.rows as CrewRow[]) {
      sites.add(r.siteId);
      const c: CrewCheck = { id: uid("crew"), siteId: r.siteId, workDate: r.date, team: r.team, kind: r.kind, headcount: r.headcount, at, by: ctx.userId, imported: true, importBatchId: batchId };
      db.crewChecks.push(c);
    }
  } else if (plan.kind === "rates") {
    const prev = db.settings ?? DEFAULT_SETTINGS;
    const map = new Map((prev.teamRates ?? []).map((t) => [t.team.toLowerCase(), t]));
    for (const r of plan.rows as RateRow[]) map.set(r.team.toLowerCase(), { team: r.team, dayRate: r.dayRate });
    db.settings = { ...prev, teamRates: [...map.values()] };
  } else if (plan.kind === "material") {
    // 지난 자재 기록 — 날짜는 엑셀 그대로, 시각은 그날 오전 9시 (한국 시간)
    db.materialMoves = [...(db.materialMoves ?? [])];
    for (const r of plan.rows as MaterialRow[]) {
      sites.add(r.siteId);
      db.materialMoves.push({ id: uid("mm"), siteId: r.siteId, itemId: r.itemId, kind: r.kind, qty: r.qty, workDate: r.date, note: r.note || "자료 가져오기", at: isoOf(r.date), by: ctx.userId, imported: true, importBatchId: batchId });
    }
  } else if (plan.kind === "progress") {
    // 지난 공정 진행 기록 — 현장·날짜마다 ‘본사 확인한 보고’ 한 건으로 (공사일보·발주처 월간 보고서가 같은 기록을 읽는다)
    // 지금 공정률·단계 진행률은 바꾸지 않는다 (이력만 · D-71)
    const byDay = new Map<string, ProgressRow[]>();
    for (const r of plan.rows as ProgressRow[]) {
      sites.add(r.siteId);
      const k = `${r.siteId}|${r.date}`;
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    }
    const added: FieldReport[] = [];
    for (const [k, list] of byDay) {
      const [siteId, date] = k.split("|");
      const overall = list.find((r) => !r.stageId);
      const notes = [...new Set(list.map((r) => r.note.trim()).filter(Boolean))];
      added.push({
        id: uid("rpt"),
        siteId,
        reportDate: date,
        workDone: notes.length ? notes.join(" · ") : "지난 공정 진행 기록",
        issues: "",
        tomorrowPlan: "",
        photoIds: [],
        costEntryIds: [],
        createdBy: ctx.userId,
        createdAt: isoOf(date),
        status: "submitted",
        stages: list.filter((r) => r.stageId).map((r) => ({ stageId: r.stageId!, name: r.stageName, from: r.from, to: r.pct })),
        ...(overall ? { progress: { from: overall.from, to: overall.pct } } : {}),
        review: { status: "confirmed", at, by: ctx.userId, note: "자료 가져오기" },
        importBatchId: batchId,
      });
    }
    // 보고 목록은 새것이 앞 — 지난 기록은 뒤에, 오래된 것일수록 더 뒤에
    added.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    db.reports = [...db.reports, ...added];
  } else if (plan.kind === "cost") {
    for (const r of plan.rows as CostRow[]) {
      sites.add(r.siteId);
      db.costEntries.push({
        id: uid("ce"),
        siteId: r.siteId,
        category: r.category,
        amount: r.amount,
        date: r.date,
        forecastImpact: r.impact,
        reason: r.reason,
        note: r.note || "자료 가져오기",
        source: "CSV",
        createdBy: ctx.userId,
        createdAt: at,
        status: "active",
        importBatchId: batchId,
      });
    }
  }

  // 손익 기준선 옮기기 — 이관한 과거 자료가 ‘운영 시작 후 변화’로 보이지 않게, 이 묶음이 만든 변화만큼만 기준선에 더한다.
  // (예전에는 기준선을 지금 값으로 통째로 다시 잡아, 그 전에 현장 보고로 생긴 원가 상승까지 보고서에서 사라졌다 · D-66 점검 반영)
  const rebased: string[] = [];
  const baselineDelta: NonNullable<ImportBatch["baselineDelta"]> = {};
  if (input.rebaseline !== false && (plan.kind === "change" || plan.kind === "cost")) {
    for (const id of sites) {
      const before = snapshotOf(siteFinancials(db0, id));
      const after = snapshotOf(siteFinancials(db, id));
      const d: Partial<FinancialSnapshot> = {};
      for (const k of SNAP_KEYS) if (after[k] !== before[k]) d[k] = after[k] - before[k];
      if (!Object.keys(d).length) continue;
      const base = db0.baseline[id];
      db.baseline[id] = base ? shiftSnap(base, d, 1) : after;
      baselineDelta[id] = d;
      rebased.push(id);
    }
  }
  const batch: ImportBatch = {
    id: batchId,
    kind: plan.kind,
    at,
    by: ctx.userId,
    count: plan.rows.length,
    skipped: plan.duplicates.length,
    siteIds: [...sites],
    ...(rebased.length ? { baselineDelta } : {}),
    ...(plan.kind === "rates" ? { prevTeamRates: (db0.settings?.teamRates ?? []).map((t) => ({ ...t })), rateTeams: (plan.rows as RateRow[]).map((r) => r.team) } : {}),
  };
  db.importBatches = [batch, ...(db.importBatches ?? [])].slice(0, 100);

  const names = [...sites].map((id) => db.sites.find((s) => s.id === id)?.shortName ?? id);
  const amountNote = plan.summary.some((s) => s.amount) && plan.kind !== "crew" && plan.kind !== "material" ? ` · 합계 ${fmtMan(plan.summary.reduce((a, s) => a + (s.amount ?? 0), 0))}` : "";
  log(
    db,
    ctx,
    "import",
    `자료 가져오기 — ${IMPORT_SPECS[plan.kind].title} ${plan.rows.length}건${names.length ? ` (${names.join(", ")})` : ""}${amountNote}${plan.duplicates.length ? ` · 중복 ${plan.duplicates.length}건 건너뜀` : ""}${rebased.length ? " · 손익 기준선 재설정" : ""}`,
    sites.size === 1 ? [...sites][0] : undefined,
    "/data",
  );
  touch(db, ctx);
  return { db, result: { batchId, added: plan.rows.length, skipped: plan.duplicates.length, siteIds: [...sites], rebased } };
}

function renumberRounds(db: DemoDB, siteIds: Iterable<string>) {
  for (const id of siteIds) {
    db.billings
      .filter((b) => b.siteId === id)
      .sort((a, b) => a.billedDate.localeCompare(b.billedDate) || (a.round || 999) - (b.round || 999))
      .forEach((b, i) => (b.round = i + 1));
  }
}

export const UNDO_DAYS = 7;

/** 가져오기 1회를 통째로 취소 (7일 안, 그 뒤 바뀐 기록이 없을 때만) */
export function undoImport(db0: DemoDB, input: { batchId: string }, ctx: Ctx) {
  const b0 = (db0.importBatches ?? []).find((x) => x.id === input?.batchId);
  if (!b0) throw new CommandError("가져오기 기록을 찾을 수 없습니다.", "NOT_FOUND");
  if (b0.undoneAt) throw new CommandError("이미 취소한 가져오기입니다.", "STATE");
  const now = ctx.now ?? new Date();
  if (now.getTime() - new Date(b0.at).getTime() > UNDO_DAYS * 86_400_000) throw new CommandError(`${UNDO_DAYS}일이 지난 가져오기는 통째로 취소할 수 없습니다 — 해당 화면에서 한 건씩 고쳐주세요.`, "STATE");
  const mine = <T extends { importBatchId?: string }>(x: T) => x.importBatchId === b0.id;
  const db = clone(db0);
  const at = nowIso(ctx);
  let removed = 0;
  if (b0.kind === "billing") {
    removed = db.billings.filter(mine).length + db.payments.filter(mine).length;
    db.billings = db.billings.filter((x) => !mine(x));
    db.payments = db.payments.filter((x) => !mine(x));
    for (const id of b0.siteIds) {
      const billed = db.billings.filter((x) => x.siteId === id && x.status === "confirmed").reduce((a, x) => a + x.amount, 0);
      const paid = db.payments.filter((x) => x.siteId === id).reduce((a, x) => a + x.amount, 0);
      if (paid > billed) throw new CommandError("가져온 뒤에 입금이 더 등록되어 취소하면 미수금이 음수가 됩니다 — 해당 입금을 먼저 정리해주세요.", "STATE");
    }
    renumberRounds(db, b0.siteIds);
  } else if (b0.kind === "change") {
    const cos = db.changeOrders.filter(mine);
    // 가져온 뒤 본사가 승인·반려를 바꿨는지는 ‘가져온 그대로인지’로 본다 (결정일을 그날 9시로 넣어 오늘 날짜면 바로 취소가 막히던 문제 · D-66)
    if (cos.some((c) => c.statusChangedAt)) throw new CommandError("가져온 뒤 승인·반려가 바뀐 변경공사가 있어 통째로 취소할 수 없습니다.", "STATE");
    removed = cos.length;
    db.changeOrders = db.changeOrders.filter((x) => !mine(x));
  } else if (b0.kind === "crew") {
    // 같은 날 현장에서 다시 보내 인원이 바뀐 기록은 남긴다
    const list = (db.crewChecks ?? []).filter((c) => mine(c) && !c.history?.length);
    removed = list.length;
    const ids = new Set(list.map((c) => c.id));
    db.crewChecks = (db.crewChecks ?? []).filter((c) => !ids.has(c.id));
  } else if (b0.kind === "material") {
    const list = (db.materialMoves ?? []).filter(mine);
    removed = list.filter((m) => !m.voided).length;
    db.materialMoves = (db.materialMoves ?? []).filter((m) => !mine(m));
  } else if (b0.kind === "rates") {
    removed = b0.count;
    if (b0.rateTeams) {
      // 가져온 팀만 이전 값으로 — 그 뒤 설정에서 추가·변경한 다른 팀 단가는 지키기 (D-66 점검 반영)
      const prev = new Map((b0.prevTeamRates ?? []).map((t) => [t.team.toLowerCase(), t]));
      const touched = new Set(b0.rateTeams.map((t) => t.toLowerCase()));
      const cur = db.settings?.teamRates ?? [];
      const next = cur.flatMap((t) => (touched.has(t.team.toLowerCase()) ? (prev.has(t.team.toLowerCase()) ? [{ ...prev.get(t.team.toLowerCase())! }] : []) : [t]));
      db.settings = { ...(db.settings ?? DEFAULT_SETTINGS), teamRates: next };
    } else {
      db.settings = { ...(db.settings ?? DEFAULT_SETTINGS), teamRates: (b0.prevTeamRates ?? []).map((t) => ({ ...t })) };
    }
    if (!db.settings.teamRates?.length) delete db.settings.teamRates;
  } else if (b0.kind === "progress") {
    // 지난 기록만 지운다 — 지금 공정률은 가져올 때 바꾸지 않았으므로 되돌릴 것이 없다
    removed = db.reports.filter((r) => mine(r) && r.status !== "voided").reduce((a, r) => a + (r.stages?.length ?? 0) + (r.progress ? 1 : 0), 0);
    db.reports = db.reports.filter((r) => !mine(r));
  } else if (b0.kind === "cost") {
    for (const e of db.costEntries.filter(mine)) {
      if (e.status === "voided") continue;
      e.status = "voided";
      e.voidedAt = at;
      e.voidedBy = ctx.userId;
      e.voidReason = "자료 가져오기 취소";
      removed += 1;
    }
  }
  if (b0.baselineDelta) {
    for (const [id, d] of Object.entries(b0.baselineDelta)) if (db.baseline[id]) db.baseline[id] = shiftSnap(db.baseline[id], d, -1);
  } else {
    // 예전 방식으로 가져온 묶음 (기준선 통째 저장)
    for (const [id, snap] of Object.entries(b0.prevBaseline ?? {})) if (snap) db.baseline[id] = snap;
  }
  const b = (db.importBatches ?? []).find((x) => x.id === b0.id)!;
  b.undoneAt = at;
  b.undoneBy = ctx.userId;
  log(db, ctx, "import", `자료 가져오기 취소 — ${IMPORT_SPECS[b0.kind].title} ${removed}건 되돌림`, b0.siteIds.length === 1 ? b0.siteIds[0] : undefined, "/data");
  touch(db, ctx);
  return { db, result: { removed } };
}
