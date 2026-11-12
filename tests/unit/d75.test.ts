/** D-75 하자보수 한 화면 처리 — 처리 이력(시간순)·메뉴 배지 수·처리 대기 연결 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { confirmPartnerRequest, createPartnerRequest, updatePartnerRequest } from "@/lib/data/commands";
import { createWorkOrder, reviewWorkOrder, workOrderStep } from "@/lib/data/opsCommands";
import { confirmIntake, createIntake, discardIntakeRequests, registerPhoneDefect, reopenIntake, submitIntake } from "@/lib/data/intakeCommands";
import { defectRows, defectStats, defectTimeline, defectTodoCount } from "@/lib/domain/defects";
import { pendingItems } from "@/lib/domain/pending";
import type { DemoDB, PartnerRequest } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
const ctx = (userId: string, now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const FORM = { location: "3층 302호 거실 창", description: "비가 오면 창틀 아래로 물이 샙니다.", name: "홍길동", phone: "010-1234-5678", org: "관리사무소", consent: true };
const K = (s: string) => `idem-0123456789abcdef-${s}`;
const req = (db: DemoDB, id: string) => db.partnerRequests.find((r) => r.id === id) as PartnerRequest;
const labels = (db: DemoDB, id: string) => defectTimeline(db, req(db, id)).map((e) => e.label);

describe("하자 처리 이력 (시간순 한 줄씩)", () => {
  it("발주처 요청: 접수 → 검토 → 작업지시(담당·기한) → 현장 확인 → 보수 완료 보고 → 본사 완료 확인 → 회신 → 발주처 확인", () => {
    let db = createPartnerRequest(createSeed(NOW), { idempotencyKey: "d", siteId: "site-a", type: "defect", title: "창 누수", description: "물이 샙니다", location: "302호", photoDataUrls: [JPG] }, ctx("u-partner")).db;
    const id = db.partnerRequests[0].id;
    db = updatePartnerRequest(db, id, { status: "reviewing" }, ctx("u-manager", at(1))).db;
    const wo = createWorkOrder(db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: id, dueDate: "2026-11-07" }, ctx("u-manager", at(2)));
    db = wo.db;
    db = workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "receive" }, ctx("u-field", at(3))).db;
    db = workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "complete", note: "실리콘 재시공", photoDataUrls: [JPG] }, ctx("u-field", at(20))).db;
    db = reviewWorkOrder(db, { workOrderId: wo.result.workOrderId, decision: "confirm" }, ctx("u-manager", at(21))).db;
    db = updatePartnerRequest(db, id, { status: "answered", reply: "보수를 마쳤습니다." }, ctx("u-manager", at(22))).db;
    db = confirmPartnerRequest(db, { requestId: id, note: "잘 고쳐졌어요" }, ctx("u-partner", at(30))).db;
    const ev = defectTimeline(db, req(db, id));
    expect(ev.map((e) => e.label)).toEqual(["요청 접수", "검토 시작", "작업지시", "현장 확인", "보수 완료 보고", "본사 완료 확인", "회신", "발주처 확인"]);
    // 시간순
    expect([...ev].sort((a, b) => a.at.localeCompare(b.at))).toEqual(ev);
    // 누가·무엇을
    const order = ev.find((e) => e.label === "작업지시")!;
    expect(order.detail).toContain("기한 11/07");
    expect(order.detail).toContain("담당 ");
    expect(ev.find((e) => e.label === "보수 완료 보고")!.detail).toBe("실리콘 재시공");
    expect(ev.find((e) => e.label === "회신")!.detail).toBe("보수를 마쳤습니다.");
    expect(ev.find((e) => e.label === "발주처 확인")!.detail).toBe("잘 고쳐졌어요");
    // ‘보수 작업 배정’처럼 작업지시 쪽에서 보여 주는 기록은 두 번 나오지 않는다
    expect(ev.filter((e) => e.label === "작업지시")).toHaveLength(1);
  });

  it("보완 요청(다시 보수)·일정 안내 뒤 보수 완료 회신 — ‘보완 요청’과 ‘추가 회신’이 따로 남는다", () => {
    let db = createPartnerRequest(createSeed(NOW), { idempotencyKey: "d", siteId: "site-a", type: "defect", title: "창 누수", description: "물이 샙니다", location: "302호" }, ctx("u-partner")).db;
    const id = db.partnerRequests[0].id;
    db = updatePartnerRequest(db, id, { status: "answered", reply: "11/10에 방문하겠습니다." }, ctx("u-manager", at(1))).db;
    const wo = createWorkOrder(db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: id }, ctx("u-manager", at(2)));
    db = wo.db;
    db = workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "complete", note: "1차 보수" }, ctx("u-field", at(3))).db;
    db = reviewWorkOrder(db, { workOrderId: wo.result.workOrderId, decision: "return", note: "아래쪽 실리콘도" }, ctx("u-manager", at(4))).db;
    db = workOrderStep(db, { workOrderId: wo.result.workOrderId, action: "complete", note: "2차 보수" }, ctx("u-field", at(5))).db;
    db = updatePartnerRequest(db, id, { status: "answered", reply: "보수를 마쳤습니다." }, ctx("u-manager", at(6))).db;
    expect(labels(db, id)).toEqual(["요청 접수", "검토 시작", "회신", "작업지시", "보수 완료 보고", "보완 요청 (다시 보수)", "보수 완료 보고", "추가 회신"]);
    expect(defectTimeline(db, req(db, id)).find((e) => e.label.startsWith("보완 요청"))!.detail).toBe("아래쪽 실리콘도");
  });

  it("링크 접수: ‘접수자’ 이름 없이 · 작업지시 없이 처리 끝 · 접수자 확인 · 아직 문제가 있음 → 다시 접수 (앞 건·새 건 모두)", () => {
    const made = createIntake(createSeed(NOW), { siteId: "site-a", label: "관리사무소용" }, ctx("u-manager"));
    let db = made.db;
    const s = submitIntake(db, { ...FORM, intakeId: made.result.intakeId, idempotencyKey: K("a") }, ctx("system", at(1)));
    db = s.db;
    const id = s.result.requestId;
    const first = defectTimeline(db, req(db, id))[0];
    expect(first).toMatchObject({ label: "링크 접수", who: "접수자", detail: "접수 링크 (관리사무소용)" });
    db = updatePartnerRequest(db, id, { status: "answered", reply: "결로입니다. 환기를 안내드렸습니다.", closeWithoutRepair: true }, ctx("u-manager", at(2))).db;
    expect(labels(db, id)).toEqual(["링크 접수", "검토 시작", "회신 (작업지시 없이 처리 끝)"]);
    const re = reopenIntake(db, { requestId: id, note: "아직 물이 맺힙니다" }, ctx("system", at(3)));
    db = re.db;
    expect(labels(db, id)).toEqual(["링크 접수", "검토 시작", "회신 (작업지시 없이 처리 끝)", "아직 문제가 있음 → 다시 접수"]);
    expect(defectTimeline(db, req(db, id)).at(-1)!.detail).toBe(`다시 접수 ${re.result.no}`);
    expect(defectTimeline(db, req(db, re.result.requestId))[0]).toMatchObject({ label: "다시 접수", who: "접수자" });
    // 접수자 확인
    db = updatePartnerRequest(db, re.result.requestId, { status: "answered", reply: "다시 확인했습니다.", closeWithoutRepair: true }, ctx("u-manager", at(4))).db;
    db = confirmIntake(db, { requestId: re.result.requestId, note: "알겠습니다" }, ctx("system", at(5))).db;
    expect(defectTimeline(db, req(db, re.result.requestId)).at(-1)).toMatchObject({ label: "접수자 확인", who: "접수자", detail: "알겠습니다" });
    // 이력에 접수자 이름·전화는 없다 (본사 화면이지만 굳이 되풀이하지 않는다)
    expect(JSON.stringify(defectTimeline(db, req(db, id)))).not.toMatch(/홍길동|1234-5678/);
  });

  it("전화 접수: 등록한 본사 사람이 접수 줄에 남는다", () => {
    const out = registerPhoneDefect(createSeed(NOW), { siteId: "site-a", location: "옥상 천창", description: "실리콘이 떨어졌다고 함" }, ctx("u-manager"));
    const ev = defectTimeline(out.db, req(out.db, out.result.requestId));
    expect(ev).toHaveLength(1);
    expect(ev[0].label).toBe("전화 접수");
    expect(ev[0].who).toBeTruthy();
    expect(ev[0].who).not.toBe("접수자");
  });
});

describe("메뉴 배지·처리 대기", () => {
  it("하자보수 배지 = 작업지시 보낼 것 + 회신할 것 · 버리거나 작업지시를 보내면 줄어든다 · 처리 대기는 ‘본사 할 일’ 보기로 연결", () => {
    const made = createIntake(createSeed(NOW), { siteId: "site-a", label: "관리사무소용" }, ctx("u-manager"));
    let db = made.db;
    const base = defectTodoCount(db, "2026-11-04");
    for (const k of ["a", "b"]) db = submitIntake(db, { ...FORM, intakeId: made.result.intakeId, idempotencyKey: K(k) }, ctx("system")).db;
    expect(defectTodoCount(db, "2026-11-04")).toBe(base + 2);
    expect(defectTodoCount(db, "2026-11-04")).toBe(defectStats(defectRows(db, "2026-11-04")).hqTodo);
    const [a, b] = db.partnerRequests.filter((r) => r.intake).map((r) => r.id);
    db = discardIntakeRequests(db, { requestIds: [a], reason: "spam" }, ctx("u-manager")).db;
    expect(defectTodoCount(db, "2026-11-04")).toBe(base + 1);
    db = createWorkOrder(db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: b }, ctx("u-manager")).db;
    expect(defectTodoCount(db, "2026-11-04")).toBe(base);
    // 처리 대기(대시보드)의 하자 항목은 하자보수 ‘본사 할 일’ 보기로 바로 연다 — 본사 할 일이 있는 상태로 다시 확인
    const pending = submitIntake(db, { ...FORM, intakeId: made.result.intakeId, idempotencyKey: K("c") }, ctx("system")).db;
    const item = pendingItems(pending, "2026-11-04", false).find((p) => p.key === "defect");
    expect(item).toMatchObject({ href: "/defects?view=todo" });
    expect(item!.n).toBe(defectTodoCount(pending, "2026-11-04"));
  });
});
