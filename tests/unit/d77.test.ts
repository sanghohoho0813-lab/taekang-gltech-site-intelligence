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
    const fixed = saveSite(made.db, { ...(made.db.sites.find((s) => s.id === id) as object), id, contractAmount: 1_800_000_000, budgets: BUDGETS as never } as never, ctx("u-ceo")).db;
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
    const after = saveSite(db, { ...(db.sites.find((s) => s.id === id) as object), id, contractAmount: 1_900_000_000, budgets: BUDGETS as never } as never, ctx("u-ceo")).db;
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

describe("단계 진행률 → 전체 공정률", () => {
  it("단계를 넣어 등록하면 전체 공정률도 단계 기간 가중 (0%로 남지 않음)", () => {
    const made = saveSite(createSeed(NOW), {
      name: "이천 물류센터 커튼월", shortName: "이천", workType: "커튼월", region: "경기 이천", clientName: "가상 발주처", status: "active", startDate: "2026-09-01", endDate: "2027-04-30", contractAmount: 1_800_000_000, budgets: BUDGETS as never, idempotencyKey: "idem-0123456789abcdef-s2",
      stages: [
        { name: "자재 발주", startDate: "2026-09-01", endDate: "2026-09-30", progressPct: 100 },
        { name: "하지 작업", startDate: "2026-10-01", endDate: "2026-10-31", progressPct: 60 },
        { name: "유리 시공", startDate: "2026-11-01", endDate: "2027-02-28", progressPct: 0 },
        { name: "실리콘·마감", startDate: "2027-03-01", endDate: "2027-04-30", progressPct: 0 },
      ],
    } as never, ctx("u-ceo"));
    const site = made.db.sites.find((s) => s.id === made.result.siteId)!;
    expect(site.progressPct).toBeGreaterThan(15);
    expect(site.progressPct).toBeLessThan(25);
  });
});

describe("금액 표기", () => {
  it("억 경계에서 만 단위가 10,000으로 넘치지 않는다", async () => {
    const { fmtMan } = await import("@/lib/domain/format");
    expect(fmtMan(1_799_999_982)).toBe("18억 원");
    expect(fmtMan(1_800_050_000)).toBe("18억 5만 원");
    expect(fmtMan(250_000_000)).toBe("2억 5,000만 원");
  });
});

describe("D-77 지도 앱 좌표 붙여 넣기", () => {
  it("‘위도, 경도’ 한 줄을 둘로 나눈다", async () => {
    const { splitLatLng } = await import("@/lib/domain/geo");
    expect(splitLatLng("37.2281, 127.3719")).toEqual({ lat: "37.2281", lng: "127.3719" });
    expect(splitLatLng("37.2281 127.3719")).toEqual({ lat: "37.2281", lng: "127.3719" });
    expect(splitLatLng("(37.2281,127.3719)")).toEqual({ lat: "37.2281", lng: "127.3719" });
    // 순서가 바뀌어 있으면(경도 먼저) 바로잡는다
    expect(splitLatLng("127.3719, 37.2281")).toEqual({ lat: "37.2281", lng: "127.3719" });
  });
  it("숫자 하나나 글이 섞이면 그대로 둔다", async () => {
    const { splitLatLng } = await import("@/lib/domain/geo");
    expect(splitLatLng("37.2281")).toBeNull();
    expect(splitLatLng("37.")).toBeNull();
    expect(splitLatLng("경기 용인시 37.2 127.3")).toBeNull();
    expect(splitLatLng("1, 2, 3")).toBeNull();
  });
});

describe("D-77 감액 변경공사", () => {
  it("가져오기에서 −금액은 감액으로 들어가고, 승인하면 계약금액이 줄어든다", async () => {
    const { planImport } = await import("@/lib/domain/importers");
    const { setChangeOrderStatus } = await import("@/lib/data/commands");
    const db0 = createSeed(new Date("2026-11-13T00:00:00Z"));
    const text = "현장,제목,금액,상태,요청일,승인금액\nA현장,3층 사양 축소,-6000000,승인,2026-10-10,5000000\nA현장,외부 창 일부 제외,\"감액 2,000,000\",청구,2026-10-12,\nA현장,추가창,−1000000,검토,2026-10-12,";
    const p = planImport(db0, "change", text, "2026-11-13");
    expect(p.errors).toEqual([]);
    const rows = p.rows as { amount: number; approvedAmount?: number }[];
    expect(rows.map((r) => r.amount)).toEqual([-6_000_000, -2_000_000, -1_000_000]);
    // 감액 건의 승인금액은 부호 없이 적어도 감액
    expect(rows[0].approvedAmount).toBe(-5_000_000);
    // 증액 건에 − 승인금액은 오류
    const bad = planImport(db0, "change", "현장,제목,금액,상태,요청일,승인금액\nA현장,추가창,6000000,승인,2026-10-10,-5000000", "2026-11-13");
    expect(bad.errors.length).toBe(1);
    // 화면에서 승인: 크기만 적어도 감액으로 반영
    const co = { id: "co-minus", siteId: "site-a", title: "감액", amount: -3_000_000, status: "submitted" as const, requestedAt: "2026-10-10T00:00:00Z", sourceEntryIds: [], note: "" };
    const db1 = { ...db0, changeOrders: [...db0.changeOrders, co] } as DemoDB;
    const before = siteFinancials(db1, "site-a").adjustedContract;
    const r = setChangeOrderStatus(db1, "co-minus", "approved", 2_500_000, { userId: "u-manager", role: "manager", now: new Date("2026-11-13T01:00:00Z") } as never);
    expect(r.db.changeOrders.find((c) => c.id === "co-minus")!.approvedAmount).toBe(-2_500_000);
    expect(siteFinancials(r.db, "site-a").adjustedContract).toBe(before - 2_500_000);
  });
});
