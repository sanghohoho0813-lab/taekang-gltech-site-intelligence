/** D-82 월 마감 기록 — 공무 마감(그때 숫자·남긴 일) → 대표 확인 → 마감 뒤 바뀐 것 · 다시 열기 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { reviewCostEntry, saveSite } from "@/lib/data/adminCommands";
import { addBilling, CommandError, editCostEntry, submitFieldReport, voidCostEntry } from "@/lib/data/commands";
import { closeMonth, confirmMonthClose, reopenMonthClose } from "@/lib/data/closeCommands";
import { changesAfterClose, closedMonthOf, closeStatus, closeStatuses, currentClose, pastCloses } from "@/lib/domain/closeRecord";
import { monthClose } from "@/lib/domain/monthClose";
import { pendingItems } from "@/lib/domain/pending";
import { noticesFor } from "@/lib/domain/notify";
import { authorize, ForbiddenError, viewFor } from "@/server/authz";
import { COLLECTIONS } from "@/server/state";
import type { Member } from "@/server/auth";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-14T03:00:00Z");
const TODAY = "2026-11-14";
const ctx = (userId: string, now = NOW) => ({ userId, now });
const B = { material: 60_000_000, labor: 30_000_000, subcontract: 5_000_000, equipment: 3_000_000, overhead: 2_000_000 };
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
const err = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as CommandError;
  }
  throw new Error("오류가 나야 합니다");
};

/** 10월에 일한 새 현장 + 10월 원가·출퇴근 */
function octDb() {
  const r = saveSite(createSeed(NOW), { name: "마감 현장", shortName: "마감현장", workType: "창호", region: "", clientName: "원청", status: "active", startDate: "2026-10-01", endDate: "2026-12-31", fieldUserId: "u-field", contractAmount: 120_000_000, budgets: B, stages: [] } as never, ctx("u-manager", new Date("2026-10-01T00:00:00Z")));
  const id = (r.result as { siteId: string }).siteId;
  const db = r.db;
  db.costEntries.push({ id: "ce-d82-1", siteId: id, category: "material", amount: 5_000_000, date: "2026-10-10", forecastImpact: "within_forecast", reason: "planned", note: "자재", source: "PC", createdBy: "u-manager", createdAt: "2026-10-10T01:00:00Z", status: "active" });
  db.attendance = [...(db.attendance ?? []), { id: "att-d82-1", siteId: id, userId: "u-field", workDate: "2026-10-15", inAt: "2026-10-14T23:00:00Z", outAt: "2026-10-15T08:00:00Z", inGeo: { reason: "denied" } as never }];
  return { db, id };
}
/** 남은 일을 알고 마감 */
const close = (db: DemoDB, who = "u-manager") => closeMonth(db, { month: "2026-10", ackOpen: monthClose(db, "2026-10", TODAY).items.length, note: "변경공사 발주처 승인 대기" }, ctx(who)).db;

describe("D-82 공무 마감", () => {
  it("달이 끝난 뒤에만 · 형식 · 일한 현장이 없는 달은 마감할 것이 없다", () => {
    const { db } = octDb();
    expect(err(() => closeMonth(db, { month: "2026-11", ackOpen: 1, note: "x" }, ctx("u-manager"))).message).toContain("달이 끝난 뒤");
    expect(err(() => closeMonth(db, { month: ["2026-10"] as never }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => closeMonth(db, { month: "2026-13" }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => closeMonth(db, { month: "2020-01" }, ctx("u-manager"))).code).toBe("STATE");
  });

  it("‘닫기 전에 볼 것’이 남아 있으면 알고 마감하고 이유를 적어야 한다 — 그때 숫자·남긴 일·지문이 남는다", () => {
    const { db, id } = octDb();
    const report = monthClose(db, "2026-10", TODAY);
    if (report.items.length) {
      expect(err(() => closeMonth(db, { month: "2026-10" }, ctx("u-manager"))).fieldErrors.ackOpen).toBeTruthy();
      expect(err(() => closeMonth(db, { month: "2026-10", ackOpen: report.items.length }, ctx("u-manager"))).fieldErrors.note).toBeTruthy();
      // 본 건수와 다르면(그 사이 바뀜·문자열 "true") 다시 보게
      expect(err(() => closeMonth(db, { month: "2026-10", ackOpen: report.items.length + 1, note: "이유" }, ctx("u-manager"))).message).toContain("그 사이");
      expect(err(() => closeMonth(db, { month: "2026-10", ackOpen: "true" as never, note: "이유" }, ctx("u-manager"))).fieldErrors.ackOpen).toBeTruthy();
      // 폭 없는 문자만 있는 이유는 이유가 아니다
      expect(err(() => closeMonth(db, { month: "2026-10", ackOpen: report.items.length, note: "\u200B\u200B" }, ctx("u-manager"))).fieldErrors.note).toBeTruthy();
    }
    const after = closeMonth(db, { month: "2026-10", ackOpen: report.items.length, note: "변경공사 대표 결정 대기", idempotencyKey: "idem-d82-close-0001" }, ctx("u-manager"));
    const rec = currentClose(after.db, "2026-10")!;
    expect(rec).toMatchObject({ month: "2026-10", closedBy: "u-manager", note: "변경공사 대표 결정 대기" });
    expect(rec.snapshot.totals.costTotal).toBe(report.totals.costTotal);
    expect(rec.snapshot.totals.billed).toBe(report.totals.billed);
    expect(rec.snapshot.openItems).toEqual(report.items.map((i) => i.text));
    expect(rec.snapshot.sites.find((s) => s.siteId === id)?.costTotal).toBe(5_000_000);
    expect(rec.snapshot.keys.costs.some((k) => k.startsWith("ce-d82-1|"))).toBe(true);
    expect(rec.snapshot.people.find((p) => p.userId === "u-field")?.minutes).toBeGreaterThan(0);
    expect(after.db.activityLogs[0].summary).toContain("10월 마감");
    // 두 번 마감은 막고, 같은 요청 재전송은 중복으로
    expect(err(() => close(after.db)).message).toContain("이미 마감");
    expect(err(() => closeMonth(after.db, { month: "2026-10", ackOpen: report.items.length, note: "x2", idempotencyKey: "idem-d82-close-0001" }, ctx("u-manager"))).code).toBe("DUPLICATE");
  });

  it("마감해도 데이터는 잠기지 않는다 — 그 달 원가를 넣을 수 있다", () => {
    const { db, id } = octDb();
    const c = close(db);
    expect(() => submitFieldReport(c, { idempotencyKey: "idem-d82-late-0001", siteId: id, reportDate: "2026-10-30", workDone: "", kind: "cost", reason: "planned", source: "PC", costs: [{ category: "labor", amount: 2_100_000, forecastImpact: "within_forecast", note: "10월 노무 명세 늦게 옴" }] }, ctx("u-manager"))).not.toThrow();
  });
});

describe("D-82 마감 뒤 바뀐 것", () => {
  it("마감 직후엔 0건 · 그 달 날짜로 들어온 원가·기성, 승인·취소, 근무시간 변화를 찾는다", () => {
    const { db, id } = octDb();
    const c = close(db);
    const rec = () => currentClose(c, "2026-10")!;
    expect(changesAfterClose(c, rec(), TODAY).count).toBe(0);
    // 그 달 날짜로 원가가 들어옴
    const late = submitFieldReport(c, { idempotencyKey: "idem-d82-late-0002", siteId: id, reportDate: "2026-10-30", workDone: "", kind: "cost", reason: "planned", source: "PC", costs: [{ category: "labor", amount: 2_100_000, forecastImpact: "within_forecast", note: "늦은 노무" }] }, ctx("u-manager", new Date("2026-11-14T05:00:00Z")));
    let ch = changesAfterClose(late.db, currentClose(late.db, "2026-10")!, TODAY);
    expect(ch.events.some((e) => e.text.startsWith("원가 들어옴") && e.text.includes("210만"))).toBe(true);
    expect(ch.diffs.some((d) => d.siteId === id && d.label === "이달 원가" && d.after - d.before === 2_100_000)).toBe(true);
    // 취소하면 ‘바뀜 · 반영 → 취소’
    const v = voidCostEntry(late.db, "ce-d82-1", "중복", ctx("u-manager", new Date("2026-11-14T06:00:00Z"))).db;
    ch = changesAfterClose(v, currentClose(v, "2026-10")!, TODAY);
    expect(ch.events.some((e) => e.text.includes("반영 → 취소"))).toBe(true);
    // 기성이 그 달 날짜로 들어옴
    const bill = addBilling(v, { siteId: id, amount: 10_000_000, billedDate: "2026-10-31" }, ctx("u-manager")).db;
    ch = changesAfterClose(bill, currentClose(bill, "2026-10")!, TODAY);
    expect(ch.events.some((e) => e.text.startsWith("기성 들어옴"))).toBe(true);
    // 근무시간 바뀜
    const att = structuredClone(bill);
    att.attendance!.find((a) => a.id === "att-d82-1")!.outAt = "2026-10-15T09:00:00Z";
    ch = changesAfterClose(att, currentClose(att, "2026-10")!, TODAY);
    expect(ch.people.find((p) => p.userId === "u-field")!.after - ch.people.find((p) => p.userId === "u-field")!.before).toBe(60);
  });

  it("공무 확인 대기였던 원가를 마감 뒤 승인하면 ‘공무 확인 대기 → 반영’", () => {
    const { db, id } = octDb();
    db.costEntries.push({ id: "ce-d82-p", siteId: id, category: "labor", amount: 1_000_000, date: "2026-10-20", forecastImpact: "within_forecast", reason: "planned", note: "노무", source: "FIELD", createdBy: "u-field", createdAt: "2026-10-20T01:00:00Z", status: "pending" });
    const c = close(db);
    const a = reviewCostEntry(c, { entryId: "ce-d82-p", decision: "approve" }, ctx("u-manager", new Date("2026-11-14T07:00:00Z"))).db;
    const ch = changesAfterClose(a, currentClose(a, "2026-10")!, TODAY);
    const e = ch.events.find((x) => x.text.includes("공무 확인 대기 → 반영"))!;
    expect(e).toBeTruthy();
    expect(e.at).toBe("2026-11-14T07:00:00.000Z");
    expect(closedMonthOf(a, "2026-10-20")?.month).toBe("2026-10");
    expect(closedMonthOf(a, "2026-11-02")).toBeUndefined();
  });
});

describe("D-82 대표 확인 · 다시 열기", () => {
  it("대표만 확인한다 (권한) · 마감 뒤 바뀐 것이 있으면 보고 확인했다는 표시가 필요", () => {
    const { db, id } = octDb();
    const c = close(db);
    expect(() => authorize(member("u-manager", "manager"), "confirmMonthClose", { month: "2026-10" }, c, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(member("u-ceo", "ceo"), "confirmMonthClose", { month: "2026-10" }, c, NOW)).not.toThrow();
    expect(() => authorize(member("u-field", "field", { siteIds: [id] }), "closeMonth", { month: "2026-10" }, c, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(member("u-partner", "partner", { partnerSiteIds: [id] }), "reopenMonthClose", { month: "2026-10" }, c, NOW)).toThrow(ForbiddenError);
    const late = submitFieldReport(c, { idempotencyKey: "idem-d82-late-0003", siteId: id, reportDate: "2026-10-30", workDone: "", kind: "cost", reason: "planned", source: "PC", costs: [{ category: "labor", amount: 500_000, forecastImpact: "within_forecast" }] }, ctx("u-manager")).db;
    expect(err(() => confirmMonthClose(late, { month: "2026-10" }, ctx("u-ceo"))).fieldErrors.ackChanges).toBeTruthy();
    expect(err(() => confirmMonthClose(late, { month: "2026-10", ackChanges: "no" as never }, ctx("u-ceo"))).fieldErrors.ackChanges).toBeTruthy();
    expect(err(() => confirmMonthClose(late, { month: "2026-10", ackChanges: 2 }, ctx("u-ceo"))).message).toContain("그 사이");
    const ok = confirmMonthClose(late, { month: "2026-10", ackChanges: 1, note: "명세 확인" }, ctx("u-ceo")).db;
    const rec = currentClose(ok, "2026-10")!;
    expect(rec.confirmedBy).toBe("u-ceo");
    expect(rec.confirmNote).toBe("명세 확인");
    expect(rec.confirmations![0].changes[0]).toContain("원가 들어옴");
    // 확인 뒤엔 확인 때 숫자가 기준 — 바뀐 것 0건
    expect(changesAfterClose(ok, rec, TODAY)).toMatchObject({ count: 0, basis: "confirm" });
    expect(err(() => confirmMonthClose(ok, { month: "2026-10" }, ctx("u-ceo"))).message).toContain("바뀐 것이 없습니다");
    expect(err(() => confirmMonthClose(db, { month: "2026-10" }, ctx("u-ceo"))).message).toContain("아직 마감하지 않았습니다");
  });

  it("다시 열기 — 이유 필수 · 대표가 확인한 마감은 대표만 · 이전 기록은 남고 다시 마감하면 새 숫자", () => {
    const { db, id } = octDb();
    const c = close(db);
    expect(err(() => reopenMonthClose(c, { month: "2026-10", reason: "" }, ctx("u-manager"))).code).toBe("VALIDATION");
    const conf = confirmMonthClose(c, { month: "2026-10" }, ctx("u-ceo")).db;
    expect(err(() => reopenMonthClose(conf, { month: "2026-10", reason: "명세 다시" }, ctx("u-manager"))).message).toContain("대표만");
    expect(err(() => reopenMonthClose(conf, { month: "2026-10", reason: "\u200B\u200B" }, ctx("u-ceo"))).code).toBe("VALIDATION");
    const re = reopenMonthClose(conf, { month: "2026-10", reason: "노무 명세 늦게 옴" }, ctx("u-ceo")).db;
    expect(currentClose(re, "2026-10")).toBeUndefined();
    expect(pastCloses(re, "2026-10")[0]).toMatchObject({ reopenedBy: "u-ceo", reopenReason: "노무 명세 늦게 옴" });
    // 고친 뒤 다시 마감 → 새 숫자
    const fixed = submitFieldReport(re, { idempotencyKey: "idem-d82-late-0004", siteId: id, reportDate: "2026-10-31", workDone: "", kind: "cost", reason: "planned", source: "PC", costs: [{ category: "labor", amount: 3_000_000, forecastImpact: "within_forecast" }] }, ctx("u-manager")).db;
    const again = close(fixed);
    expect(currentClose(again, "2026-10")!.snapshot.sites.find((s) => s.siteId === id)!.costTotal).toBe(8_000_000);
    expect(again.monthCloses!.filter((r) => r.month === "2026-10")).toHaveLength(2);
    expect(changesAfterClose(again, currentClose(again, "2026-10")!, TODAY).count).toBe(0);
    // 공무는 확인 전 마감은 다시 열 수 있다
    expect(() => reopenMonthClose(again, { month: "2026-10", reason: "다시" }, ctx("u-manager"))).not.toThrow();
  });
});

describe("D-82 처리 대기 · 알림 · 보이는 범위", () => {
  it("처리 대기 — 마감 전 → 대표 확인 대기 → 확인(0) · 마감 뒤 바뀐 것 수", () => {
    const { db, id } = octDb();
    const find = (d: DemoDB, k: string) => pendingItems(d, TODAY, true).find((p) => p.key === k);
    expect(closeStatus(db, TODAY)).toMatchObject({ month: "2026-10", state: "open" });
    expect(find(db, "close")).toMatchObject({ n: 1, label: expect.stringContaining("10월 아직 마감 안 함") });
    expect(find(db, "close-change")).toBeUndefined();
    const c = close(db);
    expect(find(c, "close")).toBeUndefined();
    expect(find(c, "close-confirm")).toMatchObject({ n: 1, label: expect.stringContaining("대표 확인 대기") });
    // 공무 화면에는 대표 확인 대기를 세지 않는다
    expect(pendingItems(c, TODAY, true, "manager").find((p) => p.key === "close-confirm")).toBeUndefined();
    expect(find(c, "close-change")).toBeUndefined();
    const late = submitFieldReport(c, { idempotencyKey: "idem-d82-late-0005", siteId: id, reportDate: "2026-10-29", workDone: "", kind: "cost", reason: "planned", source: "PC", costs: [{ category: "material", amount: 700_000, forecastImpact: "within_forecast" }] }, ctx("u-manager")).db;
    expect(find(late, "close-change")?.n).toBe(1);
    const conf = confirmMonthClose(late, { month: "2026-10", ackChanges: 1 }, ctx("u-ceo")).db;
    expect(find(conf, "close")).toBeUndefined();
    expect(find(conf, "close-confirm")).toBeUndefined();
    expect(find(conf, "close-change")).toBeUndefined();
  });

  it("알림 — 마감하면 대표에게 확인 요청(금액 없음) · 확인하면 마감한 사람에게 · 다시 열면 본사에", () => {
    const { db } = octDb();
    const c = close(db);
    const n1 = noticesFor(db, c, "u-manager").find((n) => n.tag === "mcl-2026-10")!;
    expect(n1.to).toEqual(["u-ceo"]);
    expect(n1.title).toContain("대표 확인 요청");
    expect(`${n1.title}${n1.body}`).not.toMatch(/\d+만|원\b/);
    const conf = confirmMonthClose(c, { month: "2026-10" }, ctx("u-ceo")).db;
    expect(noticesFor(c, conf, "u-ceo").find((n) => n.tag === "mcl-2026-10")!.to).toEqual(["u-manager"]);
    const re = reopenMonthClose(conf, { month: "2026-10", reason: "다시" }, ctx("u-ceo")).db;
    expect(noticesFor(conf, re, "u-ceo").find((n) => n.tag === "mcl-2026-10")!.to).toContain("u-manager");
  });

  it("현장·발주처 화면에는 마감 기록이 없다 · 서버 저장 목록에 들어 있다", () => {
    const { db, id } = octDb();
    const c = close(db);
    expect(viewFor(member("u-field", "field", { siteIds: [id] }), c, NOW).monthCloses).toEqual([]);
    expect(viewFor(member("u-partner", "partner", { partnerSiteIds: ["site-a"] }), c, NOW).monthCloses).toEqual([]);
    expect(viewFor(member("u-manager", "manager"), c, NOW).monthCloses).toHaveLength(1);
    expect(Object.keys(COLLECTIONS)).toContain("monthCloses");
  });
});

describe("D-82 점검 반영", () => {
  it("이벤트로 설명되지 않던 숫자 변화도 센다 — 지난달 날짜 기성(월말 미수) · 마감 뒤 들어왔다 취소된 원가는 세지 않는다", () => {
    const { db, id } = octDb();
    const c = close(db);
    const b = addBilling(c, { siteId: id, amount: 10_000_000, billedDate: "2026-09-25" }, ctx("u-manager")).db;
    const ch = changesAfterClose(b, currentClose(b, "2026-10")!, TODAY);
    expect(ch.count).toBeGreaterThanOrEqual(1);
    expect(ch.events.some((e) => e.text.includes("월말 미수에 영향"))).toBe(true);
    // 마감 뒤 들어왔다가 취소된 원가 — 숫자 변화 없음
    const late = submitFieldReport(c, { idempotencyKey: "idem-d82-late-0010", siteId: id, reportDate: "2026-10-30", workDone: "", kind: "cost", reason: "planned", source: "PC", costs: [{ category: "material", amount: 400_000, forecastImpact: "within_forecast" }] }, ctx("u-manager"));
    const v = voidCostEntry(late.db, late.result.entryIds[0], "잘못 넣음", ctx("u-manager")).db;
    expect(changesAfterClose(v, currentClose(v, "2026-10")!, TODAY).count).toBe(0);
  });

  it("대표가 확인한 뒤 바뀌면 — ‘확인 뒤 바뀐 것’만 세고, 다시 열지 않고 대표가 다시 확인 · 대표에게 알림(금액 없음)", () => {
    const { db, id } = octDb();
    const conf = confirmMonthClose(close(db), { month: "2026-10" }, ctx("u-ceo")).db;
    const edited = editCostEntry(conf, "ce-d82-1", { amount: 5_280_000, category: "material", note: "자재" }, ctx("u-manager", new Date("2026-11-14T08:00:00Z"))).db;
    const ch = changesAfterClose(edited, currentClose(edited, "2026-10")!, TODAY);
    expect(ch).toMatchObject({ count: 1, basis: "confirm" });
    expect(pendingItems(edited, TODAY, true, "ceo").find((p) => p.key === "close-change")?.n).toBe(1);
    const n = noticesFor(conf, edited, "u-manager").find((x) => x.tag === "mcl-chg-2026-10")!;
    expect(n.to).toEqual(["u-ceo"]);
    expect(`${n.title}${n.body}`).not.toMatch(/\d+만|원\b/);
    const again = confirmMonthClose(edited, { month: "2026-10", ackChanges: 1 }, ctx("u-ceo")).db;
    const rec = currentClose(again, "2026-10")!;
    expect(rec.confirmations).toHaveLength(2);
    expect(changesAfterClose(again, rec, TODAY).count).toBe(0);
    void id;
  });

  it("확인·다시 열기 알림에 대표 메모·이유를 싣지 않는다 (금액이 들어갈 수 있음)", () => {
    const { db } = octDb();
    const c = close(db);
    const conf = confirmMonthClose(c, { month: "2026-10", note: "동탄 1,200만 다음 달" }, ctx("u-ceo")).db;
    expect(noticesFor(c, conf, "u-ceo").find((x) => x.tag === "mcl-2026-10")!.body).not.toContain("1,200만");
    const re = reopenMonthClose(conf, { month: "2026-10", reason: "명세 3,500,000원 늦게 옴" }, ctx("u-ceo")).db;
    expect(noticesFor(conf, re, "u-ceo").find((x) => x.tag === "mcl-2026-10")!.body).not.toContain("3,500,000");
  });

  it("다시 연 기록은 지문을 비우고 그 달만 최근 10개 — 다른 달의 유효한 마감은 지우지 않는다", () => {
    const { db } = octDb();
    let d = close(db);
    // 9월 마감이 있는 것으로 (다른 달)
    d.monthCloses!.push({ ...structuredClone(currentClose(d, "2026-10")!), id: "mcl-sep", month: "2026-09" });
    for (let i = 0; i < 12; i++) {
      d = reopenMonthClose(d, { month: "2026-10", reason: `다시 ${i}` }, ctx("u-manager")).db;
      d = close(d);
    }
    expect(d.monthCloses!.filter((r) => r.month === "2026-10" && r.reopenedAt)).toHaveLength(10);
    expect(d.monthCloses!.find((r) => r.id === "mcl-sep")).toBeTruthy();
    expect(pastCloses(d, "2026-10").every((r) => r.snapshot.keys.costs.length === 0)).toBe(true);
  });

  it("최근 석 달을 본다 · 앱을 쓰기 전 달은 마감하라고 하지 않는다", () => {
    const { db } = octDb();
    const dec = "2026-12-05";
    const st = closeStatuses(db, dec);
    expect(st.map((s) => s.month)).toContain("2026-10");
    expect(st.map((s) => s.month)).toContain("2026-11");
    // 첫 사용(가장 이른 보고·원가·출퇴근) 전 달은 빠진다
    const first = [...db.reports.map((r) => r.createdAt), ...db.costEntries.filter((e) => e.source !== "SEED" && !e.importBatchId).map((e) => e.createdAt), ...(db.attendance ?? []).map((a) => a.inAt)].sort()[0].slice(0, 7);
    expect(st.every((s) => s.month >= first)).toBe(true);
  });

  it("원가 고치기에서 발생일을 다음 달로 — 본사만 · 정산 건은 안 됨 · ‘다른 달로 옮김’으로 보임", () => {
    const { db, id } = octDb();
    const c = close(db);
    const moved = editCostEntry(c, "ce-d82-1", { amount: 5_000_000, category: "material", note: "자재", date: "2026-11-02" }, ctx("u-manager")).db;
    const e = moved.costEntries.find((x) => x.id === "ce-d82-1")!;
    expect(e.date).toBe("2026-11-02");
    expect(e.editHistory!.at(-1)!.before.date).toBe("2026-10-10");
    expect(changesAfterClose(moved, currentClose(moved, "2026-10")!, TODAY).events.some((x) => x.text.startsWith("원가 다른 달로 옮김"))).toBe(true);
    expect(err(() => editCostEntry(c, "ce-d82-1", { amount: 5_000_000, category: "material", note: "자재", date: "2026-12-31" }, ctx("u-manager"))).fieldErrors.date).toBeTruthy();
    c.costEntries.push({ id: "ce-own", siteId: id, category: "material", amount: 100_000, date: "2026-10-20", forecastImpact: "within_forecast", reason: "planned", note: "x", source: "FIELD", createdBy: "u-field", createdAt: "2026-10-20T01:00:00Z", status: "pending" });
    expect(err(() => editCostEntry(c, "ce-own", { amount: 100_000, category: "material", note: "x", date: "2026-11-01" }, ctx("u-field"))).message).toContain("본사만");
  });

  it("누계 기성이 계약을 넘으면 마감 뒤 바뀐 것 줄에 같이 알린다", () => {
    const { db, id } = octDb();
    const c = close(db);
    const b = addBilling(c, { siteId: id, amount: 130_000_000, billedDate: "2026-10-31" }, ctx("u-manager")).db;
    expect(changesAfterClose(b, currentClose(b, "2026-10")!, TODAY).events.find((e) => e.text.startsWith("기성 들어옴"))!.text).toContain("계약 초과");
  });

  it("본사가 PC로 넣은 보고는 확인한 것으로 · 정산 뒤 승인한 노무비는 ‘더 들어옴’에서 빠진다 · 변경공사 항목에 현장·금액·바로가기", () => {
    const { db, id } = octDb();
    const r = submitFieldReport(db, { idempotencyKey: "idem-d82-pc-000001", siteId: id, reportDate: "2026-10-30", workDone: "본사 입력", source: "PC", reason: "planned", costs: [] }, ctx("u-manager"));
    expect(r.db.reports.find((x) => x.id === r.result.reportId)!.review).toMatchObject({ status: "confirmed", by: "u-manager" });
    const co = monthClose(db, "2026-10", TODAY).items.find((i) => i.kind === "change");
    if (co) {
      expect(co.href).toMatch(/^\/finance#co-/);
      expect(co.text).toMatch(/만 원/);
    }
  });
});
