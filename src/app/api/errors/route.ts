import type { NextRequest } from "next/server";
import { listErrors } from "@/server/errors";
import { RULES, limited } from "@/server/rateLimit";
import { errorResponse, json, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 앱 오류 기록 조회 (대표·관리자) — D-47 */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.members, m.id);
    if (slow) return slow;
    return json(await listErrors(m));
  } catch (e) {
    return errorResponse(e);
  }
}
