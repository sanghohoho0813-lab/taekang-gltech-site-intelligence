/** D-65 안정화 점검에서 재현된 버그들의 재발 방지 테스트 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { submitFieldReport, voidReport, CommandError, REPORT_DATE_WINDOW_DAYS } from "@/lib/data/commands";
import { requestAttendanceFix, reviewAttendanceFix, createWorkOrder } from "@/lib/data/opsCommands";
import { saveSite, type SaveSiteInput } from "@/lib/data/adminCommands";
import { shiftDate } from "@/lib/domain/attendance";
import { worksOnSite, type CostCategory, type DemoDB } from "@/lib/domain/types";
import { COST_CATEGORIES } from "@/lib/domain/labels";

const NOW = new Date("2026-11-02T03:00:00Z"); // 12:00 KST
const ctx = (userId: string, now = NOW) => ({ userId, now });

function siteInput(db: DemoDB, siteId: string, patch: Partial<SaveSiteInput> = {}): SaveSiteInput {
  const s = db.sites.find((x) => x.id === siteId)!;
  const c = db.contracts.find((x) => x.siteId === siteId)!;
  const budgets = Object.fromEntries(COST_CATEGORIES.map((k) => [k, db.budgets.find((b) => b.siteId === siteId && b.category === k)?.amount ?? 0])) as Record<CostCategory, number>;
  return {
    id: s.id, name: s.name, shortName: s.shortName, workType: s.workType, region: s.region, clientName: s.clientName, status: s.status,
    startDate: s.startDate, endDate: s.endDate, managerUserId: s.managerUserId, fieldUserId: s.fieldUserId,
    contractAmount: c.contractAmount, signedDate: c.signedDate, budgets,
    stages: s.stages.map((st) => ({ id: st.id, name: st.name, startDate: st.startDate, endDate: st.endDate, progressPct: st.progressPct, basePct: st.progressPct })),
    ...patch,
  };
}

describe("현장 보고 되돌리기는 그 보고가 바꾼 공정·작업지시도 되돌린다", () => {
  it("공정 단계·현장 공정률·작업지시 상태가 보고 전으로 돌아가고, 이력에 무엇을 되돌렸는지 남는다", () => {
    const db0 = createSeed(NOW);
    const site0 = db0.sites.find((s) => s.id === "site-a")!;
    const st = site0.stages.find((x) => x.progressPct > 0 && x.progressPct < 100)!;
    const wo0 = db0.workOrders!.find((w) => w.id === "wo-seed-1")!;
    expect(["sent", "received"]).toContain(wo0.status);
    const r = submitFieldReport(db0, { idempotencyKey: "v1", siteId: "site-a", reportDate: "2026-11-02", workDone: "실링 보수", workOrderId: "wo-seed-1", stageProgress: [{ stageId: st.id, progressPct: Math.min(100, st.progressPct + 10) }] }, ctx("u-field"));
    const site1 = r.db.sites.find((s) => s.id === "site-a")!;
    expect(site1.stages.find((x) => x.id === st.id)!.progressPct).toBe(Math.min(100, st.progressPct + 10));
    expect(r.db.workOrders!.find((w) => w.id === "wo-seed-1")!.status).toBe("in_progress");

    const { db } = voidReport(r.db, r.result.reportId, ctx("u-manager"));
    const site2 = db.sites.find((s) => s.id === "site-a")!;
    expect(site2.stages.find((x) => x.id === st.id)!.progressPct).toBe(st.progressPct);
    expect(site2.progressPct).toBe(site0.progressPct);
    const wo = db.workOrders!.find((w) => w.id === "wo-seed-1")!;
    expect(wo.status).toBe(wo0.status);
    expect(wo.history.at(-1)?.note).toBe("현장 보고 되돌리기");
    expect(db.activityLogs[0].summary).toMatch(/되돌리기.*공정률/);
  });
  it("그 뒤 다른 사람이 공정률을 바꿨으면 그 값은 건드리지 않는다", () => {
    const db0 = createSeed(NOW);
    const r = submitFieldReport(db0, { idempotencyKey: "v2", siteId: "site-a", reportDate: "2026-11-02", workDone: "x", progressPct: 70 }, ctx("u-field"));
    const later = structuredClone(r.db);
    later.sites.find((s) => s.id === "site-a")!.progressPct = 75; // 다음 보고가 바꿈
    const { db } = voidReport(later, r.result.reportId, ctx("u-manager"));
    expect(db.sites.find((s) => s.id === "site-a")!.progressPct).toBe(75);
  });
});

describe("보고 날짜는 오늘부터 정해진 기간 안에서만", () => {
  it("미래 날짜와 아주 오래된 날짜는 거부, 경계 안쪽은 허용", () => {
    const db0 = createSeed(NOW);
    const send = (reportDate: string) => submitFieldReport(db0, { idempotencyKey: `d-${reportDate}`, siteId: "site-a", reportDate, workDone: "작업" }, ctx("u-field"));
    expect(() => send("2026-11-03")).toThrow(CommandError);
    expect(() => send(shiftDate("2026-11-02", -REPORT_DATE_WINDOW_DAYS - 1))).toThrow(CommandError);
    expect(() => send(shiftDate("2026-11-02", -REPORT_DATE_WINDOW_DAYS))).not.toThrow();
    expect(() => send("2026-11-02")).not.toThrow();
  });
});

describe("출근 누락 요청을 낸 뒤 출근을 눌렀어도 승인 시 기록이 두 개가 되지 않는다", () => {
  it("이미 생긴 기록의 출근 시각을 요청 시각으로 고치고 고친 이력을 남긴다", () => {
    const db0 = createSeed(NOW);
    const q = requestAttendanceFix(db0, { siteId: "site-a", workDate: "2026-11-02", kind: "missed_in", inTime: "07:30", reason: "휴대폰 배터리가 꺼짐" }, ctx("u-field"));
    const db1 = structuredClone(q.db);
    db1.attendance = [...(db1.attendance ?? []), { id: "att-late", siteId: "site-a", userId: "u-field", workDate: "2026-11-02", inAt: "2026-11-02T01:10:00.000Z", inGeo: { status: "none" } } as never];
    const { db } = reviewAttendanceFix(db1, { requestId: q.result.requestId, decision: "approve" }, ctx("u-manager"));
    const mine = db.attendance!.filter((a) => a.userId === "u-field" && a.siteId === "site-a" && a.workDate === "2026-11-02");
    expect(mine).toHaveLength(1);
    expect(mine[0].inAt).toBe("2026-11-01T22:30:00.000Z"); // 07:30 KST
    expect(mine[0].corrections?.at(-1)?.before.inAt).toBe("2026-11-02T01:10:00.000Z");
  });
});

describe("작업지시 담당자는 그 현장을 맡은 사람만", () => {
  it("다른 현장 담당에게 지시하면 거부, 현장 담당은 허용", () => {
    const db0 = createSeed(NOW);
    const siteC = db0.sites.find((s) => s.fieldUserId === "u-field2")!;
    expect(worksOnSite(db0.users.find((u) => u.id === "u-field")!, siteC)).toBe(false);
    expect(() => createWorkOrder(db0, { siteId: siteC.id, title: "점검", assigneeUserId: "u-field" }, ctx("u-manager"))).toThrow(CommandError);
    const ok = createWorkOrder(db0, { siteId: siteC.id, title: "점검", assigneeUserId: "u-field2" }, ctx("u-manager"));
    expect(ok.db.workOrders!.find((w) => w.id === ok.result.workOrderId)!.assigneeUserId).toBe("u-field2");
  });
});

describe("현장 정보 수정 창을 연 사이 현장이 바꾼 공정률은 덮어쓰지 않는다", () => {
  it("창에서 손대지 않은 단계는 현장 값 유지, 손댄 단계는 본사 값 반영", () => {
    const db0 = createSeed(NOW);
    const input = siteInput(db0, "site-a"); // 창을 연 시점
    const [a, b] = db0.sites.find((s) => s.id === "site-a")!.stages.filter((x) => x.progressPct < 90);
    // 그 사이 현장 보고로 두 단계가 올라감
    const mid = submitFieldReport(db0, { idempotencyKey: "s1", siteId: "site-a", reportDate: "2026-11-02", workDone: "진척", stageProgress: [{ stageId: a.id, progressPct: a.progressPct + 5 }, { stageId: b.id, progressPct: b.progressPct + 5 }] }, ctx("u-field")).db;
    // 본사는 b 단계만 직접 고쳐 저장
    const stages = input.stages!.map((st) => (st.id === b.id ? { ...st, progressPct: b.progressPct + 2 } : st));
    const { db } = saveSite(mid, { ...input, stages }, ctx("u-manager"));
    const saved = db.sites.find((s) => s.id === "site-a")!.stages;
    expect(saved.find((x) => x.id === a.id)!.progressPct).toBe(a.progressPct + 5); // 현장 값 유지
    expect(saved.find((x) => x.id === b.id)!.progressPct).toBe(b.progressPct + 2); // 본사가 고친 값
  });
});
