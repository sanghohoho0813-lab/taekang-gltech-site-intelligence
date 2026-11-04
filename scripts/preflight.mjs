#!/usr/bin/env node
/**
 * 배포 전 자동 점검 — 사용:
 *   1) Vercel 환경변수를 내려받기:  npx vercel env pull .env.preflight   (또는 직접 작성)
 *   2) node --env-file=.env.preflight scripts/preflight.mjs   (npm run preflight -- 형태도 가능)
 * DB에 연결하지 않고 설정만 보려면 --no-db
 */
import { checkDb, checkEnv, summarize } from "./preflight-lib.mjs";

const noDb = process.argv.includes("--no-db");
const checks = checkEnv(process.env);
const url = (process.env.DATABASE_URL ?? "").trim();

if (!noDb && url) {
  let close = async () => {};
  let query;
  try {
    if (url.startsWith("pglite:")) {
      const { PGlite } = await import("@electric-sql/pglite");
      const loc = url.slice("pglite:".length);
      const pg = loc === "memory" || !loc ? new PGlite() : new PGlite(loc);
      await pg.waitReady;
      query = async (sql) => (await pg.query(sql)).rows;
      close = () => pg.close();
    } else {
      const postgres = (await import("postgres")).default;
      const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5 });
      query = (text) => sql.unsafe(text);
      close = () => sql.end({ timeout: 5 });
    }
    checks.push(...(await checkDb(query)));
  } catch (e) {
    checks.push({ level: "error", key: "db-connect", text: `DB 점검 실패 — ${String(e?.message ?? e).slice(0, 80)}` });
  } finally {
    await close().catch(() => {});
  }
}

const { text, errors } = summarize(checks);
console.log("\nTAEKANG SITE INTELLIGENCE · 배포 전 점검\n");
console.log(text);
process.exit(errors ? 1 : 0);
