import type { NextRequest } from "next/server";
import { currentRev, getView } from "@/server/service";
import { errorResponse, json, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 역할별로 걸러진 회사 데이터. ?rev=N 이 최신이면 204 (변경 없음) */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const known = req.nextUrl.searchParams.get("rev");
    if (known !== null && Number(known) === (await currentRev(m.companyId))) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    return json(await getView(m));
  } catch (e) {
    return errorResponse(e);
  }
}
