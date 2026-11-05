/**
 * 통신 불량 출퇴근 (D-55) — 기록은 서버가 받은 시각, 휴대폰의 ‘누른 시각’은 자동 근태 수정 요청(본사 승인)으로만
 */
import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/data/seed";
import { currentTerms } from "@/lib/domain/privacy";
import { checkIn, checkOut, sentLaterAt } from "@/lib/data/attendanceCommands";
import { requestAttendanceFix, reviewAttendanceFix } from "@/lib/data/opsCommands";
import { CommandError } from "@/lib/data/commands";
import { dayFlags } from "@/lib/domain/attendance";
import { flushWith, sendOrder, withoutLocation, type OutboxItem, type OutboxStore } from "@/lib/browser/outbox";
import type { DemoDB } from "@/lib/domain/types";

// 2026-11-02 08:00 KST에 서버가 받음
const RECEIVED = new Date("2026-11-01T23:00:00Z");
const ctx = (userId: string, now = RECEIVED) => ({ userId, now });
const near = { lat: 37.2638, lng: 127.0289, accuracy: 15 };
const at = (kstHm: string, date = "2026-11-02") => new Date(`${date}T${kstHm}:00+09:00`).toISOString();

function base(): DemoDB {
  const db = createSeed(RECEIVED);
  return { ...db, attendance: [], attendanceRequests: [] };
}
const inArgs = (db: DemoDB, pressedAt?: string, key?: string) => ({ siteId: "site-a", sample: near, consent: true, consentTerms: currentTerms(db), pressedAt, ...(key ? { idempotencyKey: key } : {}) });

describe("누른 시각 인정 범위", () => {
  it("받은 시각보다 2분 넘게 이르고 12시간 안일 때만 (미래·너무 오래됨·형식 오류는 무시)", () => {
    const r = RECEIVED.toISOString();
    expect(sentLaterAt(at("07:28"), r)).toBe(at("07:28"));
    expect(sentLaterAt(at("07:59"), r)).toBeNull(); // 1분 — 그냥 바로 보낸 것
    expect(sentLaterAt(at("08:30"), r)).toBeNull(); // 미래
    expect(sentLaterAt(at("19:00", "2026-11-01"), r)).toBeNull(); // 13시간 전
    expect(sentLaterAt("어제 아침", r)).toBeNull();
    expect(sentLaterAt(12345, r)).toBeNull();
  });
});

describe("통신 불량 출근·퇴근", () => {
  it("출근: 기록은 서버 시각, 누른 시각은 자동 요청(확인 대기) · 본사 화면 표시", () => {
    const db0 = base();
    const { db, result } = checkIn(db0, inArgs(db0, at("07:28")), ctx("u-field"));
    expect(result.sentLater).toBe(true);
    const rec = db.attendance!.find((r) => r.id === result.attendanceId)!;
    expect(rec.inAt).toBe(RECEIVED.toISOString()); // 휴대폰 시계를 믿지 않는다
    expect(rec.inSentLater?.pressedAt).toBe(at("07:28"));
    const q = db.attendanceRequests!.find((x) => x.id === rec.inSentLater!.requestId)!;
    expect(q).toMatchObject({ kind: "wrong_time", inTime: "07:28", status: "pending", auto: "offline", attendanceId: rec.id, workDate: "2026-11-02" });
    expect(q.reason).toContain("출근 07:28에 눌렀는데 통신이 안 돼 08:00에 전송");
    const f = dayFlags(db, "2026-11-02", RECEIVED).filter((x) => x.kind === "sent_later");
    expect(f).toHaveLength(1);
    expect(f[0].text).toContain("07:28에 눌렀는데");
    expect(db.activityLogs.some((l) => /통신 불량 출근 — 누른 시각 07:28/.test(l.summary))).toBe(true);
  });

  it("출근·퇴근 둘 다 통신 불량인 날은 요청 하나에 합친다 → 승인하면 누른 시각으로, 표시는 사라짐", () => {
    const db0 = base();
    let db = checkIn(db0, inArgs(db0, at("07:28")), ctx("u-field")).db;
    const later = new Date("2026-11-02T09:10:00Z"); // 18:10 KST
    const out = checkOut(db, { siteId: "site-a", sample: near, pressedAt: at("17:31") }, ctx("u-field", later));
    db = out.db;
    const pend = db.attendanceRequests!.filter((q) => q.status === "pending");
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ inTime: "07:28", outTime: "17:31", auto: "offline" });
    const rec = db.attendance!.find((r) => r.id === out.result.attendanceId)!;
    expect(rec.outAt).toBe(later.toISOString());
    expect(rec.outSentLater?.requestId).toBe(pend[0].id);
    expect(dayFlags(db, "2026-11-02", later).filter((x) => x.kind === "sent_later")).toHaveLength(2);

    const ok = reviewAttendanceFix(db, { requestId: pend[0].id, decision: "approve" }, ctx("u-manager", later)).db;
    const fixed = ok.attendance!.find((r) => r.id === rec.id)!;
    expect(fixed.inAt).toBe(at("07:28"));
    expect(fixed.outAt).toBe(at("17:31"));
    expect(fixed.corrections?.[0].before).toEqual({ inAt: RECEIVED.toISOString(), outAt: later.toISOString() });
    expect(dayFlags(ok, "2026-11-02", later).filter((x) => x.kind === "sent_later")).toHaveLength(0);
  });

  it("반려하면 기록은 서버 시각 그대로, 표시는 사라짐", () => {
    const db0 = base();
    const { db, result } = checkIn(db0, inArgs(db0, at("07:28")), ctx("u-field"));
    const rid = db.attendance!.find((r) => r.id === result.attendanceId)!.inSentLater!.requestId!;
    const no = reviewAttendanceFix(db, { requestId: rid, decision: "reject", note: "현장소장 확인 — 08시 도착" }, ctx("u-manager")).db;
    expect(no.attendance!.find((r) => r.id === result.attendanceId)!.inAt).toBe(RECEIVED.toISOString());
    expect(dayFlags(no, "2026-11-02", RECEIVED).filter((x) => x.kind === "sent_later")).toHaveLength(0);
  });

  it("직원이 직접 낸 요청이 기다리는 중이면 자동 요청을 만들지 않고, 본사 화면 표시로 알린다", () => {
    const db0 = base();
    let db = checkIn(db0, { siteId: "site-a", sample: near, consent: true, consentTerms: currentTerms(db0) }, ctx("u-field", new Date("2026-11-01T22:00:00Z"))).db;
    db = requestAttendanceFix(db, { siteId: "site-a", workDate: "2026-11-02", kind: "gps_issue", reason: "위치가 이상해요" }, ctx("u-field", new Date("2026-11-01T22:30:00Z"))).db;
    const out = checkOut(db, { siteId: "site-a", sample: near, pressedAt: at("12:00") }, ctx("u-field", new Date("2026-11-02T04:00:00Z")));
    expect(out.db.attendanceRequests!.filter((q) => q.status === "pending")).toHaveLength(1); // 직원 요청 하나만
    const rec = out.db.attendance!.find((r) => r.id === out.result.attendanceId)!;
    expect(rec.outSentLater).toEqual({ pressedAt: at("12:00") });
    const f = dayFlags(out.db, "2026-11-02", new Date("2026-11-02T04:00:00Z")).find((x) => x.kind === "sent_later")!;
    expect(f.text).toContain("확인 후 정정");
  });

  it("너무 늦게 도착(12시간 넘음·출근인데 누른 날이 오늘 아님)하면 받지 않고 수정 요청으로 안내 — 받은 시각으로 조용히 기록하지 않는다 (리뷰 반영)", () => {
    const db0 = base();
    // 자정을 넘겨 도착: 11/1 23:55에 누른 출근이 11/2 00:10에 도착
    expect(() => checkIn(db0, inArgs(db0, at("23:55", "2026-11-01")), ctx("u-field", new Date("2026-11-01T15:10:00Z")))).toThrow(/너무 늦게 도착.*수정 요청/);
    // (a) 하루 종일 지하: 07:00 출근·18:00 퇴근을 19:30에야 보냄 → 출근 12.5시간 → 거부 (0분짜리 기록을 만들지 않음)
    const late = new Date("2026-11-02T10:30:00Z"); // 19:30
    expect(() => checkIn(db0, inArgs(db0, at("07:00")), ctx("u-field", late))).toThrow(/너무 늦게/);
    // (b) 퇴근을 다음 날 아침에야 보냄 → 거부 (근무 23시간으로 부풀지 않음, ‘퇴근 기록 없음’으로 남아 본사가 정정)
    const d = checkIn(db0, inArgs(db0), ctx("u-field")).db; // 11/2 08:00 정상 출근
    expect(() => checkOut(d, { siteId: "site-a", sample: near, pressedAt: at("17:00") }, ctx("u-field", new Date("2026-11-02T22:50:00Z")))).toThrow(/너무 늦게/);
    // 출근보다 앞선 퇴근 ‘누른 시각’(휴대폰 시계 틀림)도 조용히 받지 않는다
    expect(() => checkOut(d, { siteId: "site-a", sample: near, pressedAt: at("07:30") }, ctx("u-field", new Date("2026-11-02T09:00:00Z")))).toThrow(/출근보다 앞서/);
  });

  it("승인해도 위치 의심 표시(현장 밖)는 남는다 — 누른 시각만 확인한 것 (리뷰 반영)", () => {
    const db0 = base();
    const far = { lat: 37.29, lng: 127.06, accuracy: 10 };
    const { db, result } = checkIn(db0, { ...inArgs(db0, at("07:40")), sample: far }, ctx("u-field"));
    const kinds = () => dayFlags(db, "2026-11-02", RECEIVED).filter((f) => f.recordId === result.attendanceId).map((f) => f.kind);
    expect(kinds()).toEqual(expect.arrayContaining(["sent_later", "outside"]));
    const rid = db.attendance!.find((r) => r.id === result.attendanceId)!.inSentLater!.requestId!;
    const ok = reviewAttendanceFix(db, { requestId: rid, decision: "approve" }, ctx("u-manager")).db;
    const after = dayFlags(ok, "2026-11-02", RECEIVED).filter((f) => f.recordId === result.attendanceId).map((f) => f.kind);
    expect(after).toContain("outside");
    expect(after).not.toContain("sent_later");
    expect(ok.attendance!.find((r) => r.id === result.attendanceId)!.exceptionNote).toBeUndefined();
  });

  it("저장한 뒤 회사가 위치 기록 조건을 바꿨으면: 출퇴근은 막지 않고 위치 없이 기록 (바로 누른 출근은 지금처럼 다시 동의)", () => {
    let db = base();
    db = checkIn(db, inArgs(db), ctx("u-field")).db; // 동의하고 출근
    db = checkOut(db, { siteId: "site-a", sample: near }, ctx("u-field", new Date("2026-11-02T09:00:00Z"))).db;
    // 다음 날: 동의한 직원이 지하에서 출근(좌표만, 동의 표시 없이 저장) → 그 사이 대표가 보관 기간을 정함
    db = { ...db, settings: { ...db.settings!, location: { retentionDays: 90, viewers: "hq" } } } as DemoDB;
    const next = new Date("2026-11-02T23:20:00Z"); // 11/3 08:20
    const queued = checkIn(db, { siteId: "site-a", sample: near, pressedAt: "2026-11-02T23:00:00.000Z" }, ctx("u-field", next));
    const rec = queued.db.attendance!.find((r) => r.id === queued.result.attendanceId)!;
    expect(rec.inGeo.status).toBe("none");
    expect(rec.inGeo).not.toHaveProperty("lat");
    expect(rec.inSentLater?.requestId).toBeTruthy();
    expect(() => checkIn(db, { siteId: "site-a", sample: near }, ctx("u-field", next))).toThrow(/동의/);
  });

  it("요청 없이 표시만 된 기록은 본사가 도착 뒤 정정하면 표시가 사라진다 · 자동 요청이 기다리는 날의 직원 요청은 그 이유를 알려 준다", () => {
    const db0 = base();
    let db = checkIn(db0, { siteId: "site-a", sample: near, consent: true, consentTerms: currentTerms(db0) }, ctx("u-field", new Date("2026-11-01T22:00:00Z"))).db;
    db = requestAttendanceFix(db, { siteId: "site-a", workDate: "2026-11-02", kind: "gps_issue", reason: "위치가 이상해요" }, ctx("u-field", new Date("2026-11-01T22:30:00Z"))).db;
    const out = checkOut(db, { siteId: "site-a", sample: near, pressedAt: at("12:00") }, ctx("u-field", new Date("2026-11-02T04:00:00Z")));
    const manual = out.db.attendanceRequests!.find((q) => q.status === "pending")!;
    const done = reviewAttendanceFix(out.db, { requestId: manual.id, decision: "approve" }, ctx("u-manager", new Date("2026-11-02T05:00:00Z"))).db;
    expect(dayFlags(done, "2026-11-02", new Date("2026-11-02T05:00:00Z")).filter((f) => f.kind === "sent_later")).toHaveLength(0);

    const db1 = base();
    const auto = checkIn(db1, inArgs(db1, at("07:28")), ctx("u-field")).db;
    expect(() => requestAttendanceFix(auto, { siteId: "site-a", workDate: "2026-11-02", kind: "gps_issue", reason: "위치가 이상해요" }, ctx("u-field"))).toThrow(/통신 불량으로 자동 등록/);
  });

  it("응답만 끊겼던 출근을 같은 키로 다시 보내면 ‘중복’ — 기록은 하나", () => {
    const db0 = base();
    const { db } = checkIn(db0, inArgs(db0, undefined, "att-in-k1"), ctx("u-field"));
    expect(() => checkIn(db, inArgs(db, at("07:50"), "att-in-k1"), ctx("u-field", new Date("2026-11-01T23:05:00Z")))).toThrow(/중복/);
    expect(db.attendance).toHaveLength(1);
  });
});

describe("휴대폰 보관함 — 출근 → 퇴근 순서로 보내기", () => {
  it("휴대폰 시계가 바뀌어도 같은 현장 출근이 먼저 · 출근이 거부되면 그 현장 퇴근은 보내지 않고, 보낼 수 없는 기록의 좌표는 지운다 (리뷰 반영)", async () => {
    const mem = new Map<string, OutboxItem>();
    const store: OutboxStore = { all: async () => [...mem.values()], put: async (i) => void mem.set(i.id, i), remove: async (id) => void mem.delete(id) };
    const mk = (id: string, name: OutboxItem["name"], createdAt: string): OutboxItem => ({ id, userId: "u-field", name, args: { siteId: "site-a", sample: near, consent: true }, label: id, createdAt, tries: 0 });
    // 시계가 뒤로 바뀌어 퇴근이 더 이른 시각으로 저장됨
    await store.put(mk("in", "checkIn", "2026-11-02T08:00:00Z"));
    await store.put(mk("out", "checkOut", "2026-11-02T07:00:00Z"));
    expect(sendOrder([...mem.values()]).map((i) => i.id)).toEqual(["in", "out"]);
    const calls: string[] = [];
    const r = await flushWith(store, "u-field", async (name) => {
      calls.push(name);
      throw new CommandError("너무 늦게 도착해 기록하지 않았어요", "STATE");
    });
    expect(calls).toEqual(["checkIn"]); // 퇴근은 보내지 않음
    expect(r).toMatchObject({ sent: 0, failed: 2 });
    expect(mem.get("out")!.failed).toContain("앞의 출근이 기록되지 않아");
    for (const id of ["in", "out"]) expect(mem.get(id)!.args).toMatchObject({ sample: null, noLocation: "skipped" });
    expect(mem.get("in")!.args).not.toHaveProperty("consent");
    expect(withoutLocation({ siteId: "x", sample: near, consent: true, consentTerms: {} })).toEqual({ siteId: "x", sample: null, noLocation: "skipped" });
  });

  it("만든 순서대로, ‘중복’은 보낸 것으로, 서버가 거부하면 이유를 남긴다", async () => {
    const mem = new Map<string, OutboxItem>();
    const store: OutboxStore = { all: async () => [...mem.values()], put: async (i) => void mem.set(i.id, i), remove: async (id) => void mem.delete(id) };
    const mk = (id: string, name: OutboxItem["name"], createdAt: string): OutboxItem => ({ id, userId: "u-field", name, args: { siteId: "site-a" }, label: id, createdAt, tries: 0 });
    await store.put(mk("out", "checkOut", "2026-11-02T08:30:00Z"));
    await store.put(mk("in", "checkIn", "2026-11-01T22:28:00Z"));
    const calls: string[] = [];
    const r = await flushWith(store, "u-field", async (name) => {
      calls.push(name);
      if (name === "checkIn") throw new CommandError("이미 저장된 요청입니다. (중복 저장 방지)", "DUPLICATE");
      throw new CommandError("오늘 이 현장의 출근 기록이 없습니다.", "STATE");
    });
    expect(calls).toEqual(["checkIn", "checkOut"]);
    expect(r).toMatchObject({ sent: 1, failed: 1, waiting: 0, offline: false });
    expect(mem.get("out")?.failed).toContain("출근 기록이 없습니다");
  });
});
