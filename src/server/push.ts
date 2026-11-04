/**
 * 휴대폰 알림 (웹 푸시, D-37) — 구독 저장·발송. 서버 전용.
 * - 구독 정보(주소·키)는 records 표의 pushSubscriptions에 저장하되 화면 데이터(loadState)·백업에는 넣지 않는다
 * - 발송 주소는 공식 푸시 서버(Google·Apple·Mozilla·Microsoft)만 허용 — 임의 주소로 서버가 요청하게 만드는 공격 차단
 * - 발송 실패는 명령 결과에 영향을 주지 않는다 (최대 4초 기다림)
 */
import { createHash } from "node:crypto";
import { CommandError } from "@/lib/data/commands";
import type { Notice } from "@/lib/domain/notify";
import { getDb } from "./sql";
import type { Member } from "./auth";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
interface StoredSub extends PushSubscriptionInput {
  id: string;
  userId: string;
  createdAt: string;
  ua?: string;
}
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}
type Sender = (sub: PushSubscriptionInput, payload: string) => Promise<{ statusCode: number }>;

const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const MAX_PER_USER = 5;
const COLLECTION = "pushSubscriptions";

export function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com" };
}

let testSender: Sender | null = null;
/** 테스트에서 실제 발송 대신 쓸 함수 (null이면 실제 발송) */
export function setPushSender(fn: Sender | null) {
  testSender = fn;
}

function b64urlLen(s: unknown): number {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return -1;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").length;
}

export function validateSubscription(input: unknown): PushSubscriptionInput {
  const s = input as PushSubscriptionInput | undefined;
  let url: URL | null = null;
  try {
    url = new URL(String(s?.endpoint ?? ""));
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || !PUSH_HOSTS.test(url.hostname) || String(s?.endpoint).length > 1000) throw new CommandError("알림을 등록할 수 없는 브라우저입니다.", "VALIDATION");
  if (b64urlLen(s?.keys?.p256dh) !== 65 || b64urlLen(s?.keys?.auth) !== 16) throw new CommandError("알림 등록 정보가 올바르지 않습니다.", "VALIDATION");
  return { endpoint: url.toString(), keys: { p256dh: s!.keys.p256dh, auth: s!.keys.auth } };
}

const idOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

export async function saveSubscription(m: Member, input: unknown, ua?: string): Promise<{ count: number }> {
  if (!vapid() && !testSender) throw new CommandError("알림이 아직 설정되지 않았습니다. 관리자에게 문의해주세요.", "STATE");
  const sub = validateSubscription(input);
  const db = await getDb();
  const id = idOf(sub.endpoint);
  const data: StoredSub = { id, userId: m.id, ...sub, createdAt: new Date().toISOString(), ...(ua ? { ua: ua.slice(0, 120) } : {}) };
  await db.transaction(async (tx) => {
    // 같은 휴대폰을 다른 사람이 쓰게 되면 주소가 같다 → 새 사람으로 바꾼다
    await tx.query(
      `insert into records (company_id, collection, id, site_id, data) values ($1, $2, $3, null, $4::jsonb)
       on conflict (company_id, collection, id) do update set data = excluded.data, updated_at = now()`,
      [m.companyId, COLLECTION, id, JSON.stringify(data)],
    );
    // 한 사람당 최근 5대까지만
    await tx.query(
      `delete from records where company_id = $1 and collection = $2 and data->>'userId' = $3 and id not in (
         select id from records where company_id = $1 and collection = $2 and data->>'userId' = $3 order by updated_at desc limit ${MAX_PER_USER})`,
      [m.companyId, COLLECTION, m.id],
    );
  });
  return { count: await countFor(m) };
}

export async function removeSubscription(m: Member, endpoint: unknown): Promise<{ count: number }> {
  const db = await getDb();
  if (typeof endpoint === "string" && endpoint) await db.query(`delete from records where company_id = $1 and collection = $2 and id = $3 and data->>'userId' = $4`, [m.companyId, COLLECTION, idOf(endpoint), m.id]);
  else await db.query(`delete from records where company_id = $1 and collection = $2 and data->>'userId' = $3`, [m.companyId, COLLECTION, m.id]);
  return { count: await countFor(m) };
}

/** 비활성화된 사람의 알림은 모두 지운다 */
export async function removeAllFor(companyId: string, userId: string) {
  const db = await getDb();
  await db.query(`delete from records where company_id = $1 and collection = $2 and data->>'userId' = $3`, [companyId, COLLECTION, userId]);
}

export async function countFor(m: Member): Promise<number> {
  const db = await getDb();
  const [r] = await db.query<{ n: number }>(`select count(*)::int as n from records where company_id = $1 and collection = $2 and data->>'userId' = $3`, [m.companyId, COLLECTION, m.id]);
  return Number(r?.n ?? 0);
}

async function send(sub: PushSubscriptionInput, payload: string): Promise<{ statusCode: number }> {
  if (testSender) return testSender(sub, payload);
  const v = vapid();
  if (!v) return { statusCode: 0 };
  const webpush = (await import("web-push")).default;
  try {
    const r = await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "high", vapidDetails: v, timeout: 3500 });
    return { statusCode: r.statusCode };
  } catch (e) {
    return { statusCode: Number((e as { statusCode?: number }).statusCode ?? 0) };
  }
}

/** 알림 발송 — 받을 사람의 활성 구독에만. 만료된 구독(404·410)은 지운다 */
export async function deliver(companyId: string, notices: Notice[]): Promise<{ sent: number; removed: number }> {
  if (!notices.length || (!vapid() && !testSender)) return { sent: 0, removed: 0 };
  const db = await getDb();
  const userIds = [...new Set(notices.flatMap((n) => n.to))];
  const rows = await db.query<{ data: StoredSub | string }>(
    `select r.data from records r join members m on m.id = r.data->>'userId' and m.company_id = r.company_id and m.active
     where r.company_id = $1 and r.collection = $2 and r.data->>'userId' = any($3::text[])`,
    [companyId, COLLECTION, userIds],
  );
  const subs = rows.map((r) => (typeof r.data === "string" ? (JSON.parse(r.data) as StoredSub) : r.data));
  const jobs = notices.flatMap((n) => subs.filter((s) => n.to.includes(s.userId)).map((s) => ({ s, payload: JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag } satisfies PushPayload) })));
  let sent = 0;
  const gone = new Set<string>();
  const run = Promise.allSettled(
    jobs.map(async ({ s, payload }) => {
      const r = await send(s, payload);
      if (r.statusCode >= 200 && r.statusCode < 300) sent += 1;
      if (r.statusCode === 404 || r.statusCode === 410) gone.add(s.id);
    }),
  );
  await Promise.race([run, new Promise((res) => setTimeout(res, 4000))]);
  for (const id of gone) await db.query(`delete from records where company_id = $1 and collection = $2 and id = $3`, [companyId, COLLECTION, id]);
  return { sent, removed: gone.size };
}
