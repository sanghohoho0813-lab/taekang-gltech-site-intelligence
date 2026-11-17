/**
 * 변경공사 회수 관리 (D-84) — 설계변경·발주처 요청으로 생긴 추가 원가를 변경공사로 청구했는지, 어디까지 왔는지, 얼마나 돌려받았는지.
 *
 * - 청구 안 한 추가 원가: 사유가 ‘설계변경·원청(발주처) 요청’인 추가 원가 중 어떤 변경공사의 근거로도 쓰지 않은 것 (반려된 건의 원가는 그 건의 ‘다시 청구’로)
 * - 진행 중: 청구 검토·발주처 청구(승인 대기) — 며칠째인지, 다음 확인할 날, 마지막 기록
 * - 결정됨: 승인·반려 — 연결된 추가 원가 대비 승인 금액 (회수율). 다시 청구한 반려 건은 새 건으로 대신 센다
 *
 * 금액은 화면 계산용이며 계약·이익 반영은 calc.ts(승인된 금액만)를 따른다.
 */
import type { ChangeOrder, ChangeOrderEvidence, ChangeOrderLog, CostEntry, DemoDB, EvidenceDocType, Site } from "./types";
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
  const all = [...(co.log ?? []), { id: uid("col"), ...entry }];
  // 넘치면 확인·답변·메모부터 오래된 것을 지운다 — 등록·청구·승인·반려·증빙 파일 기록은 남긴다 (D-84 버그 배시 · D-88)
  // 증빙 파일 기록은 그다음으로 지우고(올리고 지우기를 되풀이해도 등록·승인 기록이 밀려나지 않게 · D-88 점검), 그래도 넘치면 가장 오래된 것
  const key = new Set(["created", "submitted", "approved", "rejected", "no_reclaim", "evidence"]);
  while (all.length > CO_LOG_MAX) {
    let i = all.findIndex((l) => !key.has(l.kind));
    if (i < 0) i = all.findIndex((l) => l.kind === "evidence");
    all.splice(i >= 0 ? i : 0, 1);
  }
  co.log = all;
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

const mdOf = (iso: string) => {
  const d = iso.length > 10 ? kstDate(iso) : iso;
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
};

/** 한 줄 단계 설명 — ‘발주처 청구 14일째 (11/2)’ · ‘오늘 청구’ · ‘청구 검토 3일째’ · ‘승인 11/5’ */
export function coStageText(c: ChangeOrder, today: string): string {
  const d = coDays(c, today);
  if (c.status === "submitted") return d ? `발주처 청구 ${d}일째 (${mdOf(c.submittedAt ?? c.requestedAt)})` : "오늘 발주처 청구";
  if (c.status === "review") return d ? `청구 검토 ${d}일째 (${mdOf(c.requestedAt)} 등록)` : "오늘 등록 · 청구 검토";
  if (c.status === "approved") return `승인 ${c.decidedAt ? mdOf(c.decidedAt) : ""}`.trim();
  return `반려 ${c.decidedAt ? mdOf(c.decidedAt) : ""}`.trim();
}

export const APPROVAL_BASIS_LABEL: Record<NonNullable<ChangeOrder["approvalBasis"]>, string> = {
  contract: "변경계약서 날인",
  letter: "발주처 공문·메일로 승인",
  verbal: "구두 승인 (서면 대기)",
};

// ───────────── 증빙 파일 (D-88) ─────────────

export const EVIDENCE_DOC_LABEL: Record<EvidenceDocType, string> = {
  contract: "변경계약서 (날인본)",
  letter: "발주처 공문·메일",
  estimate: "견적·내역서",
  other: "그 밖의 자료",
};
/** 승인을 증명하는 서면 — 견적·내역서는 우리가 낸 것이라 승인 증빙이 아니다 */
export const WRITTEN_DOC_TYPES: ReadonlySet<EvidenceDocType> = new Set(["contract", "letter"]);
/** 변경공사 하나에 붙이는 파일 수 */
export const EVIDENCE_MAX_PER_CO = 20;
/** PDF 1개 크기 (서버 요청 한도 4.5MB 안 — base64로 4MB) */
export const EVIDENCE_PDF_MAX_BYTES = 3_000_000;

/** 이 변경공사의 증빙 파일 (올린 순서) */
export function coEvidenceOf(db: Pick<DemoDB, "coEvidence">, coId: string): ChangeOrderEvidence[] {
  return (db.coEvidence ?? []).filter((e) => e.changeOrderId === coId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 승인된 변경공사의 서면 증빙 상태 — 화면 표시용 (처리 대기 수에는 넣지 않는다).
 * - ok: 변경계약서·공문 파일이 있음
 * - verbal: 구두 승인 — 서면을 아직 안 받음(파일 없음)
 * - missing: 서면으로 승인받았다고 했거나(근거를 안 적은 옛 자료 포함) 파일이 없음
 * 승인 전·반려 건은 null
 */
export type CoPaper = "ok" | "verbal" | "missing";
export function coPaperState(c: Pick<ChangeOrder, "status" | "approvalBasis">, evidence: Pick<ChangeOrderEvidence, "docType">[]): CoPaper | null {
  if (c.status !== "approved") return null;
  if (evidence.some((e) => WRITTEN_DOC_TYPES.has(e.docType))) return "ok";
  return c.approvalBasis === "verbal" ? "verbal" : "missing";
}

export const CO_PAPER_LABEL: Record<CoPaper, string> = {
  ok: "서면 증빙 있음",
  verbal: "구두 승인 — 서면 대기",
  missing: "서면 증빙 파일 없음",
};

export interface CoRow {
  co: ChangeOrder;
  site?: Site;
  linked: CostEntry[];
  /** 연결된 추가 원가 합 (취소·반려된 원가는 빼고) */
  linkedCost: number;
  days: number;
  /** 다음 확인할 날이 오늘이거나 지났다 */
  followDue: boolean;
  /** 발주처에 청구했는데 다음 확인할 날이 없다 (D-84 대표 점검 — ‘챙길 것 0’으로 방치되던 문제) */
  noFollow: boolean;
  /** 청구 검토로 오래 머묾 (발주처에 아직 안 보냄) */
  reviewStale: boolean;
  /** 반려됐는데 다시 청구할지·손실로 정리할지 아직 안 정함 */
  reclaimUndecided: boolean;
  last?: ChangeOrderLog;
  /** 반려된 건을 다시 청구한 새 건 (있으면) */
  reclaimedBy?: ChangeOrder;
  /** 증빙 파일 (D-88) */
  evidence: ChangeOrderEvidence[];
  /** 승인 건의 서면 증빙 상태 (D-88) — 승인 전·반려는 null */
  paper: CoPaper | null;
}

export interface CoBoard {
  /** 청구 안 한 설계변경·발주처 요청 추가 원가 */
  unclaimed: CostEntry[];
  /** 다른 사유(공기 지연·물량 증가 등) 추가 원가 중 청구 안 한 것 — 발주처 사유면 청구할 수 있다 */
  otherExtra: CostEntry[];
  /** 청구하지 않기로 정한 추가 원가 (사유와 함께) */
  declined: CostEntry[];
  open: CoRow[];
  decided: CoRow[];
  totals: {
    unclaimed: number;
    unclaimedN: number;
    /** 발주처 결정 대기 (발주처에 청구한 것만) */
    submitted: number;
    submittedN: number;
    /** 아직 발주처에 안 보낸 것 (청구 검토) */
    review: number;
    reviewN: number;
    /** 발주처 결정 대기 중 가장 오래된 날 수 */
    oldest: number;
    followDue: number;
    noFollow: number;
    reviewStale: number;
    reclaimUndecided: number;
    /** 챙길 것 합 */
    attention: number;
    /** 승인됐는데 서면(변경계약서·공문) 파일이 없는 건 (구두 승인 포함 · D-88) — 챙길 것 합에는 넣지 않는다 */
    paperMissing: number;
    /** 결정된 청구 (다시 청구한 반려 건·감액 건 제외) — 청구 금액 합 · 승인 금액 합 · 청구 대비 승인 % */
    claimed: number;
    approved: number;
    claimPct: number | null;
    /** 그중 근거 추가 원가가 있는 건 — 근거 원가 합 · 그 건들의 승인 합 · 근거 원가 대비 % */
    decidedCost: number;
    recovered: number;
    recoveryPct: number | null;
  };
}

export function coRow(db: DemoDB, c: ChangeOrder, today: string): CoRow {
  // 근거 원가는 살아 있는 추가 원가만 — 무효·반려되거나 계획 안 집행으로 바뀐 원가는 빼고 센다 (회수율 1300%·건수 불일치 · D-84 버그 배시)
  const linked = c.sourceEntryIds.map((id) => db.costEntries.find((e) => e.id === id)).filter((e): e is CostEntry => !!e && (e.status === "active" || e.status === "pending") && e.forecastImpact === "additional");
  const live = linked;
  const open = coOpen(c);
  const reclaimedBy = c.status === "rejected" ? db.changeOrders.find((x) => x.reclaimOf === c.id) : undefined;
  const evidence = coEvidenceOf(db, c.id);
  return {
    co: c,
    site: db.sites.find((s) => s.id === c.siteId),
    linked,
    linkedCost: live.reduce((a, e) => a + e.amount, 0),
    days: coDays(c, today),
    followDue: open && !!c.nextFollowUp && c.nextFollowUp <= today,
    noFollow: c.status === "submitted" && !c.nextFollowUp,
    reviewStale: c.status === "review" && coDays(c, today) > CO_REVIEW_STALE_DAYS,
    reclaimUndecided: c.status === "rejected" && !reclaimedBy && !c.noReclaim && c.amount > 0,
    last: c.log?.length ? c.log[c.log.length - 1] : undefined,
    reclaimedBy,
    evidence,
    paper: coPaperState(c, evidence),
  };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export function coBoard(db: DemoDB, today: string, siteId?: string): CoBoard {
  const cos = db.changeOrders.filter((c) => !siteId || c.siteId === siteId);
  // 한 번이라도 변경공사 근거로 쓴 원가는 ‘청구 안 함’이 아니다 — 반려된 건은 그 건의 ‘다시 청구’로 (위험 신호 ‘변경공사 미등록’과 같은 기준)
  const used = new Set(db.changeOrders.flatMap((c) => c.sourceEntryIds));
  const extra0 = db.costEntries.filter((e) => (!siteId || e.siteId === siteId) && e.status === "active" && e.forecastImpact === "additional" && !used.has(e.id));
  const byDate = (a: CostEntry, b: CostEntry) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
  // 청구하지 않기로 정한 추가 원가는 따로 (사유와 함께 · 되돌릴 수 있음)
  const declined = extra0.filter((e) => e.noClaim).sort(byDate);
  const extra = extra0.filter((e) => !e.noClaim);
  const unclaimed = extra.filter((e) => CLAIMABLE_REASONS.has(e.reason)).sort(byDate);
  const otherExtra = extra.filter((e) => !CLAIMABLE_REASONS.has(e.reason)).sort(byDate);
  const attentionOf = (r: CoRow) => r.followDue || r.noFollow || r.reviewStale || r.reclaimUndecided;
  const open = cos
    .filter(coOpen)
    .map((c) => coRow(db, c, today))
    .sort((a, b) => Number(attentionOf(b)) - Number(attentionOf(a)) || b.days - a.days);
  const decided = cos
    .filter((c) => !coOpen(c))
    .map((c) => coRow(db, c, today))
    .sort((a, b) => Number(b.reclaimUndecided) - Number(a.reclaimUndecided) || (b.co.decidedAt ?? "").localeCompare(a.co.decidedAt ?? ""));
  // 회수율 — 다시 청구한 반려 건은 새 건으로 대신 세고, 감액 변경공사는 뺀다
  const final = decided.filter((r) => !r.reclaimedBy && r.co.amount > 0);
  const won = (r: CoRow) => (r.co.status === "approved" ? (r.co.approvedAmount ?? r.co.amount) : 0);
  const claimed = final.reduce((a, r) => a + r.co.amount, 0);
  const approved = final.reduce((a, r) => a + won(r), 0);
  const based = final.filter((r) => r.linkedCost > 0);
  const decidedCost = based.reduce((a, r) => a + r.linkedCost, 0);
  const recovered = based.reduce((a, r) => a + won(r), 0);
  // 감액 변경공사는 대기 합에서 뺀다 (합계가 줄어 보이던 문제 · D-84 버그 배시)
  const sub = open.filter((r) => r.co.status === "submitted" && r.co.amount > 0);
  const rev = open.filter((r) => r.co.status === "review" && r.co.amount > 0);
  const all = [...open, ...decided];
  return {
    unclaimed,
    otherExtra,
    declined,
    open,
    decided,
    totals: {
      unclaimed: unclaimed.reduce((a, e) => a + e.amount, 0),
      unclaimedN: unclaimed.length,
      submitted: sub.reduce((a, r) => a + r.co.amount, 0),
      submittedN: sub.length,
      review: rev.reduce((a, r) => a + r.co.amount, 0),
      reviewN: rev.length,
      oldest: sub.reduce((a, r) => Math.max(a, r.days), 0),
      followDue: all.filter((r) => r.followDue).length,
      noFollow: all.filter((r) => r.noFollow).length,
      reviewStale: all.filter((r) => r.reviewStale).length,
      reclaimUndecided: all.filter((r) => r.reclaimUndecided).length,
      attention: all.filter(attentionOf).length,
      paperMissing: all.filter((r) => r.paper === "verbal" || r.paper === "missing").length,
      claimed,
      approved,
      claimPct: pct(approved, claimed),
      decidedCost,
      recovered,
      recoveryPct: pct(recovered, decidedCost),
    },
  };
}

/** 처리 대기 ‘변경공사 챙길 것’ — 확인할 날이 됨 · 청구했는데 확인할 날 없음 · 보내기 전 7일 넘음 · 반려 뒤 다시 청구할지 안 정함 */
export function coAttentionCount(db: DemoDB, today: string): number {
  return coBoard(db, today).totals.attention;
}

export const CO_LOG_LABEL: Record<ChangeOrderLog["kind"], string> = {
  created: "등록",
  submitted: "발주처 청구",
  follow_up: "발주처 확인·독촉",
  client_reply: "발주처 답변",
  note: "메모",
  approved: "승인",
  rejected: "반려",
  no_reclaim: "다시 청구 안 함",
  evidence: "증빙 파일",
};
