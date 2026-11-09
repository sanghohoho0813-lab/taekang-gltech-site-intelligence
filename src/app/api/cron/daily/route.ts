import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { json, notLive } from "@/server/http";
import { runDailyJobs } from "@/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 같은 길이로 비교 (응답 시간으로 비밀값을 맞혀 보지 못하게) */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * 매일 점검 (D-71) — Vercel 예약 작업(vercel.json crons)이 매일 아침 7시 30분(한국, UTC 22:30)에 부른다 — 현장 작업 시작 전에 아침 알림이 가도록 (D-72).
 * Vercel은 CRON_SECRET 환경변수가 있으면 ‘Authorization: Bearer <값>’을 붙여 보낸다. 값이 없거나 다르면 아무것도 하지 않는다.
 * 하는 일: 보관 기간 지난 위치 좌표 지우기, 하자보증 만료 60·30·7일 전 본사 알림. 응답에는 숫자만 (회사·현장 이름 없음).
 */
export async function GET(req: NextRequest) {
  const nl = notLive();
  if (nl) return nl;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return json({ error: "예약 작업 비밀값(CRON_SECRET)이 설정되지 않았습니다." }, 503);
  if (!same(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return json({ error: "권한이 없습니다." }, 401);
  try {
    const r = await runDailyJobs(new Date());
    // 한 회사라도 실패하면 500 — 예약 작업 기록에 실패로 남게
    return json({ ok: r.failed === 0, ...r }, r.failed ? 500 : 200);
  } catch (e) {
    console.error("[cron]", e);
    return json({ ok: false, error: "점검 중 오류가 났습니다." }, 500);
  }
}
