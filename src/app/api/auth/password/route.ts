import type { NextRequest } from "next/server";
import { changePassword, SESSION_COOKIE } from "@/server/auth";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req, true);
    if (m instanceof Response) return m;
    const body = (await readJson(req, 10_000)) as { current?: unknown; next?: unknown };
    const problem = await changePassword(m, body.current, body.next, req.cookies.get(SESSION_COOKIE)?.value ?? "");
    if (problem) return json({ error: problem, fieldErrors: { next: problem } }, 400);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
