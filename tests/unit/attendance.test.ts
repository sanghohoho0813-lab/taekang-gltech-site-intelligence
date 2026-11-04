import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { CONSENT_VERSION, checkIn, checkOut, correctAttendance, setSiteGeo } from "@/lib/data/attendanceCommands";
import { submitFieldReport, CommandError } from "@/lib/data/commands";
import { judgeGeo, distanceM } from "@/lib/domain/geo";
import { backdatedDays, dayFlags, periodSummary, recentFlags } from "@/lib/domain/attendance";
import type { DemoDB } from "@/lib/domain/types";

// 2026-11-02 12:00 KST
const NOW = new Date("2026-11-02T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });
const A = { lat: 37.2636, lng: 127.0286 };
const near = { lat: 37.2638, lng: 127.0289, accuracy: 15 }; // 약 35m
const far = { lat: 37.29, lng: 127.06, accuracy: 10 }; // 약 4km

describe("위치 판정 (서버 계산)", () => {
  const site = { geo: { ...A, radiusM: 300, setAt: "", setBy: "" } };
  it("반경 안·밖·불확실·없음·미등록", () => {
    expect(judgeGeo(site, near).status).toBe("inside");
    expect(judgeGeo(site, far).status).toBe("outside");
    expect(judgeGeo(site, { ...near, accuracy: 400 }).status).toBe("weak"); // 건물 안처럼 오차가 큼
    expect(judgeGeo(site, null, "denied")).toEqual({ status: "none", reason: "denied" });
    expect(judgeGeo({}, near).status).toBe("nosite");
    expect(Math.round(distanceM(A, near))).toBeLessThan(50);
  });
});

describe("출퇴근", () => {
  it("위치를 남기려면 동의가 먼저 — 동의하면 기록, 시각은 서버 시각", () => {
    const db0 = createSeed(NOW);
    expect(() => checkIn(db0, { siteId: "site-a", sample: near }, ctx("u-field"))).toThrow(CommandError);
    const { db, result } = checkIn(db0, { siteId: "site-a", sample: near, consent: true, deviceId: "dev-abc123" }, ctx("u-field"));
    expect(result.geo.status).toBe("inside");
    expect(result.at).toBe(NOW.toISOString());
    const rec = db.attendance!.find((r) => r.id === result.attendanceId)!;
    expect(rec.workDate).toBe("2026-11-02");
    expect(rec.inDevice).toBe("dev-abc123");
    expect(db.consents!.some((c) => c.userId === "u-field")).toBe(true);
    // 같은 날 두 번 출근 불가
    expect(() => checkIn(db, { siteId: "site-a", sample: near }, ctx("u-field"))).toThrow(/이미 출근/);
    // 다른 현장에 출근 중이면 먼저 퇴근
    expect(() => checkIn(db, { siteId: "site-b", sample: near }, ctx("u-field"))).toThrow(/출근 중/);
    // 퇴근 → 근무 시간
    const later = new Date(NOW.getTime() + 5 * 3_600_000 + 30 * 60_000);
    const out = checkOut(db, { siteId: "site-a", sample: far }, ctx("u-field", later));
    expect(out.result.minutes).toBe(330);
    expect(out.result.geo.status).toBe("outside");
  });

  it("위치 없이도 출근은 되지만 '위치 없음'으로 남는다 / 출근 없이 퇴근 불가", () => {
    const db0 = createSeed(NOW);
    const { result } = checkIn(db0, { siteId: "site-a", noLocation: "denied" }, ctx("u-field"));
    expect(result.geo).toEqual({ status: "none", reason: "denied" });
    expect(() => checkOut(db0, { siteId: "site-a" }, ctx("u-field"))).toThrow(/출근 기록이 없습니다/);
  });

  it("같은 휴대폰으로 두 사람이 출근 → 본사에 ‘같은 휴대폰’ 표시", () => {
    let db: DemoDB = createSeed(NOW);
    db.consents = [...db.consents!, { userId: "u-field", at: "", version: CONSENT_VERSION, retentionDays: null, viewers: "hq" as const }];
    db = checkIn(db, { siteId: "site-a", sample: near, deviceId: "dev-shared1" }, ctx("u-field")).db;
    db.attendance = db.attendance!.filter((r) => r.id !== "att-seed-c-0"); // 오늘 기록 없는 상태에서
    db = checkIn(db, { siteId: "site-c", noLocation: "unavailable", deviceId: "dev-shared1" }, ctx("u-field2", new Date(NOW.getTime() + 60_000))).db;
    const flags = dayFlags(db, "2026-11-02", NOW);
    expect(flags.filter((f) => f.kind === "shared_device").map((f) => f.userId).sort()).toEqual(["u-field", "u-field2"]);
  });

  it("DEMO 예시: 현장 밖 출근·퇴근 누락·위치가 매일 똑같음·미출근을 찾아낸다", () => {
    const db = createSeed(NOW);
    const today = dayFlags(db, "2026-11-02", NOW);
    expect(today.some((f) => f.kind === "outside" && f.userId === "u-field2")).toBe(true);
    expect(today.some((f) => f.kind === "missing" && f.userId === "u-field")).toBe(true);
    const recent = recentFlags(db, "2026-11-02");
    expect(recent.some((f) => f.kind === "same_spot" && f.userId === "u-field2")).toBe(true);
    expect(recent.some((f) => f.kind === "no_checkout" && f.userId === "u-field2" && f.workDate === "2026-11-01")).toBe(true);
    expect(recent.some((f) => f.userId === "u-field")).toBe(false); // 최성민은 정상
    const sum = periodSummary(db, "2026-10-01", "2026-11-02");
    const choi = sum.find((r) => r.userId === "u-field")!;
    expect(choi.days).toBe(6);
    expect(choi.outside).toBe(0);
  });

  it("본사 정정: 사유 필수, 시각만 바뀌고 이력이 남는다", () => {
    const db0 = createSeed(NOW);
    const id = "att-seed-c-1"; // 어제 퇴근 누락
    expect(() => correctAttendance(db0, { attendanceId: id, outAt: "2026-11-01T08:00:00Z", note: "" }, ctx("u-manager"))).toThrow(CommandError);
    expect(() => correctAttendance(db0, { attendanceId: id, outAt: "2026-10-31T00:00:00Z", note: "반장 확인" }, ctx("u-manager"))).toThrow(CommandError); // 출근보다 이름
    const { db } = correctAttendance(db0, { attendanceId: id, outAt: "2026-11-01T08:00:00Z", note: "퇴근 누락 — 반장 확인" }, ctx("u-manager"));
    const r = db.attendance!.find((x) => x.id === id)!;
    expect(r.outAt).toBe("2026-11-01T08:00:00.000Z");
    expect(r.outGeo).toBeUndefined(); // 위치는 만들어내지 않는다
    expect(r.corrections?.[0].note).toBe("퇴근 누락 — 반장 확인");
  });

  it("현장 위치 등록 검증 (반경 50~3,000m)", () => {
    const db0 = createSeed(NOW);
    expect(() => setSiteGeo(db0, { siteId: "site-a", lat: 37.5, lng: 127, radiusM: 10 }, ctx("u-manager"))).toThrow(CommandError);
    const { db } = setSiteGeo(db0, { siteId: "site-a", lat: 37.51, lng: 127.02, radiusM: 500 }, ctx("u-manager"));
    expect(db.sites.find((s) => s.id === "site-a")!.geo).toMatchObject({ lat: 37.51, lng: 127.02, radiusM: 500, setBy: "u-manager" });
  });
});

describe("현장 보고 위치·날짜", () => {
  const base = { idempotencyKey: "k1", siteId: "site-a", reportDate: "2026-11-02", workDone: "앵커 설치" };
  it("동의한 사람만 좌표가 남고, 서버가 현장 안/밖을 다시 판정", () => {
    const db0 = createSeed(NOW);
    const r1 = submitFieldReport(db0, { ...base, geo: { sample: far } }, ctx("u-field")).db.reports[0];
    expect(r1.geo).toEqual({ status: "none", reason: "skipped" }); // 동의 전 → 좌표 미기록
    db0.consents = [...db0.consents!, { userId: "u-field", at: "", version: CONSENT_VERSION, retentionDays: null, viewers: "hq" as const }];
    const r2 = submitFieldReport(db0, { ...base, idempotencyKey: "k2", geo: { sample: far } }, ctx("u-field")).db.reports[0];
    expect(r2.geo?.status).toBe("outside");
  });
  it("지난 날짜로 쓴 보고는 며칠 지났는지 계산", () => {
    expect(backdatedDays({ reportDate: "2026-10-30", createdAt: NOW.toISOString() })).toBe(3);
    expect(backdatedDays({ reportDate: "2026-11-02", createdAt: NOW.toISOString() })).toBe(0);
  });
});
