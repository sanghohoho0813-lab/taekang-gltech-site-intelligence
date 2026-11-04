import { getDb } from "@/server/sql";
import { json } from "@/server/http";
import { IS_LIVE } from "@/lib/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 서버 상태 확인 (배포 직후 점검·외부 감시용) — 로그인 불필요, 회사 데이터·오류 내용은 내보내지 않는다.
 * DB에 연결되면 200, 안 되면 503.
 */
export async function GET() {
  const base = { mode: IS_LIVE ? "live" : "demo", time: new Date().toISOString(), version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "local" };
  if (!IS_LIVE) return json({ ok: true, ...base });
  const t0 = Date.now();
  try {
    const db = await getDb();
    await db.query("select 1");
    const [m] = await db.query<{ n: number }>("select count(*)::int as n from schema_migrations");
    // 알림 키가 있는지만 (값은 내보내지 않음) — 배포 후 점검(npm run smoke)이 확인
    const push = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? "on" : "off";
    return json({ ok: true, ...base, db: "ok", dbMs: Date.now() - t0, migrations: Number(m?.n ?? 0), push });
  } catch {
    return json({ ok: false, ...base, db: "error" }, 503);
  }
}
