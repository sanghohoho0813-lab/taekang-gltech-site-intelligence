import type { NextRequest } from "next/server";
import { executeCommand } from "@/server/service";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** { name, args } → 서버에서 권한 검사 후 실행·저장, 새 데이터와 결과 반환 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const body = (await readJson(req)) as { name?: unknown; args?: unknown };
    return json(await executeCommand(m, body.name, body.args));
  } catch (e) {
    return errorResponse(e);
  }
}
