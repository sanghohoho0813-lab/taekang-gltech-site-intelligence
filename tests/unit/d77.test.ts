/** D-77 운영 첫날 리허설 — 금액 ‘18억’, 등록 직후 금액 고치기(손익 기준 다시 잡기), 공정률은 현장 담당만, 임시 비밀번호 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { saveSite } from "@/lib/data/adminCommands";
import { submitFieldReport } from "@/lib/data/commands";
import { parseKoreanWon } from "@/lib/domain/format";
import { siteFinancials } from "@/lib/domain/calc";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-13T03:00:00Z");
const ctx = (userId: string) => ({ userId, now: NOW });

describe("금액 칸 — 억·만 단위", () => {
  it("‘18억’ · ‘1억 8천만’ · ‘1.8억’ · ‘18억5000만’ · 쉼표 · 원을 원 단위로", () => {
    expect(parseKoreanWon("18억")).toBe(1_800_000_000);
    expect(parseKoreanWon("1억 8천만")).toBe(180_000_000);
    expect(parseKoreanWon("1.8억")).toBe(180_000_000);
    expect(parseKoreanWon("18억5000만")).toBe(1_850_000_000);
    expect(parseKoreanWon("3,500만 원")).toBe(35_000_000);
    expect(parseKoreanWon("1,800,000,000")).toBe(1_800_000_000);
    expect(parseKoreanWon("₩162,000,000")).toBe(162_000_000);
  });
  it("읽을 수 없는 글은 NaN (18원으로 저장하지 않게)", () => {
    expect(parseKoreanWon("18억원정")).toBeNaN();
    expect(parseKoreanWon("abc")).toBeNaN();
    expect(parseKoreanWon("18.5")).toBeNaN();
    expect(parseKoreanWon("")).toBeNaN();
  });
});

const BUDGETS = { material: 900_000_000, labor: 400_000_000, subcontract: 150_000_000, equipment: 50_000_000, overhead: 50_000_000 };
const newSite = (db: DemoDB, contractAmount: number) =>
  saveSite(db, { name: "이천 물류센터 커튼월", shortName: "이천", workType: "커튼월", region: "경기 이천", clientName: "가상 발주처", status: "active", startDate: "2026-11-01", endDate: "2027-04-30", contractAmount, budgets: BUDGETS as never, idempotencyKey: "idem-0123456789abcdef-s1" } as never, ctx("u-ceo"));

describe("등록 직후 계약금액을 바로잡으면 손익 기준도 새 값으로", () => {
  it("현장 입력 전: 18원 → 18억으로 고치면 기준 이익도 새 값 (‘기준 대비 ▲17억’이 남지 않음) · 이력에 남김", () => {
    const made = newSite(createSeed(NOW), 18);
    const id = made.result.siteId;
    const fixed = saveSite(made.db, { ...(made.db.sites.find((s) => s.id === id) as never), id, contractAmount: 1_800_000_000, budgets: BUDGETS as never } as never, ctx("u-ceo")).db;
    const f = siteFinancials(fixed, id);
    expect(fixed.baseline[id]).toEqual(expect.objectContaining({ expectedProfit: f.expectedProfit }));
    expect(fixed.activityLogs.find((l) => l.siteId === id)!.summary).toContain("손익 기준을 새 값으로 다시 잡음");
  });
  it("현장 입력이 생긴 뒤에는 기준을 그대로 둔다 (그 뒤의 변화가 기준 대비로 보여야 하므로)", () => {
    const made = newSite(createSeed(NOW), 1_800_000_000);
    const id = made.result.siteId;
    let db = made.db;
    db = { ...db, costEntries: [...db.costEntries, { id: "ce-x", siteId: id, category: "material", amount: 1_000_000, source: "FIELD" } as never] };
    const before = db.baseline[id];
    const after = saveSite(db, { ...(db.sites.find((s) => s.id === id) as never), id, contractAmount: 1_900_000_000, budgets: BUDGETS as never } as never, ctx("u-ceo")).db;
    expect(after.baseline[id]).toEqual(before);
  });
});

describe("공정률은 그 현장 담당과 본사만", () => {
  it("담당이 아닌 현장 직원의 보고는 받되 공정률은 바꾸지 않는다", () => {
    const db = createSeed(NOW);
    const site = db.sites[0];
    const other = db.users.find((u) => u.role === "field" && u.id !== site.fieldUserId)!;
    const st = site.stages.find((x) => x.progressPct < 90)!;
    const out = submitFieldReport({ ...db, users: db.users.map((u) => (u.id === other.id ? { ...u, siteIds: [site.id] } : u)) }, { idempotencyKey: "idem-0123456789abcdef-r1", siteId: site.id, workDone: "유리 시공", issues: "", costs: [], source: "FIELD", reportDate: "2026-11-13", stageProgress: [{ stageId: st.id, progressPct: st.progressPct + 10 }], progressPct: Math.min(100, site.progressPct + 10) } as never, ctx(other.id));
    const after = out.db.sites.find((s) => s.id === site.id)!;
    expect(after.progressPct).toBe(site.progressPct);
    expect(after.stages.find((x) => x.id === st.id)!.progressPct).toBe(st.progressPct);
    expect(out.db.reports.length).toBe(db.reports.length + 1);
    // 담당(현장소장)이면 바뀐다
    const own = submitFieldReport(db, { idempotencyKey: "idem-0123456789abcdef-r2", siteId: site.id, workDone: "유리 시공", issues: "", costs: [], source: "FIELD", reportDate: "2026-11-13", stageProgress: [{ stageId: st.id, progressPct: st.progressPct + 10 }] } as never, ctx(site.fieldUserId));
    expect(own.db.sites.find((s) => s.id === site.id)!.stages.find((x) => x.id === st.id)!.progressPct).toBe(st.progressPct + 10);
  });
});
