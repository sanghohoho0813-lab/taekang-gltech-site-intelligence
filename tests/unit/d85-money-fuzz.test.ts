/**
 * D-85 돈 숫자 무작위 운영 점검 — 실제 명령(원가 입력·공무 확인·고치기·취소·잔여예상 재추정·변경공사·기성·입금·계약 수정)을
 * 날마다 무작위로 돌리고, 하루가 끝날 때마다 ‘숫자 맞추기 점검’(integrity.ts)의 err 항목이 모두 통과하는지 본다.
 * 같은 seed면 같은 순서로 돈다 — 실패하면 seed·날짜·명령 기록으로 그대로 재현할 수 있다. (시뮬레이션: moneySim.ts)
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { siteFinancials } from "@/lib/domain/calc";
import { COST_CATEGORIES } from "@/lib/domain/labels";
import type { CostCategory } from "@/lib/domain/types";
import { simulate } from "./moneySim";

describe("D-85 돈 숫자 — 무작위 운영 45일", () => {
  it("시드 상태에서 점검 err 0", () => {
    const db = createSeed(new Date("2026-11-14T03:00:00Z"));
    expect(moneyIntegrity(db, "2026-11-14").filter((c) => c.level === "err")).toEqual([]);
  });

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: 날마다 월 마감 합 = 누계 · 이익을 바꾼 일 합 = 이익 변화 · 대시보드 = 현장 합 · 이중 청구 없음`, () => {
      const res = simulate(seed);
      expect(res.ops).toBeGreaterThan(40);
      expect(res.failures, JSON.stringify(res.failures[0], null, 1)).toEqual([]);
    }, 60_000);
  }

  it("자료 가져오기·가져오기 취소·보고 되돌림을 섞어도 맞는다", () => {
    for (const seed of [21, 22, 23, 24]) {
      const res = simulate(seed, 45, { imports: true });
      expect(res.failures, JSON.stringify(res.failures[0], null, 1)).toEqual([]);
    }
  }, 180_000);

  it("D-87 노무 정산·월 마감·대표 확인·다시 열기를 섞어도 맞고(월 마감 엑셀 합 포함), 마감·확인 바로 뒤 ‘바뀐 것’은 0", () => {
    let closes = 0;
    let settles = 0;
    for (const seed of [31, 32, 33, 34, 35, 36]) {
      const res = simulate(seed, 45, { close: true });
      expect(res.failures, JSON.stringify(res.failures[0], null, 1)).toEqual([]);
      closes += (res.db.monthCloses ?? []).length;
      settles += res.db.costEntries.filter((e) => e.settle).length;
    }
    // 실제로 돌았는지 (명령이 모두 거부되면 시험이 아무것도 안 본 것)
    expect(closes).toBeGreaterThan(3);
    expect(settles).toBeGreaterThan(3);
  }, 240_000);

  it("D-89 발주처가 뗀 금액(유보금·공제)·유보금 받음·기성·입금 취소를 월 마감과 섞어도 모든 점검이 맞고, 마감 바로 뒤 ‘바뀐 것’은 0", () => {
    let withheld = 0;
    let voids = 0;
    let releases = 0;
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const res = simulate(seed, 45, { receivables: true, close: true });
      expect(res.failures, JSON.stringify(res.failures[0], null, 1)).toEqual([]);
      withheld += (res.db.receivableAdjustments ?? []).length;
      voids += (res.db.voidedMoney ?? []).length;
      releases += res.db.payments.filter((p) => p.retentionId).length;
    }
    // 실제로 돌았는지
    expect(withheld).toBeGreaterThan(5);
    expect(voids).toBeGreaterThan(5);
    expect(releases).toBeGreaterThan(1);
  }, 300_000);

  it("계약금액을 고쳐도 이익을 바꾼 일 합이 맞는다", () => {
    for (const seed of [11, 12, 13]) {
      const res = simulate(seed, 45, { contractEdits: true });
      expect(res.failures, JSON.stringify(res.failures[0], null, 1)).toEqual([]);
    }
  }, 120_000);
});

describe("D-85 고친 것", () => {
  it("착공 전 발생일 원가(자재 선발주)도 그 달 월 마감에 잡혀 월 합 = 누계", () => {
    const db = createSeed(new Date("2026-11-14T03:00:00Z"));
    const site = db.sites.find((s) => s.id === "site-a")!;
    const before = new Date(`${site.startDate}T00:00:00Z`);
    before.setUTCMonth(before.getUTCMonth() - 1);
    const d = before.toISOString().slice(0, 10);
    db.costEntries.push({ id: "ce-pre", siteId: "site-a", category: "material", amount: 7_000_000, date: d, forecastImpact: "within_forecast", reason: "planned", note: "유리 선발주", source: "PC", createdBy: "u-manager", createdAt: "2026-11-01T01:00:00Z", status: "active" } as never);
    const checks = moneyIntegrity(db, "2026-11-14");
    expect(checks.find((c) => c.key === "month-sum")?.level).toBe("ok");
    expect(checks.find((c) => c.key === "dates")?.level).toBe("warn");
  });

  it("재추정 뒤 그 전 원가를 고치거나 취소하면 그 차이가 ‘이익을 바꾼 일’로 남는다", () => {
    const now = new Date("2026-11-10T03:00:00Z");
    let db = createSeed(now);
    const ctx = (d: number) => ({ userId: "u-manager", now: new Date(now.getTime() + d * 86_400_000) });
    db = COMMANDS.submitFieldReport(db, { idempotencyKey: "idem-d85-a-0001", siteId: "site-a", reportDate: "2026-11-10", workDone: "x", kind: "cost", reason: "planned", source: "PC", costs: [{ category: "material", amount: 5_000_000, forecastImpact: "within_forecast", note: "유리" }] } as never, ctx(0)).db;
    const id = db.costEntries.find((e) => e.note === "유리")!.id;
    const f = siteFinancials(db, "site-a");
    const remaining = Object.fromEntries(f.categories.map((c) => [c.category, c.remaining])) as Record<CostCategory, number>;
    db = COMMANDS.updateForecast(db, { siteId: "site-a", remaining, note: "재추정" }, ctx(1)).db;
    const p0 = siteFinancials(db, "site-a").expectedProfit;
    db = COMMANDS.voidCostEntry(db, { entryId: id, reason: "중복 입력" }, ctx(2)).db;
    const adj = (db.profitAdjustments ?? []).at(-1)!;
    expect(adj).toMatchObject({ siteId: "site-a", amount: siteFinancials(db, "site-a").expectedProfit - p0, entryId: id });
    expect(adj.text).toContain("원가 취소");
    expect(moneyIntegrity(db, "2026-11-12").filter((c) => c.level === "err")).toEqual([]);
  });

  it("원 계약금액을 고치면 ‘원 계약 변경’이 이익을 바꾼 일로 남는다 (현장 입력이 있은 뒤)", () => {
    const now = new Date("2026-11-10T03:00:00Z");
    let db = createSeed(now);
    const site = db.sites.find((s) => s.id === "site-a")!;
    const c = db.contracts.find((x) => x.siteId === "site-a")!;
    const budgets = Object.fromEntries(COST_CATEGORIES.map((cat) => [cat, db.budgets.find((b) => b.siteId === "site-a" && b.category === cat)?.amount ?? 0])) as Record<CostCategory, number>;
    db = COMMANDS.saveSite(db, { id: site.id, name: site.name, shortName: site.shortName, workType: site.workType, region: site.region, clientName: site.clientName, status: site.status, startDate: site.startDate, endDate: site.endDate, managerUserId: site.managerUserId, fieldUserId: site.fieldUserId, contractAmount: c.contractAmount + 20_000_000, signedDate: c.signedDate, budgets }, { userId: "u-ceo", now }).db;
    const adj = (db.profitAdjustments ?? []).at(-1);
    expect(adj?.amount).toBe(20_000_000);
    expect(adj?.text).toContain("원 계약 변경");
  });

  it("예상이익 조정 기록은 서버에 저장되고 현장·발주처에는 내려가지 않는다", async () => {
    const { COLLECTIONS } = await import("@/server/state");
    const { viewFor } = await import("@/server/authz");
    expect(Object.keys(COLLECTIONS)).toContain("profitAdjustments");
    const db = createSeed(new Date("2026-11-10T03:00:00Z"));
    db.profitAdjustments = [{ id: "pa-1", siteId: "site-a", at: "2026-11-10T03:00:00Z", by: "u-manager", amount: 1_000_000, text: "원가 고침" }];
    const m = (role: "field" | "partner") => ({ id: `u-${role}`, companyId: "c1", email: "x@t.test", name: "x", title: "", role, siteIds: ["site-a"], partnerSiteIds: ["site-a"], active: true, mustChangePassword: false });
    expect(viewFor(m("field"), db).profitAdjustments).toEqual([]);
    expect(viewFor(m("partner"), db).profitAdjustments).toEqual([]);
  });
});
