import type { NextRequest } from "next/server";
import { countShareView } from "@/server/shareService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 보고서 링크를 열어 봄 (로그인 없음) — 화면이 문서를 그린 뒤 한 번 부른다.
 * 카카오톡·문자의 주소 미리보기는 화면 코드를 실행하지 않으므로 세지 않는다.
 * 맞는 주소인지와 상관없이 같은 답을 준다 (주소가 있는지 알아내는 데 쓰이지 않게).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.share, ip);
  if (blocked) return blocked;
  try {
    const { token } = await params;
    await countShareView(token, ip);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
