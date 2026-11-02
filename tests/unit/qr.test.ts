import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { sha256, hmacSha256, hex, utf8, b64url } from "@/lib/domain/hmac";
import { makeQrToken, parseQrText, verifyQrToken, QR_STEP_MS } from "@/lib/domain/qr";
import { createSeed } from "@/lib/data/seed";
import { checkIn, confirmQr, createKiosk, pairKiosk, revokeKiosk } from "@/lib/data/attendanceCommands";
import { CommandError } from "@/lib/data/commands";
import { dayFlags, periodSummary } from "@/lib/domain/attendance";

const NOW = new Date("2026-11-02T03:00:00Z"); // 12:00 KST
const ctx = (userId: string, now = NOW) => ({ userId, now });
const near = { lat: 37.2638, lng: 127.0289, accuracy: 15 };

describe("암호 계산 (태블릿·서버 공용)", () => {
  it("SHA-256·HMAC이 표준(Node crypto)과 같다", () => {
    for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "한글 현장 QR", "x".repeat(1000)]) {
      expect(hex(sha256(utf8(s)))).toBe(createHash("sha256").update(s).digest("hex"));
      for (const k of ["k", "a".repeat(64), "b".repeat(100)]) expect(hex(hmacSha256(utf8(k), utf8(s)))).toBe(createHmac("sha256", k).update(s).digest("hex"));
    }
    const b = sha256(utf8("q"));
    expect(b64url(b)).toBe(Buffer.from(b).toString("base64url"));
    expect(b64url(b.slice(0, 31))).toBe(Buffer.from(b.slice(0, 31)).toString("base64url"));
  });
});

describe("30초마다 바뀌는 현장 QR", () => {
  const db = createSeed(NOW);
  const k = db.kiosks!.find((x) => x.siteId === "site-a")!;
  const kio = { id: k.id, siteId: k.siteId, secret: k.secret! };
  const t = NOW.getTime();
  it("방금 만든 코드는 확인, 약 90초 지나면 만료", () => {
    const tok = makeQrToken(kio, t);
    expect(verifyQrToken(db, tok, "site-a", t)).toEqual({ status: "ok", kioskId: k.id });
    expect(verifyQrToken(db, tok, "site-a", t + 60_000).status).toBe("ok");
    expect(verifyQrToken(db, tok, "site-a", t + 4 * QR_STEP_MS).status).toBe("expired");
    // 시계가 많이 빠른 태블릿이 만든 미래 코드도 거부
    expect(verifyQrToken(db, makeQrToken(kio, t + 5 * QR_STEP_MS), "site-a", t).status).toBe("expired");
  });
  it("서명을 바꾸거나 다른 현장·해제된 단말기면 거부, 주소 형태도 읽는다", () => {
    const tok = makeQrToken(kio, t);
    const forged = tok.slice(0, -2) + (tok.endsWith("AA") ? "BB" : "AA");
    expect(verifyQrToken(db, forged, "site-a", t).status).toBe("invalid");
    expect(verifyQrToken(db, makeQrToken({ ...kio, secret: "guess" }, t), "site-a", t).status).toBe("invalid");
    expect(verifyQrToken(db, tok, "site-b", t).status).toBe("wrong_site");
    expect(parseQrText(`https://example.com/q/${tok}`)?.token).toBe(tok);
    expect(parseQrText("https://evil.example/hello")).toBeNull();
    const { db: revoked } = revokeKiosk(db, { kioskId: k.id }, ctx("u-manager"));
    expect(verifyQrToken(revoked, tok, "site-a", t).status).toBe("revoked");
  });
});

describe("단말기 등록·연결", () => {
  it("연결 코드는 30분 안에 한 번만 — 비밀값은 그때만 전달", () => {
    const db0 = createSeed(NOW);
    const { db, result } = createKiosk(db0, { siteId: "site-b" }, ctx("u-manager"));
    expect(result.pairCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    const saved = db.kiosks!.find((x) => x.id === result.kioskId)!;
    expect(saved.pairHash).not.toContain(result.pairCode); // 코드는 해시로만 저장
    expect(() => pairKiosk(db, { code: "WRONG234" }, ctx("system"))).toThrow(CommandError);
    expect(() => pairKiosk(db, { code: result.pairCode }, ctx("system", new Date(NOW.getTime() + 31 * 60_000)))).toThrow(CommandError);
    const p = pairKiosk(db, { code: result.pairCode.toLowerCase() }, ctx("system"));
    expect(p.result.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(p.result.siteId).toBe("site-b");
    expect(() => pairKiosk(p.db, { code: result.pairCode }, ctx("system"))).toThrow(CommandError); // 두 번째는 거부
  });
});

describe("QR 출근", () => {
  it("QR로 출근하면 서버가 확인해 남기고, QR 방식인데 QR이 없으면 본사에 표시", () => {
    const db0 = createSeed(NOW);
    db0.settings = { ...db0.settings!, attendanceMode: "qr" };
    const k = db0.kiosks!.find((x) => x.siteId === "site-a")!;
    const tok = makeQrToken({ id: k.id, siteId: k.siteId, secret: k.secret! }, NOW.getTime() - 20_000);
    const r = checkIn(db0, { siteId: "site-a", sample: near, consent: true, qrToken: tok }, ctx("u-field"));
    expect(r.result.qr?.status).toBe("ok");
    expect(r.db.kiosks!.find((x) => x.id === k.id)!.lastUsedAt).toBe(NOW.toISOString());
    expect(dayFlags(r.db, "2026-11-02", NOW).some((f) => f.kind === "no_qr" && f.userId === "u-field")).toBe(false);
    // 정우진(C현장)은 오늘 QR 없이 출근 → 표시
    expect(dayFlags(r.db, "2026-11-02", NOW).some((f) => f.kind === "no_qr" && f.userId === "u-field2")).toBe(true);
    expect(periodSummary(r.db, "2026-11-01", "2026-11-02").find((x) => x.userId === "u-field")!.qrOk).toBe(1);
  });
  it("QR 없이 먼저 출근했어도 나중에 QR로 확인 가능 — 만료된 QR은 거부", () => {
    const db0 = createSeed(NOW);
    const { db } = checkIn(db0, { siteId: "site-a", noLocation: "denied" }, ctx("u-field"));
    const k = db.kiosks!.find((x) => x.siteId === "site-a")!;
    const old = makeQrToken({ id: k.id, siteId: k.siteId, secret: k.secret! }, NOW.getTime() - 10 * 60_000);
    expect(() => confirmQr(db, { siteId: "site-a", qrToken: old }, ctx("u-field"))).toThrow(/만료/);
    const fresh = makeQrToken({ id: k.id, siteId: k.siteId, secret: k.secret! }, NOW.getTime());
    const ok = confirmQr(db, { siteId: "site-a", qrToken: fresh }, ctx("u-field"));
    expect(ok.db.attendance!.find((x) => x.userId === "u-field" && x.workDate === "2026-11-02")!.inQr?.status).toBe("ok");
  });
});
