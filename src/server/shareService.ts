/**
 * 보고서 링크 열기 (D-73) — 로그인하지 않은 사람이 주소의 비밀값만으로 여는 경로.
 *
 * - 비밀값(token)은 저장돼 있지 않다. 받은 값을 SHA-256으로 바꿔 링크 id와 맞춘다 (색인: records_share_id).
 * - 회사 전체 데이터를 읽지 않는다 — 링크 한 건, 그 문서에 든 사진 몇 장만 조회한다.
 * - 사진은 ‘문서에 든 번호’이면서 ‘지금도 발주처 공개’일 때만 준다 (공개를 끄면 링크에서도 바로 빠진다).
 * - 열어 본 횟수는 회사 잠금 안에서 링크 한 건만 고쳐 쓴다 (명령과 동시에 실행돼도 서로 덮어쓰지 않게).
 */
import type { MaterialMove, FieldReport, PartnerRequest, ReportShare, SitePhoto } from "@/lib/domain/types";
import { SHARE_TOKEN_RE, shareIdOf, sharePhotoVisible, shareState, type ShareDoc } from "@/lib/domain/share";
import { uid } from "@/lib/domain/ids";
import { getDb, type Tx } from "./sql";
import { deliver } from "./push";
import { RULES, hit } from "./rateLimit";

type Json<T> = T | string;
const parse = <T>(v: Json<T>): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

export type ShareOpen =
  | {
      ok: true;
      title: string;
      createdAt: string;
      expiresAt: string;
      doc: ShareDoc;
      /** 지금 보여 줄 수 있는 사진 번호 (문서에 든 것 중 공개가 유지된 것) */
      photoIds: string[];
    }
  | { ok: false; reason: "notfound" | "expired" | "revoked" };

interface Found {
  companyId: string;
  share: ReportShare;
}

async function findShare(tx: Tx, token: unknown): Promise<Found | null> {
  if (typeof token !== "string" || !SHARE_TOKEN_RE.test(token)) return null;
  const rows = await tx.query<{ company_id: string; data: Json<ReportShare> }>(`select company_id, data from records where collection = 'shares' and id = $1 limit 1`, [shareIdOf(token)]);
  if (!rows.length) return null;
  return { companyId: rows[0].company_id, share: parse(rows[0].data) };
}

/** 문서에 든 사진 중 지금도 보여 줄 수 있는 것 — 사진·연결된 보고·자재 기록·하자보수 회신만 골라 읽는다 */
async function visiblePhotoIds(tx: Tx, companyId: string, siteId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.query<{ data: Json<SitePhoto> }>(`select data from records where company_id = $1 and collection = 'photos' and id = any($2::text[])`, [companyId, ids]);
  const photos = rows.map((r) => parse(r.data)).filter((p) => p.siteId === siteId && !!p.shared);
  if (!photos.length) return [];
  const reportIds = [...new Set(photos.flatMap((p) => (p.reportId ? [p.reportId] : [])))];
  const moveIds = [...new Set(photos.flatMap((p) => (p.materialMoveId ? [p.materialMoveId] : [])))];
  const [reports, moves, requests] = await Promise.all([
    reportIds.length ? tx.query<{ data: Json<FieldReport> }>(`select data from records where company_id = $1 and collection = 'reports' and id = any($2::text[])`, [companyId, reportIds]) : Promise.resolve([]),
    moveIds.length ? tx.query<{ data: Json<MaterialMove> }>(`select data from records where company_id = $1 and collection = 'materialMoves' and id = any($2::text[])`, [companyId, moveIds]) : Promise.resolve([]),
    tx.query<{ data: Json<PartnerRequest> }>(`select data from records where company_id = $1 and collection = 'partnerRequests' and site_id = $2`, [companyId, siteId]),
  ]);
  const mini = { reports: reports.map((r) => parse(r.data)), materialMoves: moves.map((r) => parse(r.data)), partnerRequests: requests.map((r) => parse(r.data)) };
  const ok = new Set(photos.filter((p) => sharePhotoVisible(mini, p, siteId)).map((p) => p.id));
  // 문서에 든 순서 그대로
  return ids.filter((id) => ok.has(id));
}

/** 링크 열기 — 내용(스냅샷)과 지금 보여 줄 수 있는 사진 번호. 없는 주소·기한 지남·닫힘은 이유만 */
export async function openShare(token: unknown, now = new Date()): Promise<ShareOpen> {
  const db = await getDb();
  const f = await findShare(db, token);
  if (!f) return { ok: false, reason: "notfound" };
  const state = shareState(f.share, now.toISOString());
  if (state !== "open") return { ok: false, reason: state };
  const doc = f.share.snapshot;
  if (!doc) return { ok: false, reason: "notfound" };
  const photoIds = await visiblePhotoIds(db, f.companyId, f.share.siteId, doc.photos.map((p) => p.id));
  return { ok: true, title: f.share.title, createdAt: f.share.createdAt, expiresAt: f.share.expiresAt, doc, photoIds };
}

/** 링크 속 사진 원본 — 문서에 든 번호이고 지금도 공개인 것만 */
export async function sharePhoto(token: unknown, photoId: unknown, now = new Date()): Promise<{ mime: string; data: Uint8Array } | null> {
  if (typeof photoId !== "string" || !/^[\w-]{1,80}$/.test(photoId)) return null;
  const db = await getDb();
  const f = await findShare(db, token);
  if (!f || shareState(f.share, now.toISOString()) !== "open") return null;
  if (!f.share.snapshot?.photos.some((p) => p.id === photoId)) return null;
  if (!(await visiblePhotoIds(db, f.companyId, f.share.siteId, [photoId])).length) return null;
  const [row] = await db.query<{ mime: string; data: Uint8Array }>(`select mime, data from photo_blobs where id = $1 and company_id = $2`, [photoId, f.companyId]);
  return row ? { mime: row.mime, data: row.data } : null;
}

/**
 * 열어 본 기록 — 같은 곳(접속 주소)에서 30분 안에 다시 열면 세지 않는다. 링크 하나에 시간당 60번까지만 쓴다 (쓰기 폭주 방지).
 * 처음 열렸을 때는 활동 이력에 남기고 링크를 만든 사람에게 알린다 (금액·이름 없음).
 */
export async function countShareView(token: unknown, who: string, now = new Date()): Promise<{ counted: boolean }> {
  const db = await getDb();
  const f0 = await findShare(db, token);
  if (!f0 || shareState(f0.share, now.toISOString()) !== "open") return { counted: false };
  const id = f0.share.id;
  if (!hit(RULES.shareViewer, `${id.slice(0, 16)}:${who}`, now.getTime()).ok) return { counted: false };
  if (!hit(RULES.shareWrites, id.slice(0, 16), now.getTime()).ok) return { counted: false };
  const at = now.toISOString();
  const first = await db.transaction(async (tx) => {
    // 명령과 같은 회사 잠금 — 그 사이 실행 중인 명령이 이 링크를 옛 값으로 덮어쓰지 않게
    await tx.query(`select rev from companies where id = $1 for update`, [f0.companyId]);
    const [row] = await tx.query<{ data: Json<ReportShare> }>(`select data from records where company_id = $1 and collection = 'shares' and id = $2`, [f0.companyId, id]);
    if (!row) return null;
    const cur = parse(row.data);
    if (shareState(cur, at) !== "open") return null;
    const next: ReportShare = { ...cur, views: (cur.views ?? 0) + 1, firstViewedAt: cur.firstViewedAt ?? at, lastViewedAt: at };
    await tx.query(`update records set data = $3::jsonb, updated_at = now() where company_id = $1 and collection = 'shares' and id = $2`, [f0.companyId, id, JSON.stringify(next)]);
    const isFirst = !cur.firstViewedAt;
    if (isFirst) {
      const log = { id: uid("log"), at, by: "system", type: "share", siteId: cur.siteId, summary: `보고서 링크 처음 열림 — ${cur.title}`, link: `/sites/${cur.siteId}?tab=requests` };
      await tx.query(`insert into records (company_id, collection, id, site_id, data) values ($1, 'activityLogs', $2, $3, $4::jsonb)`, [f0.companyId, log.id, cur.siteId, JSON.stringify(log)]);
    }
    // 화면이 새 횟수를 받도록 (기억해 둔 회사 데이터도 다음 명령에서 다시 읽는다)
    await tx.query(`update companies set rev = rev + 1, updated_at = now() where id = $1`, [f0.companyId]);
    return isFirst ? cur : false;
  });
  if (first === null) return { counted: false };
  if (first) {
    await deliver(f0.companyId, [
      { to: [first.createdBy], title: "보낸 보고서를 열어 봤습니다", body: `${first.title} — 링크가 처음 열렸습니다`, url: `/sites/${first.siteId}?tab=requests`, tag: `share-${id.slice(0, 12)}` },
    ]).catch((e) => console.error("[push]", e));
  }
  return { counted: true };
}
