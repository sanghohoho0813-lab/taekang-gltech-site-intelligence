/** D-76 하자 일원화 — 대시보드 ‘처리 대기’·아침 알림의 하자 수 = 메뉴 배지 (남은 보수 확인 포함) */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { createPartnerRequest, updatePartnerRequest } from "@/lib/data/commands";
import { createWorkOrder, workOrderStep } from "@/lib/data/opsCommands";
import { defectRows, defectTodoCount } from "@/lib/domain/defects";
import { pendingItems } from "@/lib/domain/pending";

const NOW = new Date("2026-11-04T03:00:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const ctx = (userId: string, now = NOW) => ({ userId, now });

describe("처리 대기의 하자 수", () => {
  it("‘일부만 끝냈어요’에 회신만 한 하자(남은 보수 확인)도 센다 — 메뉴 배지와 같은 수", () => {
    const d = createPartnerRequest(createSeed(NOW), { idempotencyKey: "d", siteId: "site-a", type: "defect", title: "창 누수", description: "물이 샙니다", location: "302호" }, ctx("u-partner"));
    const id = d.result.requestId;
    const wo = createWorkOrder(d.db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: id }, ctx("u-manager", at(1)));
    let db = workOrderStep(wo.db, { workOrderId: wo.result.workOrderId, action: "complete", note: "일부만 끝냈어요 (남은 작업 있음)" }, ctx("u-field", at(2))).db;
    db = updatePartnerRequest(db, id, { status: "answered", reply: "1차 보수, 나머지는 다음 주" }, ctx("u-manager", at(3))).db;
    const today = "2026-11-04";
    expect(defectRows(db, today).find((r) => r.req.id === id)!.next).toBe("check");
    const item = pendingItems(db, today, false).find((p) => p.key === "defect")!;
    expect(item.n).toBe(defectTodoCount(db, today));
    expect(item.n).toBeGreaterThanOrEqual(1);
  });
});
