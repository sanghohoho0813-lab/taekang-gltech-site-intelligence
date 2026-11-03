import type { NextRequest } from "next/server";
import { exportCompany } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { errorResponse, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
