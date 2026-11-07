/**
 * 하자보수 관리 (본사용 · D-69) — 발주처 하자보수 요청을 현장별로 모아 진행·처리 기간·본사 할 일을 계산하고,
 * 인쇄용 ‘하자보수 관리대장’을 만든다. 금액은 넣지 않는다.
 *
 * 단계는 발주처 포털·월간 보고서와 같은 말(defectProgress)을 쓰고, 본사 화면에는 ‘다음에 할 일’을 덧붙인다.
 */
import type { DemoDB, PartnerRepairView, PartnerRequest, Site, WorkOrder } from "./types";
import { defectProgress, partnerRepairView } from "./partnerFeed";
import { defectWarranty, type DefectWarranty } from "./warranty";

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const dayDiff = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** 본사가 다음에 할 일 */
export type DefectNext = "assign" | "repairing" | "reply" | "client" | "closed" | "reopened";
export const DEFECT_NEXT_LABEL: Record<DefectNext, string> = {
  assign: "작업지시 보내기 필요",
  repairing: "현장 보수 중",
  reply: "발주처 회신 필요",
  client: "발주처 확인 대기",
  closed: "끝남",
  reopened: "다시 요청됨",
};
/** 현장 보수 중의 실제 단계 — ‘현장 미확인’을 ‘보수 중’으로 부풀리지 않는다 (D-69 점검 반영) */
export function repairingLabel(wo?: WorkOrder): string {
  if (!wo) return DEFECT_NEXT_LABEL.repairing;
  return wo.status === "sent" ? "현장 미확인" : wo.status === "received" ? "현장 확인함" : wo.status === "returned" ? "보완 요청 — 다시 보수" : "현장 보수 중";
}

export interface DefectRow {
  req: PartnerRequest;
  site?: Site;
  partnerName: string;
  wo?: WorkOrder;
  repair?: PartnerRepairView;
  /** 발주처에 보이는 단계 (포털·보고서와 같은 말) */
  stage: { step: number; label: string };
  next: DefectNext;
  receivedDate: string;
  /** 보수 완료일 — 본사가 확인(작업지시 확인 또는 완료 뒤 회신)한 날, 작업지시 없이 회신했으면 회신한 날 */
  repairedDate?: string;
  confirmedDate?: string;
  /** 접수 → 보수 완료(끝나지 않았으면 오늘)까지 일수 */
  days: number;
  /** 아직 본사·현장 일이 남았는데 발주처 희망일이나 작업지시 기한이 지남 */
  overdue: boolean;
  beforePhotoId?: string;
  afterPhotoId?: string;
  /** 하자보증 기간 안·밖 (접수일 기준 · 보증 정보가 없으면 없음 · D-70) */
  warranty?: DefectWarranty;
}

export function defectRows(db: DemoDB, today: string): DefectRow[] {
  const reopened = new Set(db.partnerRequests.map((r) => r.reopenedFrom).filter(Boolean));
  const rank = (r: DefectRow) => (r.overdue ? 0 : r.next === "assign" || r.next === "reply" ? 1 : r.next === "repairing" ? 2 : r.next === "client" ? 3 : 4);
  return db.partnerRequests
    .filter((r) => r.type === "defect")
    .map((r): DefectRow => {
      const wo = r.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === r.linkedWorkOrderId) : undefined;
      const repair = partnerRepairView(db, r);
      const stage = defectProgress(r, repair);
      const firstAnswer = r.history.find((h) => h.status === "answered")?.at;
      // 보수 완료일: 본사가 확인한 날 · 작업지시 없이 ‘처리 끝’으로 회신했으면 그 회신일 (일정 안내 회신은 아님 · D-69 점검 반영)
      const repairedAt = repair ? (repair.stage === "done" ? repair.at : undefined) : r.closedWithoutRepair ? firstAnswer : undefined;
      const next: DefectNext = r.confirmedAt
        ? "closed"
        : reopened.has(r.id)
          ? "reopened"
          : repair
            ? repair.stage === "done"
              ? r.status === "answered"
                ? "client"
                : "reply" // 작업지시는 확인했는데 발주처에 아직 회신 안 함 (D-69 점검 반영)
              : repair.stage === "checking"
                ? "reply"
                : "repairing"
            : r.closedWithoutRepair
              ? "client"
              : "assign";
      const open = next === "assign" || next === "repairing" || next === "reply";
      const receivedDate = kst(r.createdAt);
      const repairedDate = repairedAt ? kst(repairedAt) : undefined;
      const limit = [r.desiredDate, wo && !["done", "confirmed"].includes(wo.status) ? wo.dueDate : undefined].filter((x): x is string => !!x).sort()[0];
      const woDone = !!wo && (wo.status === "done" || wo.status === "confirmed");
      return {
        req: r,
        site: db.sites.find((s) => s.id === r.siteId),
        partnerName: db.users.find((u) => u.id === r.partnerUserId)?.name ?? "발주처",
        wo,
        repair,
        stage,
        next,
        receivedDate,
        repairedDate,
        confirmedDate: r.confirmedAt ? kst(r.confirmedAt) : undefined,
        days: dayDiff(receivedDate, repairedDate ?? today),
        // 보수가 끝난 뒤(회신만 남음)에는 기한 지남으로 보지 않는다
        overdue: open && !repairedDate && !!limit && limit < today,
        warranty: defectWarranty(db.sites.find((s) => s.id === r.siteId), receivedDate),
        beforePhotoId: r.photoIds?.[0],
        // 보수 후 사진: 가장 최근에 회신으로 보낸 사진, 없으면 지금 끝난 작업지시의 사진 (되돌린 첫 시도 사진이 남던 문제 · D-69 점검 반영)
        afterPhotoId: r.replyPhotoIds?.at(-1) ?? (woDone ? wo!.donePhotoIds?.[0] : undefined),
      };
    })
    // 급한 것부터: 기한 지남 → 본사 할 일 → 현장 보수 중 → 발주처 확인 대기 → 끝남, 같은 무리는 오래된 것부터 (D-69 점검 반영)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) >= 3 ? b.req.createdAt.localeCompare(a.req.createdAt) : a.req.createdAt.localeCompare(b.req.createdAt)));
}

export interface DefectStats {
  total: number;
  open: number;
  overdue: number;
  /** 본사가 지금 손댈 것: 작업지시 보내기 + 발주처 회신 */
  hqTodo: number;
  assign: number;
  reply: number;
  /** 발주처 확인 대기 */
  waiting: number;
  /** 보수 완료까지 평균 일수 — 실제 보수한 것만 (작업지시 없이 끝낸 것·다시 요청된 것 제외) */
  avgDays: number | null;
  repaired: number;
  confirmed: number;
}

export function defectStats(rows: DefectRow[]): DefectStats {
  const repaired = rows.filter((r) => r.repairedDate && r.repair && r.next !== "reopened");
  const assign = rows.filter((r) => r.next === "assign").length;
  const reply = rows.filter((r) => r.next === "reply").length;
  return {
    total: rows.length,
    open: rows.filter((r) => r.next === "assign" || r.next === "repairing" || r.next === "reply").length,
    overdue: rows.filter((r) => r.overdue).length,
    hqTodo: assign + reply,
    assign,
    reply,
    waiting: rows.filter((r) => r.next === "client").length,
    avgDays: repaired.length ? Math.round(repaired.reduce((a, r) => a + r.days, 0) / repaired.length) : null,
    repaired: repaired.length,
    confirmed: rows.filter((r) => r.next === "closed").length,
  };
}

/** 하자보수 관리대장: 현장·접수 기간으로 고른 줄 (오래된 것부터 번호) */
export function defectLedger(rows: DefectRow[], siteId: string, from: string, to: string): (DefectRow & { no: number })[] {
  return rows
    .filter((r) => r.req.siteId === siteId && r.receivedDate >= from && r.receivedDate <= to)
    .sort((a, b) => a.req.createdAt.localeCompare(b.req.createdAt))
    .map((r, i) => ({ ...r, no: i + 1 }));
}
