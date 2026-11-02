import type { NextRequest } from "next/server";
import { pairKioskByCode } from "@/server/service";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 현장 태블릿 연결 (로그인 없음 — 본사가 발급한 30분짜리 8자리 코드로만) */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.kioskPair, clientIp(req));
  if (blocked) return blocked;
  try {
    const body = (await readJson(req, 2_000)) as { code?: unknown };
    return json(await pairKioskByCode(body.code));
  } catch (e) {
    return errorResponse(e);
  }
}
