/**
 * 개인위치정보 (출퇴근·보고 위치) 운영 규칙 — 회사가 정한 값대로 동작하는 순수 함수 (D-43)
 *
 * 회사가 정하는 것 (계약 별지 제5호 ‘적용 확인’ · 법률·노무 전문가 확인 후 대표가 설정):
 * - 보관 기간: 지나면 좌표·오차·거리를 자동으로 지운다. 시각과 판정(현장 안/밖)은 근무 기록으로 남긴다.
 * - 좌표를 볼 수 있는 사람: 대표만 / 대표·관리자
 * 직원 본인은 언제든 자기 기록을 보고(내 정보), 동의를 철회할 수 있다. 철회하면 본인 좌표를 바로 지운다.
 * 동의할 때 알린 조건(보관 기간·볼 수 있는 사람)을 동의 기록에 함께 남긴다.
 * 회사가 조건을 직원에게 불리하게 바꾸면(더 오래 보관·더 많은 사람이 봄) 다음 출근 때 다시 동의를 받는다.
 */
import type { DemoDB, GeoStamp, LocationConsent, LocationPolicy, RoleId } from "./types";

/** 동의 문구 판 — 문구 내용을 바꾸면 올려서 다시 동의받는다 (2: 보관 기간·볼 수 있는 사람·철회 안내 추가) */
export const CONSENT_VERSION = 2;

/** 고를 수 있는 보관 기간 (일) */
export const RETENTION_CHOICES = [30, 90, 180, 365, 1095] as const;
export const RETENTION_MIN = 30;
export const RETENTION_MAX = 1825;

export const DEFAULT_POLICY: LocationPolicy = { retentionDays: null, viewers: "hq" };

export function locationPolicy(db: Pick<DemoDB, "settings">): LocationPolicy {
  const p = db.settings?.location;
  return {
    retentionDays: typeof p?.retentionDays === "number" ? p.retentionDays : null,
    viewers: p?.viewers === "ceo" ? "ceo" : "hq",
    ...(p?.purgedOn ? { purgedOn: p.purgedOn } : {}),
    ...(p?.updatedAt ? { updatedAt: p.updatedAt } : {}),
  };
}

export const retentionText = (days: number | null | undefined) =>
  days == null ? "회사가 정하는 기간 (정해지면 다시 알려드림)" : days % 365 === 0 ? `${days / 365}년` : `${days}일`;
export const viewersText = (v: LocationPolicy["viewers"]) => (v === "ceo" ? "대표만" : "대표·관리자");

/** 좌표를 볼 수 있는 역할인가 (본인 기록은 언제나 볼 수 있다) */
export function canSeeCoordinates(role: RoleId, policy: LocationPolicy): boolean {
  return role === "ceo" || (role === "manager" && policy.viewers === "hq");
}

/** 이 좌표를 볼 수 있는가 — 지금 규칙 + 수집할 때 약속(대표만) 중 더 엄격한 쪽 (D-49) */
export function canSeeStamp(role: RoleId, policy: LocationPolicy, g?: GeoStamp): boolean {
  return canSeeCoordinates(role, policy) && !(role !== "ceo" && g?.ceoOnly);
}

/** 수집할 때의 규칙을 좌표에 붙인다 — 나중에 회사가 규칙을 넓혀도 그때 약속(대표만·보관 기간)을 지킨다 (D-49) */
export function stampTerms(db: Pick<DemoDB, "settings">, g: GeoStamp): GeoStamp {
  if (!hasCoords(g)) return g;
  const p = locationPolicy(db);
  return { ...g, ...(p.viewers === "ceo" ? { ceoOnly: true as const } : {}), ...(p.retentionDays != null ? { keepDays: p.retentionDays } : {}) };
}

/** 동의 당시 조건이 지금 조건보다 직원에게 불리하지 않은가 (보관 기간이 같거나 짧고, 볼 수 있는 사람이 같거나 적음) */
function termsCover(c: LocationConsent, p: LocationPolicy): boolean {
  const agreed = c.retentionDays === undefined ? null : c.retentionDays; // 예전 동의(조건 기록 없음) = 기간 미정
  // 기간 미정으로 동의했으면 기간이 정해질 때 한 번 다시 알린다 (동의 문구의 ‘정해지면 다시 알려드립니다’ 약속 · D-49)
  const retentionOk = agreed === null ? p.retentionDays === null : p.retentionDays !== null && p.retentionDays <= agreed;
  const wider = p.viewers === "hq" && c.viewers === "ceo";
  return retentionOk && !wider;
}

/** 화면에 보여준 동의 조건 (서버가 지금 규칙과 같은지 확인) */
export interface ConsentTerms {
  version: number;
  retentionDays: number | null;
  viewers: LocationPolicy["viewers"];
}
export function currentTerms(db: Pick<DemoDB, "settings">): ConsentTerms {
  const p = locationPolicy(db);
  return { version: CONSENT_VERSION, retentionDays: p.retentionDays, viewers: p.viewers };
}
export function sameTerms(a: unknown, b: ConsentTerms): boolean {
  const x = a as Partial<ConsentTerms> | undefined;
  return !!x && x.version === b.version && (x.retentionDays ?? null) === b.retentionDays && x.viewers === b.viewers;
}

/** 지금 조건으로 유효한 동의가 있는가 */
export function hasConsent(db: Pick<DemoDB, "consents" | "settings">, userId: string): boolean {
  const p = locationPolicy(db);
  return (db.consents ?? []).some((c) => c.userId === userId && c.version >= CONSENT_VERSION && termsCover(c, p));
}

/** 동의 기록 — 알린 조건을 함께 남긴다 */
export function consentRecord(db: Pick<DemoDB, "settings">, userId: string, at: string): LocationConsent {
  const p = locationPolicy(db);
  return { userId, at, version: CONSENT_VERSION, retentionDays: p.retentionDays, viewers: p.viewers };
}

/** 이 위치 기록에 좌표(또는 좌표에서 나온 거리·오차)가 남아 있는가 */
export const hasCoords = (g: GeoStamp | undefined): g is GeoStamp => !!g && (g.lat !== undefined || g.lng !== undefined || g.distanceM !== undefined || g.accuracyM !== undefined);

/** 좌표·오차·거리를 빼고 판정(현장 안/밖)과 이유만 남긴다 */
export function stripGeo(g: GeoStamp, mark?: "purged"): GeoStamp {
  return { status: g.status, ...(g.reason ? { reason: g.reason } : {}), ...(mark || g.purged ? { purged: true as const } : {}) };
}

/** 지운 것 없이 빠르게: 기간이 지난 좌표가 하나라도 있는가 (만들지 않고 숫자만 비교 · D-50) */
export function anyExpired(db: DemoDB, today: string, policyDays: number | null): boolean {
  const day0 = Date.parse(`${today}T00:00:00+09:00`);
  const check = (g: GeoStamp | undefined, iso: string | undefined) => {
    if (!g || !iso || (g.lat === undefined && g.distanceM === undefined && g.accuracyM === undefined && g.lng === undefined)) return false;
    const days = Math.min(policyDays ?? Infinity, g.keepDays ?? Infinity);
    return Number.isFinite(days) && Date.parse(iso) < day0 - days * 86_400_000;
  };
  for (const r of db.attendance ?? []) if (check(r.inGeo, r.inAt) || check(r.outGeo, r.outAt)) return true;
  for (const c of db.crewChecks ?? []) if (check(c.geo, c.at)) return true;
  for (const r of db.reports) if (check(r.geo, r.createdAt)) return true;
  return false;
}

/** 보관 기간이 지난 좌표인가 — 지금 규칙과 수집할 때 알린 기간 중 짧은 쪽 (D-49) */
export function expiredStamp(g: GeoStamp, collectedOn: string, today: string, policyDays: number | null): boolean {
  const days = Math.min(policyDays ?? Infinity, g.keepDays ?? Infinity);
  return Number.isFinite(days) && collectedOn < shiftIso(today, -days);
}

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
export const shiftIso = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

type Filter = { userId?: string; before?: string; expired?: { today: string; policyDays: number | null } };

/** 조건에 맞는 기록의 좌표를 지운다 — 바뀐 건수를 돌려준다 (db를 직접 바꾼다: 복사본에만 쓸 것) */
export function eraseCoordinates(db: DemoDB, f: Filter): number {
  let n = 0;
  const fix = (g: GeoStamp | undefined, iso: string | undefined): GeoStamp | undefined => {
    if (!hasCoords(g) || !iso) return g;
    const d = kst(iso);
    if (f.before && !(d < f.before)) return g;
    if (f.expired && !expiredStamp(g, d, f.expired.today, f.expired.policyDays)) return g;
    n += 1;
    return stripGeo(g, "purged");
  };
  db.attendance = (db.attendance ?? []).map((r) => {
    if (f.userId && r.userId !== f.userId) return r;
    const inGeo = fix(r.inGeo, r.inAt)!;
    const outGeo = r.outAt ? fix(r.outGeo, r.outAt) : r.outGeo;
    return inGeo === r.inGeo && outGeo === r.outGeo ? r : { ...r, inGeo, ...(outGeo ? { outGeo } : {}) };
  });
  db.crewChecks = (db.crewChecks ?? []).map((c) => {
    if (f.userId && c.by !== f.userId) return c;
    const geo = fix(c.geo, c.at);
    return geo === c.geo ? c : { ...c, geo };
  });
  db.reports = db.reports.map((r) => {
    if (f.userId && r.createdBy !== f.userId) return r;
    const geo = fix(r.geo, r.createdAt);
    return geo === r.geo ? r : { ...r, geo };
  });
  return n;
}

/** 보관 기간이 지나 지워야 할 기준일 (이 날짜보다 앞선 기록) — 기간을 정하지 않았으면 null */
export function retentionCutoff(policy: LocationPolicy, today: string): string | null {
  return policy.retentionDays == null ? null : shiftIso(today, -policy.retentionDays);
}

/** 좌표가 남아 있는 기록 현황 (설정 화면용) */
export function coordinateStats(db: DemoDB): { count: number; oldest: string | null; purged: number } {
  let count = 0;
  let purged = 0;
  let oldest: string | null = null;
  const see = (g: GeoStamp | undefined, iso: string | undefined) => {
    if (g?.purged) purged += 1;
    if (!iso || !hasCoords(g)) return;
    count += 1;
    const d = kst(iso);
    if (!oldest || d < oldest) oldest = d;
  };
  for (const r of db.attendance ?? []) {
    see(r.inGeo, r.inAt);
    see(r.outGeo, r.outAt);
  }
  for (const c of db.crewChecks ?? []) see(c.geo, c.at);
  for (const r of db.reports) see(r.geo, r.createdAt);
  return { count, oldest, purged };
}

export const kstToday = (now: Date) => kst(now.toISOString());

/** 직원에게 보여주는 동의 안내 (출근 동의 화면과 본사 ‘직원에게 알리는 내용’ 미리보기가 같은 문구를 쓴다) */
export function consentNotice(p: LocationPolicy): string[] {
  return [
    "출근·퇴근·보고 버튼을 누를 때만 위치를 한 번 기록합니다. 계속 따라다니며 기록하지 않습니다.",
    `현장에 있었는지 확인하는 데만 씁니다. 좌표는 회사 본사(${viewersText(p.viewers)})만 봅니다. 발주처·다른 직원에게는 보내지 않습니다.`,
    p.retentionDays == null
      ? "보관 기간은 회사가 정합니다. 정해지면 다시 알려드립니다."
      : `${retentionText(p.retentionDays)}이 지나면 좌표를 자동으로 지웁니다. 출퇴근 시각과 현장 안/밖 판정은 근무 기록으로 남습니다.`,
    "‘내 정보’의 ‘내 위치 기록’에서 언제든 내 기록을 보고 동의를 그만둘 수 있습니다. 그만두면 남은 좌표를 바로 지웁니다.",
    "동의하지 않아도 출근은 됩니다. 이때는 본사에 ‘위치 없음’으로 표시됩니다.",
  ];
}

export interface MyGeoRow {
  key: string;
  at: string;
  kind: "출근" | "퇴근" | "보고" | "작업 인원";
  siteId: string;
  geo: GeoStamp;
}

/** 본인 위치 기록 (최근 것부터) — 직원 열람용 */
export function myLocationRows(db: DemoDB, userId: string): MyGeoRow[] {
  const rows: MyGeoRow[] = [];
  for (const r of db.attendance ?? []) {
    if (r.userId !== userId) continue;
    rows.push({ key: `${r.id}-in`, at: r.inAt, kind: "출근", siteId: r.siteId, geo: r.inGeo });
    if (r.outAt && r.outGeo) rows.push({ key: `${r.id}-out`, at: r.outAt, kind: "퇴근", siteId: r.siteId, geo: r.outGeo });
  }
  for (const r of db.reports) if (r.createdBy === userId && r.geo) rows.push({ key: r.id, at: r.createdAt, kind: "보고", siteId: r.siteId, geo: r.geo });
  for (const c of db.crewChecks ?? []) if (c.by === userId && c.geo) rows.push({ key: c.id, at: c.at, kind: "작업 인원", siteId: c.siteId, geo: c.geo });
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** 동의 상태: agreed = 지금 조건으로 동의 / outdated = 조건이 바뀌어 다시 동의 필요 / none = 동의 안 함(또는 철회) */
export function consentState(db: Pick<DemoDB, "consents" | "settings">, userId: string): { state: "agreed" | "outdated" | "none"; consent?: LocationConsent } {
  const consent = (db.consents ?? []).find((c) => c.userId === userId);
  if (!consent) return { state: "none" };
  return { state: hasConsent(db, userId) ? "agreed" : "outdated", consent };
}
