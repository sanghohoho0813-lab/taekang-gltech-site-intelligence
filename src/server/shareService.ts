/**
 * 보고서 링크 열기 (D-73) — 로그인하지 않은 사람이 주소의 비밀값만으로 여는 경로.
 *
 * - 비밀값(token)은 저장돼 있지 않다. 받은 값을 SHA-256으로 바꿔 링크 id와 맞춘다 (색인: records_share_id).
 * - 회사 전체 데이터를 읽지 않는다 — 링크 한 건, 그 문서에 든 사진 몇 장만 조회한다.
 * - 사진은 ‘문서에 든 번호’이면서 ‘지금도 발주처 공개’일 때만 준다 (공개를 끄면 링크에서도 바로 빠진다).
 * - 열어 본 횟수는 회사 잠금 안에서 링크 한 건만 고쳐 쓴다 (명령과 동시에 실행돼도 서로 덮어쓰지 않게).
 */
import type { MaterialMove, FieldReport, PartnerRequest, ReportShare, SitePhoto } from "@/lib/domain/types";
import { SHARE_TOKEN_RE, shareIdOf, sharePhotoVisible, shareState, shareViewCounts, type ShareDoc } from "@/lib/domain/share";
import { uid } from "@/lib/domain/ids";
import { getDb, type Tx } from "./sql";
import { deliver } from "./push";
import { RULES, hit, peek } from "./rateLimit";

type Json<T> = T | string;
const parse = <T>(v: Json<T>): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

export type ShareOpen =
  | {
      ok: true;
      title: string;
      createdAt: string;
      expiresAt: string;
      /** 만들 때 고정한 내용 — 사진은 지금도 공개인 것만 남긴다 (공개를 끈 사진은 번호·설명도 내보내지 않는다) */
      doc: ShareDoc;
      /** 보낸 뒤 공개를 거둔 사진 수 */
      hiddenPhotos: number;
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
  const visible = new Set(await visiblePhotoIds(db, f.companyId, f.share.siteId, doc.photos.map((p) => p.id)));
  const photos = doc.photos.filter((p) => visible.has(p.id));
  return { ok: true, title: f.share.title, createdAt: f.share.createdAt, expiresAt: f.share.expiresAt, doc: { ...doc, photos }, hiddenPhotos: doc.photos.length - photos.length };
}

/**
 * 주소 미리보기(카카오톡·문자)에 보일 ‘보낸 곳’ 이름 — 열려 있는 링크만. 요청이 많은 곳에는 주지 않는다 (없어도 화면은 열린다)
 */
export async function shareSender(token: unknown, who: string, now = new Date()): Promise<string | null> {
  if (typeof token !== "string" || !SHARE_TOKEN_RE.test(token)) return null;
  if (!hit(RULES.share, who, now.getTime()).ok) return null;
  const db = await getDb();
  const f = await findShare(db, token);
  if (!f || shareState(f.share, now.toISOString()) !== "open") return null;
  return f.share.snapshot?.company ?? null;
}

/**
 * 링크 속 사진을 줘도 되는지 — 문서에 든 번호이고 지금도 공개인 것만. 원본은 읽지 않는다
 * (브라우저가 ‘바뀌었는지’만 물을 때마다 사진 전체를 DB에서 꺼내지 않게 · 점검 9차)
 */
export async function sharePhotoAccess(token: unknown, photoId: unknown, now = new Date()): Promise<{ companyId: string } | null> {
  if (typeof photoId !== "string" || !/^[\w-]{1,80}$/.test(photoId)) return null;
  const db = await getDb();
  const f = await findShare(db, token);
  if (!f || shareState(f.share, now.toISOString()) !== "open") return null;
  if (!f.share.snapshot?.photos.some((p) => p.id === photoId)) return null;
  if (!(await visiblePhotoIds(db, f.companyId, f.share.siteId, [photoId])).length) return null;
  return { companyId: f.companyId };
}

/** 사진 원본 (sharePhotoAccess가 허락한 뒤에만 부른다) */
export async function sharePhotoBlob(companyId: string, photoId: string): Promise<{ mime: string; data: Uint8Array } | null> {
  const db = await getDb();
  const [row] = await db.query<{ mime: string; data: Uint8Array }>(`select mime, data from photo_blobs where id = $1 and company_id = $2`, [photoId, companyId]);
  return row ? { mime: row.mime, data: row.data } : null;
}

/** 링크 속 사진 원본 — 확인 + 읽기 */
export async function sharePhoto(token: unknown, photoId: unknown, now = new Date()): Promise<{ mime: string; data: Uint8Array } | null> {
  const ok = await sharePhotoAccess(token, photoId, now);
  return ok ? sharePhotoBlob(ok.companyId, photoId as string) : null;
}

/**
 * 열어 본 기록.
 * - 한 링크는 5분에 한 번만 센다 — 이 규칙은 DB의 마지막 시각으로 지킨다 (서버가 여러 대여도 같은 규칙).
 *   셀 때마다 회사 데이터 번호(rev)가 올라가 로그인한 모든 화면이 새로 받으므로, 여러 사람이 한꺼번에 열어도 폭주하지 않게 (점검 9차)
 * - 같은 곳(접속 주소)에서는 30분에 한 번 (서버 한 대 기준 메모리 — 보조 장치)
 * - 처음 열렸을 때는 활동 이력에 남기고 링크를 만든 사람에게 알린다 (금액·이름 없음)
 */
export async function countShareView(token: unknown, who: string, now = new Date()): Promise<{ counted: boolean }> {
  const db = await getDb();
  const f0 = await findShare(db, token);
  const at = now.toISOString();
  if (!f0 || shareState(f0.share, at) !== "open") return { counted: false };
  // 잠금을 잡기 전에 먼저 거른다 (셀 일이 없으면 회사 잠금을 건드리지 않는다)
  if (!shareViewCounts(f0.share, at)) return { counted: false };
  const id = f0.share.id;
  const viewer = `${id.slice(0, 16)}:${who}`;
  if (!peek(RULES.shareViewer, viewer, now.getTime()).ok) return { counted: false };
  const first = await db.transaction(async (tx) => {
    // 명령과 같은 회사 잠금 — 그 사이 실행 중인 명령이 이 링크를 옛 값으로 덮어쓰지 않게
    await tx.query(`select rev from companies where id = $1 for update`, [f0.companyId]);
    const [row] = await tx.query<{ data: Json<ReportShare> }>(`select data from records where company_id = $1 and collection = 'shares' and id = $2`, [f0.companyId, id]);
    if (!row) return null;
    const cur = parse(row.data);
    // 잠금 안에서 다시 확인 (그 사이 닫혔거나, 다른 서버가 방금 셌을 수 있다)
    if (shareState(cur, at) !== "open" || !shareViewCounts(cur, at)) return null;
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
  // 저장이 끝난 뒤에만 ‘이곳은 셌다’고 적는다 (저장이 실패했는데 30분 동안 못 세던 문제 · 점검 9차)
  hit(RULES.shareViewer, viewer, now.getTime());
  if (first) {
    await deliver(f0.companyId, [
      { to: [first.createdBy], title: "보낸 보고서를 열어 봤습니다", body: `${first.title} — 링크가 처음 열렸습니다`, url: `/sites/${first.siteId}?tab=requests`, tag: `share-${id.slice(0, 12)}` },
    ]).catch((e) => console.error("[push]", e));
  }
  return { counted: true };
}
