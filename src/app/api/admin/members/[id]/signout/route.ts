import type { NextRequest } from "next/server";
import { signOutMember } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 이 사람의 모든 기기에서 로그아웃 (대표·관리자, 대표 계정은 대표만) — D-48 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.members, m.id);
    if (slow) return slow;
    const { id } = await params;
    return json(await signOutMember(m, id));
  } catch (e) {
    return errorResponse(e);
  }
}
