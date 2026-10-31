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
    return new Response(Buffer.from(photo.data), {
      headers: { "Content-Type": photo.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
