/**
 * 백업 파일로 시작 (D-86) — 새로 만든 빈 시스템(회사 0개)에 ‘전체 자료 백업’을 되살린다.
 * 태강지엘텍 명의 계정(Supabase·Vercel)으로 옮길 때, 서버를 바꿀 때 쓰는 길이다.
 *
 * - 회사가 하나라도 있으면 거부한다(덮어쓰기 불가). 최초 설정과 같은 잠금·설정 코드.
 * - 회사 ID·사용자 ID를 백업 그대로 쓴다 → 기록의 ‘누가·언제’가 그대로 이어진다.
 * - 복원하는 사람은 백업 속 대표 이메일로 새 비밀번호를 정한다. 다른 직원은 ‘첫 로그인 전’ 상태(비밀번호 모름)
 *   → ‘시작 준비(/launch)’에서 임시 비밀번호가 든 로그인 쪽지를 인쇄해 나눠 준다. 비밀번호는 백업에 없다.
 * - QR 단말기는 비밀값이 백업에 없어 ‘해제됨’으로 남긴다(이름·이력은 보존) → 새로 등록해 태블릿을 다시 연결.
 * - 사진 원본은 이 파일에 없다 → 사진 백업 파일을 올리면 채워지고, 그 전에는 ‘사진 원본 없음’ 그림이 보인다.
 */
import { gunzipSync } from "node:zlib";
import type { DemoDB, RoleId } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { CommandError, cleanText } from "@/lib/data/commands";
import { createSeed } from "@/lib/data/seed";
import { normalizeOfficePhone } from "@/lib/domain/intake";
import { moneyIntegrity, type IntegrityCheck } from "@/lib/domain/integrity";
import { fmtDateTime, todayIso } from "@/lib/domain/format";
import { hex, randomBytes } from "@/lib/domain/hmac";
import { uid } from "@/lib/domain/ids";
import { getDb } from "./sql";
import { ForbiddenError } from "./authz";
import { COLLECTIONS, bulkInsertState, memberToUser, type CollectionName, type MemberRow } from "./state";
import { createSession, hashPassword, MEMBER_COLS, normalizeEmail, passwordProblem, toMember, type Member } from "./auth";
import { insertMember, needsSetup } from "./service";

export const BACKUP_FORMAT = "taekang-site-intelligence-backup";
/** 압축을 푼 백업의 최대 크기 — 1년치가 약 15MB(실제와 비슷하게 섞인 자료). 4년치까지, 그 이상은 DB 복원 (압축 폭탄으로 서버 메모리를 다 쓰지 않게 · 점검 반영) */
const MAX_JSON_BYTES = 64 * 1024 * 1024;
/** 큰 백업은 나눠 올린다 — 한 조각 3MB(서버 요청 한도 4.5MB 안), 최대 16조각(압축 48MB) */
export const RESTORE_PART_BYTES = 3_000_000;
const MAX_PARTS = 16;
const UPLOAD_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_ITEMS = 2_000_000;
const MAX_MEMBERS = 500;
const ROLES: RoleId[] = ["ceo", "manager", "field", "partner"];
const NAMES = Object.keys(COLLECTIONS) as CollectionName[];

export interface RestoreInput {
  /** 백업 파일 내용 — gzip 압축본(.json.gz) 또는 JSON 원문(예전 백업 .json), base64. 큰 파일은 대신 uploadId·parts(나눠 올린 조각) */
  backup?: string;
  uploadId?: string;
  parts?: number;
  email: string;
  password: string;
  publicPhone?: string;
}

export interface RestoreSummary {
  companyName: string;
  exportedAt: string | null;
  /** 되살린 자료 건수 (자료 묶음별) */
  counts: Record<string, number>;
  members: number;
  /** 첫 로그인 전으로 되살린 직원 수 — 로그인 쪽지를 새로 나눠 줄 사람 */
  pendingMembers: number;
  /** 첫 로그인 전 — 현장 직원(시범 운영 준비에서 쪽지) / 본사 관리자·발주처(운영 관리 → 사용자에서 초기화) */
  pending: { field: number; manager: number; partner: number };
  /** 원본을 따로 올려야 하는 사진 수 */
  photos: number;
  /** 다시 연결해야 하는 QR 단말기 수 */
  kiosks: number;
  integrity: Pick<IntegrityCheck, "key" | "level" | "title">[];
}

const bad = (msg: string): never => {
  throw new CommandError(msg, "VALIDATION");
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 500) : []);

/** DB(jsonb)가 받지 못하는 글자를 걸러 낸다 — API 본문(readJson)과 같은 규칙 */
function clean(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return cleanText(v);
  if (!v || typeof v !== "object") return v;
  if (depth > 40) bad("백업 파일의 구조가 너무 깊습니다.");
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = clean(v[i], depth + 1);
    return v;
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const val = clean(o[k], depth + 1);
    // 이름(키)에 든 NUL·짝 없는 서로게이트도 고친다 — 그대로 두면 저장할 때 DB 오류(500) (점검 반영)
    const nk = cleanText(k);
    if (nk !== k) {
      delete o[k];
      o[nk] = val;
    } else o[k] = val;
  }
  return o;
}

/** base64 → (gzip이면 풀어서) JSON 객체 */
export function readBackup(input: unknown): Record<string, unknown> {
  if (!(Buffer.isBuffer(input) && input.length) && !(typeof input === "string" && input)) bad("백업 파일을 골라 주세요.");
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input as string, "base64");
  let text: string;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      text = gunzipSync(bytes, { maxOutputLength: MAX_JSON_BYTES }).toString("utf8");
    } catch {
      return bad("압축된 백업 파일을 풀 수 없습니다. 파일이 손상되었거나 너무 큽니다.");
    }
  } else {
    if (bytes.length > MAX_JSON_BYTES) bad("백업 파일이 너무 큽니다.");
    text = bytes.toString("utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return bad("백업 파일이 아닙니다. ‘전체 자료 백업’에서 내려받은 파일(taekang_backup_….json.gz)을 골라 주세요.");
  }
  if (!isObj(parsed)) bad("백업 파일이 아닙니다.");
  return clean(parsed) as Record<string, unknown>;
}

interface BackupMember {
  id: string;
  email: string;
  name: string;
  title: string;
  role: RoleId;
  siteIds: string[];
  partnerSiteIds: string[];
  active: boolean;
}

/** 형식 검사 + 저장할 상태로 정리. 서버에 아무것도 쓰지 않는다 (시험에서 따로 부른다) */
export function prepareRestore(backup: Record<string, unknown>, ownerEmail: string, now: Date): { companyId: string; state: DemoDB; members: BackupMember[]; owner: BackupMember; exportedAt: string | null } {
  if (backup.format !== BACKUP_FORMAT) bad("태강 현장관리 백업 파일이 아닙니다.");
  if (backup.version !== 1) bad("이 프로그램이 읽을 수 없는 백업 형식입니다(버전이 다름). 개발 담당에게 알려 주세요.");
  const data = backup.data;
  if (!isObj(data)) bad("백업 파일의 자료 부분이 비어 있습니다.");
  const d = data as Record<string, unknown>;
  // DEMO(시연) 화면의 ‘브라우저 자료 백업’은 가상 자료라 사용자 목록이 없다
  if (!Array.isArray(backup.members)) bad("시연(DEMO) 화면에서 내려받은 가상 자료는 복원할 수 없습니다. 운영 화면의 ‘전체 자료 백업’ 파일을 골라 주세요.");

  // ── 사용자 ──
  const raw = backup.members as unknown[];
  if (raw.length > MAX_MEMBERS) bad("백업 파일의 사용자 수가 너무 많습니다.");
  const seenId = new Set<string>();
  const seenEmail = new Set<string>();
  const members: BackupMember[] = raw.map((x) => {
    if (!isObj(x)) return bad("백업 파일의 사용자 목록이 손상되었습니다.");
    const id = str(x.id, 80);
    const email = normalizeEmail(x.email);
    const role = x.role as RoleId;
    if (!/^[\w-]{1,80}$/.test(id) || !email || !ROLES.includes(role)) bad("백업 파일의 사용자 목록이 손상되었습니다.");
    if (seenId.has(id) || seenEmail.has(email!)) bad("백업 파일에 같은 사용자가 두 번 있습니다(파일 손상).");
    seenId.add(id);
    seenEmail.add(email!);
    return { id, email: email!, name: str(x.name, 40) || "이름 없음", title: str(x.title, 40), role, siteIds: strList(x.siteIds), partnerSiteIds: strList(x.partnerSiteIds), active: x.active !== false };
  });
  const owner = members.find((m) => m.email === ownerEmail);
  if (!owner) bad("이 백업 파일에 없는 이메일입니다. 백업 속 대표 계정의 이메일(로그인 아이디)을 넣어 주세요.");
  if (owner!.role !== "ceo" || !owner!.active) bad("백업 속 ‘대표’ 계정의 이메일로만 복원할 수 있습니다.");

  // ── 자료 묶음 ──
  let total = 0;
  const collections: Record<string, Record<string, unknown>[]> = {};
  for (const name of NAMES) {
    const v = d[name];
    if (v === undefined || v === null) {
      collections[name] = [];
      continue;
    }
    if (!Array.isArray(v)) bad(`백업 파일의 자료(${name})가 손상되었습니다.`);
    const keyOf = COLLECTIONS[name];
    const keys = new Set<string>();
    for (const item of v as unknown[]) {
      if (!isObj(item)) bad(`백업 파일의 자료(${name})가 손상되었습니다.`);
      const key = keyOf(item as Record<string, unknown>);
      if (!key || key === "undefined" || key.length > 200) bad(`백업 파일의 자료(${name})에 번호가 없는 줄이 있습니다.`);
      if (keys.has(key)) bad(`백업 파일의 자료(${name})에 같은 줄이 두 번 있습니다(파일 손상).`);
      keys.add(key);
    }
    total += (v as unknown[]).length;
    if (total > MAX_ITEMS) bad("백업 파일의 자료가 너무 많습니다.");
    collections[name] = v as Record<string, unknown>[];
  }
  // 화면·계산이 꼭 쓰는 값의 모양 — 번호만 맞고 이름·금액·날짜가 빠진 줄이 들어가면 복원 뒤 화면이 깨지고 되돌릴 수 없다 (점검 반영)
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const okTime = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  const shape = (name: string, ok: (x: Record<string, unknown>) => boolean) => {
    if (!collections[name].every(ok)) bad(`백업 파일의 자료(${name})에 빠진 값이 있습니다(파일 손상).`);
  };
  shape("sites", (x) => typeof x.name === "string" && !!x.name);
  shape("costEntries", (x) => Number.isFinite(x.amount) && typeof x.date === "string" && DATE.test(x.date));
  shape("billings", (x) => Number.isFinite(x.amount) && typeof x.billedDate === "string" && DATE.test(x.billedDate));
  shape("payments", (x) => Number.isFinite(x.amount) && typeof x.receivedDate === "string" && DATE.test(x.receivedDate));
  shape("photos", (x) => typeof x.siteId === "string" && okTime(x.createdAt));
  // 변경공사 증빙 파일 (D-88) — 어느 변경공사의 무슨 파일인지 (화면이 종류·이름을 쓴다)
  shape("coEvidence", (x) => typeof x.changeOrderId === "string" && typeof x.siteId === "string" && okTime(x.createdAt) && (x.kind === "image" || x.kind === "pdf") && ["contract", "letter", "estimate", "other"].includes(x.docType as string) && typeof x.fileName === "string" && x.fileName.length <= 100);
  // 원본 주소는 그 기록 자신의 번호만 — 사진 기록과 증빙 기록이 같은 번호를 쓰면(손으로 고친 백업) 현장 직원이 증빙 원본을 받을 수 있다 (D-88 점검)
  const ownUrl = (x: Record<string, unknown>) => x.dataUrl === `/api/photos/${encodeURIComponent(String(x.id))}`;
  shape("photos", ownUrl);
  shape("coEvidence", ownUrl);
  const photoIds = new Set(collections.photos.map((x) => String(x.id)));
  if (collections.coEvidence.some((x) => photoIds.has(String(x.id)))) bad("백업 파일의 자료(coEvidence)가 손상되었습니다(사진과 같은 번호).");
  shape("activityLogs", (x) => okTime(x.at) && typeof x.summary === "string");
  // 이력의 바로 가기는 이 앱 안 주소만 (다른 사이트 주소로 보내는 줄이 들어오지 않게)
  collections.activityLogs = collections.activityLogs.map((l) => (typeof l.link === "string" && !/^\/(?![/\\])/.test(l.link) ? { ...l, link: undefined } : l));

  const nowIso = now.toISOString();
  const company = isObj(d.company) ? d.company : {};
  const seed = createSeed();
  const companyId = typeof backup.companyId === "string" && /^[\w-]{1,80}$/.test(backup.companyId) ? backup.companyId : uid("co");
  const state = {
    ...collections,
    version: 1,
    // 원래 시스템보다 큰 번호로 — 열려 있던 화면이 ‘더 오래된 자료’로 보고 무시하지 않게
    rev: Math.min(Math.max(1, Math.floor(Number(d.rev) || 0) + 1), 1e12),
    seededAt: str(d.seededAt, 40) || nowIso,
    updatedAt: nowIso,
    company: { name: str(company.name, 80) || "회사", product: str(company.product, 80) || seed.company.product, tagline: str(company.tagline, 200) },
    users: members.map((m) => memberToUser({ id: m.id, company_id: companyId, email: m.email, name: m.name, title: m.title, role: m.role, site_ids: m.siteIds, partner_site_ids: m.partnerSiteIds, active: m.active, must_change_password: m.id !== owner!.id } satisfies MemberRow)),
    baseline: isObj(d.baseline) ? d.baseline : {},
    thresholds: isObj(d.thresholds) ? d.thresholds : seed.thresholds,
    settings: { ...DEFAULT_SETTINGS, ...(isObj(d.settings) ? d.settings : {}) },
    signalStates: isObj(d.signalStates) ? d.signalStates : {},
    idempotencyKeys: [],
    // 단말기 비밀값은 백업에 없다 → 해제된 단말기로 남기고 새로 등록 (이름·이력은 그대로)
    kiosks: collections.kiosks.map((k) => {
      const { secret: _s, pairHash: _p, pairExpiresAt: _e, ...rest } = k;
      void _s, void _p, void _e;
      return rest.revokedAt ? rest : { ...rest, revokedAt: nowIso, revokedBy: owner!.id };
    }),
  } as unknown as DemoDB;
  const exportedAt = typeof backup.exportedAt === "string" ? backup.exportedAt.slice(0, 40) : null;
  return { companyId, state, members, owner: owner!, exportedAt };
}

const ALREADY = "이미 회사 설정이 끝난 시스템에는 복원할 수 없습니다. 빈 시스템(새 DB)에서만 복원합니다 — 지금 자료를 덮어쓰지 않게.";

/**
 * 큰 백업 나눠 올리기 (압축 3MB 넘는 파일 · 대략 1년 반 넘은 자료) — 조각을 잠시 DB에 두었다가 마지막 요청에서 합쳐 복원한다.
 * 빈 시스템에서만, 설정 코드는 경로에서 확인. 한 시간 지난 조각은 지운다.
 */
export async function storeRestorePart(input: { uploadId?: unknown; seq?: unknown; data?: unknown }): Promise<{ stored: number }> {
  const { uploadId, seq, data } = input;
  if (typeof uploadId !== "string" || !UPLOAD_ID.test(uploadId) || !Number.isInteger(seq) || (seq as number) < 0 || (seq as number) >= MAX_PARTS || typeof data !== "string" || !data) bad("요청 형식이 올바르지 않습니다.");
  if (!(await needsSetup())) throw new ForbiddenError(ALREADY);
  const bytes = Buffer.from(data as string, "base64");
  if (!bytes.length || bytes.length > RESTORE_PART_BYTES) bad("조각 크기가 맞지 않습니다.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query(`delete from restore_uploads where created_at < now() - interval '1 hour'`);
    // 임시 조각 전체 크기 한도 — 여러 번호로 계속 올려 DB를 채우지 못하게 (조각 16개 × 3MB + 여유)
    const [{ total }] = await tx.query<{ total: string | number }>(`select coalesce(sum(length(data)), 0) as total from restore_uploads where not (id = $1 and seq = $2)`, [uploadId, seq]);
    if (Number(total) + bytes.length > MAX_PARTS * RESTORE_PART_BYTES + RESTORE_PART_BYTES) bad("임시로 받아 둔 백업 조각이 너무 많습니다. 한 시간 뒤 다시 시도해 주세요.");
    await tx.query(`insert into restore_uploads (id, seq, data) values ($1, $2, $3) on conflict (id, seq) do update set data = excluded.data, created_at = now()`, [uploadId, seq, bytes]);
    const [{ n }] = await tx.query<{ n: string | number }>(`select count(*) as n from restore_uploads where id = $1`, [uploadId]);
    return { stored: Number(n) };
  });
}

async function takeParts(uploadId: unknown, parts: unknown): Promise<Buffer> {
  if (typeof uploadId !== "string" || !UPLOAD_ID.test(uploadId) || !Number.isInteger(parts) || (parts as number) < 1 || (parts as number) > MAX_PARTS) return bad("요청 형식이 올바르지 않습니다.");
  const db = await getDb();
  const rows = await db.query<{ seq: number; data: Uint8Array }>(`select seq, data from restore_uploads where id = $1 order by seq`, [uploadId]);
  if (rows.length !== parts || rows.some((r, i) => Number(r.seq) !== i)) return bad("백업 파일 조각이 다 올라오지 않았습니다. 다시 시도해 주세요.");
  return Buffer.concat(rows.map((r) => Buffer.from(r.data)));
}

export async function restoreCompany(input: RestoreInput, now = new Date()): Promise<{ token: string; expires: Date; member: Member; summary: RestoreSummary }> {
  const errors: Record<string, string> = {};
  const email = normalizeEmail(input.email);
  if (!email) errors.email = "백업 속 대표 계정의 이메일(로그인 아이디)을 넣어 주세요.";
  const pw = passwordProblem(input.password);
  if (pw) errors.password = pw;
  const phoneRaw = typeof input.publicPhone === "string" ? input.publicPhone.trim() : "";
  const publicPhone = phoneRaw ? normalizeOfficePhone(phoneRaw) : null;
  if (phoneRaw && !publicPhone) errors.publicPhone = "전화번호를 확인해 주세요. (예: 031-123-4567)";
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);

  // 무거운 일(압축 풀기·읽기·비밀번호 해시)보다 먼저 — 이미 쓰고 있는 시스템이면 바로 거부 (점검 반영: 압축 폭탄으로 운영 서버를 멈추지 못하게)
  if (!(await needsSetup())) throw new ForbiddenError(ALREADY);
  const raw = input.uploadId !== undefined ? await takeParts(input.uploadId, input.parts) : input.backup;
  const backup = readBackup(raw);
  const { companyId, state, members, owner, exportedAt } = prepareRestore(backup, email!, now);
  if (publicPhone) state.settings = { ...state.settings, publicPhone, helpPhone: publicPhone } as DemoDB["settings"];
  // 복원 자체도 활동 이력에 남긴다 (누가·언제·어느 백업으로)
  const counts = Object.fromEntries(NAMES.map((n) => [n, ((state as unknown as Record<string, unknown[]>)[n] ?? []).length]).filter(([, v]) => (v as number) > 0)) as Record<string, number>;
  state.activityLogs = [
    { id: uid("log"), at: now.toISOString(), by: owner.id, type: "member", summary: `백업 파일로 복원 — ${exportedAt && Number.isFinite(Date.parse(exportedAt)) ? `백업 시각 ${fmtDateTime(exportedAt)} · ` : ""}자료 ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString("ko-KR")}건 · 사용자 ${members.length}명`, link: "/data" },
    ...state.activityLogs,
  ];
  // 숫자 맞추기 점검 — 원본 시스템과 같은 결과여야 한다. 점검이 실패해도 복원은 계속(결과에 표시)
  let integrity: RestoreSummary["integrity"] = [];
  try {
    integrity = moneyIntegrity(state, todayIso(now)).map(({ key, level, title }) => ({ key, level, title }));
  } catch {
    // 점검이 돌지 못하는 자료는 화면 계산도 깨진다 — 저장하지 않는다(한 번 들어가면 빈 시스템이 아니라 다시 복원할 수 없음 · 점검 반영)
    return bad("백업 자료가 손상되어 숫자 맞추기 점검을 할 수 없습니다. 복원하지 않았습니다 — 예전 시스템에서 백업을 다시 받아 주세요.");
  }

  // 비밀번호 해시는 잠금 밖에서 미리 (scrypt는 느리다 — 잠금을 오래 쥐지 않게)
  const ownerHash = await hashPassword(input.password);
  const otherHash = await hashPassword(hex(randomBytes(24)));

  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    await tx.query(`lock table companies in exclusive mode`);
    const [row] = await tx.query<{ n: string | number }>(`select count(*) as n from companies`);
    if (Number(row?.n ?? 0) > 0) throw new ForbiddenError(ALREADY);
    // 다른 회사의 사용자와 이메일이 겹치면(같은 DB를 다른 용도로 쓰던 경우) 복원하지 않는다
    const taken = await tx.query<{ email: string }>(`select email from members where email = any($1::text[])`, [members.map((m) => m.email)]);
    if (taken.length) throw new CommandError(`이미 쓰이는 이메일이 있어 복원할 수 없습니다: ${taken.map((t) => t.email).join(", ")}`, "VALIDATION");
    await tx.query(`insert into companies (id, name, info, rev) values ($1, $2, $3::jsonb, $4)`, [
      companyId,
      state.company.name,
      JSON.stringify({ product: state.company.product, tagline: state.company.tagline }),
      state.rev,
    ]);
    for (const m of members) {
      const isOwner = m.id === owner.id;
      await insertMember(tx, {
        id: m.id,
        companyId,
        email: m.email,
        name: m.name,
        title: m.title,
        role: m.role,
        hash: isOwner ? ownerHash : otherHash,
        mustChange: !isOwner,
        siteIds: m.siteIds,
        partnerSiteIds: m.partnerSiteIds,
      });
    }
    const inactive = members.filter((m) => !m.active).map((m) => m.id);
    if (inactive.length) await tx.query(`update members set active = false where company_id = $1 and id = any($2::text[])`, [companyId, inactive]);
    await bulkInsertState(tx, companyId, state);
    // 나눠 올린 조각은 다 썼으면 지운다
    await tx.query(`delete from restore_uploads`);
    const session = await createSession(tx, owner.id);
    const [mrow] = await tx.query<Parameters<typeof toMember>[0]>(`select ${MEMBER_COLS} from members where id = $1`, [owner.id]);
    return { ...session, member: toMember(mrow) };
  });
  return {
    ...done,
    summary: {
      companyName: state.company.name,
      exportedAt,
      counts,
      members: members.length,
      pendingMembers: members.filter((m) => m.active && m.id !== owner.id).length,
      pending: {
        field: members.filter((m) => m.active && m.role === "field").length,
        manager: members.filter((m) => m.active && m.id !== owner.id && (m.role === "manager" || m.role === "ceo")).length,
        partner: members.filter((m) => m.active && m.role === "partner").length,
      },
      photos: state.photos.length,
      kiosks: (state.kiosks ?? []).length,
      integrity,
    },
  };
}
