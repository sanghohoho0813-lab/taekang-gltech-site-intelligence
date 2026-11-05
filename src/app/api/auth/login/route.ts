import type { NextRequest } from "next/server";
import { login } from "@/server/auth";
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
    const body = (await readJson(req, 10_000)) as { email?: unknown; password?: unknown };
    const r = await login(body.email, body.password);
    if (!r.ok) {
      hit(RULES.login, ip);
      return json({ error: r.error }, 401);
    }
    const res = json({ me: meBody(r.member) });
    setSessionCookie(res, req, r.token, r.expires);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
