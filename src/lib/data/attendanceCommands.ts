/**
 * 출퇴근 (GPS) 명령 — DEMO·LIVE 공용 순수 함수
 * 원칙
 * - 시각은 서버 시각(ctx.now)만 쓴다. 휴대폰 시계를 바꿔도 소용없다.
 * - 현장 안/밖은 서버가 거리로 다시 계산한다. 화면이 보낸 판정은 믿지 않는다.
 * - 출근·퇴근 버튼을 누를 때만 위치를 1번 기록한다. 계속 추적하지 않는다.
 * - 위치를 기록하려면 본인 동의가 먼저 있어야 한다. 위치 없이 출근하면 본사에 '위치 없음'으로 표시된다.
 * - 본사도 남의 출근을 대신 만들 수 없다. 시각 정정만 가능하며, 사유가 이력으로 남는다.
 */
import type { AttendanceRecord, DemoDB, GeoStamp, Kiosk, QrStamp } from "@/lib/domain/types";
import { verifyQrToken } from "@/lib/domain/qr";
import { hex, randomBytes, sha256, utf8 } from "@/lib/domain/hmac";
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
  /** 현장 태블릿 QR에서 읽은 코드 (출근만) */
  qrToken?: string;
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

export function checkIn(db0: DemoDB, input: CheckInput, ctx: Ctx): { db: DemoDB; result: { attendanceId: string; geo: GeoStamp; at: string; qr?: QrStamp } } {
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
  // QR은 서버(이 함수)가 단말기 비밀값으로 다시 확인한다
  let qr: QrStamp | undefined;
  if (typeof input.qrToken === "string" && input.qrToken) {
    qr = verifyQrToken(db, input.qrToken.slice(0, 300), site.id, new Date(at).getTime());
    if (qr.status === "ok") db.kiosks = (db.kiosks ?? []).map((k) => (k.id === qr!.kioskId ? { ...k, lastUsedAt: at } : k));
  }
  const rec: AttendanceRecord = {
    id: uid("att"),
    siteId: site.id,
    userId: ctx.userId,
    workDate,
    inAt: at,
    inGeo: geo,
    ...(qr ? { inQr: qr } : {}),
    ...(cleanDevice(input.deviceId) ? { inDevice: cleanDevice(input.deviceId) } : {}),
  };
  db.attendance.push(rec);
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 출근 — ${site.shortName} · ${geoText(geo)}${qr ? ` · ${qr.status === "ok" ? "QR 확인" : "QR 확인 실패"}` : ""}`, site.id, "/attendance");
  touch(db, ctx);
  return { db, result: { attendanceId: rec.id, geo, at, qr } };
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

/** 출근 뒤에 현장 QR로 확인 (태블릿이 늦게 켜졌거나 처음에 QR 없이 출근한 경우) — 확인될 때만 저장 */
export function confirmQr(db0: DemoDB, input: { siteId: string; qrToken: string }, ctx: Ctx) {
  const db = clone(db0);
  db.attendance = [...(db.attendance ?? [])];
  const at = nowIso(ctx);
  const workDate = todayIso(new Date(at));
  const idx = db.attendance.findIndex((r) => r.userId === ctx.userId && r.siteId === input.siteId && r.workDate === workDate);
  if (idx < 0) throw new CommandError("오늘 이 현장의 출근 기록이 없습니다.", "STATE");
  if (db.attendance[idx].inQr?.status === "ok") return { db: db0, result: { qr: db.attendance[idx].inQr! } };
  const qr = verifyQrToken(db, String(input.qrToken ?? "").slice(0, 300), input.siteId, new Date(at).getTime());
  if (qr.status !== "ok") {
    const why = qr.status === "expired" ? "QR이 만료되었습니다. 태블릿 화면을 다시 찍어 주세요." : qr.status === "wrong_site" ? "다른 현장의 QR입니다." : qr.status === "revoked" ? "해제된 단말기의 QR입니다." : "QR을 확인할 수 없습니다. 다시 찍어 주세요.";
    throw new CommandError(why, "VALIDATION", { qr: qr.status });
  }
  db.attendance[idx] = { ...db.attendance[idx], inQr: qr };
  db.kiosks = (db.kiosks ?? []).map((k) => (k.id === qr.kioskId ? { ...k, lastUsedAt: at } : k));
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 현장 QR 확인 (출근 뒤)`, input.siteId, "/attendance");
  touch(db, ctx);
  return { db, result: { qr } };
}

// ───────────────────────── 현장 QR 단말기 ─────────────────────────

const PAIR_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 헷갈리는 0·O·1·I·L 제외
const PAIR_MINUTES = 30;

export const pairHash = (code: string) => hex(sha256(utf8(code.trim().toUpperCase().replace(/[^0-9A-Z]/g, ""))));

/** 본사 — 현장 태블릿 등록. 연결 코드(8자리)는 이번 한 번만 보여준다 */
export function createKiosk(db0: DemoDB, input: { siteId: string; name?: string }, ctx: Ctx) {
  const db = clone(db0);
  const site = requireSite(db, input.siteId);
  const bytes = randomBytes(8);
  const code = Array.from(bytes, (b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join("");
  const at = nowIso(ctx);
  const kiosk: Kiosk = {
    id: uid("kio"),
    siteId: site.id,
    name: (input.name ?? "").trim().slice(0, 30) || `${site.shortName} 현장 태블릿`,
    secret: hex(randomBytes(32)),
    createdAt: at,
    createdBy: ctx.userId,
    pairHash: pairHash(code),
    pairExpiresAt: new Date(new Date(at).getTime() + PAIR_MINUTES * 60_000).toISOString(),
  };
  db.kiosks = [...(db.kiosks ?? []), kiosk];
  log(db, ctx, "attendance", `${site.shortName} QR 단말기 등록 — ${kiosk.name}`, site.id, "/attendance");
  touch(db, ctx);
  return { db, result: { kioskId: kiosk.id, pairCode: code, pairExpiresAt: kiosk.pairExpiresAt! } };
}

/** 본사 — 단말기 해제 (분실·교체). 해제된 단말기의 QR은 더 이상 인정되지 않는다 */
export function revokeKiosk(db0: DemoDB, input: { kioskId: string }, ctx: Ctx) {
  const db = clone(db0);
  const k = (db.kiosks ?? []).find((x) => x.id === input.kioskId);
  if (!k) throw new CommandError("단말기를 찾을 수 없습니다.", "NOT_FOUND");
  if (k.revokedAt) throw new CommandError("이미 해제된 단말기입니다.", "STATE");
  db.kiosks = (db.kiosks ?? []).map((x) => (x.id === k.id ? { ...x, revokedAt: nowIso(ctx), revokedBy: ctx.userId, pairHash: undefined, pairExpiresAt: undefined } : x));
  log(db, ctx, "attendance", `QR 단말기 해제 — ${k.name}`, k.siteId, "/attendance");
  touch(db, ctx);
  return { db, result: { kioskId: k.id } };
}

/** 태블릿 — 연결 코드로 한 번 연결. 비밀값은 이때 태블릿에만 전달되고 코드는 지운다 */
export function pairKiosk(db0: DemoDB, input: { code: string }, ctx: Ctx) {
  const h = pairHash(input.code ?? "");
  const at = nowIso(ctx);
  const k = (db0.kiosks ?? []).find((x) => x.pairHash && x.pairHash === h);
  if (!k || k.revokedAt || !k.pairExpiresAt || k.pairExpiresAt < at || !k.secret) throw new CommandError("연결 코드가 맞지 않거나 만료되었습니다. 본사에서 새 코드를 받아 주세요.", "NOT_FOUND");
  const db = clone(db0);
  db.kiosks = (db.kiosks ?? []).map((x) => (x.id === k.id ? { ...x, pairHash: undefined, pairExpiresAt: undefined, pairedAt: at } : x));
  const site = db.sites.find((s) => s.id === k.siteId);
  log(db, ctx, "attendance", `QR 단말기 연결 완료 — ${k.name}`, k.siteId, "/attendance");
  touch(db, ctx);
  return { db, result: { kioskId: k.id, siteId: k.siteId, siteName: site?.shortName ?? "", kioskName: k.name, companyName: db.company.name, secret: k.secret } };
}

// ───────────────────────── 작업 인원 확인 (출력) ─────────────────────────

export interface CrewInput {
  siteId: string;
  team: string;
  kind?: "direct" | "subcontract";
  headcount: number;
  /** 단체 사진 (휴대폰에서 줄인 JPEG) */
  photoDataUrl?: string;
  geo?: { sample?: GeoSample | null; noLocation?: GeoStamp["reason"] };
  idempotencyKey?: string;
}

export const normTeam = (t: string) => t.trim().replace(/\s+/g, " ").slice(0, 30);

export function reportCrew(db0: DemoDB, input: CrewInput, ctx: Ctx) {
  const site = requireSite(db0, input.siteId);
  const errors: Record<string, string> = {};
  const team = normTeam(input.team ?? "");
  if (!team) errors.team = "팀 이름을 넣어 주세요.";
  if (!Number.isInteger(input.headcount) || input.headcount < 1 || input.headcount > 300) errors.headcount = "인원은 1~300명";
  if (input.photoDataUrl !== undefined && (typeof input.photoDataUrl !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(input.photoDataUrl))) errors.photo = "사진 형식을 확인해 주세요.";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = clone(db0);
  claimKey(db, input.idempotencyKey);
  db.crewChecks = [...(db.crewChecks ?? [])];
  const at = nowIso(ctx);
  const workDate = todayIso(new Date(at));
  let photoId: string | undefined;
  let photoHash: string | undefined;
  if (input.photoDataUrl) {
    photoHash = hex(sha256(utf8(input.photoDataUrl)));
    photoId = uid("ph");
    db.photos.push({ id: photoId, siteId: site.id, dataUrl: input.photoDataUrl, caption: `작업 인원 · ${team}`, createdAt: at, createdBy: ctx.userId });
  }
  const consented = hasConsent(db, ctx.userId);
  const geo = input.geo ? (validSample(input.geo.sample) && consented ? judgeGeo(site, input.geo.sample) : judgeGeo(site, null, consented ? (input.geo.noLocation ?? "unavailable") : "skipped")) : undefined;
  const idx = db.crewChecks.findIndex((c) => c.siteId === site.id && c.workDate === workDate && c.team.toLowerCase() === team.toLowerCase());
  let id: string;
  if (idx >= 0) {
    const prev = db.crewChecks[idx];
    id = prev.id;
    if (photoId) db.photos = db.photos.map((p) => (p.id === photoId ? { ...p, crewId: id } : p));
    db.crewChecks[idx] = {
      ...prev,
      headcount: input.headcount,
      kind: input.kind ?? prev.kind,
      at,
      by: ctx.userId,
      ...(photoId ? { photoId, photoHash } : {}),
      ...(geo ? { geo } : {}),
      history: [...(prev.history ?? []), { at: prev.at, by: prev.by, headcount: prev.headcount }],
    };
  } else {
    id = uid("crew");
    if (photoId) db.photos = db.photos.map((p) => (p.id === photoId ? { ...p, crewId: id } : p));
    db.crewChecks.push({ id, siteId: site.id, workDate, team, kind: input.kind === "direct" ? "direct" : "subcontract", headcount: input.headcount, ...(photoId ? { photoId, photoHash } : {}), ...(geo ? { geo } : {}), at, by: ctx.userId });
  }
  log(db, ctx, "crew", `${site.shortName} 작업 인원 — ${team} ${input.headcount}명${photoId ? " · 단체 사진" : " · 사진 없음"}${idx >= 0 ? " (수정)" : ""}`, site.id, "/attendance");
  touch(db, ctx);
  return { db, result: { crewId: id, updated: idx >= 0, geo } };
}
