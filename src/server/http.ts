/**
 * API 공통 — LIVE 모드 확인, 세션 사용자, 오류 응답, 세션 쿠키, 같은 출처(Origin) 확인.
 */
import { NextResponse, type NextRequest } from "next/server";
import { IS_LIVE } from "@/lib/mode";
import { CommandError, cleanText } from "@/lib/data/commands";
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

const TOO_BIG = "요청이 너무 큽니다. 사진 수를 줄여주세요.";

/** 본문을 읽으면서 크기를 센다 — 길이 머리말(Content-Length)이 없거나 틀려도 한도를 넘으면 그만 읽는다 (D-74 점검 10차) */
async function readText(req: NextRequest, maxBytes: number): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new CommandError(TOO_BIG);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new CommandError(TOO_BIG);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** DB(jsonb)가 받지 못하는 글자(NUL·짝 없는 서로게이트)를 모든 글에서 걸러 낸다 — 그대로 두면 저장할 때 서버 오류 */
function cleanJson(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return cleanText(v);
  if (!v || typeof v !== "object") return v;
  if (depth > 40) throw new CommandError("요청 형식이 올바르지 않습니다.");
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = cleanJson(v[i], depth + 1);
    return v;
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) o[k] = cleanJson(o[k], depth + 1);
  return o;
}

export async function readJson(req: NextRequest, maxBytes = 12_000_000): Promise<unknown> {
  const raw = await readText(req, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new CommandError("요청 형식이 올바르지 않습니다.");
  }
  // null·숫자·문자열 본문은 거부 (서버 오류 500 대신 400)
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CommandError("요청 형식이 올바르지 않습니다.");
  return cleanJson(body);
}

export async function sessionMember(req: NextRequest, onRenew?: (expires: Date) => void): Promise<Member | null> {
  return memberFromToken(req.cookies.get(SESSION_COOKIE)?.value, onRenew);
}

/** 로그인 + (비밀번호 변경 필요 시 차단). onRenew: 로그인 기간을 늘렸을 때 (쿠키를 다시 써야 함 · D-48) */
export async function requireMember(req: NextRequest, allowMustChange = false, onRenew?: (expires: Date) => void): Promise<Member | NextResponse> {
  const m = await sessionMember(req, onRenew);
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
    // 만료 시각에 맞춘다 (로그인 연장 시 새 만료로 다시 설정 · D-48)
    maxAge: Math.max(0, Math.min(SESSION_DAYS * 86_400, Math.floor((expires.getTime() - Date.now()) / 1000))),
  });
}

/** 로그인 기간을 늘렸으면 같은 토큰으로 쿠키 만료도 늘린다 */
export function renewCookie(res: NextResponse, req: NextRequest, expires: Date | null): NextResponse {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (expires && token) setSessionCookie(res, req, token, expires);
  return res;
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function meBody(m: Member) {
  return { id: m.id, email: m.email, name: m.name, title: m.title, role: m.role, mustChangePassword: m.mustChangePassword };
}
