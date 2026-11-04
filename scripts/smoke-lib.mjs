/**
 * 배포 후 점검 (D-44) — 배포된 주소에 직접 접속해 운영 준비 상태를 ✅/⚠️/❌로 돌려준다.
 * 로그인하지 않고, 회사 데이터를 읽거나 쓰지 않는다 (읽기 요청과 ‘거부되어야 하는’ 요청만 보낸다).
 * 2단계 검수(테스트 URL) 직전·직후, 그리고 배포할 때마다 돌린다.
 */

/** @typedef {{ level: "ok" | "warn" | "error", key: string, text: string }} Check */

const isLocal = (u) => ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);

/**
 * @param {string} baseUrl 예) https://taekang.vercel.app
 * @param {(url: string, init?: RequestInit) => Promise<Response>} [fetchFn]
 * @returns {Promise<Check[]>}
 */
export async function smokeCheck(baseUrl, fetchFn = fetch) {
  /** @type {Check[]} */
  const out = [];
  const add = (level, key, text) => out.push({ level, key, text });
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    add("error", "url", "주소 형식이 올바르지 않습니다 (예: https://taekang.vercel.app)");
    return out;
  }
  base.pathname = "/";
  base.search = "";
  const at = (p) => new URL(p, base).toString();
  const local = isLocal(base);
  const get = async (p, init = {}) => {
    try {
      return await fetchFn(at(p), { redirect: "manual", ...init });
    } catch (e) {
      return { status: 0, headers: new Headers(), json: async () => null, text: async () => String(e?.message ?? e) };
    }
  };

  if (base.protocol === "https:") add("ok", "https", "HTTPS로 접속됩니다");
  else add(local ? "warn" : "error", "https", local ? "로컬 점검(http) — 운영 주소는 https여야 합니다" : "HTTPS가 아닙니다 — 비밀번호·위치가 암호화되지 않습니다");

  // 1) 서버·DB 상태
  const h = await get("/api/health");
  if (h.status === 0) {
    add("error", "reach", `서버에 접속할 수 없습니다 — ${(await h.text()).slice(0, 80)}`);
    return out;
  }
  const health = await h.json().catch(() => null);
  if (!health) add("error", "health", `상태 확인(/api/health) 응답이 없습니다 (HTTP ${h.status})`);
  else {
    if (health.mode !== "live") add("error", "mode", "시연(DEMO) 빌드가 배포되어 있습니다 — NEXT_PUBLIC_DATA_MODE=live로 다시 배포하세요");
    else add("ok", "mode", `운영 모드(live) · 버전 ${health.version ?? "?"}`);
    if (health.mode === "live") {
      if (h.status === 200 && health.db === "ok") add(health.dbMs > 2000 ? "warn" : "ok", "db", `DB 연결 정상 (${health.dbMs}ms${health.dbMs > 2000 ? " — 느림: DB 지역·연결 주소 확인" : ""}) · 스키마 ${health.migrations}개 적용`);
      else add("error", "db", "DB에 연결되지 않습니다 — DATABASE_URL(Supabase 연결 문자열)을 확인하세요");
      if (health.push === "off") add("warn", "push", "휴대폰 알림 키(VAPID)가 없습니다 — 알림 없이 동작합니다 (npm run vapid)");
      else if (health.push === "on") add("ok", "push", "휴대폰 알림 키 설정됨");
    }
  }

  // 2) 보안 헤더 (로그인 화면 기준)
  const page = await get("/login");
  const hd = (k) => page.headers.get(k) ?? "";
  const csp = hd("content-security-policy");
  if (/default-src 'self'/.test(csp) && /frame-ancestors 'self'/.test(csp) && /object-src 'none'/.test(csp)) add("ok", "csp", "보안 정책(CSP): 외부 스크립트·연결 차단, 다른 사이트 안에 넣기 차단");
  else add("error", "csp", "보안 정책(CSP) 헤더가 없거나 약합니다 — 운영 빌드(next build)로 배포했는지 확인하세요");
  const missing = [
    ["x-content-type-options", /nosniff/i, "X-Content-Type-Options"],
    ["referrer-policy", /strict-origin/i, "Referrer-Policy"],
    ["permissions-policy", /geolocation=\(self\)/, "Permissions-Policy(위치는 이 사이트만)"],
    ["x-robots-tag", /noindex/i, "X-Robots-Tag(검색 노출 차단)"],
  ].filter(([k, re]) => !re.test(hd(k)));
  if (missing.length) add("error", "headers", `보안 헤더 빠짐: ${missing.map((m) => m[2]).join(", ")}`);
  else add("ok", "headers", "보안 헤더(형식 추측 차단·주소 노출 최소화·위치 권한·검색 차단) 정상");
  if (base.protocol === "https:") {
    if (/max-age=\d{7,}/.test(hd("strict-transport-security"))) add("ok", "hsts", "HSTS: 다음 접속부터 항상 https");
    else add("warn", "hsts", "HSTS 헤더가 없습니다");
  }
  if (hd("x-powered-by")) add("warn", "powered", "서버 종류(X-Powered-By)가 노출됩니다");

  // 3) 로그인 없이 회사 데이터 차단
  const blocked = [];
  for (const [p, init] of [
    ["/api/state", {}],
    ["/api/export", {}],
    ["/api/activity?from=2026-01-01&to=2026-12-31", {}],
    ["/api/errors", {}],
    ["/api/admin/members", {}],
    ["/api/client-error", { method: "POST", headers: { "Content-Type": "application/json", Origin: base.origin }, body: JSON.stringify({ message: "smoke" }) }],
    ["/api/commands", { method: "POST", headers: { "Content-Type": "application/json", Origin: base.origin }, body: JSON.stringify({ name: "setThresholds", args: {} }) }],
  ]) {
    const r = await get(p, init);
    if (r.status !== 401 && r.status !== 403) blocked.push(`${p.split("?")[0]} → HTTP ${r.status}`);
  }
  if (blocked.length) add("error", "auth", `로그인 없이 열리는 데이터 주소가 있습니다: ${blocked.join(", ")}`);
  else add("ok", "auth", "로그인 없이는 회사 데이터·백업·활동 이력·오류 기록·사용자 목록·쓰기 요청이 모두 거부됩니다");
  const foreign = await get("/api/commands", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
  if (foreign.status === 403) add("ok", "origin", "다른 사이트에서 보낸 쓰기 요청 차단");
  else add("error", "origin", `다른 사이트에서 보낸 쓰기 요청이 차단되지 않습니다 (HTTP ${foreign.status})`);

  // 4) 화면 접근: 로그인 안 한 사람은 로그인 화면으로
  const home = await get("/dashboard");
  const loc = home.headers.get("location") ?? "";
  if ([301, 302, 303, 307, 308].includes(home.status) && loc.includes("/login")) add("ok", "redirect", "로그인 안 한 사람은 로그인 화면으로 이동");
  else add("error", "redirect", `로그인 없이 대시보드가 열립니다 (HTTP ${home.status})`);

  // 5) 최초 설정 상태
  const setup = await (await get("/api/setup")).json().catch(() => null);
  if (!setup) add("warn", "setup", "최초 설정 상태를 확인하지 못했습니다");
  else if (!setup.needsSetup) add("ok", "setup", "최초 설정 완료 (회사·대표 계정 있음)");
  else if (setup.codeRequired) add("warn", "setup", "아직 최초 설정 전입니다 — /setup에서 설정 코드(SETUP_CODE)로 대표 계정을 만드세요");
  else add(local ? "warn" : "error", "setup", "최초 설정 전인데 설정 코드(SETUP_CODE)가 없습니다 — 주소를 아는 누구나 대표 계정을 먼저 만들 수 있습니다");

  // 6) 휴대폰 앱 파일
  const sw = await get("/sw.js");
  if (sw.status === 200 && /no-cache/.test(sw.headers.get("cache-control") ?? "")) add("ok", "sw", "알림용 서비스 워커: 항상 새 파일로 받음");
  else add("warn", "sw", `서비스 워커(/sw.js) 확인 필요 (HTTP ${sw.status})`);
  const mf = await (await get("/manifest.webmanifest")).json().catch(() => null);
  if (mf?.name) add("ok", "manifest", `홈 화면 추가 정보: ${mf.short_name ?? mf.name}`);
  else add("warn", "manifest", "홈 화면 추가 정보(manifest)를 읽지 못했습니다");

  return out;
}

/** @param {Check[]} checks */
export function smokeSummary(checks) {
  const icon = { ok: "✅", warn: "⚠️ ", error: "❌" };
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  const lines = checks.map((c) => `${icon[c.level]} ${c.text}`);
  lines.push("", errors ? `❌ 고쳐야 할 항목 ${errors}개${warns ? ` · 확인 권장 ${warns}개` : ""}` : warns ? `⚠️  확인 권장 ${warns}개 — 운영 가능` : "✅ 배포 후 점검 통과");
  return { text: lines.join("\n"), errors, warns };
}
