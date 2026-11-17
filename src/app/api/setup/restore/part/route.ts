import type { NextRequest } from "next/server";
import { storeRestorePart } from "@/server/restore";
import { needsSetup } from "@/server/service";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson, setupCode } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 큰 백업 파일 조각 받기 (빈 시스템에서만 · D-86) — 압축 3MB가 넘는 백업은 서버 요청 한도(4.5MB) 때문에 나눠 올린다.
 * 마지막에 /api/setup/restore 에 uploadId·조각 수를 보내면 합쳐서 복원한다.
 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.restorePart, clientIp(req));
  if (blocked) return blocked;
  try {
    if (!(await needsSetup())) return json({ error: "이미 회사 설정이 끝난 시스템에는 복원할 수 없습니다.", code: "ALREADY_SETUP" }, 403);
    const code = setupCode();
    if (!code && process.env.VERCEL && process.env.NODE_ENV === "production") {
      return json({ error: "배포 환경변수 SETUP_CODE를 먼저 등록하고 다시 배포해주세요.", code: "SETUP_CODE_MISSING" }, 503);
    }
    const body = (await readJson(req, 4_400_000)) as { uploadId?: unknown; seq?: unknown; data?: unknown; setupCode?: string };
    if (code && body.setupCode !== code) return json({ error: "설정 코드가 맞지 않습니다.", fieldErrors: { setupCode: "확인 필요" } }, 403);
    return json(await storeRestorePart(body));
  } catch (e) {
    return errorResponse(e);
  }
}
