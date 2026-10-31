import type { NextRequest } from "next/server";
import { createMember, listMembers, type MemberInput } from "@/server/service";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    return json({ members: await listMembers(m) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    return json({ member: await createMember(m, (await readJson(req, 20_000)) as MemberInput) });
  } catch (e) {
    return errorResponse(e);
  }
}
