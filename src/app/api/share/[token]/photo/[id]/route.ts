import type { NextRequest } from "next/server";
import { sharePhotoAccess, sharePhotoBlob } from "@/server/shareService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { errorResponse, notLive } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

/**
 * 보고서 링크 속 사진 (로그인 없음) — 그 문서에 든 사진 번호이고, 지금도 ‘발주처 공개’인 사진만.
 * 매번 다시 확인한다 (링크를 닫거나 공개를 끄면 바로 안 보이게) — 바뀌지 않은 사진은 다시 받지 않는다.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const blocked = notLive() ?? limited(RULES.share, clientIp(req));
  if (blocked) return blocked;
  try {
    const { token, id } = await params;
    const gone = () => Response.json({ error: "사진을 찾을 수 없습니다." }, { status: 404, headers: { ...HEADERS, "Cache-Control": "private, no-store" } });
    // 먼저 ‘줘도 되는지’만 확인한다 — 닫힌 링크·공개를 끈 사진은 브라우저에 남은 사본이 있어도 404
    const ok = await sharePhotoAccess(token, id);
    if (!ok) return gone();
    const cache = { ...HEADERS, "Cache-Control": "private, no-cache", ETag: `"${id}"` };
    // 바뀌지 않았으면 사진 원본을 DB에서 꺼내지 않고 답한다
    if (req.headers.get("if-none-match") === `"${id}"`) return new Response(null, { status: 304, headers: cache });
    const photo = await sharePhotoBlob(ok.companyId, id);
    if (!photo) return gone();
    return new Response(Buffer.from(photo.data), { headers: { ...cache, "Content-Type": photo.mime } });
  } catch (e) {
    return errorResponse(e);
  }
}
