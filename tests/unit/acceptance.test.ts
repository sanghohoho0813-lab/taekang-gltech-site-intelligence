/**
 * 검수 확인서 근거 (D-51) — 단계별 항목·기간(한국 날짜) 집계·금액 비노출·오류 기록·활동 이력 상한 표시
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { acceptanceItems, STAGE_TITLE, type StageNo } from "@/lib/domain/acceptance";
import type { ErrorEntry } from "@/lib/domain/feedback";
import type { AttendanceRecord, AttendanceRequest, DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-05T03:00:00Z");
const FROM = "2026-11-01";
const TO = "2026-11-05";

function empty(): DemoDB {
  const db = createSeed(NOW);
  return { ...db, attendance: [], reports: [], crewChecks: [], workOrders: [], attendanceRequests: [], partnerRequests: [], importBatches: [], feedback: [], deviceChecks: [], activityLogs: [] };
}
const att = (userId: string, d: string): AttendanceRecord => ({
  id: `att-${userId}-${d}`,
  siteId: "site-a",
  userId,
  workDate: d,
  inAt: `${d}T07:30:00+09:00`,
  inGeo: { status: "inside" } as AttendanceRecord["inGeo"],
  outAt: `${d}T17:30:00+09:00`,
});
const item = (db: DemoDB, stage: StageNo, key: string, errors?: ErrorEntry[] | null) => acceptanceItems(db, stage, FROM, TO, NOW, errors).find((i) => i.key === key)!;
const value = (db: DemoDB, stage: StageNo, key: string, label: string) => item(db, stage, key).evidence.find((e) => e.label === label)!;

describe("검수 확인서", () => {
  it("단계마다 계약 별지 제1호 시나리오·모듈 항목이 나오고, 기준·확인 방법·근거가 빠지지 않는다", () => {
    const db = createSeed(NOW);
    const keys = ([1, 2, 3, 4] as const).map((s) => acceptanceItems(db, s, FROM, TO, NOW).map((i) => i.key));
    expect(keys).toEqual([
      ["design", "structure", "authz", "strategy"],
      ["S1", "S2", "S3", "S6", "device", "privacy"],
      ["S4", "S5", "S7", "S8"],
      ["usage", "feedback", "handover"],
    ]);
    for (const s of [1, 2, 3, 4] as const) {
      expect(STAGE_TITLE[s]).toContain(`${s}단계`);
      for (const i of acceptanceItems(db, s, FROM, TO, NOW)) {
        expect(i.criteria.length).toBeGreaterThan(5);
        expect(i.how.length).toBeGreaterThan(5);
        expect(i.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("금액은 넣지 않는다 — 계약·기성·원가 금액이 어떤 문구에도 나오지 않는다", () => {
    const db = createSeed(NOW);
    const text = JSON.stringify(([1, 2, 3, 4] as const).map((s) => acceptanceItems(db, s, "2026-01-01", TO, NOW)));
    expect(text).not.toMatch(/\d원|만원|억/);
    const amounts = [...db.contracts.map((c) => c.contractAmount), ...db.billings.map((b) => b.amount), ...db.costEntries.map((c) => c.amount)].filter((a) => a >= 100_000);
    for (const a of amounts) {
      expect(text).not.toContain(a.toLocaleString("ko-KR"));
      expect(text).not.toContain(String(a));
    }
  });

  it("기간은 한국 날짜 기준 — 기간 밖 기록은 세지 않고, 기록이 없으면 ‘기록 없음’", () => {
    const db = empty();
    expect(item(db, 2, "S1").evidence.every((e) => !e.has)).toBe(true);
    db.attendance = [att("u-field", "2026-10-31"), att("u-field", "2026-11-02"), att("u-other", "2026-11-05")];
    expect(value(db, 2, "S1", "출근 기록").value).toBe("2건");
    expect(value(db, 2, "S1", "출근한 직원").value).toBe("2명");
    expect(value(db, 2, "S1", "현장 안 판정").value).toBe("100%");
    // 한국 시각 11/1 00:30 (UTC 10/31 15:30) 요청은 기간 안, 한국 시각 10/31 23:30은 밖
    const req = (id: string, createdAt: string, status: AttendanceRequest["status"]) => ({ id, createdAt, status, userId: "u-field", siteId: "site-a", kind: "missed_out", workDate: "2026-11-01", reason: "x" }) as unknown as AttendanceRequest;
    db.attendanceRequests = [req("q1", "2026-10-31T15:30:00Z", "approved"), req("q2", "2026-10-31T14:30:00Z", "approved"), req("q3", "2026-11-03T01:00:00Z", "pending")];
    const s2 = value(db, 2, "S2", "근태 수정 요청");
    expect(s2.value).toBe("2건 (승인 1 · 반려 0 · 대기 1)");
    expect(s2.has).toBe(true);
    // 통신 불량 자동 요청은 직원 요청 수에 넣지 않고 따로 (리뷰 반영)
    db.attendanceRequests = [...db.attendanceRequests!, { ...req("q4", "2026-11-03T02:00:00Z", "pending"), auto: "offline" } as AttendanceRequest];
    expect(value(db, 2, "S2", "근태 수정 요청").value).toBe("2건 (승인 1 · 반려 0 · 대기 1)");
    expect(value(db, 2, "S2", "통신 불량 자동 확인").value).toContain("1건");
  });

  it("4단계 앱 오류: 불러오지 못했으면 확인 화면 안내, 0회면 0회, 있으면 횟수·종류·날", () => {
    const db = empty();
    const e = (errors?: ErrorEntry[] | null) => item(db, 4, "feedback", errors).evidence[1];
    expect(e(null)).toMatchObject({ has: false });
    expect(e([])).toMatchObject({ label: "기록된 앱 오류", value: "0회", has: true });
    const err = (id: string, lastAt: string, count: number): ErrorEntry => ({ id, at: lastAt, lastAt, count, source: "client", userId: "u-field", role: "field", route: "/field", message: "x" });
    expect(e([err("a", "2026-11-02T01:00:00Z", 3), err("b", "2026-11-04T01:00:00Z", 1), err("c", "2026-10-20T01:00:00Z", 9)]).value).toBe("4회 (2종류 · 오류 난 날 2일)");
    // 서버가 최근 기록만 보냈으면(잘림) ‘이상’ — 0회로 잘못 보이지 않게
    expect(acceptanceItems(db, 4, FROM, TO, NOW, [], true).find((i) => i.key === "feedback")!.evidence[1].value).toMatch(/^0회 이상/);
  });

  it("운영 모드는 최근 활동 이력 300건만 실으므로, 기간 시작 전까지 실려 있지 않으면 ‘이상’으로 표시", () => {
    const db = empty();
    db.activityLogs = Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, at: "2026-11-04T01:00:00Z", by: "u-manager", type: i % 2 ? "progress" : "report", summary: "x" }));
    expect(value(db, 2, "S6", "기간 중 활동 이력").value).toMatch(/^300건 이상/);
    expect(value(db, 3, "S5", "공정 진척 기록").value).toMatch(/^150건 이상/);
    db.activityLogs = db.activityLogs.slice(0, 299);
    expect(value(db, 2, "S6", "기간 중 활동 이력").value).toBe("299건");
  });

  it("시연 데이터로도 2단계 핵심 근거(출근·보고·작업지시)가 잡힌다", () => {
    const db = createSeed(NOW);
    const from = "2026-10-23";
    const s1 = acceptanceItems(db, 2, from, TO, NOW).find((i) => i.key === "S1")!;
    const s3 = acceptanceItems(db, 2, from, TO, NOW).find((i) => i.key === "S3")!;
    expect(s1.evidence[0].has).toBe(true);
    expect(s3.evidence.find((x) => x.label === "현장 보고")!.has).toBe(true);
  });
});
