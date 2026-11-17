import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { exportCompany } from "@/server/service";
import { RULES, limited } from "@/server/rateLimit";
import { errorResponse, notLive, requireMember } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 서버 함수 시간 한도 (Vercel 기본 10초보다 넉넉히 · 전체 자료 백업: 크다 · D-50) */
export const maxDuration = 60;

/**
 * 전체 자료 백업 (대표 전용) — gzip으로 압축한 JSON(.json.gz)을 내려받는다.
 * 1년치 원문이 약 15MB라 압축하고(실제와 비슷한 자료 1년치 약 2MB), 흘려보내서 서버 응답 한도(Vercel 4.5MB, 스트리밍 아닌 응답)에 걸리지 않게 한다 (D-86).
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
    // 흘려보내는(스트리밍) 응답 — 서버 응답 한도 4.5MB는 스트리밍 응답에는 적용되지 않는다. 실제와 비슷한 1년치가 압축 약 2MB라 몇 년 쓰면 넘기 때문 (점검 반영)
    const gz = Readable.from([Buffer.from(body, "utf8")]).pipe(createGzip({ level: 6 }));
    return new Response(Readable.toWeb(gz) as unknown as ReadableStream<Uint8Array>, {
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
