import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { reportCrew } from "@/lib/data/attendanceCommands";
import { submitFieldReport, CommandError } from "@/lib/data/commands";
import { crewFlags, crewSummary, mandayGap, recentTeams } from "@/lib/domain/crew";
import type { DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-02T03:00:00Z"); // 12:00 KST
const ctx = (userId: string, now = NOW) => ({ userId, now });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

describe("작업 인원 보고 (출력)", () => {
  it("팀·인원·단체 사진을 서버 시각으로 남기고, 같은 날 같은 팀은 수정 이력과 함께 바뀐다", () => {
    const db0 = createSeed(NOW);
    const r1 = reportCrew(db0, { siteId: "site-a", team: "  철근팀  ", kind: "direct", headcount: 6, photoDataUrl: JPG }, ctx("u-field"));
    const c = r1.db.crewChecks!.find((x) => x.id === r1.result.crewId)!;
    expect(c).toMatchObject({ team: "철근팀", kind: "direct", headcount: 6, workDate: "2026-11-02", at: NOW.toISOString() });
    expect(c.photoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.db.photos.find((p) => p.id === c.photoId)?.crewId).toBe(c.id);
    const r2 = reportCrew(r1.db, { siteId: "site-a", team: "철근팀", headcount: 5 }, ctx("u-field", new Date(NOW.getTime() + 600_000)));
    expect(r2.result.updated).toBe(true);
    const c2 = r2.db.crewChecks!.find((x) => x.id === c.id)!;
    expect(c2.headcount).toBe(5);
    expect(c2.history).toEqual([{ at: NOW.toISOString(), by: "u-field", headcount: 6 }]);
    expect(c2.photoId).toBe(c.photoId); // 사진 없이 수정하면 기존 사진 유지
  });
  it("잘못된 입력 거부 (팀 이름 없음·0명·301명·SVG 사진)", () => {
    const db0 = createSeed(NOW);
    for (const bad of [{ team: " ", headcount: 3 }, { team: "a", headcount: 0 }, { team: "a", headcount: 301 }, { team: "a", headcount: 3, photoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }])
      expect(() => reportCrew(db0, { siteId: "site-a", ...bad }, ctx("u-field"))).toThrow(CommandError);
  });
  it("대조: 사진 없음·보낸 사람 출근 없음·같은 사진 재사용·보고 공수 > 출력 인원", () => {
    let db: DemoDB = createSeed(NOW);
    // 어제 쓴 단체 사진을 오늘 다른 팀에 다시 사용
    db = reportCrew(db, { siteId: "site-a", team: "실링팀", headcount: 3, photoDataUrl: JPG }, ctx("u-field", new Date(NOW.getTime() - 86_400_000))).db;
    db = reportCrew(db, { siteId: "site-a", team: "유리 설치팀 (가상 협력업체)", headcount: 4, photoDataUrl: JPG }, ctx("u-field")).db;
    db = reportCrew(db, { siteId: "site-a", team: "청소팀", headcount: 2 }, ctx("u-field")).db;
    // 노무 공수 10명 × 3일 = 30 보고 (지난 30일 출력: 4명×5일 + 3 + 4 + 2 = 29 → 30 > 29 × 1.1? 아니오)
    db = submitFieldReport(db, { idempotencyKey: "k-l1", siteId: "site-a", reportDate: "2026-11-02", workDone: "유리 시공", costs: [{ category: "labor", amount: 9_000_000, forecastImpact: "additional", qty: { manDays: 30, dayRate: 300_000 } }], reason: "quantity_increase" }, ctx("u-field")).db;
    let g = mandayGap(db, "site-a", "2026-10-04", "2026-11-02");
    expect(g).toEqual({ reported: 30, crewDays: 29 });
    expect(crewFlags(db, "2026-11-02", "2026-10-04").some((f) => f.kind === "manday_over")).toBe(false);
    // 공수를 더 보고하면 대조 표시
    db = submitFieldReport(db, { idempotencyKey: "k-l2", siteId: "site-a", reportDate: "2026-11-02", workDone: "유리 시공", costs: [{ category: "labor", amount: 3_000_000, forecastImpact: "additional", qty: { manDays: 10, dayRate: 300_000 } }], reason: "quantity_increase" }, ctx("u-field")).db;
    g = mandayGap(db, "site-a", "2026-10-04", "2026-11-02");
    expect(g.reported).toBe(40);
    const flags = crewFlags(db, "2026-11-02", "2026-10-04");
    expect(flags.some((f) => f.kind === "manday_over" && f.siteId === "site-a")).toBe(true);
    expect(flags.some((f) => f.kind === "photo_reused")).toBe(true);
    expect(flags.some((f) => f.kind === "no_photo" && f.text.includes("청소팀"))).toBe(true);
    expect(flags.some((f) => f.kind === "reporter_absent")).toBe(true); // 최성민 오늘 출근 기록 없음
  });
  it("팀별 합계·최근 팀", () => {
    const db = createSeed(NOW);
    expect(crewSummary(db, "2026-10-01", "2026-11-02")).toEqual([{ siteId: "site-a", team: "유리 설치팀 (가상 협력업체)", kind: "subcontract", days: 5, personDays: 20, noPhoto: 5 }]);
    expect(recentTeams(db, "site-a")[0]).toMatchObject({ team: "유리 설치팀 (가상 협력업체)", last: 4 });
  });
});
