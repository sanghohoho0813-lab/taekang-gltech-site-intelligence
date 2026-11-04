import type { NextRequest } from "next/server";
import { countFor, removeSubscription, saveSubscription, vapid } from "@/server/push";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 내 알림 상태 + 서버 공개 키 (공개 키는 비밀이 아님) */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const v = vapid();
    return json({ enabled: !!v, publicKey: v?.publicKey ?? null, subscribed: v ? await countFor(m) : 0 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 이 휴대폰 알림 켜기 */
export async function POST(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.members, m.id);
    if (slow) return slow;
    const body = (await readJson(req, 10_000)) as { subscription?: unknown };
    return json(await saveSubscription(m, body.subscription, req.headers.get("user-agent") ?? undefined));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 알림 끄기 (endpoint가 없으면 내 모든 휴대폰) */
export async function DELETE(req: NextRequest) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const body = (await readJson(req, 10_000).catch(() => ({}))) as { endpoint?: unknown };
    return json(await removeSubscription(m, body?.endpoint));
  } catch (e) {
    return errorResponse(e);
  }
}
