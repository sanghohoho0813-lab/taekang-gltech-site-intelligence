/** D-81 팀별 노무비 — 노무비·외주비에 팀 붙이기 · 팀별 추정 vs 입력 · 메모로 팀 붙이기 · 팀별 노무 정산 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { reviewCostEntry, saveSite, setCostTeams, settleLabor } from "@/lib/data/adminCommands";
import { CommandError, cleanTeam, editCostEntry, submitFieldReport, voidCostEntry } from "@/lib/data/commands";
import { guessTeam, laborEstimate, siteTeams, teamGuesses } from "@/lib/domain/labor";
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

  it("현장 팀 목록은 출력에 나온 팀을 최근 순으로, 회사 단가에만 있는 팀은 뒤에", () => {
    const { db, id } = teamSite();
    db.crewChecks!.push({ id: "cc-late", siteId: id, workDate: "2026-11-02", team: "직영", kind: "direct", headcount: 1, at: "2026-11-02T00:00:00Z", by: "u-field" });
    expect(siteTeams(db, id).map((t) => t.team)).toEqual(["직영", "창호1팀"]);
    expect(siteTeams(db, id, ["창호1팀", "도장팀"]).map((t) => t.team)).toEqual(["직영", "창호1팀", "도장팀"]);
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
    expect(r.otherTeams).toEqual([{ team: "도장팀", amount: 700_000 }]);
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
  it("월 마감의 팀별 기본값 = 추정 − 그 팀 입력 − 팀 미지정분을 추정 비율로 나눈 몫", () => {
    const { db, id } = teamSite();
    const tagged = setCostTeams(db, { items: [{ entryId: "ce-a", team: "창호1팀" }, { entryId: "ce-b", team: "직영" }] }, ctx("u-manager")).db;
    const row = monthClose(tagged, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    // 팀 미지정 100만을 1,120 : 460 으로 나눔 → 약 70.9만 / 29.1만
    const a = row.teamPlan.find((t) => t.team === "창호1팀")!;
    const b = row.teamPlan.find((t) => t.team === "직영")!;
    expect(a.share + b.share).toBe(1_000_000);
    expect(a.share).toBe(Math.round((1_000_000 * 11_200_000) / 15_800_000));
    expect(a.suggest).toBe(11_200_000 - 3_000_000 - a.share);
    expect(b.suggest).toBe(4_600_000 - 2_000_000 - b.share);
    expect(row.suggested).toBe(a.suggest + b.suggest);
    // 팀별 기본값의 합 = 모자란 금액 (팀 미지정 외주비가 없을 때)
    expect(row.suggested).toBe(row.shortfall);
  });

  it("팀 미지정 외주비는 외주 팀 몫에서만 뺀다 · 팀이 붙은 외주비는 그 팀 입력으로", () => {
    const { db, id } = teamSite();
    db.costEntries.push(cost("ce-sub", id, { category: "subcontract", amount: 4_000_000, note: "외주 기성" }));
    const row = monthClose(db, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row.subcontractCovered).toBe(4_000_000);
    const a = row.teamPlan.find((t) => t.team === "창호1팀")!;
    const b = row.teamPlan.find((t) => t.team === "직영")!;
    expect(a.share).toBe(Math.round((6_000_000 * 11_200_000) / 15_800_000) + 4_000_000);
    expect(b.share).toBe(Math.round((6_000_000 * 4_600_000) / 15_800_000));
    // 팀을 붙이면 ‘팀 미지정 외주비’에서 빠지고 그 팀 입력이 된다
    const t = setCostTeams(db, { items: [{ entryId: "ce-sub", team: "창호1팀" }] }, ctx("u-manager")).db;
    const row2 = monthClose(t, "2026-10", "2026-11-14").labor.find((l) => l.site.id === id)!;
    expect(row2.subcontractCovered).toBe(0);
    expect(row2.teamPlan.find((x) => x.team === "창호1팀")!.entered).toBe(4_000_000);
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

  it("회사 설정의 팀 단가에만 있는 팀도 원가에 붙일 수 있다", () => {
    const { db, id } = teamSite();
    db.settings = { ...db.settings!, teamRates: [...db.settings!.teamRates!, { team: "도장팀", dayRate: 250_000 }] };
    expect(siteTeams(db, id, db.settings.teamRates!.map((t) => t.team)).map((t) => t.team)).toContain("도장팀");
    const r = setCostTeams(db, { items: [{ entryId: "ce-c", team: "도장팀" }] }, ctx("u-manager")).db;
    expect(est(r, id).otherTeams).toEqual([{ team: "도장팀", amount: 1_000_000 }]);
  });
});
