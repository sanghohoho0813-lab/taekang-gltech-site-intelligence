import type { NextRequest } from "next/server";
import { gzipSync } from "node:zlib";
import { exportCompany } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { errorResponse, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 서버 함수 시간 한도 (Vercel 기본 10초보다 넉넉히 · 전체 자료 백업: 크다 · D-50) */
export const maxDuration = 60;

/**
 * 전체 자료 백업 (대표 전용) — gzip으로 압축한 JSON(.json.gz)을 내려받는다.
 * 서버 함수의 응답 한도(Vercel 4.5MB)를 1년치 원문(약 15MB)이 넘기 때문에 압축한다 — 1년치 약 0.4MB (D-86).
 * 같은 파일로 빈 시스템에서 ‘백업 파일로 시작’(복원)을 할 수 있다.
 */
export async function GET(req: NextRequest) {
  const blocked = notLive();
  if (blocked) return blocked;
  try {
    const m = await requireMember(req);
    if (m instanceof Response) return m;
    const slow = limited(RULES.export, m.id);
    if (slow) return slow;
    const { filename, body } = await exportCompany(m);
    return new Response(new Uint8Array(gzipSync(Buffer.from(body, "utf8"), { level: 6 })), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}.gz"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
