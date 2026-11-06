/** D-68 하자보수 요청(사진·작업지시·보수 완료 회신·발주처 확인) · 발주처 월간 공정 보고서 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { CommandError, confirmPartnerRequest, createPartnerRequest, submitFieldReport, updatePartnerRequest } from "@/lib/data/commands";
import { createWorkOrder, workOrderStep } from "@/lib/data/opsCommands";
import { setPhotoShare } from "@/lib/data/portalCommands";
import { monthRange, partnerMonthly, partnerProgressFeed, partnerRepairView, sharedPhotos } from "@/lib/domain/partnerFeed";
import { photoLedger } from "@/lib/domain/photoLedger";
import { noticesFor } from "@/lib/domain/notify";
import { authorize, viewFor, ForbiddenError } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });
const OTHER = member("u-partner2", "partner", { partnerSiteIds: ["site-a"] });
const FIELD = member("u-field", "field");

const withOther = (db: DemoDB): DemoDB => ({ ...db, users: [...db.users, { ...db.users.find((u) => u.id === "u-partner")!, id: "u-partner2", name: "가상 건축주" }] });

function defect(db0 = createSeed(NOW), photos = [JPG, JPG]) {
  return createPartnerRequest(db0, { idempotencyKey: "d1", siteId: "site-a", type: "defect", title: "3층 거실 창 누수", description: "비 올 때 창틀 아래로 물이 샘", location: "3층 302호 거실 창", photoDataUrls: photos }, ctx("u-partner"));
}

/** 접수 → 작업지시 → 현장 완료(사진) → 회신(보수 사진) */
function fullLoop() {
  const d = defect();
  const reqId = d.result.requestId;
  const wo = createWorkOrder(d.db, { siteId: "site-a", title: "하자보수 · 3층 거실 창 누수", detail: "위치: 3층 302호", assigneeUserId: "u-field", partnerRequestId: reqId, idempotencyKey: "w1" }, ctx("u-manager"));
  const woId = wo.result.workOrderId;
  const done = workOrderStep(wo.db, { workOrderId: woId, action: "complete", note: "실리콘 재시공", photoDataUrls: [JPG] }, ctx("u-field"));
  const donePhoto = done.db.workOrders!.find((w) => w.id === woId)!.donePhotoIds![0];
  const answered = updatePartnerRequest(done.db, reqId, { status: "answered", reply: "보수 완료했습니다.", sharePhotoIds: [donePhoto] }, ctx("u-manager"));
  return { d, reqId, wo, woId, done, donePhoto, answered };
}

describe("하자보수 요청 접수", () => {
  it("위치는 꼭, 사진은 3장까지 — 사진은 요청에 묶여 저장된다", () => {
    const db = createSeed(NOW);
    expect(() => createPartnerRequest(db, { idempotencyKey: "x", siteId: "site-a", type: "defect", title: "누수", description: "물이 샘" }, ctx("u-partner"))).toThrow(CommandError);
    try {
      defect(db, [JPG, JPG, JPG, JPG]);
      expect.unreachable();
    } catch (e) {
      expect((e as CommandError).fieldErrors.photos).toMatch(/3장/);
    }
    expect(() => defect(db, ["data:text/html;base64,PHNjcmlwdD4="])).toThrow(CommandError);
    const { db: next, result } = defect(db);
    const r = next.partnerRequests.find((x) => x.id === result.requestId)!;
    expect(r).toMatchObject({ type: "defect", location: "3층 302호 거실 창", status: "received" });
    expect(r.photoIds).toHaveLength(2);
    expect(next.photos.filter((p) => p.partnerRequestId === r.id)).toHaveLength(2);
    // 다른 유형은 위치·사진을 받지 않는다
    const q = createPartnerRequest(db, { idempotencyKey: "q", siteId: "site-a", type: "quote", title: "견적", description: "창 추가", item: "유리", location: "몰래", photoDataUrls: [JPG] }, ctx("u-partner"));
    expect(q.db.partnerRequests[0].location).toBeUndefined();
    expect(q.db.photos.length).toBe(db.photos.length);
  });
  it("발주처가 첨부한 사진은 본인에게만 다시 보이고, 공사사진대장·공정 사진 공개에는 들어가지 않는다", () => {
    const { db, result } = defect(withOther(createSeed(NOW)));
    const mine = viewFor(PARTNER, db, NOW);
    expect(mine.photos.filter((p) => p.partnerRequestId === result.requestId)).toHaveLength(2);
    expect(mine.photos.every((p) => p.caption === "첨부 사진" || !!p.shared)).toBe(true);
    expect(viewFor(OTHER, db, NOW).photos).toHaveLength(0);
    expect(viewFor(OTHER, db, NOW).partnerRequests).toHaveLength(0);
    expect(photoLedger(db, "site-a", "2026-01-01", "2026-12-31").some((e) => e.photo.partnerRequestId)).toBe(false);
    const pid = db.partnerRequests[0].photoIds![0];
    expect(() => setPhotoShare(db, { photoIds: [pid], shared: true }, ctx("u-manager"))).toThrow(/공개할 수 없습니다/);
  });
});

describe("하자보수 → 작업지시 → 보수 완료 회신 → 발주처 확인", () => {
  it("작업지시로 보내면 요청이 ‘검토 중’·보수 배정이 되고, 하자 사진이 현장 휴대폰에 간다", () => {
    const { wo, reqId, woId } = fullLoop();
    const r = wo.db.partnerRequests.find((x) => x.id === reqId)!;
    expect(r.status).toBe("reviewing");
    expect(r.linkedWorkOrderId).toBe(woId);
    expect(r.history.at(-1)?.note).toBe("보수 작업 배정");
    const w = wo.db.workOrders!.find((x) => x.id === woId)!;
    expect(w.sourcePartnerRequestId).toBe(reqId);
    expect(w.refPhotoIds).toEqual(r.photoIds);
    // 현장 직원은 하자 사진을 받는다
    const fv = viewFor(FIELD, wo.db, NOW);
    expect(r.photoIds!.every((id) => fv.photos.some((p) => p.id === id))).toBe(true);
    // 같은 요청으로 두 번 보내지 않는다
    expect(() => createWorkOrder(wo.db, { siteId: "site-a", title: "또 보수", assigneeUserId: "u-field", partnerRequestId: reqId }, ctx("u-manager"))).toThrow(/이미 보낸/);
    // 하자보수가 아닌 요청·다른 현장으로는 안 된다
    const seedReq = wo.db.partnerRequests.find((x) => x.type !== "defect")!;
    expect(() => createWorkOrder(wo.db, { siteId: "site-a", title: "보수", assigneeUserId: "u-field", partnerRequestId: seedReq.id }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => createWorkOrder(wo.db, { siteId: "site-b", title: "보수", assigneeUserId: "u-field", partnerRequestId: reqId }, ctx("u-manager"))).toThrow(CommandError);
  });
  it("발주처에게는 작업지시 번호·담당자·메모 없이 보수 단계와 기한만 간다", () => {
    const { wo, done, reqId } = fullLoop();
    const v1 = viewFor(PARTNER, wo.db, NOW);
    expect(v1.partnerRepairs?.[reqId]).toMatchObject({ stage: "assigned" });
    expect(v1.partnerRequests.find((r) => r.id === reqId)).not.toHaveProperty("linkedWorkOrderId");
    expect(v1.workOrders).toEqual([]);
    expect(JSON.stringify([v1.partnerRepairs, v1.partnerRequests])).not.toContain("u-field");
    // 현장이 ‘다 했어요’를 보내도 본사 확인 전에는 ‘보수 완료’가 아니다 (D-68 점검 반영)
    expect(viewFor(PARTNER, done.db, NOW).partnerRepairs?.[reqId]?.stage).toBe("checking");
    expect(JSON.stringify(viewFor(PARTNER, done.db, NOW).partnerRepairs)).not.toContain("실리콘");
    const { answered } = fullLoop();
    expect(viewFor(PARTNER, answered.db, NOW).partnerRepairs?.[reqId === answered.db.partnerRequests[0].id ? reqId : answered.db.partnerRequests[0].id]?.stage).toBe("done");
    // 본사·시연 화면은 같은 계산을 바로 한다
    expect(partnerRepairView(done.db, done.db.partnerRequests.find((r) => r.id === reqId)!)?.stage).toBe("checking");
  });
  it("회신과 함께 보낸 보수 사진은 그 발주처에게만 — 다른 발주처의 ‘공정 사진’에는 없다", () => {
    const base = fullLoop();
    const db = withOther(base.answered.db);
    const r = db.partnerRequests.find((x) => x.id === base.reqId)!;
    expect(r.replyPhotoIds).toEqual([base.donePhoto]);
    const mine = viewFor(PARTNER, db, NOW);
    expect(mine.photos.some((p) => p.id === base.donePhoto)).toBe(true);
    expect(sharedPhotos(mine, "site-a").some((p) => p.id === base.donePhoto)).toBe(false);
    expect(viewFor(OTHER, db, NOW).photos.some((p) => p.id === base.donePhoto)).toBe(false);
    // 작업지시 완료 사진이 아닌 사진은 보낼 수 없다
    const other = base.done.db.photos.find((p) => p.partnerRequestId)!.id;
    expect(() => updatePartnerRequest(base.done.db, base.reqId, { status: "answered", reply: "완료", sharePhotoIds: [other] }, ctx("u-manager"))).toThrow(CommandError);
  });
  it("알림: 작업 배정·회신은 발주처에게, 보수 사진은 따로 ‘새 공정 사진’ 알림을 보내지 않는다, 확인은 본사에게", () => {
    const { d, wo, done, answered, reqId } = fullLoop();
    expect(noticesFor(d.db, wo.db, "u-manager").find((n) => n.title === "하자보수 작업 배정")?.to).toEqual(["u-partner"]);
    const n2 = noticesFor(done.db, answered.db, "u-manager");
    expect(n2.map((n) => n.title)).toEqual(["하자보수 회신 도착"]);
    const c = confirmPartnerRequest(answered.db, { requestId: reqId, note: "확인했습니다" }, ctx("u-partner"));
    const n3 = noticesFor(answered.db, c.db, "u-partner");
    expect(n3).toEqual([expect.objectContaining({ title: "발주처 확인 완료" })]);
    expect(n3[0].to).not.toContain("u-partner");
  });
  it("발주처 확인: 본인 요청·회신 뒤에만, 한 번만 — 권한도 같은 기준", () => {
    const { answered, wo, reqId } = fullLoop();
    expect(() => confirmPartnerRequest(wo.db, { requestId: reqId }, ctx("u-partner"))).toThrow(/회신을 받은 뒤/);
    expect(() => confirmPartnerRequest(answered.db, { requestId: reqId }, ctx("u-partner2"))).toThrow(CommandError);
    const c = confirmPartnerRequest(answered.db, { requestId: reqId }, ctx("u-partner")).db;
    expect(c.partnerRequests.find((r) => r.id === reqId)!.confirmedAt).toBe(NOW.toISOString());
    expect(() => confirmPartnerRequest(c, { requestId: reqId }, ctx("u-partner"))).toThrow(/이미 확인/);
    expect(() => authorize(PARTNER, "confirmPartnerRequest", { requestId: reqId }, answered.db, NOW)).not.toThrow();
    expect(() => authorize(OTHER, "confirmPartnerRequest", { requestId: reqId }, answered.db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(FIELD, "confirmPartnerRequest", { requestId: reqId }, answered.db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(PARTNER, "createWorkOrder", { siteId: "site-a", title: "x", partnerRequestId: reqId }, answered.db, NOW)).toThrow(ForbiddenError);
  });
});

describe("발주처 월간 공정 보고서", () => {
  it("이번 달 단계 진척(처음 → 마지막), 공개 사진, 요청 처리, 다음 달 예정 — 금액 없이", () => {
    const db0 = createSeed(NOW);
    const st = db0.sites.find((s) => s.id === "site-a")!.stages.find((x) => x.progressPct >= 10 && x.progressPct < 80)!;
    let db = submitFieldReport(db0, { idempotencyKey: "m1", siteId: "site-a", reportDate: "2026-11-02", workDone: "작업", stageProgress: [{ stageId: st.id, progressPct: st.progressPct + 5 }], photos: [{ dataUrl: JPG }] }, ctx("u-field", new Date("2026-11-02T03:00:00Z"))).db;
    db = submitFieldReport(db, { idempotencyKey: "m2", siteId: "site-a", reportDate: "2026-11-04", workDone: "작업", stageProgress: [{ stageId: st.id, progressPct: st.progressPct + 12 }] }, ctx("u-field")).db;
    const ph = db.photos.find((p) => p.siteId === "site-a" && p.reportId)!;
    db = setPhotoShare(db, { photoIds: [ph.id], shared: true, caption: "유닛 설치" }, ctx("u-manager")).db;
    db = defect(db).db;
    const feed = partnerProgressFeed(db, "site-a", "2026-11-04", 62);
    const m = partnerMonthly(db, "site-a", "2026-11", feed, "u-partner");
    expect(m.stages.find((x) => x.stage === st.name)).toMatchObject({ from: st.progressPct, to: st.progressPct + 12 });
    expect(m.photos.map((p) => p.id)).toEqual([ph.id]);
    const novSeed = db0.partnerRequests.filter((r) => r.siteId === "site-a" && r.createdAt >= "2026-11-01").length;
    expect(m.counts).toMatchObject({ received: novSeed + 1, defects: 1 });
    expect(m.requests.some((r) => r.type === "defect")).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/contractAmount|amount|원가/);
    // 지난달에는 이번 달 기록이 들어가지 않는다
    const prev = partnerMonthly(db, "site-a", "2026-10", feed, "u-partner");
    // (시연 데이터의 지난달 기록은 그대로 — 이번 달에 보낸 보고만 섞이지 않으면 된다 · D-69)
    expect(prev.stages).toEqual(partnerMonthly(db0, "site-a", "2026-10", partnerProgressFeed(db0, "site-a", "2026-11-04", 62), "u-partner").stages);
    expect(prev.photos).toHaveLength(0);
    // 서버는 발주처에게 62일치를 보내 같은 보고서가 나온다
    const v = viewFor(PARTNER, db, NOW);
    expect(partnerMonthly(v, "site-a", "2026-11", v.partnerFeed!["site-a"], "u-partner").stages).toEqual(m.stages);
  });
  it("달의 마지막 날 계산", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(monthRange("2026-12").to).toBe("2026-12-31");
  });
});

describe("D-68 점검 반영", () => {
  it("‘보수 완료’는 본사가 작업지시를 확인했거나 현장 완료 뒤 회신했을 때만 · 다시 보수하면 발주처 확인이 풀린다", async () => {
    const { reviewWorkOrder } = await import("@/lib/data/opsCommands");
    const { done, woId, reqId, answered } = fullLoop();
    const req = (db: DemoDB) => db.partnerRequests.find((r) => r.id === reqId)!;
    expect(partnerRepairView(done.db, req(done.db))?.stage).toBe("checking");
    expect(() => confirmPartnerRequest(done.db, { requestId: reqId }, ctx("u-partner"))).toThrow(CommandError);
    const ok = reviewWorkOrder(done.db, { workOrderId: woId, decision: "confirm" }, ctx("u-manager")).db;
    expect(partnerRepairView(ok, req(ok))?.stage).toBe("done");
    expect(partnerRepairView(answered.db, req(answered.db))?.stage).toBe("done");
    // 발주처가 확인한 뒤 본사가 보완 요청 → 확인이 풀리고 ‘보수 중’
    const confirmed = confirmPartnerRequest(answered.db, { requestId: reqId }, ctx("u-partner")).db;
    const back = reviewWorkOrder(confirmed, { workOrderId: woId, decision: "return", note: "실리콘 다시" }, ctx("u-manager")).db;
    expect(req(back).confirmedAt).toBeUndefined();
    expect(req(back).history.at(-1)?.note).toMatch(/추가 보수/);
    expect(partnerRepairView(back, req(back))?.stage).toBe("in_progress");
    // 현장이 다시 끝내면 ‘마무리 확인 중’ → 사진 없이도 다시 회신할 수 있다
    const again = workOrderStep(back, { workOrderId: woId, action: "complete", note: "재보수 완료" }, ctx("u-field", new Date(NOW.getTime() + 3_600_000))).db;
    expect(partnerRepairView(again, req(again))?.stage).toBe("checking");
    const re = updatePartnerRequest(again, reqId, { status: "answered", reply: "재보수를 마쳤습니다." }, ctx("u-manager", new Date(NOW.getTime() + 7_200_000))).db;
    expect(partnerRepairView(re, req(re))?.stage).toBe("done");
    expect(noticesFor(again, re, "u-manager").map((n) => n.title)).toEqual(["하자보수 회신 도착"]);
  });
  it("접수에서 바로 회신해도 ‘검토 중’ 단계가 남고, 다시 요청은 원래 요청과 이어진다 · 지난 희망일은 받지 않는다", () => {
    const d = defect();
    const r1 = updatePartnerRequest(d.db, d.result.requestId, { status: "answered", reply: "하자 아님 — 전화로 안내드렸습니다." }, ctx("u-manager")).db;
    expect(r1.partnerRequests[0].history.map((h) => h.status)).toEqual(["received", "reviewing", "answered"]);
    const again = createPartnerRequest(r1, { idempotencyKey: "re1", siteId: "site-a", type: "defect", title: "3층 거실 창 누수", description: "또 샙니다", location: "3층 302호", reopenedFrom: d.result.requestId }, ctx("u-partner"));
    expect(again.db.partnerRequests.find((r) => r.id === again.result.requestId)!.reopenedFrom).toBe(d.result.requestId);
    expect(() => createPartnerRequest(r1, { idempotencyKey: "re2", siteId: "site-a", type: "defect", title: "x", description: "y", location: "z", reopenedFrom: "nope" }, ctx("u-partner"))).toThrow(CommandError);
    expect(() => createPartnerRequest(r1, { idempotencyKey: "re3", siteId: "site-a", type: "defect", title: "x", description: "y", location: "z", desiredDate: "2026-11-01" }, ctx("u-partner"))).toThrow(CommandError);
  });
  it("보수 전에 일정 안내로 회신했어도, 보수가 끝나면 보수 사진을 한 번 더 보낼 수 있다 — 확인은 보수가 끝난 뒤에만", () => {
    const d = defect();
    const reqId = d.result.requestId;
    const wo = createWorkOrder(d.db, { siteId: "site-a", title: "하자보수", assigneeUserId: "u-field", partnerRequestId: reqId }, ctx("u-manager"));
    const early = updatePartnerRequest(wo.db, reqId, { status: "answered", reply: "화요일에 방문합니다." }, ctx("u-manager")).db;
    // 보수 전에는 발주처가 ‘보수 확인’을 할 수 없다
    expect(() => confirmPartnerRequest(early, { requestId: reqId }, ctx("u-partner"))).toThrow(/보수가 끝난 뒤/);
    const done = workOrderStep(early, { workOrderId: wo.result.workOrderId, action: "complete", note: "재시공", photoDataUrls: [JPG] }, ctx("u-field")).db;
    const photo = done.workOrders!.find((w) => w.id === wo.result.workOrderId)!.donePhotoIds![0];
    // 사진 없이 같은 단계를 다시 보내는 것은 여전히 막는다
    expect(() => updatePartnerRequest(done, reqId, { status: "answered", reply: "다시" }, ctx("u-manager"))).toThrow(/이미 처리된/);
    const follow = updatePartnerRequest(done, reqId, { status: "answered", reply: "보수 완료했습니다.", sharePhotoIds: [photo] }, ctx("u-manager")).db;
    const r = follow.partnerRequests.find((x) => x.id === reqId)!;
    expect(r).toMatchObject({ reply: "보수 완료했습니다.", replyPhotoIds: [photo] });
    expect(noticesFor(done, follow, "u-manager").map((n) => n.title)).toEqual(["보수 완료 사진 도착"]);
    expect(() => confirmPartnerRequest(follow, { requestId: reqId }, ctx("u-partner"))).not.toThrow();
    // 월간 보고서: 회신은 처음 회신한 한 번만 센다
    const m = partnerMonthly(follow, "site-a", "2026-11", [], "u-partner");
    expect(m.counts.answered).toBe(1 + createSeed(NOW).partnerRequests.filter((x) => x.partnerUserId === "u-partner" && x.history.find((h) => h.status === "answered")?.at.startsWith("2026-11")).length);
  });
  it("보완 요청으로 되돌린 작업지시의 예전 사진은 보낼 수 없다", async () => {
    const { reviewWorkOrder } = await import("@/lib/data/opsCommands");
    const { done, woId, reqId, donePhoto } = fullLoop();
    const back = reviewWorkOrder(done.db, { workOrderId: woId, decision: "return", note: "실리콘 다시" }, ctx("u-manager")).db;
    expect(() => updatePartnerRequest(back, reqId, { status: "answered", reply: "완료", sharePhotoIds: [donePhoto] }, ctx("u-manager"))).toThrow(/끝난 뒤/);
  });
  it("하자보수 사진은 사진대장의 ‘발주처 공개’로 전체 공개할 수 없다 (끄는 것은 된다)", () => {
    const { done, donePhoto, answered } = fullLoop();
    expect(() => setPhotoShare(done.db, { photoIds: [donePhoto], shared: true }, ctx("u-manager"))).toThrow(/회신으로만/);
    expect(() => setPhotoShare(answered.db, { photoIds: [donePhoto], shared: false }, ctx("u-manager"))).not.toThrow();
  });
  it("회신으로 보낸 보수 사진 뒤 10분 만에 공개한 공정 사진도 알림이 간다", () => {
    const { answered } = fullLoop();
    let db = submitFieldReport(answered.db, { idempotencyKey: "n1", siteId: "site-a", reportDate: "2026-11-04", workDone: "작업", photos: [{ dataUrl: JPG }] }, ctx("u-field")).db;
    const ph = db.photos.find((p) => p.reportId)!;
    const before = db;
    db = setPhotoShare(db, { photoIds: [ph.id], shared: true }, ctx("u-manager", new Date(NOW.getTime() + 10 * 60_000))).db;
    expect(noticesFor(before, db, "u-manager").map((n) => n.title)).toEqual(["새 공정 사진"]);
  });
  it("유형 이름 검사 — ‘toString’ 같은 값은 받지 않는다 · 현장 휴대폰에는 발주처 요청을 보내지 않는다", () => {
    const db = createSeed(NOW);
    expect(() => createPartnerRequest(db, { idempotencyKey: "t", siteId: "site-a", type: "toString" as never, title: "x", description: "y" }, ctx("u-partner"))).toThrow(CommandError);
    expect(viewFor(FIELD, defect(db).db, NOW).partnerRequests).toEqual([]);
  });
  it("본사 전화번호가 없으면 자료 점검의 ‘빠진 자료’ 수에도 들어간다", async () => {
    const { readinessAll } = await import("@/lib/domain/readiness");
    const db = createSeed(NOW);
    const without = { ...db, settings: { ...db.settings!, helpPhone: "  " } };
    const withPhone = { ...db, settings: { ...db.settings!, helpPhone: "02-000-0000" } };
    expect(readinessAll(without, "2026-11-04").missing - readinessAll(withPhone, "2026-11-04").missing).toBe(1);
    expect(readinessAll(without, "2026-11-04").company.find((i) => i.key === "help-phone")?.status).toBe("missing");
  });
});
