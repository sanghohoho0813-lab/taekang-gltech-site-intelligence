/**
 * 개인위치정보 운영 규칙 (D-43) — 보관 기간 자동 삭제, 볼 수 있는 사람, 동의 조건·다시 동의, 본인 철회, 오래 남는 문구에 거리 없음
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { checkIn, checkOut } from "@/lib/data/attendanceCommands";
import { CommandError, submitFieldReport } from "@/lib/data/commands";
import { setCompanySettings } from "@/lib/data/adminCommands";
import { applyLocationRetention, purgeLocationsNow, purgeMemberLocations, setLocationPolicy, withdrawLocationConsent } from "@/lib/data/privacyCommands";
import { CONSENT_VERSION, coordinateStats, currentTerms, hasConsent, hasCoords, locationPolicy } from "@/lib/domain/privacy";
import type { AttendanceRecord, DemoDB } from "@/lib/domain/types";
import { viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";

const NOW = new Date("2026-11-04T03:00:00Z"); // 한국 11/04 12:00
const CEO_CTX = { userId: "u-ceo", now: NOW };
const FIELD_CTX = { userId: "u-field", now: NOW };
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });

/** 200일 전 출퇴근 기록 하나 (좌표 있음) */
function withOld(db: DemoDB, userId = "u-field"): DemoDB {
  const old: AttendanceRecord = {
    id: "att-old",
    siteId: "site-a",
    userId,
    workDate: "2026-04-18",
    inAt: "2026-04-17T22:40:00Z",
    inGeo: { status: "inside", lat: 37.2637, lng: 127.0287, accuracyM: 10, distanceM: 12 },
    outAt: "2026-04-18T08:10:00Z",
    outGeo: { status: "outside", lat: 37.27, lng: 127.04, accuracyM: 20, distanceM: 1400 },
  };
  return { ...db, attendance: [...(db.attendance ?? []), old] };
}
const policy = (db: DemoDB, retentionDays: number | null, viewers: "ceo" | "hq" = "hq") => setLocationPolicy(db, { retentionDays, viewers }, CEO_CTX).db;
const sample = { lat: 37.2637, lng: 127.0287, accuracy: 12 };

describe("보관 기간 자동 삭제", () => {
  it("기간을 정하지 않았으면 아무것도 지우지 않는다", () => {
    const db = withOld(createSeed(NOW));
    expect(applyLocationRetention(db, NOW)).toBe(db);
    expect(() => purgeLocationsNow(db, {}, CEO_CTX)).toThrow(/보관 기간을 먼저/);
  });

  it("90일로 정하면: 지난 기록은 좌표·거리·오차를 지우고 판정·시각은 남긴다 / 최근 기록은 그대로 / 하루 한 번", () => {
    const db = policy(withOld(createSeed(NOW)), 90);
    const before = coordinateStats(db);
    const after = applyLocationRetention(db, NOW);
    const old = after.attendance!.find((r) => r.id === "att-old")!;
    expect(old.inGeo).toEqual({ status: "inside", purged: true });
    expect(old.outGeo).toEqual({ status: "outside", purged: true });
    expect(old.inAt).toBe("2026-04-17T22:40:00Z");
    expect(old.outAt).toBe("2026-04-18T08:10:00Z");
    // 최근 6일 기록은 좌표가 남는다
    expect(after.attendance!.filter((r) => r.id.startsWith("att-seed-a")).every((r) => hasCoords(r.inGeo))).toBe(true);
    expect(coordinateStats(after).count).toBe(before.count - 2);
    expect(locationPolicy(after).purgedOn).toBe("2026-11-04");
    // 자동 삭제 기록 — 사람은 ‘시스템’
    expect(after.activityLogs[0]).toMatchObject({ by: "system", type: "privacy", summary: expect.stringContaining("2건 자동 삭제") });
    // 같은 날 다시 불러도 할 일 없음
    expect(applyLocationRetention(after, NOW)).toBe(after);
    // 원본은 바뀌지 않는다 (순수 함수)
    expect(hasCoords(db.attendance!.find((r) => r.id === "att-old")!.inGeo)).toBe(true);
  });

  it("현장 보고·작업 인원 위치도 같은 기준으로 지운다", () => {
    let db = policy(createSeed(NOW), 30);
    db = {
      ...db,
      reports: [...db.reports, { ...db.reports[0], id: "rep-old", createdAt: "2026-08-01T01:00:00Z", geo: { status: "inside", lat: 37.26, lng: 127.02, accuracyM: 9, distanceM: 40 } }],
      crewChecks: [...(db.crewChecks ?? []), { ...db.crewChecks![0], id: "crew-old", at: "2026-08-01T01:00:00Z", geo: { status: "weak", lat: 37.26, lng: 127.02, accuracyM: 300, distanceM: 40 } }],
    };
    const after = purgeLocationsNow(db, {}, CEO_CTX);
    expect(after.result.count).toBe(2);
    expect(after.db.reports.find((r) => r.id === "rep-old")!.geo).toEqual({ status: "inside", purged: true });
    expect(after.db.crewChecks!.find((c) => c.id === "crew-old")!.geo).toEqual({ status: "weak", purged: true });
  });

  it("규칙 입력 검사: 30~1825일, 볼 수 있는 사람은 대표만/대표·관리자", () => {
    const db = createSeed(NOW);
    for (const bad of [10, 0, 2000, 90.5, "90" as unknown as number]) expect(() => setLocationPolicy(db, { retentionDays: bad, viewers: "hq" }, CEO_CTX), String(bad)).toThrow(CommandError);
    expect(() => setLocationPolicy(db, { retentionDays: 90, viewers: "all" as never }, CEO_CTX)).toThrow(CommandError);
  });

  it("다른 운영 설정을 저장해도 위치 규칙은 그대로", () => {
    const db = policy(createSeed(NOW), 365, "ceo");
    const after = setCompanySettings(db, { laborDayRate: 280_000 }, CEO_CTX).db;
    expect(locationPolicy(after)).toMatchObject({ retentionDays: 365, viewers: "ceo" });
  });
});

describe("동의 조건 · 다시 동의", () => {
  it("동의할 때 알린 조건을 남기고, 직원에게 불리하게 바뀌면 다시 동의받는다", () => {
    let db = policy(createSeed(NOW), 90, "ceo");
    db = checkIn(db, { siteId: "site-a", sample, consent: true, consentTerms: currentTerms(db) }, FIELD_CTX).db;
    const c = db.consents!.find((x) => x.userId === "u-field")!;
    expect(c).toMatchObject({ version: CONSENT_VERSION, retentionDays: 90, viewers: "ceo" });
    expect(hasConsent(db, "u-field")).toBe(true);
    // 더 짧게·더 좁게 = 그대로 유효
    expect(hasConsent(policy(db, 30, "ceo"), "u-field")).toBe(true);
    // 더 길게 / 기간 미정 / 관리자까지 = 다시 동의
    expect(hasConsent(policy(db, 365, "ceo"), "u-field")).toBe(false);
    expect(hasConsent(policy(db, null, "ceo"), "u-field")).toBe(false);
    const wider = setLocationPolicy(db, { retentionDays: 90, viewers: "hq" }, CEO_CTX);
    expect(wider.result.reconsent).toBe(true);
    expect(hasConsent(wider.db, "u-field")).toBe(false);
    // 다시 동의하기 전에는 좌표를 남기지 않는다 (동의 없이 보내면 거부)
    const out = checkOut(wider.db, { siteId: "site-a", sample: null, noLocation: "skipped" }, FIELD_CTX).db;
    expect(hasCoords(out.attendance!.find((r) => r.userId === "u-field" && r.workDate === "2026-11-04")!.outGeo)).toBe(false);
  });

  it("예전 문구(1판) 동의는 다시 받는다", () => {
    const db = createSeed(NOW);
    db.consents = [{ userId: "u-field", at: "2026-10-01T00:00:00Z", version: 1 }];
    expect(hasConsent(db, "u-field")).toBe(false);
  });
});

describe("본인 동의 철회 · 직원별 삭제", () => {
  it("철회하면 동의 기록과 본인 좌표(출퇴근·보고·작업 인원)를 바로 지우고, 다른 사람 것은 그대로", () => {
    let db = createSeed(NOW);
    db = checkIn(db, { siteId: "site-a", sample, consent: true, consentTerms: currentTerms(db) }, FIELD_CTX).db;
    db = submitFieldReport(db, { siteId: "site-a", reportDate: "2026-11-04", workDone: "실링", issues: "", tomorrowPlan: "", costs: [], geo: { sample }, idempotencyKey: "pv-1" }, FIELD_CTX).db;
    const otherBefore = coordinateStats({ ...db, attendance: db.attendance!.filter((r) => r.userId === "u-field2"), reports: [], crewChecks: [] }).count;
    const r = withdrawLocationConsent(db, {}, FIELD_CTX);
    expect(r.result.count).toBeGreaterThan(10); // 지난 6일 출퇴근 12 + 오늘 + 보고 + 작업 인원 5
    expect(r.db.consents!.some((c) => c.userId === "u-field")).toBe(false);
    expect(r.db.attendance!.filter((x) => x.userId === "u-field").some((x) => hasCoords(x.inGeo) || hasCoords(x.outGeo))).toBe(false);
    expect(r.db.reports.filter((x) => x.createdBy === "u-field").some((x) => hasCoords(x.geo))).toBe(false);
    expect(r.db.crewChecks!.filter((x) => x.by === "u-field").some((x) => hasCoords(x.geo))).toBe(false);
    expect(coordinateStats({ ...r.db, attendance: r.db.attendance!.filter((x) => x.userId === "u-field2"), reports: [], crewChecks: [] }).count).toBe(otherBefore);
    expect(r.db.activityLogs[0].summary).toContain("동의 철회");
    // 철회 뒤 좌표를 보내면 다시 동의를 요구한다 / 위치 없이는 출근할 수 있다
    expect(() => withdrawLocationConsent(r.db, {}, FIELD_CTX)).toThrow(CommandError);
  });

  it("대표가 퇴사·요청 처리로 한 직원의 좌표를 지운다 (사유 기록)", () => {
    const db = createSeed(NOW);
    const r = purgeMemberLocations(db, { userId: "u-field2", reason: "퇴사" }, CEO_CTX);
    expect(r.result.count).toBeGreaterThan(0);
    expect(r.db.attendance!.filter((x) => x.userId === "u-field2").some((x) => hasCoords(x.inGeo))).toBe(false);
    expect(r.db.attendance!.filter((x) => x.userId === "u-field").every((x) => hasCoords(x.inGeo))).toBe(true);
    expect(r.db.activityLogs[0].summary).toMatch(/정우진.*좌표 \d+건 삭제 — 퇴사/);
    expect(() => purgeMemberLocations(db, { userId: "nobody" }, CEO_CTX)).toThrow(CommandError);
  });
});

describe("볼 수 있는 사람 (서버가 내려보내는 데이터)", () => {
  const MANAGER = member("u-manager", "manager");
  const CEO = member("u-ceo", "ceo");
  const FIELD = member("u-field", "field", { siteIds: ["site-a"] });

  it("‘대표만’이면 관리자에게는 다른 사람 좌표·거리·오차 없이 판정만, 대표는 그대로", () => {
    const db = policy(createSeed(NOW), 365, "ceo");
    const mv = viewFor(MANAGER, db, NOW);
    expect(mv.attendance!.length).toBe(db.attendance!.length);
    expect(mv.attendance!.some((r) => hasCoords(r.inGeo) || hasCoords(r.outGeo))).toBe(false);
    expect(mv.attendance!.find((r) => r.userId === "u-field2")!.inGeo.status).toBe("outside");
    expect(JSON.stringify(mv.attendance)).not.toMatch(/"lat"|"distanceM"|"accuracyM"/);
    const cv = viewFor(CEO, db, NOW);
    expect(cv.attendance!.some((r) => hasCoords(r.inGeo))).toBe(true);
    // ‘대표·관리자’로 바꾸면 관리자도 본다
    expect(viewFor(MANAGER, policy(db, 365, "hq"), NOW).attendance!.some((r) => hasCoords(r.inGeo))).toBe(true);
  });

  it("현장 직원: 같은 현장 동료 보고·작업 인원의 좌표는 빼고, 본인 것은 그대로", () => {
    let db = createSeed(NOW);
    const coworker = { ...db.reports.find((r) => r.siteId === "site-a")!, id: "rep-co", createdBy: "u-manager", reportDate: "2026-11-03", geo: { status: "inside" as const, lat: 37.26, lng: 127.02, accuracyM: 9, distanceM: 40 } };
    db = { ...db, reports: [...db.reports, coworker], crewChecks: [...db.crewChecks!, { ...db.crewChecks![0], id: "crew-co", by: "u-manager", geo: { status: "inside", lat: 37.26, lng: 127.02, accuracyM: 9, distanceM: 40 } }] };
    db = submitFieldReport(db, { siteId: "site-a", reportDate: "2026-11-04", workDone: "실링", issues: "", tomorrowPlan: "", costs: [], geo: { sample }, idempotencyKey: "pv-2" }, FIELD_CTX).db;
    db.consents = [...db.consents!, { userId: "u-field", at: "", version: CONSENT_VERSION, retentionDays: null, viewers: "hq" }];
    const mineDb = submitFieldReport(db, { siteId: "site-a", reportDate: "2026-11-04", workDone: "실링 2", issues: "", tomorrowPlan: "", costs: [], geo: { sample }, idempotencyKey: "pv-3" }, FIELD_CTX).db;
    const v = viewFor(FIELD, mineDb, NOW);
    expect(v.reports.find((r) => r.id === "rep-co")!.geo).toEqual({ status: "inside" });
    expect(v.crewChecks!.find((c) => c.id === "crew-co")!.geo).toEqual({ status: "inside" });
    expect(v.reports.filter((r) => r.createdBy === "u-field").some((r) => hasCoords(r.geo))).toBe(true);
  });
});

describe("오래 남는 활동 기록에는 거리·오차를 쓰지 않는다", () => {
  it("출근·퇴근 기록 문구에 m·km 거리가 없다 (좌표를 지워도 기록 문구로 위치가 남지 않게)", () => {
    let db = createSeed(NOW);
    const far = { lat: 37.29, lng: 127.06, accuracy: 30 };
    db = checkIn(db, { siteId: "site-a", sample: far, consent: true, consentTerms: currentTerms(db) }, FIELD_CTX).db;
    db = checkOut(db, { siteId: "site-a", sample: far }, { ...FIELD_CTX, now: new Date("2026-11-04T08:00:00Z") }).db;
    const texts = db.activityLogs.slice(0, 3).map((l) => l.summary);
    expect(texts.some((t) => t.includes("출근"))).toBe(true);
    for (const t of texts) expect(t, t).not.toMatch(/\d\s?(km|m)\b|오차/);
  });
});
