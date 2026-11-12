import type { NextRequest } from "next/server";
import { openIntake, submitIntakeByToken } from "@/server/intakeService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { CommandError } from "@/lib/data/commands";
import { crossSite, errorResponse, notLive, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 사진 3장까지 받으므로 넉넉히 */
export const maxDuration = 30;

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };
const GONE = {
  notfound: "열 수 없는 주소입니다. 주소가 끝까지 입력됐는지 확인해 주세요.",
  closed: "지금은 이 주소로 접수를 받지 않습니다. 시공사에 전화로 알려 주세요.",
} as const;

/** 하자 접수 화면에 보일 것 (로그인 없음) — 회사·현장 이름뿐 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? limited(RULES.intake, ip);
  if (blocked) return blocked;
  try {
    const { token } = await params;
    const r = await openIntake(token);
    if (!r.ok) {
      // 없는 주소를 계속 넣어 보는 곳만 늦춘다 (맞는 주소는 그대로 열린다)
      const slow = r.reason === "notfound" ? limited(RULES.intakeMiss, ip) : null;
      if (slow) return slow;
      return Response.json({ error: GONE[r.reason], code: r.reason }, { status: r.reason === "notfound" ? 404 : 410, headers: HEADERS });
    }
    return Response.json(r.view, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * 하자 접수 (로그인 없음 — 접수 주소를 가진 사람만).
 * 한 곳에서 10분에 5건, 링크 하나에 하루 20건까지. 사람이 보지 않는 칸(website)이 채워져 있으면 기계로 보고 받지 않는다.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.intake, ip);
  if (blocked) return blocked;
  try {
    const { token } = await params;
    const body = (await readJson(req, 11_000_000)) as Record<string, unknown>;
    if (typeof body.website === "string" && body.website.trim()) throw new CommandError("입력한 내용을 확인해 주세요.");
    // 맞는 주소인지 먼저 본다 (틀린 주소로는 접수 횟수를 쓰지 않는다)
    const open = await openIntake(token);
    if (!open.ok) {
      const slow = open.reason === "notfound" ? limited(RULES.intakeMiss, ip) : null;
      if (slow) return slow;
      return Response.json({ error: GONE[open.reason], code: open.reason }, { status: open.reason === "notfound" ? 404 : 410, headers: HEADERS });
    }
    const slow = limited(RULES.intakeSubmit, ip);
    if (slow) return slow;
    const out = await submitIntakeByToken(token, {
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      location: body.location as string,
      description: body.description as string,
      photoDataUrls: Array.isArray(body.photoDataUrls) ? (body.photoDataUrls as string[]) : [],
      org: body.org as string | undefined,
      name: body.name as string,
      phone: body.phone as string,
      consent: body.consent === true,
    });
    if (!out) return Response.json({ error: GONE.notfound, code: "notfound" }, { status: 404, headers: HEADERS });
    return Response.json(out, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
