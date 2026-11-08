/**
 * 배포 후 점검 (npm run smoke) — 가짜 서버 응답으로 판정 규칙 확인 (D-44)
 * 실제 서버 대상 실행은 QA_REPORT 0-13 (로컬 LIVE 빌드)
 */
import { describe, expect, it } from "vitest";
import { smokeCheck, smokeSummary } from "../../scripts/smoke-lib.mjs";

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'; object-src 'none'";
const SECURE = {
  "content-security-policy": CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(self), camera=(self)",
  "x-robots-tag": "noindex, nofollow",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};
type Over = Partial<Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>>;

/** 정상 운영 서버를 흉내 — over로 특정 주소만 바꾼다 */
function server(over: Over = {}) {
  const base: Over = {
    "/api/health": { body: { ok: true, mode: "live", version: "abc1234", db: "ok", dbMs: 40, migrations: 1, push: "on" } },
    "/login": { status: 200, headers: SECURE },
    "/api/state": { status: 401 },
    "/api/export": { status: 401 },
    "/api/activity": { status: 401 },
    "/api/errors": { status: 401 },
    "/api/admin/members": { status: 401 },
    "/api/client-error": { status: 401 },
    "/api/commands": { status: 401 },
    "/api/cron/daily": { status: 401 },
    "/dashboard": { status: 307, headers: { location: "/login" } },
    "/api/setup": { body: { needsSetup: false, codeRequired: true } },
    "/sw.js": { headers: { "cache-control": "no-cache, max-age=0" } },
    "/manifest.webmanifest": { body: { name: "TAEKANG SITE INTELLIGENCE", short_name: "TAEKANG" } },
  };
  return async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    let r = { ...base[u.pathname], ...over[u.pathname] };
    // 다른 사이트 Origin → 403
    if (u.pathname === "/api/commands" && (init?.headers as Record<string, string>)?.Origin === "https://evil.example") r = { status: over["/api/commands"]?.status === 200 ? 200 : 403 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  };
}
const levels = (cs: { key: string; level: string }[]) => Object.fromEntries(cs.map((c) => [c.key, c.level]));

describe("배포 후 점검", () => {
  it("정상 운영 서버: 오류 0", async () => {
    const cs = await smokeCheck("https://taekang.example", server());
    const { errors, text } = smokeSummary(cs);
    expect(errors, text).toBe(0);
    expect(levels(cs)).toMatchObject({ https: "ok", mode: "ok", db: "ok", push: "ok", csp: "ok", headers: "ok", hsts: "ok", auth: "ok", origin: "ok", redirect: "ok", setup: "ok", sw: "ok", manifest: "ok", cron: "ok" });
  });

  it("매일 점검 예약 작업: 비밀값 없음은 경고, 비밀값 없이 열리면 오류 (D-71)", async () => {
    expect(levels(await smokeCheck("https://t.example", server({ "/api/cron/daily": { status: 503 } }))).cron).toBe("warn");
    expect(levels(await smokeCheck("https://t.example", server({ "/api/cron/daily": { status: 200 } }))).cron).toBe("error");
  });

  it("DEMO 빌드·DB 끊김·http·CSP 없음은 오류", async () => {
    expect(levels(await smokeCheck("https://t.example", server({ "/api/health": { body: { ok: true, mode: "demo" } } }))).mode).toBe("error");
    expect(levels(await smokeCheck("https://t.example", server({ "/api/health": { status: 503, body: { ok: false, mode: "live", db: "error" } } }))).db).toBe("error");
    expect(levels(await smokeCheck("http://t.example", server())).https).toBe("error");
    expect(levels(await smokeCheck("http://127.0.0.1:3000", server())).https).toBe("warn");
    expect(levels(await smokeCheck("https://t.example", server({ "/login": { headers: { ...SECURE, "content-security-policy": "" } } }))).csp).toBe("error");
    expect(levels(await smokeCheck("https://t.example", server({ "/login": { headers: { ...SECURE, "x-robots-tag": "" } } }))).headers).toBe("error");
  });

  it("로그인 없이 데이터가 열리면 오류 (어느 주소인지 알려줌)", async () => {
    const cs = await smokeCheck("https://t.example", server({ "/api/export": { status: 200, body: {} } }));
    expect(cs.find((c) => c.key === "auth")).toMatchObject({ level: "error", text: expect.stringContaining("/api/export → HTTP 200") });
    expect(levels(await smokeCheck("https://t.example", server({ "/dashboard": { status: 200 } }))).redirect).toBe("error");
  });

  it("최초 설정 전: 설정 코드가 있으면 안내, 없으면 오류 (아무나 대표 계정을 만들 수 있음)", async () => {
    expect(levels(await smokeCheck("https://t.example", server({ "/api/setup": { body: { needsSetup: true, codeRequired: true } } }))).setup).toBe("warn");
    const bad = await smokeCheck("https://t.example", server({ "/api/setup": { body: { needsSetup: true, codeRequired: false } } }));
    expect(bad.find((c) => c.key === "setup")).toMatchObject({ level: "error", text: expect.stringContaining("SETUP_CODE") });
  });

  it("서버 지역: 서울(icn1)이면 통과, 다른 지역이면 경고, 로컬은 표시 안 함 (D-56)", async () => {
    const at = (region?: string) => smokeCheck("https://t.example", server({ "/api/health": { body: { ok: true, mode: "live", version: "abc1234", db: "ok", dbMs: 40, migrations: 1, push: "on", ...(region ? { region } : {}) } } }));
    expect(levels(await at("icn1")).region).toBe("ok");
    const us = await at("iad1");
    expect(us.find((c) => c.key === "region")).toMatchObject({ level: "warn", text: expect.stringContaining("iad1") });
    expect(levels(await at("local")).region).toBeUndefined();
    expect(levels(await at()).region).toBeUndefined();
  });

  it("알림 키 없음·느린 DB는 경고, 접속 불가는 오류", async () => {
    const cs = await smokeCheck("https://t.example", server({ "/api/health": { body: { ok: true, mode: "live", db: "ok", dbMs: 3500, migrations: 1, push: "off" } } }));
    expect(levels(cs)).toMatchObject({ push: "warn", db: "warn" });
    const down = await smokeCheck("https://t.example", async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    expect(down.find((c) => c.key === "reach")).toMatchObject({ level: "error" });
    expect((await smokeCheck("not a url")).at(0)).toMatchObject({ key: "url", level: "error" });
  });
});
