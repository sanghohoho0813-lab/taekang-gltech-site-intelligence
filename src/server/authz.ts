/**
 * 서버 권한 검사 (LIVE 모드의 실제 보안 경계).
 * 1) authorize: 역할·담당 현장·작성자 기준으로 명령 실행 가능 여부 판단 + 신뢰할 수 없는 입력을 서버 값으로 덮어쓰기
 * 2) viewFor: 역할별로 내려보낼 데이터만 남긴다 — 현장직원·발주처에게는 계약·원가·이익·기성·미수가 아예 전송되지 않음
 * 3) sanitizeResult: 명령 결과에서도 금액 정보 제거
 */
import type { ActionItem, DemoDB, SiteContract } from "@/lib/domain/types";
import { computeSignals } from "@/lib/domain/risk";
import { CommandError } from "@/lib/data/commands";
import type { CommandName } from "@/lib/data/registry";
import type { Member } from "./auth";

export class ForbiddenError extends Error {
  constructor(message = "이 작업을 할 권한이 없습니다.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const canSeeMoney = (m: Pick<Member, "role">) => m.role === "ceo" || m.role === "manager";

/** 현장직원이 다룰 수 있는 현장: 현장 담당자로 지정됐거나 사용자에 배정된 현장 */
export function fieldSiteIds(m: Member, db: DemoDB): Set<string> {
  const ids = new Set(m.siteIds);
  for (const s of db.sites) if (s.fieldUserId === m.id) ids.add(s.id);
  return ids;
}

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 실행 가능하면 (서버 값으로 보정된) 인자를 돌려주고, 아니면 ForbiddenError */
export function authorize(m: Member, name: CommandName, argsIn: unknown, db: DemoDB, now = new Date()): unknown {
  if (!argsIn || typeof argsIn !== "object") throw new CommandError("요청 형식이 올바르지 않습니다.");
  const args = { ...(argsIn as Args) };

  // 위험 신호는 클라이언트가 보낸 내용을 믿지 않고 서버에서 다시 계산한 신호로 바꾼다
  if (name === "createAction") {
    const key = str((args.signal as Args | undefined)?.key);
    const signal = computeSignals(db, now).find((s) => s.key === key);
    if (!signal) throw new CommandError("위험 신호가 이미 해소되었거나 바뀌었습니다. 화면을 새로고침해주세요.", "STATE");
    args.signal = signal;
  }

  if (canSeeMoney(m)) {
    if (name === "submitFieldReport") args.source = args.source === "FIELD" ? "FIELD" : "PC";
    return args;
  }

  if (m.role === "field") {
    const sites = fieldSiteIds(m, db);
    const entry = (id: unknown) => db.costEntries.find((e) => e.id === id);
    const action = (id: unknown): ActionItem | undefined => db.actions.find((a) => a.id === id);
    const mine = (a?: ActionItem) => !!a && a.assigneeUserId === m.id;
    switch (name) {
      case "submitFieldReport":
        if (!sites.has(str(args.siteId))) throw new ForbiddenError("담당 현장에만 보고할 수 있습니다.");
        args.source = "FIELD";
        return args;
      case "voidReport": {
        const r = db.reports.find((x) => x.id === args.reportId);
        if (!r || r.createdBy !== m.id) throw new ForbiddenError("본인이 등록한 보고만 되돌릴 수 있습니다.");
        return args;
      }
      case "voidCostEntry":
      case "editCostEntry": {
        const e = entry(args.entryId);
        if (!e || e.createdBy !== m.id || !sites.has(e.siteId)) throw new ForbiddenError("본인이 입력한 원가만 고칠 수 있습니다.");
        return args;
      }
      case "setActionStatus":
        if (!mine(action(args.actionId))) throw new ForbiddenError("배정된 조치만 처리할 수 있습니다.");
        if (!["in_progress", "on_hold"].includes(str(args.to))) throw new ForbiddenError("현장에서는 진행 시작·보류만 바꿀 수 있습니다.");
        return args;
      case "addActionNote":
      case "completeAction":
        if (!mine(action(args.actionId))) throw new ForbiddenError("배정된 조치만 처리할 수 있습니다.");
        if (name === "completeAction") {
          // 현장 완료는 '확인 대기'로 남기고, 결과 확인(확정)은 본사가 한다
          const input = { ...((args.input as Args) ?? {}) };
          input.confirm = false;
          args.input = input;
        }
        return args;
      case "updateProgress":
        if (!sites.has(str(args.siteId))) throw new ForbiddenError("담당 현장의 공정률만 바꿀 수 있습니다.");
        return args;
      default:
        throw new ForbiddenError();
    }
  }

  if (m.role === "partner") {
    if (name === "createPartnerRequest" && m.partnerSiteIds.includes(str(args.siteId))) return args;
    throw new ForbiddenError();
  }
  throw new ForbiddenError();
}

const zeroContract = (siteId: string): SiteContract => ({ siteId, contractAmount: 0, signedDate: "", plannedCostTotal: 0 });

/** 역할별로 내려보낼 데이터만 남긴다 */
export function viewFor(m: Member, db: DemoDB): DemoDB {
  const base = { ...db, idempotencyKeys: [], me: m.id };
  if (canSeeMoney(m)) return { ...base, scope: "full" };

  const users = db.users.map((u) => ({ id: u.id, role: u.role, name: u.name, title: u.title, ...(u.inactive ? { inactive: true } : {}) }));
  const empty = {
    contracts: [],
    budgets: [],
    forecasts: [],
    costEntries: [],
    reports: [],
    photos: [],
    changeOrders: [],
    billings: [],
    payments: [],
    partnerRequests: [],
    actions: [],
    proofEvents: [],
    activityLogs: [],
    baseline: {},
    signalStates: {},
  } satisfies Partial<DemoDB>;

  if (m.role === "field") {
    const sites = fieldSiteIds(m, db);
    const actions = db.actions
      .filter((a) => a.assigneeUserId === m.id)
      .map((a) => ({ ...a, kpiBefore: { ...a.kpiBefore, eac: 0, expectedProfit: 0, marginPct: 0, adjustedContract: 0, pendingClaimAmount: 0 } }));
    const actionIds = new Set(actions.map((a) => a.id));
    return {
      ...base,
      ...empty,
      scope: "field",
      users,
      sites: db.sites.filter((s) => sites.has(s.id)),
      // 계산 엔진이 깨지지 않도록 금액 0의 빈 계약만 둔다 (현장 화면은 금액을 표시하지 않음)
      contracts: [...sites].map(zeroContract),
      costEntries: db.costEntries.filter((e) => e.createdBy === m.id && sites.has(e.siteId)),
      reports: db.reports.filter((r) => sites.has(r.siteId)),
      photos: db.photos.filter((p) => sites.has(p.siteId)),
      partnerRequests: db.partnerRequests.filter((r) => sites.has(r.siteId)),
      actions,
      proofEvents: db.proofEvents
        .filter((p) => actionIds.has(p.action_id))
        .map((p) => ({ ...p, kpi_before: {}, kpi_after: {} })),
      activityLogs: db.activityLogs.filter((l) => l.by === m.id),
    };
  }

  // 발주처·협력사: 허용된 현장의 공정 정보와 본인 요청만
  const sites = new Set(m.partnerSiteIds);
  return {
    ...base,
    ...empty,
    scope: "partner",
    users: users.filter((u) => u.role !== "partner" || u.id === m.id),
    sites: db.sites.filter((s) => sites.has(s.id)),
    contracts: [...sites].map(zeroContract),
    partnerRequests: db.partnerRequests.filter((r) => sites.has(r.siteId) && r.partnerUserId === m.id),
    settings: undefined,
    thresholds: db.thresholds,
  };
}

/** 명령 결과에서 금액 정보 제거 (현장직원·발주처) */
export function sanitizeResult(m: Member, result: unknown): unknown {
  if (canSeeMoney(m) || !result || typeof result !== "object") return result;
  const r = { ...(result as Record<string, unknown>) };
  delete r.before;
  delete r.after;
  return r;
}
