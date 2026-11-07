/** D-70 하자보증 기간 — 계산·명령·권한·발주처/현장에 보내는 내용·하자 요청의 보증 안/밖 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { CommandError, createPartnerRequest } from "@/lib/data/commands";
import { setSiteWarranty } from "@/lib/data/adminCommands";
import { defectRows } from "@/lib/domain/defects";
import { defectWarranty, warrantyClientLine, warrantyEnd, warrantyStatus } from "@/lib/domain/warranty";
import { authorize, viewFor, ForbiddenError } from "@/server/authz";
import type { Member } from "@/server/auth";

const NOW = new Date("2026-11-04T03:00:00Z");
const ctx = (userId: string) => ({ userId, now: NOW });
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });
const FIELD = member("u-field", "field");

describe("하자보증 기간 계산", () => {
  it("준공일 + n개월 − 1일, 말일 넘침은 그 달 말일", () => {
    expect(warrantyEnd("2026-11-30", 24)).toBe("2028-11-29");
    // 끝나는 달에 같은 날이 없으면 그 달 말일 (D-70 점검 반영)
    expect(warrantyEnd("2026-01-31", 1)).toBe("2026-02-28");
    expect(warrantyEnd("2026-01-29", 1)).toBe("2026-02-28");
    expect(warrantyEnd("2026-01-28", 1)).toBe("2026-02-27");
    expect(warrantyEnd("2026-03-31", 1)).toBe("2026-04-30");
    expect(warrantyEnd("2024-02-29", 12)).toBe("2025-02-28");
    expect(warrantyEnd("2026-08-31", 6)).toBe("2027-02-28");
    expect(warrantyEnd("2026-03-01", 12)).toBe("2027-02-28");
  });
  it("상태: 미입력 → 준공 전 → 보증 중 → 만료 임박(60일) → 끝남", () => {
    expect(warrantyStatus({}, "2026-11-04").state).toBe("none");
    expect(warrantyStatus({ warranty: { months: 24, setAt: "", setBy: "" } }, "2026-11-04").state).toBe("pending");
    const w = { warranty: { months: 12, completedDate: "2026-01-10", setAt: "", setBy: "" } };
    expect(warrantyStatus(w, "2026-06-01")).toMatchObject({ state: "active", endDate: "2027-01-09" });
    expect(warrantyStatus(w, "2026-11-10")).toMatchObject({ state: "soon", daysLeft: 60 });
    expect(warrantyStatus(w, "2027-01-09")).toMatchObject({ state: "soon", daysLeft: 0 });
    expect(warrantyStatus(w, "2027-01-10")).toMatchObject({ state: "expired", daysLeft: -1 });
  });
  it("발주처·인쇄물 문구: 계약서 기준·날짜만 (남은 날 없음)", () => {
    expect(warrantyClientLine({})).toBeNull();
    expect(warrantyClientLine({ warranty: { months: 24, setAt: "", setBy: "" } })).toBe("하자보증(계약서 기준): 준공(인도)일부터 2년");
    expect(warrantyClientLine({ warranty: { months: 18, completedDate: "2026-10-08", setAt: "", setBy: "" } })).toBe("하자보증(계약서 기준): 준공 2026.10.08부터 18개월 · 2028.04.07까지");
  });
  it("하자 요청의 보증 안/밖은 접수일 기준 (준공 전 접수 · 기간 안 · 기간 밖)", () => {
    const site = { warranty: { months: 12, completedDate: "2026-01-10", setAt: "", setBy: "" } };
    expect(defectWarranty(site, "2026-01-09")).toBe("before");
    expect(defectWarranty(site, "2026-01-10")).toBe("in");
    expect(defectWarranty(site, "2027-01-09")).toBe("in");
    expect(defectWarranty(site, "2027-01-10")).toBe("after");
    expect(defectWarranty({}, "2027-01-10")).toBeUndefined();
  });
});

describe("하자보증 명령·권한·보내는 내용", () => {
  it("본사만 넣고 고친다 — 1~120개월, 준공일은 오늘 이전·착공 이후, 메모 80자", () => {
    const db = createSeed(NOW);
    const ok = setSiteWarranty(db, { siteId: "site-b", months: 24, completedDate: "2026-11-01", note: "계약서 제12조" }, ctx("u-manager")).db;
    expect(ok.sites.find((s) => s.id === "site-b")!.warranty).toMatchObject({ months: 24, completedDate: "2026-11-01", note: "계약서 제12조", setBy: "u-manager" });
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 0 }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 121 }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 12, completedDate: "2026-12-01" }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 12, completedDate: "2000-01-01" }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 12, note: "가".repeat(81) }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "nope", months: 12 }, ctx("u-manager"))).toThrow(CommandError);
    // 형식이 틀린 값 (점검 반영): 없는 날짜·숫자 날짜·참/거짓 개월·객체 메모
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 12, completedDate: "2026-06-31" }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 12, completedDate: 20261101 as never }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: true as never }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: "24" as never }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => setSiteWarranty(db, { siteId: "site-b", months: 12, note: {} as never }, ctx("u-manager"))).toThrow(CommandError);
    const cleared = setSiteWarranty(ok, { siteId: "site-b", clear: true }, ctx("u-manager")).db;
    expect(cleared.sites.find((s) => s.id === "site-b")!.warranty).toBeUndefined();
    expect(() => authorize(FIELD, "setSiteWarranty", { siteId: "site-a", months: 12 }, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(PARTNER, "setSiteWarranty", { siteId: "site-a", months: 12 }, db, NOW)).toThrow(ForbiddenError);
  });
  it("발주처에는 기간·준공일만 (본사 메모·입력한 사람 없음), 현장 휴대폰에도 메모 없음", () => {
    const db = setSiteWarranty(createSeed(NOW), { siteId: "site-a", months: 24, completedDate: "2026-10-01", note: "보증서 번호 비공개" }, ctx("u-manager")).db;
    const pv = viewFor(PARTNER, db, NOW).sites.find((s) => s.id === "site-a")!;
    expect(pv.warranty).toEqual({ months: 24, completedDate: "2026-10-01", setAt: "", setBy: "" });
    expect(JSON.stringify(viewFor(PARTNER, db, NOW))).not.toContain("보증서 번호");
    expect(JSON.stringify(viewFor(FIELD, db, NOW))).not.toContain("보증서 번호");
  });
  it("하자보수 현황 줄에 보증 안/밖이 붙는다", () => {
    let db = setSiteWarranty(createSeed(NOW), { siteId: "site-a", months: 1, completedDate: "2026-09-01" }, ctx("u-manager")).db;
    db = createPartnerRequest(db, { idempotencyKey: "w1", siteId: "site-a", type: "defect", title: "누수", description: "물이 샘", location: "302호" }, ctx("u-partner")).db;
    const rows = defectRows(db, "2026-11-04");
    expect(rows.find((r) => r.req.title === "누수")!.warranty).toBe("after"); // 9/1 + 1개월 → 9/30까지
    expect(rows.find((r) => r.req.id === "pr-seed-a-defect-1")!.warranty).toBe("after");
  });
});
