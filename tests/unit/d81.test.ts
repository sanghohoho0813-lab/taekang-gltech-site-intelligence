/** D-81 팀별 노무비 — 노무비·외주비에 팀 붙이기 · 팀별 추정 vs 입력 · 메모로 팀 붙이기 · 팀별 노무 정산 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { reviewCostEntry, saveSite, setCostTeams, settleLabor } from "@/lib/data/adminCommands";
import { CommandError, cleanTeam, editCostEntry, submitFieldReport, teamError, tidyName, voidCostEntry } from "@/lib/data/commands";
import { guessTeam, laborEstimate, siteTeams, teamGuesses, untaggedCosts } from "@/lib/domain/labor";
import { monthClose, monthCostRows } from "@/lib/domain/monthClose";
import { authorize, ForbiddenError, viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { CostEntry, DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-14T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });
const B = { material: 60_000_000, labor: 30_000_000, subcontract: 5_000_000, equipment: 3_000_000, overhead: 2_000_000 };
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });

const cost = (id: string, siteId: string, p: Partial<CostEntry>): CostEntry => ({
  id,
  siteId,
  category: "labor",
  amount: 1_000_000,
  date: "2026-10-17",
  forecastImpact: "within_forecast",
  reason: "planned",
  note: "노무비",
  source: "FIELD",
  createdBy: "u-field",
  createdAt: "2026-10-17T09:00:00Z",
  status: "active",
  ...p,
});

/**
 * 10월 새 현장 — 창호1팀(직영 아님 · 외주 28만) 10일 × 4명 = 1,120만, 직영 10일 × 2명(23만) = 460만.
 * 노무비: 창호1팀 메모 300만(팀 없음), 직영 메모 200만(팀 없음), 메모 없는 100만.
 */
function teamSite(db0 = createSeed(NOW)) {
  const r = saveSite(db0, { name: "팀 현장", shortName: "팀현장", workType: "창호", region: "", clientName: "원청", status: "active", startDate: "2026-10-01", endDate: "2026-12-31", fieldUserId: "u-field", contractAmount: 120_000_000, budgets: B, stages: [] } as never, ctx("u-manager", new Date("2026-10-01T00:00:00Z")));
  const id = (r.result as { siteId: string }).siteId;
  const db = r.db;
  db.settings = { ...db.settings!, teamRates: [{ team: "창호1팀", dayRate: 280_000 }, { team: "직영", dayRate: 230_000 }] };
  const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(5 + i).padStart(2, "0")}`);
  db.crewChecks = [
    ...(db.crewChecks ?? []),
    ...days.map((d, i) => ({ id: `cc-d81-a${i}`, siteId: id, workDate: d, team: "창호1팀", kind: "subcontract" as const, headcount: 4, at: `${d}T00:00:00Z`, by: "u-field" })),
    ...days.map((d, i) => ({ id: `cc-d81-b${i}`, siteId: id, workDate: d, team: "직영", kind: "direct" as const, headcount: 2, at: `${d}T00:00:00Z`, by: "u-field" })),
  ];
  db.costEntries.push(
    cost("ce-a", id, { amount: 3_000_000, note: "창호1팀 주간 노무 (4명×5일)" }),
    cost("ce-b", id, { amount: 2_000_000, note: "직영 주간 노무 (2명×5일)" }),
    cost("ce-c", id, { amount: 1_000_000, note: "잡부 일당" }),
  );
  return { db, id, site: () => db.sites.find((s) => s.id === id)! };
}
const err = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as CommandError;
  }
  throw new Error("오류가 나야 합니다");
};
const est = (db: DemoDB, id: string) => laborEstimate(db, db.sites.find((s) => s.id === id)!, "2026-10-01", "2026-10-31");

describe("D-81 팀 이름 다듬기 · 현장 입력", () => {
  it("노무비·외주비만 팀을 남기고 공백을 정리한다 (40자)", () => {
    expect(cleanTeam("labor", "  창호1팀  ")).toBe("창호1팀");
    expect(cleanTeam("subcontract", "창호   2팀")).toBe("창호 2팀");
    expect(cleanTeam("material", "창호1팀")).toBeUndefined();
    expect(cleanTeam("labor", "   ")).toBeUndefined();
    expect(cleanTeam("labor", 3)).toBeUndefined();
    expect(cleanTeam("labor", "가".repeat(60))!.length).toBe(40);
  });

  it("현장 보고의 노무비에 고른 팀이 저장되고, 자재비에 붙인 팀은 버린다", () => {
    const { db, id } = teamSite();
    const r = submitFieldReport(
      db,
      {
        idempotencyKey: "idem-d81-field-00001",
        siteId: id,
        reportDate: "2026-11-13",
        workDone: "",
        kind: "cost",
        reason: "planned",
        costs: [
          { category: "labor", amount: 1_120_000, forecastImpact: "within_forecast", team: "창호1팀" },
          { category: "material", amount: 300_000, forecastImpact: "within_forecast", team: "창호1팀" },
        ],
      },
      ctx("u-field"),
    );
    const [lab, mat] = r.result.entryIds.map((x) => r.db.costEntries.find((e) => e.id === x)!);
    expect(lab.team).toBe("창호1팀");
    expect(mat.team).toBeUndefined();
  });

  it("현장 팀 목록은 최근 30일 인원일이 많은 순 · 회사 단가에만 있는 팀은 그 현장에 출력이 없을 때만", () => {
    const { db, id } = teamSite();
    // 창호1팀 4명×10일 > 직영 2명×10일
    expect(siteTeams(db, id).map((t) => t.team)).toEqual(["창호1팀", "직영"]);
    db.crewChecks!.push(...Array.from({ length: 6 }, (_, i) => ({ id: `cc-late${i}`, siteId: id, workDate: `2026-11-0${i + 1}`, team: "직영", kind: "direct" as const, headcount: 5, at: "2026-11-01T00:00:00Z", by: "u-field" })));
    expect(siteTeams(db, id).map((t) => t.team)).toEqual(["직영", "창호1팀"]);
    // 다른 현장 팀(회사 단가)은 섞지 않는다
    expect(siteTeams(db, id, ["창호1팀", "도장팀"]).map((t) => t.team)).toEqual(["직영", "창호1팀"]);
    expect(siteTeams(db, "site-empty", ["도장팀"]).map((t) => t.team)).toEqual(["도장팀"]);
  });

  it("팀 이름은 글자 단위로 다듬는다 — 이모지 반쪽·폭 없는 문자 없이, 40자 넘으면 오류", () => {
    expect(tidyName("가".repeat(39) + "😀😀", 40)).toBe("가".repeat(39) + "😀");
    expect(tidyName("창호1팀\u200B", 40)).toBe("창호1팀");
    expect(tidyName("A\uD83D", 40)).toBe("A");
    expect(teamError("가".repeat(41))).toContain("40자");
    expect(teamError("가".repeat(39) + "😀")).toBeUndefined();
    expect(teamError(123)).toBeTruthy();
    expect(teamError({ a: 1 })).toBeTruthy();
    expect(teamError(null)).toBeUndefined();
    const { db, id } = teamSite();
    const e = err(() =>
      submitFieldReport(db, { idempotencyKey: "idem-d81-emoji-0001", siteId: id, reportDate: "2026-11-13", workDone: "", kind: "cost", reason: "planned", costs: [{ category: "labor", amount: 10_000, forecastImpact: "additional", team: "가".repeat(39) + "😀😀" }] }, ctx("u-field")),
    );
    expect(e.fieldErrors["costs.0.team"]).toContain("40자");
    expect(err(() => setCostTeams(db, { items: [{ entryId: "ce-a", team: 123 as never }] }, ctx("u-manager"))).code).toBe("VALIDATION");
    db.costEntries.push(cost("ce-pend", id, { status: "pending", team: "창호1팀" }));
    expect(err(() => reviewCostEntry(db, { entryId: "ce-pend", decision: "approve", team: { a: 1 } as never }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => editCostEntry(db, "ce-a", { amount: 3_000_000, category: "labor", note: "x", team: 5 as never }, ctx("u-manager"))).code).toBe("VALIDATION");
  });
});

describe("D-81 팀별 추정 vs 입력", () => {
  it("팀이 없으면 ‘팀 미지정’으로 모이고, 팀을 붙이면 그 팀 입력으로 간다", () => {
    const { db, id } = teamSite();
    const before = est(db, id);
    expect(before.teams.map((t) => [t.team, t.estimate, t.entered])).toEqual([
      ["창호1팀", 11_200_000, 0],
      ["직영", 4_600_000, 0],
    ]);
    expect(before.untagged).toBe(6_000_000);
    const tagged = setCostTeams(db, { items: [{ entryId: "ce-a", team: "창호1팀" }, { entryId: "ce-b", team: "직영" }] }, ctx("u-manager")).db;
    const after = est(tagged, id);
    expect(after.teams.find((t) => t.team === "창호1팀")!.entered).toBe(3_000_000);
    expect(after.teams.find((t) => t.team === "직영")!.entered).toBe(2_000_000);
    expect(after.untagged).toBe(1_000_000);
    // 합계(입력된 노무비)는 팀을 붙여도 그대로
    expect(after.actual).toBe(before.actual);
  });

  it("팀 이름은 대소문자·앞뒤 공백을 가리지 않고, 출력에 없는 팀은 따로 보인다", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-x", id, { amount: 500_000, team: " 창호1팀 " }), cost("ce-y", id, { amount: 700_000, team: "도장팀" }));
    const r = est(db, id);
    expect(r.teams.find((t) => t.team === "창호1팀")!.entered).toBe(500_000);
    expect(r.otherTeams).toEqual([{ team: "도장팀", amount: 700_000, category: "labor" }]);
  });

  it("확인 대기 노무비는 팀 입력에 넣되 대기 금액을 따로 센다", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-p", id, { amount: 400_000, team: "직영", status: "pending" }));
    const t = est(db, id).teams.find((x) => x.team === "직영")!;
    expect(t.entered).toBe(400_000);
    expect(t.enteredPending).toBe(400_000);
  });

  it("외주 팀은 그 팀 이름이 붙은 외주비도 입력으로 센다 — 직영 팀에 붙인 외주비는 세지 않는다", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-s1", id, { category: "subcontract", amount: 5_000_000, team: "창호1팀" }), cost("ce-s2", id, { category: "subcontract", amount: 900_000, team: "직영" }));
    const r = est(db, id);
    expect(r.teams.find((t) => t.team === "창호1팀")!.entered).toBe(5_000_000);
    expect(r.teams.find((t) => t.team === "직영")!.entered).toBe(0);
    // 입력된 노무비 합계는 노무비만
    expect(r.actual).toBe(6_000_000);
  });
});

describe("D-81 메모로 팀 붙이기", () => {
  it("메모에 팀 이름이 하나만 있을 때만 그 팀 — 둘이거나 없으면 모름", () => {
    const teams = [{ team: "창호1팀" }, { team: "직영" }, { team: "창호1팀장" }];
    expect(guessTeam("창호1팀 주간 노무", [{ team: "창호1팀" }, { team: "직영" }])).toBe("창호1팀");
    expect(guessTeam("창호1팀·직영 같이", [{ team: "창호1팀" }, { team: "직영" }])).toBeUndefined();
    expect(guessTeam("잡부 일당", teams)).toBeUndefined();
    // 긴 이름이 짧은 이름을 품으면 긴 이름 하나
    expect(guessTeam("창호1팀장 수당", teams)).toBe("창호1팀장");
  });

  it("팀이 없는 노무비·외주비 중 메모로 알 수 있는 것만 — 정산·취소 건은 빼고", () => {
    const { db, id } = teamSite();
    db.costEntries.push(
      cost("ce-v", id, { note: "창호1팀 추가", status: "voided" }),
      cost("ce-t", id, { note: "직영 추가", team: "직영" }),
      cost("ce-m", id, { category: "material", note: "창호1팀 자재" }),
      cost("ce-s", id, { category: "subcontract", note: "창호1팀 외주 기성" }),
    );
    const g = teamGuesses(db, id, "2026-10-01", "2026-10-31");
    expect(g.map((x) => [x.entryId, x.team]).sort()).toEqual([
      ["ce-a", "창호1팀"],
      ["ce-b", "직영"],
      ["ce-s", "창호1팀"],
    ]);
  });

  it("한 번에 붙이기 — 본사만 · 금액은 그대로 · 활동 이력에 남는다", () => {
    const { db, id } = teamSite();
    const g = teamGuesses(db, id);
    const r = setCostTeams(db, { items: g.map((x) => ({ entryId: x.entryId, team: x.team })), idempotencyKey: "idem-d81-tag-000001" }, ctx("u-manager"));
    expect(r.result.updated).toBe(2);
    expect(r.db.costEntries.find((e) => e.id === "ce-a")).toMatchObject({ team: "창호1팀", amount: 3_000_000 });
    expect(r.db.activityLogs.some((a) => a.summary.includes("2건에 팀 표시"))).toBe(true);
    expect(teamGuesses(r.db, id)).toEqual([]);
    // 같은 요청 두 번은 막힌다
    expect(err(() => setCostTeams(r.db, { items: [{ entryId: "ce-a", team: "직영" }], idempotencyKey: "idem-d81-tag-000001" }, ctx("u-manager"))).code).toBe("DUPLICATE");
    // 빈 팀이면 지운다
    expect(setCostTeams(r.db, { items: [{ entryId: "ce-a", team: null }] }, ctx("u-manager")).db.costEntries.find((e) => e.id === "ce-a")!.team).toBeUndefined();
  });

  it("자재비·정산 건·취소 건·없는 원가·중복·빈 목록은 받지 않는다", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-m", id, { category: "material" }), cost("ce-v", id, { status: "voided" }), cost("ce-st", id, { settle: { month: "2026-10", estimate: 1, actualBefore: 0 } }));
    expect(err(() => setCostTeams(db, { items: [{ entryId: "ce-m", team: "직영" }] }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => setCostTeams(db, { items: [{ entryId: "ce-v", team: "직영" }] }, ctx("u-manager"))).code).toBe("STATE");
    expect(err(() => setCostTeams(db, { items: [{ entryId: "ce-st", team: "직영" }] }, ctx("u-manager"))).code).toBe("STATE");
    expect(err(() => setCostTeams(db, { items: [{ entryId: "nope", team: "직영" }] }, ctx("u-manager"))).code).toBe("NOT_FOUND");
    expect(err(() => setCostTeams(db, { items: [{ entryId: "ce-a", team: "직영" }, { entryId: "ce-a", team: "창호1팀" }] }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => setCostTeams(db, { items: [] }, ctx("u-manager"))).code).toBe("VALIDATION");
  });

  it("권한 — 본사만 팀을 한 번에 붙인다 (현장·원청은 막힘)", () => {
    const { db, id } = teamSite();
    const args = { items: [{ entryId: "ce-a", team: "창호1팀" }] };
    expect(() => authorize(member("u-manager", "manager"), "setCostTeams", args, db, NOW)).not.toThrow();
    expect(() => authorize(member("u-field", "field", { siteIds: [id] }), "setCostTeams", args, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(member("u-partner", "partner", { partnerSiteIds: [id] }), "setCostTeams", args, db, NOW)).toThrow(ForbiddenError);
  });
});

describe("D-81 공무 확인 · 원가 고치기에서 팀", () => {
  it("공무 확인 승인 때 팀을 붙이거나 고친다", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-r", id, { status: "pending", note: "창호1팀 노무" }));
    const r = reviewCostEntry(db, { entryId: "ce-r", decision: "approve", team: "창호1팀" }, ctx("u-manager"));
    expect(r.db.costEntries.find((e) => e.id === "ce-r")).toMatchObject({ status: "active", team: "창호1팀" });
    // 팀을 보내지 않으면 그대로
    db.costEntries.push(cost("ce-r2", id, { status: "pending", team: "직영" }));
    expect(reviewCostEntry(db, { entryId: "ce-r2", decision: "approve" }, ctx("u-manager")).db.costEntries.find((e) => e.id === "ce-r2")!.team).toBe("직영");
  });

  it("원가 고치기 — 팀 바꾸기·지우기, 자재비로 바꾸면 팀이 지워진다", () => {
    const { db } = teamSite();
    const base = { amount: 3_000_000, category: "labor" as const, note: "창호1팀 주간 노무" };
    const a = editCostEntry(db, "ce-a", { ...base, team: "창호1팀" }, ctx("u-manager")).db;
    expect(a.costEntries.find((e) => e.id === "ce-a")!.team).toBe("창호1팀");
    const b = editCostEntry(a, "ce-a", { ...base, team: null }, ctx("u-manager")).db;
    expect(b.costEntries.find((e) => e.id === "ce-a")!.team).toBeUndefined();
    const c = editCostEntry(a, "ce-a", { ...base, category: "material" }, ctx("u-manager")).db;
    expect(c.costEntries.find((e) => e.id === "ce-a")!.team).toBeUndefined();
  });
});

describe("D-81 팀별 노무 정산", () => {
  it("월 마감의 팀별 기본값 = 남은 필요액(추정 − 그 팀 입력)에서 팀 미지정분을 필요액 비율로 나눈 몫을 뺀 값 · 합 = 모자람", () => {
    const { db, id } = teamSite();
    const tagged = setCostTeams(db, { items: [{ entryId: "ce-a", team: "창호1팀" }, { entryId: "ce-b", team: "직영" }] }, ctx("u-manager")).db;
    const row = monthClose(tagged, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    // 필요액: 창호1팀 1,120 − 300 = 820만, 직영 460 − 200 = 260만 · 팀 미지정 100만을 820 : 260으로 나눔
    const a = row.teamPlan.find((t) => t.team === "창호1팀")!;
    const b = row.teamPlan.find((t) => t.team === "직영")!;
    expect(a.share + b.share).toBe(1_000_000);
    expect(a.share).toBe(Math.round((1_000_000 * 8_200_000) / 10_800_000));
    expect(a.suggest).toBe(Math.round((8_200_000 - (1_000_000 * 8_200_000) / 10_800_000) / 1000) * 1000);
    expect(row.suggested).toBe(a.suggest + b.suggest);
    // 천 원 단위로 맞춘 값 — 합은 모자람과 천 원 안쪽
    expect(a.suggest % 1000).toBe(0);
    expect(Math.abs(row.suggested - row.shortfall)).toBeLessThanOrEqual(1000);
    expect(row.planOver).toBe(0);
  });

  it("이미 다 찬 팀이 있어도 팀 미지정분이 버려지지 않는다 — 기본값 합이 모자람을 넘지 않음 (D-81 점검 M4)", () => {
    const { db, id } = teamSite();
    // 노무비를 모두 직영으로 → 직영 600만 입력(추정 460만, 140만 넘침) · 창호1팀 0
    const t = setCostTeams(db, { items: ["ce-a", "ce-b", "ce-c"].map((entryId) => ({ entryId, team: "직영" })) }, ctx("u-manager")).db;
    const row = monthClose(t, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row.shortfall).toBe(15_800_000 - 6_000_000);
    expect(row.teamPlan.find((x) => x.team === "직영")!.suggest).toBe(0);
    expect(row.teamPlan.find((x) => x.team === "창호1팀")!.suggest).toBe(11_200_000);
    // 팀별 합(1,120만)이 현장 모자람(980만)보다 140만 큼 → 확인하라고 알린다
    expect(row.planOver).toBe(1_400_000);
    // 팀 미지정 100만이 직영(이미 참)에 가지 않고 창호1팀에서 빠진다
    const u = setCostTeams(db, { items: [{ entryId: "ce-a", team: "직영" }, { entryId: "ce-b", team: "직영" }] }, ctx("u-manager")).db;
    const row2 = monthClose(u, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row2.teamPlan.find((x) => x.team === "창호1팀")!.suggest).toBe(11_200_000 - 1_000_000);
  });

  it("출력에 없는 이름의 노무비도 팀별 기본값에서 뺀다 (D-81 점검 M2 — 두 번 넣던 문제)", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-o1", id, { amount: 1_100_000, team: "창호1 팀" }), cost("ce-o2", id, { amount: 1_200_000, team: "창호1팀(외주)" }));
    const row = monthClose(db, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row.otherTeams.map((o) => o.team).sort()).toEqual(["창호1 팀", "창호1팀(외주)"]);
    expect(Math.abs(row.suggested - row.shortfall)).toBeLessThanOrEqual(1000);
  });

  it("외주비 — 외주 팀 이름이 붙으면 그 팀 입력, 팀이 없으면 외주 팀 남은 추정만큼, 직영·없는 이름이면 따로 보이고 비교에서 뺀다 · 모든 숫자가 같은 ‘입력’", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-sub", id, { category: "subcontract", amount: 4_000_000, note: "외주 기성" }));
    const l0 = est(db, id);
    expect(l0.subUntagged).toBe(4_000_000);
    expect(l0.subCovered).toBe(4_000_000);
    expect(l0.compared).toBe(6_000_000 + 4_000_000);
    const row = monthClose(db, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row.subcontractCovered).toBe(4_000_000);
    expect(row.shortfall).toBe(15_800_000 - 10_000_000);
    expect(Math.abs(row.suggested - row.shortfall)).toBeLessThanOrEqual(1000);
    // 팀을 붙여도 입력·모자람은 그대로 (팀 행으로 옮겨 갈 뿐)
    const t = setCostTeams(db, { items: [{ entryId: "ce-sub", team: "창호1팀" }] }, ctx("u-manager")).db;
    const l1 = est(t, id);
    expect(l1.subTagged).toBe(4_000_000);
    expect(l1.teams.find((x) => x.team === "창호1팀")!.entered).toBe(4_000_000);
    expect(l1.compared).toBe(l0.compared);
    const row1 = monthClose(t, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row1.shortfall).toBe(row.shortfall);
    // 직영 팀·없는 이름이 붙은 외주비는 사라지지 않고 따로 보인다 (비교에서는 뺌)
    const d = setCostTeams(db, { items: [{ entryId: "ce-sub", team: "직영" }] }, ctx("u-manager")).db;
    const l2 = est(d, id);
    expect(l2.otherTeams).toEqual([{ team: "직영", amount: 4_000_000, category: "subcontract" }]);
    expect(l2.compared).toBe(6_000_000);
    expect(l2.teams.find((x) => x.team === "직영")!.entered).toBe(0);
  });

  it("외주비가 외주 팀 몫을 다 채우면 정산 항목·버튼이 사라진다 (D-80부터 남던 지울 수 없는 항목)", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-sub", id, { category: "subcontract", amount: 11_200_000, team: "창호1팀" }), cost("ce-d", id, { amount: 4_600_000 - 2_000_000, team: "직영" }));
    const t = setCostTeams(db, { items: [{ entryId: "ce-b", team: "직영" }, { entryId: "ce-a", team: "창호1팀" }, { entryId: "ce-c", team: "창호1팀" }] }, ctx("u-manager")).db;
    const c = monthClose(t, "2026-10", "2026-11-14");
    const row = c.labor.find((l) => l.site.id === id)!;
    expect(row.shortfall).toBeLessThanOrEqual(0);
    expect(row.canSettle).toBe(false);
    expect(c.items.some((i) => i.kind === "labor" && i.action?.siteId === id)).toBe(false);
  });

  it("팀별로 나눠 정산하면 팀마다 입력에 더해지고, 원가 목록·CSV에 팀이 남는다", () => {
    const { db, id } = teamSite();
    const tagged = setCostTeams(db, { items: [{ entryId: "ce-a", team: "창호1팀" }, { entryId: "ce-b", team: "직영" }, { entryId: "ce-c", team: "직영" }] }, ctx("u-manager")).db;
    const r = settleLabor(tagged, { siteId: id, month: "2026-10", amount: 9_800_000, teams: [{ team: "창호1팀", amount: 8_200_000 }, { team: "직영", amount: 1_600_000 }], note: "명세 기준", idempotencyKey: "idem-d81-settle-00001" }, ctx("u-manager"));
    const e = r.db.costEntries.find((x) => x.id === r.result.entryId)!;
    expect(e.settle!.teams).toEqual([
      { team: "창호1팀", amount: 8_200_000 },
      { team: "직영", amount: 1_600_000 },
    ]);
    expect(e.note).toContain("창호1팀 820만");
    const l = est(r.db, id);
    expect(l.teams.find((t) => t.team === "창호1팀")!.entered).toBe(11_200_000);
    expect(l.teams.find((t) => t.team === "직영")!.entered).toBe(4_600_000);
    expect(l.untagged).toBe(0);
    const rows = monthCostRows(r.db, "2026-10", "2026-11-14");
    expect(rows[0]).toContain("팀");
    const teamCol = rows[0].indexOf("팀");
    expect(rows.find((x) => x.includes("명세 기준") || String(x).includes("노무 정산"))?.[teamCol]).toContain("창호1팀");
  });

  it("팀별 금액의 합이 넣을 금액과 다르거나 같은 팀이 두 번이면 막는다", () => {
    const { db, id } = teamSite();
    const base = { siteId: id, month: "2026-10", amount: 5_000_000, note: "명세 기준" };
    expect(err(() => settleLabor(db, { ...base, teams: [{ team: "창호1팀", amount: 4_000_000 }] }, ctx("u-manager"))).fieldErrors.teams).toContain("합");
    expect(err(() => settleLabor(db, { ...base, teams: [{ team: "창호1팀", amount: 2_500_000 }, { team: " 창호1팀", amount: 2_500_000 }] }, ctx("u-manager"))).fieldErrors.teams).toContain("두 번");
    expect(err(() => settleLabor(db, { ...base, teams: [{ team: "  ", amount: 5_000_000 }] }, ctx("u-manager"))).fieldErrors.teams).toBeTruthy();
    // 팀 없이 한 금액으로 넣는 것도 그대로 된다 (D-79 방식)
    expect(() => settleLabor(db, base, ctx("u-manager"))).not.toThrow();
  });

  it("팀별 정산 건은 금액을 고칠 수 없고(되돌린 뒤 다시), 팀을 따로 붙이지 않는다", () => {
    const { db, id } = teamSite();
    const r = settleLabor(db, { siteId: id, month: "2026-10", amount: 5_000_000, teams: [{ team: "창호1팀", amount: 5_000_000 }], note: "명세 기준" }, ctx("u-manager"));
    const eid = r.result.entryId;
    const e = r.db.costEntries.find((x) => x.id === eid)!;
    expect(err(() => editCostEntry(r.db, eid, { amount: 4_000_000, category: "labor", note: e.note }, ctx("u-manager"))).fieldErrors.amount).toBeTruthy();
    // 메모만 고치는 것은 된다 · 팀을 보내도 무시
    const ok = editCostEntry(r.db, eid, { amount: 5_000_000, category: "labor", note: "메모 고침", team: "직영" }, ctx("u-manager")).db;
    expect(ok.costEntries.find((x) => x.id === eid)!.team).toBeUndefined();
    expect(est(ok, id).teams.find((t) => t.team === "창호1팀")!.entered).toBe(5_000_000);
    // 되돌리면 팀 입력에서도 빠진다
    const v = voidCostEntry(r.db, eid, "다시 넣기", ctx("u-manager")).db;
    expect(est(v, id).teams.find((t) => t.team === "창호1팀")!.entered).toBe(0);
  });
});

describe("D-81 화면에 보이는 범위", () => {
  it("원청 화면에는 원가가 없다 · 현장은 자기가 넣은 원가의 팀만 본다", () => {
    const { db, id } = teamSite();
    const t = setCostTeams(db, { items: [{ entryId: "ce-a", team: "창호1팀" }] }, ctx("u-manager")).db;
    expect(viewFor(member("u-partner", "partner", { partnerSiteIds: [id] }), t, NOW).costEntries).toEqual([]);
    const field = viewFor(member("u-field", "field", { siteIds: [id] }), t, NOW).costEntries;
    expect(field.every((e) => e.createdBy === "u-field")).toBe(true);
  });

  it("회사 설정의 팀 단가에만 있는 팀 이름도 붙일 수 있고, 출력에 없으면 따로 보인다", () => {
    const { db, id } = teamSite();
    const r = setCostTeams(db, { items: [{ entryId: "ce-c", team: "도장팀" }] }, ctx("u-manager")).db;
    expect(est(r, id).otherTeams).toEqual([{ team: "도장팀", amount: 1_000_000, category: "labor" }]);
  });
});

describe("D-81 점검 반영", () => {
  it("메모 짐작 — ‘비직영’·‘직영 아님’은 세지 않고, 긴 이름 안의 짧은 이름은 따로 나올 때만", () => {
    const teams = [{ team: "창호1팀" }, { team: "직영" }, { team: "창호1팀장" }, { team: "창호2팀" }];
    expect(guessTeam("비직영 인력", teams)).toBeUndefined();
    expect(guessTeam("직영 아님 — 창호2팀 노무", teams)).toBe("창호2팀");
    expect(guessTeam("창호1팀장 지시로 창호1팀 투입", teams)).toBeUndefined();
    expect(guessTeam("창호1팀장 수당", teams)).toBe("창호1팀장");
  });

  it("팀 붙이기 목록 — 팀 없는 건과 맞지 않는 이름(띄어쓰기·괄호)·외주비에 붙은 직영까지, 외주비는 외주 팀만 고른다", () => {
    const { db, id } = teamSite();
    db.costEntries.push(
      cost("ce-o1", id, { amount: 1_100_000, team: "창호1 팀" }),
      cost("ce-s1", id, { category: "subcontract", amount: 2_000_000, team: "직영", note: "직영 보조 외주" }),
      cost("ce-s2", id, { category: "subcontract", amount: 500_000, note: "폐기물 반출" }),
      cost("ce-ok", id, { amount: 300_000, team: "창호1팀" }),
    );
    const u = untaggedCosts(db, id, "2026-10-01", "2026-10-31");
    const by = Object.fromEntries(u.map((x) => [x.entryId, x]));
    expect(by["ce-ok"]).toBeUndefined();
    expect(by["ce-o1"]).toMatchObject({ current: "창호1 팀", guess: "창호1팀" });
    expect(by["ce-s1"]).toMatchObject({ current: "직영", options: ["창호1팀"] });
    expect(by["ce-s1"].guess).toBeUndefined();
    expect(by["ce-s2"]).toMatchObject({ options: ["창호1팀"] });
    expect(by["ce-a"]).toMatchObject({ guess: "창호1팀", options: ["창호1팀", "직영"] });
    // 메모로 짐작한 것(teamGuesses)은 팀이 없는 건만
    expect(teamGuesses(db, id).map((g) => g.entryId).sort()).toEqual(["ce-a", "ce-b"]);
  });

  it("팀별 정산 — 음수·형식 오류 줄은 조용히 버리지 않고 막는다 · 출력에 없는 팀은 받지 않는다 · 0원 줄은 뺀다", () => {
    const { db, id } = teamSite();
    const base = { siteId: id, month: "2026-10", amount: 1_000_000, note: "명세 기준" };
    expect(err(() => settleLabor(db, { ...base, teams: [{ team: "창호1팀", amount: 1_000_000 }, { team: "직영", amount: -5 }] }, ctx("u-manager"))).fieldErrors.teams).toBeTruthy();
    expect(err(() => settleLabor(db, { ...base, teams: [null, 5, "x"] as never }, ctx("u-manager"))).fieldErrors.teams).toBeTruthy();
    expect(err(() => settleLabor(db, { ...base, teams: [{ team: "유령팀", amount: 1_000_000 }] }, ctx("u-manager"))).message).toContain("유령팀");
    expect(err(() => settleLabor(db, { ...base, teams: Array.from({ length: 31 }, (_, i) => ({ team: `팀${i}`, amount: 0 })) }, ctx("u-manager"))).fieldErrors.teams).toContain("30개");
    const ok = settleLabor(db, { ...base, teams: [{ team: "창호1팀", amount: 1_000_000 }, { team: "직영", amount: 0 }] }, ctx("u-manager"));
    expect(ok.db.costEntries.find((e) => e.id === ok.result.entryId)!.settle!.teams).toEqual([{ team: "창호1팀", amount: 1_000_000 }]);
  });

  it("정산 기준은 ‘노무비 + 외주 팀 외주비’ — 정산 메모·정산 전 입력에 같은 숫자", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-sub", id, { category: "subcontract", amount: 4_000_000, team: "창호1팀" }));
    const r = settleLabor(db, { siteId: id, month: "2026-10", amount: 5_800_000, note: "명세 기준" }, ctx("u-manager"));
    const e = r.db.costEntries.find((x) => x.id === r.result.entryId)!;
    expect(e.settle!.actualBefore).toBe(10_000_000);
    expect(e.note).toContain("외주비 400만 원 포함");
    const row = monthClose(r.db, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row.shortfall).toBe(0);
    expect(row.reShort).toBe(0);
  });

  it("일부 팀만 정산하면 남은 팀 차이를 월 마감 줄에 남긴다", () => {
    const { db, id } = teamSite();
    const t = setCostTeams(db, { items: [{ entryId: "ce-a", team: "창호1팀" }, { entryId: "ce-b", team: "직영" }, { entryId: "ce-c", team: "직영" }] }, ctx("u-manager")).db;
    const r = settleLabor(t, { siteId: id, month: "2026-10", amount: 1_600_000, teams: [{ team: "직영", amount: 1_600_000 }], note: "직영만 명세 옴" }, ctx("u-manager"));
    const row = monthClose(r.db, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row.teamLeft).toEqual([{ team: "창호1팀", amount: 8_200_000 }]);
  });

  it("팀을 바꾼 사실이 원가 이력·활동 이력에 남는다", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-r", id, { status: "pending", team: "창호1팀" }));
    const r = reviewCostEntry(db, { entryId: "ce-r", decision: "approve", team: "직영" }, ctx("u-manager")).db;
    const e = r.costEntries.find((x) => x.id === "ce-r")!;
    expect(e.editHistory?.at(-1)?.before.team).toBe("창호1팀");
    expect(r.activityLogs[0].summary).toContain("팀 창호1팀 → 직영");
    const t = setCostTeams(r, { items: [{ entryId: "ce-r", team: "창호1팀" }] }, ctx("u-manager")).db;
    expect(t.costEntries.find((x) => x.id === "ce-r")!.editHistory?.at(-1)?.before.team).toBe("직영");
  });

  it("이달 원가 CSV — 팀별로 나눈 정산은 팀마다 한 줄 (금액 합은 그 건과 같음)", () => {
    const { db, id } = teamSite();
    const r = settleLabor(db, { siteId: id, month: "2026-10", amount: 5_000_000, teams: [{ team: "창호1팀", amount: 3_000_000 }, { team: "직영", amount: 2_000_000 }], note: "명세 기준" }, ctx("u-manager"));
    const rows = monthCostRows(r.db, "2026-10", "2026-11-14");
    const teamCol = rows[0].indexOf("팀");
    const amtCol = rows[0].indexOf("금액(원)");
    const settleRows = rows.filter((x) => String(x[rows[0].indexOf("메모")]).includes("[팀별"));
    expect(settleRows.map((x) => [x[teamCol], x[amtCol]])).toEqual([
      ["창호1팀", 3_000_000],
      ["직영", 2_000_000],
    ]);
  });
});
