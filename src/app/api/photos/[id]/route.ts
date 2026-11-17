import type { NextRequest } from "next/server";
import { getPhoto } from "@/server/service";
import { missingPhotoResponse } from "@/server/missingPhoto";
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
    // 백업 복원 뒤 원본을 아직 올리지 않은 사진 — ‘사진 원본 없음’ 그림 (D-86)
    if (photo.missing) return missingPhotoResponse(id);
    // 권한을 매번 다시 확인하고(공개를 끄면 바로 안 보이게), 바뀌지 않은 사진은 다시 받지 않게 (D-67 점검 반영)
    if (req.headers.get("if-none-match") === `"${id}"`) return new Response(null, { status: 304, headers: { "Cache-Control": "private, no-cache", ETag: `"${id}"` } });
    // 변경공사 증빙 PDF(D-88)는 이 사이트 안에서 열지 않고 내려받아 PC·휴대폰의 PDF 보기로 연다 (PDF 안의 스크립트·링크가 이 사이트 화면으로 동작하지 않게)
    const pdf = photo.mime === "application/pdf";
    const name = (photo.fileName ?? "증빙.pdf").replace(/[\r\n"]/g, " ");
    return new Response(Buffer.from(photo.data), {
      headers: {
        "Content-Type": photo.mime,
        "Cache-Control": "private, no-cache",
        ETag: `"${id}"`,
        "X-Content-Type-Options": "nosniff",
        ...(pdf ? { "Content-Disposition": `attachment; filename="evidence.pdf"; filename*=UTF-8''${encodeURIComponent(name)}` } : {}),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
