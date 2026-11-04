/**
 * 앱 의견·오류 기록 규칙 (D-47) — 의견 보내기·확인(보류 이유 필수)·알림, 개인정보 지우기, 기간 요약, 역할별 데이터
 */
import { describe, expect, it } from "vitest";
import { reviewFeedback, sendFeedback } from "@/lib/data/feedbackCommands";
import { CommandError } from "@/lib/data/commands";
import { createSeed } from "@/lib/data/seed";
import { qualitySummary, scrubRoute, scrubText, type ErrorEntry } from "@/lib/domain/feedback";
import { noticesFor } from "@/lib/domain/notify";
import { viewFor } from "@/server/authz";
import type { Member } from "@/server/auth";

const NOW = new Date("2026-11-04T03:00:00Z");
const F = { userId: "u-field", now: NOW };
const M = { userId: "u-manager", now: NOW };

describe("앱 의견", () => {
  it("보내기: 종류는 정해진 것만, 내용 300자, 중복 방지, 보낸 화면은 주소만", () => {
    const db = createSeed(NOW);
    const r = sendFeedback(db, { category: "photo", text: "  사진 올리기가 오래 걸려요  ", route: "/field/report?mode=photo#x", idempotencyKey: "fb-k1" }, F);
    const f = r.db.feedback!.find((x) => x.id === r.result.feedbackId)!;
    expect(f).toMatchObject({ userId: "u-field", category: "photo", text: "사진 올리기가 오래 걸려요", route: "/field/report", status: "new" });
    expect(r.db.activityLogs[0]).toMatchObject({ type: "feedback", summary: expect.stringContaining("사진이 잘 안 올라가요") });
    expect(() => sendFeedback(r.db, { category: "photo", idempotencyKey: "fb-k1" }, F)).toThrow(/중복/);
    for (const bad of [{ category: "angry" }, { category: "photo", text: "x".repeat(301) }, { category: "photo", text: 5 }]) expect(() => sendFeedback(db, bad as never, F)).toThrow(CommandError);
  });

  it("확인 전 의견이 30개 넘게 쌓이면 더 받지 않는다 (같은 사람)", () => {
    let db = createSeed(NOW);
    for (let i = 0; i < 29; i++) db = sendFeedback(db, { category: "other" }, F).db; // 시드 1개 + 29개 = 30
    expect(() => sendFeedback(db, { category: "other" }, F)).toThrow(/너무 많아요/);
  });

  it("본사 확인: 보류는 이유 필수, 반영하면 보낸 사람에게 알림(답변 포함), 확인 전으로 되돌리면 알림 없음", () => {
    const db = createSeed(NOW);
    expect(() => reviewFeedback(db, { feedbackId: "fb-seed-2", status: "hold" }, M)).toThrow(/이유/);
    const done = reviewFeedback(db, { feedbackId: "fb-seed-2", status: "done", reply: "지하 구간은 QR 출근을 쓰세요" }, M);
    expect(done.db.feedback!.find((f) => f.id === "fb-seed-2")).toMatchObject({ status: "done", reply: "지하 구간은 QR 출근을 쓰세요", reviewedBy: "u-manager" });
    expect(noticesFor(db, done.db, "u-manager")).toEqual([expect.objectContaining({ to: ["u-field"], title: "보내 주신 의견을 반영했어요", body: expect.stringContaining("QR 출근"), url: "/my" })]);
    const back = reviewFeedback(done.db, { feedbackId: "fb-seed-2", status: "new" }, M);
    expect(noticesFor(done.db, back.db, "u-manager")).toEqual([]);
    expect(() => reviewFeedback(db, { feedbackId: "nope", status: "done" }, M)).toThrow(CommandError);
  });

  it("역할별 데이터: 현장은 본인 의견만, 발주처는 없음", () => {
    const db = createSeed(NOW);
    const m = (id: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({ id, companyId: "c", email: `${id}@t`, name: id, title: "", role, siteIds: [], partnerSiteIds: [], active: true, mustChangePassword: false, ...extra });
    expect(viewFor(m("u-field", "field", { siteIds: ["site-a"] }), db, NOW).feedback!.map((f) => f.id)).toEqual(["fb-seed-2"]);
    expect(viewFor(m("u-partner", "partner", { partnerSiteIds: ["site-a"] }), db, NOW).feedback).toEqual([]);
    expect(viewFor(m("u-manager", "manager"), db, NOW).feedback).toHaveLength(2);
  });
});

describe("오류 문구의 개인정보 지우기", () => {
  it("이메일·전화·금액 같은 긴 숫자·토큰·사진 데이터·주소 뒤 검색어", () => {
    const s = scrubText("park@taekang.test 010-1234-5678 금액 150,000,000 토큰 abcdefghijklmnopqrstuvwxyz0123 data:image/png;base64,iVBORw0KGgo= https://x.test/a?email=p@q.r&k=1 TypeError at line 12:34", 300);
    expect(s).not.toMatch(/park@|1234-5678|150,000,000|abcdefghijklmnop|iVBOR|email=/);
    expect(s).toContain("[이메일]");
    expect(s).toContain("[숫자]");
    expect(s).toContain("[값]");
    expect(s).toContain("[데이터]");
    expect(s).toContain("https://x.test/a");
    expect(s).toContain("line 12:34");
    expect(scrubText("화면 오류 ".repeat(100), 200)).toHaveLength(200);
  });
  it("화면 주소는 경로만, 긴 번호는 [id]", () => {
    expect(scrubRoute("/sites/site-a?tab=cost")).toBe("/sites/site-a");
    expect(scrubRoute("/orders/wo-1a2b3c4d5e6f7a8b9c0d1e2f")).toBe("/orders/[id]");
    expect(scrubRoute("javascript:alert(1)")).toBe("/");
    expect(scrubRoute(undefined)).toBe("/");
  });
});

describe("기간 요약", () => {
  it("의견 반영·보류·확인 전, 오류 횟수(묶음 포함)·종류·화면/서버·오류 난 날", () => {
    const db = createSeed(NOW);
    const e = (id: string, at: string, count: number, source: ErrorEntry["source"]): ErrorEntry => ({ id, at, lastAt: at, count, source, userId: "u-field", role: "field", route: "/field", message: "x" });
    const s = qualitySummary(db.feedback!, [e("1", "2026-11-03T01:00:00Z", 3, "client"), e("2", "2026-11-03T05:00:00Z", 1, "server"), e("3", "2026-10-01T01:00:00Z", 9, "client")], "2026-10-28", "2026-11-04");
    expect(s.feedback).toEqual({ total: 2, done: 1, hold: 0, open: 1 });
    expect(s.errors).toEqual({ total: 4, kinds: 2, client: 3, server: 1, errorDays: 1 });
  });
});
