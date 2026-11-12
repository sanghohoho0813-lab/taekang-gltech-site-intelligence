import type { NextRequest } from "next/server";
import { openIntake, submitIntakeByToken } from "@/server/intakeService";
import { RULES, clientIp, limited } from "@/server/rateLimit";
import { CommandError } from "@/lib/data/commands";
import { checkIntakeInput } from "@/lib/data/intakeCommands";
import { tokenHash } from "@/lib/domain/intake";
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
type Open = Awaited<ReturnType<typeof openIntake>>;

/** 열 수 없는 주소·닫힌 링크 응답 — 닫힌 링크는 어디에 전화할지(회사 이름·전화번호) 알려 준다. 없는 주소를 계속 넣어 보는 곳만 늦춘다 */
function gone(open: Exclude<Open, { ok: true }>, ip: string): Response {
  if (open.reason === "notfound") {
    const slow = limited(RULES.intakeMiss, ip);
    if (slow) return slow;
    return Response.json({ error: GONE.notfound, code: "notfound" }, { status: 404, headers: HEADERS });
  }
  return Response.json({ error: GONE.closed, code: "closed", company: open.company, ...(open.phone ? { phone: open.phone } : {}) }, { status: 410, headers: HEADERS });
}

/** 하자 접수 화면에 보일 것 (로그인 없음) — 회사·건물 이름, 회사 전화번호, 오늘 한도에 닿았는지 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? limited(RULES.intake, ip);
  if (blocked) return blocked;
  try {
    const { token } = await params;
    const r = await openIntake(token);
    if (!r.ok) return gone(r, ip);
    return Response.json(r.view, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * 하자 접수 (로그인 없음 — 접수 주소를 가진 사람만).
 * 순서: 읽기 제한 → 주소 확인(본문을 읽기 전에) → 본문(읽으면서 크기를 센다) → 내용 검사(DB를 읽기 전에) → 접수 제한 → 저장.
 * 한 곳에서 링크 하나에 10분에 10건, 하루 한도(링크 하나 40건·한 곳 15건)는 DB가 지킨다.
 * 사람이 보지 않는 칸이 채워져 있으면 기계로 보고 받지 않는다.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(req);
  const blocked = notLive() ?? crossSite(req) ?? limited(RULES.intake, ip);
  if (blocked) return blocked;
  try {
    const { token } = await params;
    // 맞는 주소인지 먼저 본다 (틀린 주소로는 본문을 읽지도, 접수 횟수를 쓰지도 않는다)
    const open = await openIntake(token);
    if (!open.ok) return gone(open, ip);
    const body = (await readJson(req, 4_500_000)) as Record<string, unknown>;
    const trap = body.extra ?? body.website;
    if (typeof trap === "string" && trap.trim()) throw new CommandError("자동으로 채워진 칸이 있어 접수하지 못했습니다. 화면을 새로 열어 다시 접수해 주세요.");
    const input = {
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      location: body.location as string,
      description: body.description as string,
      photoDataUrls: Array.isArray(body.photoDataUrls) ? (body.photoDataUrls as string[]) : [],
      org: body.org as string | undefined,
      name: body.name as string,
      phone: body.phone as string,
      consent: body.consent === true,
    };
    const checked = checkIntakeInput(input);
    if (!checked.ok) throw new CommandError("입력한 내용을 확인해 주세요.", "VALIDATION", checked.errors);
    const slow = limited(RULES.intakeSubmit, `${ip}|${tokenHash(token).slice(0, 12)}`);
    if (slow) return slow;
    const out = await submitIntakeByToken(token, input, ip);
    if (!out) return Response.json({ error: GONE.notfound, code: "notfound" }, { status: 404, headers: HEADERS });
    return Response.json(out, { headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}
