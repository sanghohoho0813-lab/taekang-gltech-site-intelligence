import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { submitFieldReport, CommandError } from "@/lib/data/commands";
import { plannedPctOf, sitePlan, stagePlan, noAttendanceDays, siteProgressDelta } from "@/lib/domain/schedule";
import type { SiteStage } from "@/lib/domain/types";

const NOW = new Date("2026-11-02T03:00:00Z"); // 12:00 KST
const TODAY = "2026-11-02";
const st = (startDate: string, endDate: string, progressPct: number): SiteStage => ({ id: "s", name: "단계", startDate, endDate, progressPct });

describe("공정 계획 대비 실제", () => {
  it("계획 진척 = 기간 중 지난 비율", () => {
    expect(plannedPctOf(st("2026-10-03", "2026-12-02", 0), TODAY)).toBe(50);
    expect(plannedPctOf(st("2026-12-01", "2026-12-31", 0), TODAY)).toBe(0);
    expect(plannedPctOf(st("2026-09-01", "2026-10-01", 0), TODAY)).toBe(100);
  });
  it("단계 상태: 완료·기한 지남·늦음·시작 안 함·계획대로·시작 전", () => {
    expect(stagePlan(st("2026-09-01", "2026-10-01", 100), TODAY).status).toBe("done");
    const od = stagePlan(st("2026-09-01", "2026-10-23", 85), TODAY);
    expect(od.status).toBe("overdue");
    expect(od.overdueDays).toBe(10);
    expect(stagePlan(st("2026-10-03", "2026-12-02", 30), TODAY).status).toBe("behind"); // 계획 50 vs 30
    expect(stagePlan(st("2026-10-20", "2026-12-02", 0), TODAY).status).toBe("not_started_late");
    expect(stagePlan(st("2026-10-03", "2026-12-02", 48), TODAY).status).toBe("on_track");
    expect(stagePlan(st("2026-12-01", "2026-12-31", 0), TODAY).status).toBe("upcoming");
  });
  it("DEMO A현장: 늦은 공정(유닛 제작 기한 지남)을 찾고, 현장 전체 늦은 일수·준공 예상·지연 경비를 계산", () => {
    const db = createSeed(NOW);
    const a = db.sites.find((s) => s.id === "site-a")!;
    const p = sitePlan(db, a, TODAY);
    expect(p.stages.find((s) => s.stage.name === "커튼월 유닛 제작")!.status).toBe("overdue");
    // 늦은 일수 ≈ (계획 − 실제) × 전체 공기
    expect(p.delayDays).toBe(Math.round(((p.plannedPct - p.actualPct) / 100) * p.totalDays));
    if (p.delayDays > 0) {
      expect(p.forecastEnd > p.plannedEnd).toBe(true);
      expect(p.delayCost).toBe(p.delayDays * p.dailyOverhead);
      expect(p.dailyOverhead).toBe(Math.round(40_000_000 / p.totalDays)); // A현장 현장경비 실행예산 4,000만
    }
  });
  it("출근 공백: 출퇴근 기록을 쓰기 시작한 뒤, 공정 중인데 아무도 출근하지 않은 날 (일요일 제외)", () => {
    const db = createSeed(NOW);
    const a = db.sites.find((s) => s.id === "site-a")!;
    expect(noAttendanceDays(db, a, TODAY)).toEqual([]); // 최근 6일 매일 출근
    // 어제 기록을 지우면 공백 1일 (어제가 일요일이면 제외)
    db.attendance = db.attendance!.filter((r) => !(r.siteId === "site-a" && r.workDate === "2026-10-31"));
    expect(noAttendanceDays(db, a, TODAY)).toEqual(["2026-10-31"]);
    // 출퇴근 기록을 아직 쓰지 않는 현장은 판단하지 않음
    expect(noAttendanceDays(db, db.sites.find((s) => s.id === "site-b")!, TODAY)).toEqual([]);
  });
});

describe("현장 보고로 공정 단계 진척", () => {
  it("오늘 한 공정의 진척을 바꾸면 단계가 바뀌고, 현장 공정률은 기간 가중 변화량만큼만 오른다", () => {
    const db0 = createSeed(NOW);
    const a = db0.sites.find((s) => s.id === "site-a")!;
    const target = a.stages.find((s) => s.name === "커튼월 유닛 설치")!;
    const expected = Math.round(a.progressPct + siteProgressDelta(a, [{ stageId: target.id, progressPct: target.progressPct + 10 }]));
    const { db } = submitFieldReport(db0, { idempotencyKey: "k1", siteId: "site-a", reportDate: TODAY, workDone: "커튼월 유닛 설치", stageProgress: [{ stageId: target.id, progressPct: target.progressPct + 10 }] }, { userId: "u-field", now: NOW });
    const after = db.sites.find((s) => s.id === "site-a")!;
    expect(after.stages.find((s) => s.id === target.id)!.progressPct).toBe(target.progressPct + 10);
    expect(after.progressPct).toBe(expected);
    expect(after.progressPct).toBeGreaterThan(a.progressPct);
    expect(after.progressPct - a.progressPct).toBeLessThan(10); // 단계 +10%p가 현장 +10%p로 튀지 않음
    expect(db.activityLogs[0].summary + db.activityLogs[1].summary).toContain("커튼월 유닛 설치 45% → 55%");
  });
  it("없는 단계·범위 밖 값은 거부", () => {
    const db0 = createSeed(NOW);
    expect(() => submitFieldReport(db0, { idempotencyKey: "k2", siteId: "site-a", reportDate: TODAY, workDone: "x", stageProgress: [{ stageId: "nope", progressPct: 50 }] }, { userId: "u-field", now: NOW })).toThrow(CommandError);
    const id = db0.sites.find((s) => s.id === "site-a")!.stages[0].id;
    expect(() => submitFieldReport(db0, { idempotencyKey: "k3", siteId: "site-a", reportDate: TODAY, workDone: "x", stageProgress: [{ stageId: id, progressPct: 120 }] }, { userId: "u-field", now: NOW })).toThrow(CommandError);
  });
});
