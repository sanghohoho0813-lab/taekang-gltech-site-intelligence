/**
 * 실제 자료 가져오기 명령 (계약 3단계 ‘실제 자료 연결’). 서버는 브라우저 미리보기를 믿지 않고 CSV 원문을 다시 검증한다.
 * 중복(이미 있는 기록)은 건너뛰고, 오류가 한 줄이라도 있으면 아무것도 넣지 않는다 (전부 아니면 전무).
 */
import type { ChangeOrder, CrewCheck, DemoDB, ImportBatch } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { siteFinancials, snapshotOf } from "@/lib/domain/calc";
import { fmtMan, todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { IMPORT_SPECS, planImport, type BillingRow, type ChangeRow, type CostRow, type CrewRow, type ImportKind, type RateRow } from "@/lib/domain/importers";
import { CommandError, claimKey, clone, log, nowIso, touch, type Ctx } from "./commands";

export interface ImportDataInput {
  kind: ImportKind;
  text: string;
  idempotencyKey: string;
  /** 이관 자료를 ‘운영 중 변화’로 보지 않도록 손익 기준선을 다시 잡는다 (기본 켬) */
  rebaseline?: boolean;
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

  // 손익 기준선 다시 잡기 — 이관한 과거 자료가 ‘운영 시작 후 변화’로 보이지 않게
  const rebased: string[] = [];
  const prevBaseline: NonNullable<ImportBatch["prevBaseline"]> = {};
  if (input.rebaseline !== false && (plan.kind === "billing" || plan.kind === "change" || plan.kind === "cost")) {
    for (const id of sites) {
      prevBaseline[id] = db0.baseline[id] ?? null;
      db.baseline[id] = snapshotOf(siteFinancials(db, id));
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
    ...(rebased.length ? { prevBaseline } : {}),
    ...(plan.kind === "rates" ? { prevTeamRates: (db0.settings?.teamRates ?? []).map((t) => ({ ...t })) } : {}),
  };
  db.importBatches = [batch, ...(db.importBatches ?? [])].slice(0, 100);

  const names = [...sites].map((id) => db.sites.find((s) => s.id === id)?.shortName ?? id);
  const amountNote = plan.summary.some((s) => s.amount) && plan.kind !== "crew" ? ` · 합계 ${fmtMan(plan.summary.reduce((a, s) => a + (s.amount ?? 0), 0))}` : "";
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
    if (cos.some((c) => c.decidedAt && c.decidedAt > b0.at)) throw new CommandError("가져온 뒤 승인·반려가 바뀐 변경공사가 있어 통째로 취소할 수 없습니다.", "STATE");
    removed = cos.length;
    db.changeOrders = db.changeOrders.filter((x) => !mine(x));
  } else if (b0.kind === "crew") {
    // 같은 날 현장에서 다시 보내 인원이 바뀐 기록은 남긴다
    const list = (db.crewChecks ?? []).filter((c) => mine(c) && !c.history?.length);
    removed = list.length;
    const ids = new Set(list.map((c) => c.id));
    db.crewChecks = (db.crewChecks ?? []).filter((c) => !ids.has(c.id));
  } else if (b0.kind === "rates") {
    removed = b0.count;
    db.settings = { ...(db.settings ?? DEFAULT_SETTINGS), teamRates: (b0.prevTeamRates ?? []).map((t) => ({ ...t })) };
    if (!db.settings.teamRates?.length) delete db.settings.teamRates;
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
  for (const [id, snap] of Object.entries(b0.prevBaseline ?? {})) {
    if (snap) db.baseline[id] = snap;
  }
  const b = (db.importBatches ?? []).find((x) => x.id === b0.id)!;
  b.undoneAt = at;
  b.undoneBy = ctx.userId;
  log(db, ctx, "import", `자료 가져오기 취소 — ${IMPORT_SPECS[b0.kind].title} ${removed}건 되돌림`, b0.siteIds.length === 1 ? b0.siteIds[0] : undefined, "/data");
  touch(db, ctx);
  return { db, result: { removed } };
}
