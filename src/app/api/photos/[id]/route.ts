import type { NextRequest } from "next/server";
import { getPhoto } from "@/server/service";
import { errorResponse, json, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const { id } = await params;
    const photo = await getPhoto(m, id);
    if (!photo) return json({ error: "사진을 찾을 수 없습니다." }, 404);
    // 권한을 매번 다시 확인하고(공개를 끄면 바로 안 보이게), 바뀌지 않은 사진은 다시 받지 않게 (D-67 점검 반영)
    if (req.headers.get("if-none-match") === `"${id}"`) return new Response(null, { status: 304, headers: { "Cache-Control": "private, no-cache", ETag: `"${id}"` } });
    return new Response(Buffer.from(photo.data), {
      headers: { "Content-Type": photo.mime, "Cache-Control": "private, no-cache", ETag: `"${id}"`, "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
