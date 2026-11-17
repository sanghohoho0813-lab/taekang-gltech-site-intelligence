import type { NextRequest } from "next/server";
import { restoreCompany, type RestoreInput } from "@/server/restore";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, meBody, notLive, readJson, setSessionCookie, setupCode } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 1년치 자료를 한 번에 넣는다 — 묶어 넣어도 수 초 (D-86) */
export const maxDuration = 60;

/** 서버 요청 한도(Vercel 4.5MB) 안 — 압축 백업 1년치 약 0.4MB(base64 0.5MB) */
const MAX_BODY = 4_400_000;

/**
 * 백업 파일로 시작 (빈 시스템에서만 · D-86) — 계정 이전·서버 이전.
 * 최초 설정과 같은 설정 코드·잠금. 회사가 하나라도 있으면 거부(덮어쓰기 불가).
 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.setup, clientIp(req));
  if (blocked) return blocked;
  try {
    const code = setupCode();
    if (!code && process.env.VERCEL && process.env.NODE_ENV === "production") {
      return json({ error: "배포 환경변수 SETUP_CODE를 먼저 등록하고 다시 배포해주세요.", code: "SETUP_CODE_MISSING" }, 503);
    }
    const body = (await readJson(req, MAX_BODY)) as RestoreInput & { setupCode?: string };
    if (code && body.setupCode !== code) return json({ error: "설정 코드가 맞지 않습니다.", fieldErrors: { setupCode: "확인 필요" } }, 403);
    const r = await restoreCompany(body);
    const res = json({ me: meBody(r.member), summary: r.summary });
    setSessionCookie(res, req, r.token, r.expires);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
