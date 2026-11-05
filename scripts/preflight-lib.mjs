/**
 * 배포 전 자동 점검 (D-33) — 서버 설정값과 DB 상태를 확인해 ✅/⚠️/❌ 목록으로 돌려준다.
 * 값(비밀번호·연결 문자열)은 결과에 절대 넣지 않는다.
 */

/** @typedef {{ level: "ok" | "warn" | "error", key: string, text: string }} Check */

const TABLES = ["companies", "company_state", "members", "sessions", "records", "photo_blobs", "schema_migrations"];

/**
 * 환경변수 점검 (DB에 연결하지 않음)
 * @param {Record<string, string | undefined>} env
 * @returns {Check[]}
 */
export function checkEnv(env) {
  /** @type {Check[]} */
  const out = [];
  const add = (level, key, text) => out.push({ level, key, text });
  const prodLike = env.VERCEL === "1" || env.NODE_ENV === "production" || env.PREFLIGHT_TARGET === "production";

  if (env.NEXT_PUBLIC_DATA_MODE === "live") add("ok", "mode", "운영 모드(live)로 빌드됩니다");
  else add(prodLike ? "error" : "warn", "mode", "NEXT_PUBLIC_DATA_MODE가 live가 아닙니다 — 시연(DEMO) 화면으로 배포됩니다");

  const url = (env.DATABASE_URL ?? "").trim();
  if (!url) add("error", "db-url", "DATABASE_URL이 없습니다 — Supabase 연결 문자열을 넣어 주세요");
  else if (url.startsWith("pglite:")) add(prodLike ? "error" : "warn", "db-url", "내장 DB(PGlite)입니다 — 운영 배포에는 Supabase Postgres를 쓰세요");
  else {
    let u = null;
    try {
      u = new URL(url);
    } catch {
      add("error", "db-url", "DATABASE_URL 형식이 올바르지 않습니다 (postgres://… 형태)");
    }
    if (u) {
      if (!/^postgres(ql)?:$/.test(u.protocol)) add("error", "db-url", "DATABASE_URL은 postgres:// 로 시작해야 합니다");
      else add("ok", "db-url", `Postgres 연결 문자열 (${u.hostname.replace(/^[^.]+/, "…")})`);
      const pooler = /pooler\.supabase\.com$/.test(u.hostname);
      if (pooler && u.port === "6543") add("ok", "db-pool", "Supabase 트랜잭션 풀러(6543) — 서버리스에 맞음");
      else if (/supabase\.(co|com)$/.test(u.hostname)) add("warn", "db-pool", "Supabase 직접 연결입니다 — Vercel(서버리스)에서는 트랜잭션 풀러(포트 6543) 주소를 권장합니다");
      // Supabase 풀러 주소에는 지역이 들어 있다 (예: aws-0-ap-northeast-2) — 서버(Vercel icn1 서울)와 같은 지역이어야 빠르다 (D-56)
      const region = /aws-\d+-([a-z]{2}-[a-z]+-\d)\./.exec(u.hostname)?.[1];
      if (region === "ap-northeast-2") add("ok", "db-region", "DB 지역: 서울(ap-northeast-2) — 서버 지역(icn1)과 같음");
      else if (region) add("warn", "db-region", `DB 지역이 ${region}입니다 — 서버는 서울(icn1)이라 오가는 데 시간이 걸립니다. 새 프로젝트를 서울(Northeast Asia (Seoul))로 만드는 것을 권장합니다`);
      const ssl = u.searchParams.get("sslmode");
      if (!ssl || ssl === "disable" || ssl === "allow" || ssl === "prefer") add("warn", "db-ssl", "연결 문자열에 sslmode=require를 붙이는 것을 권장합니다 (암호화 연결 강제)");
      else add("ok", "db-ssl", `암호화 연결 (sslmode=${ssl})`);
    }
  }

  // 브라우저로 나가는 NEXT_PUBLIC_ 값에 비밀이 섞이지 않았는지
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("NEXT_PUBLIC_") || k === "NEXT_PUBLIC_DATA_MODE") continue;
    if (/KEY|SECRET|PASSWORD|TOKEN|DATABASE/i.test(k) || /postgres(ql)?:\/\//i.test(String(v ?? ""))) add("error", "public-leak", `${k} — 브라우저에 그대로 공개되는 변수입니다. 비밀값이면 NEXT_PUBLIC_을 빼세요`);
  }
  if (!out.some((c) => c.key === "public-leak")) add("ok", "public-leak", "브라우저 공개 변수에 비밀값 없음");

  const code = (env.SETUP_CODE ?? "").trim();
  if (!code) add("warn", "setup-code", "SETUP_CODE가 없습니다 — 최초 설정 전이라면 꼭 넣어 주세요 (Vercel에서는 없으면 최초 설정이 거부됩니다). 설정을 마쳤다면 무시");
  else if (code.length < 8) add("warn", "setup-code", "SETUP_CODE가 짧습니다 — 8자 이상 권장");
  else add("ok", "setup-code", "SETUP_CODE 설정됨");

  // 휴대폰 알림 (웹 푸시) — 없으면 알림만 꺼지고 나머지는 동작
  const vpub = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const vpriv = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const b64len = (s) => (/^[A-Za-z0-9_-]+$/.test(s) ? Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").length : -1);
  if (!vpub && !vpriv) add("warn", "push", "VAPID 키가 없습니다 — 휴대폰 알림이 꺼진 채로 배포됩니다 (npm run vapid 로 만들기)");
  else if (b64len(vpub) !== 65 || b64len(vpriv) !== 32) add("error", "push", "VAPID 키 형식이 올바르지 않습니다 — npm run vapid 로 다시 만드세요");
  else if (Object.keys(env).some((k) => k.startsWith("NEXT_PUBLIC_") && env[k] === vpriv)) add("error", "push", "VAPID 개인 키가 NEXT_PUBLIC_ 변수에 들어 있습니다");
  else {
    const subj = (env.VAPID_SUBJECT ?? "").trim();
    add(subj.startsWith("mailto:") || subj.startsWith("https://") ? "ok" : "warn", "push", subj ? "휴대폰 알림 설정됨" : "휴대폰 알림 설정됨 — VAPID_SUBJECT(mailto:담당 이메일)를 넣는 것을 권장합니다");
  }

  if (env.DB_POOL_MAX !== undefined && env.DB_POOL_MAX !== "") {
    const n = Number(env.DB_POOL_MAX);
    if (!Number.isInteger(n) || n < 1 || n > 20) add("warn", "pool-max", "DB_POOL_MAX는 1~20 사이 정수 (기본 5)");
  }
  return out;
}

/**
 * DB 상태 점검 — query는 (sql) => rows
 * @param {(sql: string) => Promise<Record<string, unknown>[]>} query
 * @returns {Promise<Check[]>}
 */
export async function checkDb(query) {
  /** @type {Check[]} */
  const out = [];
  const add = (level, key, text) => out.push({ level, key, text });
  const t0 = Date.now();
  try {
    await query("select 1");
    add("ok", "db-connect", `DB 연결 성공 (${Date.now() - t0}ms)`);
  } catch (e) {
    add("error", "db-connect", `DB에 연결하지 못했습니다 — ${String(e?.code ?? e?.message ?? e).slice(0, 80).replace(/postgres(ql)?:\/\/\S+/g, "(연결 문자열)")}`);
    return out;
  }
  const tables = await query(`select tablename, rowsecurity from pg_tables where schemaname = 'public'`);
  const has = (t) => tables.some((r) => r.tablename === t);
  if (!has("schema_migrations")) {
    add("warn", "schema", "아직 표가 없습니다 — 앱을 처음 열면 자동으로 만듭니다 (배포 후 /api/health 한 번 열기)");
    return out;
  }
  const migs = await query(`select name from schema_migrations order by name`);
  add(migs.some((m) => m.name === "001_init") ? "ok" : "error", "schema", migs.length ? `스키마 적용됨 (${migs.map((m) => m.name).join(", ")})` : "스키마 적용 기록이 없습니다");
  const missing = TABLES.filter((t) => !has(t));
  if (missing.length) add("error", "tables", `필요한 표가 없습니다: ${missing.join(", ")}`);
  const noRls = tables.filter((r) => TABLES.includes(String(r.tablename)) && r.rowsecurity !== true && r.rowsecurity !== "t");
  if (noRls.length) add("error", "rls", `행 보안(RLS)이 꺼진 표: ${noRls.map((r) => r.tablename).join(", ")} — Supabase 공개 API로 읽힐 수 있습니다`);
  else if (!missing.length) add("ok", "rls", "모든 표에 행 보안(RLS) 켜짐 — Supabase 공개 API로 읽기·쓰기 불가");
  if (has("companies")) {
    const [c] = await query(`select count(*)::int as n from companies`);
    add("ok", "setup", Number(c?.n ?? 0) ? "최초 설정 완료 (회사 등록됨)" : "최초 설정 전 — 배포 후 /setup 에서 대표 계정을 만드세요");
  }
  return out;
}

export function summarize(checks) {
  const icon = { ok: "✅", warn: "⚠️ ", error: "❌" };
  const lines = checks.map((c) => `${icon[c.level]} ${c.text}`);
  const errors = checks.filter((c) => c.level === "error").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  lines.push("", errors ? `❌ 배포 전에 고쳐야 할 항목 ${errors}개${warns ? ` · 확인 권장 ${warns}개` : ""}` : warns ? `⚠️  확인 권장 ${warns}개 — 배포는 가능합니다` : "✅ 배포 준비 완료");
  return { text: lines.join("\n"), errors, warns };
}
