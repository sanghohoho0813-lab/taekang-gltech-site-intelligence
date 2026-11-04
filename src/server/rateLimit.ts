/**
 * 요청 횟수 제한 (서버 1대 기준 메모리 창) — 비밀번호 대입·과도한 요청을 늦춘다.
 * 서버리스에서는 인스턴스마다 따로 세므로 '완전한 차단'이 아니라 속도 저하 장치다.
 * 계정 단위 잠금(8회 실패 → 10분)은 DB에 있으므로 함께 동작한다.
 */
import { NextResponse, type NextRequest } from "next/server";

const buckets = new Map<string, number[]>();
const MAX_KEYS = 20_000;

export interface RateRule {
  /** 구분 이름 (login, setup, commands …) */
  name: string;
  limit: number;
  windowMs: number;
}

export const RULES = {
  login: { name: "login", limit: 30, windowMs: 10 * 60_000 },
  setup: { name: "setup", limit: 10, windowMs: 10 * 60_000 },
  password: { name: "password", limit: 10, windowMs: 10 * 60_000 },
  commands: { name: "commands", limit: 120, windowMs: 60_000 },
  members: { name: "members", limit: 60, windowMs: 60_000 },
  kioskPair: { name: "kioskPair", limit: 20, windowMs: 10 * 60_000 },
  kioskStatus: { name: "kioskStatus", limit: 120, windowMs: 60_000 },
  export: { name: "export", limit: 6, windowMs: 10 * 60_000 },
  pushTest: { name: "pushTest", limit: 5, windowMs: 10 * 60_000 },
} satisfies Record<string, RateRule>;

/** 이번 요청을 세고, 한도를 넘었으면 다시 시도할 수 있을 때까지 남은 초를 돌려준다 */
export function hit(rule: RateRule, who: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const key = `${rule.name}:${who}`;
  const from = now - rule.windowMs;
  const list = (buckets.get(key) ?? []).filter((t) => t > from);
  if (list.length >= rule.limit) {
    buckets.set(key, list);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + rule.windowMs - now) / 1000)) };
  }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > MAX_KEYS) prune(now);
  return { ok: true };
}

function prune(now: number) {
  for (const [k, list] of buckets) {
    if (!list.length || list[list.length - 1] < now - 10 * 60_000) buckets.delete(k);
    if (buckets.size <= MAX_KEYS / 2) break;
  }
}

/** 접속한 곳 (Vercel은 x-forwarded-for 첫 번째 값이 실제 접속 주소) */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim() || "local";
}

/** 한도를 넘었으면 429 응답, 아니면 null */
export function limited(rule: RateRule, who: string): NextResponse | null {
  const r = hit(rule, who);
  if (r.ok) return null;
  return NextResponse.json(
    { error: `요청이 너무 많습니다. ${r.retryAfter >= 60 ? `${Math.ceil(r.retryAfter / 60)}분` : `${r.retryAfter}초`} 뒤에 다시 시도해주세요.`, code: "RATE_LIMIT" },
    { status: 429, headers: { "Retry-After": String(r.retryAfter), "Cache-Control": "no-store" } },
  );
}

/** 테스트용 */
export function resetRateLimits() {
  buckets.clear();
}
