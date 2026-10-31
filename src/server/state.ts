/**
 * 회사 데이터 ↔ DB.
 * - loadState: records·회사·사용자 표를 읽어 화면·계산이 쓰는 DemoDB 모양으로 조립
 * - persistState: 명령 실행 전(prev)·후(next)를 비교해 바뀐 엔터티만 upsert/delete
 *   (activityLogs는 추가만 — 감사 이력은 지우지 않는다)
 * - 사진: data URL은 photo_blobs에 원본 저장, 엔터티에는 /api/photos/{id} 주소만 남김
 */
import type { DemoDB, DemoUser, RiskThresholds } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import type { Tx } from "./sql";

type Item = Record<string, unknown>;
type KeyFn = (x: Item) => string;

const byId: KeyFn = (x) => String(x.id);
const bySiteCat: KeyFn = (x) => `${x.siteId}:${x.category}`;

/** DemoDB 배열 컬렉션 → 키 함수 */
export const COLLECTIONS = {
  sites: byId,
  contracts: (x: Item) => String(x.siteId),
  budgets: bySiteCat,
  forecasts: bySiteCat,
  costEntries: byId,
  reports: byId,
  photos: byId,
  changeOrders: byId,
  billings: byId,
  payments: byId,
  partnerRequests: byId,
  actions: byId,
  proofEvents: (x: Item) => String(x.proof_event_id),
  activityLogs: byId,
} satisfies Record<string, KeyFn>;
export type CollectionName = keyof typeof COLLECTIONS;
const NAMES = Object.keys(COLLECTIONS) as CollectionName[];

/** 최신 항목이 배열 앞에 오는 컬렉션 (명령이 unshift) */
const NEWEST_FIRST = new Set<CollectionName>(["reports", "proofEvents", "activityLogs"]);
/** 지우지 않는 컬렉션 */
const APPEND_ONLY = new Set<CollectionName>(["activityLogs"]);
const LOG_LIMIT = 300;

function siteIdOf(name: CollectionName, x: Item): string | null {
  if (name === "sites") return String(x.id);
  const v = x.siteId ?? x.site_id;
  return typeof v === "string" ? v : null;
}

export interface MemberRow {
  id: string;
  company_id: string;
  email: string;
  name: string;
  title: string;
  role: DemoUser["role"];
  site_ids: string[];
  partner_site_ids: string[];
  active: boolean;
  must_change_password: boolean;
}

export function memberToUser(m: MemberRow): DemoUser {
  return {
    id: m.id,
    role: m.role,
    name: m.name,
    title: m.title,
    ...(m.role === "partner" ? { partnerSiteIds: m.partner_site_ids ?? [] } : {}),
    ...(m.active ? {} : { inactive: true }),
  };
}

export async function loadState(tx: Tx, companyId: string): Promise<DemoDB> {
  const [company] = await tx.query<{ id: string; name: string; info: Record<string, string>; rev: string | number; updated_at: string | Date }>(
    `select id, name, info, rev, updated_at from companies where id = $1`,
    [companyId],
  );
  if (!company) throw new Error(`회사를 찾을 수 없습니다: ${companyId}`);
  const [st] = await tx.query<{
    seeded_at: string;
    baseline: DemoDB["baseline"];
    thresholds: RiskThresholds;
    settings: DemoDB["settings"];
    signal_states: DemoDB["signalStates"];
    idempotency_keys: string[];
  }>(`select seeded_at, baseline, thresholds, settings, signal_states, idempotency_keys from company_state where company_id = $1`, [companyId]);
  const members = await tx.query<MemberRow>(
    `select id, company_id, email, name, title, role, site_ids, partner_site_ids, active, must_change_password from members where company_id = $1 order by created_at`,
    [companyId],
  );
  const rows = await tx.query<{ collection: CollectionName; data: Item }>(
    `select collection, data from (
       select collection, data, seq, row_number() over (partition by collection order by seq desc) as rn
       from records where company_id = $1
     ) r where collection <> 'activityLogs' or rn <= ${LOG_LIMIT}
     order by collection, seq`,
    [companyId],
  );
  const db = {
    version: 1,
    rev: Number(company.rev),
    seededAt: st?.seeded_at ?? new Date().toISOString(),
    updatedAt: new Date(company.updated_at).toISOString(),
    company: { name: company.name, product: company.info?.product ?? "TAEKANG SITE INTELLIGENCE", tagline: company.info?.tagline ?? "" },
    users: members.map(memberToUser),
    baseline: st?.baseline ?? {},
    thresholds: st?.thresholds,
    settings: { ...DEFAULT_SETTINGS, ...(st?.settings ?? {}) },
    signalStates: st?.signal_states ?? {},
    idempotencyKeys: st?.idempotency_keys ?? [],
  } as unknown as DemoDB;
  const bag = db as unknown as Record<CollectionName, Item[]>;
  for (const n of NAMES) bag[n] = [];
  for (const r of rows) bag[r.collection]?.push(r.data);
  for (const n of NEWEST_FIRST) bag[n].reverse();
  return db;
}

/** data:image/...;base64 → photo_blobs, 엔터티에는 주소만 */
async function extractPhoto(tx: Tx, companyId: string, item: Item, key: "dataUrl"): Promise<void> {
  const v = item[key];
  if (typeof v !== "string" || !v.startsWith("data:")) return;
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(v);
  if (!m) throw new Error("사진 형식을 읽을 수 없습니다.");
  const mime = m[1];
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error("JPEG·PNG·WEBP 사진만 저장할 수 있습니다.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 2_500_000) throw new Error("사진 1장이 너무 큽니다 (2.5MB 이하).");
  const id = String(item.id);
  await tx.query(
    `insert into photo_blobs (id, company_id, site_id, mime, data) values ($1, $2, $3, $4, $5)
     on conflict (id) do nothing`,
    [id, companyId, (item.siteId as string) ?? null, mime, bytes],
  );
  item[key] = `/api/photos/${encodeURIComponent(id)}`;
}

/** prev → next 차이만 저장. next를 직접 고친다(사진 주소 치환) */
export async function persistState(tx: Tx, companyId: string, prev: DemoDB | null, next: DemoDB): Promise<{ written: number; deleted: number }> {
  let written = 0;
  let deleted = 0;
  const P = (prev ?? {}) as unknown as Record<CollectionName, Item[] | undefined>;
  const N = next as unknown as Record<CollectionName, Item[]>;
  for (const name of NAMES) {
    const keyOf = COLLECTIONS[name];
    const before = new Map((P[name] ?? []).map((x) => [keyOf(x), JSON.stringify(x)]));
    const after = N[name] ?? [];
    const seen = new Set<string>();
    // 새로 추가된 항목은 배열 순서대로 seq가 붙도록 (최신이 앞에 오는 컬렉션은 뒤에서부터)
    const ordered = NEWEST_FIRST.has(name) ? [...after].reverse() : after;
    for (const item of ordered) {
      const key = keyOf(item);
      seen.add(key);
      if (name === "photos") await extractPhoto(tx, companyId, item, "dataUrl");
      const json = JSON.stringify(item);
      if (before.get(key) === json) continue;
      if (APPEND_ONLY.has(name) && before.has(key)) continue;
      await tx.query(
        `insert into records (company_id, collection, id, site_id, data, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, now())
         on conflict (company_id, collection, id) do update set data = excluded.data, site_id = excluded.site_id, updated_at = now()`,
        [companyId, name, key, siteIdOf(name, item), json],
      );
      written++;
    }
    if (APPEND_ONLY.has(name)) continue;
    for (const key of before.keys()) {
      if (seen.has(key)) continue;
      await tx.query(`delete from records where company_id = $1 and collection = $2 and id = $3`, [companyId, name, key]);
      deleted++;
    }
  }

  const prevState = prev
    ? JSON.stringify([prev.baseline, prev.thresholds, prev.settings, prev.signalStates, prev.idempotencyKeys, prev.seededAt])
    : "";
  const nextState = JSON.stringify([next.baseline, next.thresholds, next.settings, next.signalStates, next.idempotencyKeys, next.seededAt]);
  if (prevState !== nextState) {
    await tx.query(
      `insert into company_state (company_id, seeded_at, baseline, thresholds, settings, signal_states, idempotency_keys)
       values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)
       on conflict (company_id) do update set seeded_at = excluded.seeded_at, baseline = excluded.baseline, thresholds = excluded.thresholds,
         settings = excluded.settings, signal_states = excluded.signal_states, idempotency_keys = excluded.idempotency_keys`,
      [
        companyId,
        next.seededAt,
        JSON.stringify(next.baseline ?? {}),
        JSON.stringify(next.thresholds),
        JSON.stringify(next.settings ?? DEFAULT_SETTINGS),
        JSON.stringify(next.signalStates ?? {}),
        JSON.stringify((next.idempotencyKeys ?? []).slice(-500)),
      ],
    );
  }
  await tx.query(`update companies set rev = $2, name = $3, info = $4::jsonb, updated_at = now() where id = $1`, [
    companyId,
    next.rev,
    next.company.name,
    JSON.stringify({ product: next.company.product, tagline: next.company.tagline }),
  ]);
  return { written, deleted };
}
