/**
 * API 공통 — LIVE 모드 확인, 세션 사용자, 오류 응답, 세션 쿠키, 같은 출처(Origin) 확인.
 */
import { NextResponse, type NextRequest } from "next/server";
import { IS_LIVE } from "@/lib/mode";
import { CommandError } from "@/lib/data/commands";
import { memberFromToken, SESSION_COOKIE, SESSION_DAYS, type Member } from "./auth";
import { ForbiddenError } from "./authz";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function notLive(): NextResponse | null {
  return IS_LIVE ? null : json({ error: "LIVE 모드에서만 사용할 수 있습니다." }, 404);
}

/** 다른 사이트에서 보낸 쓰기 요청 차단 (Origin이 있으면 같은 호스트여야 함) */
export function crossSite(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (new URL(origin).host === host) return null;
  } catch {
    // 형식 오류 → 차단
  }
  return json({ error: "허용되지 않은 요청 출처입니다." }, 403);
}

export async function readJson(req: NextRequest, maxBytes = 12_000_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new CommandError("요청이 너무 큽니다. 사진 수를 줄여주세요.");
  try {
    return await req.json();
  } catch {
    throw new CommandError("요청 형식이 올바르지 않습니다.");
  }
}

export async function sessionMember(req: NextRequest): Promise<Member | null> {
  return memberFromToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** 로그인 + (비밀번호 변경 필요 시 차단) */
export async function requireMember(req: NextRequest, allowMustChange = false): Promise<Member | NextResponse> {
  const m = await sessionMember(req);
  if (!m) return json({ error: "로그인이 필요합니다.", code: "UNAUTHENTICATED" }, 401);
  if (m.mustChangePassword && !allowMustChange) return json({ error: "비밀번호를 먼저 바꿔주세요.", code: "MUST_CHANGE_PASSWORD" }, 403);
  return m;
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof CommandError) {
    const status = e.code === "NOT_FOUND" ? 404 : e.code === "DUPLICATE" || e.code === "STATE" ? 409 : 400;
    return json({ error: e.message, code: e.code, fieldErrors: e.fieldErrors }, status);
  }
  if (e instanceof ForbiddenError) return json({ error: e.message, code: "FORBIDDEN" }, 403);
  console.error("[api]", e);
  return json({ error: "서버에서 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", code: "SERVER" }, 500);
}

export function setSessionCookie(res: NextResponse, req: NextRequest, token: string, expires: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    expires,
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function meBody(m: Member) {
  return { id: m.id, email: m.email, name: m.name, title: m.title, role: m.role, mustChangePassword: m.mustChangePassword };
}
