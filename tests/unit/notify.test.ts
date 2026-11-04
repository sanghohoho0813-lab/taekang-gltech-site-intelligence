import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { createPartnerRequest, submitFieldReport, updatePartnerRequest } from "@/lib/data/commands";
import { createWorkOrder, requestAttendanceFix, reviewAttendanceFix, reviewReport, reviewWorkOrder, workOrderStep } from "@/lib/data/opsCommands";
import { noticesFor, type Notice } from "@/lib/domain/notify";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const ctx = (userId: string, ms = 0) => ({ userId, now: new Date(NOW.getTime() + ms) });
const step = (db0: DemoDB, actor: string, run: (db: DemoDB) => { db: DemoDB }) => {
  const r = run(db0);
  return { db: r.db, notices: noticesFor(db0, r.db, actor) };
};
/** 잠금화면에 금액이 보이면 안 된다 */
const noMoney = (ns: Notice[]) => ns.forEach((n) => expect(`${n.title} ${n.body}`).not.toMatch(/\d[\d,]*\s*(만\s*)?원|억/));

describe("휴대폰 알림 규칙", () => {
  it("본사 작업지시 → 받는 현장소장에게만 (보낸 사람 제외), 긴급은 제목에 표시", () => {
    const db = createSeed(NOW);
    const { notices } = step(db, "u-manager", (d) => createWorkOrder(d, { siteId: "site-a", title: "3층 실링 보수", detail: "", assigneeUserId: "u-field", urgent: true }, ctx("u-manager")));
    expect(notices).toEqual([{ to: ["u-field"], title: "긴급 본사 작업지시", body: expect.stringContaining("3층 실링 보수"), url: "/my-actions", tag: expect.stringMatching(/^wo-/) }]);
  });

  it("작업지시 완료 → 지시한 본사 사람에게 / 보완 요청 → 현장에 / 확인 완료는 알리지 않음", () => {
    let db = createSeed(NOW);
    const c = createWorkOrder(db, { siteId: "site-a", title: "2층 보수", detail: "", assigneeUserId: "u-field" }, ctx("u-manager"));
    db = c.db;
    const id = c.result.workOrderId;
    db = workOrderStep(db, { workOrderId: id, action: "receive" }, ctx("u-field", 1000)).db;
    const done = step(db, "u-field", (d) => workOrderStep(d, { workOrderId: id, action: "complete", note: "완료", qty: "3곳" }, ctx("u-field", 2000)));
    expect(done.notices).toEqual([expect.objectContaining({ to: ["u-manager"], title: "작업지시 완료 보고", url: "/orders" })]);
    const ret = step(done.db, "u-manager", (d) => reviewWorkOrder(d, { workOrderId: id, decision: "return", note: "사진 다시" }, ctx("u-manager", 3000)));
    expect(ret.notices).toEqual([expect.objectContaining({ to: ["u-field"], title: "작업지시 보완 요청", body: expect.stringContaining("사진 다시") })]);
    const again = workOrderStep(ret.db, { workOrderId: id, action: "complete", note: "다시", qty: "3곳" }, ctx("u-field", 4000)).db;
    const ok = step(again, "u-manager", (d) => reviewWorkOrder(d, { workOrderId: id, decision: "confirm" }, ctx("u-manager", 5000)));
    expect(ok.notices).toEqual([]);
  });

  it("현장 보고: 문제가 있으면 본사 전원에게, 비용만 있으면 ‘추가 비용 보고’(금액 없음), 평범한 보고는 알리지 않음", () => {
    const db = createSeed(NOW);
    const issue = step(db, "u-field", (d) => submitFieldReport(d, { idempotencyKey: "n1", siteId: "site-a", reportDate: "2026-11-04", workDone: "유닛 설치", issues: "크레인 고장으로 작업 중단" }, ctx("u-field")));
    expect(issue.notices).toEqual([expect.objectContaining({ title: "현장 문제 보고", body: expect.stringContaining("크레인 고장") })]);
    expect(issue.notices[0].to.sort()).toEqual(["u-ceo", "u-manager"]);
    const cost = step(db, "u-field", (d) => submitFieldReport(d, { idempotencyKey: "n2", siteId: "site-a", reportDate: "2026-11-04", workDone: "", costs: [{ category: "material", amount: 4_000_000, forecastImpact: "additional" }], reason: "design_change" }, ctx("u-field")));
    expect(cost.notices).toEqual([expect.objectContaining({ title: "추가 비용 보고", body: expect.stringContaining("비용 1건") })]);
    noMoney(cost.notices);
    const plain = step(db, "u-field", (d) => submitFieldReport(d, { idempotencyKey: "n3", siteId: "site-a", reportDate: "2026-11-04", workDone: "유닛 설치" }, ctx("u-field")));
    expect(plain.notices).toEqual([]);
  });

  it("보고 보완 요청 → 보고한 사람에게 / 근태 수정 요청 → 본사, 승인·반려 → 요청한 사람에게", () => {
    let db = createSeed(NOW);
    db = submitFieldReport(db, { idempotencyKey: "n4", siteId: "site-a", reportDate: "2026-11-04", workDone: "설치" }, ctx("u-field")).db;
    const rep = db.reports[0];
    const back = step(db, "u-manager", (d) => reviewReport(d, { reportId: rep.id, decision: "return", note: "사진 보완" }, ctx("u-manager", 1000)));
    expect(back.notices).toEqual([expect.objectContaining({ to: ["u-field"], title: "보고 보완 요청", body: expect.stringContaining("사진 보완") })]);
    const fix = step(back.db, "u-field", (d) => requestAttendanceFix(d, { siteId: "site-a", workDate: "2026-11-03", kind: "missed_out", outTime: "17:30", reason: "깜빡함" }, ctx("u-field", 2000)));
    expect(fix.notices).toEqual([expect.objectContaining({ title: "근태 수정 요청" })]);
    const q = (fix.db.attendanceRequests ?? []).find((x) => x.userId === "u-field" && x.status === "pending")!;
    const ok = step(fix.db, "u-manager", (d) => reviewAttendanceFix(d, { requestId: q.id, decision: "reject", note: "출근 기록 없음" }, ctx("u-manager", 3000)));
    expect(ok.notices).toEqual([expect.objectContaining({ to: ["u-field"], title: "근태 수정 반려", body: expect.stringContaining("출근 기록 없음") })]);
  });

  it("고객 요청 → 본사 / 본사 회신 → 그 발주처에게", () => {
    const db = createSeed(NOW);
    const req = step(db, "u-partner", (d) => createPartnerRequest(d, { idempotencyKey: "p1", siteId: "site-a", title: "고정창 견적", description: "견적 부탁", type: "quote", item: "로이유리" }, ctx("u-partner")));
    expect(req.notices).toEqual([expect.objectContaining({ title: "고객 요청 · 견적 문의", to: expect.arrayContaining(["u-ceo", "u-manager"]) })]);
    const id = req.db.partnerRequests[0].id;
    const rev = updatePartnerRequest(req.db, id, { status: "reviewing" }, ctx("u-manager", 1000)).db;
    const ans = step(rev, "u-manager", (d) => updatePartnerRequest(d, id, { status: "answered", reply: "견적서 보내드립니다" }, ctx("u-manager", 2000)));
    expect(ans.notices).toEqual([expect.objectContaining({ to: ["u-partner"], title: "태강지엘텍 회신 도착" })]);
  });

  it("비활성 본사 직원에게는 보내지 않는다", () => {
    const db = createSeed(NOW);
    db.users = db.users.map((u) => (u.id === "u-ceo" ? { ...u, inactive: true } : u));
    const r = step(db, "u-field", (d) => submitFieldReport(d, { idempotencyKey: "n5", siteId: "site-a", reportDate: "2026-11-04", workDone: "x", issues: "누수" }, ctx("u-field")));
    expect(r.notices[0].to).toEqual(["u-manager"]);
  });
});
