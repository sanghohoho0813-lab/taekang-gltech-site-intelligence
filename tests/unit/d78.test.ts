/** D-78 첫 달 운영 리허설 — 월 마감 · 공정률 단계 추종 · 변경공사 예상 원가 · 본사 전화 · 숫자 맞추기 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { saveSite, updateProgress } from "@/lib/data/adminCommands";
import { setChangeOrderStatus, submitFieldReport } from "@/lib/data/commands";
import { monthClose, monthBounds, previousMonth } from "@/lib/domain/monthClose";
import { siteFinancials } from "@/lib/domain/calc";
import { stagesWeightedPct } from "@/lib/domain/schedule";
import { helpPhoneOf } from "@/lib/domain/companyPhone";
import { dayFlags, siteCrew } from "@/lib/domain/attendance";
import { pendingItems } from "@/lib/domain/pending";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-13T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });
const B = { material: 60_000_000, labor: 30_000_000, subcontract: 5_000_000, equipment: 3_000_000, overhead: 2_000_000 };

function newSite(db: DemoDB) {
  const r = saveSite(db, { name: "새 현장", shortName: "새현장", workType: "창호", region: "", clientName: "원청", status: "active", startDate: "2026-10-01", endDate: "2026-12-31", fieldUserId: "u-field", contractAmount: 120_000_000, budgets: B, stages: [{ name: "제작", startDate: "2026-10-01", endDate: "2026-10-31" }, { name: "설치", startDate: "2026-11-01", endDate: "2026-12-31" }] } as never, ctx("u-manager", new Date("2026-10-01T00:00:00Z")));
  return { db: r.db, id: (r.result as { siteId: string }).siteId };
}

describe("D-78 공정률은 단계 기간 가중값을 따른다", () => {
  it("보고마다 반올림이 쌓여 부풀지 않는다 — 30번 보고 뒤에도 단계 가중값과 같다", () => {
    let { db, id } = newSite(createSeed(NOW));
    const stage = () => db.sites.find((s) => s.id === id)!.stages[0];
    for (let i = 0; i < 30; i++) {
      const at = new Date(Date.UTC(2026, 9, 2 + i, 8));
      db = submitFieldReport(db, { idempotencyKey: `idem-d78-progress-${String(i).padStart(4, "0")}`, siteId: id, reportDate: at.toISOString().slice(0, 10), workDone: "제작", stageProgress: [{ stageId: stage().id, progressPct: Math.min(100, stage().progressPct + 3) }] } as never, ctx("u-field", at)).db;
    }
    const s = db.sites.find((x) => x.id === id)!;
    expect(s.progressPct).toBe(stagesWeightedPct(s.stages));
  });
  it("본사가 전체를 따로 정하면 표시되고, 그 뒤 보고는 변화량만 더한다", () => {
    const { db, id } = newSite(createSeed(NOW));
    const st = db.sites.find((s) => s.id === id)!.stages[0];
    const set = updateProgress(db, { siteId: id, progressPct: 40 }, ctx("u-manager")).db;
    expect(set.sites.find((s) => s.id === id)!.progressManual).toBe(true);
    const after = submitFieldReport(set, { idempotencyKey: "idem-d78-manual-000001", siteId: id, reportDate: "2026-11-13", workDone: "제작", stageProgress: [{ stageId: st.id, progressPct: 10 }] } as never, ctx("u-field")).db;
    const s = after.sites.find((x) => x.id === id)!;
    expect(s.progressPct).toBeGreaterThanOrEqual(40);
    expect(s.progressPct).toBeLessThan(45);
    // 단계 계산과 같게 다시 맞추면 표시가 풀린다
    const back = updateProgress(after, { siteId: id, progressPct: stagesWeightedPct(s.stages)! }, ctx("u-manager")).db;
    expect(back.sites.find((x) => x.id === id)!.progressManual).toBeUndefined();
  });
  it("시연 현장은 본사가 정한 값으로 표시되어 첫 보고에 공정률이 내려가지 않는다", () => {
    const db = createSeed(NOW);
    for (const s of db.sites) if (stagesWeightedPct(s.stages) !== s.progressPct) expect(s.progressManual).toBe(true);
  });
});

describe("D-78 변경공사 승인 — 예상 원가와 승인 금액", () => {
  it("예상 원가를 넣으면 잔여예상원가에 더해 이익이 승인액 전부로 잡히지 않는다 · 승인 전 문구는 지운다", () => {
    const db0 = createSeed(NOW);
    const co = { id: "co-d78", siteId: "site-a", title: "로비 자동문", amount: 14_500_000, status: "submitted" as const, requestedAt: "2026-10-16T00:00:00Z", sourceEntryIds: [], note: "발주처 요청에서 등록된 변경공사 검토 건 — 승인 전 계약·이익 미반영" };
    const db = { ...db0, changeOrders: [...db0.changeOrders, co] } as DemoDB;
    const before = siteFinancials(db, "site-a");
    const r = setChangeOrderStatus(db, "co-d78", "approved", 13_800_000, ctx("u-ceo"), { category: "subcontract", amount: 9_000_000 });
    const after = siteFinancials(r.db, "site-a");
    expect(after.adjustedContract - before.adjustedContract).toBe(13_800_000);
    expect(after.eac - before.eac).toBe(9_000_000);
    expect(after.expectedProfit - before.expectedProfit).toBe(4_800_000);
    const saved = r.db.changeOrders.find((c) => c.id === "co-d78")!;
    expect(saved.addedCost).toEqual({ category: "subcontract", amount: 9_000_000 });
    expect(saved.note).not.toContain("미반영");
    expect(() => setChangeOrderStatus(db, "co-d78", "rejected", undefined, ctx("u-ceo"), { category: "subcontract", amount: 1 })).toThrow();
  });
});

describe("D-78 월 마감", () => {
  it("이달 기성·입금·미수·원가는 그 달 날짜만 · 합계는 현장 합", () => {
    const db = createSeed(NOW);
    const month = previousMonth("2026-11-13");
    const b = monthBounds(month);
    expect(b).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    const r = monthClose(db, month, "2026-11-13");
    expect(r.ended).toBe(true);
    for (const m of r.money) {
      const billed = db.billings.filter((x) => x.siteId === m.site.id && x.status === "confirmed" && x.billedDate >= b.from && x.billedDate <= b.to).reduce((a, x) => a + x.amount, 0);
      expect(m.billed).toBe(billed);
      const cost = db.costEntries.filter((e) => e.siteId === m.site.id && e.status === "active" && e.date >= b.from && e.date <= b.to).reduce((a, e) => a + e.amount, 0);
      expect(m.costTotal).toBe(cost);
    }
    expect(r.totals.billed).toBe(r.money.reduce((a, m) => a + m.billed, 0));
    // 이번 달이면 오늘까지만
    const cur = monthClose(db, "2026-11", "2026-11-13");
    expect(cur.ended).toBe(false);
    expect(cur.to).toBe("2026-11-13");
  });
  it("이익 변화 이유: 추가 원가(−)와 승인 변경공사(+)·그 예상 원가(−)를 더하면 이달 변화", () => {
    const db0 = createSeed(NOW);
    const co = { id: "co-d78b", siteId: "site-a", title: "추가창", amount: 10_000_000, status: "submitted" as const, requestedAt: "2026-10-05T00:00:00Z", sourceEntryIds: [], note: "" };
    let db = { ...db0, changeOrders: [...db0.changeOrders, co] } as DemoDB;
    db = setChangeOrderStatus(db, "co-d78b", "approved", 10_000_000, ctx("u-ceo", new Date("2026-10-20T03:00:00Z")), { category: "material", amount: 6_000_000 }).db;
    const p = monthClose(db, "2026-10", "2026-11-13").profit.find((x) => x.site.id === "site-a")!;
    expect(p.events.some((e) => e.amount === 10_000_000)).toBe(true);
    expect(p.events.some((e) => e.amount === -6_000_000)).toBe(true);
    expect(p.net).toBe(p.events.reduce((a, e) => a + e.amount, 0));
  });
  it("퇴근 누락·같은 날 두 현장 시간 겹침은 날짜와 함께 · 닫기 전에 볼 것에 들어간다", () => {
    const db = createSeed(NOW);
    const base = { userId: "u-field", inGeo: { status: "inside" as const } };
    db.attendance = [
      { ...base, id: "x1", siteId: "site-a", workDate: "2026-10-16", inAt: "2026-10-15T22:40:00Z" },
      { ...base, id: "x2", siteId: "site-a", workDate: "2026-10-21", inAt: "2026-10-20T22:50:00Z", outAt: "2026-10-21T08:40:00Z" },
      { ...base, id: "x3", siteId: "site-b", workDate: "2026-10-21", inAt: "2026-10-21T04:00:00Z", outAt: "2026-10-21T08:00:00Z" },
    ] as never;
    const r = monthClose(db, "2026-10", "2026-11-13");
    const p = r.people.find((x) => x.row.userId === "u-field")!;
    expect(p.missedOut).toEqual(["2026-10-16"]);
    expect(p.overlap).toEqual(["2026-10-21"]);
    expect(r.items.some((i) => i.kind === "checkout" && i.href === "/attendance?date=2026-10-16")).toBe(true);
    expect(r.items.some((i) => i.kind === "overlap")).toBe(true);
    // 지난 날짜를 열면 그날 퇴근 누락 표시가 나온다 (예전에는 오늘만)
    expect(dayFlags(db, "2026-10-16", NOW).some((f) => f.kind === "no_checkout")).toBe(true);
  });
  it("이달 준공한 현장에 잔여 예상원가가 남아 있으면 ‘준공 원가’로 알린다", () => {
    const db = createSeed(NOW);
    const s = db.sites.find((x) => x.id === "site-c")!;
    s.status = "completed";
    s.endDate = "2026-10-30";
    s.warranty = { months: 24, completedDate: "2026-10-30", setAt: "", setBy: "" } as never;
    const r = monthClose(db, "2026-10", "2026-11-13");
    expect(r.completedSites.map((x) => x.id)).toContain("site-c");
    if (siteFinancials(db, "site-c").remaining > 0) expect(r.items.some((i) => i.kind === "settle" && i.text.includes(s.shortName))).toBe(true);
  });
});

describe("D-78 그 밖의 숫자 맞추기", () => {
  it("본사 전화: 현장 문의 번호가 없으면 첫 설정의 대표 번호", () => {
    expect(helpPhoneOf({ publicPhone: "031-555-0142" })).toBe("031-555-0142");
    expect(helpPhoneOf({ helpPhone: "010-1111-2222", publicPhone: "031-555-0142" })).toBe("010-1111-2222");
    expect(helpPhoneOf(undefined)).toBeUndefined();
  });
  it("발주처가 확인 완료한 하자의 작업지시가 완료 보고 상태면 ‘완료 확인할 작업지시’에 센다", () => {
    const db = createSeed(NOW);
    const req = db.partnerRequests.find((r) => r.type === "defect") ?? db.partnerRequests[0];
    req.confirmedAt = "2026-10-27T01:00:00Z";
    db.workOrders = [...(db.workOrders ?? []), { id: "wo-d78", siteId: req.siteId, title: "결로 보수", assigneeUserId: "u-field", status: "done", createdAt: "2026-10-23T00:00:00Z", createdBy: "u-manager", history: [], sourcePartnerRequestId: req.id } as never];
    const n = pendingItems(db, "2026-11-13", true).find((p) => p.key === "wo-done")!.n;
    req.confirmedAt = undefined;
    const m = pendingItems(db, "2026-11-13", true).find((p) => p.key === "wo-done")!.n;
    expect(n).toBe(m + 1);
  });
  it("준공 현장 배정은 세지 않는다 — 진행 중 현장 하나만 남으면 그 현장 미출근 확인 대상", () => {
    const db = createSeed(NOW);
    const done = db.sites.find((x) => x.id === "site-c")!;
    done.status = "completed";
    const u = db.users.find((x) => x.id === "u-field2")!;
    u.siteIds = ["site-b", "site-c"];
    const b = db.sites.find((x) => x.id === "site-b")!;
    expect(siteCrew(db, b, "2026-11-13")).toContain("u-field2");
  });
});
