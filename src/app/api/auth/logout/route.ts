import type { NextRequest } from "next/server";
import { destroySession, SESSION_COOKIE } from "@/server/auth";
import { clearSessionCookie, crossSite, errorResponse, json, notLive } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    await destroySession(req.cookies.get(SESSION_COOKIE)?.value);
    const res = json({ ok: true });
    clearSessionCookie(res);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
