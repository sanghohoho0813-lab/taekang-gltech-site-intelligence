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
  // 시연 변경공사의 다음 확인할 날은 빼고 센다
  for (const c of db.changeOrders) delete c.nextFollowUp;
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
    const cleared = logChangeOrder(l, { coId: id, kind: "note", date: "2026-11-20", note: "확인 날 지움", nextFollowUp: null }, ctx("u-manager", later)).db;
    expect(cleared.changeOrders.find((c) => c.id === id)?.nextFollowUp).toBeUndefined();
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
    expect(b.totals).toMatchObject({ decidedCost: 20_000_000, recovered: 21_000_000, recoveryPct: 105 });
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
