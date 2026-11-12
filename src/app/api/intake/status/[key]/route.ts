import type { NextRequest } from "next/server";
import { intakeStatus } from "@/server/intakeService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { errorResponse, notLive } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

/** 하자 접수 진행 확인 (로그인 없음 — 접수할 때 받은 주소로만). 그 접수 한 건만 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? limited(RULES.intake, ip);
  if (blocked) return blocked;
  try {
    const { key } = await params;
    const view = await intakeStatus(key);
    if (!view) {
      const slow = limited(RULES.intakeMiss, ip);
      if (slow) return slow;
      return Response.json({ error: "열 수 없는 주소입니다. 주소가 끝까지 입력됐는지 확인해 주세요.", code: "notfound" }, { status: 404, headers: HEADERS });
    }
    return Response.json(view, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
