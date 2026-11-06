/**
 * 하자보수 관리 (본사용 · D-69) — 발주처 하자보수 요청을 현장별로 모아 진행·처리 기간·본사 할 일을 계산하고,
 * 인쇄용 ‘하자보수 관리대장’을 만든다. 금액은 넣지 않는다.
 *
 * 단계는 발주처 포털·월간 보고서와 같은 말(defectProgress)을 쓰고, 본사 화면에는 ‘다음에 할 일’을 덧붙인다.
 */
import type { DemoDB, PartnerRepairView, PartnerRequest, Site, WorkOrder } from "./types";
import { defectProgress, partnerRepairView } from "./partnerFeed";

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const dayDiff = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));

/** 본사가 다음에 할 일 */
export type DefectNext = "assign" | "repairing" | "reply" | "client" | "closed";
export const DEFECT_NEXT_LABEL: Record<DefectNext, string> = {
  assign: "작업지시·회신 필요",
  repairing: "현장 보수 중",
  reply: "완료 확인·회신 필요",
  client: "발주처 확인 대기",
  closed: "끝남",
};

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
}

export function defectRows(db: DemoDB, today: string): DefectRow[] {
  return db.partnerRequests
    .filter((r) => r.type === "defect")
    .map((r) => {
      const wo = r.linkedWorkOrderId ? (db.workOrders ?? []).find((w) => w.id === r.linkedWorkOrderId) : undefined;
      const repair = partnerRepairView(db, r);
      const stage = defectProgress(r, repair);
      const firstAnswer = r.history.find((h) => h.status === "answered")?.at;
      const repairedAt = repair ? (repair.stage === "done" ? repair.at : undefined) : r.status === "answered" ? firstAnswer : undefined;
      const next: DefectNext = r.confirmedAt
        ? "closed"
        : repair
          ? repair.stage === "done"
            ? "client"
            : repair.stage === "checking"
              ? "reply"
              : "repairing"
          : r.status === "answered"
            ? "client"
            : "assign";
      const open = next === "assign" || next === "repairing" || next === "reply";
      const receivedDate = kst(r.createdAt);
      const repairedDate = repairedAt ? kst(repairedAt) : undefined;
      const limit = [r.desiredDate, wo && !["done", "confirmed"].includes(wo.status) ? wo.dueDate : undefined].filter((x): x is string => !!x).sort()[0];
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
        overdue: open && !!limit && limit < today,
        beforePhotoId: r.photoIds?.[0],
        afterPhotoId: r.replyPhotoIds?.[0] ?? wo?.donePhotoIds?.[0],
      };
    })
    .sort((a, b) => b.req.createdAt.localeCompare(a.req.createdAt));
}

export interface DefectStats {
  total: number;
  open: number;
  overdue: number;
  /** 본사가 지금 손댈 것: 작업지시·회신 필요 + 완료 확인·회신 필요 */
  hqTodo: number;
  /** 보수 완료까지 평균 일수 (완료된 것만) */
  avgDays: number | null;
  repaired: number;
  confirmed: number;
}

export function defectStats(rows: DefectRow[]): DefectStats {
  const repaired = rows.filter((r) => r.repairedDate);
  return {
    total: rows.length,
    open: rows.filter((r) => r.next === "assign" || r.next === "repairing" || r.next === "reply").length,
    overdue: rows.filter((r) => r.overdue).length,
    hqTodo: rows.filter((r) => r.next === "assign" || r.next === "reply").length,
    avgDays: repaired.length ? Math.round((repaired.reduce((a, r) => a + r.days, 0) / repaired.length) * 10) / 10 : null,
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
