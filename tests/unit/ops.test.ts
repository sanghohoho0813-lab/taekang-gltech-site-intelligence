import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { requestAttendanceFix, reviewAttendanceFix, createWorkOrder, workOrderStep, reviewWorkOrder, reviewReport, supplementReport } from "@/lib/data/opsCommands";
import { submitFieldReport, CommandError } from "@/lib/data/commands";
import { dayFlags, recentFlags } from "@/lib/domain/attendance";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-02T03:00:00Z"); // 12:00 KST
const ctx = (userId: string, now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

describe("근태 수정 요청 → 본사 승인 (검수 S2)", () => {
  it("DEMO: 정우진 어제 퇴근 누락 요청을 승인하면 퇴근 17:30이 들어가고 정정 이력·예외 사유가 남으며 퇴근 누락 표시가 사라진다", () => {
    const db0 = createSeed(NOW);
    expect(recentFlags(db0, "2026-11-02").some((f) => f.kind === "no_checkout" && f.userId === "u-field2")).toBe(true);
    const { db } = reviewAttendanceFix(db0, { requestId: "afr-seed-1", decision: "approve" }, ctx("u-manager"));
    const r = db.attendance!.find((x) => x.id === "att-seed-c-1")!;
    expect(r.outAt).toBe("2026-11-01T08:30:00.000Z"); // 17:30 KST
    expect(r.corrections?.at(-1)?.note).toContain("현장 요청 승인 — 퇴근을 못 눌렀어요 · 휴대폰 배터리가 꺼짐");
    expect(r.exceptionNote).toBeTruthy();
    expect(db.attendanceRequests!.find((q) => q.id === "afr-seed-1")).toMatchObject({ status: "approved", reviewedBy: "u-manager" });
    expect(recentFlags(db, "2026-11-02").some((f) => f.kind === "no_checkout" && f.workDate === "2026-11-01" && f.userId === "u-field2")).toBe(false);
    expect(() => reviewAttendanceFix(db, { requestId: "afr-seed-1", decision: "approve" }, ctx("u-manager"))).toThrow(/이미 처리/);
  });
  it("출근 누락 요청 → 승인하면 위치 없는 기록이 요청 근거와 함께 생기고, 위치 의심 표시는 하지 않는다", () => {
    const db0 = createSeed(NOW);
    const r = requestAttendanceFix(db0, { siteId: "site-a", workDate: "2026-11-02", kind: "missed_in", inTime: "07:30", reason: "휴대폰 배터리가 꺼짐" }, ctx("u-field"));
    const { db } = reviewAttendanceFix(r.db, { requestId: r.result.requestId, decision: "approve" }, ctx("u-manager"));
    const rec = db.attendance!.find((x) => x.fromRequestId === r.result.requestId)!;
    expect(rec).toMatchObject({ userId: "u-field", siteId: "site-a", inAt: "2026-11-01T22:30:00.000Z", inGeo: { status: "none" } });
    expect(dayFlags(db, "2026-11-02", NOW).some((f) => f.userId === "u-field" && (f.kind === "no_location" || f.kind === "missing"))).toBe(false);
  });
  it("잘못된 요청 거부: 7일 넘음·시각 없음·기록 있는데 출근 누락·같은 날 중복·반려 사유 없음", () => {
    const db0 = createSeed(NOW);
    const bad = (x: object) => expect(() => requestAttendanceFix(db0, { siteId: "site-a", workDate: "2026-11-02", kind: "missed_in", inTime: "07:30", reason: "깜빡함", ...x }, ctx("u-field"))).toThrow(CommandError);
    bad({ workDate: "2026-10-20" });
    bad({ inTime: undefined });
    bad({ workDate: "2026-11-01" }); // 11/01엔 출근 기록이 있음
    bad({ reason: "" });
    bad({ inTime: "13:00" }); // 지금(12:00)보다 뒤 시각
    const { db } = requestAttendanceFix(db0, { siteId: "site-a", workDate: "2026-11-02", kind: "missed_in", inTime: "07:30", reason: "깜빡함" }, ctx("u-field"));
    expect(() => requestAttendanceFix(db, { siteId: "site-a", workDate: "2026-11-02", kind: "missed_in", inTime: "07:40", reason: "깜빡함" }, ctx("u-field"))).toThrow(/이미/);
    const q = db.attendanceRequests!.at(-1)!;
    expect(() => reviewAttendanceFix(db, { requestId: q.id, decision: "reject" }, ctx("u-manager"))).toThrow(CommandError);
  });
});

describe("작업지시: 지시 → 접수 → 진행 → 완료 → 확인/보완 (모듈 02·03)", () => {
  it("흐름과 이력, 완료는 한 일·작업량·사진 중 하나 필수, 보완 요청은 사유 필수", () => {
    let db: DemoDB = createSeed(NOW);
    const c = createWorkOrder(db, { siteId: "site-b", title: "단열유리 파손 1장 교체", urgent: true, dueDate: "2026-11-04" }, ctx("u-manager"));
    db = c.db;
    const w0 = db.workOrders!.find((w) => w.id === c.result.workOrderId)!;
    expect(w0).toMatchObject({ assigneeUserId: "u-field", status: "sent", urgent: true }); // 현장 담당이 기본
    db = workOrderStep(db, { workOrderId: w0.id, action: "receive" }, ctx("u-field")).db;
    expect(() => workOrderStep(db, { workOrderId: w0.id, action: "complete" }, ctx("u-field"))).toThrow(/하나는/);
    db = workOrderStep(db, { workOrderId: w0.id, action: "complete", qty: "1개", photoDataUrls: [JPG] }, ctx("u-field")).db;
    let w = db.workOrders!.find((x) => x.id === w0.id)!;
    expect(w.status).toBe("done");
    expect(db.photos.find((p) => p.id === w.donePhotoIds![0])?.caption).toContain("작업지시 완료");
    expect(() => reviewWorkOrder(db, { workOrderId: w0.id, decision: "return" }, ctx("u-manager"))).toThrow(CommandError);
    db = reviewWorkOrder(db, { workOrderId: w0.id, decision: "return", note: "교체 후 실링 사진 추가" }, ctx("u-manager")).db;
    expect(db.workOrders!.find((x) => x.id === w0.id)).toMatchObject({ status: "returned", returnNote: "교체 후 실링 사진 추가" });
    db = workOrderStep(db, { workOrderId: w0.id, action: "complete", note: "실링 사진 추가함", photoDataUrls: [JPG] }, ctx("u-field")).db;
    db = reviewWorkOrder(db, { workOrderId: w0.id, decision: "confirm" }, ctx("u-manager")).db;
    w = db.workOrders!.find((x) => x.id === w0.id)!;
    expect(w.status).toBe("confirmed");
    expect(w.history.map((h) => h.to)).toEqual(["sent", "received", "done", "returned", "done", "confirmed"]);
    expect(() => workOrderStep(db, { workOrderId: w0.id, action: "start" }, ctx("u-field"))).toThrow(/상태/);
  });
  it("현장 보고를 작업지시에 연결하면 지시가 ‘진행 중’으로", () => {
    const db0 = createSeed(NOW);
    const { db } = submitFieldReport(db0, { idempotencyKey: "k1", siteId: "site-a", reportDate: "2026-11-02", workDone: "실링 보수", workOrderId: "wo-seed-1" }, ctx("u-field"));
    expect(db.reports[0].workOrderId).toBe("wo-seed-1");
    expect(db.workOrders!.find((w) => w.id === "wo-seed-1")!.status).toBe("in_progress");
    expect(() => submitFieldReport(db0, { idempotencyKey: "k2", siteId: "site-b", reportDate: "2026-11-02", workDone: "x", workOrderId: "wo-seed-1" }, ctx("u-field"))).toThrow(CommandError); // 다른 현장 지시
  });
});

describe("현장 보고 확인·보완 (검수 S3)", () => {
  it("보완 요청(사유 필수) → 현장이 사진·내용 보완 → 다시 확인 전 → 확인", () => {
    const db0 = createSeed(NOW);
    const id = db0.reports[0].id;
    expect(() => reviewReport(db0, { reportId: id, decision: "return" }, ctx("u-manager"))).toThrow(CommandError);
    let { db } = reviewReport(db0, { reportId: id, decision: "return", note: "설치 수량 사진 추가" }, ctx("u-manager"));
    expect(db.reports.find((r) => r.id === id)!.review).toMatchObject({ status: "returned", note: "설치 수량 사진 추가" });
    expect(() => supplementReport(db, { reportId: id }, ctx("u-field"))).toThrow(CommandError);
    db = supplementReport(db, { reportId: id, text: "12개 설치 사진", photoDataUrls: [JPG] }, ctx("u-field")).db;
    const r = db.reports.find((x) => x.id === id)!;
    expect(r.review).toBeUndefined();
    expect(r.supplements?.[0].photoIds).toHaveLength(1);
    expect(r.photoIds).toContain(r.supplements![0].photoIds[0]);
    db = reviewReport(db, { reportId: id, decision: "confirm" }, ctx("u-manager")).db;
    expect(db.reports.find((x) => x.id === id)!.review?.status).toBe("confirmed");
  });
});
