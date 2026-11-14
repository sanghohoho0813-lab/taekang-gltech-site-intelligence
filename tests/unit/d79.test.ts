/** D-79 월 마감을 화면에서 끝내기 — 노무 차액 정산 · 준공 원가 마감 · 이달 원가 CSV · 출퇴근 정정 겹침 막기 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { reviewCostEntry, saveSite, settleLabor, updateForecast } from "@/lib/data/adminCommands";
import { CommandError, submitFieldReport, voidCostEntry } from "@/lib/data/commands";
import { correctAttendance } from "@/lib/data/attendanceCommands";
import { requestAttendanceFix, reviewAttendanceFix } from "@/lib/data/opsCommands";
import { monthBounds, monthClose, monthCostRows, previousMonth } from "@/lib/domain/monthClose";
import { overlappingRecord } from "@/lib/domain/attendance";
import { siteFinancials } from "@/lib/domain/calc";
import { toCsv } from "@/lib/domain/csv";
import { authorize, ForbiddenError, viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { AttendanceRecord, CostCategory, DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-14T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });
const B = { material: 60_000_000, labor: 30_000_000, subcontract: 5_000_000, equipment: 3_000_000, overhead: 2_000_000 };
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });

/** 10월에 착공한 새 현장 + 10월 출력 10일 × 4명(팀 단가 25만) + 10월 노무비 300만 */
function octSite(db0 = createSeed(NOW)) {
  const r = saveSite(db0, { name: "새 현장", shortName: "새현장", workType: "창호", region: "", clientName: "원청", status: "active", startDate: "2026-10-01", endDate: "2026-12-31", fieldUserId: "u-field", contractAmount: 120_000_000, budgets: B, stages: [] } as never, ctx("u-manager", new Date("2026-10-01T00:00:00Z")));
  const id = (r.result as { siteId: string }).siteId;
  const db = r.db;
  db.settings = { ...db.settings!, teamRates: [{ team: "창호팀", dayRate: 250_000 }] };
  db.crewChecks = [
    ...(db.crewChecks ?? []),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `cc-d79-${i}`, siteId: id, workDate: `2026-10-${String(5 + i).padStart(2, "0")}`, team: "창호팀", kind: "direct" as const, headcount: 4, at: `2026-10-${String(5 + i).padStart(2, "0")}T00:00:00Z`, by: "u-field" })),
  ];
  db.costEntries.push({ id: "ce-d79-oct", siteId: id, category: "labor", amount: 3_000_000, date: "2026-10-17", forecastImpact: "within_forecast", reason: "planned", note: "10월 2주 노무비", source: "FIELD", createdBy: "u-field", createdAt: "2026-10-17T09:00:00Z", status: "active" });
  return { db, id };
}
const err = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as CommandError;
  }
  throw new Error("오류가 나야 합니다");
};

describe("D-79 노무 차액 정산", () => {
  it("출력 기준 추정 − 입력된 노무비를 그 달 마지막 날짜로 바로 반영한다 (본사 입력 · 공무 확인 끝난 것으로)", () => {
    const { db, id } = octSite();
    const before = monthClose(db, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(before.estimate).toBe(10_000_000);
    expect(before.actual).toBe(3_000_000);
    expect(before.shortfall).toBe(7_000_000);
    expect(before.canSettle).toBe(true);
    const r = settleLabor(db, { siteId: id, month: "2026-10", amount: 7_000_000, note: "명세 기준", idempotencyKey: "idem-d79-settle-0001" }, ctx("u-manager"));
    const e = r.db.costEntries.find((x) => x.id === r.result.entryId)!;
    expect(e).toMatchObject({ category: "labor", amount: 7_000_000, date: "2026-10-31", status: "active", source: "PC", forecastImpact: "within_forecast", reviewedBy: "u-manager", settle: { month: "2026-10", estimate: 10_000_000, actualBefore: 3_000_000 } });
    expect(e.note).toContain("10월 출력 기준 노무 정산");
    expect(e.note).toContain("명세 기준");
    const after = monthClose(r.db, "2026-10", "2026-11-14");
    const row = after.labor.find((l) => l.site.id === id)!;
    expect(row.actual).toBe(10_000_000);
    expect(row.settled?.id).toBe(e.id);
    expect(row.canSettle).toBe(false);
    expect(after.items.some((i) => i.kind === "labor" && i.text.includes("새현장"))).toBe(false);
    // 10월 금액 표의 노무비에 들어간다
    expect(after.money.find((m) => m.site.id === id)!.cost.labor).toBe(10_000_000);
  });

  it("같은 현장·같은 달은 한 번만 — 되돌리면 다시 넣을 수 있다", () => {
    const { db, id } = octSite();
    const once = settleLabor(db, { siteId: id, month: "2026-10", amount: 7_000_000 }, ctx("u-manager"));
    const e = err(() => settleLabor(once.db, { siteId: id, month: "2026-10", amount: 1_000_000 }, ctx("u-manager")));
    expect(e.code).toBe("STATE");
    expect(e.message).toContain("이미 넣었습니다");
    const voided = voidCostEntry(once.db, once.result.entryId, "금액 잘못", ctx("u-manager")).db;
    expect(() => settleLabor(voided, { siteId: id, month: "2026-10", amount: 6_500_000 }, ctx("u-manager"))).not.toThrow();
  });

  it("같은 요청을 두 번 보내도 한 번만 들어간다 (중복 저장 방지)", () => {
    const { db, id } = octSite();
    const once = settleLabor(db, { siteId: id, month: "2026-10", amount: 7_000_000, idempotencyKey: "idem-d79-dup-000001" }, ctx("u-manager"));
    expect(err(() => settleLabor(once.db, { siteId: id, month: "2026-10", amount: 7_000_000, idempotencyKey: "idem-d79-dup-000001" }, ctx("u-manager"))).code).toMatch(/DUPLICATE|STATE/);
  });

  it("받지 않는 입력 — 0원·아직 오지 않은 달·출력 기록 없는 달·착공 전 달", () => {
    const { db, id } = octSite();
    expect(err(() => settleLabor(db, { siteId: id, month: "2026-10", amount: 0 }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => settleLabor(db, { siteId: id, month: "2026-12", amount: 1_000 }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => settleLabor(db, { siteId: id, month: "2026-13", amount: 1_000 }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => settleLabor(db, { siteId: id, month: "2026-09", amount: 1_000 }, ctx("u-manager"))).code).toBe("STATE");
    const noCrew = { ...db, crewChecks: [] } as DemoDB;
    expect(err(() => settleLabor(noCrew, { siteId: id, month: "2026-10", amount: 1_000 }, ctx("u-manager"))).message).toContain("출력");
  });

  it("본사만 — 현장 직원·발주처는 거절", () => {
    const { db, id } = octSite();
    const args = { siteId: id, month: "2026-10", amount: 7_000_000 };
    expect(() => authorize(member("u-manager", "manager"), "settleLabor", args, db, NOW)).not.toThrow();
    expect(() => authorize(member("u-field", "field", { siteIds: [id] }), "settleLabor", args, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(member("u-partner", "partner", { partnerSiteIds: [id] }), "settleLabor", args, db, NOW)).toThrow(ForbiddenError);
  });

  it("‘닫기 전에 볼 것’ — 끝난 달에 모자라면 정산 버튼, 진행 중인 달에는 띄우지 않는다 · 정산 뒤 같은 달 노무비가 더 들어오면 겹침 확인", () => {
    const { db, id } = octSite();
    const item = monthClose(db, "2026-10", "2026-11-14").items.find((i) => i.kind === "labor" && i.action?.siteId === id);
    expect(item?.action?.kind).toBe("settleLabor");
    expect(item?.text).toContain("700만 원");
    // 10월 31일(아직 안 끝남)에는 항목이 없다 — 버튼은 노무 표에만
    expect(monthClose(db, "2026-10", "2026-10-31").items.some((i) => i.kind === "labor" && i.action?.siteId === id)).toBe(false);
    const settled = settleLabor(db, { siteId: id, month: "2026-10", amount: 7_000_000 }, ctx("u-manager")).db;
    const late = submitFieldReport(settled, { idempotencyKey: "idem-d79-late-000001", siteId: id, reportDate: "2026-10-30", workDone: "", kind: "cost", reason: "planned", costs: [{ category: "labor", amount: 2_000_000, forecastImpact: "within_forecast" }] } as never, ctx("u-field", new Date("2026-11-15T01:00:00Z"))).db;
    const r = monthClose(late, "2026-10", "2026-11-15");
    const row = r.labor.find((l) => l.site.id === id)!;
    expect(row.afterSettle).toEqual({ n: 1, amount: 2_000_000 });
    expect(r.items.some((i) => i.kind === "labor" && i.text.includes("정산") && i.text.includes("겹치지"))).toBe(true);
  });
});

describe("D-79 준공 현장 원가 마감", () => {
  function completed() {
    const { db, id } = octSite();
    const s = db.sites.find((x) => x.id === id)!;
    s.status = "completed";
    s.warranty = { months: 24, completedDate: "2026-10-30", setAt: "2026-10-30T00:00:00Z", setBy: "u-manager" };
    return { db, id };
  }
  it("잔여예상을 0으로 닫으면 이익 변화가 그 달 ‘예상이익을 바꾼 일’에 남고, 준공 원가 항목이 빠진다", () => {
    const { db, id } = completed();
    expect(monthClose(db, "2026-11", "2026-11-14").items.some((i) => i.kind === "settle" && i.action?.siteId === id && i.action.kind === "closeout")).toBe(true);
    const f0 = siteFinancials(db, id);
    const zero = { material: 0, labor: 0, subcontract: 0, equipment: 0, overhead: 0 } as Record<CostCategory, number>;
    const r = updateForecast(db, { siteId: id, remaining: zero, closeout: true }, ctx("u-manager"));
    const f1 = siteFinancials(r.db, id);
    expect(f1.remaining).toBe(0);
    expect(f1.expectedProfit - f0.expectedProfit).toBe(f0.remaining);
    const ch = r.db.forecastChanges![0];
    expect(ch).toMatchObject({ siteId: id, closeout: true, note: "준공 원가 마감", eacBefore: f0.eac, eacAfter: f1.eac });
    const nov = monthClose(r.db, "2026-11", "2026-11-14");
    const p = nov.profit.find((x) => x.site.id === id)!;
    expect(p.events.some((e) => e.amount === f0.remaining && e.text.startsWith("준공 원가 마감"))).toBe(true);
    expect(p.net).toBe(f0.remaining);
  });
  it("받을 청구서만큼 남기고 마감해도 다시 띄우지 않는다", () => {
    const { db, id } = completed();
    const keep = { material: 0, labor: 2_000_000, subcontract: 0, equipment: 0, overhead: 0 } as Record<CostCategory, number>;
    const r = updateForecast(db, { siteId: id, remaining: keep, closeout: true, note: "11월 노무 청구 1건 남음" }, ctx("u-manager"));
    expect(siteFinancials(r.db, id).remaining).toBe(2_000_000);
    expect(monthClose(r.db, "2026-11", "2026-11-14").items.some((i) => i.kind === "settle" && i.action?.siteId === id)).toBe(false);
  });
  it("보통 재추정도 이익이 바뀌면 이력으로 남아 ‘이달 예상이익을 바꾼 일’이 더해서 맞는다 · 바뀌지 않으면 남기지 않는다", () => {
    const db = createSeed(NOW);
    const f0 = siteFinancials(db, "site-a");
    const remaining = Object.fromEntries(f0.categories.map((c) => [c.category, c.remaining])) as Record<CostCategory, number>;
    const same = updateForecast(db, { siteId: "site-a", remaining }, ctx("u-manager"));
    expect(same.db.forecastChanges ?? []).toHaveLength(0);
    const up = updateForecast(db, { siteId: "site-a", remaining: { ...remaining, material: remaining.material + 5_000_000 }, note: "유리 단가 재확인" }, ctx("u-manager"));
    const nov = monthClose(up.db, "2026-11", "2026-11-14").profit.find((x) => x.site.id === "site-a")!;
    expect(nov.events.find((e) => e.text === "잔여예상 재추정 — 유리 단가 재확인")?.amount).toBe(-5_000_000);
  });
  it("재추정 이력(금액)은 현장 직원·발주처에게 보내지 않는다", () => {
    const db = createSeed(NOW);
    const f0 = siteFinancials(db, "site-a");
    const remaining = Object.fromEntries(f0.categories.map((c) => [c.category, c.remaining + 1_000_000])) as Record<CostCategory, number>;
    const r = updateForecast(db, { siteId: "site-a", remaining }, ctx("u-manager")).db;
    expect(r.forecastChanges!.length).toBe(1);
    expect(viewFor(member("u-field", "field", { siteIds: ["site-a"] }), r, NOW).forecastChanges).toEqual([]);
    expect(viewFor(member("u-partner", "partner", { partnerSiteIds: ["site-a"] }), r, NOW).forecastChanges).toEqual([]);
    expect(viewFor(member("u-manager", "manager"), r, NOW).forecastChanges!.length).toBe(1);
  });
});

describe("D-79 이달 원가 CSV", () => {
  it("그 달 원가 전부 — 상태·처음 금액(공무가 고친 것)·공무 메모를 함께", () => {
    const { db, id } = octSite();
    db.settings = { ...db.settings!, costApproval: "review" };
    const sent = submitFieldReport(db, { idempotencyKey: "idem-d79-csv-000001", siteId: id, reportDate: "2026-10-28", workDone: "", kind: "cost", reason: "schedule", costs: [{ category: "equipment", amount: 3_300_000, forecastImpact: "within_forecast", note: "크레인 대기" }] } as never, ctx("u-field", new Date("2026-10-28T09:00:00Z")));
    const entryId = sent.db.costEntries.find((e) => e.amount === 3_300_000)!.id;
    const fixed = reviewCostEntry(sent.db, { entryId, decision: "approve", amount: 3_000_000, note: "세금계산서 기준" }, ctx("u-manager", new Date("2026-10-29T00:00:00Z"))).db;
    const rows = monthCostRows(fixed, "2026-10", "2026-11-14");
    expect(rows[0]).toEqual(["발생일", "현장", "항목", "금액(원)", "성격", "사유", "메모", "입력 경로", "입력한 사람", "상태", "공무 확인", "처음 금액(고치기 전)", "공무 메모·취소 사유"]);
    const crane = rows.find((r) => r[6] === "크레인 대기")!;
    expect(crane[3]).toBe(3_000_000);
    expect(crane[9]).toBe("확정");
    expect(crane[11]).toBe(3_300_000);
    expect(crane[12]).toBe("세금계산서 기준");
    expect(String(crane[10])).toMatch(/^2026-10-29 /);
    // 다른 달 원가는 넣지 않는다
    expect(rows.slice(1).every((r) => String(r[0]).startsWith("2026-10"))).toBe(true);
    // 엑셀 수식 주입 방지 — 메모가 =로 시작해도 글자로
    fixed.costEntries.push({ ...fixed.costEntries.find((e) => e.id === entryId)!, id: "ce-d79-inj", note: "=HYPERLINK(1)" });
    expect(toCsv(monthCostRows(fixed, "2026-10", "2026-11-14"))).toContain("'=HYPERLINK(1)");
  });
});

describe("D-79 출퇴근 정정 — 같은 날 다른 현장 기록과 겹치지 않게", () => {
  const rec = (id: string, siteId: string, inAt: string, outAt?: string): AttendanceRecord => ({ id, siteId, userId: "u-field", workDate: "2026-11-12", inAt, inGeo: { status: "none", reason: "skipped" }, ...(outAt ? { outAt } : {}) });
  function twoSites() {
    const db = createSeed(NOW);
    // 동탄 오전(퇴근을 늦게 눌러 18시) · 판교 오후 13~18시 — 이미 겹쳐 있다
    db.attendance = [rec("att-a", "site-a", "2026-11-12T00:00:00Z", "2026-11-12T09:00:00Z"), rec("att-b", "site-b", "2026-11-12T04:00:00Z", "2026-11-12T09:00:00Z")];
    return db;
  }
  it("겹침을 만드는 정정은 막고, 앞 기록 퇴근을 고쳐 겹침을 푸는 정정은 받는다", () => {
    const db = twoSites();
    // 판교 출근을 12시로 당기면 여전히 동탄과 겹친다 → 막음 (어느 기록과 겹치는지 알려 준다)
    const e = err(() => correctAttendance(db, { attendanceId: "att-b", inAt: "2026-11-12T03:00:00Z", note: "반장 확인" }, ctx("u-manager")));
    expect(e.code).toBe("VALIDATION");
    expect(e.message).toContain("겹칩니다");
    // 동탄 퇴근을 12:30으로 고치면 겹침이 풀린다 → 받음
    const ok = correctAttendance(db, { attendanceId: "att-a", outAt: "2026-11-12T03:30:00Z", note: "오전만 근무 — 반장 확인" }, ctx("u-manager")).db;
    expect(overlappingRecord(ok, ok.attendance!.find((r) => r.id === "att-a")!)).toBeUndefined();
    // 그 뒤에는 판교 출근을 12:40으로 고쳐도 겹치지 않는다
    expect(() => correctAttendance(ok, { attendanceId: "att-b", inAt: "2026-11-12T03:40:00Z", note: "반장 확인" }, ctx("u-manager"))).not.toThrow();
  });
  it("퇴근이 없는 기록도 본다 — 다른 기록의 출근 시각이 고칠 구간 안이면 겹침", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("att-a", "site-a", "2026-11-12T00:00:00Z"), rec("att-b", "site-b", "2026-11-12T04:00:00Z", "2026-11-12T09:00:00Z")];
    expect(err(() => correctAttendance(db, { attendanceId: "att-a", outAt: "2026-11-12T06:00:00Z", note: "퇴근 누락" }, ctx("u-manager"))).message).toContain("겹칩니다");
    expect(() => correctAttendance(db, { attendanceId: "att-a", outAt: "2026-11-12T03:00:00Z", note: "퇴근 누락" }, ctx("u-manager"))).not.toThrow();
  });
  it("근태 수정 요청도 승인하면 겹치게 되는 것은 막는다 (반려하거나 앞 기록을 먼저 고친다)", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("att-a", "site-a", "2026-11-12T00:00:00Z", "2026-11-12T03:30:00Z"), rec("att-b", "site-b", "2026-11-12T04:00:00Z", "2026-11-12T09:00:00Z")];
    // 판교 출근을 ‘11:00’으로 고쳐 달라는 요청 → 동탄(09~12:30)과 겹침
    const asked = requestAttendanceFix(db, { siteId: "site-b", workDate: "2026-11-12", kind: "wrong_time", inTime: "11:00", reason: "출근 시각 잘못 찍힘" }, ctx("u-field")).db;
    const q = asked.attendanceRequests!.at(-1)!;
    const e = err(() => reviewAttendanceFix(asked, { requestId: q.id, decision: "approve" }, ctx("u-manager")));
    expect(e.code).toBe("STATE");
    expect(e.message).toContain("승인하면");
    expect(() => reviewAttendanceFix(asked, { requestId: q.id, decision: "reject", note: "동탄 기록과 겹침 — 확인 필요" }, ctx("u-manager"))).not.toThrow();
  });
});

describe("D-79 해가 바뀌는 달 (12월 → 1월)", () => {
  it("12월 범위·지난달·끝난 달 판단", () => {
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(previousMonth("2027-01-05")).toBe("2026-12");
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    const db = createSeed(NOW);
    expect(monthClose(db, "2026-12", "2027-01-03").ended).toBe(true);
    expect(monthClose(db, "2026-12", "2026-12-31")).toMatchObject({ ended: false, to: "2026-12-31" });
  });
});
