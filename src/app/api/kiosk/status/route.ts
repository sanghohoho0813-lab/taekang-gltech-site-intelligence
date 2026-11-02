import type { NextRequest } from "next/server";
import { kioskStatus } from "@/server/service";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { errorResponse, json, notLive } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 태블릿: 해제 여부 + 서버 시각 */
export async function GET(req: NextRequest) {
  const blocked = notLive() ?? limited(RULES.kioskStatus, clientIp(req));
  if (blocked) return blocked;
  try {
    return json(await kioskStatus(req.nextUrl.searchParams.get("id")));
  } catch (e) {
    return errorResponse(e);
  }
}
