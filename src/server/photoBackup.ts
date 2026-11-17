/**
 * 사진 백업 (D-86) — 전체 자료 백업(JSON)에는 사진 원본이 없다(크기). 사진은 달마다 ZIP으로 따로 내려받는다(브라우저가 한 장씩 받아 묶음).
 * 이 파일은 그 현황(달마다 몇 장, 원본이 없는 사진 몇 장)과, 복원한 시스템에 사진 원본을 다시 올리는 일을 맡는다.
 * - 올리기는 ‘기록은 있는데 원본이 없는’ 사진만 채운다. 이미 있는 원본은 바꾸지 않는다(덮어쓰기 불가).
 * - 대표만. 한 번에 4MB 이하(서버 요청 한도 4.5MB) — 브라우저가 나눠 보낸다.
 */
import type { DemoDB } from "@/lib/domain/types";
import { CommandError, PHOTO_DATA_URL } from "@/lib/data/commands";
import { photoLooksReal } from "@/lib/domain/photoSniff";
import { photoMonth } from "@/lib/domain/photoBackup";
import { getDb } from "./sql";
import { ForbiddenError } from "./authz";
import { loadState } from "./state";
import { cachedState } from "./stateCache";
import { currentRev } from "./service";
import type { Member } from "./auth";

const MAX_PHOTO_BYTES = 2_500_000;
const MAX_ITEMS = 40;

export interface PhotoMonth {
  month: string;
  count: number;
  /** 원본이 없는 사진 (백업 복원 뒤 아직 안 올린 것) */
  missing: number;
}

export interface PhotoBackupStatus {
  total: number;
  missing: number;
  months: PhotoMonth[];
}

function requireCeo(m: Member) {
  if (m.role !== "ceo") throw new ForbiddenError("사진 백업은 대표만 할 수 있습니다.");
}

async function stateOf(m: Member): Promise<DemoDB> {
  const db = await getDb();
  const rev = await currentRev(m.companyId);
  return cachedState(m.companyId, rev) ?? (await db.transaction((tx) => loadState(tx, m.companyId)));
}

export async function photoBackupStatus(m: Member): Promise<PhotoBackupStatus> {
  requireCeo(m);
  const state = await stateOf(m);
  const db = await getDb();
  const rows = await db.query<{ id: string }>(`select id from photo_blobs where company_id = $1`, [m.companyId]);
  const stored = new Set(rows.map((r) => r.id));
  const byMonth = new Map<string, PhotoMonth>();
  let missing = 0;
  for (const p of state.photos) {
    const month = photoMonth(p.createdAt);
    const row = byMonth.get(month) ?? { month, count: 0, missing: 0 };
    row.count += 1;
    if (!stored.has(p.id)) {
      row.missing += 1;
      missing += 1;
    }
    byMonth.set(month, row);
  }
  return { total: state.photos.length, missing, months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)) };
}

export interface PhotoUpload {
  id: string;
  mime: string;
  /** base64 */
  data: string;
}

/** 원본이 없는 사진에 원본을 채운다. 기록에 없는 사진·이미 원본이 있는 사진은 건너뛴다 */
export async function restorePhotos(m: Member, items: unknown): Promise<{ saved: number; existed: number; unknown: number; invalid: number }> {
  requireCeo(m);
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new CommandError("요청 형식이 올바르지 않습니다.");
  const state = await stateOf(m);
  const known = new Map(state.photos.map((p) => [p.id, p]));
  const db = await getDb();
  let saved = 0;
  let existed = 0;
  let unknown = 0;
  let invalid = 0;
  for (const it of items as Partial<PhotoUpload>[]) {
    const p = typeof it?.id === "string" ? known.get(it.id) : undefined;
    if (!p) {
      unknown += 1;
      continue;
    }
    const url = `data:${it.mime};base64,${it.data}`;
    if (typeof it.data !== "string" || !PHOTO_DATA_URL.test(url) || !photoLooksReal(url)) {
      invalid += 1;
      continue;
    }
    const bytes = Buffer.from(it.data, "base64");
    if (bytes.length > MAX_PHOTO_BYTES) {
      invalid += 1;
      continue;
    }
    const rows = await db.query<{ id: string }>(
      `insert into photo_blobs (id, company_id, site_id, mime, data) values ($1, $2, $3, $4, $5) on conflict (id) do nothing returning id`,
      [p.id, m.companyId, p.siteId ?? null, it.mime, bytes],
    );
    if (rows.length) saved += 1;
    else existed += 1;
  }
  return { saved, existed, unknown, invalid };
}
