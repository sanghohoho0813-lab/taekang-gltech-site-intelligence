/**
 * 현장 QR 출근 — 30초마다 바뀌는 코드
 * 코드 = 단말기 번호 . 현장 . 30초 구간 . 서명(단말기 비밀값으로 만든 HMAC)
 * - 집에서 GPS를 조작해도, 방금 현장 태블릿에 떠 있던 코드가 없으면 'QR 확인'이 되지 않는다.
 * - 태블릿은 인터넷이 끊겨도 코드를 만들 수 있다 (비밀값으로 스스로 계산).
 */
import type { DemoDB, Kiosk, QrStamp } from "./types";
import { b64url, hmacSha256, safeEqual, utf8 } from "./hmac";

export const QR_STEP_MS = 30_000;
/** 지난 구간 몇 개까지 인정할지 (찍고 출근 화면까지 시간 + 시계 오차) — 약 90초 */
export const QR_GRACE_STEPS = 2;

export function qrWindow(nowMs: number): number {
  return Math.floor(nowMs / QR_STEP_MS);
}

function sign(secret: string, kioskId: string, siteId: string, w: number): string {
  return b64url(hmacSha256(utf8(secret), utf8(`${kioskId}|${siteId}|${w}`))).slice(0, 22);
}

export function makeQrToken(k: Pick<Kiosk, "id" | "siteId"> & { secret: string }, nowMs: number): string {
  const w = qrWindow(nowMs);
  return `${k.id}.${k.siteId}.${w.toString(36)}.${sign(k.secret, k.id, k.siteId, w)}`;
}

/** QR 내용(주소 또는 코드)에서 코드만 꺼낸다 */
export function parseQrText(text: string): { token: string; kioskId: string; siteId: string; w: number; sig: string } | null {
  const raw = text.trim();
  const m = /\/q\/([A-Za-z0-9_.-]+)\/?$/.exec(raw);
  const token = m ? m[1] : raw;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [kioskId, siteId, w36, sig] = parts;
  const w = parseInt(w36, 36);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(kioskId) || !/^[A-Za-z0-9_-]{2,64}$/.test(siteId) || !Number.isFinite(w) || !/^[A-Za-z0-9_-]{22}$/.test(sig)) return null;
  return { token, kioskId, siteId, w, sig };
}

/** 서버 판정 — 출근하려는 현장의 활성 단말기가 방금 만든 코드인지 */
export function verifyQrToken(db: DemoDB, token: string, siteId: string, nowMs: number): QrStamp {
  const p = parseQrText(token);
  if (!p) return { status: "invalid" };
  const k = (db.kiosks ?? []).find((x) => x.id === p.kioskId);
  if (!k?.secret) return { status: "invalid" };
  if (k.revokedAt) return { status: "revoked", kioskId: k.id };
  if (!safeEqual(sign(k.secret, k.id, k.siteId, p.w), p.sig) || p.siteId !== k.siteId) return { status: "invalid", kioskId: k.id };
  if (k.siteId !== siteId) return { status: "wrong_site", kioskId: k.id };
  const now = qrWindow(nowMs);
  // 태블릿 시계가 조금 빠른 경우(+1)까지 허용, 지난 코드는 약 90초까지
  if (p.w > now + 1 || p.w < now - QR_GRACE_STEPS) return { status: "expired", kioskId: k.id };
  return { status: "ok", kioskId: k.id };
}

export const QR_LABEL: Record<QrStamp["status"], string> = {
  ok: "QR 확인",
  expired: "QR 만료",
  invalid: "QR 위조·오류",
  wrong_site: "다른 현장 QR",
  revoked: "해제된 단말기 QR",
};
