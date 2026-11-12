import type { NextRequest } from "next/server";
import { intakePhotoAccess, intakePhotoBlob } from "@/server/intakeService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { errorResponse, notLive } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

/** 진행 확인 화면의 사진 (로그인 없음) — 본사가 회신에 붙인 보수 사진만 (접수자가 올린 사진은 다시 내주지 않는다) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string; id: string }> }) {
  const blocked = notLive() ?? limited(RULES.intake, clientIp(req));
  if (blocked) return blocked;
  try {
    const { key, id } = await params;
    const gone = () => Response.json({ error: "사진을 찾을 수 없습니다." }, { status: 404, headers: { ...HEADERS, "Cache-Control": "private, no-store" } });
    const ok = await intakePhotoAccess(key, id);
    if (!ok) return gone();
    const cache = { ...HEADERS, "Cache-Control": "private, no-cache", ETag: `"${id}"` };
    if (req.headers.get("if-none-match") === `"${id}"`) return new Response(null, { status: 304, headers: cache });
    const photo = await intakePhotoBlob(ok.companyId, id);
    if (!photo) return gone();
    return new Response(Buffer.from(photo.data), { headers: { ...cache, "Content-Type": photo.mime } });
  } catch (e) {
    return errorResponse(e);
  }
}
