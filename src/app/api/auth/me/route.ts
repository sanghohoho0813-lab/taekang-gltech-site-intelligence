import type { NextRequest } from "next/server";
import { errorResponse, json, meBody, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req, true);
    if (m instanceof Response) return m;
    return json({ me: meBody(m) });
  } catch (e) {
    return errorResponse(e);
  }
}
