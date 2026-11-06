/** D-69 하자보수 관리(본사) — 다음에 할 일·처리 기간·기한 지남·관리대장 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { confirmPartnerRequest, createPartnerRequest, updatePartnerRequest } from "@/lib/data/commands";
import { createWorkOrder, reviewWorkOrder, workOrderStep } from "@/lib/data/opsCommands";
import { defectLedger, defectRows, defectStats } from "@/lib/domain/defects";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000);
const ctx = (userId: string, now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function base(): { db: DemoDB; id: string } {
  const r = createPartnerRequest(createSeed(NOW), { idempotencyKey: "d", siteId: "site-a", type: "defect", title: "창 누수", description: "물이 샙니다", location: "302호", desiredDate: "2026-11-06", photoDataUrls: [JPG] }, ctx("u-partner"));
  return { db: r.db, id: r.result.requestId };
}
const row = (db: DemoDB, id: string, today = "2026-11-04") => defectRows(db, today).find((r) => r.req.id === id)!;

describe("하자보수 관리 — 다음에 할 일", () => {
  it("접수 → 작업지시·회신 필요 → 현장 보수 중 → 완료 확인·회신 필요 → 발주처 확인 대기 → 끝남", () => {
    let { db, id } = base();
    expect(row(db, id)).toMatchObject({ next: "assign", days: 0, overdue: false, beforePhotoId: db.photos.find((p) => p.partnerRequestId === id)!.id });
    const wo = createWorkOrder(db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: id, dueDate: "2026-11-05" }, ctx("u-manager"));
    db = wo.db;
    expect(row(db, id).next).toBe("repairing");
    // 기한(희망일 11-06, 작업 기한 11-05) 지나면 ‘기한 지남’
    expect(row(db, id, "2026-11-06")).toMatchObject({ overdue: true, days: 2 });
    db = workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "complete", note: "재시공", photoDataUrls: [JPG] }, ctx("u-field", at(1))).db;
    expect(row(db, id).next).toBe("reply");
    expect(row(db, id).repairedDate).toBeUndefined();
    db = reviewWorkOrder(db, { workOrderId: wo.result.workOrderId, decision: "confirm" }, ctx("u-manager", at(2))).db;
    // 작업지시만 확인하고 발주처에 회신하지 않았으면 여전히 본사 할 일 (D-69 점검 반영)
    expect(row(db, id, "2026-11-09")).toMatchObject({ next: "reply", repairedDate: "2026-11-06", days: 2, overdue: false });
    expect(row(db, id).afterPhotoId).toBe(db.workOrders!.find((w) => w.id === wo.result.workOrderId)!.donePhotoIds![0]);
    db = updatePartnerRequest(db, id, { status: "answered", reply: "보수 완료" }, ctx("u-manager", at(2))).db;
    expect(row(db, id, "2026-11-09").next).toBe("client");
    db = confirmPartnerRequest(db, { requestId: id }, ctx("u-partner", at(3))).db;
    expect(row(db, id)).toMatchObject({ next: "closed", confirmedDate: "2026-11-07" });
  });
  it("작업지시 없는 회신: 일정 안내면 아직 ‘작업지시 보내기 필요’, ‘작업지시 없이 처리 끝’이면 회신한 날 처리 완료", () => {
    let { db, id } = base();
    // 일정 안내 회신 — 열린 채로, 발주처는 확인할 수 없고, 작업지시는 보낼 수 있다
    const interim = updatePartnerRequest(db, id, { status: "answered", reply: "11월 10일에 방문하겠습니다." }, ctx("u-manager", at(1))).db;
    expect(row(interim, id, "2026-11-10")).toMatchObject({ next: "assign", repairedDate: undefined });
    expect(() => confirmPartnerRequest(interim, { requestId: id }, ctx("u-partner", at(2)))).toThrow(/보수가 끝난 뒤/);
    expect(() => createWorkOrder(interim, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: id }, ctx("u-manager", at(2)))).not.toThrow();
    // 하자 아님으로 끝냄
    db = updatePartnerRequest(db, id, { status: "answered", reply: "하자 아님 — 사용 안내 드림", closeWithoutRepair: true }, ctx("u-manager", at(1))).db;
    expect(row(db, id, "2026-11-10")).toMatchObject({ next: "client", repairedDate: "2026-11-05", days: 1, stage: { label: "처리 완료 (보수 없음)" } });
    // 보수 안 한 건은 ‘보수 완료까지’ 평균에 넣지 않는다 (시연 데이터의 끝난 하자만)
    expect(defectStats(defectRows(db, "2026-11-10")).repaired).toBe(defectRows(createSeed(NOW), "2026-11-10").filter((r) => r.repair && r.repairedDate).length);
    expect(() => createWorkOrder(db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: id }, ctx("u-manager", at(2)))).toThrow(/처리가 끝난/);
    expect(() => confirmPartnerRequest(db, { requestId: id }, ctx("u-partner", at(2)))).not.toThrow();
  });
  it("다시 요청된 원래 요청은 ‘다시 요청됨’ — 확인 불가 · 보수 후 사진은 가장 최근 회신 사진", () => {
    let { db, id } = base();
    const wo = createWorkOrder(db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: id }, ctx("u-manager"));
    db = workOrderStep(wo.db, { workOrderId: wo.result.workOrderId, action: "complete", photoDataUrls: [JPG] }, ctx("u-field", at(1))).db;
    const p1 = db.workOrders!.find((w) => w.id === wo.result.workOrderId)!.donePhotoIds![0];
    db = updatePartnerRequest(db, id, { status: "answered", reply: "완료", sharePhotoIds: [p1] }, ctx("u-manager", at(1))).db;
    db = reviewWorkOrder(db, { workOrderId: wo.result.workOrderId, decision: "return", note: "다시" }, ctx("u-manager", at(2))).db;
    db = workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "complete", photoDataUrls: [JPG] }, ctx("u-field", at(3))).db;
    const p2 = db.workOrders!.find((w) => w.id === wo.result.workOrderId)!.donePhotoIds![0];
    db = updatePartnerRequest(db, id, { status: "answered", reply: "재보수 완료", sharePhotoIds: [p2] }, ctx("u-manager", at(3))).db;
    expect(row(db, id, "2026-11-08").afterPhotoId).toBe(p2);
    const redo = createPartnerRequest(db, { idempotencyKey: "r", siteId: "site-a", type: "defect", title: "창 누수", description: "또", location: "302호", reopenedFrom: id }, ctx("u-partner", at(4)));
    expect(row(redo.db, id, "2026-11-09").next).toBe("reopened");
    expect(() => confirmPartnerRequest(redo.db, { requestId: id }, ctx("u-partner", at(4)))).toThrow(/다시 요청한 건/);
  });
  it("통계: 진행 중·본사 할 일·기한 지남·보수까지 평균 일수 · 하자보수가 아닌 요청은 빼고", () => {
    const { db } = base();
    const rows = defectRows(db, "2026-11-08");
    expect(rows.every((r) => r.req.type === "defect")).toBe(true);
    const st = defectStats(rows);
    expect(st).toMatchObject({ open: rows.filter((r) => ["assign", "repairing", "reply"].includes(r.next)).length, hqTodo: rows.filter((r) => r.next === "assign" || r.next === "reply").length });
    expect(st.overdue).toBeGreaterThanOrEqual(1); // 희망일 11-06 지남
  });
  it("관리대장: 현장·접수 기간으로, 오래된 것부터 번호", () => {
    let { db, id } = base();
    const second = createPartnerRequest(db, { idempotencyKey: "d2", siteId: "site-a", type: "defect", title: "문 처짐", description: "닫히지 않음", location: "1층" }, ctx("u-partner", at(1)));
    db = second.db;
    const rows = defectRows(db, "2026-11-08");
    const led = defectLedger(rows, "site-a", "2026-11-01", "2026-11-08");
    const mine = led.filter((r) => r.req.id === id || r.req.id === second.result.requestId);
    expect(mine.map((r) => r.req.id)).toEqual([id, second.result.requestId]);
    expect(led.map((r) => r.no)).toEqual(led.map((_, i) => i + 1));
    expect(defectLedger(rows, "site-b", "2026-11-01", "2026-11-08").some((r) => r.req.id === id)).toBe(false);
    expect(defectLedger(rows, "site-a", "2026-11-06", "2026-11-08").some((r) => r.req.id === id)).toBe(false);
  });
});
