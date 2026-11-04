import type { NextRequest } from "next/server";
import { errorResponse, json, meBody, notLive, renewCookie, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    let renewed: Date | null = null;
    const m = await requireMember(req, true, (exp) => (renewed = exp));
    if (m instanceof Response) return m;
    return renewCookie(json({ me: meBody(m) }), req, renewed);
  } catch (e) {
    return errorResponse(e);
  }
}
