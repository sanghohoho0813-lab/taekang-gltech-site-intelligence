import type { NextRequest } from "next/server";
import { recordError } from "@/server/errors";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 화면 오류 보내기 (로그인한 사람만, 사람마다 10분에 30번까지) — D-47 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req, true);
    if (m instanceof Response) return m;
    const slow = limited(RULES.clientError, m.id);
    if (slow) return slow;
    const body = (await readJson(req, 8_000)) as { message?: unknown; stack?: unknown; route?: unknown };
    await recordError(m, { source: "client", route: body.route, message: body.message, stack: body.stack, ua: req.headers.get("user-agent") });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
