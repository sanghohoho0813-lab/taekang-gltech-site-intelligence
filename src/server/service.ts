/**
 * LIVE 서비스 — 명령 실행·데이터 조회·최초 설정·사용자 관리.
 * 모든 쓰기는 회사 단위 잠금(select ... for update) 안에서: 최신 데이터 로드 → 권한 검사 → 순수 명령 실행 → 차이 저장.
 */
import type { DemoDB, RoleId } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { COMMANDS, isCommandName, type CommandName } from "@/lib/data/registry";
import { CommandError } from "@/lib/data/commands";
import { createSeed } from "@/lib/data/seed";
import { uid } from "@/lib/domain/ids";
import { getDb, type Tx } from "./sql";
import { loadState, persistState } from "./state";
import { authorize, fieldSiteIds, ForbiddenError, sanitizeResult, viewFor } from "./authz";
import { createSession, hashPassword, MEMBER_COLS, normalizeEmail, passwordProblem, toMember, type Member } from "./auth";

export async function getView(m: Member): Promise<{ rev: number; db: DemoDB }> {
  const db = await getDb();
  const state = await db.transaction((tx) => loadState(tx, m.companyId));
  return { rev: state.rev, db: viewFor(m, state) };
}

export async function currentRev(companyId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.query<{ rev: string | number }>(`select rev from companies where id = $1`, [companyId]);
  return Number(row?.rev ?? 0);
}

export async function executeCommand(m: Member, name: unknown, args: unknown): Promise<{ result: unknown; rev: number; db: DemoDB }> {
  if (!isCommandName(name)) throw new CommandError("알 수 없는 요청입니다.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.query(`select rev from companies where id = $1 for update`, [m.companyId]);
    const state = await loadState(tx, m.companyId);
    const now = new Date();
    const safeArgs = authorize(m, name, args, state, now);
    const fn = COMMANDS[name as CommandName] as unknown as (d: DemoDB, a: unknown, c: { userId: string; now: Date }) => { db: DemoDB; result: unknown };
    let out: { db: DemoDB; result: unknown };
    try {
      out = fn(state, safeArgs, { userId: m.id, now });
    } catch (e) {
      if (e instanceof CommandError || e instanceof ForbiddenError) throw e;
      // 형식이 맞지 않는 입력으로 명령 내부에서 난 오류는 사용자에게는 형식 오류로
      console.error("[command]", name, e);
      throw new CommandError("요청 형식이 올바르지 않습니다.");
    }
    await persistState(tx, m.companyId, state, out.db);
    return { result: sanitizeResult(m, out.result), rev: out.db.rev, db: viewFor(m, out.db) };
  });
}

// ───────────── 사진 ─────────────

export async function getPhoto(m: Member, id: string): Promise<{ mime: string; data: Uint8Array } | null> {
  if (m.role === "partner") return null;
  const db = await getDb();
  const [row] = await db.query<{ mime: string; data: Uint8Array; site_id: string | null }>(
    `select mime, data, site_id from photo_blobs where id = $1 and company_id = $2`,
    [id, m.companyId],
  );
  if (!row) return null;
  if (m.role === "field") {
    const state = await db.transaction((tx) => loadState(tx, m.companyId));
    if (!row.site_id || !fieldSiteIds(m, state).has(row.site_id)) return null;
  }
  return { mime: row.mime, data: row.data };
}

// ───────────── 최초 설정 ─────────────

export async function needsSetup(): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.query<{ n: string | number }>(`select count(*) as n from companies`);
  return Number(row?.n ?? 0) === 0;
}

export interface SetupInput {
  companyName: string;
  name: string;
  email: string;
  password: string;
  /** 가상 현장 3곳·가상 직원 계정으로 시작 (교육·시험 운영용) */
  withDemoData?: boolean;
}

/** 데모 데이터로 시작할 때 만드는 가상 직원 계정 (비밀번호는 대표 계정과 같음) */
export const DEMO_ACCOUNTS: { id: string; email: string; role: RoleId }[] = [
  { id: "u-manager", email: "manager@demo.local", role: "manager" },
  { id: "u-field", email: "field@demo.local", role: "field" },
  { id: "u-field2", email: "field2@demo.local", role: "field" },
  { id: "u-partner", email: "partner@demo.local", role: "partner" },
];

export async function setupCompany(input: SetupInput): Promise<{ token: string; expires: Date; member: Member }> {
  const errors: Record<string, string> = {};
  const email = normalizeEmail(input.email);
  if (!input.companyName?.trim()) errors.companyName = "회사명을 입력해주세요.";
  if (!input.name?.trim()) errors.name = "이름을 입력해주세요.";
  if (!email) errors.email = "이메일 형식을 확인해주세요.";
  const pw = passwordProblem(input.password);
  if (pw) errors.password = pw;
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);

  const db = await getDb();
  return db.transaction(async (tx) => {
    // 동시에 두 번 눌러도 회사가 하나만 만들어지도록 잠금
    await tx.query(`lock table companies in exclusive mode`);
    const [row] = await tx.query<{ n: string | number }>(`select count(*) as n from companies`);
    if (Number(row?.n ?? 0) > 0) throw new ForbiddenError("이미 설정이 끝났습니다. 로그인해주세요.");

    const companyId = uid("co");
    const seed = createSeed();
    const ownerId = input.withDemoData ? "u-ceo" : uid("u");
    const state: DemoDB = input.withDemoData
      ? { ...seed, company: { ...seed.company, name: input.companyName.trim() }, settings: { ...DEFAULT_SETTINGS, sampleData: true } }
      : {
          ...seed,
          company: { ...seed.company, name: input.companyName.trim() },
          users: [],
          sites: [],
          contracts: [],
          budgets: [],
          forecasts: [],
          costEntries: [],
          reports: [],
          photos: [],
          changeOrders: [],
          billings: [],
          payments: [],
          partnerRequests: [],
          signalStates: {},
          actions: [],
          proofEvents: [],
          activityLogs: [],
          baseline: {},
          idempotencyKeys: [],
          settings: DEFAULT_SETTINGS,
          rev: 1,
        };
    await tx.query(`insert into companies (id, name, info, rev) values ($1, $2, $3::jsonb, $4)`, [
      companyId,
      state.company.name,
      JSON.stringify({ product: state.company.product, tagline: state.company.tagline }),
      state.rev,
    ]);
    const hash = await hashPassword(input.password);
    await insertMember(tx, { id: ownerId, companyId, email: email!, name: input.name.trim(), title: "대표", role: "ceo", hash, mustChange: false });
    if (input.withDemoData) {
      for (const a of DEMO_ACCOUNTS) {
        const u = seed.users.find((x) => x.id === a.id)!;
        await insertMember(tx, {
          id: a.id,
          companyId,
          email: a.email,
          name: u.name,
          title: u.title,
          role: a.role,
          hash,
          mustChange: false,
          partnerSiteIds: u.partnerSiteIds ?? [],
        });
      }
    }
    await persistState(tx, companyId, null, state);
    const session = await createSession(tx, ownerId);
    const [m] = await tx.query<Parameters<typeof toMember>[0]>(`select ${MEMBER_COLS} from members where id = $1`, [ownerId]);
    return { ...session, member: toMember(m) };
  });
}

async function insertMember(
  tx: Tx,
  a: { id: string; companyId: string; email: string; name: string; title: string; role: RoleId; hash: string; mustChange: boolean; siteIds?: string[]; partnerSiteIds?: string[] },
) {
  await tx.query(
    `insert into members (id, company_id, email, name, title, role, site_ids, partner_site_ids, password_hash, must_change_password)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
    [a.id, a.companyId, a.email, a.name, a.title, a.role, JSON.stringify(a.siteIds ?? []), JSON.stringify(a.partnerSiteIds ?? []), a.hash, a.mustChange],
  );
}

// ───────────── 사용자 관리 (대표·관리자) ─────────────

export interface MemberView {
  id: string;
  email: string;
  name: string;
  title: string;
  role: RoleId;
  siteIds: string[];
  partnerSiteIds: string[];
  active: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
}

function requireAdmin(m: Member) {
  if (m.role !== "ceo" && m.role !== "manager") throw new ForbiddenError("사용자 관리는 대표·관리자만 할 수 있습니다.");
}

async function bumpRev(tx: Tx, companyId: string) {
  await tx.query(`update companies set rev = rev + 1, updated_at = now() where id = $1`, [companyId]);
}

export async function listMembers(m: Member): Promise<MemberView[]> {
  requireAdmin(m);
  const db = await getDb();
  const rows = await db.query<Parameters<typeof toMember>[0] & { locked_until: string | Date | null }>(
    `select ${MEMBER_COLS}, locked_until from members where company_id = $1 order by active desc, role, name`,
    [m.companyId],
  );
  return rows.map((r) => {
    const x = toMember(r);
    return { ...x, lockedUntil: r.locked_until && new Date(r.locked_until).getTime() > Date.now() ? new Date(r.locked_until).toISOString() : null };
  });
}

const ROLES: RoleId[] = ["ceo", "manager", "field", "partner"];

export interface MemberInput {
  email?: string;
  name?: string;
  title?: string;
  role?: RoleId;
  siteIds?: string[];
  partnerSiteIds?: string[];
  active?: boolean;
  /** 신규 생성 시 초기 비밀번호 / 수정 시 비밀번호 초기화 */
  password?: string;
}

function validateMemberInput(input: MemberInput, creating: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (creating || input.email !== undefined) if (!normalizeEmail(input.email)) errors.email = "이메일 형식을 확인해주세요.";
  if (creating || input.name !== undefined) if (!input.name?.trim() || input.name.length > 40) errors.name = "이름 (40자 이내)";
  if (input.title !== undefined && input.title.length > 40) errors.title = "40자 이내";
  if (creating || input.role !== undefined) if (!ROLES.includes(input.role as RoleId)) errors.role = "역할을 선택해주세요.";
  if (creating || input.password !== undefined) {
    const p = passwordProblem(input.password);
    if (p) errors.password = p;
  }
  const arr = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string") && v.length <= 200);
  if (!arr(input.siteIds)) errors.siteIds = "담당 현장 형식";
  if (!arr(input.partnerSiteIds)) errors.partnerSiteIds = "포털 현장 형식";
  return errors;
}

export async function createMember(m: Member, input: MemberInput): Promise<MemberView> {
  requireAdmin(m);
  const errors = validateMemberInput(input, true);
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  if (input.role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 권한은 대표만 부여할 수 있습니다.");
  const db = await getDb();
  const id = uid("u");
  await db.transaction(async (tx) => {
    const [dup] = await tx.query(`select id from members where email = $1`, [normalizeEmail(input.email)]);
    if (dup) throw new CommandError("이미 등록된 이메일입니다.", "DUPLICATE", { email: "이미 사용 중" });
    await insertMember(tx, {
      id,
      companyId: m.companyId,
      email: normalizeEmail(input.email)!,
      name: input.name!.trim(),
      title: input.title?.trim() ?? "",
      role: input.role!,
      hash: await hashPassword(input.password!),
      mustChange: true,
      siteIds: input.siteIds,
      partnerSiteIds: input.partnerSiteIds,
    });
    await bumpRev(tx, m.companyId);
  });
  return (await listMembers(m)).find((x) => x.id === id)!;
}

export async function updateMember(m: Member, id: string, input: MemberInput): Promise<MemberView> {
  requireAdmin(m);
  const errors = validateMemberInput(input, false);
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.query<Parameters<typeof toMember>[0]>(`select ${MEMBER_COLS} from members where id = $1 and company_id = $2 for update`, [id, m.companyId]);
    if (!row) throw new CommandError("사용자를 찾을 수 없습니다.", "NOT_FOUND");
    const target = toMember(row);
    if (target.role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 계정은 대표만 바꿀 수 있습니다.");
    if (input.role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 권한은 대표만 부여할 수 있습니다.");
    if (id === m.id && (input.active === false || (input.role && input.role !== m.role))) throw new ForbiddenError("본인 계정의 역할 변경·비활성화는 할 수 없습니다.");
    if (target.role === "ceo" && (input.active === false || (input.role && input.role !== "ceo"))) {
      const [c] = await tx.query<{ n: string | number }>(`select count(*) as n from members where company_id = $1 and role = 'ceo' and active = true and id <> $2`, [m.companyId, id]);
      if (Number(c?.n ?? 0) === 0) throw new ForbiddenError("활성 대표 계정이 최소 1개는 있어야 합니다.");
    }
    if (input.email !== undefined) {
      const [dup] = await tx.query(`select id from members where email = $1 and id <> $2`, [normalizeEmail(input.email), id]);
      if (dup) throw new CommandError("이미 등록된 이메일입니다.", "DUPLICATE", { email: "이미 사용 중" });
    }
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const set = (col: string, v: unknown, cast = "") => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}${cast}`);
    };
    if (input.email !== undefined) set("email", normalizeEmail(input.email));
    if (input.name !== undefined) set("name", input.name.trim());
    if (input.title !== undefined) set("title", input.title.trim());
    if (input.role !== undefined) set("role", input.role);
    if (input.siteIds !== undefined) set("site_ids", JSON.stringify(input.siteIds), "::jsonb");
    if (input.partnerSiteIds !== undefined) set("partner_site_ids", JSON.stringify(input.partnerSiteIds), "::jsonb");
    if (input.active !== undefined) set("active", input.active);
    if (input.password !== undefined) {
      set("password_hash", await hashPassword(input.password));
      set("must_change_password", true);
      set("failed_logins", 0);
      sets.push("locked_until = null");
    }
    if (!sets.length) return;
    sets.push("updated_at = now()");
    await tx.query(`update members set ${sets.join(", ")} where id = $1`, vals);
    // 비활성화·비밀번호 초기화·역할 변경 시 기존 로그인 세션을 끊는다
    if (input.active === false || input.password !== undefined || input.role !== undefined) {
      await tx.query(`delete from sessions where member_id = $1`, [id]);
    }
    await bumpRev(tx, m.companyId);
  });
  return (await listMembers(m)).find((x) => x.id === id)!;
}
