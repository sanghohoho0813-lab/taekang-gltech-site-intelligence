import type { NextRequest } from "next/server";
import { confirmIntakeByKey } from "@/server/intakeService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, notLive, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };

/** 보수 완료 확인 (로그인 없음 — 진행 확인 주소를 가진 사람만) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.intake, ip) ?? limited(RULES.intakeSubmit, ip);
  if (blocked) return blocked;
  try {
    const { key } = await params;
    const body = (await readJson(req, 4_000)) as { note?: unknown };
    const out = await confirmIntakeByKey(key, body.note);
    if (!out) return Response.json({ error: "열 수 없는 주소입니다.", code: "notfound" }, { status: 404, headers: HEADERS });
    return Response.json(out, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
