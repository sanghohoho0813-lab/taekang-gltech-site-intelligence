/**
 * 자재 반입·설치 수량 (D-62) + 기성 청구 지연 신호
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { COMMANDS } from "@/lib/data/registry";
import { CommandError } from "@/lib/data/commands";
import { materialRows, movesOn, siteInstallPct } from "@/lib/domain/material";
import { computeSignals } from "@/lib/domain/risk";
import { siteFinancials } from "@/lib/domain/calc";
import { dailyLog } from "@/lib/domain/dailylog";
import { photoLedger } from "@/lib/domain/photoLedger";
import { viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T03:00:00Z");
const ctx = { userId: "u-field", now: NOW };
const hq = { userId: "u-manager", now: NOW };
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });

const row = (db: DemoDB, siteId: string, itemId: string) => materialRows(db, siteId).find((r) => r.item.id === itemId)!;

describe("자재 수량 계산", () => {
  it("시연 자료: 반입·설치 누계, 현장 보관, 설치율 (A 유닛 108/240 = 45%)", () => {
    const db = createSeed(NOW);
    const u = row(db, "site-a", "mat-a-unit");
    expect([u.inQty, u.installQty, u.onSite]).toEqual([144, 108, 36]);
    expect(u.installPct).toBeCloseTo(45);
    expect(u.flags).toEqual([]);
    // 품목마다 같은 비중 평균 (45% · 20%)
    expect(siteInstallPct(db, "site-a")!.pct).toBeCloseTo(32.5);
    expect(siteInstallPct(db, "site-c")).toBeNull();
  });

  it("설치가 반입보다 많으면 표시 (B현장 — 반입 기록 빠짐 확인), 현장 보관은 0으로", () => {
    const db = createSeed(NOW);
    const b = row(db, "site-b", "mat-b-glass");
    expect(b.flags).toContain("install_over_in");
    expect(b.onSite).toBe(0);
  });

  it("취소한 기록은 누계에서 빠지고, 지우지 않고 사유가 남는다", () => {
    let db = createSeed(NOW);
    db = COMMANDS.voidMaterialMove(db, { moveId: "mm-seed-a6", reason: "수량 잘못 입력" }, ctx).db;
    expect(row(db, "site-a", "mat-a-glass").installQty).toBe(60);
    expect(db.materialMoves!.find((m) => m.id === "mm-seed-a6")!.voided).toMatchObject({ by: "u-field", reason: "수량 잘못 입력" });
    expect(() => COMMANDS.voidMaterialMove(db, { moveId: "mm-seed-a6", reason: "다시" }, ctx)).toThrow(/이미 취소/);
    expect(() => COMMANDS.voidMaterialMove(db, { moveId: "mm-seed-a5", reason: " " }, ctx)).toThrow(CommandError);
  });
});

describe("자재 명령", () => {
  it("반입 기록 → 누계·현장 보관이 바로 바뀌고, 사진은 사진대장으로", () => {
    const db0 = createSeed(NOW);
    const photo = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
    const { db, result } = COMMANDS.recordMaterial(db0, { siteId: "site-a", itemId: "mat-a-glass", kind: "in", qty: 40, note: "송장 확인", photoDataUrl: photo }, ctx);
    expect(result).toMatchObject({ inQty: 220, installQty: 104, onSite: 116 });
    const mv = db.materialMoves!.find((m) => m.id === result.moveId)!;
    expect(mv).toMatchObject({ by: "u-field", workDate: "2026-11-04", qty: 40, note: "송장 확인" });
    const ph = db.photos.find((p) => p.id === mv.photoId)!;
    expect(ph).toMatchObject({ siteId: "site-a", materialMoveId: mv.id });
    expect(ph.caption).toContain("자재 반입 · 삼중 로이유리 40 장");
    expect(db.activityLogs[0].summary).toContain("자재 반입 — 삼중 로이유리 40 장");
    // 사진대장에 ‘자재 반입’ 사진으로 들어가고, 기록을 취소하면 빠진다
    const d = mv.workDate;
    expect(photoLedger(db, "site-a", d, d).some((x) => x.photo.id === ph.id)).toBe(true);
    const voided = COMMANDS.voidMaterialMove(db, { moveId: mv.id, reason: "중복" }, ctx).db;
    expect(photoLedger(voided, "site-a", d, d).some((x) => x.photo.id === ph.id)).toBe(false);
  });

  it("잘못된 입력은 거부 (없는 품목·숨긴 품목·0·음수·소수 셋째 자리·너무 긴 메모·사진 아님)", () => {
    const db = createSeed(NOW);
    const bad = (a: Partial<Parameters<typeof COMMANDS.recordMaterial>[1]>) => () => COMMANDS.recordMaterial(db, { siteId: "site-a", itemId: "mat-a-unit", kind: "install", qty: 1, ...a } as never, ctx);
    expect(bad({ itemId: "mat-b-glass" })).toThrow(CommandError); // 다른 현장 품목
    expect(bad({ qty: 0 })).toThrow(CommandError);
    expect(bad({ qty: -3 })).toThrow(CommandError);
    expect(bad({ qty: 1.234 })).toThrow(CommandError);
    expect(bad({ qty: 2_000_000 })).toThrow(CommandError);
    expect(bad({ kind: "out" as never })).toThrow(CommandError);
    expect(bad({ note: "가".repeat(201) })).toThrow(CommandError);
    expect(bad({ photoDataUrl: "javascript:alert(1)" })).toThrow(CommandError);
    expect(bad({ qty: 12.5 })).not.toThrow();
    const hidden = COMMANDS.setSiteMaterials(db, { siteId: "site-a", items: [{ id: "mat-a-unit", name: "커튼월 유닛", unit: "EA", plannedQty: 240, archived: true }, { id: "mat-a-glass", name: "삼중 로이유리", unit: "장", plannedQty: 520 }] }, hq).db;
    try {
      COMMANDS.recordMaterial(hidden, { siteId: "site-a", itemId: "mat-a-unit", kind: "install", qty: 1 }, ctx);
      throw new Error("거부돼야 함");
    } catch (e) {
      expect((e as CommandError).fieldErrors.itemId).toMatch(/더 쓰지 않는/);
    }
  });

  it("품목 정하기: 새 품목 추가·수량 수정, 기록 있는 품목은 지울 수 없고 숨기면 지난 기록은 그대로 보인다", () => {
    const db0 = createSeed(NOW);
    const items = [
      { id: "mat-a-unit", name: "커튼월 유닛", unit: "EA", plannedQty: 250 },
      { id: "mat-a-glass", name: "삼중 로이유리", unit: "장", plannedQty: 520 },
      { name: "실링재", unit: "박스", plannedQty: 0 },
    ];
    const db = COMMANDS.setSiteMaterials(db0, { siteId: "site-a", items }, hq).db;
    const mats = db.sites.find((s) => s.id === "site-a")!.materials!;
    expect(mats.map((m) => m.name)).toEqual(["커튼월 유닛", "삼중 로이유리", "실링재"]);
    expect(mats[0].plannedQty).toBe(250);
    // 설계 수량 0 = 설치율 계산 안 함
    expect(row(db, "site-a", mats[2].id).installPct).toBeNull();
    expect(() => COMMANDS.setSiteMaterials(db, { siteId: "site-a", items: [items[1]] }, hq)).toThrow(CommandError);
    expect(() => COMMANDS.setSiteMaterials(db, { siteId: "site-a", items: [...items.slice(0, 2), { name: "커튼월 유닛", unit: "EA", plannedQty: 1 }] }, hq)).toThrow(CommandError);
    expect(() => COMMANDS.setSiteMaterials(db, { siteId: "site-a", items: [{ id: "mat-zzz", name: "x", unit: "EA", plannedQty: 1 }] }, hq)).toThrow(CommandError);
    const hidden = COMMANDS.setSiteMaterials(db, { siteId: "site-a", items: [{ ...items[0], archived: true }, items[1]] }, hq).db;
    expect(materialRows(hidden, "site-a").map((r) => r.item.id)).toContain("mat-a-unit"); // 기록이 있으니 숨겨도 표에 남음
    expect(siteInstallPct(hidden, "site-a")!.items).toBe(1); // 설치율 평균에서는 빠짐
  });

  it("공사일보에 그날 자재 반입·설치가 들어간다 (금액 없음)", () => {
    const db = createSeed(NOW);
    const date = db.materialMoves!.find((m) => m.id === "mm-seed-a6")!.workDate;
    expect(movesOn(db, "site-a", date).map((x) => x.move.id)).toContain("mm-seed-a6");
    const log = dailyLog(db, db.sites.find((s) => s.id === "site-a")!, date);
    expect(log.materialQty.map((m) => `${m.kind}:${m.name}:${m.qty}`)).toEqual(expect.arrayContaining(["install:삼중 로이유리:44", "install:커튼월 유닛:12"]));
  });
});

describe("역할별 데이터 — 자재", () => {
  it("현장 직원: 담당 현장 기록만 / 발주처: 기록도 품목도 받지 않음", () => {
    const db = createSeed(NOW);
    db.materialMoves = [...db.materialMoves!, { id: "mm-c", siteId: "site-c", itemId: "x", kind: "in", qty: 1, workDate: "2026-11-03", at: "2026-11-03T01:00:00Z", by: "u-field2" }];
    // 120일 전 기록도 담당 현장이면 보낸다 (휴대폰 누계가 맞도록)
    db.materialMoves.push({ id: "mm-old", siteId: "site-a", itemId: "mat-a-unit", kind: "in", qty: 1, workDate: "2026-07-01", at: "2026-07-01T01:00:00Z", by: "u-field" });
    const field = viewFor(member("u-field", "field"), db, NOW);
    expect(field.materialMoves!.every((m) => m.siteId !== "site-c")).toBe(true);
    expect(field.materialMoves!.some((m) => m.id === "mm-old")).toBe(true);
    expect(materialRows(field, "site-a")).toEqual(materialRows(db, "site-a"));
    expect(field.materialMoves!.length).toBeGreaterThan(0);
    expect(field.sites.find((s) => s.id === "site-a")!.materials).toHaveLength(2);
    const partner = viewFor(member("u-partner", "partner", { partnerSiteIds: ["site-a"] }), db, NOW);
    expect(partner.materialMoves).toEqual([]);
    expect(partner.sites.every((s) => s.materials === undefined)).toBe(true);
  });
});

describe("기성 청구 지연 신호 (BILLING_LAG)", () => {
  it("시연 자료에서는 나오지 않는다 (공정·기성 차이가 모두 10%p 이하)", () => {
    expect(computeSignals(createSeed(NOW), NOW).some((s) => s.rule === "BILLING_LAG")).toBe(false);
  });

  it("공정률이 기성률보다 10%p 넘게 앞서면 → 청구 가능 추정액·마지막 기성·자재 설치율을 근거로", () => {
    let db = createSeed(NOW);
    db = COMMANDS.updateProgress(db, { siteId: "site-a", progressPct: 75 }, hq).db;
    const f = siteFinancials(db, "site-a");
    const s = computeSignals(db, NOW).find((x) => x.rule === "BILLING_LAG" && x.siteId === "site-a")!;
    expect(s).toBeTruthy();
    const lag = f.physicalProgressPct - (f.billed / f.adjustedContract) * 100;
    expect(s.amountAtRisk).toBe(Math.round((f.adjustedContract * lag) / 100));
    expect(s.severity).toBe(lag > 20 ? "high" : "medium");
    expect(s.why.join(" ")).toMatch(/마지막 확정 기성 3차/);
    expect(s.why.join(" ")).toMatch(/주요 자재 설치율 32\.5%/);
    expect(s.dataUsed).toContain("material_moves");
  });

  it("기준을 바꾸면 다시 계산 · 이전에 저장된 기준(값 없음)은 10%p로", () => {
    let db = createSeed(NOW);
    db = COMMANDS.updateProgress(db, { siteId: "site-a", progressPct: 70 }, hq).db; // 차이 15%p
    expect(computeSignals(db, NOW).some((x) => x.rule === "BILLING_LAG")).toBe(true);
    const { billingLagPp: _b, ...old } = db.thresholds;
    void _b;
    expect(computeSignals({ ...db, thresholds: old }, NOW).some((x) => x.rule === "BILLING_LAG")).toBe(true);
    expect(computeSignals({ ...db, thresholds: { ...db.thresholds, billingLagPp: 20 } }, NOW).some((x) => x.rule === "BILLING_LAG")).toBe(false);
  });

  it("현장 직원 화면(계약 금액 0)에서는 계산하지 않는다", () => {
    let db = createSeed(NOW);
    db = COMMANDS.updateProgress(db, { siteId: "site-a", progressPct: 90 }, hq).db;
    const field = viewFor(member("u-field", "field"), db, NOW);
    expect(computeSignals(field, NOW).some((x) => x.rule === "BILLING_LAG")).toBe(false);
  });
});
