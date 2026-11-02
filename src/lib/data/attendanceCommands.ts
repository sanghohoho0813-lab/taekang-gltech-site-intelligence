/**
 * 출퇴근 (GPS) 명령 — DEMO·LIVE 공용 순수 함수
 * 원칙
 * - 시각은 서버 시각(ctx.now)만 쓴다. 휴대폰 시계를 바꿔도 소용없다.
 * - 현장 안/밖은 서버가 거리로 다시 계산한다. 화면이 보낸 판정은 믿지 않는다.
 * - 출근·퇴근 버튼을 누를 때만 위치를 1번 기록한다. 계속 추적하지 않는다.
 * - 위치를 기록하려면 본인 동의가 먼저 있어야 한다. 위치 없이 출근하면 본사에 '위치 없음'으로 표시된다.
 * - 본사도 남의 출근을 대신 만들 수 없다. 시각 정정만 가능하며, 사유가 이력으로 남는다.
 */
import type { AttendanceRecord, DemoDB, GeoStamp } from "@/lib/domain/types";
import { judgeGeo, geoText, validSample, type GeoSample } from "@/lib/domain/geo";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { CommandError, claimKey, clone, log, nowIso, requireSite, touch, userName, type Ctx } from "./commands";

/** 동의 문구 판 (문구를 바꾸면 올려서 다시 동의받는다) */
export const CONSENT_VERSION = 1;

export interface CheckInput {
  siteId: string;
  /** 휴대폰이 잡은 위치 (없으면 null) */
  sample?: GeoSample | null;
  /** 위치가 없는 이유 */
  noLocation?: GeoStamp["reason"];
  /** 기기 무작위 번호 (같은 휴대폰으로 여러 명 출근 확인용) */
  deviceId?: string;
  /** 처음 위치를 기록할 때 동의 */
  consent?: boolean;
  idempotencyKey?: string;
}

const cleanDevice = (d: unknown) => (typeof d === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(d) ? d : undefined);
const REASONS: GeoStamp["reason"][] = ["denied", "unavailable", "timeout", "unsupported", "skipped"];

export function hasConsent(db: DemoDB, userId: string): boolean {
  return (db.consents ?? []).some((c) => c.userId === userId && c.version >= CONSENT_VERSION);
}

/** 동의가 없으면 좌표를 남기지 않는다 */
function stamp(db: DemoDB, siteId: string, userId: string, input: Pick<CheckInput, "sample" | "noLocation">): GeoStamp {
  const site = db.sites.find((s) => s.id === siteId);
  const reason = REASONS.includes(input.noLocation) ? input.noLocation : undefined;
  if (!validSample(input.sample)) return judgeGeo(site, null, reason ?? "unavailable");
  if (!hasConsent(db, userId)) return judgeGeo(site, null, "skipped");
  return judgeGeo(site, input.sample);
}

function recordConsent(db: DemoDB, input: { consent?: boolean; sample?: unknown }, ctx: Ctx) {
  if (!validSample(input.sample) || hasConsent(db, ctx.userId)) return;
  if (!input.consent) throw new CommandError("위치를 기록하려면 먼저 동의가 필요합니다.", "VALIDATION", { consent: "동의 필요" });
  db.consents = [...(db.consents ?? []).filter((c) => c.userId !== ctx.userId), { userId: ctx.userId, at: nowIso(ctx), version: CONSENT_VERSION }];
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 출퇴근 위치 기록 동의`);
}

export function checkIn(db0: DemoDB, input: CheckInput, ctx: Ctx): { db: DemoDB; result: { attendanceId: string; geo: GeoStamp; at: string } } {
  const site = requireSite(db0, input.siteId);
  if (site.status === "completed") throw new CommandError("준공된 현장에는 출근할 수 없습니다.", "STATE");
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  db.attendance = [...(db.attendance ?? [])];
  const at = nowIso(ctx);
  const workDate = todayIso(new Date(at));
  const mine = db.attendance.filter((r) => r.userId === ctx.userId && r.workDate === workDate);
  const same = mine.find((r) => r.siteId === site.id);
  if (same) throw new CommandError(same.outAt ? "오늘 이 현장은 퇴근까지 기록되어 있습니다." : "이미 출근했습니다.", "STATE");
  const open = mine.find((r) => !r.outAt);
  if (open) throw new CommandError(`${db.sites.find((s) => s.id === open.siteId)?.shortName ?? "다른 현장"}에 출근 중입니다. 먼저 그곳에서 퇴근해 주세요.`, "STATE");
  recordConsent(db, input, ctx);
  const geo = stamp(db, site.id, ctx.userId, input);
  const rec: AttendanceRecord = { id: uid("att"), siteId: site.id, userId: ctx.userId, workDate, inAt: at, inGeo: geo, ...(cleanDevice(input.deviceId) ? { inDevice: cleanDevice(input.deviceId) } : {}) };
  db.attendance.push(rec);
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 출근 — ${site.shortName} · ${geoText(geo)}`, site.id, "/attendance");
  touch(db, ctx);
  return { db, result: { attendanceId: rec.id, geo, at } };
}

export function checkOut(db0: DemoDB, input: CheckInput, ctx: Ctx): { db: DemoDB; result: { attendanceId: string; geo: GeoStamp; at: string; minutes: number } } {
  const site = requireSite(db0, input.siteId);
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  db.attendance = [...(db.attendance ?? [])];
  const at = nowIso(ctx);
  // 자정을 넘긴 야간 작업도 퇴근할 수 있도록 최근 36시간 안의 열린 출근을 찾는다
  const since = new Date(new Date(at).getTime() - 36 * 3_600_000).toISOString();
  const open = db.attendance
    .filter((r) => r.userId === ctx.userId && r.siteId === site.id && !r.outAt && r.inAt >= since)
    .sort((a, b) => b.inAt.localeCompare(a.inAt))[0];
  if (!open) throw new CommandError("오늘 이 현장의 출근 기록이 없습니다. 먼저 출근을 눌러 주세요.", "STATE");
  recordConsent(db, input, ctx);
  const geo = stamp(db, site.id, ctx.userId, input);
  const idx = db.attendance.findIndex((r) => r.id === open.id);
  const rec: AttendanceRecord = { ...open, outAt: at, outGeo: geo, ...(cleanDevice(input.deviceId) ? { outDevice: cleanDevice(input.deviceId) } : {}) };
  db.attendance[idx] = rec;
  const minutes = Math.round((new Date(at).getTime() - new Date(open.inAt).getTime()) / 60_000);
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 퇴근 — ${site.shortName} · ${geoText(geo)} · ${Math.floor(minutes / 60)}시간 ${minutes % 60}분`, site.id, "/attendance");
  touch(db, ctx);
  return { db, result: { attendanceId: rec.id, geo, at, minutes } };
}

export interface SiteGeoInput {
  siteId: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
  /** 위치 지우기 */
  clear?: boolean;
}

export function setSiteGeo(db0: DemoDB, input: SiteGeoInput, ctx: Ctx) {
  const db = clone(db0);
  const site = requireSite(db, input.siteId);
  if (input.clear) {
    delete site.geo;
    log(db, ctx, "site", `${site.shortName} 현장 위치 삭제`, site.id, `/sites/${site.id}`);
    touch(db, ctx);
    return { db, result: { geo: undefined } };
  }
  const errors: Record<string, string> = {};
  if (typeof input.lat !== "number" || !(Math.abs(input.lat) <= 90) || input.lat === 0) errors.lat = "위도를 확인해주세요 (예: 37.5665)";
  if (typeof input.lng !== "number" || !(Math.abs(input.lng) <= 180) || input.lng === 0) errors.lng = "경도를 확인해주세요 (예: 126.9780)";
  const radius = Math.round(input.radiusM ?? 300);
  if (!(radius >= 50 && radius <= 3000)) errors.radiusM = "반경은 50~3,000m";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  site.geo = { lat: Math.round(input.lat! * 1e6) / 1e6, lng: Math.round(input.lng! * 1e6) / 1e6, radiusM: radius, setAt: nowIso(ctx), setBy: ctx.userId };
  log(db, ctx, "site", `${site.shortName} 현장 위치 등록 (반경 ${radius}m)`, site.id, `/sites/${site.id}`);
  touch(db, ctx);
  return { db, result: { geo: site.geo } };
}

export interface CorrectAttendanceInput {
  attendanceId: string;
  /** 바꿀 퇴근 시각 (ISO) — 퇴근을 못 누른 경우 */
  outAt?: string;
  /** 바꿀 출근 시각 (ISO) */
  inAt?: string;
  note: string;
}

/** 본사 정정 — 시각만 고칠 수 있고 위치 기록은 그대로 남는다 (사유 필수) */
export function correctAttendance(db0: DemoDB, input: CorrectAttendanceInput, ctx: Ctx) {
  const db = clone(db0);
  db.attendance = [...(db.attendance ?? [])];
  const idx = db.attendance.findIndex((r) => r.id === input.attendanceId);
  if (idx < 0) throw new CommandError("출퇴근 기록을 찾을 수 없습니다.", "NOT_FOUND");
  const note = (input.note ?? "").trim();
  const errors: Record<string, string> = {};
  if (note.length < 2) errors.note = "정정 사유를 적어주세요 (예: 퇴근 버튼 누락 — 반장 확인)";
  const r = db.attendance[idx];
  const inAt = input.inAt ?? r.inAt;
  const outAt = input.outAt ?? r.outAt;
  const iso = (v?: string) => !v || !Number.isNaN(new Date(v).getTime());
  if (!iso(input.inAt) || !iso(input.outAt)) errors.time = "시각 형식을 확인해주세요.";
  else if (outAt && outAt <= inAt) errors.time = "퇴근 시각이 출근 시각보다 늦어야 합니다.";
  else if (outAt && new Date(outAt).getTime() - new Date(inAt).getTime() > 24 * 3_600_000) errors.time = "근무 시간이 24시간을 넘습니다.";
  else if (outAt && outAt > nowIso(ctx)) errors.time = "미래 시각으로 정정할 수 없습니다.";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  db.attendance[idx] = {
    ...r,
    inAt: new Date(inAt).toISOString(),
    ...(outAt ? { outAt: new Date(outAt).toISOString() } : {}),
    corrections: [...(r.corrections ?? []), { at: nowIso(ctx), by: ctx.userId, note, before: { inAt: r.inAt, ...(r.outAt ? { outAt: r.outAt } : {}) } }],
  };
  log(db, ctx, "attendance", `출퇴근 정정 — ${userName(db, r.userId)} ${r.workDate} · ${note}`, r.siteId, "/attendance");
  touch(db, ctx);
  return { db, result: { attendanceId: r.id } };
}
