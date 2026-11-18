import type { NextRequest } from "next/server";
import { decideSignup, type SignupDecision } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { crossSite, errorResponse, json, notLive, readJson, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 가입 신청 처리 — 승인(역할·현장) · 승인 안 함(이유) · 지우기. 가입 승인 담당(대표 권한 또는 지정된 본사 담당)만 (D-90) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = notLive() ?? crossSite(req);
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.members, m.id);
    if (slow) return slow;
    const { id } = await params;
    const out = await decideSignup(m, id, (await readJson(req, 20_000)) as SignupDecision);
    return json("deleted" in out ? { deleted: true } : { member: out });
  } catch (e) {
    return errorResponse(e);
  }
}
