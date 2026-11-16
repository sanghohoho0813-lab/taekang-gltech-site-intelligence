/** D-84 변경공사 청구·회수 관리 — 추가 원가로 만들기 · 발주처 청구·확인 기록 · 일부 승인·반려 사유 · 다시 청구 · 회수율 · 처리 대기 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { CommandError, setChangeOrderStatus } from "@/lib/data/commands";
import { createChangeOrder, logChangeOrder } from "@/lib/data/changeOrderCommands";
import { coAttentionCount, coBoard, coByEntry } from "@/lib/domain/changeOrders";
import { pendingItems } from "@/lib/domain/pending";
import { profitEvents } from "@/lib/domain/monthClose";
import { computeSignals } from "@/lib/domain/risk";
import { siteFinancials } from "@/lib/domain/calc";
import { authorize, ForbiddenError, viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { CostEntry, DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-14T03:00:00Z"); // 11/14 12:00 KST
const ctx = (userId: string, now = NOW) => ({ userId, now });
const err = (f: () => unknown): CommandError => {
  try {
    f();
  } catch (e) {
    return e as CommandError;
  }
  throw new Error("no error");
};

/** site-a에 설계변경 추가 원가 2건 · 공기 지연 1건 · 확인 대기 1건 */
function setup(): DemoDB {
  const db = createSeed(NOW);
  // 시연 변경공사는 ‘챙길 것’에 안 걸리게 먼 확인 날로
  for (const c of db.changeOrders) c.nextFollowUp = "2099-12-31";
  const base = { siteId: "site-a", forecastImpact: "additional" as const, source: "PC" as const, createdBy: "u-manager", status: "active" as const };
  const add = (e: Partial<CostEntry> & { id: string; amount: number }) => db.costEntries.push({ category: "material", date: "2026-11-05", reason: "design_change", note: "", createdAt: "2026-11-05T02:00:00Z", ...base, ...e } as CostEntry);
  add({ id: "ce-dc-1", amount: 18_000_000, note: "3층 유리 사양 상향 차액" });
  add({ id: "ce-dc-2", amount: 2_000_000, category: "labor", note: "변경 구간 추가 인력" });
  add({ id: "ce-sch", amount: 3_000_000, reason: "schedule", note: "크레인 대기" });
  add({ id: "ce-pend", amount: 1_000_000, status: "pending", note: "확인 대기" });
  add({ id: "ce-b", amount: 5_000_000, siteId: "site-b", note: "다른 현장" });
  return db;
}

describe("D-84 변경공사 만들기", () => {
  it("추가 원가를 근거로 만들면 청구 검토 · 기록 · 청구 안 한 목록에서 빠짐 · 위험 신호도 풀림", () => {
    const db = setup();
    expect(coBoard(db, "2026-11-14").unclaimed.map((e) => e.id)).toEqual(expect.arrayContaining(["ce-dc-1", "ce-dc-2"]));
    expect(computeSignals(db, NOW).some((s) => s.rule === "UNBILLED_CHANGE" && s.siteId === "site-a")).toBe(true);
    const r = createChangeOrder(db, { siteId: "site-a", title: "3층 남측 유리 사양 상향", amount: 23_000_000, entryIds: ["ce-dc-1", "ce-dc-2"], idempotencyKey: "idem-d84-create-01" }, ctx("u-manager"));
    const co = r.db.changeOrders.find((c) => c.id === r.result.id)!;
    expect(co).toMatchObject({ status: "review", amount: 23_000_000, sourceEntryIds: ["ce-dc-1", "ce-dc-2"], createdBy: "u-manager" });
    expect(co.log?.[0]).toMatchObject({ kind: "created", date: "2026-11-14" });
    const b = coBoard(r.db, "2026-11-14");
    expect(b.unclaimed.map((e) => e.id)).not.toContain("ce-dc-1");
    expect(b.otherExtra.map((e) => e.id)).toContain("ce-sch");
    expect(b.open.find((x) => x.co.id === co.id)?.linkedCost).toBe(20_000_000);
    expect(computeSignals(r.db, NOW).some((s) => s.rule === "UNBILLED_CHANGE" && s.siteId === "site-a")).toBe(false);
    // 계약·이익에는 아직 안 들어감
    expect(siteFinancials(r.db, "site-a").adjustedContract).toBe(siteFinancials(db, "site-a").adjustedContract);
  });

  it("두 번 청구·다른 현장·확인 대기·추가 원가 아닌 원가는 막는다 · 제목·금액·메모 검사", () => {
    const db = setup();
    const a = createChangeOrder(db, { siteId: "site-a", title: "유리", amount: 20_000_000, entryIds: ["ce-dc-1"] }, ctx("u-manager")).db;
    expect(err(() => createChangeOrder(a, { siteId: "site-a", title: "또 청구", amount: 1_000_000, entryIds: ["ce-dc-1"] }, ctx("u-manager"))).code).toBe("DUPLICATE");
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "다른 현장", amount: 1_000_000, entryIds: ["ce-b"] }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "대기", amount: 1_000_000, entryIds: ["ce-pend"] }, ctx("u-manager"))).message).toMatch(/확정된 원가/);
    db.costEntries.push({ id: "ce-plan", siteId: "site-a", category: "material", amount: 1_000_000, date: "2026-11-05", forecastImpact: "within_forecast", reason: "planned", note: "계획 자재", source: "PC", createdBy: "u-manager", createdAt: "2026-11-05T02:00:00Z", status: "active" });
    const within = db.costEntries.at(-1)!;
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "계획", amount: 1_000_000, entryIds: [within.id] }, ctx("u-manager"))).message).toMatch(/추가 원가/);
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: " ", amount: 1_000_000 }, ctx("u-manager"))).fieldErrors.title).toBeTruthy();
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "가".repeat(81), amount: 1_000_000 }, ctx("u-manager"))).fieldErrors.title).toBeTruthy();
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "금액", amount: 0 }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "금액", amount: -5 }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "형식", amount: 1_000_000, entryIds: "ce-dc-1" as never }, ctx("u-manager"))).fieldErrors.entryIds).toBeTruthy();
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "메모", amount: 1_000_000, note: "가".repeat(201) }, ctx("u-manager"))).fieldErrors.note).toBeTruthy();
    // 근거 없이도 (발주처 요청 추가공사)
    const n = createChangeOrder(db, { siteId: "site-a", title: "로비 자동문 추가", amount: 14_500_000 }, ctx("u-manager"));
    expect(n.db.changeOrders.find((c) => c.id === n.result.id)?.sourceEntryIds).toEqual([]);
  });
});

describe("D-84 발주처 청구 · 확인 기록 · 결정", () => {
  const made = () => {
    const db = setup();
    const r = createChangeOrder(db, { siteId: "site-a", title: "유리 사양 상향", amount: 23_000_000, entryIds: ["ce-dc-1", "ce-dc-2"] }, ctx("u-manager", new Date("2026-11-06T01:00:00Z")));
    return { db: r.db, id: r.result.id };
  };

  it("발주처 청구 때 다음 확인할 날 · 그날이 되면 처리 대기·아침 알림 · 기록하면 날짜가 바뀜", () => {
    const { db, id } = made();
    expect(err(() => setChangeOrderStatus(db, id, "submitted", undefined, ctx("u-manager"), undefined, { followUp: "2026-11-14" })).message).toMatch(/내일 이후/);
    expect(err(() => setChangeOrderStatus(db, id, "submitted", undefined, ctx("u-manager"), undefined, { followUp: "2027-12-01" })).message).toMatch(/180일/);
    expect(err(() => setChangeOrderStatus(db, id, "submitted", undefined, ctx("u-manager"), undefined, { followUp: "2026-02-30" })).message).toMatch(/형식/);
    const s = setChangeOrderStatus(db, id, "submitted", undefined, ctx("u-manager"), undefined, { followUp: "2026-11-20", note: "견적서 메일 발송" }).db;
    const co = s.changeOrders.find((c) => c.id === id)!;
    expect(co).toMatchObject({ status: "submitted", nextFollowUp: "2026-11-20" });
    expect(co.log?.at(-1)).toMatchObject({ kind: "submitted", note: "견적서 메일 발송" });
    expect(err(() => setChangeOrderStatus(s, id, "submitted", undefined, ctx("u-manager"))).code).toBe("STATE");
    expect(coAttentionCount(s, "2026-11-19")).toBe(0);
    expect(coAttentionCount(s, "2026-11-20")).toBe(1);
    expect(pendingItems(s, "2026-11-20", true, "manager").find((p) => p.key === "co")?.n).toBe(1);
    // 기록 — 날짜·내용 검사, 다음 확인할 날 바꿈·지움
    const later = new Date("2026-11-20T02:00:00Z");
    expect(err(() => logChangeOrder(s, { coId: id, kind: "follow_up", date: "2026-11-21", note: "미래" }, ctx("u-manager", later))).fieldErrors.date).toBeTruthy();
    expect(err(() => logChangeOrder(s, { coId: id, kind: "follow_up", date: "2026-11-01", note: "등록 전" }, ctx("u-manager", later))).fieldErrors.date).toBeTruthy();
    expect(err(() => logChangeOrder(s, { coId: id, kind: "follow_up", date: "2026-11-20", note: "x" }, ctx("u-manager", later))).fieldErrors.note).toBeTruthy();
    expect(err(() => logChangeOrder(s, { coId: id, kind: "approve" as never, date: "2026-11-20", note: "종류" }, ctx("u-manager", later))).fieldErrors.kind).toBeTruthy();
    const l = logChangeOrder(s, { coId: id, kind: "follow_up", date: "2026-11-20", note: "원청 공무 통화 — 다음 주 검토", nextFollowUp: "2026-11-27" }, ctx("u-manager", later)).db;
    expect(l.changeOrders.find((c) => c.id === id)?.nextFollowUp).toBe("2026-11-27");
    expect(coAttentionCount(l, "2026-11-20")).toBe(0);
    // 발주처에 청구한 건은 다음 확인할 날을 지울 수 없다 (날짜가 없으면 아무도 챙기지 않던 문제)
    expect(err(() => logChangeOrder(l, { coId: id, kind: "note", date: "2026-11-20", note: "확인 날 지움", nextFollowUp: null }, ctx("u-manager", later))).fieldErrors.nextFollowUp).toBeTruthy();
    // 위험 신호 이유에 마지막 확인이 보인다
    const sig = computeSignals(l, new Date("2026-12-20T03:00:00Z")).find((x) => x.rule === "PENDING_CHANGE_ORDER" && x.key.endsWith(id));
    expect(sig?.why.join(" ")).toContain("원청 공무 통화");
  });

  it("청구 검토로 7일 넘게 머물면 처리 대기 (발주처에 안 보냄)", () => {
    const { db } = made();
    expect(coAttentionCount(db, "2026-11-13")).toBe(0);
    expect(coAttentionCount(db, "2026-11-14")).toBe(1);
  });

  it("요청과 다른 금액 승인·반려는 사유 필수 · 결정하면 다음 확인할 날 지움 · 회수율", () => {
    const { db, id } = made();
    const s = setChangeOrderStatus(db, id, "submitted", undefined, ctx("u-manager"), undefined, { followUp: "2026-11-20" }).db;
    expect(err(() => setChangeOrderStatus(s, id, "approved", 21_000_000, ctx("u-ceo"))).fieldErrors.note).toBeTruthy();
    expect(err(() => setChangeOrderStatus(s, id, "rejected", undefined, ctx("u-ceo"))).fieldErrors.note).toBeTruthy();
    expect(err(() => setChangeOrderStatus(s, id, "approved", 21_000_000, ctx("u-ceo"), undefined, { note: "가".repeat(201) })).fieldErrors.note).toBeTruthy();
    // 같은 금액 승인은 사유 없이
    expect(() => setChangeOrderStatus(s, id, "approved", 23_000_000, ctx("u-ceo"))).not.toThrow();
    const a = setChangeOrderStatus(s, id, "approved", 21_000_000, ctx("u-ceo"), undefined, { note: "원청 단가 협의로 감액" }).db;
    const co = a.changeOrders.find((c) => c.id === id)!;
    expect(co).toMatchObject({ status: "approved", approvedAmount: 21_000_000, decisionNote: "원청 단가 협의로 감액" });
    expect(co.nextFollowUp).toBeUndefined();
    expect(co.log?.at(-1)?.note).toContain("요청 2,300만 원 → 승인 2,100만 원");
    const b = coBoard(a, "2026-11-14");
    expect(b.totals).toMatchObject({ decidedCost: 20_000_000, recovered: 21_000_000, recoveryPct: 105, claimed: 23_000_000, approved: 21_000_000, claimPct: 91 });
    expect(siteFinancials(a, "site-a").adjustedContract - siteFinancials(db, "site-a").adjustedContract).toBe(21_000_000);
  });

  it("반려 → 다시 청구(한 번만 · 근거 원가 그대로) · 반려 건은 회수율에서 다시 청구한 건으로 대신 · 반려된 원가는 ‘청구 안 함’이 아님", () => {
    const { db, id } = made();
    const r = setChangeOrderStatus(db, id, "rejected", undefined, ctx("u-ceo"), undefined, { note: "설계 범위 안이라 불인정" }).db;
    expect(r.changeOrders.find((c) => c.id === id)?.decisionNote).toBe("설계 범위 안이라 불인정");
    expect(coBoard(r, "2026-11-14").unclaimed.map((e) => e.id)).not.toContain("ce-dc-1");
    expect(coBoard(r, "2026-11-14").totals).toMatchObject({ recovered: 0, recoveryPct: 0 });
    expect(coByEntry(r).has("ce-dc-1")).toBe(false);
    // 다시 청구 — 근거를 비우면 반려 건의 원가
    const re = createChangeOrder(r, { siteId: "site-a", title: "유리 사양 상향 (도면 근거 보강)", amount: 22_000_000, reclaimOf: id }, ctx("u-manager"));
    const n = re.db.changeOrders.find((c) => c.id === re.result.id)!;
    expect(n).toMatchObject({ reclaimOf: id, sourceEntryIds: ["ce-dc-1", "ce-dc-2"] });
    expect(n.log?.[0].note).toContain("다시 청구");
    expect(err(() => createChangeOrder(re.db, { siteId: "site-a", title: "또 청구", amount: 1_000_000, reclaimOf: id }, ctx("u-manager"))).code).toBe("DUPLICATE");
    expect(err(() => createChangeOrder(r, { siteId: "site-b", title: "다른 현장", amount: 1_000_000, reclaimOf: id }, ctx("u-manager"))).code).toBe("NOT_FOUND");
    const open = createChangeOrder(setup(), { siteId: "site-a", title: "진행 중", amount: 1_000_000 }, ctx("u-manager"));
    expect(err(() => createChangeOrder(open.db, { siteId: "site-a", title: "x2", amount: 1_000_000, reclaimOf: open.result.id }, ctx("u-manager"))).code).toBe("STATE");
    // 반려 건은 다시 청구한 건이 있으면 회수율에서 빠진다
    expect(coBoard(re.db, "2026-11-14").totals.recoveryPct).toBeNull();
  });

  it("월 마감·대표 보고서의 ‘이익을 바꾼 일’이 원가를 가리킨다 (그 원가의 변경공사를 옆에)", () => {
    const db = setup();
    const ev = profitEvents(db, "site-a", "2026-11-01", "2026-11-30").find((e) => e.entryId === "ce-dc-1");
    expect(ev?.amount).toBe(-18_000_000);
  });
});

describe("D-84 권한·보이는 범위", () => {
  const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: ["site-a"], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
  it("현장·발주처는 만들기·기록·상태 바꾸기 모두 403 · 변경공사(기록 포함)가 내려가지 않음", () => {
    const db = setup();
    for (const role of ["field", "partner"] as const) {
      const m = member(`u-${role}`, role, role === "partner" ? { partnerSiteIds: ["site-a"] } : {});
      for (const name of ["createChangeOrder", "logChangeOrder", "setChangeOrderStatus"] as const) expect(() => authorize(m, name, { siteId: "site-a", coId: "co-c-1" }, db, NOW), `${role}:${name}`).toThrow(ForbiddenError);
      expect(viewFor(m, db, NOW).changeOrders).toEqual([]);
    }
    expect(() => authorize(member("u-manager", "manager"), "createChangeOrder", { siteId: "site-a" }, db, NOW)).not.toThrow();
  });
});

describe("D-84 점검 고침", () => {
  const made = (status: "review" | "submitted" = "submitted") => {
    const db = setup();
    const r = createChangeOrder(db, { siteId: "site-a", title: "유리 사양 상향", amount: 23_000_000, entryIds: ["ce-dc-1", "ce-dc-2"] }, ctx("u-manager", new Date("2026-11-06T01:00:00Z")));
    const s = status === "submitted" ? setChangeOrderStatus(r.db, r.result.id, "submitted", undefined, ctx("u-manager", new Date("2026-11-07T01:00:00Z"))).db : r.db;
    return { db: s, id: r.result.id };
  };

  it("확인할 날 없이 발주처에 청구한 건은 ‘챙길 것’ · 반려 뒤 다시 청구할지 안 정한 건도", () => {
    const { db, id } = made();
    expect(coBoard(db, "2026-11-14", "site-a").totals).toMatchObject({ noFollow: 1, attention: 1, submittedN: 1, reviewN: 0 });
    const rej = setChangeOrderStatus(db, id, "rejected", undefined, ctx("u-ceo"), undefined, { note: "불인정" }).db;
    expect(coBoard(rej, "2026-11-14", "site-a").totals).toMatchObject({ reclaimUndecided: 1, attention: 1, noFollow: 0 });
    const no = logChangeOrder(rej, { coId: id, kind: "no_reclaim", date: "2026-11-14", note: "관계 고려 — 우리가 부담" }, ctx("u-ceo")).db;
    expect(no.changeOrders.find((c) => c.id === id)?.noReclaim?.note).toBe("관계 고려 — 우리가 부담");
    expect(coBoard(no, "2026-11-14", "site-a").totals.attention).toBe(0);
    expect(err(() => logChangeOrder(no, { coId: id, kind: "no_reclaim", date: "2026-11-14", note: "또" + "또" }, ctx("u-ceo"))).fieldErrors.kind).toBeTruthy();
    expect(err(() => logChangeOrder(db, { coId: id, kind: "no_reclaim", date: "2026-11-14", note: "진행 중" }, ctx("u-ceo"))).fieldErrors.kind).toBeTruthy();
    // 결정된 건에는 메모만
    expect(err(() => logChangeOrder(rej, { coId: id, kind: "follow_up", date: "2026-11-14", note: "결정 뒤 독촉" }, ctx("u-ceo"))).fieldErrors.kind).toBeTruthy();
  });

  it("조치 완료로 같은 원가를 두 번 청구하지 않는다 (이익 이중 계상 방지)", async () => {
    const { completeAction, createAction } = await import("@/lib/data/commands");
    const db0 = setup();
    const sig = computeSignals(db0, NOW).find((x) => x.rule === "UNBILLED_CHANGE" && x.siteId === "site-a")!;
    const a = createAction(db0, { signal: sig }, ctx("u-ceo")).db;
    const act = a.actions.find((x) => x.signalKey === sig.key)!;
    const claimed = createChangeOrder(a, { siteId: "site-a", title: "보드에서 청구", amount: 21_000_000, entryIds: act.causeEntryIds }, ctx("u-manager")).db;
    const done = completeAction(claimed, act.id, { result: "청구 검토함", registerChangeOrder: true, claimAmount: 20_000_000, confirm: true }, ctx("u-manager")).db;
    expect(done.changeOrders.filter((c) => c.sourceEntryIds.some((x) => act.causeEntryIds.includes(x)))).toHaveLength(1);
    expect(done.actions.find((x) => x.id === act.id)?.status).toBe("done");
  });

  it("청구한 근거 원가: 현장은 고치기·취소·보고 되돌리기 403 · 본사도 무효·계획 안 집행으로 바꾸기는 막음", async () => {
    const { voidCostEntry, editCostEntry, voidReport } = await import("@/lib/data/commands");
    const db = setup();
    db.costEntries.find((e) => e.id === "ce-dc-1")!.createdBy = "u-field";
    db.reports.push({ id: "rpt-d84", siteId: "site-a", reportDate: "2026-11-05", workDone: "변경 구간", issues: "", tomorrowPlan: "", photoIds: [], costEntryIds: ["ce-dc-1"], createdBy: "u-field", createdAt: "2026-11-05T02:00:00Z", status: "submitted" });
    const c = createChangeOrder(db, { siteId: "site-a", title: "유리", amount: 20_000_000, entryIds: ["ce-dc-1"] }, ctx("u-manager")).db;
    const field = { id: "u-field", companyId: "c1", email: "f@t.test", name: "f", title: "", role: "field" as const, siteIds: ["site-a"], partnerSiteIds: [], active: true, mustChangePassword: false };
    expect(() => authorize(field, "editCostEntry", { entryId: "ce-dc-1", patch: { amount: 1, category: "material", note: "" } }, c, NOW)).toThrow(/변경공사로 청구/);
    expect(() => authorize(field, "voidCostEntry", { entryId: "ce-dc-1" }, c, NOW)).toThrow(/변경공사로 청구/);
    expect(err(() => voidCostEntry(c, "ce-dc-1", "실수", ctx("u-manager"))).message).toMatch(/근거 원가/);
    expect(err(() => voidReport(c, "rpt-d84", ctx("u-manager"))).message).toMatch(/변경공사/);
    expect(err(() => editCostEntry(c, "ce-dc-1", { amount: 18_000_000, category: "material", note: "x", forecastImpact: "within_forecast" }, ctx("u-manager"))).fieldErrors.forecastImpact).toBeTruthy();
    // 금액 고치기는 본사가 할 수 있다
    expect(() => editCostEntry(c, "ce-dc-1", { amount: 17_000_000, category: "material", note: "x" }, ctx("u-manager"))).not.toThrow();
    // 반려하면 다시 풀린다
    const rej = setChangeOrderStatus(c, c.changeOrders.at(-1)!.id, "rejected", undefined, ctx("u-ceo"), undefined, { note: "불인정" }).db;
    expect(() => voidCostEntry(rej, "ce-dc-1", "실수", ctx("u-manager"))).not.toThrow();
  });

  it("승인 금액: 비우거나 0이면 금액 칸 · 청구보다 크면 막음 · 계약보다 큰 청구는 단위 확인 · 날짜·근거", () => {
    const { db, id } = made();
    expect(err(() => setChangeOrderStatus(db, id, "approved", 0, ctx("u-ceo"))).fieldErrors.approvedAmount).toBeTruthy();
    expect(err(() => setChangeOrderStatus(db, id, "approved", 50_000_000, ctx("u-ceo"), undefined, { note: "가나" })).fieldErrors.approvedAmount).toBeTruthy();
    expect(err(() => createChangeOrder(db, { siteId: "site-a", title: "단위 실수", amount: 4_990_000_000 }, ctx("u-manager"))).fieldErrors.amount).toMatch(/계약금액/);
    const bad = err(() => createChangeOrder(db, { siteId: "site-a", title: "x", amount: 0 }, ctx("u-manager")));
    expect(bad.fieldErrors.title && bad.fieldErrors.amount).toBeTruthy();
    expect(err(() => setChangeOrderStatus(db, id, "approved", 23_000_000, ctx("u-ceo"), undefined, { basis: "maybe" as never })).fieldErrors.basis).toBeTruthy();
    expect(err(() => setChangeOrderStatus(db, id, "rejected", undefined, ctx("u-ceo"), undefined, { note: "x2", basis: "contract" })).fieldErrors.basis).toBeTruthy();
    expect(err(() => setChangeOrderStatus(db, id, "approved", 23_000_000, ctx("u-ceo"), undefined, { date: "2026-11-15" })).fieldErrors.date).toBeTruthy();
    expect(err(() => setChangeOrderStatus(db, id, "approved", 23_000_000, ctx("u-ceo"), undefined, { date: "2026-11-01" })).fieldErrors.date).toBeTruthy();
    // 11/10에 공문으로 받은 승인을 11/14에 넣음 → 결정일 11/10 · 이익은 11/10에
    const a = setChangeOrderStatus(db, id, "approved", 23_000_000, ctx("u-ceo"), undefined, { date: "2026-11-10", basis: "letter" }).db;
    const co = a.changeOrders.find((c) => c.id === id)!;
    expect(co).toMatchObject({ decidedAt: "2026-11-10T03:00:00.000Z", approvalBasis: "letter" });
    expect(co.log?.at(-1)).toMatchObject({ date: "2026-11-10" });
    expect(co.log?.at(-1)?.note).toContain("발주처 공문·메일로 승인");
    expect(profitEvents(a, "site-a", "2026-11-10", "2026-11-10").some((e) => e.amount === 23_000_000)).toBe(true);
  });

  it("다시 청구: 근거 원가가 모두 무효면 근거 없이 · 근거 원가를 계획 안 집행으로 바꾸면 회수율에서 빠짐", () => {
    const { db, id } = made();
    const rej = setChangeOrderStatus(db, id, "rejected", undefined, ctx("u-ceo"), undefined, { note: "불인정" }).db;
    for (const e of rej.costEntries) if (e.id === "ce-dc-1" || e.id === "ce-dc-2") e.status = "voided";
    const re = createChangeOrder(rej, { siteId: "site-a", title: "다시", amount: 1_000_000, reclaimOf: id }, ctx("u-manager"));
    expect(re.db.changeOrders.find((c) => c.id === re.result.id)?.sourceEntryIds).toEqual([]);
    const ok = made();
    ok.db.costEntries.find((e) => e.id === "ce-dc-2")!.forecastImpact = "within_forecast";
    const row = coBoard(ok.db, "2026-11-14").open.find((r) => r.co.id === ok.id)!;
    expect(row.linkedCost).toBe(18_000_000);
    expect(row.linked).toHaveLength(1);
  });

  it("기록 50개가 넘어도 등록·청구·승인 기록은 남는다", () => {
    let { db, id } = made();
    for (let i = 0; i < 55; i++) db = logChangeOrder(db, { coId: id, kind: "follow_up", date: "2026-11-14", note: `독촉 ${i}`, nextFollowUp: "2026-11-30" }, ctx("u-manager")).db;
    const log = db.changeOrders.find((c) => c.id === id)!.log!;
    expect(log).toHaveLength(50);
    expect(log.map((l) => l.kind)).toEqual(expect.arrayContaining(["created", "submitted"]));
  });

  it("청구 안 함 — 이유와 함께 목록·위험 신호에서 빠지고, 되돌리면 다시 · 그 원가로 청구하면 표시가 지워짐", async () => {
    const { declineClaim } = await import("@/lib/data/changeOrderCommands");
    const db = setup();
    expect(err(() => declineClaim(db, { entryIds: ["ce-dc-1"] }, ctx("u-manager"))).fieldErrors.note).toBeTruthy();
    const d = declineClaim(db, { entryIds: ["ce-dc-1", "ce-dc-2", "ce-sch"], note: "우리 책임 — 근거 없음" }, ctx("u-manager")).db;
    const b = coBoard(d, "2026-11-14");
    expect(b.unclaimed.map((e) => e.id)).not.toContain("ce-dc-1");
    expect(b.declined.map((e) => e.id)).toEqual(expect.arrayContaining(["ce-dc-1", "ce-sch"]));
    expect(computeSignals(d, NOW).some((s) => s.rule === "UNBILLED_CHANGE" && s.siteId === "site-a")).toBe(false);
    expect(err(() => declineClaim(d, { entryIds: ["ce-dc-1"], note: "또 정리" }, ctx("u-manager"))).code).toBe("STATE");
    const u = declineClaim(d, { entryIds: ["ce-dc-1"], undo: true }, ctx("u-manager")).db;
    expect(coBoard(u, "2026-11-14").unclaimed.map((e) => e.id)).toContain("ce-dc-1");
    const c = createChangeOrder(d, { siteId: "site-a", title: "그래도 청구", amount: 2_000_000, entryIds: ["ce-dc-2"] }, ctx("u-manager")).db;
    expect(c.costEntries.find((e) => e.id === "ce-dc-2")?.noClaim).toBeUndefined();
    expect(err(() => declineClaim(c, { entryIds: ["ce-dc-2"], note: "청구한 것" }, ctx("u-manager"))).code).toBe("STATE");
    expect(err(() => declineClaim(db, { entryIds: ["ce-pend"], note: "대기 원가" }, ctx("u-manager"))).code).toBe("VALIDATION");
  });

  it("본사가 넣은 보고는 그날 현장 보고로 세지 않는다 (아침 알림 ‘보고 없는 현장’)", async () => {
    const { missingReportSites } = await import("@/lib/domain/brief");
    const db = createSeed(NOW);
    const date = "2026-11-14";
    db.attendance = [...(db.attendance ?? []), { id: "att-d84", siteId: "site-a", userId: "u-field", workDate: date, inAt: "2026-11-13T23:00:00Z", inGeo: { status: "inside" } } as never];
    db.reports = db.reports.filter((r) => !(r.siteId === "site-a" && r.reportDate === date));
    db.reports.push({ id: "rpt-hq", siteId: "site-a", reportDate: date, workDone: "본사 입력", issues: "", tomorrowPlan: "", photoIds: [], costEntryIds: [], createdBy: "u-manager", createdAt: NOW.toISOString(), status: "submitted" });
    expect(missingReportSites(db, date).map((s) => s.siteId)).toContain("site-a");
    db.reports.push({ id: "rpt-field", siteId: "site-a", reportDate: date, workDone: "현장", issues: "", tomorrowPlan: "", photoIds: [], costEntryIds: [], createdBy: "u-field", createdAt: NOW.toISOString(), status: "submitted" });
    expect(missingReportSites(db, date).map((s) => s.siteId)).not.toContain("site-a");
  });

  it("이모지(ZWJ)는 이어 두고 글자 방향 바꾸기 문자는 지운다", async () => {
    const { tidyName } = await import("@/lib/data/commands");
    expect(tidyName("가족 👨‍👩‍👧 팀", 40)).toBe("가족 👨‍👩‍👧 팀");
    expect(tidyName("a\u202Eb", 40)).toBe("ab");
    expect(tidyName("\u200D\u200D", 40)).toBe("");
  });
});
