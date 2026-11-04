/**
 * 앱 오류 기록 (D-47) — 화면 오류(휴대폰·PC)와 서버의 예상 못 한 오류를 남긴다. 본사(대표·관리자)만 본다.
 * - records 표의 errorLogs에 저장하되 화면 데이터(loadState)·명령 저장 비교에는 넣지 않는다 (알림 구독과 같은 방식)
 * - 같은 사람·같은 화면·같은 오류는 1시간 단위로 묶어 횟수만 늘린다 (오류가 반복돼도 표가 넘치지 않게)
 * - 회사당 최근 1,000종류까지만 보관
 * - 문구에서 이메일·긴 숫자(전화·금액)·토큰·데이터를 지운다 (서버에서 다시 — 보낸 쪽을 믿지 않음)
 */
import { createHash } from "node:crypto";
import { scrubRoute, scrubText, type ErrorEntry } from "@/lib/domain/feedback";
import { summarizeUa } from "@/lib/domain/device";
import { ForbiddenError } from "./authz";
import { getDb } from "./sql";
import type { Member } from "./auth";

const COLLECTION = "errorLogs";
/** 회사당 보관 종류 수 (테스트에서만 ERROR_LOG_MAX로 줄임) */
export const MAX_ERROR_ROWS = Math.max(10, Math.floor(Number(process.env.ERROR_LOG_MAX ?? 1000)) || 1000);

export interface ErrorInput {
  source: "client" | "server";
  route: unknown;
  message: unknown;
  stack?: unknown;
  ua?: string | null;
}

export async function recordError(m: Pick<Member, "id" | "role" | "companyId">, e: ErrorInput): Promise<void> {
  const db = await getDb();
  const message = scrubText(e.message, 200).trim() || "(내용 없음)";
  const route = e.source === "server" ? scrubText(e.route, 80) : scrubRoute(e.route);
  const stack = e.stack ? scrubText(String(e.stack).split("\n").slice(0, 4).join("\n"), 400) : "";
  const now = new Date().toISOString();
  const id = createHash("sha256").update([m.id, e.source, route, message, now.slice(0, 13)].join("|")).digest("hex").slice(0, 32);
  const data: ErrorEntry = {
    id,
    at: now,
    lastAt: now,
    count: 1,
    source: e.source,
    userId: m.id,
    role: m.role,
    route,
    message,
    ...(stack ? { stack } : {}),
    ...(e.ua ? { browser: summarizeUa(e.ua).browser } : {}),
  };
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into records (company_id, collection, id, site_id, data) values ($1, $2, $3, null, $4::jsonb)
       on conflict (company_id, collection, id) do update
         set data = jsonb_set(jsonb_set(records.data, '{count}', to_jsonb(coalesce((records.data->>'count')::int, 1) + 1)), '{lastAt}', to_jsonb($5::text)),
             updated_at = now()`,
      [m.companyId, COLLECTION, id, JSON.stringify(data), now],
    );
    await tx.query(
      `delete from records where company_id = $1 and collection = $2 and seq < coalesce(
         (select seq from records where company_id = $1 and collection = $2 order by seq desc offset ${MAX_ERROR_ROWS - 1} limit 1), 0)`,
      [m.companyId, COLLECTION],
    );
  });
}

/** 최근 오류 (대표·관리자) */
export async function listErrors(m: Member): Promise<{ errors: ErrorEntry[]; truncated: boolean }> {
  if (m.role !== "ceo" && m.role !== "manager") throw new ForbiddenError();
  const db = await getDb();
  const rows = await db.query<{ data: ErrorEntry }>(`select data from records where company_id = $1 and collection = $2 order by updated_at desc limit 301`, [m.companyId, COLLECTION]);
  return { errors: rows.slice(0, 300).map((r) => r.data), truncated: rows.length > 300 };
}
