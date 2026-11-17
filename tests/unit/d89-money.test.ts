/**
 * D-89 돈 기록 바로잡기
 * 1) 잘못 넣은 기성·입금 취소 (이유 · 숫자에서 빠지고 기록은 남음 · 회차 다시 매김 · 마감 뒤 ‘취소함’)
 * 2) 발주처가 떼고 준 돈 — 유보금(미수에 남지만 오래된 미수로 안 셈) · 공제(미수·예상이익을 줄이고 ‘이익을 바꾼 일’에 남음)
 * 3) 유보금 받음 → 입금 (나눠 받기 · 그 입금을 취소하면 다시 열림)
 * 4) 모든 화면 숫자가 같게: 현장 상세·대시보드·월 마감·엑셀·숫자 맞추기 점검
 */
import { describe, expect, it } from "vitest";
import { COMMANDS } from "@/lib/data/registry";
import { createSeed } from "@/lib/data/seed";
import { CommandError } from "@/lib/data/commands";
import { siteFinancials, portfolioTotals } from "@/lib/domain/calc";
import { receivableAging } from "@/lib/domain/risk";
import { monthClose, profitEvents } from "@/lib/domain/monthClose";
import { moneyIntegrity } from "@/lib/domain/integrity";
import { monthWorkbook, verifyWorkbookFile } from "@/lib/domain/monthWorkbook";
import { readXlsx, writeXlsx } from "@/lib/domain/xlsx";
import { changesAfterClose, currentClose } from "@/lib/domain/closeRecord";
import { authorize, viewFor, ForbiddenError } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-17T03:00:00Z");
const TODAY = "2026-11-17";
const ctx = (userId = "u-manager", now = NOW) => ({ userId, now });
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const errs = (db: DemoDB) => moneyIntegrity(db, TODAY).filter((c) => c.level === "err");

/** 시드 + site-a에 기성 2회 (1억 · 8천만) */
function base() {
  let db = createSeed(new Date("2026-10-01T01:00:00Z"));
  db = COMMANDS.addBilling(db, { siteId: "site-a", amount: 100_000_000, billedDate: "2026-10-10", idempotencyKey: "idem-89-b1" }, ctx("u-manager", new Date("2026-10-10T03:00:00Z"))).db;
  db = COMMANDS.addBilling(db, { siteId: "site-a", amount: 80_000_000, billedDate: "2026-11-05", idempotencyKey: "idem-89-b2" }, ctx("u-manager", new Date("2026-11-05T03:00:00Z"))).db;
  return db;
}

describe("D-89 기성·입금 취소", () => {
  it("잘못 넣은 입금을 이유와 함께 취소 → 미수가 돌아오고, 기록은 ‘취소한 기성·입금’에 남는다", () => {
    let db = base();
    const f0 = siteFinancials(db, "site-a");
    db = COMMANDS.addPayment(db, { siteId: "site-a", amount: 90_000_000, receivedDate: "2026-11-12", idempotencyKey: "idem-89-p1" }, ctx()).db;
    const pay = db.payments.find((p) => p.amount === 90_000_000)!;
    expect(siteFinancials(db, "site-a").outstanding).toBe(f0.outstanding - 90_000_000);
    expect(() => COMMANDS.voidMoneyRecord(db, { kind: "payment", id: pay.id, reason: "" }, ctx())).toThrow(/이유/);
    db = COMMANDS.voidMoneyRecord(db, { kind: "payment", id: pay.id, reason: "9천만을 9억으로 볼 뻔 — 다른 현장 입금", idempotencyKey: "idem-89-v1" }, ctx()).db;
    expect(db.payments.some((p) => p.id === pay.id)).toBe(false);
    expect(siteFinancials(db, "site-a").outstanding).toBe(f0.outstanding);
    expect(db.voidedMoney![0]).toMatchObject({ id: pay.id, kind: "payment", reason: "9천만을 9억으로 볼 뻔 — 다른 현장 입금", voidedBy: "u-manager" });
    expect(db.activityLogs[0].summary).toContain("입금 9,000만");
    expect(db.activityLogs[0].summary).toContain("취소");
    // 같은 요청 다시 → 이미 저장됨 · 없는 기록 → 찾을 수 없음
    expect(() => COMMANDS.voidMoneyRecord(db, { kind: "payment", id: pay.id, reason: "다시", idempotencyKey: "idem-89-v1" }, ctx())).toThrow(expect.objectContaining({ code: "DUPLICATE" }));
    expect(() => COMMANDS.voidMoneyRecord(db, { kind: "payment", id: pay.id, reason: "다시" }, ctx())).toThrow(/찾을 수 없/);
    expect(errs(db)).toEqual([]);
  });

  it("기성 취소 → 회차를 다시 매김 · 입금이 기성보다 많아지면 막음", () => {
    let db = base();
    const bills = () => db.billings.filter((b) => b.siteId === "site-a").sort((a, b) => a.billedDate.localeCompare(b.billedDate));
    const before = bills().length;
    const first = bills().find((b) => b.billedDate === "2026-10-10")!;
    db = COMMANDS.voidMoneyRecord(db, { kind: "billing", id: first.id, reason: "같은 기성을 두 번 넣음" }, ctx()).db;
    expect(bills().length).toBe(before - 1);
    expect(bills().map((b) => b.round)).toEqual(bills().map((_, i) => i + 1));
    // 남은 기성보다 많이 받은 상태가 되면 취소 불가
    const f = siteFinancials(db, "site-a");
    db = COMMANDS.addPayment(db, { siteId: "site-a", amount: f.outstanding, receivedDate: "2026-11-12" }, ctx()).db;
    const last = bills().at(-1)!;
    expect(() => COMMANDS.voidMoneyRecord(db, { kind: "billing", id: last.id, reason: "잘못" }, ctx())).toThrow(/입금을 먼저 취소/);
    expect(errs(db)).toEqual([]);
  });
});

describe("D-89 유보금 — 미수에는 남지만 오래된 미수로 세지 않는다", () => {
  it("입금 9,500만 + 유보금 500만 → 미수 그대로 500만 · ‘90일 넘은 미수’에서 빠짐 · 받을 날이 지나면 다시 셈", () => {
    let db = base();
    const f0 = siteFinancials(db, "site-a");
    db = COMMANDS.addPayment(
      db,
      { siteId: "site-a", amount: 95_000_000, receivedDate: "2026-11-12", withheld: { kind: "retention", amount: 5_000_000, note: "하자보수 유보 5%", dueDate: "2027-06-30" }, idempotencyKey: "idem-89-r1" },
      ctx(),
    ).db;
    const f = siteFinancials(db, "site-a");
    expect(f.outstanding).toBe(f0.outstanding - 95_000_000);
    expect(f.retention).toBe(5_000_000);
    expect(f.expectedProfit).toBe(f0.expectedProfit);
    // 1월에 보면 유보금 500만은 경과일로 세지 않는다 (가장 오래된 미수부터 뺀다)
    const jan = new Date("2027-01-20T03:00:00Z");
    expect(receivableAging(db, "site-a", jan).reduce((a, x) => a + x.unpaid, 0)).toBe(f.outstanding - 5_000_000);
    // 받을 날(6/30)이 지나면 다시 오래된 미수 — 전부 셈
    const aug = new Date("2027-08-01T03:00:00Z");
    expect(receivableAging(db, "site-a", aug).reduce((a, x) => a + x.unpaid, 0)).toBe(f.outstanding);
    expect(errs(db)).toEqual([]);
  });

  it("유보금 받음(나눠서) → 입금이 생기고 남은 유보금이 줄어든다 · 그 입금을 취소하면 다시 열림", () => {
    let db = base();
    db = COMMANDS.addReceivableAdjustment(db, { siteId: "site-a", kind: "retention", amount: 10_000_000, date: "2026-11-12", note: "준공 후 지급" }, ctx()).db;
    const r = db.receivableAdjustments![0];
    const o0 = siteFinancials(db, "site-a").outstanding;
    expect(() => COMMANDS.releaseRetention(db, { id: r.id, date: "2026-11-15", amount: 11_000_000 }, ctx())).toThrow(/남은 유보금/);
    db = COMMANDS.releaseRetention(db, { id: r.id, date: "2026-11-15", amount: 4_000_000, idempotencyKey: "idem-89-rel1" }, ctx()).db;
    const pay = db.payments.find((p) => p.retentionId === r.id)!;
    expect(pay.amount).toBe(4_000_000);
    expect(siteFinancials(db, "site-a").outstanding).toBe(o0 - 4_000_000);
    expect(siteFinancials(db, "site-a").retention).toBe(6_000_000);
    // 받은 기록이 있으면 유보금 자체는 취소 불가 → 입금을 먼저 취소
    expect(() => COMMANDS.voidReceivableAdjustment(db, { id: r.id, reason: "잘못" }, ctx())).toThrow(/입금을 먼저 취소/);
    db = COMMANDS.voidMoneyRecord(db, { kind: "payment", id: pay.id, reason: "다른 유보금이었음" }, ctx()).db;
    expect(siteFinancials(db, "site-a").retention).toBe(10_000_000);
    expect(db.receivableAdjustments![0].released).toEqual([]);
    db = COMMANDS.voidReceivableAdjustment(db, { id: r.id, reason: "유보 없음으로 확인" }, ctx()).db;
    expect(siteFinancials(db, "site-a").retention).toBe(0);
    expect(errs(db)).toEqual([]);
  });
});

describe("D-89 공제 — 미수와 예상이익을 함께 줄이고 ‘이익을 바꾼 일’에 남는다", () => {
  it("입금 9,700만 + 지체상금 300만 → 미수 −1억 · 예상이익 −300만 · 이익을 바꾼 일 ‘발주처 공제 — 지체상금’ · 모든 점검 0", () => {
    let db = base();
    const f0 = siteFinancials(db, "site-a");
    const t0 = portfolioTotals(db);
    db = COMMANDS.addPayment(
      db,
      { siteId: "site-a", amount: 97_000_000, receivedDate: "2026-11-12", withheld: { kind: "deduction", deductionType: "delay_penalty", amount: 3_000_000, note: "공기 지연 6일 — 원청 공문 11/10" }, idempotencyKey: "idem-89-d1" },
      ctx(),
    ).db;
    const f = siteFinancials(db, "site-a");
    expect(f.outstanding).toBe(f0.outstanding - 100_000_000);
    expect(f.deducted).toBe(3_000_000);
    expect(f.expectedProfit).toBe(f0.expectedProfit - 3_000_000);
    expect(f.adjustedContract).toBe(f0.adjustedContract); // 계약금액(기성률 기준)은 그대로
    expect(portfolioTotals(db).expectedProfit).toBe(t0.expectedProfit - 3_000_000);
    const ev = profitEvents(db, "site-a", "2026-11-01", "2026-11-30").find((e) => e.text.startsWith("발주처 공제"));
    expect(ev).toMatchObject({ amount: -3_000_000 });
    expect(ev!.text).toContain("지체상금");
    // 월 마감: 11월 공제 300만 · 월말 미수 = 지금 미수
    const nov = monthClose(db, "2026-11", TODAY);
    expect(nov.totals.deducted).toBe(3_000_000);
    expect(nov.money.find((m) => m.site.id === "site-a")!.outstandingAtEnd).toBe(f.outstanding);
    expect(errs(db)).toEqual([]);
  });

  it("공제 사유·종류 필수 · 미수보다 큰 공제·미래 날짜 거부 · 공제를 취소하면 예상이익이 돌아오고 ‘공제 취소’가 남는다", () => {
    let db = base();
    const f0 = siteFinancials(db, "site-a");
    const add = (a: Record<string, unknown>) => () => COMMANDS.addReceivableAdjustment(db, { siteId: "site-a", kind: "deduction", deductionType: "setoff", amount: 2_000_000, date: "2026-11-12", note: "발주처 지급 자재 상계", ...a } as never, ctx());
    expect(add({ note: "" })).toThrow(/사유/);
    expect(add({ deductionType: undefined })).toThrow(CommandError);
    expect(add({ amount: f0.outstanding + 1 })).toThrow(/미수금/);
    expect(add({ date: "2027-01-01" })).toThrow(CommandError);
    db = add({ idempotencyKey: "idem-89-d2" })().db;
    expect(siteFinancials(db, "site-a").expectedProfit).toBe(f0.expectedProfit - 2_000_000);
    const d = db.receivableAdjustments![0];
    db = COMMANDS.voidReceivableAdjustment(db, { id: d.id, reason: "상계 아님 — 별도 정산" }, ctx()).db;
    expect(siteFinancials(db, "site-a").expectedProfit).toBe(f0.expectedProfit);
    expect(siteFinancials(db, "site-a").outstanding).toBe(f0.outstanding);
    // 공제 −200만과 취소 +200만이 각각 그 시각에 남아 합이 맞는다 (지난 달 숫자가 바뀌지 않게)
    const evs = profitEvents(db, "site-a", "2026-11-01", "2026-11-30").filter((e) => e.text.includes("공제"));
    expect(evs.map((e) => e.amount).sort((a, b) => a - b)).toEqual([-2_000_000, 2_000_000]);
    expect(errs(db)).toEqual([]);
  });
});

describe("D-89 엑셀 · 월 마감 기록 · 권한", () => {
  it("월 마감 엑셀: 미수 시트(기성 − 입금 − 공제)·유보·공제 시트 합계 = 화면 · 파일 다시 읽기도 같음", async () => {
    let db = base();
    db = COMMANDS.addPayment(db, { siteId: "site-a", amount: 90_000_000, receivedDate: "2026-11-12", withheld: { kind: "retention", amount: 5_000_000, note: "유보 5%" } }, ctx()).db;
    db = COMMANDS.addReceivableAdjustment(db, { siteId: "site-a", kind: "deduction", deductionType: "delay_penalty", amount: 5_000_000, date: "2026-11-13", note: "지체상금" }, ctx()).db;
    const w = monthWorkbook(db, "2026-11", TODAY);
    expect(w.ok, JSON.stringify(w.checks.filter((c) => !c.ok))).toBe(true);
    const bytes = writeXlsx(w.sheets);
    expect((await verifyWorkbookFile(bytes, w)).filter((c) => !c.ok)).toEqual([]);
    const sheets = await readXlsx(bytes);
    const ar = sheets.find((s) => s.name === "미수(오늘)")!.rows;
    const total = ar[ar.length - 1];
    expect(Number(total[3])).toBe(monthClose(db, "2026-11", TODAY).totals.outstandingAtEnd);
    expect(Number(total[7])).toBe(5_000_000);
    expect(Number(total[8])).toBe(5_000_000);
    const wh = sheets.find((s) => s.name === "유보·공제")!.rows;
    expect(wh.slice(1, -1).map((r) => r[2])).toEqual(["유보금", "공제 · 지체상금"]);
  });

  it("마감한 달에 늦게 넣은 공제·취소한 입금은 ‘마감 뒤 바뀐 것’에 무엇을 왜로 보인다", () => {
    let db = base();
    db = COMMANDS.addPayment(db, { siteId: "site-a", amount: 30_000_000, receivedDate: "2026-10-20" }, ctx("u-manager", new Date("2026-10-20T03:00:00Z"))).db;
    const pay = db.payments.find((p) => p.receivedDate === "2026-10-20")!;
    const closeAt = new Date("2026-11-03T03:00:00Z");
    const items = monthClose(db, "2026-10", "2026-11-03").items.length;
    db = COMMANDS.closeMonth(db, { month: "2026-10", ackOpen: items, note: items ? "남긴 일 확인" : "" }, ctx("u-manager", closeAt)).db;
    db = COMMANDS.addReceivableAdjustment(db, { siteId: "site-a", kind: "deduction", deductionType: "other", amount: 1_000_000, date: "2026-10-25", note: "10월 안전 벌점 공제" }, ctx()).db;
    db = COMMANDS.voidMoneyRecord(db, { kind: "payment", id: pay.id, reason: "입금일 잘못 — 11월로 다시" }, ctx()).db;
    const ch = changesAfterClose(db, currentClose(db, "2026-10")!, TODAY);
    const lines = ch.events.map((e) => e.text).join("\n");
    expect(lines).toContain("유보금·공제 들어옴");
    expect(lines).toContain("입금 취소함");
    expect(lines).toContain("입금일 잘못 — 11월로 다시");
  });

  it("현장·발주처: 취소·유보금·공제·유보금 받음·입금 명령 거부 · 데이터에 없음 (본사는 있음)", () => {
    let db = base();
    db = COMMANDS.addReceivableAdjustment(db, { siteId: "site-a", kind: "retention", amount: 1_000_000, date: "2026-11-12", note: "유보" }, ctx()).db;
    const bill = db.billings[0];
    db = COMMANDS.voidMoneyRecord(db, { kind: "billing", id: db.billings.find((b) => b.billedDate === "2026-11-05")!.id, reason: "중복" }, ctx()).db;
    const FIELD = member("u-field", "field", { siteIds: ["site-a"] });
    const PARTNER = member("u-partner", "partner", { partnerSiteIds: ["site-a"] });
    const args: [string, Record<string, unknown>][] = [
      ["voidMoneyRecord", { kind: "billing", id: bill.id, reason: "x" }],
      ["addReceivableAdjustment", { siteId: "site-a", kind: "deduction", deductionType: "other", amount: 1, date: TODAY, note: "xx" }],
      ["voidReceivableAdjustment", { id: db.receivableAdjustments![0].id, reason: "xx" }],
      ["releaseRetention", { id: db.receivableAdjustments![0].id, date: TODAY, amount: 1 }],
      ["addPayment", { siteId: "site-a", amount: 1, receivedDate: TODAY }],
    ];
    for (const m of [FIELD, PARTNER]) {
      for (const [name, a] of args) expect(() => authorize(m, name as never, a, db, NOW), `${m.role}:${name}`).toThrow(ForbiddenError);
      const v = viewFor(m, db, NOW);
      expect(v.receivableAdjustments).toEqual([]);
      expect(v.voidedMoney).toEqual([]);
    }
    const hq = viewFor(member("u-manager", "manager"), db, NOW);
    expect(hq.receivableAdjustments).toHaveLength(1);
    expect(hq.voidedMoney).toHaveLength(1);
  });

  it("가져온 기성을 취소(가져오기 취소)할 때 공제까지 더해 입금이 기성보다 많아지면 막는다", () => {
    let db = createSeed(new Date("2026-10-01T01:00:00Z"));
    const site = db.sites.find((s) => s.id === "site-a")!;
    const before = siteFinancials(db, "site-a");
    const r = COMMANDS.importData(db, { kind: "billing", text: `현장,구분,날짜,금액\n${site.shortName},기성,2026-11-01,50000000`, idempotencyKey: "idem-89-imp" } as never, ctx());
    db = r.db;
    db = COMMANDS.addReceivableAdjustment(db, { siteId: "site-a", kind: "deduction", deductionType: "other", amount: before.outstanding + 10_000_000, date: "2026-11-12", note: "가져온 기성에서 공제" }, ctx()).db;
    expect(() => COMMANDS.undoImport(db, { batchId: r.result.batchId }, ctx())).toThrow(/입금·공제/);
  });
});
