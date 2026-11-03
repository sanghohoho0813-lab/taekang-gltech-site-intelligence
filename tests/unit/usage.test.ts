import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { fieldUsage, fmtHours, median, responseStats, usageSummary, workdaysBetween } from "@/lib/domain/usage";
import type { AttendanceRecord, DemoDB, FieldReport } from "@/lib/domain/types";

const NOW = new Date("2026-11-07T09:00:00Z"); // 토 18:00 KST
const FROM = "2026-11-01"; // 일
const TO = "2026-11-07"; // 토

const att = (userId: string, d: string, out = true): AttendanceRecord => ({
  id: `att-${userId}-${d}`,
  siteId: "site-a",
  userId,
  workDate: d,
  inAt: `${d}T07:30:00+09:00`,
  inGeo: { status: "inside" } as AttendanceRecord["inGeo"],
  ...(out ? { outAt: `${d}T17:30:00+09:00` } : {}),
});
const rep = (by: string, d: string, photos = 1, review?: FieldReport["review"]): FieldReport => ({
  id: `rep-${by}-${d}`,
  siteId: "site-a",
  reportDate: d,
  workDone: "작업",
  issues: "",
  tomorrowPlan: "",
  photoIds: Array.from({ length: photos }, (_, i) => `ph-${d}-${i}`),
  costEntryIds: [],
  createdBy: by,
  createdAt: `${d}T17:00:00+09:00`,
  status: "submitted",
  ...(review ? { review } : {}),
});

function base(): DemoDB {
  const db = createSeed(NOW);
  return { ...db, attendance: [], reports: [], crewChecks: [], workOrders: [], attendanceRequests: [], partnerRequests: [] };
}

describe("사용 현황 (실사용 검증)", () => {
  it("작업일은 월~토, 중앙값·시간 표시", () => {
    expect(workdaysBetween(FROM, TO)).toBe(6);
    expect(workdaysBetween("2026-11-01", "2026-11-01")).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(fmtHours(0.25)).toBe("15분");
    expect(fmtHours(3.04)).toBe("3시간");
    expect(fmtHours(72)).toBe("3일");
  });

  it("정착: 작업일 6일 중 5일 출근 + 출근일 4일 보고 → 정착", () => {
    const db = base();
    db.attendance = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => att("u-field", d));
    db.reports = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((d) => rep("u-field", d));
    const u = fieldUsage(db, db.users.find((x) => x.id === "u-field")!, FROM, TO);
    expect(u).toMatchObject({ since: "2026-11-02", workdays: 6, attendDays: 5, outDays: 5, reportDays: 4, status: "settled" });
    expect(u.attendRate).toBeCloseTo(5 / 6);
    expect(u.reportRate).toBeCloseTo(4 / 5);
  });

  it("일요일에 일한 날은 작업일에 더한다 (출근일이 작업일보다 많아지지 않음)", () => {
    const db = base();
    db.attendance = ["2026-11-01", "2026-11-02"].map((d) => att("u-field", d));
    const u = fieldUsage(db, db.users.find((x) => x.id === "u-field")!, FROM, TO);
    expect(u).toMatchObject({ since: "2026-11-01", attendDays: 2, workdays: 7 });
    expect(u.attendRate).toBeCloseTo(2 / 7);
  });

  it("늦게 합류한 직원은 첫 기록일부터 센다 / 기록 없으면 ‘사용 전’과 안내", () => {
    const db = base();
    db.attendance = ["2026-11-06", "2026-11-07"].map((d) => att("u-field2", d));
    db.reports = ["2026-11-06", "2026-11-07"].map((d) => rep("u-field2", d));
    const late = fieldUsage(db, db.users.find((x) => x.id === "u-field2")!, FROM, TO);
    expect(late).toMatchObject({ since: "2026-11-06", workdays: 2, attendDays: 2, status: "settled" });
    const none = fieldUsage(db, db.users.find((x) => x.id === "u-field")!, FROM, TO);
    expect(none.status).toBe("none");
    expect(none.notes[0]).toContain("기록이 없습니다");
  });

  it("일부 사용과 확인할 점: 퇴근 누락·사진 없는 보고·며칠째 기록 없음", () => {
    const db = base();
    db.attendance = [att("u-field", "2026-11-02", false), att("u-field", "2026-11-03", false), att("u-field", "2026-11-04")];
    db.reports = [rep("u-field", "2026-11-02", 0), rep("u-field", "2026-11-03", 0)];
    const u = fieldUsage(db, db.users.find((x) => x.id === "u-field")!, FROM, TO);
    expect(u.status).toBe("partial");
    expect(u.notes.join(" ")).toContain("퇴근을 찍지 않은 날");
    expect(u.notes.join(" ")).toContain("사진 없는 보고");
    expect(u.notes.join(" ")).toContain("작업일 3일째 기록 없음");
  });

  it("본사 응답: 보고 확인 중앙값, 24시간 넘은 미확인은 기준 초과", () => {
    const db = base();
    db.reports = [
      rep("u-field", "2026-11-02", 1, { status: "confirmed", at: "2026-11-02T10:00:00Z", by: "u-manager" }), // 17:00 KST 보고 → 19:00 KST 확인 = 2시간
      rep("u-field", "2026-11-03", 1, { status: "confirmed", at: "2026-11-03T12:00:00Z", by: "u-manager" }), // 4시간
      rep("u-field", "2026-11-04", 1), // 미확인 (3일 지남)
      rep("u-field", "2026-11-07", 1), // 미확인 (기준 안)
    ];
    const r = responseStats(db, FROM, TO, new Date("2026-11-07T10:00:00Z")).find((x) => x.key === "report")!;
    expect(r).toMatchObject({ medianHours: 3, n: 2, open: 2, overdue: 1, targetHours: 24 });
  });

  it("요약: 비활성 직원 제외, 정착 수", () => {
    const db = base();
    db.attendance = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => att("u-field", d));
    db.reports = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((d) => rep("u-field", d));
    db.users = db.users.map((u) => (u.id === "u-field2" ? { ...u, inactive: true } : u));
    const s = usageSummary(db, FROM, TO, NOW);
    expect(s.field.map((f) => f.user.id)).toEqual(["u-field"]);
    expect(s.settled).toBe(1);
    expect(s.response.map((r) => r.key)).toEqual(["report", "fix", "order", "partner"]);
  });
});
