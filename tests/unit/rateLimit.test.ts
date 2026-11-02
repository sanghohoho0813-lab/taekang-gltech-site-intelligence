import { describe, expect, it } from "vitest";
import { hit, resetRateLimits, RULES } from "@/server/rateLimit";

describe("요청 횟수 제한", () => {
  it("한도까지는 통과, 넘으면 남은 시간과 함께 거부, 창이 지나면 다시 통과", () => {
    resetRateLimits();
    const rule = { name: "t", limit: 3, windowMs: 60_000 };
    const t0 = 1_000_000;
    expect(hit(rule, "ip1", t0).ok).toBe(true);
    expect(hit(rule, "ip1", t0 + 1).ok).toBe(true);
    expect(hit(rule, "ip1", t0 + 2).ok).toBe(true);
    const no = hit(rule, "ip1", t0 + 3);
    expect(no.ok).toBe(false);
    if (!no.ok) expect(no.retryAfter).toBe(60);
    // 다른 접속처는 따로 센다
    expect(hit(rule, "ip2", t0 + 3).ok).toBe(true);
    // 창(1분)이 지나면 다시 한도만큼 허용
    const t1 = t0 + 120_000;
    expect([hit(rule, "ip1", t1), hit(rule, "ip1", t1), hit(rule, "ip1", t1)].every((r) => r.ok)).toBe(true);
    expect(hit(rule, "ip1", t1).ok).toBe(false);
  });
  it("로그인은 접속처당 10분에 30번 — 계정 잠금(8회)과 함께 동작", () => {
    resetRateLimits();
    for (let i = 0; i < RULES.login.limit; i++) expect(hit(RULES.login, "1.2.3.4", 5_000 + i).ok).toBe(true);
    expect(hit(RULES.login, "1.2.3.4", 6_000).ok).toBe(false);
  });
});
