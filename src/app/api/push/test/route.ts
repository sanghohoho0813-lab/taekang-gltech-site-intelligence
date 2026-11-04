import type { NextRequest } from "next/server";
import { deliver } from "@/server/push";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 시험 알림 — 내 휴대폰에만 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.pushTest, m.id);
    if (slow) return slow;
    const r = await deliver(m.companyId, [{ to: [m.id], title: "알림이 잘 옵니다", body: "본사 지시·보완 요청이 오면 이렇게 알려드려요.", url: "/", tag: "test" }]);
    return json(r);
  } catch (e) {
    return errorResponse(e);
  }
}
