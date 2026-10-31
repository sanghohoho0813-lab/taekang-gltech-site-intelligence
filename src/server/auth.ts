/**
 * 로그인·세션 (LIVE 모드).
 * - 비밀번호: scrypt (salt 16바이트, N=16384) — 원문은 저장하지 않는다
 * - 세션: 무작위 32바이트 토큰을 HttpOnly 쿠키로, DB에는 SHA-256 해시만 저장 (DB가 유출돼도 세션 탈취 불가)
 * - 연속 실패 8회 → 10분 잠금
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { RoleId } from "@/lib/domain/types";
import { getDb, type Tx } from "./sql";

export const SESSION_COOKIE = "tk_session";
export const SESSION_DAYS = 30;
const MAX_FAILS = 8;
const LOCK_MINUTES = 10;

export interface Member {
  id: string;
  companyId: string;
  email: string;
  name: string;
  title: string;
  role: RoleId;
  siteIds: string[];
  partnerSiteIds: string[];
  active: boolean;
  mustChangePassword: boolean;
}

interface MemberRecord {
  id: string;
  company_id: string;
  email: string;
  name: string;
  title: string;
  role: RoleId;
  site_ids: string[];
  partner_site_ids: string[];
  active: boolean;
  must_change_password: boolean;
  password_hash?: string;
  failed_logins?: number;
  locked_until?: string | Date | null;
}

export function toMember(r: MemberRecord): Member {
  return {
    id: r.id,
    companyId: r.company_id,
    email: r.email,
    name: r.name,
    title: r.title,
    role: r.role,
    siteIds: r.site_ids ?? [],
    partnerSiteIds: r.partner_site_ids ?? [],
    active: r.active,
    mustChangePassword: r.must_change_password,
  };
}

const MEMBER_COLS = `id, company_id, email, name, title, role, site_ids, partner_site_ids, active, must_change_password`;

// ───────────── 비밀번호 ─────────────

function scrypt(pw: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pw, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const key = await scrypt(pw.normalize("NFKC"), salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(pw.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** 8자 이상, 영문·숫자 포함 */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (pw.length > 128) return "비밀번호가 너무 깁니다.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "비밀번호에 영문과 숫자를 함께 넣어주세요.";
  return null;
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160 ? e : null;
}

// ───────────── 세션 ─────────────

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(tx: Tx, memberId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await tx.query(`insert into sessions (token_hash, member_id, expires_at) values ($1, $2, $3)`, [tokenHash(token), memberId, expires.toISOString()]);
  return { token, expires };
}

export async function memberFromToken(token: string | undefined | null): Promise<Member | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const db = await getDb();
  const rows = await db.query<MemberRecord & { last_seen_at: string | Date }>(
    `select m.id, m.company_id, m.email, m.name, m.title, m.role, m.site_ids, m.partner_site_ids, m.active, m.must_change_password, s.last_seen_at
     from sessions s join members m on m.id = s.member_id
     where s.token_hash = $1 and s.expires_at > now() and m.active = true`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 10 * 60_000) {
    await db.query(`update sessions set last_seen_at = now() where token_hash = $1`, [tokenHash(token)]);
  }
  return toMember(row);
}

export async function destroySession(token: string | undefined | null) {
  if (!token) return;
  const db = await getDb();
  await db.query(`delete from sessions where token_hash = $1`, [tokenHash(token)]);
}

export type LoginResult = { ok: true; token: string; expires: Date; member: Member } | { ok: false; error: string };

export async function login(emailIn: unknown, password: unknown): Promise<LoginResult> {
  const email = normalizeEmail(emailIn);
  const generic = "이메일 또는 비밀번호가 맞지 않습니다.";
  if (!email || typeof password !== "string" || !password) return { ok: false, error: generic };
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.query<MemberRecord>(`select ${MEMBER_COLS}, password_hash, failed_logins, locked_until from members where email = $1`, [email]);
    if (!row || !row.active) {
      // 존재 여부를 응답 시간으로 드러내지 않도록 같은 비용의 계산을 수행
      await hashPassword(password);
      return { ok: false, error: generic };
    }
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return { ok: false, error: `로그인 시도가 많아 잠시 잠겼습니다. ${LOCK_MINUTES}분 후 다시 시도하세요.` };
    }
    const ok = await verifyPassword(password, row.password_hash ?? "");
    if (!ok) {
      const fails = (row.failed_logins ?? 0) + 1;
      await tx.query(`update members set failed_logins = $2, locked_until = $3 where id = $1`, [
        row.id,
        fails >= MAX_FAILS ? 0 : fails,
        fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
      ]);
      return { ok: false, error: generic };
    }
    await tx.query(`update members set failed_logins = 0, locked_until = null where id = $1`, [row.id]);
    await tx.query(`delete from sessions where member_id = $1 and expires_at < now()`, [row.id]);
    const { token, expires } = await createSession(tx, row.id);
    return { ok: true, token, expires, member: toMember(row) };
  });
}

export async function changePassword(member: Member, current: unknown, next: unknown, keepToken: string): Promise<string | null> {
  const problem = passwordProblem(next);
  if (problem) return problem;
  if (typeof current !== "string") return "현재 비밀번호를 입력해주세요.";
  const db = await getDb();
  const [row] = await db.query<{ password_hash: string }>(`select password_hash from members where id = $1`, [member.id]);
  if (!row || !(await verifyPassword(current, row.password_hash))) return "현재 비밀번호가 맞지 않습니다.";
  if (current === next) return "새 비밀번호가 현재 비밀번호와 같습니다.";
  await db.transaction(async (tx) => {
    await tx.query(`update members set password_hash = $2, must_change_password = false, updated_at = now() where id = $1`, [member.id, await hashPassword(next as string)]);
    // 다른 기기의 세션은 끊는다 (지금 쓰는 세션은 유지)
    await tx.query(`delete from sessions where member_id = $1 and token_hash <> $2`, [member.id, tokenHash(keepToken)]);
  });
  return null;
}

export { MEMBER_COLS };
