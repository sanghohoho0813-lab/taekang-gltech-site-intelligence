import type { NextRequest } from "next/server";
import { login } from "@/server/auth";
import { crossSite, errorResponse, json, meBody, notLive, readJson, setSessionCookie } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const body = (await readJson(req, 10_000)) as { email?: unknown; password?: unknown };
    const r = await login(body.email, body.password);
    if (!r.ok) return json({ error: r.error }, 401);
    const res = json({ me: meBody(r.member) });
    setSessionCookie(res, req, r.token, r.expires);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
