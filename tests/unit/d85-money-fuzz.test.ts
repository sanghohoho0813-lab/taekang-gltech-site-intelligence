/**
 * D-85 돈 숫자 무작위 운영 점검 — 실제 명령(원가 입력·공무 확인·고치기·취소·잔여예상 재추정·변경공사·기성·입금·계약 수정)을
 * 날마다 무작위로 돌리고, 하루가 끝날 때마다 ‘숫자 맞추기 점검’(integrity.ts)의 err 항목이 모두 통과하는지 본다.
 * 같은 seed면 같은 순서로 돈다 — 실패하면 seed·날짜·명령 기록으로 그대로 재현할 수 있다.
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { CommandError } from "@/lib/data/commands";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { coBoard } from "@/lib/domain/changeOrders";
import { siteFinancials } from "@/lib/domain/calc";
import { COST_CATEGORIES } from "@/lib/domain/labels";
import { todayIso } from "@/lib/domain/format";
import type { CostCategory, DemoDB } from "@/lib/domain/types";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Run = (name: string, args: unknown, userId: string) => void;

export function simulate(seed: number, days = 45, opts: { contractEdits?: boolean; eachOp?: boolean; imports?: boolean } = {}) {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const won = (lo: number, hi: number) => int(lo, hi) * 10_000;
  const start = new Date("2026-10-01T01:00:00Z");
  let db: DemoDB = createSeed(start);
  db.settings = { ...(db.settings ?? { laborDayRate: 300_000, costApproval: "immediate" }), costApproval: seed % 2 ? "review" : "immediate" } as DemoDB["settings"];
  const trail: string[] = [];
  const failures: { day: string; trail: string[]; errs: string[] }[] = [];
  let now = start;
  let k = 0;
  const run: Run = (name, args, userId) => {
    const fn = COMMANDS[name as keyof typeof COMMANDS] as unknown as (d: DemoDB, a: unknown, c: { userId: string; now: Date }) => { db: DemoDB };
    const before = db;
    try {
      db = fn(db, args, { userId, now }).db;
      trail.push(`${todayIso(now)} ${name} ${JSON.stringify(args).slice(0, 300)}`);
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      return;
    }
    if (opts.eachOp && !failures.length) {
      const errs = moneyIntegrity(db, todayIso(now)).filter((c) => c.level === "err");
      if (errs.length) failures.push({ day: todayIso(now), trail: trail.slice(-3), errs: errs.map((e) => `${e.title}: ${e.detail}`), before } as never);
    }
  };
  for (let d = 0; d < days; d++) {
    now = new Date(start.getTime() + d * 86_400_000 + int(0, 9) * 3_600_000);
    const today = todayIso(now);
    const sites = db.sites.filter((s) => s.status === "active");
    for (let n = int(1, 5); n > 0; n--) {
      const site = pick(sites);
      if (!site) break;
      const op = r();
      const dateBack = (max: number) => todayIso(new Date(now.getTime() - int(0, max) * 86_400_000));
      if (op < 0.3) {
        const field = r() < 0.5;
        const reason = pick(["design_change", "planned", "quantity_increase", "schedule", "rework"] as const)!;
        const cat = pick([...COST_CATEGORIES])! as CostCategory;
        run(
          "submitFieldReport",
          { idempotencyKey: `idem-fz-${seed}-${k++}`, siteId: site.id, reportDate: dateBack(3), workDone: "작업", kind: "cost", reason, source: field ? "FIELD" : "PC", costs: [{ category: cat, amount: won(10, 900), forecastImpact: reason === "planned" ? "within_forecast" : r() < 0.7 ? "additional" : "within_forecast", note: `무작위 ${k}` }] },
          field ? "u-field" : "u-manager",
        );
      } else if (op < 0.38) {
        const e = pick(db.costEntries.filter((x) => x.status === "pending"));
        if (e) run("reviewCostEntry", { entryId: e.id, decision: r() < 0.8 ? "approve" : "reject", ...(r() < 0.3 ? { amount: Math.max(10_000, Math.round(e.amount * (0.5 + r()) / 10_000) * 10_000) } : {}), note: "확인" }, "u-manager");
      } else if (op < 0.46) {
        const e = pick(db.costEntries.filter((x) => (x.status === "active" || x.status === "pending") && x.source !== "SEED" && !x.settle));
        if (e)
          run(
            "editCostEntry",
            { entryId: e.id, patch: { amount: Math.max(10_000, Math.round((e.amount * (0.3 + r() * 1.4)) / 10_000) * 10_000), category: r() < 0.2 ? pick([...COST_CATEGORIES])! : e.category, note: e.note || "고침", ...(r() < 0.3 ? { forecastImpact: pick(["additional", "within_forecast"] as const) } : {}), ...(r() < 0.2 ? { date: dateBack(20) } : {}) } },
            "u-manager",
          );
      } else if (op < 0.52) {
        const e = pick(db.costEntries.filter((x) => (x.status === "active" || x.status === "pending") && x.source !== "SEED"));
        if (e) run("voidCostEntry", { entryId: e.id, reason: "잘못 넣음" }, "u-manager");
      } else if (op < 0.58) {
        const f = siteFinancials(db, site.id);
        const remaining = Object.fromEntries(f.categories.map((c) => [c.category, Math.max(0, Math.round((c.remaining * (0.6 + r() * 0.8)) / 10_000) * 10_000)])) as Record<CostCategory, number>;
        run("updateForecast", { siteId: site.id, remaining, note: "재추정" }, "u-manager");
      } else if (op < 0.66) {
        const b = coBoard(db, today, site.id);
        const basis = b.unclaimed.slice(0, int(1, 2));
        run("createChangeOrder", { siteId: site.id, title: `변경 ${k++}`, amount: basis.length ? Math.round((basis.reduce((a, e) => a + e.amount, 0) * (0.9 + r() * 0.5)) / 10_000) * 10_000 : won(100, 2000), ...(basis.length && r() < 0.8 ? { entryIds: basis.map((e) => e.id) } : {}) }, "u-manager");
      } else if (op < 0.76) {
        const c = pick(db.changeOrders.filter((x) => x.siteId === site.id && (x.status === "review" || x.status === "submitted")));
        if (c) {
          const to = c.status === "review" && r() < 0.5 ? "submitted" : r() < 0.7 ? "approved" : "rejected";
          const amt = to === "approved" ? (r() < 0.5 ? Math.abs(c.amount) : Math.max(10_000, Math.round((Math.abs(c.amount) * (0.6 + r() * 0.4)) / 10_000) * 10_000)) : undefined;
          run(
            "setChangeOrderStatus",
            { coId: c.id, status: to, approvedAmount: amt, note: "사유", ...(to === "submitted" ? { followUp: todayIso(new Date(now.getTime() + 7 * 86_400_000)) } : {}), ...(to === "approved" && r() < 0.4 ? { addedCost: { category: "material", amount: won(10, 500) } } : {}), ...(to !== "submitted" && r() < 0.3 ? { date: dateBack(2) } : {}), ...(to === "approved" ? { basis: "letter" } : {}) },
            "u-ceo",
          );
        }
      } else if (op < 0.84) {
        run("addBilling", { siteId: site.id, amount: won(100, 4000), billedDate: dateBack(10), idempotencyKey: `idem-fz-b-${seed}-${k++}` }, "u-manager");
      } else if (op < 0.92) {
        const f = siteFinancials(db, site.id);
        if (f.outstanding > 0) run("addPayment", { siteId: site.id, amount: Math.max(10_000, Math.round((f.outstanding * (0.2 + r() * 0.8)) / 10_000) * 10_000), receivedDate: dateBack(10), idempotencyKey: `idem-fz-p-${seed}-${k++}` }, "u-manager");
      } else if (op < 0.96) {
        const e = pick(coBoard(db, today, site.id).otherExtra);
        if (e) run("declineClaim", { entryIds: [e.id], note: "우리 책임" }, "u-manager");
      } else if (opts.imports) {
        // 자료 가져오기(원가·기성·변경공사) · 가져오기 취소 · 현장 보고 되돌림
        const x = r();
        if (x < 0.4) {
          const kind = pick(["cost", "billing", "change"] as const)!;
          const text =
            kind === "cost"
              ? `현장,날짜,항목,금액,성격,사유,메모\n${site.shortName},${dateBack(40)},자재,${won(10, 900)},${r() < 0.5 ? "계획 내" : "추가"},${r() < 0.5 ? "계획" : "설계변경"},가져옴 ${k}`
              : kind === "billing"
                ? `현장,구분,날짜,금액,메모\n${site.shortName},${r() < 0.5 ? "기성" : "입금"},${dateBack(40)},${won(100, 2000)},가져옴 ${k}`
                : `현장,제목,금액,상태,요청일,승인금액,결정일,메모\n${site.shortName},가져온 변경 ${k},${won(100, 1500)},승인,${dateBack(40)},,${dateBack(5)},`;
          run("importData", { kind, text, idempotencyKey: `idem-fz-i-${seed}-${k++}` }, "u-manager");
        } else if (x < 0.7) {
          const b = pick((db.importBatches ?? []).filter((y) => !y.undoneAt));
          if (b) run("undoImport", { batchId: b.id }, "u-manager");
        } else {
          const rep = pick(db.reports.filter((y) => y.status !== "voided" && y.costEntryIds.length && !y.importBatchId && !y.id.startsWith("rpt-seed")));
          if (rep) run("voidReport", { reportId: rep.id }, "u-manager");
        }
      } else if (opts.contractEdits) {
        const c = db.contracts.find((x) => x.siteId === site.id)!;
        const budgets = Object.fromEntries(COST_CATEGORIES.map((cat) => [cat, Math.round(c.plannedCostTotal / COST_CATEGORIES.length)])) as Record<CostCategory, number>;
        run("saveSite", { id: site.id, name: site.name, shortName: site.shortName, workType: site.workType, region: site.region, clientName: site.clientName, status: site.status, startDate: site.startDate, endDate: site.endDate, managerUserId: site.managerUserId, fieldUserId: site.fieldUserId, contractAmount: c.contractAmount + won(-3000, 3000), signedDate: c.signedDate, budgets }, "u-ceo");
      }
    }
    if (failures.length) break;
    const errs = moneyIntegrity(db, today).filter((c) => c.level === "err");
    if (errs.length) {
      failures.push({ day: today, trail: trail.slice(-12), errs: errs.map((e) => `${e.title}: ${e.detail}`) });
      break;
    }
  }
  return { db, failures, ops: trail.length };
}

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
