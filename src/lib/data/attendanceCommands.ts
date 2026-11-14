/**
 * 출퇴근 (GPS) 명령 — DEMO·LIVE 공용 순수 함수
 * 원칙
 * - 시각은 서버 시각(ctx.now)만 쓴다. 휴대폰 시계를 바꿔도 소용없다.
 * - 현장 안/밖은 서버가 거리로 다시 계산한다. 화면이 보낸 판정은 믿지 않는다.
 * - 출근·퇴근 버튼을 누를 때만 위치를 1번 기록한다. 계속 추적하지 않는다.
 * - 위치를 기록하려면 본인 동의가 먼저 있어야 한다. 위치 없이 출근하면 본사에 '위치 없음'으로 표시된다.
 * - 본사도 남의 출근을 대신 만들 수 없다. 시각 정정만 가능하며, 사유가 이력으로 남는다.
 */
import type { AttendanceRecord, AttendanceRequest, DemoDB, GeoStamp, Kiosk, QrStamp } from "@/lib/domain/types";
import { verifyQrToken } from "@/lib/domain/qr";
import { hex, randomBytes, sha256, utf8 } from "@/lib/domain/hmac";
import { judgeGeo, geoText, validSample, type GeoSample } from "@/lib/domain/geo";
import { consentRecord, currentTerms, hasConsent, retentionText, sameTerms, stampTerms, viewersText, type ConsentTerms } from "@/lib/domain/privacy";
import { todayIso } from "@/lib/domain/format";
import { uid } from "@/lib/domain/ids";
import { overlapMessage, overlappingRecord } from "@/lib/domain/attendance";
import { CommandError, claimKey, clone, log, nowIso, requireSite, touch, userName, validPhoto, type Ctx } from "./commands";

/** 동의 문구 판·동의 확인은 개인위치정보 규칙(privacy.ts)에서 — 보관 기간·볼 수 있는 사람 조건 포함 (D-43) */
export { CONSENT_VERSION, hasConsent } from "@/lib/domain/privacy";

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
  /** 동의 화면에 보여준 조건 — 서버의 지금 규칙과 같아야 동의로 기록 (D-49) */
  consentTerms?: ConsentTerms;
  /** 현장 태블릿 QR에서 읽은 코드 (출근만) */
  qrToken?: string;
  /**
   * 통신이 안 돼 휴대폰에 저장했다가 보낼 때, 누른 시각 (휴대폰 시계 · D-55).
   * 기록은 서버가 받은 시각으로 하고, 이 시각은 근태 수정 요청(본사 승인)으로만 반영한다.
   */
  pressedAt?: string;
  idempotencyKey?: string;
}

/** 나중에 보낸 출퇴근으로 인정하는 범위 — 받은 시각보다 2분 넘게 이르고 12시간 안 */
export const SENT_LATER_MIN_MS = 2 * 60_000;
export const SENT_LATER_MAX_MS = 12 * 3_600_000;
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const kstHm = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(11, 16);

/**
 * 휴대폰에 저장했다가 보낸 출퇴근이 너무 늦게 도착했는지 (리뷰 반영 D-55)
 * — 12시간 넘게 지났거나, 출근인데 누른 날(한국 날짜)이 오늘이 아니면 받지 않는다.
 *   받은 시각으로 조용히 기록하면 0분 근무·다음 날 출근 막힘·근무시간 부풀림이 생긴다 → 직원이 수정 요청으로
 */
function rejectTooLate(pressedAt: unknown, receivedAt: string, mode: "in" | "out", workDate?: string) {
  if (typeof pressedAt !== "string") return;
  const t = Date.parse(pressedAt);
  if (!Number.isFinite(t)) return;
  const word = mode === "in" ? "출근" : "퇴근";
  const late = Date.parse(receivedAt) - t > SENT_LATER_MAX_MS || (mode === "in" && workDate && kstDate(new Date(t).toISOString()) !== workDate);
  if (late) throw new CommandError(`휴대폰에 저장한 ${word}(${kstDate(new Date(t).toISOString()).slice(5).replace("-", "/")} ${kstHm(new Date(t).toISOString())})이 너무 늦게 도착해 기록하지 않았어요. ‘출퇴근이 잘못 찍혔나요? 수정 요청하기’로 알려 주세요.`, "STATE");
}

/** 저장했다 보낸 출퇴근: 그 사이 위치 기록 조건이 바뀌어 동의가 맞지 않으면, 막지 않고 위치 없이 기록한다 (리뷰 반영) */
function consentOrSkip(db: DemoDB, input: CheckInput, ctx: Ctx): CheckInput {
  try {
    recordConsent(db, input, ctx);
    return input;
  } catch (e) {
    if (typeof input.pressedAt !== "string" || !(e instanceof CommandError)) throw e;
    return { ...input, sample: null, noLocation: "skipped", consent: undefined, consentTerms: undefined };
  }
}

/** 누른 시각이 믿을 만한 범위인가 (아니면 무시 — 기록은 서버 시각 그대로) */
export function sentLaterAt(pressedAt: unknown, receivedAt: string): string | null {
  if (typeof pressedAt !== "string" || pressedAt.length > 40) return null;
  const t = Date.parse(pressedAt);
  if (!Number.isFinite(t)) return null;
  const gap = Date.parse(receivedAt) - t;
  if (gap < SENT_LATER_MIN_MS || gap > SENT_LATER_MAX_MS) return null;
  return new Date(t).toISOString();
}

/**
 * 나중에 보낸 출근·퇴근 → 본사가 확인할 근태 수정 요청(‘시각이 잘못 찍혔어요’)을 자동으로 만든다.
 * - 같은 날 이미 자동 요청이 기다리는 중이면 거기에 출근/퇴근 시각을 더한다(출근·퇴근 둘 다 통신 불량인 날)
 * - 직원이 직접 낸 요청이 기다리는 중이면 만들지 않는다(기록의 표시로 본사가 본다)
 * - 누른 날(한국 날짜)이 근무일과 다르면(자정 넘김) 만들지 않는다 — 본사가 출퇴근 현황에서 정정
 */
function requestPressedTime(db: DemoDB, rec: AttendanceRecord, mode: "in" | "out", pressedAt: string, receivedAt: string, ctx: Ctx): string | undefined {
  if (kstDate(pressedAt) !== rec.workDate) return undefined;
  const hm = kstHm(pressedAt);
  db.attendanceRequests = [...(db.attendanceRequests ?? [])];
  const pending = db.attendanceRequests.findIndex((q) => q.userId === rec.userId && q.siteId === rec.siteId && q.workDate === rec.workDate && q.status === "pending");
  const what = mode === "in" ? "출근" : "퇴근";
  const line = `${what} ${hm}에 눌렀는데 통신이 안 돼 ${kstHm(receivedAt)}에 전송됨`;
  if (pending >= 0) {
    const q = db.attendanceRequests[pending];
    if (q.auto !== "offline") return undefined;
    db.attendanceRequests[pending] = { ...q, ...(mode === "in" ? { inTime: hm } : { outTime: hm }), reason: `${q.reason} · ${line}`.slice(0, 200) };
    return q.id;
  }
  const req: AttendanceRequest = {
    id: uid("afr"),
    siteId: rec.siteId,
    userId: rec.userId,
    workDate: rec.workDate,
    kind: "wrong_time",
    ...(mode === "in" ? { inTime: hm } : { outTime: hm }),
    reason: `통신 불량 — ${line} (누른 시각은 휴대폰 시계 기준)`,
    status: "pending",
    createdAt: receivedAt,
    attendanceId: rec.id,
    auto: "offline",
  };
  db.attendanceRequests.push(req);
  log(db, ctx, "attendance", `${userName(db, rec.userId)} 통신 불량 ${what} — 누른 시각 ${hm} 확인 요청 자동 등록`, rec.siteId, "/orders");
  return req.id;
}

const cleanDevice = (d: unknown) => (typeof d === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(d) ? d : undefined);
const REASONS: GeoStamp["reason"][] = ["denied", "unavailable", "timeout", "unsupported", "skipped"];

/** 동의가 없으면 좌표를 남기지 않는다 */
function stamp(db: DemoDB, siteId: string, userId: string, input: Pick<CheckInput, "sample" | "noLocation">): GeoStamp {
  const site = db.sites.find((s) => s.id === siteId);
  const reason = REASONS.includes(input.noLocation) ? input.noLocation : undefined;
  if (!validSample(input.sample)) return judgeGeo(site, null, reason ?? "unavailable");
  if (!hasConsent(db, userId)) return judgeGeo(site, null, "skipped");
  return stampTerms(db, judgeGeo(site, input.sample));
}

function recordConsent(db: DemoDB, input: { consent?: boolean; consentTerms?: unknown; sample?: unknown }, ctx: Ctx) {
  // 위치가 막혀 좌표가 없어도 ‘동의’를 눌렀으면 동의는 기록한다 — 매번 다시 묻던 문제 (D-66 점검 반영)
  if (hasConsent(db, ctx.userId)) return;
  if (!validSample(input.sample) && !input.consent) return;
  if (!input.consent) throw new CommandError("위치를 기록하려면 먼저 동의가 필요합니다.", "VALIDATION", { consent: "동의 필요" });
  // 직원이 본 조건과 지금 규칙이 다르면(그 사이 대표가 바꿈) 동의로 기록하지 않고 다시 보여준다
  if (!sameTerms(input.consentTerms, currentTerms(db))) throw new CommandError("회사의 위치 기록 조건이 방금 바뀌었어요. 바뀐 내용을 읽고 다시 눌러 주세요.", "STATE", { consent: "조건 변경" });
  const rec = consentRecord(db, ctx.userId, nowIso(ctx));
  db.consents = [...(db.consents ?? []).filter((c) => c.userId !== ctx.userId), rec];
  log(db, ctx, "privacy", `${userName(db, ctx.userId)} 출퇴근 위치 기록 동의 (문구 ${rec.version}판 · 보관 ${retentionText(rec.retentionDays)} · 열람 ${viewersText(rec.viewers ?? "hq")})`);
}

export function checkIn(db0: DemoDB, input: CheckInput, ctx: Ctx): { db: DemoDB; result: { attendanceId: string; geo: GeoStamp; at: string; qr?: QrStamp; sentLater?: boolean } } {
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
  rejectTooLate(input.pressedAt, at, "in", workDate);
  const geo = stamp(db, site.id, ctx.userId, consentOrSkip(db, input, ctx));
  // QR은 서버(이 함수)가 단말기 비밀값으로 다시 확인한다
  let qr: QrStamp | undefined;
  if (typeof input.qrToken === "string" && input.qrToken) {
    qr = verifyQrToken(db, input.qrToken.slice(0, 300), site.id, new Date(at).getTime());
    if (qr.status === "ok") db.kiosks = (db.kiosks ?? []).map((k) => (k.id === qr!.kioskId ? { ...k, lastUsedAt: at } : k));
  }
  const pressed = sentLaterAt(input.pressedAt, at);
  const rec: AttendanceRecord = {
    id: uid("att"),
    siteId: site.id,
    userId: ctx.userId,
    workDate,
    inAt: at,
    inGeo: geo,
    ...(qr ? { inQr: qr } : {}),
    ...(cleanDevice(input.deviceId) ? { inDevice: cleanDevice(input.deviceId) } : {}),
    ...(pressed ? { inSentLater: { pressedAt: pressed } } : {}),
  };
  db.attendance.push(rec);
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 출근 — ${site.shortName} · ${geoText(geo, false)}${qr ? ` · ${qr.status === "ok" ? "QR 확인" : "QR 확인 실패"}` : ""}${pressed ? ` · 통신 불량으로 나중에 전송(누른 시각 ${kstHm(pressed)})` : ""}`, site.id, "/attendance");
  if (pressed) {
    const requestId = requestPressedTime(db, rec, "in", pressed, at, ctx);
    if (requestId) db.attendance[db.attendance.length - 1] = { ...rec, inSentLater: { pressedAt: pressed, requestId } };
  }
  touch(db, ctx);
  return { db, result: { attendanceId: rec.id, geo, at, qr, ...(pressed ? { sentLater: true } : {}) } };
}

export function checkOut(db0: DemoDB, input: CheckInput, ctx: Ctx): { db: DemoDB; result: { attendanceId: string; geo: GeoStamp; at: string; minutes: number; sentLater?: boolean } } {
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
  rejectTooLate(input.pressedAt, at, "out");
  // 출근보다 앞선 ‘누른 시각’(휴대폰 시계가 틀림)은 조용히 받지 않고 알린다
  const pressed = sentLaterAt(input.pressedAt, at);
  if (pressed && pressed <= (open.inSentLater?.pressedAt ?? open.inAt))
    throw new CommandError("휴대폰에 저장한 퇴근 시각이 출근보다 앞서 기록하지 않았어요. 휴대폰 시계를 확인하고 ‘출퇴근이 잘못 찍혔나요? 수정 요청하기’로 알려 주세요.", "STATE");
  const geo = stamp(db, site.id, ctx.userId, consentOrSkip(db, input, ctx));
  const idx = db.attendance.findIndex((r) => r.id === open.id);
  let rec: AttendanceRecord = { ...open, outAt: at, outGeo: geo, ...(cleanDevice(input.deviceId) ? { outDevice: cleanDevice(input.deviceId) } : {}), ...(pressed ? { outSentLater: { pressedAt: pressed } } : {}) };
  db.attendance[idx] = rec;
  const minutes = Math.round((new Date(at).getTime() - new Date(open.inAt).getTime()) / 60_000);
  log(db, ctx, "attendance", `${userName(db, ctx.userId)} 퇴근 — ${site.shortName} · ${geoText(geo, false)} · ${Math.floor(minutes / 60)}시간 ${minutes % 60}분${pressed ? ` · 통신 불량으로 나중에 전송(누른 시각 ${kstHm(pressed)})` : ""}`, site.id, "/attendance");
  if (pressed) {
    const requestId = requestPressedTime(db, rec, "out", pressed, at, ctx);
    if (requestId) db.attendance[idx] = rec = { ...rec, outSentLater: { pressedAt: pressed, requestId } };
  }
  touch(db, ctx);
  return { db, result: { attendanceId: rec.id, geo, at, minutes, ...(pressed ? { sentLater: true } : {}) } };
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
  // 출근 시각은 그 근무일 안 (한국 날짜) — 다른 날짜로 옮기면 그날 다른 기록과 근무시간이 두 번 셈해졌다 (D-79 버그 배시 m-1)
  else if (input.inAt && todayIso(new Date(input.inAt)) !== r.workDate) errors.time = `출근 시각은 그 근무일(${r.workDate}) 안이어야 합니다.`;
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  // 같은 날 다른 현장 기록과 시간이 겹치게 고치지 않는다 (D-79 — 겹치면 근무시간이 두 번 셈)
  const clash = overlappingRecord(db, { id: r.id, userId: r.userId, workDate: r.workDate, inAt: new Date(inAt).toISOString(), ...(outAt ? { outAt: new Date(outAt).toISOString() } : {}) });
  if (clash) throw new CommandError(overlapMessage(db, clash), "VALIDATION", { time: "다른 기록과 겹침" });
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
  if (input.photoDataUrl !== undefined && !validPhoto(input.photoDataUrl)) errors.photo = "사진 형식을 확인해 주세요.";
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
  const geo = input.geo ? (validSample(input.geo.sample) && consented ? stampTerms(db, judgeGeo(site, input.geo.sample)) : judgeGeo(site, null, consented ? (input.geo.noLocation ?? "unavailable") : "skipped")) : undefined;
  const idx = db.crewChecks.findIndex((c) => c.siteId === site.id && c.workDate === workDate && c.team.toLowerCase() === team.toLowerCase());
  let id: string;
  if (idx >= 0) {
    // 위치는 보낸 사람 것 — 다른 사람(또는 위치 없이) 다시 보내면 이전 사람의 좌표를 넘겨받지 않는다 (리뷰 반영 D-49)
    const { geo: _prevGeo, ...prev } = db.crewChecks[idx];
    void _prevGeo;
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
