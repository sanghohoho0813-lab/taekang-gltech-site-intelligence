/**
 * 휴대폰 알림 (웹 푸시, D-37) — 구독 저장·발송. 서버 전용.
 * - 구독 정보(주소·키)는 records 표의 pushSubscriptions에 저장하되 화면 데이터(loadState)·백업에는 넣지 않는다
 * - 발송 주소는 공식 푸시 서버(Google·Apple·Mozilla·Microsoft)만 허용 — 임의 주소로 서버가 요청하게 만드는 공격 차단
 * - 발송 실패는 명령 결과에 영향을 주지 않는다 (최대 4초 기다림)
 */
import { createHash } from "node:crypto";
import { CommandError } from "@/lib/data/commands";
import type { Notice } from "@/lib/domain/notify";
import { getDb, type Tx } from "./sql";
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

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
  /** env = Vercel 환경변수 · app = 대표가 운영 설정에서 켜서 서버가 만든 키 (D-91) */
  source: "env" | "app";
}
interface StoredVapid {
  id: string;
  publicKey: string;
  privateKey: string;
  subject: string;
  createdAt: string;
  createdBy: string;
}

/**
 * 알림 키 보관 (D-91) — records 표의 serverKeys에 회사마다 1개.
 * COLLECTIONS 목록에 없어 화면 데이터(loadState)·전체 백업·복원에 들어가지 않는다(비밀키가 휴대폰·파일로 나가지 않음).
 * DB 공개 API는 전 테이블 RLS로 막혀 있다.
 */
export const KEY_COLLECTION = "serverKeys";
const VAPID_ID = "vapid";
const FALLBACK_SUBJECT = "mailto:admin@example.com";

function envVapid(): Vapid | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || FALLBACK_SUBJECT, source: "env" };
}

/** 환경변수 키가 있는가 (있으면 그것을 쓰고, 화면에서 켤 필요가 없다) */
export function hasEnvVapid(): boolean {
  return !!envVapid();
}

const appKeys = new Map<string, Vapid>();

/** 이 회사가 쓸 알림 키 — 환경변수가 먼저, 없으면 화면에서 켠 키. 둘 다 없으면 null */
export async function vapidFor(companyId: string): Promise<Vapid | null> {
  const env = envVapid();
  if (env) return env;
  const hit = appKeys.get(companyId);
  if (hit) return hit;
  const db = await getDb();
  const [row] = await db.query<{ data: StoredVapid | string }>(`select data from records where company_id = $1 and collection = $2 and id = $3`, [companyId, KEY_COLLECTION, VAPID_ID]);
  if (!row) return null;
  const d = typeof row.data === "string" ? (JSON.parse(row.data) as StoredVapid) : row.data;
  if (b64urlLen(d?.publicKey) !== 65 || b64urlLen(d?.privateKey) !== 32) return null;
  const v: Vapid = { publicKey: d.publicKey, privateKey: d.privateKey, subject: process.env.VAPID_SUBJECT?.trim() || d.subject || FALLBACK_SUBJECT, source: "app" };
  appKeys.set(companyId, v);
  return v;
}

/** 알림을 실제로 보낼 수 있는가 (키가 있거나 테스트 발송 함수) — 매일 점검이 보내지 못할 알림을 ‘보냄’으로 남기지 않게 (D-71) */
export async function pushReadyFor(companyId: string): Promise<boolean> {
  return !!testSender || !!(await vapidFor(companyId));
}

/** VAPID 발신자 — 운영 주소(https)면 그 주소, 아니면 예비 메일 주소 */
export function vapidSubject(origin: string | null | undefined): string {
  try {
    const u = new URL(String(origin ?? ""));
    if (u.protocol === "https:") return u.origin;
  } catch {
    /* 아래 예비 값 */
  }
  return FALLBACK_SUBJECT;
}

/**
 * 화면에서 켠 알림 키를 만든다 (D-91 · 대표 확인은 부르는 쪽). 이미 있으면 그대로 둔다(키가 바뀌면 모든 휴대폰이 다시 켜야 함).
 * @returns 새로 만들었으면 true
 */
export async function createAppVapid(tx: Tx, companyId: string, by: string, subject: string, now = new Date()): Promise<boolean> {
  const webpush = (await import("web-push")).default;
  const keys = webpush.generateVAPIDKeys();
  const data: StoredVapid = { id: VAPID_ID, publicKey: keys.publicKey, privateKey: keys.privateKey, subject, createdAt: now.toISOString(), createdBy: by };
  const rows = await tx.query<{ id: string }>(
    `insert into records (company_id, collection, id, site_id, data) values ($1, $2, $3, null, $4::jsonb) on conflict (company_id, collection, id) do nothing returning id`,
    [companyId, KEY_COLLECTION, VAPID_ID, JSON.stringify(data)],
  );
  return rows.length > 0;
}

/** 서버 상태 확인용 — 알림 키가 어딘가에 있는가 (값은 보지 않음) */
export async function anyAppVapid(): Promise<boolean> {
  const db = await getDb();
  const [r] = await db.query<{ n: number }>(`select count(*)::int as n from records where collection = $1 and id = $2`, [KEY_COLLECTION, VAPID_ID]);
  return Number(r?.n ?? 0) > 0;
}

/** 테스트에서 기억해 둔 키를 비운다 */
export function forgetAppKeys() {
  appKeys.clear();
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
  if (!testSender && !(await vapidFor(m.companyId))) throw new CommandError("회사 휴대폰 알림이 아직 꺼져 있습니다. 대표가 ‘운영 관리 → 운영 설정’에서 먼저 켜야 합니다.", "STATE");
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

async function send(sub: PushSubscriptionInput, payload: string, v: Vapid | null): Promise<{ statusCode: number }> {
  if (testSender) return testSender(sub, payload);
  if (!v) return { statusCode: 0 };
  const webpush = (await import("web-push")).default;
  try {
    const r = await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "high", vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey }, timeout: 3500 });
    return { statusCode: r.statusCode };
  } catch (e) {
    return { statusCode: Number((e as { statusCode?: number }).statusCode ?? 0) };
  }
}

/** 알림 발송 — 받을 사람의 활성 구독에만. 만료된 구독(404·410)은 지운다 */
export async function deliver(companyId: string, notices: Notice[]): Promise<{ sent: number; removed: number }> {
  if (!notices.length) return { sent: 0, removed: 0 };
  const v = testSender ? null : await vapidFor(companyId);
  if (!v && !testSender) return { sent: 0, removed: 0 };
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
      const r = await send(s, payload, v);
      if (r.statusCode >= 200 && r.statusCode < 300) sent += 1;
      if (r.statusCode === 404 || r.statusCode === 410) gone.add(s.id);
    }),
  );
  await Promise.race([run, new Promise((res) => setTimeout(res, 4000))]);
  for (const id of gone) await db.query(`delete from records where company_id = $1 and collection = $2 and id = $3`, [companyId, COLLECTION, id]);
  return { sent, removed: gone.size };
}
