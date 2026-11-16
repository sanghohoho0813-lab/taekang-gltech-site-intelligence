/** D-80 출퇴근 정리를 한 번에 — 같은 시간 두 현장 찾기·표시·한 번에 정정(하나라도 안 되면 전부 취소)·월 마감 연결 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { checkOut, correctAttendance, correctAttendanceBatch } from "@/lib/data/attendanceCommands";
import { requestAttendanceFix, reviewAttendanceFix } from "@/lib/data/opsCommands";
import { noticesFor } from "@/lib/domain/notify";
import { CommandError } from "@/lib/data/commands";
import { correctedTimes, dayFlags, minutesOf, overlapPairs, periodSummary } from "@/lib/domain/attendance";
import { monthClose } from "@/lib/domain/monthClose";
import { authorize, ForbiddenError } from "@/server/authz";
import type { Member } from "@/server/auth";
import type { AttendanceRecord, DemoDB } from "@/lib/domain/types";

const NOW = new Date("2026-11-16T03:00:00Z");
const ctx = (userId: string, now = NOW) => ({ userId, now });
const member = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c1", email: `${id}@t.test`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
/** 한국 시각 "2026-10-20 07:56" → ISO */
const k = (d: string, hm: string) => new Date(`${d}T${hm}:00+09:00`).toISOString();
const rec = (id: string, siteId: string, d: string, inHm: string, outHm?: string, userId = "u-field"): AttendanceRecord => ({ id, siteId, userId, workDate: d, inAt: k(d, inHm), inGeo: { status: "inside", distanceM: 30 } as never, ...(outHm ? { outAt: k(d, outHm), outGeo: { status: "inside", distanceM: 40 } as never } : {}) });
const err = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as CommandError;
  }
  throw new Error("오류가 나야 합니다");
};

/** 김도윤처럼: 오전 A(퇴근을 저녁에 누름) · 오후 B — 3일 */
function morningAfternoon(): DemoDB {
  const db = createSeed(NOW);
  db.attendance = ["2026-10-19", "2026-10-20", "2026-10-21"].flatMap((d, i) => [rec(`a${i}`, "site-a", d, "07:56", "17:49"), rec(`b${i}`, "site-b", d, "13:00", "17:00")]);
  return db;
}

describe("D-80 같은 시간 두 현장 찾기", () => {
  it("겹친 시간·정리안(앞 현장 퇴근 = 다음 현장 출근)·빠지는 뒤 시간을 계산한다", () => {
    const db = morningAfternoon();
    const ps = overlapPairs(db, "2026-10-01", "2026-10-31");
    expect(ps).toHaveLength(3);
    expect(ps[0]).toMatchObject({ userId: "u-field", workDate: "2026-10-19", minutes: 240, proposeOutAt: k("2026-10-19", "13:00"), tailLostMin: 49, manual: false });
    expect(ps[0].earlier.id).toBe("a0");
    expect(ps[0].later.id).toBe("b0");
    // 사람·기간으로 거른다
    expect(overlapPairs(db, "2026-10-20", "2026-10-20")).toHaveLength(1);
    expect(overlapPairs(db, "2026-10-01", "2026-10-31", "u-field2")).toHaveLength(0);
  });
  it("다음 현장 퇴근이 없거나 같은 시각에 시작하면 ‘직접 확인’", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("a", "site-a", "2026-10-20", "08:00", "17:00"), rec("b", "site-b", "2026-10-20", "13:00"), rec("c", "site-a", "2026-10-21", "08:00", "17:00"), rec("d", "site-b", "2026-10-21", "08:00", "12:00")];
    const ps = overlapPairs(db, "2026-10-01", "2026-10-31");
    expect(ps.map((p) => p.manual)).toEqual([true, true]);
  });
  it("출퇴근 현황 그날 의심 표시에 나온다 — 월 마감에만 보이고 ‘의심 없음’이던 문제", () => {
    const f = dayFlags(morningAfternoon(), "2026-10-20", NOW).filter((x) => x.kind === "overlap");
    expect(f).toHaveLength(1);
    expect(f[0].text).toContain("240분 겹침");
  });
  it("월 마감 ‘시간 겹침’ 항목에 그 사람 ‘겹침 정리’ 버튼", () => {
    const r = monthClose(morningAfternoon(), "2026-10", "2026-11-16");
    const it = r.items.find((x) => x.kind === "overlap")!;
    expect(it.action).toEqual({ kind: "fixOverlap", userId: "u-field" });
    expect(r.people.find((p) => p.row.userId === "u-field")!.overlap).toEqual(["2026-10-19", "2026-10-20", "2026-10-21"]);
  });
});

describe("D-80 한 번에 정정", () => {
  const items = (db: DemoDB) => overlapPairs(db, "2026-10-01", "2026-10-31").map((p) => ({ attendanceId: p.earlier.id, outAt: p.proposeOutAt }));
  it("겹친 3일을 한 번에 — 겹침이 없어지고 근무시간이 두 번 세지지 않는다 · 처음 시각과 사유가 이력에 남는다", () => {
    const db = morningAfternoon();
    const before = periodSummary(db, "2026-10-01", "2026-10-31", "2026-11-16").find((x) => x.userId === "u-field")!.minutes;
    const r = correctAttendanceBatch(db, { items: items(db), note: "오전 동탄·오후 판교 — 동탄 퇴근을 늦게 누름 (반장 확인)", idempotencyKey: "idem-d80-batch-0001" }, ctx("u-manager"));
    expect(r.result.corrected).toBe(3);
    expect(r.result.minutesBefore - r.result.minutesAfter).toBe(3 * (17 * 60 + 49 - 13 * 60));
    expect(overlapPairs(r.db, "2026-10-01", "2026-10-31")).toHaveLength(0);
    const a0 = r.db.attendance!.find((x) => x.id === "a0")!;
    expect(a0.outAt).toBe(k("2026-10-19", "13:00"));
    expect(a0.corrections!.at(-1)).toMatchObject({ by: "u-manager", note: "오전 동탄·오후 판교 — 동탄 퇴근을 늦게 누름 (반장 확인)", before: { outAt: k("2026-10-19", "17:49") } });
    const after = periodSummary(r.db, "2026-10-01", "2026-10-31", "2026-11-16").find((x) => x.userId === "u-field")!.minutes;
    expect(before - after).toBe(3 * 289);
    expect(monthClose(r.db, "2026-10", "2026-11-16").items.some((x) => x.kind === "overlap")).toBe(false);
    // 같은 요청 다시 보내기 — 중복
    expect(err(() => correctAttendanceBatch(r.db, { items: items(db), note: "다시", idempotencyKey: "idem-d80-batch-0001" }, ctx("u-manager"))).code).toBe("DUPLICATE");
  });
  it("하나라도 안 되면 아무것도 바꾸지 않는다 — 어느 날 누구 때문인지 알려 준다", () => {
    const db = morningAfternoon();
    const list = items(db);
    list[1] = { ...list[1], outAt: k("2026-10-20", "07:00") }; // 출근보다 이른 퇴근
    const e = err(() => correctAttendanceBatch(db, { items: list, note: "정리" }, ctx("u-manager")));
    expect(e.message).toContain("2026-10-20");
    expect(e.message).toContain("아무것도 바꾸지 않았습니다");
    // 원본 그대로
    expect(db.attendance!.find((x) => x.id === "a0")!.outAt).toBe(k("2026-10-19", "17:49"));
  });
  it("받지 않는 입력 — 0건·같은 기록 두 번·사유 없음·100건 초과", () => {
    const db = morningAfternoon();
    expect(err(() => correctAttendanceBatch(db, { items: [], note: "정리" }, ctx("u-manager"))).code).toBe("VALIDATION");
    expect(err(() => correctAttendanceBatch(db, { items: [{ attendanceId: "a0", outAt: k("2026-10-19", "13:00") }, { attendanceId: "a0", outAt: k("2026-10-19", "12:00") }], note: "정리" }, ctx("u-manager"))).message).toContain("두 번");
    expect(err(() => correctAttendanceBatch(db, { items: items(db), note: "" }, ctx("u-manager"))).message).toContain("사유");
    expect(err(() => correctAttendanceBatch(db, { items: Array.from({ length: 101 }, (_, i) => ({ attendanceId: `x${i}` })), note: "정리" }, ctx("u-manager"))).code).toBe("VALIDATION");
  });
  it("정리안대로 고쳐도 다른 기록과 겹치면 막는다 (한 건 정정과 같은 규칙)", () => {
    const db = morningAfternoon();
    // a0 퇴근을 14:00으로 → 판교 13:00~17:00과 여전히 겹침
    expect(err(() => correctAttendanceBatch(db, { items: [{ attendanceId: "a0", outAt: k("2026-10-19", "14:00") }], note: "정리" }, ctx("u-manager"))).message).toContain("겹칩니다");
  });
  it("본사만 — 현장 직원·발주처는 거절", () => {
    const db = morningAfternoon();
    const args = { items: items(db), note: "정리" };
    expect(() => authorize(member("u-manager", "manager"), "correctAttendanceBatch", args, db, NOW)).not.toThrow();
    expect(() => authorize(member("u-field", "field", { siteIds: ["site-a"] }), "correctAttendanceBatch", args, db, NOW)).toThrow(ForbiddenError);
    expect(() => authorize(member("u-partner", "partner", { partnerSiteIds: ["site-a"] }), "correctAttendanceBatch", args, db, NOW)).toThrow(ForbiddenError);
  });
});

describe("D-80 한 건 정정 — 출근 시각도", () => {
  it("출근 시각을 고칠 수 있고, 처음 누른 시각이 이력에 남는다", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("a", "site-a", "2026-11-13", "09:40", "18:00")];
    const r = correctAttendance(db, { attendanceId: "a", inAt: k("2026-11-13", "07:50"), outAt: k("2026-11-13", "18:00"), note: "출근 버튼 늦게 누름 — 반장 확인" }, ctx("u-manager")).db;
    const a = r.attendance![0];
    expect(a.inAt).toBe(k("2026-11-13", "07:50"));
    expect(a.corrections![0].before.inAt).toBe(k("2026-11-13", "09:40"));
    expect(minutesOf(a)).toBe(610);
  });
});

describe("D-80 점검 반영 — 정정 규칙", () => {
  it("시각을 숫자로 비교한다 — 다른 시간대 표기로 음수 근무·미래 퇴근을 만들 수 없다 (버그 배시 M1)", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("a", "site-a", "2026-11-10", "07:41", "18:00")];
    // 07:00 KST(+09:00) 퇴근 — 문자열로는 22:00Z > 22:41Z 처럼 보이지 않지만 실제로는 출근보다 이르다
    expect(err(() => correctAttendance(db, { attendanceId: "a", outAt: "2026-11-10T07:00:00+09:00", note: "시험" }, ctx("u-manager"))).fieldErrors.time).toContain("늦어야");
    // 지금(11/16 12:00 KST)보다 늦은 퇴근을 다른 시간대로 적어도 미래다
    db.attendance = [rec("b", "site-a", "2026-11-16", "07:50")];
    expect(err(() => correctAttendance(db, { attendanceId: "b", outAt: "2026-11-16T01:30:00-12:00", note: "시험" }, ctx("u-manager"))).fieldErrors.time).toContain("아직 오지 않은");
  });
  it("미래 출근 시각으로 고칠 수 없다 · 그 사이 다른 사람이 고쳤으면 덮어쓰지 않는다 (버그 배시 M2·m2)", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("b", "site-a", "2026-11-16", "07:50")];
    expect(err(() => correctAttendance(db, { attendanceId: "b", inAt: k("2026-11-16", "23:30"), note: "시험" }, ctx("u-manager"))).fieldErrors.time).toContain("아직 오지 않은");
    db.attendance = [rec("c", "site-a", "2026-11-13", "07:50", "17:00")];
    const first = correctAttendance(db, { attendanceId: "c", outAt: k("2026-11-13", "18:00"), note: "공무 A", expect: { inAt: k("2026-11-13", "07:50"), outAt: k("2026-11-13", "17:00") } }, ctx("u-manager")).db;
    expect(err(() => correctAttendance(first, { attendanceId: "c", outAt: k("2026-11-13", "16:00"), note: "공무 B", expect: { inAt: k("2026-11-13", "07:50"), outAt: k("2026-11-13", "17:00") } }, ctx("u-ceo"))).code).toBe("STATE");
  });
  it("정정 이력에 전·후가 남고, 본인이 나중에 누른 퇴근은 본사 정정으로 보이지 않는다 (버그 배시 m3)", () => {
    const db = createSeed(NOW);
    db.attendance = [];
    const asked = requestAttendanceFix(db, { siteId: "site-a", workDate: "2026-11-16", kind: "missed_in", inTime: "07:30", reason: "출근 못 누름" }, ctx("u-field")).db;
    const q = asked.attendanceRequests!.at(-1)!;
    const ok = reviewAttendanceFix(asked, { requestId: q.id, decision: "approve" }, ctx("u-manager")).db;
    const out = checkOut(ok, { siteId: "site-a" } as never, ctx("u-field")).db;
    const r = out.attendance!.find((x) => x.userId === "u-field" && x.workDate === "2026-11-16")!;
    expect(r.outAt).toBeTruthy();
    expect(correctedTimes(r).out).toBeUndefined();
  });
});

describe("D-80 점검 반영 — 일괄 정정·퇴근 버튼", () => {
  it("항목 순서와 관계없이 최종 모양으로 겹침을 본다 (버그 배시 m1)", () => {
    const db = morningAfternoon();
    // 판교 출근을 13:30으로 늦추고 동탄 퇴근을 13:30으로 — 순서를 바꿔도 결과가 같다
    const A = { attendanceId: "a0", outAt: k("2026-10-19", "13:30") };
    const B = { attendanceId: "b0", inAt: k("2026-10-19", "13:30") };
    expect(() => correctAttendanceBatch(db, { items: [B, A], note: "정리" }, ctx("u-manager"))).not.toThrow();
    expect(() => correctAttendanceBatch(db, { items: [A, B], note: "정리" }, ctx("u-manager"))).not.toThrow();
    expect(err(() => correctAttendanceBatch(db, { items: [null as never], note: "정리" }, ctx("u-manager"))).code).toBe("VALIDATION");
  });
  it("꼬리 붙이기 — 앞 현장 퇴근 = 다음 현장 출근, 다음 현장 퇴근 = 앞 현장 원래 퇴근: 겹침 없이 근무시간 유지", () => {
    const db = morningAfternoon();
    db.attendance = db.attendance!.map((r) => (r.id === "a0" ? { ...r, outGeo: { status: "inside" } as never } : r));
    const p = overlapPairs(db, "2026-10-19", "2026-10-19")[0];
    expect(p.returned).toBe(true);
    const before = periodSummary(db, "2026-10-19", "2026-10-19", "2026-11-16")[0].minutes;
    const r = correctAttendanceBatch(db, { items: [{ attendanceId: "a0", outAt: p.proposeOutAt }, { attendanceId: "b0", outAt: p.earlier.outAt! }], note: "오전 동탄·오후 판교·동탄 복귀" }, ctx("u-manager")).db;
    expect(overlapPairs(r, "2026-10-19", "2026-10-19")).toHaveLength(0);
    const after = periodSummary(r, "2026-10-19", "2026-10-19", "2026-11-16")[0].minutes;
    // 두 번 세던 240분만 빠지고, 동탄에 돌아간 49분은 남는다
    expect(before - after).toBe(240);
  });
  it("지난 날 열린 기록을 그 뒤 다른 출근이 있는데 퇴근으로 닫지 않는다 (버그 배시 M4)", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("old", "site-a", "2026-11-15", "08:00"), rec("today", "site-a", "2026-11-16", "07:50", "11:00")];
    expect(err(() => checkOut(db, { siteId: "site-a" } as never, ctx("u-field"))).code).toBe("STATE");
  });
  it("현장 직원 겹침 거절은 휴대폰용 말 (어느 현장 몇 시 · 본사 전화)", () => {
    const db = createSeed(NOW);
    db.attendance = [rec("a", "site-a", "2026-11-12", "09:00", "12:30"), rec("b", "site-b", "2026-11-12", "13:00", "18:00")];
    const e = err(() => requestAttendanceFix(db, { siteId: "site-b", workDate: "2026-11-12", kind: "wrong_time", inTime: "11:00", reason: "출근 시각 잘못" }, ctx("u-field")));
    expect(e.fieldErrors.time).toContain("09:00~12:30");
    expect(e.fieldErrors.time).toContain("본사에 전화");
  });
  it("본사가 고치면 그 직원에게 알림 하나 (근태 요청 승인은 따로)", () => {
    const db = morningAfternoon();
    const r = correctAttendanceBatch(db, { items: [{ attendanceId: "a0", outAt: k("2026-10-19", "13:00") }, { attendanceId: "a1", outAt: k("2026-10-20", "13:00") }], note: "정리" }, ctx("u-manager")).db;
    const ns = noticesFor(db, r, "u-manager").filter((n) => n.tag.startsWith("corr-"));
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ to: ["u-field"], url: "/my#my-corrections" });
    expect(ns[0].body).toContain("10/19 외 1일");
  });
});
