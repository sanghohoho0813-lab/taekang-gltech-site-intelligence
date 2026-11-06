import type { NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession, login, memberFromToken } from "@/server/auth";
import { removeSubscription } from "@/server/push";
import { RULES, clientIp, hit, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, meBody, notLive, readJson, setSessionCookie } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 접속 주소당 ‘실패한’ 로그인만 센다 (성공은 세지 않음) — 비밀번호 맞히기 공격은 막고, 첫날 한 와이파이에서 여러 명이 로그인해도 통과 (D-57)
  const ip = clientIp(req);
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.login, ip, false);
  if (blocked) return blocked;
  try {
    const body = (await readJson(req, 10_000)) as { email?: unknown; password?: unknown; deviceEndpoint?: unknown };
    const r = await login(body.email, body.password);
    if (!r.ok) {
      // 틀리면 이 휴대폰에 로그인돼 있던 사람은 그대로 둔다 (D-68 점검 반영)
      hit(RULES.login, ip);
      return json({ error: r.error }, 401);
    }
    // 같은 휴대폰에서 다른 사람이 로그인 (로그인 쪽지 QR 등): 로그인에 성공한 뒤에만 앞 사람의 세션과 이 기기 알림을 정리한다 (D-68)
    const oldToken = req.cookies.get(SESSION_COOKIE)?.value;
    let replaced: string | null = null;
    if (oldToken) {
      const prev = await memberFromToken(oldToken).catch(() => null);
      await destroySession(oldToken).catch(() => {});
      if (prev && prev.id !== r.member.id) {
        replaced = prev.id;
        const ep = typeof body.deviceEndpoint === "string" && body.deviceEndpoint.length <= 2000 ? body.deviceEndpoint : "";
        if (ep) await removeSubscription(prev, ep).catch(() => {});
      }
    }
    const res = json({ me: meBody(r.member), ...(replaced ? { replaced } : {}) });
    setSessionCookie(res, req, r.token, r.expires);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
