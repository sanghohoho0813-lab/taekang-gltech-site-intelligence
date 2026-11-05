import type { NextRequest } from "next/server";
import { exportCompany } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { errorResponse, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 서버 함수 시간 한도 (Vercel 기본 10초보다 넉넉히 · 전체 자료 백업: 크다 · D-50) */
export const maxDuration = 60;

/** 전체 자료 백업 JSON (대표 전용) — 내려받기 */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.export, m.id);
    if (slow) return slow;
    const { filename, body } = await exportCompany(m);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
