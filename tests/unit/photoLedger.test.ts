import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { submitFieldReport } from "@/lib/data/commands";
import { reportCrew } from "@/lib/data/attendanceCommands";
import { createWorkOrder, workOrderStep } from "@/lib/data/opsCommands";
import { photoLedger } from "@/lib/domain/photoLedger";

const NOW = new Date("2026-11-04T03:00:00Z");
const ctx = (userId: string, ms = 0) => ({ userId, now: new Date(NOW.getTime() + ms) });
const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

describe("공사사진대장", () => {
  it("보고·작업지시 완료 사진을 날짜순 번호로, 공종(보고가 바꾼 공정 단계)·내용·촬영자와 함께", () => {
    let db = createSeed(NOW);
    const site = db.sites.find((s) => s.id === "site-a")!;
    const stage = site.stages.find((s) => s.progressPct < 100)!;
    db = submitFieldReport(db, { idempotencyKey: "pl1", siteId: "site-a", reportDate: "2026-11-04", workDone: "3층 남측 유닛 8개 설치", photos: [{ dataUrl: JPG, caption: "3층 남측 전경" }, { dataUrl: JPG }], stageProgress: [{ stageId: stage.id, progressPct: Math.min(100, stage.progressPct + 5) }] }, ctx("u-field")).db;
    const w = createWorkOrder(db, { siteId: "site-a", title: "2층 실링 보수", detail: "", assigneeUserId: "u-field" }, ctx("u-manager", 1000));
    db = workOrderStep(w.db, { workOrderId: w.result.workOrderId, action: "complete", note: "보수 완료", qty: "6m", photoDataUrls: [JPG] }, ctx("u-field", 2000)).db;
    db = reportCrew(db, { siteId: "site-a", team: "유리 설치팀", kind: "subcontract", headcount: 4, photoDataUrl: JPG }, ctx("u-field", 3000)).db;
    const l = photoLedger(db, "site-a", "2026-11-01", "2026-11-04");
    expect(l.map((e) => e.no)).toEqual(l.map((_, i) => i + 1));
    const mine = l.filter((e) => e.date === "2026-11-04");
    expect(mine.map((e) => e.kind)).toEqual(["report", "report", "order"]);
    expect(mine[0]).toMatchObject({ stage: stage.name, text: "3층 남측 전경 — 3층 남측 유닛 8개 설치", by: "최성민" });
    expect(mine[1].text).toBe("3층 남측 유닛 8개 설치");
    expect(mine[2].text).toBe("2층 실링 보수 — 보수 완료");
    // 작업 인원 단체 사진은 기본 제외, 선택하면 포함
    expect(l.some((e) => e.kind === "crew")).toBe(false);
    expect(photoLedger(db, "site-a", "2026-11-01", "2026-11-04", { includeCrew: true }).some((e) => e.kind === "crew")).toBe(true);
    // 공종으로 거르기 · 기간 밖 제외 · 다른 현장 제외
    expect(photoLedger(db, "site-a", "2026-11-01", "2026-11-04", { stage: stage.name }).every((e) => e.stage === stage.name)).toBe(true);
    expect(photoLedger(db, "site-a", "2026-11-05", "2026-11-30")).toEqual([]);
    expect(photoLedger(db, "site-b", "2026-11-04", "2026-11-04").length).toBe(0);
  });
});
