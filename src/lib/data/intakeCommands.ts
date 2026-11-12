/**
 * 하자 접수 링크 (D-74)
 * - 본사 명령 (registry): createIntake · closeIntake · renewIntakeStatus
 * - 로그인 없는 사람이 쓰는 것 (registry에 넣지 않는다 — 서버 전용 경로 /api/intake 에서만): submitIntake · confirmIntake
 */
import type { DefectIntake, DemoDB, PartnerRequest } from "@/lib/domain/types";
import { CommandError, claimKey, clone, log, nowIso, requireSite, touch, type Ctx } from "./commands";
import { randomBytes } from "@/lib/domain/hmac";
import {
  INTAKE_CONTACT_KEEP_DAYS,
  INTAKE_DAILY_LIMIT,
  INTAKE_MAX_OPEN_PER_SITE,
  INTAKE_MAX_PHOTOS,
  intakeCanConfirm,
  intakeCountToday,
  intakeState,
  newToken,
  nextIntakeNo,
  normalizePhone,
  tokenHash,
} from "@/lib/domain/intake";
import { uid } from "@/lib/domain/ids";

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
/** 사진: JPEG·PNG·WEBP data URL, 2.5MB 이하 (다른 사진 입력과 같은 기준) */
const validPhoto = (v: unknown) => typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 3_400_000;

/** 본사 — 접수 링크 만들기. 접수만 되는 주소라 다시 볼 수 있게 저장한다 */
export function createIntake(db0: DemoDB, input: { siteId: string; label?: string }, ctx: Ctx) {
  const site0 = requireSite(db0, typeof input?.siteId === "string" ? input.siteId : "");
  const label = text(input.label) || "하자 접수";
  if (label.length > 20) throw new CommandError("이름은 20자 이내로 적어 주세요.", "VALIDATION", { label: "이름은 20자 이내로 적어 주세요." });
  const open = (db0.intakes ?? []).filter((i) => i.siteId === site0.id && intakeState(i) === "open");
  if (open.length >= INTAKE_MAX_OPEN_PER_SITE) throw new CommandError(`이 현장에 열려 있는 접수 링크가 ${INTAKE_MAX_OPEN_PER_SITE}개입니다. 안 쓰는 링크를 닫고 다시 만들어 주세요.`, "STATE");
  if (open.some((i) => i.label === label)) throw new CommandError(`‘${label}’ 접수 링크가 이미 열려 있습니다. 다른 이름을 적거나 그 링크를 쓰세요.`, "STATE");
  const db = clone(db0);
  const at = nowIso(ctx);
  const token = newToken(randomBytes, 16);
  const intake: DefectIntake = { id: tokenHash(token), token, siteId: site0.id, label, createdAt: at, createdBy: ctx.userId, count: 0 };
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

/**
 * 본사 — 진행 확인 주소 다시 만들기 (접수자가 주소를 잃어버렸을 때). 새 주소는 이번 한 번만 돌려주고, 앞의 주소는 더 열리지 않는다.
 */
export function renewIntakeStatus(db0: DemoDB, input: { requestId: string }, ctx: Ctx) {
  const r0 = db0.partnerRequests.find((x) => x.id === input?.requestId);
  if (!r0 || !r0.intake) throw new CommandError("링크로 접수된 요청을 찾을 수 없습니다.", "NOT_FOUND");
  const db = clone(db0);
  const statusToken = newToken(randomBytes, 24);
  const r = db.partnerRequests.find((x) => x.id === r0.id)!;
  r.statusKey = tokenHash(statusToken);
  log(db, ctx, "partner", `하자 접수 진행 확인 주소 다시 만듦 — 접수 번호 ${r0.intake.no}`, r0.siteId, "/insights#requests");
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
}

/**
 * 로그인 없는 사람의 하자 접수 — 접수 링크가 열려 있을 때만. 하자보수 요청 한 건을 만들고 ‘진행 확인 주소’를 한 번 돌려준다.
 * ctx.userId는 "system" (계정이 없다).
 */
export function submitIntake(db0: DemoDB, input: SubmitIntakeInput, ctx: Ctx) {
  const intake = (db0.intakes ?? []).find((x) => x.id === input?.intakeId);
  if (!intake || intakeState(intake) !== "open") throw new CommandError("지금은 이 주소로 접수할 수 없습니다. 보내 주신 곳에 문의해 주세요.", "NOT_FOUND");
  const site = requireSite(db0, intake.siteId);
  const errors: Record<string, string> = {};
  const location = text(input.location);
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const org = text(input.org);
  const name = text(input.name);
  const phone = normalizePhone(input.phone);
  const photos = Array.isArray(input.photoDataUrls) ? input.photoDataUrls : [];
  if (!location) errors.location = "하자가 있는 곳을 적어 주세요. (예: 3층 302호 거실 창)";
  else if (location.length > 60) errors.location = "위치는 60자 이내로 적어 주세요.";
  if (!description) errors.description = "어떤 문제인지 적어 주세요.";
  else if (description.length > 800) errors.description = "내용은 800자 이내로 적어 주세요.";
  if (!name) errors.name = "연락받으실 분 이름을 적어 주세요.";
  else if (name.length > 30) errors.name = "이름은 30자 이내";
  if (org.length > 40) errors.org = "소속은 40자 이내";
  if (!phone) errors.phone = "연락받으실 전화번호를 확인해 주세요. (예: 010-1234-5678)";
  if (photos.length > INTAKE_MAX_PHOTOS) errors.photos = `사진은 ${INTAKE_MAX_PHOTOS}장까지 보낼 수 있습니다.`;
  else if (photos.some((p) => !validPhoto(p))) errors.photos = "사진 형식을 확인해 주세요 (JPEG·PNG·WEBP, 2.5MB 이하).";
  if (input.consent !== true) errors.consent = "연락처 제공에 동의해 주셔야 접수할 수 있습니다.";
  if (Object.keys(errors).length) throw new CommandError("입력한 내용을 확인해 주세요.", "VALIDATION", errors);
  const at = nowIso(ctx);
  if (intakeCountToday(db0, intake.id, at) >= INTAKE_DAILY_LIMIT) throw new CommandError("오늘은 이 주소로 접수가 많아 더 받을 수 없습니다. 전화로 알려 주세요.", "STATE");

  const db = clone(db0);
  claimKey(db, typeof input.idempotencyKey === "string" && input.idempotencyKey ? `intake:${input.idempotencyKey.slice(0, 60)}` : undefined);
  const statusToken = newToken(randomBytes, 24);
  const no = nextIntakeNo(db, site.id, at);
  const req: PartnerRequest = {
    id: uid("pr"),
    siteId: site.id,
    partnerUserId: "",
    type: "defect",
    title: `하자 접수 · ${location}`.slice(0, 80),
    description,
    location,
    status: "received",
    createdAt: at,
    updatedAt: at,
    intake: { id: intake.id, no, ...(org ? { org } : {}), name, phone: phone!, consentAt: at },
    statusKey: tokenHash(statusToken),
    history: [{ at, status: "received", by: ctx.userId, note: `접수 링크 (${intake.label})` }],
  };
  if (photos.length) {
    req.photoIds = photos.map((dataUrl) => {
      const id = uid("ph");
      db.photos.push({ id, siteId: site.id, partnerRequestId: req.id, dataUrl, caption: `하자 접수 · ${location}`.slice(0, 80), createdAt: at, createdBy: ctx.userId });
      return id;
    });
  }
  db.partnerRequests.unshift(req);
  db.intakes = (db.intakes ?? []).map((x) => (x.id === intake.id ? { ...x, count: x.count + 1, lastAt: at } : x));
  // 활동 이력에는 이름·연락처를 적지 않는다 (현장·위치만)
  log(db, ctx, "partner", `하자 접수(링크): ${site.shortName} · ${location} — 접수 번호 ${no}`, site.id, "/insights#requests");
  touch(db, ctx);
  return { db, result: { requestId: req.id, no, statusToken } };
}

/** 진행 확인 주소를 가진 사람의 ‘확인했습니다’ — 보수가 끝나고 회신을 받은 뒤에만 */
export function confirmIntake(db0: DemoDB, input: { requestId: string; note?: string }, ctx: Ctx) {
  const r0 = db0.partnerRequests.find((x) => x.id === input?.requestId);
  if (!r0 || !r0.intake) throw new CommandError("접수를 찾을 수 없습니다.", "NOT_FOUND");
  if (r0.confirmedAt) throw new CommandError("이미 확인하셨습니다.", "STATE");
  if (!intakeCanConfirm(r0, db0.workOrders ?? [])) throw new CommandError("보수가 끝난 뒤에 확인할 수 있습니다.", "STATE");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 200) throw new CommandError("남길 말은 200자 이내로 적어 주세요.", "VALIDATION", { note: "남길 말은 200자 이내로 적어 주세요." });
  const db = clone(db0);
  const r = db.partnerRequests.find((x) => x.id === r0.id)!;
  const at = nowIso(ctx);
  r.confirmedAt = at;
  if (note) r.confirmNote = note;
  r.updatedAt = at;
  r.history.push({ at, status: "answered", by: ctx.userId, note: note ? `발주처 확인 · ${note}` : "발주처 확인" });
  log(db, ctx, "partner", `하자 접수 확인(링크): ${db.sites.find((s) => s.id === r.siteId)?.shortName ?? ""} · 접수 번호 ${r0.intake.no}`, r.siteId, "/insights#requests");
  touch(db, ctx);
  return { db, result: { confirmedAt: at } };
}

/**
 * 처리 끝난(회신 완료) 지 90일이 지난 링크 접수의 이름·연락처를 지운다 — 바꿀 것이 없으면 같은 객체를 그대로 돌려준다.
 * 소속(관리사무소 등)·접수 번호·접수 내용은 하자 이력으로 남긴다.
 */
export function applyIntakeRetention(db: DemoDB, now: Date): DemoDB {
  const cut = new Date(now.getTime() - INTAKE_CONTACT_KEEP_DAYS * 86_400_000).toISOString();
  const due = (r: PartnerRequest) => !!r.intake && !r.intake.purgedAt && (!!r.intake.name || !!r.intake.phone) && r.status === "answered" && r.updatedAt < cut;
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
