import type { NextRequest } from "next/server";
import { signUp, type SignupRequest } from "@/server/service";
import { deliver } from "@/server/push";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 회원가입 신청 (로그인 없이 · D-90) — ‘승인 대기’로 저장되고, 승인 담당이 승인해야 로그인된다.
 * 응답에는 아무 개인정보도 돌려주지 않는다.
 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.signup, clientIp(req));
  if (blocked) return blocked;
  try {
    const out = await signUp((await readJson(req, 10_000)) as SignupRequest);
    if (out.notices.length) await deliver(out.companyId, out.notices).catch((e) => console.error("[push signup]", e));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
