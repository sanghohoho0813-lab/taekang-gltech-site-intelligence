import type { NextRequest } from "next/server";
import { currentRev, getView } from "@/server/service";
import { NextResponse } from "next/server";
import { errorResponse, json, notLive, renewCookie, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 서버 함수 시간 한도 (Vercel 기본 10초보다 넉넉히 · 화면 데이터: 처음 읽을 때 1년치 · D-50) */
export const maxDuration = 30;

/** 역할별로 걸러진 회사 데이터. ?rev=N 이 최신이면 204 (변경 없음) */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    // 쓰는 동안 로그인이 계속 유지되도록, 서버가 기간을 늘렸으면 쿠키도 늘린다 (D-48)
    let renewed: Date | null = null;
    const m = await requireMember(req, false, (exp) => (renewed = exp));
    if (m instanceof Response) return m;
    const known = req.nextUrl.searchParams.get("rev");
    if (known !== null && Number(known) === (await currentRev(m.companyId))) return renewCookie(new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } }), req, renewed);
    return renewCookie(json(await getView(m)), req, renewed);
  } catch (e) {
    return errorResponse(e);
  }
}
