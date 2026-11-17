/** D-83 대표 보고서 달별 보기 · 기성·입금 입력 시각·사람 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { addBilling } from "@/lib/data/commands";
import { addPayment } from "@/lib/data/moneyCommands";
import { importData } from "@/lib/data/importCommands";
import { closeMonth } from "@/lib/data/closeCommands";
import { changesAfterClose, currentClose } from "@/lib/domain/closeRecord";
import { monthClose, monthOptions, profitEvents } from "@/lib/domain/monthClose";
import { entryEacImpact, siteFinancials } from "@/lib/domain/calc";
import { updateForecast } from "@/lib/data/adminCommands";
import type { CostCategory } from "@/lib/domain/types";

const NOW = new Date("2026-11-14T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });

describe("D-83 기성·입금 입력 시각·사람", () => {
  it("기성·입금을 넣으면 넣은 시각·사람이 남는다 (가져오기도)", () => {
    const db = createSeed(NOW);
    const b = addBilling(db, { siteId: "site-a", amount: 1_000_000, billedDate: "2026-11-10" }, ctx("u-manager")).db;
    expect(b.billings.at(-1)).toMatchObject({ createdBy: "u-manager", createdAt: NOW.toISOString() });
    const p = addPayment(b, { siteId: "site-a", amount: 500_000, receivedDate: "2026-11-11" }, ctx("u-ceo")).db;
    expect(p.payments.at(-1)).toMatchObject({ createdBy: "u-ceo", createdAt: NOW.toISOString() });
    const siteName = p.sites.find((s) => s.id === "site-a")!.shortName;
    const imp = importData(p, { kind: "billing", text: `현장,구분,일자,금액,메모\n${siteName},기성,2026-09-30,2000000,이관`, idempotencyKey: "idem-d83-imp-0001" }, ctx("u-manager"));
    const added = imp.db.billings.find((x) => x.importBatchId && x.amount === 2_000_000)!;
    expect(added).toMatchObject({ createdBy: "u-manager", createdAt: NOW.toISOString() });
  });

  it("마감 뒤 들어온 기성은 ‘언제’가 보인다", () => {
    const db = createSeed(NOW);
    const items = monthClose(db, "2026-10", "2026-11-14").items.length;
    const c = closeMonth(db, { month: "2026-10", ackOpen: items || undefined, note: "이유 메모" }, ctx("u-manager")).db;
    const later = new Date("2026-11-14T05:00:00Z");
    const b = addBilling(c, { siteId: "site-a", amount: 1_000_000, billedDate: "2026-10-31" }, ctx("u-manager", later)).db;
    const e = changesAfterClose(b, currentClose(b, "2026-10")!, "2026-11-14").events.find((x) => x.text.startsWith("기성 들어옴"))!;
    expect(e.at).toBe(later.toISOString());
  });
});

describe("D-83 고를 수 있는 달", () => {
  it("이번 달부터 가장 이른 착공 달까지 (최대 24개월) · 현장이 없으면 이번 달만", () => {
    const db = createSeed(NOW);
    const ms = monthOptions(db, "2026-11-14");
    expect(ms[0]).toBe("2026-11");
    expect(ms).toContain("2026-10");
    expect(ms.length).toBeLessThanOrEqual(24);
    expect(monthOptions({ sites: [] }, "2026-11-14")).toEqual(["2026-11"]);
  });
});

describe("D-83 점검 고침", () => {
  const sum = (db: ReturnType<typeof createSeed>, site: string, from: string, to: string) => profitEvents(db, site, from, to).reduce((a, e) => a + e.amount, 0);

  it("재추정해도 그 전에 잔여예상을 넘은 집행은 ‘이익을 바꾼 일’에 남고, 더하면 이익 변화와 맞는다 (M1)", () => {
    const db = createSeed(NOW);
    const site = "site-a";
    const fc = db.forecasts.find((f) => f.siteId === site && f.category === "material")!;
    fc.remaining = 1_000_000;
    fc.basisAt = "2026-11-13T22:00:00Z";
    const p0 = siteFinancials(db, site).expectedProfit;
    const s0 = sum(db, site, "2026-11-01", "2026-11-30");
    db.costEntries.push({ id: "ce-d83-over", siteId: site, category: "material", amount: 3_000_000, date: "2026-11-13", forecastImpact: "within_forecast", reason: "planned", note: "철물 추가 반입", source: "PC", createdBy: "u-manager", createdAt: "2026-11-13T23:00:00Z", status: "active" });
    const over = entryEacImpact(db, db.costEntries.at(-1)!);
    expect(over).toBe(2_000_000);
    const p1 = siteFinancials(db, site).expectedProfit;
    expect(p0 - p1).toBe(over);

    const remaining = Object.fromEntries(db.forecasts.filter((f) => f.siteId === site).map((f) => [f.category, f.category === "material" ? 4_000_000 : f.remaining])) as Record<CostCategory, number>;
    const after = updateForecast(db, { siteId: site, remaining, note: "자재 단가 반영" }, ctx("u-manager", new Date("2026-11-14T02:00:00Z"))).db;
    const e = after.costEntries.find((x) => x.id === "ce-d83-over")!;
    expect(e.frozenOver).toBe(over);
    expect(entryEacImpact(after, e)).toBe(0);
    const ev = profitEvents(after, site, "2026-11-01", "2026-11-30").find((x) => x.text.includes("철물 추가 반입"))!;
    expect(ev.amount).toBe(-over);
    const p2 = siteFinancials(after, site).expectedProfit;
    expect(sum(after, site, "2026-11-01", "2026-11-30") - s0).toBe(p2 - p0);

    // 두 번째 재추정 — 두 번 세지 않는다
    const again = updateForecast(after, { siteId: site, remaining, note: "다시" }, ctx("u-manager", new Date("2026-11-14T02:30:00Z"))).db;
    expect(again.costEntries.find((x) => x.id === "ce-d83-over")!.frozenOver).toBe(over);
  });

  it("기성 회차는 기성일 순서로 다시 매긴다 — 늦게 넣은 지난 날짜 기성이 마지막 회차가 되지 않게", () => {
    const db = createSeed(NOW);
    const site = "site-a";
    const a = addBilling(db, { siteId: site, amount: 1_000_000, billedDate: "2026-11-12" }, ctx("u-manager")).db;
    const b = addBilling(a, { siteId: site, amount: 2_000_000, billedDate: "2026-11-02" }, ctx("u-manager")).db;
    const mine = b.billings.filter((x) => x.siteId === site).sort((x, y) => x.round - y.round);
    expect(mine.map((x) => x.round)).toEqual(mine.map((_, i) => i + 1));
    for (let i = 1; i < mine.length; i++) expect(mine[i].billedDate >= mine[i - 1].billedDate).toBe(true);
  });

  it("마감 때 기록에 이달 예상이익 변화가 남고, 그 뒤 바뀌면 ‘바뀐 것’에 나온다 · 옛 기록(없음)은 건너뛴다", () => {
    const db = createSeed(NOW);
    const items = monthClose(db, "2026-10", "2026-11-14").items.length;
    const c = closeMonth(db, { month: "2026-10", ackOpen: items || undefined, note: "이유 메모" }, ctx("u-manager")).db;
    const rec = currentClose(c, "2026-10")!;
    expect(rec.snapshot.sites.every((s) => typeof s.profitNet === "number")).toBe(true);
    const site = rec.snapshot.sites[0].siteId;
    c.costEntries.push({ id: "ce-d83-late", siteId: site, category: "material", amount: 5_000_000, date: "2026-10-30", forecastImpact: "additional", reason: "design_change", note: "늦게 온 추가 자재", source: "PC", createdBy: "u-manager", createdAt: "2026-10-31T05:00:00Z", status: "active" });
    const ch = changesAfterClose(c, rec, "2026-11-14");
    expect(ch.diffs.some((d) => d.label === "이달 예상이익 변화")).toBe(true);
    // 옛 기록 — profitNet이 없으면 비교하지 않는다
    const old = structuredClone(rec);
    old.snapshot.sites.forEach((s) => delete s.profitNet);
    expect(changesAfterClose(c, old, "2026-11-14").diffs.some((d) => d.label === "이달 예상이익 변화")).toBe(false);
  });

  it("달이 끝난 뒤에 넣은 그 달 날짜 기성·입금을 따로 센다 (가져온 지난 자료는 빼고)", () => {
    const db = createSeed(NOW);
    const base = monthClose(db, "2026-10", "2026-11-14").lateMoney;
    const late = new Date("2026-11-03T01:00:00Z");
    const a = addBilling(db, { siteId: "site-a", amount: 1_200_000, billedDate: "2026-10-31" }, ctx("u-manager", late)).db;
    const b = addPayment(a, { siteId: "site-a", amount: 700_000, receivedDate: "2026-10-30" }, ctx("u-manager", late)).db;
    const r = monthClose(b, "2026-10", "2026-11-14").lateMoney;
    expect(r.n - base.n).toBe(2);
    expect(r.billed - base.billed).toBe(1_200_000);
    expect(r.received - base.received).toBe(700_000);
    // 그 달 안에 넣은 것은 늦은 것이 아니다
    const inMonth = addBilling(db, { siteId: "site-a", amount: 900_000, billedDate: "2026-10-20" }, ctx("u-manager", new Date("2026-10-21T01:00:00Z"))).db;
    expect(monthClose(inMonth, "2026-10", "2026-11-14").lateMoney.billed).toBe(base.billed);
  });
});
