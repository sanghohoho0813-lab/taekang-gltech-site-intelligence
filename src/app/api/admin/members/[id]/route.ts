import type { NextRequest } from "next/server";
import { updateMember, type MemberInput } from "@/server/service";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const { id } = await params;
    return json({ member: await updateMember(m, id, (await readJson(req, 20_000)) as MemberInput) });
  } catch (e) {
    return errorResponse(e);
  }
}
