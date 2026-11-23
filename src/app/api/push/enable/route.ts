import type { NextRequest } from "next/server";
import { enableCompanyPush } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 회사 휴대폰 알림 켜기 — 대표 권한만. 서버가 알림 키를 만들어 보관한다 (D-91) */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.members, m.id);
    if (slow) return slow;
    return json(await enableCompanyPush(m, req.nextUrl.origin));
  } catch (e) {
    return errorResponse(e);
  }
}
