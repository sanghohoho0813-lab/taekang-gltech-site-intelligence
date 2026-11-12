/**
 * 하자 접수 링크 (D-74)
 * - 본사 명령 (registry): createIntake · closeIntake · reopenIntakeLink · renewIntakeStatus · discardIntakeRequests · registerPhoneDefect · reopenIntakeRequest
 * - 로그인 없는 사람이 쓰는 것 (registry에 넣지 않는다 — 서버 전용 경로 /api/intake 에서만): submitIntake · confirmIntake · reopenIntake · noteIntakeFull
 */
import type { DefectIntake, DemoDB, IntakeContact, PartnerRequest } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { CommandError, cleanText, clone, log, nowIso, requireSite, touch, type Ctx } from "./commands";
import { randomBytes } from "@/lib/domain/hmac";
import {
  INTAKE_CONTACT_KEEP_DAYS,
  INTAKE_DAILY_LIMIT,
  INTAKE_IDEM_RE,
  INTAKE_MAX_OPEN_PER_SITE,
  INTAKE_MAX_PHOTO_CHARS,
  INTAKE_MAX_PHOTOS,
  INTAKE_MAX_REOPEN,
  INTAKE_OPEN_KEEP_DAYS,
  INTAKE_SOURCE_DAILY_LIMIT,
  intakeCanConfirm,
  intakeCountToday,
  intakeFinishedAt,
  intakeRound,
  intakeSourceCountToday,
  intakeSourceKey,
  intakeState,
  intakeTitle,
  newToken,
  nextIntakeSeq,
  normalizePhone,
  photoLooksReal,
  statusTokenFor,
  tokenHash,
} from "@/lib/domain/intake";
import { uid } from "@/lib/domain/ids";

/** 한 줄 글 — 줄바꿈·겹친 빈칸을 하나로. DB가 받지 못하는 글자(NUL·짝 없는 서로게이트)는 뺀다 */
const text = (v: unknown) => (typeof v === "string" ? cleanText(v).replace(/\s+/g, " ").trim() : "");
const para = (v: unknown) => (typeof v === "string" ? cleanText(v).trim() : "");
/** 접수 사진: JPEG·PNG·WEBP, 약 700KB 이하, 앞 바이트가 정말 그 형식 */
const validIntakePhoto = (v: unknown) => typeof v === "string" && v.length <= INTAKE_MAX_PHOTO_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && photoLooksReal(v);

/** 하루 한도에 닿았을 때의 안내 — 서버가 이 문구로 ‘한도 도달’을 알아보고 본사에 한 번 알린다 */
export const INTAKE_FULL_MESSAGE = "오늘은 이 주소로 접수가 많아 더 받을 수 없습니다. 전화로 알려 주세요.";

const LABEL_DEFAULT = "하자 접수";
function checkLabel(db: DemoDB, siteId: string, label: string, exceptId?: string) {
  if (label.length > 20) throw new CommandError("이름은 20자 이내로 적어 주세요.", "VALIDATION", { label: "이름은 20자 이내로 적어 주세요." });
  const open = (db.intakes ?? []).filter((i) => i.siteId === siteId && intakeState(i) === "open" && i.id !== exceptId);
  if (open.length >= INTAKE_MAX_OPEN_PER_SITE) throw new CommandError(`이 현장에 열려 있는 접수 링크가 ${INTAKE_MAX_OPEN_PER_SITE}개입니다. 안 쓰는 링크를 닫고 다시 해 주세요.`, "STATE");
  // 띄어쓰기만 다른 이름도 같은 이름으로 본다 (‘관리사무소용’·‘관리사무소 용’)
  const key = (s: string) => s.replace(/\s+/g, "");
  if (open.some((i) => key(i.label) === key(label))) throw new CommandError(`‘${label}’ 접수 링크가 이미 열려 있습니다. 다른 이름을 적거나 그 링크를 쓰세요.`, "STATE");
}

/** 본사 — 접수 링크 만들기. 접수만 되는 주소라 다시 볼 수 있게 저장한다 */
export function createIntake(db0: DemoDB, input: { siteId: string; label?: string; place?: string }, ctx: Ctx) {
  const site0 = requireSite(db0, typeof input?.siteId === "string" ? input.siteId : "");
  const label = text(input.label) || LABEL_DEFAULT;
  const place = text(input.place);
  if (place.length > 40) throw new CommandError("건물 이름은 40자 이내로 적어 주세요.", "VALIDATION", { place: "건물 이름은 40자 이내로 적어 주세요." });
  checkLabel(db0, site0.id, label);
  const db = clone(db0);
  const at = nowIso(ctx);
  const token = newToken(randomBytes, 16);
  const intake: DefectIntake = { id: tokenHash(token), token, siteId: site0.id, label, ...(place ? { place } : {}), createdAt: at, createdBy: ctx.userId, count: 0 };
  db.intakes = [intake, ...(db.intakes ?? [])];
  log(db, ctx, "partner", `하자 접수 링크 만듦 — ${site0.shortName} · ${label}`, site0.id, `/sites/${site0.id}?tab=requests`);
  touch(db, ctx);
  return { db, result: { intakeId: intake.id, token } };
}

/** 본사 — 접수 링크 닫기. 그 주소·QR로는 더 접수되지 않는다 (이미 들어온 접수와 진행 확인 주소는 그대로) */
export function closeIntake(db0: DemoDB, input: { intakeId: string }, ctx: Ctx) {
  const i0 = (db0.intakes ?? []).find((x) => x.id === input?.intakeId);
  if (!i0) throw new CommandError("접수 링크를 찾을 수 없습니다.", "NOT_FOUND");
  if (i0.closedAt) throw new CommandError("이미 닫은 접수 링크입니다.", "STATE");
  const db = clone(db0);
  const at = nowIso(ctx);
  db.intakes = (db.intakes ?? []).map((x) => (x.id === i0.id ? { ...x, closedAt: at, closedBy: ctx.userId } : x));
  log(db, ctx, "partner", `하자 접수 링크 닫음 — ${db.sites.find((s) => s.id === i0.siteId)?.shortName ?? ""} · ${i0.label}`, i0.siteId, `/sites/${i0.siteId}?tab=requests`);
  touch(db, ctx);
  return { db, result: { intakeId: i0.id } };
}

/** 본사 — 닫은 접수 링크 다시 열기 (잘못 닫았을 때 · 붙여 둔 안내문의 QR이 다시 통한다) */
export function reopenIntakeLink(db0: DemoDB, input: { intakeId: string }, ctx: Ctx) {
  const i0 = (db0.intakes ?? []).find((x) => x.id === input?.intakeId);
  if (!i0) throw new CommandError("접수 링크를 찾을 수 없습니다.", "NOT_FOUND");
  if (!i0.closedAt) throw new CommandError("이미 열려 있는 접수 링크입니다.", "STATE");
  requireSite(db0, i0.siteId);
  checkLabel(db0, i0.siteId, i0.label, i0.id);
  const db = clone(db0);
  db.intakes = (db.intakes ?? []).map((x) => {
    if (x.id !== i0.id) return x;
    const { closedAt: _a, closedBy: _b, ...rest } = x;
    void _a;
    void _b;
    return rest;
  });
  log(db, ctx, "partner", `하자 접수 링크 다시 엶 — ${db.sites.find((s) => s.id === i0.siteId)?.shortName ?? ""} · ${i0.label}`, i0.siteId, `/sites/${i0.siteId}?tab=requests`);
  touch(db, ctx);
  return { db, result: { intakeId: i0.id } };
}

/**
 * 본사 — 진행 확인 주소 바꾸기 (주소가 다른 사람에게 알려졌을 때). 앞의 주소는 더 열리지 않는다.
 * 평소에는 바꿀 필요가 없다: 본사는 지금 주소를 언제든 다시 보고 접수자에게 보낼 수 있다 (점검 10차).
 */
export function renewIntakeStatus(db0: DemoDB, input: { requestId: string }, ctx: Ctx) {
  const r0 = db0.partnerRequests.find((x) => x.id === input?.requestId);
  if (!r0 || !r0.intake) throw new CommandError("링크·전화로 접수된 요청을 찾을 수 없습니다.", "NOT_FOUND");
  const db = clone(db0);
  const statusToken = newToken(randomBytes, 24);
  const r = db.partnerRequests.find((x) => x.id === r0.id)!;
  r.statusKey = tokenHash(statusToken);
  r.statusToken = statusToken;
  log(db, ctx, "partner", `하자 접수 진행 확인 주소 바꿈 — 접수 번호 ${r0.intake.no}`, r0.siteId, "/defects");
  touch(db, ctx);
  return { db, result: { statusToken, no: r0.intake.no } };
}

export interface SubmitIntakeInput {
  intakeId: string;
  /** 같은 접수가 두 번 들어오지 않게 (화면이 만든 번호) */
  idempotencyKey: string;
  location: string;
  description: string;
  photoDataUrls?: string[];
  org?: string;
  name: string;
  phone: string;
  /** 연락처 제공 동의 */
  consent: boolean;
  /** 접수한 곳 (서버가 넣는다 — 인터넷 주소 묶음). 저장하지 않고 그날·그 링크용 해시로만 쓴다 */
  source?: string;
}

/** 접수 내용 검사 — DB를 읽기 전에 먼저 한다 (틀린 입력으로 회사 데이터를 통째로 읽지 않게 · 점검 10차) */
export function checkIntakeInput(input: Partial<SubmitIntakeInput> | null | undefined) {
  const errors: Record<string, string> = {};
  const location = text(input?.location);
  const description = para(input?.description);
  const org = text(input?.org);
  const name = text(input?.name);
  const phone = normalizePhone(input?.phone);
  const photos = Array.isArray(input?.photoDataUrls) ? input.photoDataUrls : [];
  if (!location) errors.location = "하자가 있는 곳을 적어 주세요. (예: 3층 302호 거실 창)";
  else if (location.length > 60) errors.location = "위치는 60자 이내로 적어 주세요.";
  if (!description) errors.description = "어떤 문제인지 적어 주세요.";
  else if (description.length > 800) errors.description = "내용은 800자 이내로 적어 주세요.";
  if (!name) errors.name = "연락받으실 분 이름을 적어 주세요.";
  else if (name.length > 30) errors.name = "이름은 30자 이내로 적어 주세요.";
  if (org.length > 40) errors.org = "소속은 40자 이내로 적어 주세요.";
  if (!phone) errors.phone = "연락받으실 전화번호를 확인해 주세요. (예: 010-1234-5678)";
  if (photos.length > INTAKE_MAX_PHOTOS) errors.photos = `사진은 ${INTAKE_MAX_PHOTOS}장까지 보낼 수 있습니다.`;
  else if (photos.some((p) => !validIntakePhoto(p))) errors.photos = "사진을 받을 수 없습니다. 사진을 빼고 다시 넣어 주세요 (JPEG·PNG·WEBP).";
  if (input?.consent !== true) errors.consent = "연락처 제공에 동의해 주셔야 접수할 수 있습니다.";
  return { errors, ok: Object.keys(errors).length === 0, value: { location, description, org, name, phone: phone ?? "", photos } };
}

/** 접수 한 건 만들기 (링크 접수·전화 접수·다시 접수가 같이 쓴다) */
function newRequest(db: DemoDB, a: { siteId: string; location: string; description: string; contact: IntakeContact; at: string; by: string; note: string; statusToken: string }): PartnerRequest {
  return {
    id: uid("pr"),
    siteId: a.siteId,
    partnerUserId: "",
    type: "defect",
    title: intakeTitle(a.description, a.location),
    description: a.description,
    location: a.location,
    status: "received",
    createdAt: a.at,
    updatedAt: a.at,
    intake: a.contact,
    statusKey: tokenHash(a.statusToken),
    statusToken: a.statusToken,
    history: [{ at: a.at, status: "received", by: a.by, note: a.note }],
  };
}
function takeNo(db: DemoDB, at: string): string {
  const { no, seq } = nextIntakeSeq(db.settings, at);
  db.settings = { ...(db.settings ?? DEFAULT_SETTINGS), intakeSeq: seq };
  return no;
}

/**
 * 로그인 없는 사람의 하자 접수 — 접수 링크가 열려 있을 때만. 하자보수 요청 한 건을 만들고 ‘진행 확인 주소’를 돌려준다.
 * ctx.userId는 "system" (계정이 없다).
 */
export function submitIntake(db0: DemoDB, input: SubmitIntakeInput, ctx: Ctx) {
  const intake = (db0.intakes ?? []).find((x) => x.id === input?.intakeId);
  if (!intake || intakeState(intake) !== "open") throw new CommandError("지금은 이 주소로 접수할 수 없습니다. 보내 주신 곳에 문의해 주세요.", "NOT_FOUND");
  const site = requireSite(db0, intake.siteId);
  const checked = checkIntakeInput(input);
  if (!checked.ok) throw new CommandError("입력한 내용을 확인해 주세요.", "VALIDATION", checked.errors);
  const { location, description, org, name, phone, photos } = checked.value;
  const at = nowIso(ctx);
  // 같은 접수를 다시 보냄 (통신이 끊겨 응답을 못 받고 다시 누름): 새로 만들지 않고 그 접수의 번호와 같은 진행 확인 주소를 돌려준다.
  // 진행 확인 주소는 접수 주소 + 화면 난수에서 만들므로 다시 보내도 같다 (난수가 없거나 형식이 다르면 매번 새 난수).
  const idem = typeof input.idempotencyKey === "string" && INTAKE_IDEM_RE.test(input.idempotencyKey) ? input.idempotencyKey : "";
  const statusToken = idem ? statusTokenFor(intake.token, idem) : newToken(randomBytes, 24);
  const intakeKey = idem ? tokenHash(`intake-idem:${intake.id}:${idem}`) : undefined;
  if (intakeKey) {
    const prev = db0.partnerRequests.find((r) => r.intakeKey === intakeKey);
    if (prev?.intake) {
      // 본사가 진행 확인 주소를 바꾼 뒤라면 그 주소를 다시 내주지 않는다
      if (prev.statusKey !== tokenHash(statusToken)) throw new CommandError("이미 접수되었습니다. 진행은 시공사에 문의해 주세요.", "DUPLICATE");
      return { db: db0, result: { requestId: prev.id, no: prev.intake.no, statusToken, again: true as boolean } };
    }
  }
  if (intakeCountToday(db0, intake.id, at) >= INTAKE_DAILY_LIMIT) throw new CommandError(INTAKE_FULL_MESSAGE, "STATE");
  const src = typeof input.source === "string" && input.source ? intakeSourceKey(intake.id, at, input.source.slice(0, 80)) : undefined;
  if (src && intakeSourceCountToday(db0, intake.id, at, src) >= INTAKE_SOURCE_DAILY_LIMIT) throw new CommandError("오늘 이곳에서 보낸 접수가 많습니다. 나머지는 전화로 알려 주세요.", "STATE");

  const db = clone(db0);
  const no = takeNo(db, at);
  const req = newRequest(db, { siteId: site.id, location, description, contact: { id: intake.id, no, ...(org ? { org } : {}), name, phone, consentAt: at }, at, by: ctx.userId, note: `접수 링크 (${intake.label})`, statusToken });
  if (intakeKey) req.intakeKey = intakeKey;
  if (src) req.intakeSrc = src;
  if (photos.length) {
    req.photoIds = photos.map((dataUrl) => {
      const id = uid("ph");
      db.photos.push({ id, siteId: site.id, partnerRequestId: req.id, dataUrl, caption: `하자 접수 · ${location}`.slice(0, 80), createdAt: at, createdBy: ctx.userId });
      return id;
    });
  }
  db.partnerRequests.unshift(req);
  db.intakes = (db.intakes ?? []).map((x) => (x.id === intake.id ? { ...x, count: x.count + 1, lastAt: at } : x));
  // 활동 이력에는 이름·연락처·접수자가 적은 글을 적지 않는다 (현장·접수 번호만)
  log(db, ctx, "partner", `하자 접수(링크): ${site.shortName} — 접수 번호 ${no}`, site.id, "/defects");
  touch(db, ctx);
  return { db, result: { requestId: req.id, no, statusToken, again: false as boolean } };
}

/** 하루 한도에 닿은 것을 본사에 한 번 알린다 (그날 처음일 때만 기록 — 바꿀 것이 없으면 같은 객체) */
export function noteIntakeFull(db0: DemoDB, input: { intakeId: string }, ctx: Ctx) {
  const i0 = (db0.intakes ?? []).find((x) => x.id === input?.intakeId);
  const at = nowIso(ctx);
  const day = new Date(new Date(at).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  if (!i0 || i0.fullOn === day || intakeCountToday(db0, i0.id, at) < INTAKE_DAILY_LIMIT) return { db: db0, result: { noted: false } };
  const db = clone(db0);
  db.intakes = (db.intakes ?? []).map((x) => (x.id === i0.id ? { ...x, fullOn: day } : x));
  log(db, ctx, "partner", `하자 접수 링크가 오늘 한도(${INTAKE_DAILY_LIMIT}건)에 닿음 — ${db.sites.find((s) => s.id === i0.siteId)?.shortName ?? ""} · ${i0.label}. 오늘은 더 접수되지 않습니다`, i0.siteId, `/sites/${i0.siteId}?tab=requests`);
  touch(db, ctx);
  return { db, result: { noted: true } };
}

/** 진행 확인 주소로 들어온 요청이 맞는지 — 잠금 안에서 한 번 더 본다 (그 사이 본사가 주소를 바꿨으면 거절) */
function byStatus(db: DemoDB, input: { requestId: string; statusKey?: string }): PartnerRequest {
  const r = db.partnerRequests.find((x) => x.id === input?.requestId);
  if (!r || !r.intake) throw new CommandError("접수를 찾을 수 없습니다.", "NOT_FOUND");
  if (input.statusKey !== undefined && r.statusKey !== input.statusKey) throw new CommandError("주소가 바뀌었습니다. 시공사에서 받은 새 주소로 열어 주세요.", "NOT_FOUND");
  return r;
}

/** 진행 확인 주소를 가진 사람의 ‘잘 고쳐졌습니다’ — 보수가 끝나고 회신을 받은 뒤에만 */
export function confirmIntake(db0: DemoDB, input: { requestId: string; statusKey?: string; note?: string }, ctx: Ctx) {
  const r0 = byStatus(db0, input);
  if (r0.confirmedAt) throw new CommandError("이미 확인하셨습니다.", "STATE");
  if (!intakeCanConfirm(r0, db0.workOrders ?? [])) throw new CommandError("보수가 끝난 뒤에 확인할 수 있습니다.", "STATE");
  const note = text(input.note);
  if (note.length > 200) throw new CommandError("남길 말은 200자 이내로 적어 주세요.", "VALIDATION", { note: "남길 말은 200자 이내로 적어 주세요." });
  const db = clone(db0);
  const r = db.partnerRequests.find((x) => x.id === r0.id)!;
  const at = nowIso(ctx);
  r.confirmedAt = at;
  if (note) r.confirmNote = note;
  r.updatedAt = at;
  r.history.push({ at, status: "answered", by: ctx.userId, note: note ? `발주처 확인 · ${note}` : "발주처 확인" });
  log(db, ctx, "partner", `하자 접수 확인(링크): ${db.sites.find((s) => s.id === r.siteId)?.shortName ?? ""} · 접수 번호 ${r0.intake!.no}`, r.siteId, "/defects");
  touch(db, ctx);
  return { db, result: { confirmedAt: at } };
}

/**
 * ‘아직 문제가 있습니다’ — 답변을 받았는데 고쳐지지 않았을 때. 발주처 계정의 ‘다시 요청’과 같은 방식으로 새 접수를 만들어 앞 접수에 잇는다.
 * 진행 확인 주소는 그대로 쓰고(새 접수를 보여 준다), 접수 번호는 앞 번호에 순번을 붙인다 (1112-1 → 1112-1-2).
 * byHq: 접수자가 전화로 알려 와 본사가 대신 누른 경우.
 */
export function reopenIntake(db0: DemoDB, input: { requestId: string; statusKey?: string; note: string }, ctx: Ctx, byHq = false) {
  const r0 = byStatus(db0, input);
  if (db0.partnerRequests.some((x) => x.reopenedFrom === r0.id)) throw new CommandError("이미 다시 접수되어 처리하고 있습니다.", "STATE");
  // 본사가 대신 누를 때는 접수자가 확인한 뒤라도 된다 (나중에 다시 샌다고 전화가 온 경우)
  const answered = r0.status === "answered" && (byHq ? intakeCanConfirm({ ...r0, confirmedAt: undefined }, db0.workOrders ?? []) : intakeCanConfirm(r0, db0.workOrders ?? []));
  if (!answered) throw new CommandError(r0.confirmedAt ? "이미 확인하신 접수입니다. 다시 문제가 생겼으면 새로 접수해 주세요." : "시공사 답변을 받은 뒤에 알릴 수 있습니다.", "STATE");
  const round = intakeRound(db0, r0);
  if (round >= INTAKE_MAX_REOPEN) throw new CommandError("여러 번 다시 접수된 건입니다. 시공사에 전화로 알려 주세요.", "STATE");
  const note = para(input.note);
  if (note.length < 2) throw new CommandError("어떤 문제가 남았는지 적어 주세요.", "VALIDATION", { note: "어떤 문제가 남았는지 적어 주세요." });
  if (note.length > 300) throw new CommandError("300자 이내로 적어 주세요.", "VALIDATION", { note: "300자 이내로 적어 주세요." });
  if (r0.intake!.purgedAt && !byHq) throw new CommandError("연락처 보관 기간이 지난 접수입니다. 접수 화면에서 새로 접수해 주세요.", "STATE");
  const db = clone(db0);
  const old = db.partnerRequests.find((x) => x.id === r0.id)!;
  const at = nowIso(ctx);
  let root = old;
  for (let i = 0; i < 10 && root.reopenedFrom; i++) root = db.partnerRequests.find((x) => x.id === root.reopenedFrom) ?? root;
  const no = `${root.intake?.no ?? old.intake!.no}-${round + 2}`;
  const statusToken = old.statusToken ?? newToken(randomBytes, 24);
  const req = newRequest(db, {
    siteId: old.siteId,
    location: old.location ?? "",
    description: note,
    contact: { ...old.intake!, no, consentAt: old.intake!.consentAt },
    at,
    by: ctx.userId,
    note: `다시 접수 (앞 접수 번호 ${old.intake!.no})${byHq ? " · 전화로 알려 와 본사가 등록" : ""}`,
    statusToken,
  });
  // 진행 확인 주소는 새 접수로 옮긴다 — 접수자는 같은 주소에서 새 진행을 본다
  if (!old.statusToken && old.statusKey) {
    req.statusKey = old.statusKey;
    delete req.statusToken;
  }
  delete old.statusKey;
  delete old.statusToken;
  req.reopenedFrom = old.id;
  if (old.confirmedAt) {
    delete old.confirmedAt;
    delete old.confirmNote;
  }
  old.updatedAt = at;
  old.history.push({ at, status: old.status, by: ctx.userId, note: `아직 문제가 있음 → 다시 접수 ${no}` });
  db.partnerRequests.unshift(req);
  log(db, ctx, "partner", `하자 다시 접수: ${db.sites.find((s) => s.id === old.siteId)?.shortName ?? ""} — 접수 번호 ${no}${byHq ? " (본사 등록)" : ""}`, old.siteId, "/defects");
  touch(db, ctx);
  return { db, result: { requestId: req.id, no } };
}

/** 본사 — 접수자가 전화로 ‘아직 문제가 있다’고 알려 왔을 때 대신 다시 접수한다 */
export function reopenIntakeRequest(db0: DemoDB, input: { requestId: string; note: string }, ctx: Ctx) {
  return reopenIntake(db0, { requestId: input?.requestId, note: input?.note }, ctx, true);
}

/**
 * 본사 — 전화로 받은 하자 등록. 링크 접수와 같은 목록에 들어가고, 진행 확인 주소를 문자로 보낼 수 있다.
 * 이름·전화번호는 전화로 동의를 받았을 때만 적는다 (consent). 적지 않아도 등록된다.
 */
export function registerPhoneDefect(db0: DemoDB, input: { siteId: string; location: string; description: string; name?: string; phone?: string; org?: string; consent?: boolean; idempotencyKey?: string }, ctx: Ctx) {
  const site = requireSite(db0, typeof input?.siteId === "string" ? input.siteId : "");
  const errors: Record<string, string> = {};
  const location = text(input.location);
  const description = para(input.description);
  const org = text(input.org);
  const name = text(input.name);
  const rawPhone = text(input.phone);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (!location) errors.location = "하자가 있는 곳을 적어 주세요.";
  else if (location.length > 60) errors.location = "위치는 60자 이내로 적어 주세요.";
  if (!description) errors.description = "어떤 문제인지 적어 주세요.";
  else if (description.length > 800) errors.description = "내용은 800자 이내로 적어 주세요.";
  if (name.length > 30) errors.name = "이름은 30자 이내로 적어 주세요.";
  if (org.length > 40) errors.org = "소속은 40자 이내로 적어 주세요.";
  if (rawPhone && !phone) errors.phone = "전화번호를 확인해 주세요. (예: 010-1234-5678)";
  if ((name || phone) && input.consent !== true) errors.consent = "이름·전화번호를 적으려면 전화로 동의를 받았는지 표시해 주세요.";
  if (Object.keys(errors).length) throw new CommandError("입력한 내용을 확인해 주세요.", "VALIDATION", errors);
  const idem = typeof input.idempotencyKey === "string" && input.idempotencyKey ? tokenHash(`phone-idem:${input.idempotencyKey.slice(0, 80)}`) : undefined;
  if (idem && db0.partnerRequests.some((r) => r.intakeKey === idem)) throw new CommandError("이미 저장된 요청입니다. (중복 저장 방지)", "DUPLICATE");
  const db = clone(db0);
  const at = nowIso(ctx);
  const no = takeNo(db, at);
  const req = newRequest(db, {
    siteId: site.id,
    location,
    description,
    contact: { id: "phone", no, ...(org ? { org } : {}), ...(name ? { name } : {}), ...(phone ? { phone } : {}), consentAt: at },
    at,
    by: ctx.userId,
    note: "전화 접수 (본사 등록)",
    statusToken: newToken(randomBytes, 24),
  });
  if (idem) req.intakeKey = idem;
  db.partnerRequests.unshift(req);
  log(db, ctx, "partner", `하자 접수(전화): ${site.shortName} — 접수 번호 ${no}`, site.id, "/defects");
  touch(db, ctx);
  return { db, result: { requestId: req.id, no } };
}

export const DISCARD_REASONS = { spam: "장난·광고", duplicate: "중복 접수", mistake: "잘못 접수" } as const;
export type DiscardReason = keyof typeof DISCARD_REASONS;

/**
 * 본사 — 링크·전화 접수 버리기 (장난·중복·잘못 접수). 접수와 사진을 지운다 — 하자 건수·보고서·관리대장에 남지 않는다.
 * 작업지시를 보냈거나 접수자가 확인한 건, 다시 접수가 이어진 건은 버릴 수 없다 (회신으로 끝낸다).
 */
export function discardIntakeRequests(db0: DemoDB, input: { requestIds: string[]; reason: DiscardReason }, ctx: Ctx) {
  const ids = Array.isArray(input?.requestIds) ? [...new Set(input.requestIds.map(String))] : [];
  if (!ids.length || ids.length > 100) throw new CommandError("버릴 접수를 골라 주세요 (한 번에 100건까지).", "VALIDATION");
  if (typeof input.reason !== "string" || !Object.prototype.hasOwnProperty.call(DISCARD_REASONS, input.reason)) throw new CommandError("버리는 이유를 골라 주세요.", "VALIDATION", { reason: "버리는 이유를 골라 주세요." });
  const targets = ids.map((id) => db0.partnerRequests.find((x) => x.id === id));
  for (const r of targets) {
    if (!r || !r.intake) throw new CommandError("링크·전화로 접수된 요청만 버릴 수 있습니다.", "NOT_FOUND");
    if (r.linkedWorkOrderId && (db0.workOrders ?? []).some((w) => w.id === r.linkedWorkOrderId)) throw new CommandError(`접수 번호 ${r.intake.no}: 작업지시를 보낸 접수는 버릴 수 없습니다. 회신으로 끝내 주세요.`, "STATE");
    if (r.confirmedAt) throw new CommandError(`접수 번호 ${r.intake.no}: 접수자가 확인한 접수는 버릴 수 없습니다.`, "STATE");
    if (db0.partnerRequests.some((x) => x.reopenedFrom === r.id && !ids.includes(x.id))) throw new CommandError(`접수 번호 ${r.intake.no}: 다시 접수된 건이 이어져 있어 버릴 수 없습니다.`, "STATE");
  }
  const db = clone(db0);
  const gone = new Set(ids);
  const nos: string[] = [];
  for (const r of targets as PartnerRequest[]) {
    nos.push(r.intake!.no);
    // 다시 접수한 건을 버리면 진행 확인 주소를 앞 접수로 돌려준다 (접수자의 주소가 죽지 않게)
    const parent = r.reopenedFrom && !gone.has(r.reopenedFrom) ? db.partnerRequests.find((x) => x.id === r.reopenedFrom) : undefined;
    if (parent && r.statusKey && r.statusToken) {
      parent.statusKey = r.statusKey;
      parent.statusToken = r.statusToken;
    }
    if (r.intake!.id !== "phone") db.intakes = (db.intakes ?? []).map((x) => (x.id === r.intake!.id ? { ...x, voided: (x.voided ?? 0) + 1 } : x));
  }
  db.partnerRequests = db.partnerRequests.filter((x) => !gone.has(x.id));
  // 접수자가 올린 사진도 함께 지운다 (서버는 사진 원본까지)
  db.photos = db.photos.filter((p) => !p.partnerRequestId || !gone.has(p.partnerRequestId));
  // 접수자가 적은 글은 활동 이력에 남기지 않는다 (번호·이유만)
  log(db, ctx, "partner", `하자 접수 ${nos.length}건 버림 (${DISCARD_REASONS[input.reason]}) — 접수 번호 ${nos.slice(0, 8).join(", ")}${nos.length > 8 ? ` 외 ${nos.length - 8}건` : ""}`, undefined, "/defects");
  touch(db, ctx);
  return { db, result: { discarded: nos.length } };
}

/**
 * 접수자 이름·연락처 보관 기한 — 바꿀 것이 없으면 같은 객체를 그대로 돌려준다.
 * - 처리가 끝난(접수자 확인·보수 완료·‘처리 끝’ 회신) 날부터 90일 뒤에 지운다. 일정만 안내한 회신은 끝이 아니다.
 * - 끝내지 않은 접수도 접수한 날부터 180일이 지나면 지운다 (잊힌 접수에 남의 번호가 남지 않게).
 * 소속(관리사무소 등)·접수 번호·접수 내용은 하자 이력으로 남긴다.
 */
export function applyIntakeRetention(db: DemoDB, now: Date): DemoDB {
  const doneCut = new Date(now.getTime() - INTAKE_CONTACT_KEEP_DAYS * 86_400_000).toISOString();
  const openCut = new Date(now.getTime() - INTAKE_OPEN_KEEP_DAYS * 86_400_000).toISOString();
  const workOrders = db.workOrders ?? [];
  const due = (r: PartnerRequest) => {
    if (!r.intake || r.intake.purgedAt || (!r.intake.name && !r.intake.phone)) return false;
    const done = intakeFinishedAt(r, workOrders);
    return done ? done < doneCut : r.createdAt < openCut;
  };
  if (!db.partnerRequests.some(due)) return db;
  const at = now.toISOString();
  return {
    ...db,
    partnerRequests: db.partnerRequests.map((r) => {
      if (!due(r)) return r;
      const { name: _n, phone: _p, ...rest } = r.intake!;
      void _n;
      void _p;
      return { ...r, intake: { ...rest, purgedAt: at } };
    }),
  };
}
