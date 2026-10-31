import type { NextRequest } from "next/server";
import { needsSetup, setupCompany, type SetupInput } from "@/server/service";
import { crossSite, errorResponse, json, meBody, notLive, readJson, setSessionCookie } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 최초 설정 필요 여부 (회사가 하나도 없으면 true) */
export async function GET() {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    return json({ needsSetup: await needsSetup() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 회사 + 대표 계정 생성 (최초 1회만) */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const body = (await readJson(req, 10_000)) as SetupInput;
    // 운영 환경에서는 설정 코드가 있어야 최초 설정 가능 (배포 직후 다른 사람이 먼저 가로채지 못하게)
    const code = process.env.SETUP_CODE?.trim();
    if (code && (body as { setupCode?: string }).setupCode !== code) return json({ error: "설정 코드가 맞지 않습니다.", fieldErrors: { setupCode: "확인 필요" } }, 403);
    const r = await setupCompany(body);
    const res = json({ me: meBody(r.member) });
    setSessionCookie(res, req, r.token, r.expires);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
