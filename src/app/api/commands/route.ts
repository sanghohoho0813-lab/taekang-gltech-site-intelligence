import type { NextRequest } from "next/server";
import { executeCommand } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 서버 함수 시간 한도 (Vercel 기본 10초보다 넉넉히 · 명령: 아침 출근 몰림 때 회사 잠금을 기다릴 수 있다 · D-50) */
export const maxDuration = 30;

/** { name, args } → 서버에서 권한 검사 후 실행·저장, 새 데이터와 결과 반환 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.commands, m.id);
    if (slow) return slow;
    const body = (await readJson(req)) as { name?: unknown; args?: unknown };
    return json(await executeCommand(m, body.name, body.args));
  } catch (e) {
    return errorResponse(e);
  }
}
