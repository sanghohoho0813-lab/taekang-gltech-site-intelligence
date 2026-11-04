import type { NextRequest } from "next/server";
import { listActivity } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { errorResponse, json, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 활동 이력 조회 (대표·관리자) ?from=YYYY-MM-DD&to=…&site=&user=&type=&q= */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.members, m.id);
    if (slow) return slow;
    const p = req.nextUrl.searchParams;
    return json(
      await listActivity(m, {
        from: p.get("from") ?? "",
        to: p.get("to") ?? "",
        siteId: p.get("site") || undefined,
        userId: p.get("user") || undefined,
        type: p.get("type") || undefined,
        q: p.get("q") || undefined,
      }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
