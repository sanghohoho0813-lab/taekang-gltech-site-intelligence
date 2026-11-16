/**
 * 변경공사 회수 관리 (D-84) — 설계변경·발주처 요청으로 생긴 추가 원가를 변경공사로 청구했는지, 어디까지 왔는지, 얼마나 돌려받았는지.
 *
 * - 청구 안 한 추가 원가: 사유가 ‘설계변경·원청(발주처) 요청’인 추가 원가 중 어떤 변경공사의 근거로도 쓰지 않은 것 (반려된 건의 원가는 그 건의 ‘다시 청구’로)
 * - 진행 중: 청구 검토·발주처 청구(승인 대기) — 며칠째인지, 다음 확인할 날, 마지막 기록
 * - 결정됨: 승인·반려 — 연결된 추가 원가 대비 승인 금액 (회수율). 다시 청구한 반려 건은 새 건으로 대신 센다
 *
 * 금액은 화면 계산용이며 계약·이익 반영은 calc.ts(승인된 금액만)를 따른다.
 */
import type { ChangeOrder, ChangeOrderLog, CostEntry, DemoDB, Site } from "./types";
import { shiftDate } from "./attendance";
import { uid } from "./ids";

/** 변경공사로 청구를 검토할 추가 원가 사유 — 위험 신호 ‘설계변경 추가원가 — 변경공사 미등록’과 같은 기준 */
export const CLAIMABLE_REASONS: ReadonlySet<string> = new Set(["design_change"]);
/** 변경공사 하나에 남기는 기록 수 */
export const CO_LOG_MAX = 50;
/** 다음 확인할 날은 오늘부터 이 날 수 안 */
export const CO_FOLLOW_MAX_DAYS = 180;
/** 청구 검토 단계로 이 날 수를 넘기면 ‘청구 전 오래됨’ */
export const CO_REVIEW_STALE_DAYS = 7;

/** 다음 확인할 날 — 내일부터 180일 안의 달력 날짜. 없음·null은 통과. 문제가 있으면 오류 문구 */
export function followUpError(v: unknown, today: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) return "날짜 형식을 확인해 주세요.";
  if (v <= today) return "다음 확인할 날은 내일 이후로 정해 주세요.";
  if (v > shiftDate(today, CO_FOLLOW_MAX_DAYS)) return `다음 확인할 날은 ${CO_FOLLOW_MAX_DAYS}일 안으로 정해 주세요.`;
  return undefined;
}

/** 기록 하나 더하기 — 최근 50개만 남긴다 */
export function pushCoLog(co: ChangeOrder, entry: Omit<ChangeOrderLog, "id">) {
  co.log = [...(co.log ?? []), { id: uid("col"), ...entry }].slice(-CO_LOG_MAX);
}

export const coOpen = (c: Pick<ChangeOrder, "status">) => c.status === "review" || c.status === "submitted";

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** 원가 → 그 원가를 근거로 청구한(진행 중·승인) 변경공사 */
export function coByEntry(db: Pick<DemoDB, "changeOrders">): Map<string, ChangeOrder> {
  const m = new Map<string, ChangeOrder>();
  for (const c of db.changeOrders) if (c.status !== "rejected") for (const id of c.sourceEntryIds) m.set(id, c);
  return m;
}

/** 원가 → 반려된 변경공사 (진행 중·승인 건이 없을 때만 의미 있음) */
export function rejectedByEntry(db: Pick<DemoDB, "changeOrders">): Map<string, ChangeOrder> {
  const m = new Map<string, ChangeOrder>();
  for (const c of [...db.changeOrders].filter((x) => x.status === "rejected").sort((a, b) => (a.decidedAt ?? "").localeCompare(b.decidedAt ?? ""))) for (const id of c.sourceEntryIds) m.set(id, c);
  return m;
}

/** 며칠째인지 — 발주처에 청구했으면 청구한 날부터, 아니면 등록한 날부터 (한국 날짜) */
export function coDays(c: ChangeOrder, today: string): number {
  return Math.max(0, dayDiff(kstDate(c.submittedAt ?? c.requestedAt), today));
}

/** 한 줄 단계 설명 — ‘발주처 청구 14일째’ · ‘청구 검토 3일째’ · ‘승인 11/5’ */
export function coStageText(c: ChangeOrder, today: string): string {
  const md = (iso: string) => {
    const d = kstDate(iso);
    return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  };
  if (c.status === "submitted") return `발주처 청구 ${coDays(c, today)}일째`;
  if (c.status === "review") return `청구 검토 ${coDays(c, today)}일째`;
  if (c.status === "approved") return `승인 ${c.decidedAt ? md(c.decidedAt) : ""}`.trim();
  return `반려 ${c.decidedAt ? md(c.decidedAt) : ""}`.trim();
}

export interface CoRow {
  co: ChangeOrder;
  site?: Site;
  linked: CostEntry[];
  /** 연결된 추가 원가 합 (취소·반려된 원가는 빼고) */
  linkedCost: number;
  days: number;
  /** 다음 확인할 날이 오늘이거나 지났다 */
  followDue: boolean;
  /** 청구 검토로 오래 머묾 (발주처에 아직 안 보냄) */
  reviewStale: boolean;
  last?: ChangeOrderLog;
  /** 반려된 건을 다시 청구한 새 건 (있으면) */
  reclaimedBy?: ChangeOrder;
}

export interface CoBoard {
  /** 청구 안 한 설계변경·발주처 요청 추가 원가 */
  unclaimed: CostEntry[];
  /** 다른 사유(공기 지연·물량 증가 등) 추가 원가 중 청구 안 한 것 — 발주처 사유면 청구할 수 있다 */
  otherExtra: CostEntry[];
  open: CoRow[];
  decided: CoRow[];
  totals: {
    unclaimed: number;
    unclaimedN: number;
    open: number;
    openN: number;
    /** 진행 중 중 가장 오래된 날 수 */
    oldest: number;
    followDue: number;
    reviewStale: number;
    /** 결정된 청구의 근거 추가 원가 합 (다시 청구한 반려 건 제외) */
    decidedCost: number;
    /** 그중 승인 금액 합 */
    recovered: number;
    /** 회수율 (%) — 결정된 청구가 없으면 null */
    recoveryPct: number | null;
  };
}

export function coRow(db: DemoDB, c: ChangeOrder, today: string): CoRow {
  const linked = c.sourceEntryIds.map((id) => db.costEntries.find((e) => e.id === id)).filter((e): e is CostEntry => !!e);
  const live = linked.filter((e) => e.status === "active" || e.status === "pending");
  const open = coOpen(c);
  return {
    co: c,
    site: db.sites.find((s) => s.id === c.siteId),
    linked,
    linkedCost: live.reduce((a, e) => a + e.amount, 0),
    days: coDays(c, today),
    followDue: open && !!c.nextFollowUp && c.nextFollowUp <= today,
    reviewStale: c.status === "review" && coDays(c, today) > CO_REVIEW_STALE_DAYS,
    last: c.log?.length ? c.log[c.log.length - 1] : undefined,
    reclaimedBy: c.status === "rejected" ? db.changeOrders.find((x) => x.reclaimOf === c.id) : undefined,
  };
}

export function coBoard(db: DemoDB, today: string, siteId?: string): CoBoard {
  const cos = db.changeOrders.filter((c) => !siteId || c.siteId === siteId);
  // 한 번이라도 변경공사 근거로 쓴 원가는 ‘청구 안 함’이 아니다 — 반려된 건은 그 건의 ‘다시 청구’로 (위험 신호 ‘변경공사 미등록’과 같은 기준)
  const used = new Set(db.changeOrders.flatMap((c) => c.sourceEntryIds));
  const extra = db.costEntries.filter((e) => (!siteId || e.siteId === siteId) && e.status === "active" && e.forecastImpact === "additional" && !used.has(e.id));
  const byDate = (a: CostEntry, b: CostEntry) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
  const unclaimed = extra.filter((e) => CLAIMABLE_REASONS.has(e.reason)).sort(byDate);
  const otherExtra = extra.filter((e) => !CLAIMABLE_REASONS.has(e.reason)).sort(byDate);
  const open = cos
    .filter(coOpen)
    .map((c) => coRow(db, c, today))
    .sort((a, b) => Number(b.followDue) - Number(a.followDue) || b.days - a.days);
  const decided = cos
    .filter((c) => !coOpen(c))
    .map((c) => coRow(db, c, today))
    .sort((a, b) => (b.co.decidedAt ?? "").localeCompare(a.co.decidedAt ?? ""));
  const counted = decided.filter((r) => r.linkedCost > 0 && !r.reclaimedBy);
  const decidedCost = counted.reduce((a, r) => a + r.linkedCost, 0);
  const recovered = counted.reduce((a, r) => a + (r.co.status === "approved" ? (r.co.approvedAmount ?? r.co.amount) : 0), 0);
  return {
    unclaimed,
    otherExtra,
    open,
    decided,
    totals: {
      unclaimed: unclaimed.reduce((a, e) => a + e.amount, 0),
      unclaimedN: unclaimed.length,
      open: open.reduce((a, r) => a + r.co.amount, 0),
      openN: open.length,
      oldest: open.reduce((a, r) => Math.max(a, r.days), 0),
      followDue: open.filter((r) => r.followDue).length,
      reviewStale: open.filter((r) => r.reviewStale).length,
      decidedCost,
      recovered,
      recoveryPct: decidedCost > 0 ? Math.round((recovered / decidedCost) * 1000) / 10 : null,
    },
  };
}

/** 처리 대기 ‘변경공사 챙길 것’ — 확인할 날이 됐거나 지난 것 + 청구 검토로 오래 머문 것 */
export function coAttentionCount(db: DemoDB, today: string): number {
  return db.changeOrders.filter(coOpen).filter((c) => (c.nextFollowUp && c.nextFollowUp <= today) || (c.status === "review" && coDays(c, today) > CO_REVIEW_STALE_DAYS)).length;
}

export const CO_LOG_LABEL: Record<ChangeOrderLog["kind"], string> = {
  created: "등록",
  submitted: "발주처 청구",
  follow_up: "발주처 확인·독촉",
  client_reply: "발주처 답변",
  note: "메모",
  approved: "승인",
  rejected: "반려",
};
