import type { NextRequest } from "next/server";
import { openShare } from "@/server/shareService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { errorResponse, notLive } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 검색·저장·주소 유출을 막는 머리말 — 주소의 비밀값이 다른 사이트로 넘어가지 않게 (D-73) */
const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };
const MESSAGE = {
  notfound: "열 수 없는 주소입니다. 주소가 끝까지 복사됐는지 확인해 주세요.",
  expired: "기한이 지난 보고서 링크입니다. 보낸 곳에 새 주소를 요청해 주세요.",
  revoked: "보낸 곳에서 닫은 보고서 링크입니다. 보낸 곳에 새 주소를 요청해 주세요.",
} as const;

/**
 * 보고서 링크 내용 (로그인 없음 — 주소의 비밀값으로만).
 * 로그인 쿠키는 읽지 않는다: 누가 열든 같은 내용(만들 때 고정한 문서)만 나간다.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? limited(RULES.share, ip);
  if (blocked) return blocked;
  try {
    const { token } = await params;
    const r = await openShare(token);
    if (!r.ok) {
      // 없는 주소를 계속 넣어 보는 곳만 늦춘다 — 맞는 주소는 이 제한과 상관없이 열린다
      // (같은 사무실의 한 사람이 틀린 주소를 여러 번 눌러도 다른 사람의 보고서가 막히지 않게 · 점검 9차)
      const slow = r.reason === "notfound" ? limited(RULES.shareMiss, ip) : null;
      if (slow) return slow;
      return Response.json({ error: MESSAGE[r.reason], code: r.reason }, { status: r.reason === "notfound" ? 404 : 410, headers: HEADERS });
    }
    return Response.json({ title: r.title, createdAt: r.createdAt, expiresAt: r.expiresAt, doc: r.doc, hiddenPhotos: r.hiddenPhotos }, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
