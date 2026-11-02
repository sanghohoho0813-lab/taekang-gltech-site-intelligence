import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { setCompanySettings } from "@/lib/data/adminCommands";
import { reportCrew } from "@/lib/data/attendanceCommands";
import { CommandError, createPartnerRequest, submitFieldReport } from "@/lib/data/commands";
import { laborAttentionCount, laborEstimate, teamRate } from "@/lib/domain/labor";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-02T03:00:00Z"); // 12:00 KST
const ctx = (userId: string, now = NOW) => ({ userId, now });
const FROM = "2026-10-04";
const TO = "2026-11-02";
const TEAM = "유리 설치팀 (가상 협력업체)";
const site = (db: DemoDB, id = "site-a") => db.sites.find((s) => s.id === id)!;

function laborCost(db: DemoDB, amount: number, key: string, reportDate = TO, siteId = "site-a") {
  return submitFieldReport(db, { idempotencyKey: key, siteId, reportDate, workDone: "유리 시공", costs: [{ category: "labor", amount, forecastImpact: "within_forecast", ...(amount % 300_000 === 0 ? { qty: { manDays: amount / 300_000, dayRate: 300_000 } } : {}) }], reason: "planned" }, ctx("u-field")).db;
}

describe("투입·인건비 추정 (S4)", () => {
  it("출력 인원일 × 기본 일당으로 추정하고, 출력 기록 이전 노무비는 비교에서 뺀다", () => {
    const db = createSeed(NOW);
    const l = laborEstimate(db, site(db), FROM, TO);
    const firstCrew = db.crewChecks!.filter((c) => c.siteId === "site-a").map((c) => c.workDate).sort()[0];
    expect(l.compareFrom).toBe(firstCrew > FROM ? firstCrew : FROM);
    const personDays = l.teams.reduce((a, t) => a + t.personDays, 0);
    expect(personDays).toBeGreaterThan(0);
    expect(l.estimate).toBe(personDays * 300_000);
    expect(l.teams.every((t) => !t.rateSet && t.dayRate === 300_000)).toBe(true);
    // 시드 노무비는 출력 기록 시작 전이라 비교 대상이 아니다 → ‘노무비 입력 없음’
    const before = db.costEntries.filter((e) => e.siteId === "site-a" && e.category === "labor" && e.date < l.compareFrom);
    expect(before.length).toBeGreaterThan(0);
    expect(l.actual).toBe(0);
    expect(l.flags.map((f) => f.kind)).toEqual(expect.arrayContaining(["no_actual", "rate_missing"]));
    expect(laborAttentionCount(db, FROM, TO)).toBeGreaterThanOrEqual(1);
  });

  it("팀 단가를 정하면 그 단가로 계산하고 ‘단가 미설정’ 표시가 사라진다 (대소문자·공백 무시)", () => {
    let db = createSeed(NOW);
    db = setCompanySettings(db, { teamRates: [{ team: `  ${TEAM} `, dayRate: 280_000 }] }, ctx("u-ceo")).db;
    expect(db.settings?.teamRates).toEqual([{ team: TEAM, dayRate: 280_000 }]);
    expect(teamRate(db, TEAM.toUpperCase())).toEqual({ rate: 280_000, set: true });
    const l = laborEstimate(db, site(db), FROM, TO);
    const row = l.teams.find((t) => t.team === TEAM)!;
    expect(row).toMatchObject({ dayRate: 280_000, rateSet: true, estimate: row.personDays * 280_000 });
    expect(l.flags.some((f) => f.kind === "rate_missing" && f.text.includes(TEAM))).toBe(false);
  });

  it("실제 노무비와 비교: 비슷하면 표시 없음, 많이 많으면 ‘실제 > 추정’, 많이 적으면 ‘입력 누락 가능’", () => {
    const db0 = createSeed(NOW);
    const est = laborEstimate(db0, site(db0), FROM, TO).estimate;
    const kinds = (db: DemoDB) => laborEstimate(db, site(db), FROM, TO).flags.map((f) => f.kind);
    expect(kinds(laborCost(db0, est, "k1"))).not.toEqual(expect.arrayContaining(["no_actual"]));
    expect(kinds(laborCost(db0, est, "k1")).some((k) => k === "actual_over" || k === "estimate_over")).toBe(false);
    expect(kinds(laborCost(db0, Math.round(est * 1.5), "k2"))).toContain("actual_over");
    expect(kinds(laborCost(db0, Math.round(est * 0.3), "k3"))).toContain("estimate_over");
  });

  it("출력 기록 없이 노무비만 있으면 ‘출력 기록 없음’으로 확인 요청", () => {
    let db: DemoDB = { ...createSeed(NOW), crewChecks: [] };
    db = laborCost(db, 3_000_000, "k-nc");
    const l = laborEstimate(db, site(db), FROM, TO);
    expect(l.estimate).toBe(0);
    expect(l.flags.map((f) => f.kind)).toContain("no_crew");
  });

  it("공무 확인 대기 노무비는 실제에 포함하되 따로 보여준다", () => {
    let db = createSeed(NOW);
    db = setCompanySettings(db, { costApproval: "review" }, ctx("u-ceo")).db;
    db = laborCost(db, 1_200_000, "k-p");
    const l = laborEstimate(db, site(db), FROM, TO);
    expect(l.actual).toBe(1_200_000);
    expect(l.actualPending).toBe(1_200_000);
    expect(l.reportedManDays).toBe(4);
  });

  it("오늘 새 팀 출력을 올리면 팀별 행이 생긴다", () => {
    let db = createSeed(NOW);
    db = reportCrew(db, { siteId: "site-a", team: "실링팀", kind: "direct", headcount: 3 }, ctx("u-field")).db;
    const row = laborEstimate(db, site(db), FROM, TO).teams.find((t) => t.team === "실링팀")!;
    expect(row).toMatchObject({ kind: "direct", days: 1, personDays: 3, estimate: 900_000 });
  });

  it("팀 단가 입력 검증 — 빈 이름·범위 밖 단가·60개 초과 거부, 다른 설정은 유지", () => {
    let db = createSeed(NOW);
    db = setCompanySettings(db, { attendanceMode: "qr" }, ctx("u-ceo")).db;
    for (const bad of [[{ team: " ", dayRate: 300_000 }], [{ team: "a", dayRate: 5_000 }], [{ team: "a", dayRate: 2_500_000 }], [{ team: "a", dayRate: 300_000.5 }], Array.from({ length: 61 }, (_, i) => ({ team: `t${i}`, dayRate: 300_000 }))])
      expect(() => setCompanySettings(db, { teamRates: bad }, ctx("u-ceo"))).toThrow(CommandError);
    db = setCompanySettings(db, { teamRates: [{ team: "철근팀", dayRate: 250_000 }] }, ctx("u-ceo")).db;
    expect(db.settings).toMatchObject({ attendanceMode: "qr", teamRates: [{ team: "철근팀", dayRate: 250_000 }] });
    db = setCompanySettings(db, { laborDayRate: 320_000 }, ctx("u-ceo")).db;
    expect(db.settings?.teamRates).toEqual([{ team: "철근팀", dayRate: 250_000 }]); // 다른 설정 변경 시 유지
  });
});

describe("고객 견적 문의·주문 요청 (S7)", () => {
  const base = { siteId: "site-a", title: "고정창 추가", description: "내용" };
  const fieldErrors = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as CommandError).fieldErrors;
    }
    throw new Error("거부되지 않음");
  };

  it("견적 문의는 품목이 필수, 주문 요청은 품목·수량이 필수", () => {
    const db = createSeed(NOW);
    expect(fieldErrors(() => createPartnerRequest(db, { ...base, idempotencyKey: "q1", type: "quote" }, ctx("u-partner")))).toHaveProperty("item");
    const e = fieldErrors(() => createPartnerRequest(db, { ...base, idempotencyKey: "o1", type: "order", item: "방화유리" }, ctx("u-partner")));
    expect(e).toHaveProperty("qty");
    expect(e).not.toHaveProperty("item");
    expect(fieldErrors(() => createPartnerRequest(db, { ...base, idempotencyKey: "o2", type: "order", item: "x".repeat(61), qty: "6장" }, ctx("u-partner")))).toHaveProperty("item");
    expect(() => createPartnerRequest(db, { ...base, idempotencyKey: "z", type: "bogus" as never }, ctx("u-partner"))).toThrow(CommandError);
  });

  it("주문 요청이 품목·수량과 함께 접수되고 본사 회신까지 이어진다", () => {
    const db0 = createSeed(NOW);
    const r = createPartnerRequest(db0, { ...base, idempotencyKey: "o3", type: "order", item: " 방화유리 ", qty: " 6장 ", desiredDate: "2026-11-20" }, ctx("u-partner"));
    const req = r.db.partnerRequests.find((x) => x.id === r.result.requestId)!;
    expect(req).toMatchObject({ type: "order", item: "방화유리", qty: "6장", desiredDate: "2026-11-20", status: "received" });
    expect(r.db.activityLogs[0].summary).toContain("주문 요청 접수");
  });

  it("견적·주문이 아닌 유형은 품목·수량을 저장하지 않는다", () => {
    const db0 = createSeed(NOW);
    const r = createPartnerRequest(db0, { ...base, idempotencyKey: "c1", type: "schedule", item: "무시", qty: "무시" }, ctx("u-partner"));
    const req = r.db.partnerRequests.find((x) => x.id === r.result.requestId)!;
    expect(req.item).toBeUndefined();
    expect(req.qty).toBeUndefined();
  });

  it("담당이 아닌 현장에는 요청할 수 없다", () => {
    const db = createSeed(NOW);
    const other = db.sites.find((s) => !db.users.find((u) => u.id === "u-partner")?.partnerSiteIds?.includes(s.id))!;
    expect(() => createPartnerRequest(db, { ...base, siteId: other.id, idempotencyKey: "x1", type: "quote", item: "a" }, ctx("u-partner"))).toThrow(CommandError);
  });
});
