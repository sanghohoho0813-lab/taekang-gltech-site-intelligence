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
import { dailyLog, weekStart, weeklyLog } from "@/lib/domain/dailylog";
import { photoLedger } from "@/lib/domain/photoLedger";
import { importTemplate, planImport } from "@/lib/domain/importers";
import { flushWith, type OutboxItem } from "@/lib/browser/outbox";
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

describe("자재 반입·설치 이력 가져오기 (D-63)", () => {
  const head = "현장,날짜,구분,품목,수량,메모";
  it("품목 이름으로 찾아 넣고(띄어쓰기·대소문자 무시), 누계에 더해지고, 금액 요약은 없다", () => {
    const db0 = createSeed(NOW);
    const text = [head, "A현장,2026.09.10,입고,커튼월유닛,\"1,000\",수불부 9월", "A현장,2026-09-11,시공,삼중 로이유리,12.5,"].join("\n");
    const plan = planImport(db0, "material", text, "2026-11-04");
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(2);
    expect(plan.summary[0]).toMatchObject({ siteId: "site-a", count: 2 });
    expect(plan.summary[0].amount).toBeUndefined();
    const { db, result } = COMMANDS.importData(db0, { kind: "material", text, idempotencyKey: "k1" }, hq);
    expect(result.added).toBe(2);
    const u = row(db, "site-a", "mat-a-unit");
    expect(u.inQty).toBe(144 + 1000);
    const added = db.materialMoves!.filter((m) => m.imported);
    expect(added.map((m) => m.workDate)).toEqual(["2026-09-10", "2026-09-11"]);
    expect(added.every((m) => m.importBatchId === result.batchId && m.by === "u-manager")).toBe(true);
    expect(db.activityLogs[0].summary).not.toMatch(/합계/);
    // 같은 파일을 다시 올리면 모두 중복 → 넣지 않음
    const again = planImport(db, "material", text, "2026-11-04");
    expect(again.rows).toHaveLength(0);
    expect(again.duplicates).toHaveLength(2);
    // 7일 안 취소 → 통째로 빠짐
    const undone = COMMANDS.undoImport(db, { batchId: result.batchId }, hq).db;
    expect(row(undone, "site-a", "mat-a-unit").inQty).toBe(144);
    expect(undone.materialMoves!.some((m) => m.imported)).toBe(false);
  });

  it("오류는 행 번호와 함께, 한 줄이라도 있으면 아무것도 넣지 않는다", () => {
    const db = createSeed(NOW);
    const text = [head, "A현장,2026-09-10,반입,없는 자재,3,", "C현장,2026-09-10,반입,커튼월 유닛,3,", "A현장,2026-12-01,설치,커튼월 유닛,3,", "A현장,2026-09-10,빌림,커튼월 유닛,3,", "A현장,2026-09-10,반입,커튼월 유닛,0,", "A현장,2026-09-10,반입,커튼월 유닛,1.234,"].join("\n");
    const plan = planImport(db, "material", text, "2026-11-04");
    const by = (line: number) => plan.errors.filter((e) => e.line === line).map((e) => e.field);
    expect(by(2)).toContain("품목");
    expect(plan.errors.find((e) => e.line === 2)!.message).toMatch(/품목 정하기/);
    expect(by(3)).toContain("품목"); // C현장에는 품목이 없음
    expect(by(4)).toContain("날짜"); // 미래
    expect(by(5)).toContain("구분");
    expect(by(6)).toContain("수량");
    expect(by(7)).toContain("수량");
    expect(() => COMMANDS.importData(db, { kind: "material", text, idempotencyKey: "k2" }, hq)).toThrow(/오류가 있어 아무것도 넣지 않았습니다/);
  });

  it("양식의 예시 줄은 넣지 않는다", () => {
    const db = createSeed(NOW);
    const plan = planImport(db, "material", importTemplate("material"), "2026-11-04");
    expect(plan.rows).toHaveLength(0);
    expect(plan.skippedExamples).toHaveLength(2);
  });
});

describe("통신이 끊겨 늦게 도착한 자재 기록 (D-63)", () => {
  it("누른 시각이 2분~12시간 전이면 그 날짜로, 표시를 남긴다 · 그 밖(미래·너무 오래됨·형식 아님)은 받은 날짜", () => {
    const db = createSeed(NOW); // 받은 시각 2026-11-04 12:00 KST
    const base = { siteId: "site-a", itemId: "mat-a-unit", kind: "install" as const, qty: 3 };
    const at = (pressedAt: string, key: string) => COMMANDS.recordMaterial(db, { ...base, pressedAt, idempotencyKey: key }, ctx);
    // 어젯밤 22:00 KST에 눌렀는데 오늘 아침 08:00 KST에 도착(10시간 뒤) → 어제 날짜
    const morning = { userId: "u-field", now: new Date("2026-11-03T23:00:00Z") };
    const late = COMMANDS.recordMaterial(db, { ...base, pressedAt: "2026-11-03T13:00:00Z", idempotencyKey: "a1" }, morning);
    const m1 = late.db.materialMoves!.find((m) => m.id === late.result.moveId)!;
    expect(m1.workDate).toBe("2026-11-03");
    expect(m1.sentLater).toEqual({ pressedAt: "2026-11-03T13:00:00.000Z" });
    // 같은 날 지하에서 09:00 KST에 눌렀고 12:00 KST에 도착 → 날짜는 같고 늦게 도착 표시
    const same = at("2026-11-04T00:00:00Z", "a0");
    expect(same.db.materialMoves!.find((m) => m.id === same.result.moveId)!.sentLater).toBeTruthy();
    // 1분 전(보통 전송) · 12.5시간 전 · 2일 전 · 미래 · 이상한 값 → 받은 날짜, 표시 없음
    for (const [p, k] of [["2026-11-04T02:59:30Z", "a2"], ["2026-11-03T14:30:00Z", "a6"], ["2026-11-02T03:00:00Z", "a3"], ["2026-11-05T03:00:00Z", "a4"], ["어제", "a5"]] as const) {
      const r = at(p, k);
      const m = r.db.materialMoves!.find((x) => x.id === r.result.moveId)!;
      expect(m.workDate, p).toBe("2026-11-04");
      expect(m.sentLater, p).toBeUndefined();
    }
  });

  it("휴대폰 보관함이 자재 기록을 보내고, 같은 키로 다시 보내면 중복으로 처리해 한 번만 들어간다", async () => {
    let db = createSeed(NOW);
    const items: OutboxItem[] = [{ id: "idem-m1", userId: "u-field", name: "recordMaterial", args: { siteId: "site-a", itemId: "mat-a-glass", kind: "in", qty: 10, idempotencyKey: "idem-m1", pressedAt: "2026-11-04T01:00:00Z" }, label: "A현장 · 자재 반입", createdAt: "2026-11-04T01:00:00Z", tries: 0 }];
    const store = { all: async () => items.map((i) => ({ ...i })), put: async (i: OutboxItem) => void items.splice(items.findIndex((x) => x.id === i.id), 1, i), remove: async (id: string) => void items.splice(items.findIndex((x) => x.id === id), 1) };
    const runner = async (name: string, args: Record<string, unknown>) => {
      const r = (COMMANDS as unknown as Record<string, (d: DemoDB, a: unknown, c: typeof ctx) => { db: DemoDB }>)[name](db, args, ctx);
      db = r.db;
    };
    const first = await flushWith(store, "u-field", runner);
    expect(first).toMatchObject({ sent: 1, waiting: 0 });
    expect(row(db, "site-a", "mat-a-glass").inQty).toBe(190);
    // 서버에는 저장됐는데 휴대폰이 응답을 못 받은 경우 — 다시 보내면 DUPLICATE → 지움
    items.push({ id: "idem-m1", userId: "u-field", name: "recordMaterial", args: { siteId: "site-a", itemId: "mat-a-glass", kind: "in", qty: 10, idempotencyKey: "idem-m1" }, label: "", createdAt: "2026-11-04T01:00:00Z", tries: 1 });
    const again = await flushWith(store, "u-field", runner);
    expect(again).toMatchObject({ sent: 1, waiting: 0, failed: 0 });
    expect(row(db, "site-a", "mat-a-glass").inQty).toBe(190);
  });
});

describe("독립 검토 반영 (D-63)", () => {
  const items = (db: DemoDB) => db.sites.find((s) => s.id === "site-a")!.materials!.map((i) => ({ ...i }));
  it("기록이 있는 품목은 단위를 바꿀 수 없다 (이름·설계 수량은 바꾸되 이전 → 새 값을 이력에)", () => {
    const db0 = createSeed(NOW);
    const unitChanged = items(db0).map((i, k) => (k === 0 ? { ...i, unit: "kg" } : i));
    expect(() => COMMANDS.setSiteMaterials(db0, { siteId: "site-a", items: unitChanged }, hq)).toThrow(CommandError);
    const renamed = items(db0).map((i, k) => (k === 0 ? { ...i, name: "커튼월 유닛 (A동)", plannedQty: 250 } : i));
    const db = COMMANDS.setSiteMaterials(db0, { siteId: "site-a", items: renamed }, hq).db;
    expect(db.activityLogs[0].summary).toContain("이름 커튼월 유닛 → 커튼월 유닛 (A동)");
    expect(db.activityLogs[0].summary).toContain("설계 수량 240 EA → 250 EA");
    // 기록이 없는 새 품목은 단위를 바꿔도 된다
    const withNew = COMMANDS.setSiteMaterials(db0, { siteId: "site-a", items: [...items(db0), { name: "실링재", unit: "박스", plannedQty: 0 }] }, hq).db;
    const fresh = items(withNew).map((i) => (i.name === "실링재" ? { ...i, unit: "통" } : i));
    expect(() => COMMANDS.setSiteMaterials(withNew, { siteId: "site-a", items: fresh }, hq)).not.toThrow();
  });

  it("같은 품목 id가 두 번 들어오면 거부 (표에 두 줄·설치율 두 번 세기 방지)", () => {
    const db = createSeed(NOW);
    const a = items(db);
    expect(() => COMMANDS.setSiteMaterials(db, { siteId: "site-a", items: [...a, { ...a[0], archived: true }] }, hq)).toThrow(CommandError);
  });

  it("공정 대비 기성 청구 지연 기준은 1%p 이상 (0이면 모든 현장이 ‘경고’)", () => {
    const db = createSeed(NOW);
    expect(() => COMMANDS.setThresholds(db, { ...db.thresholds, billingLagPp: 0 }, hq)).toThrow(/1%p 이상/);
    expect(() => COMMANDS.setThresholds(db, { ...db.thresholds, billingLagPp: 1 }, hq)).not.toThrow();
  });

  it("기성 청구 지연이 언제 생겼는지 = 공정률이 마지막으로 바뀐 때 (오래된 기성일·시연 시작일이 아님)", () => {
    let db = createSeed(NOW);
    db = COMMANDS.updateProgress(db, { siteId: "site-a", progressPct: 75 }, hq).db;
    const s = computeSignals(db, NOW).find((x) => x.rule === "BILLING_LAG")!;
    expect(s.detectedAt).toBe(NOW.toISOString());
  });
});

describe("주간 공정 보고 — 자재 (D-64)", () => {
  it("이번 주 반입·설치 합계와 주말까지 누계·설치율 (취소한 기록은 빼고)", () => {
    let db = createSeed(NOW);
    const site = db.sites.find((s) => s.id === "site-a")!;
    const from = weekStart("2026-11-04"); // 11/02(월) ~ 11/08(일)
    const w0 = weeklyLog(db, site, from).materials.find((m) => m.name === "커튼월 유닛")!;
    // 시연 자료: 11/02·11/03 설치 12씩 + 11/01 이전 · 11/01 반입 48
    const inWeek = (db.materialMoves ?? []).filter((m) => m.itemId === "mat-a-unit" && m.workDate >= from && m.workDate <= "2026-11-08");
    expect(w0.weekInstall).toBe(inWeek.filter((m) => m.kind === "install").reduce((a, m) => a + m.qty, 0));
    expect(w0.installTotal).toBe(108);
    expect(w0.installPct).toBeCloseTo(45);
    const target = inWeek.find((m) => m.kind === "install")!;
    db = COMMANDS.voidMaterialMove(db, { moveId: target.id, reason: "중복" }, hq).db;
    const w1 = weeklyLog(db, db.sites.find((s) => s.id === "site-a")!, from).materials.find((m) => m.name === "커튼월 유닛")!;
    expect(w1.weekInstall).toBe(w0.weekInstall - target.qty);
    expect(w1.installTotal).toBe(108 - target.qty);
    // 품목이 없는 현장은 표를 만들지 않는다
    expect(weeklyLog(db, db.sites.find((s) => s.id === "site-c")!, from).materials).toEqual([]);
  });
});
