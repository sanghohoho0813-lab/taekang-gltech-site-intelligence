import type { NextRequest } from "next/server";
import { photoBackupStatus, restorePhotos } from "@/server/photoBackup";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 사진 백업 현황 (대표) — 달마다 몇 장, 원본이 없는 사진 몇 장 (D-86) */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    return json(await photoBackupStatus(m));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 사진 백업(ZIP)에서 꺼낸 원본 올리기 (대표) — 원본이 없는 사진만 채운다. 한 번에 40장·4MB 이하 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.photoRestore, m.id);
    if (slow) return slow;
    const body = (await readJson(req, 4_400_000)) as { photos?: unknown };
    return json(await restorePhotos(m, body.photos));
  } catch (e) {
    return errorResponse(e);
  }
}
