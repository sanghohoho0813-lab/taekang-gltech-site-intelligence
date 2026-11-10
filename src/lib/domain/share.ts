/**
 * 보고서 링크 (D-73) — 발주처에 카카오톡·문자로 보내는 ‘로그인 없이 여는 읽기 전용 주소’.
 *
 * 원칙
 * - 만들 때의 내용으로 고정한다 (나중에 공정률을 고쳐도 보낸 보고서는 바뀌지 않는다 — 다시 보내려면 새 링크).
 * - 주소의 비밀값은 저장하지 않는다. 저장하는 것은 SHA-256 해시(id)뿐이라 DB·백업이 새도 링크를 열 수 없다.
 * - 금액·사람 이름·요청 내용(제목·글)은 넣지 않는다. 공정·공개 사진·건수만.
 * - 사진은 번호만 담고, 열 때마다 ‘지금도 발주처 공개인지’ 다시 확인한다 (공개를 끄면 링크에서도 바로 빠진다).
 * - 기한(7·14·30일)이 지나거나 본사가 닫으면 열리지 않는다.
 */
import type { DemoDB, PartnerFeedItem, ReportShare, Site, SitePhoto } from "./types";
import { PARTNER_FEED_KEEP_DAYS, partnerMonthly, partnerProgressFeed, photoWithdrawn, replyPhotoIds, type PartnerMonthly } from "./partnerFeed";
import { completionReport, type CompletionReport } from "./completion";
import { warrantyClientLine } from "./warranty";
import { fmtDate, todayIso } from "./format";
import { hex, sha256, utf8 } from "./hmac";

/** 고를 수 있는 기한 (일) */
export const SHARE_DAYS = [7, 14, 30] as const;
export const SHARE_DEFAULT_DAYS = 14;
/** 한 현장에 동시에 열어 둘 수 있는 링크 수 */
export const SHARE_MAX_OPEN_PER_SITE = 20;
/** 닫히거나 기한이 지난 링크를 목록에 남겨 두는 기간 (일) — 지나면 기록을 지운다 */
export const SHARE_KEEP_DAYS = 60;
/** 월간 보고서 링크로 고를 수 있는 지난 달 수 (이번 달 포함) */
export const SHARE_MONTHS_BACK = 24;
/** 열어 본 횟수: 한 링크는 5분에 한 번만 센다 (여러 사람이 한꺼번에 열어도 본사 화면이 계속 새로 받지 않게 — 점검 9차) */
export const SHARE_VIEW_GAP_MS = 5 * 60_000;
/** 본사가 ‘열어 보기’로 확인할 때 주소 뒤에 붙이는 표시 — 서버로 가지 않고, 열어 본 횟수에 넣지 않는다 */
export const SHARE_PREVIEW_HASH = "#preview";
/** 주소 비밀값: 24바이트 난수 → URL에 쓸 수 있는 글자 32자 (192비트) */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** 바이트 → base64url (채움 문자 없음 · 브라우저·서버 공용) */
export function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += B64[c & 63];
  }
  return out;
}

/** 새 주소 비밀값 — 끝 글자가 ‘-’·‘_’이면 메신저가 주소 끝을 잘라 먹을 수 있어 글자·숫자로 끝나는 것만 쓴다 */
export function newShareToken(random: (n: number) => Uint8Array): string {
  for (;;) {
    const t = base64url(random(24));
    if (/[A-Za-z0-9]$/.test(t)) return t;
  }
}

/** 이번에 열어 본 것을 셀까 — 처음이거나, 마지막으로 센 지 5분이 지났을 때만 */
export function shareViewCounts(s: Pick<ReportShare, "firstViewedAt" | "lastViewedAt">, nowIso: string): boolean {
  if (!s.firstViewedAt || !s.lastViewedAt) return true;
  return Date.parse(nowIso) - Date.parse(s.lastViewedAt) >= SHARE_VIEW_GAP_MS;
}

/** 주소 비밀값 → 저장용 id (SHA-256 hex) */
export const shareIdOf = (token: string) => hex(sha256(utf8(token)));

export type ShareState = "open" | "expired" | "revoked";
export function shareState(s: Pick<ReportShare, "expiresAt" | "revokedAt">, nowIso: string): ShareState {
  if (s.revokedAt) return "revoked";
  return s.expiresAt <= nowIso ? "expired" : "open";
}

/** 공유 문서 속 사진 — 번호·날짜·공개 설명만 (원본은 열 때 따로 받는다) */
export interface SharePhoto {
  id: string;
  /** 찍은 시각 (ISO) */
  at: string;
  caption?: string;
}

export interface MonthlyDoc {
  kind: "monthly";
  company: string;
  siteName: string;
  siteShort: string;
  month: string;
  from: string;
  to: string;
  /** 작성일 (한국 날짜) */
  asOf: string;
  /** 가상 시연 데이터로 만든 문서 */
  sample?: true;
  /** 보고 기간 끝의 전체 공정률 — 이번 달 보고서면 작성일 값, 지난 달 보고서면 그 달 말일 값 */
  progressPct: number;
  overall?: { from: number; to: number };
  /** 현장의 모든 공정 단계 (진행률은 보고 기간 끝 기준) — 그 달에 바뀐 단계는 change */
  stages: { name: string; startDate: string; endDate: string; progressPct: number; change?: { from: number; to: number } }[];
  photos: SharePhoto[];
  counts: PartnerMonthly["counts"];
  /** 다음 달 예정 공정 — ‘계획보다 늦음’ 판정은 넣지 않는다 (본사 화면 전용) */
  next: { name: string; startDate: string; endDate: string; progressPct: number }[];
  warranty?: string;
}

export interface CompletionDoc {
  kind: "completion";
  company: string;
  siteName: string;
  siteShort: string;
  clientName: string;
  workType: string;
  region: string;
  startDate: string;
  endDate: string;
  asOf: string;
  sample?: true;
  progressPct: number;
  completedDate?: string;
  finished: boolean;
  days: number;
  from: string;
  to: string;
  /** 계획 대비(늦음)·내부 번호는 넣지 않는다 */
  stages: { name: string; startDate: string; endDate: string; progressPct: number; doneDate?: string }[];
  months: CompletionReport["months"];
  emptyLead?: CompletionReport["emptyLead"];
  photos: SharePhoto[];
  defects: CompletionReport["defects"];
  requests: CompletionReport["requests"];
  warranty: string | null;
}

export type ShareDoc = MonthlyDoc | CompletionDoc;

const photoOf = (p: SitePhoto): SharePhoto => ({ id: p.id, at: p.createdAt, ...(p.shared?.caption ? { caption: p.shared.caption } : {}) });
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const sampleOf = (db: DemoDB) => (db.settings?.sampleData ? ({ sample: true } as const) : {});

/** 월간 보고서 문서 — 화면(포털·본사 미리보기)과 링크가 같은 내용을 쓴다. r은 partnerMonthly 결과 */
export function monthlyDocFrom(db: Pick<DemoDB, "company" | "settings">, site: Site, r: PartnerMonthly, today: string): MonthlyDoc {
  const warranty = warrantyClientLine(site);
  return {
    kind: "monthly",
    company: db.company.name,
    siteName: site.name,
    siteShort: site.shortName,
    month: r.month,
    from: r.from,
    to: r.to,
    asOf: today,
    ...sampleOf(db as DemoDB),
    progressPct: r.endPct,
    ...(r.overall ? { overall: r.overall } : {}),
    stages: site.stages.map((st, i) => {
      const ch = r.stages.find((x) => x.stage === st.name);
      return { name: st.name, startDate: st.startDate, endDate: st.endDate, progressPct: r.stageEnd[i] ?? st.progressPct, ...(ch ? { change: { from: ch.from, to: ch.to } } : {}) };
    }),
    photos: r.photos.map(photoOf),
    counts: r.counts,
    next: r.next.map(({ late: _late, ...n }) => (void _late, n)),
    ...(warranty ? { warranty } : {}),
  };
}

/** 그 달을 담을 만큼의 공정 변화 (발주처 계정용 62일보다 오래된 달도 본사는 만들 수 있다) */
export function feedForMonth(db: DemoDB, siteId: string, month: string, today: string): PartnerFeedItem[] {
  return partnerProgressFeed(db, siteId, today, Math.max(PARTNER_FEED_KEEP_DAYS, dayDiff(`${month}-01`, today) + 1));
}

/** 링크용 월간 보고서 — 특정 발주처 계정이 아니라 현장 전체 기준 (요청은 건수만) */
export function monthlyDoc(db: DemoDB, siteId: string, month: string, today: string): MonthlyDoc | null {
  const site = db.sites.find((s) => s.id === siteId);
  if (!site) return null;
  return monthlyDocFrom(db, site, partnerMonthly(db, siteId, month, feedForMonth(db, siteId, month, today), undefined, today), today);
}

export function completionDocFrom(db: Pick<DemoDB, "company" | "settings">, r: CompletionReport, today: string): CompletionDoc {
  const { site } = r;
  return {
    kind: "completion",
    company: db.company.name,
    siteName: site.name,
    siteShort: site.shortName,
    clientName: site.clientName,
    workType: site.workType,
    region: site.region,
    startDate: site.startDate,
    endDate: site.endDate,
    asOf: today,
    ...sampleOf(db as DemoDB),
    progressPct: site.progressPct,
    ...(r.completedDate ? { completedDate: r.completedDate } : {}),
    finished: r.finished,
    days: r.days,
    from: r.from,
    to: r.to,
    stages: r.stages.map((s) => ({ name: s.name, startDate: s.startDate, endDate: s.endDate, progressPct: s.progressPct, ...(s.doneDate ? { doneDate: s.doneDate } : {}) })),
    months: r.months,
    ...(r.emptyLead ? { emptyLead: r.emptyLead } : {}),
    photos: r.photos.map(photoOf),
    defects: r.defects,
    requests: r.requests,
    warranty: r.warranty,
  };
}

export function completionDoc(db: DemoDB, siteId: string, today: string): CompletionDoc | null {
  const r = completionReport(db, siteId, today);
  return r ? completionDocFrom(db, r, today) : null;
}

/** 준공 보고서 제목 — 준공일·공정률에 따라 (화면·링크 공용) */
export function completionTitle(d: Pick<CompletionDoc, "finished" | "completedDate">): string {
  return d.finished ? "준공 보고서" : d.completedDate ? "공사 정리 보고서" : "공사 진행 정리 (준공 전)";
}

/** 월간 보고서 이름의 달 — 작성한 해와 다른 해면 연도를 붙인다 (작년 11월과 올해 11월이 같은 이름이 되지 않게 · 점검 9차) */
export function monthTitle(month: string, asOf: string): string {
  const m = `${Number(month.slice(5, 7))}월`;
  return month.slice(0, 4) === asOf.slice(0, 4) ? m : `${month.slice(0, 4)}년 ${m}`;
}

/** 목록·활동 이력·보내는 글에 쓰는 이름 (예: ‘강남 물류 11월 공정 보고서’) */
export function shareTitle(doc: ShareDoc): string {
  if (doc.kind === "monthly") return `${doc.siteShort} ${monthTitle(doc.month, doc.asOf)} 공정 보고서`;
  return `${doc.siteShort} ${completionTitle(doc).replace(/\s*\(준공 전\)$/, "")}`;
}

/** 월간 보고서 링크로 고를 수 있는 달 — 착공한 달부터 이번 달까지, 최근 것부터 (최대 24개월) */
export function shareMonths(site: Pick<Site, "startDate">, today: string): string[] {
  const out: string[] = [];
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  const first = site.startDate.slice(0, 7);
  for (let i = 0; i < SHARE_MONTHS_BACK; i++) {
    const cur = `${y}-${String(m).padStart(2, "0")}`;
    if (cur < first) break;
    out.push(cur);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  // 착공 전(예정) 현장은 이번 달만
  return out.length ? out : [today.slice(0, 7)];
}

/** 이 사진을 링크에서 보여 줘도 되는가 — 지금도 발주처 공개이고, 취소한 보고·자재 기록의 사진이 아니며, 하자보수 회신 사진이 아닐 때만 */
export function sharePhotoVisible(db: Pick<DemoDB, "reports" | "materialMoves" | "partnerRequests">, p: SitePhoto | undefined, siteId: string): p is SitePhoto {
  return !!p && p.siteId === siteId && !!p.shared && !photoWithdrawn(db, p) && !replyPhotoIds(db).has(p.id);
}

/** 보내는 글 (카카오톡·문자에 붙여 넣기) — 금액·사람 이름 없음 */
export function shareMessage(a: { company: string; title: string; url: string; expiresAt: string }): string {
  return `[${a.company}] ${a.title}입니다.\n아래 주소를 누르면 로그인 없이 바로 보실 수 있습니다 (${fmtDate(a.expiresAt)}까지).\n${a.url}`;
}

/**
 * 링크가 닫히는 시각 — 그날 밤 자정 직전(한국 시간)까지.
 * 화면·보낼 글에는 날짜만 나오므로(‘11.24까지’), 그날 낮에 끊기면 약속과 다르다 (점검 9차).
 */
export function shareExpiry(now: Date, days: number): string {
  const day = todayIso(new Date(now.getTime() + days * 86_400_000));
  return new Date(`${day}T23:59:59.999+09:00`).toISOString();
}

/** 목록에 보여 줄 링크 (최근 만든 것부터) */
export function sharesOf(db: Pick<DemoDB, "shares">, siteId: string): ReportShare[] {
  return (db.shares ?? []).filter((s) => s.siteId === siteId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
