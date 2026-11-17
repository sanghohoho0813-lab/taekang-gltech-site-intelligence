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
import { insertMember } from "./service";

export const BACKUP_FORMAT = "taekang-site-intelligence-backup";
/** 압축을 푼 백업의 최대 크기 — 1년치가 약 15MB. 넉넉히 잡되 서버 메모리를 지킨다 */
const MAX_JSON_BYTES = 200 * 1024 * 1024;
const MAX_ITEMS = 2_000_000;
const MAX_MEMBERS = 500;
const ROLES: RoleId[] = ["ceo", "manager", "field", "partner"];
const NAMES = Object.keys(COLLECTIONS) as CollectionName[];

export interface RestoreInput {
  /** 백업 파일 내용 — gzip 압축본(.json.gz) 또는 JSON 원문(예전 백업 .json), base64 */
  backup: string;
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
  for (const k of Object.keys(o)) o[k] = clean(o[k], depth + 1);
  return o;
}

/** base64 → (gzip이면 풀어서) JSON 객체 */
export function readBackup(base64: unknown): Record<string, unknown> {
  if (typeof base64 !== "string" || !base64) bad("백업 파일을 골라 주세요.");
  const bytes = Buffer.from(base64 as string, "base64");
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

  const backup = readBackup(input.backup);
  const { companyId, state, members, owner, exportedAt } = prepareRestore(backup, email!, now);
  if (publicPhone) state.settings = { ...state.settings, publicPhone, helpPhone: publicPhone } as DemoDB["settings"];
  // 복원 자체도 활동 이력에 남긴다 (누가·언제·어느 백업으로)
  const counts = Object.fromEntries(NAMES.map((n) => [n, ((state as unknown as Record<string, unknown[]>)[n] ?? []).length]).filter(([, v]) => (v as number) > 0)) as Record<string, number>;
  state.activityLogs = [
    { id: uid("log"), at: now.toISOString(), by: owner.id, type: "member", summary: `백업 파일로 복원 — ${exportedAt && Number.isFinite(Date.parse(exportedAt)) ? `백업 시각 ${fmtDateTime(exportedAt)} · ` : ""}자료 ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString("ko-KR")}건 · 사용자 ${members.length}명`, link: "/data" },
    ...state.activityLogs,
  ];
  // 숫자 맞추기 점검 — 원본 시스템과 같은 결과여야 한다. 점검이 실패해도 복원은 계속(결과에 표시)
  let integrity: RestoreSummary["integrity"];
  try {
    integrity = moneyIntegrity(state, todayIso(now)).map(({ key, level, title }) => ({ key, level, title }));
  } catch {
    integrity = [{ key: "check-failed", level: "warn", title: "숫자 맞추기 점검을 하지 못했습니다 — 복원 뒤 ‘자료 관리’에서 다시 보세요." }];
  }

  // 비밀번호 해시는 잠금 밖에서 미리 (scrypt는 느리다 — 잠금을 오래 쥐지 않게)
  const ownerHash = await hashPassword(input.password);
  const otherHash = await hashPassword(hex(randomBytes(24)));

  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    await tx.query(`lock table companies in exclusive mode`);
    const [row] = await tx.query<{ n: string | number }>(`select count(*) as n from companies`);
    if (Number(row?.n ?? 0) > 0) throw new ForbiddenError("이미 회사 설정이 끝난 시스템에는 복원할 수 없습니다. 빈 시스템(새 DB)에서만 복원합니다 — 지금 자료를 덮어쓰지 않게.");
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
      photos: state.photos.length,
      kiosks: (state.kiosks ?? []).length,
      integrity,
    },
  };
}
