import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { submitFieldReport } from "@/lib/data/commands";
import { reportCrew } from "@/lib/data/attendanceCommands";
import { createWorkOrder, workOrderStep } from "@/lib/data/opsCommands";
import { dailyLog, weekStart, weeklyLog } from "@/lib/domain/dailylog";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-04T08:00:00Z"); // 수 17:00 KST
const TODAY = "2026-11-04";
const ctx = (userId: string, now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function today(db0: DemoDB) {
  let db = db0;
  const site = db.sites.find((s) => s.id === "site-a")!;
  const stage = site.stages.find((s) => s.progressPct < 100)!;
  db = submitFieldReport(
    db,
    {
      idempotencyKey: "k-d1",
      siteId: "site-a",
      reportDate: TODAY,
      workDone: "3층 남측 커튼월 유닛 8개 설치",
      issues: "크레인 대기 40분",
      tomorrowPlan: "4층 앵커 설치",
      photos: [{ dataUrl: JPG, caption: "3층 남측" }],
      stageProgress: [{ stageId: stage.id, progressPct: Math.min(100, stage.progressPct + 5) }],
      costs: [
        { category: "material", amount: 1_200_000, forecastImpact: "within_forecast", note: "실링재 추가 반입" },
        { category: "labor", amount: 600_000, forecastImpact: "within_forecast", qty: { manDays: 2, dayRate: 300_000 } },
      ],
      reason: "planned",
    },
    ctx("u-field"),
  ).db;
  db = reportCrew(db, { siteId: "site-a", team: "유리 설치팀", kind: "subcontract", headcount: 4, photoDataUrl: JPG }, ctx("u-field")).db;
  db = reportCrew(db, { siteId: "site-a", team: "실링팀", kind: "direct", headcount: 2 }, ctx("u-field")).db;
  return { db, stage };
}

describe("공사일보 자동 작성", () => {
  it("현장 보고에 그날 바뀐 공정 단계가 함께 남는다", () => {
    const { db, stage } = today(createSeed(NOW));
    const r = db.reports.find((x) => x.reportDate === TODAY && x.workDone.includes("커튼월"))!;
    expect(r.stages).toEqual([{ stageId: stage.id, name: stage.name, from: stage.progressPct, to: Math.min(100, stage.progressPct + 5) }]);
  });

  it("작업 내용·공정 진척·투입 인원(팀·직원)·자재(금액 없음)·특이사항·명일 계획·사진을 모은다", () => {
    const { db } = today(createSeed(NOW));
    const d = dailyLog(db, db.sites.find((s) => s.id === "site-a")!, TODAY);
    expect(d.weekday).toBe("수");
    expect(d.work).toContain("3층 남측 커튼월 유닛 8개 설치");
    // 공정 단계 1개 + 현장 전체 공정률이 바뀌었으면 그것도 (D-71)
    expect(d.stages.filter((x) => x.name !== "전체 공정률")).toHaveLength(1);
    const rep = db.reports.find((x) => x.reportDate === TODAY && x.workDone.includes("커튼월"))!;
    expect(d.stages.some((x) => x.name === "전체 공정률")).toBe(!!rep.progress);
    expect(d.crew.map((c) => [c.team, c.headcount, c.photo])).toEqual([
      ["유리 설치팀", 4, true],
      ["실링팀", 2, false],
    ]);
    expect(d.crewTotal).toBe(6);
    expect(d.issues).toEqual(["크레인 대기 40분"]);
    expect(d.plans).toEqual(["4층 앵커 설치"]);
    // 노무비는 일보 자재란에 넣지 않고, 금액 필드는 아예 없다
    expect(d.materials).toEqual([{ category: "material", note: expect.stringContaining("실링재 추가 반입") }]);
    expect(JSON.stringify(d.materials)).not.toContain("1200000");
    expect(d.photos.some((p) => p.caption === "3층 남측")).toBe(true);
    expect(d.review.status).toBe("none");
    expect(d.writers.length).toBe(1);
    expect(d.gaps).toEqual([]);
  });

  it("작업지시 완료(작업량·사진)는 그날 작업 내용과 사진에 들어간다", () => {
    let db = createSeed(NOW);
    const w = createWorkOrder(db, { siteId: "site-a", title: "2층 실링 보수", detail: "누수 부위", assigneeUserId: "u-field" }, ctx("u-manager", new Date(NOW.getTime() - 3_600_000)));
    db = w.db;
    const id = w.result.workOrderId;
    db = workOrderStep(db, { workOrderId: id, action: "receive" }, ctx("u-field", new Date(NOW.getTime() - 3_000_000))).db;
    db = workOrderStep(db, { workOrderId: id, action: "complete", note: "보수 완료", qty: "6m", photoDataUrls: [JPG] }, ctx("u-field")).db;
    const d = dailyLog(db, db.sites.find((s) => s.id === "site-a")!, TODAY);
    expect(d.work).toContain("2층 실링 보수 (6m) — 작업지시 완료");
    expect(d.orders.filter((o) => o.title === "2층 실링 보수").map((o) => o.event)).toEqual(["지시", "접수", "완료 보고"]);
    expect(d.photos.length).toBeGreaterThan(0);
  });

  it("보고가 없는 날은 빠진 자료로 안내", () => {
    const db = createSeed(NOW);
    const d = dailyLog(db, db.sites.find((s) => s.id === "site-b")!, "2026-11-01");
    expect(d.gaps.join(" ")).toContain("현장 보고가 없습니다");
    expect(d.gaps.join(" ")).toContain("작업 인원");
  });

  it("주간 보고: 월요일 시작, 7일, 공정 처음→마지막, 다음 주 예정 공정", () => {
    expect(weekStart("2026-11-04")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // 일요일은 그 주 월요일
    const { db, stage } = today(createSeed(NOW));
    const w = weeklyLog(db, db.sites.find((s) => s.id === "site-a")!, "2026-11-02", TODAY);
    expect(w.days.map((d) => d.weekday)).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    expect(w.days[2]).toMatchObject({ crewTotal: 6, reports: expect.any(Number) });
    expect(w.stages.find((s) => s.name === stage.name)?.to).toBe(Math.min(100, stage.progressPct + 5));
    expect(w.issues).toContainEqual({ date: TODAY, text: "크레인 대기 40분" });
    expect(w.nextStages.every((s) => (s.progressPct ?? 0) < 100)).toBe(true);
  });
});
