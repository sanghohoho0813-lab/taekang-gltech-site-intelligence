/**
 * LIVE 서비스 — 명령 실행·데이터 조회·최초 설정·사용자 관리.
 * 모든 쓰기는 회사 단위 잠금(select ... for update) 안에서: 최신 데이터 로드 → 권한 검사 → 순수 명령 실행 → 차이 저장.
 */
import { pairHash, pairKiosk } from "@/lib/data/attendanceCommands";
import { hex, randomBytes } from "@/lib/domain/hmac";
import type { ActivityLog, DemoDB, RoleId } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { AUDIT_LIMIT, auditRange, type AuditFilter } from "@/lib/domain/audit";
import { COMMANDS, isCommandName, type CommandName } from "@/lib/data/registry";
import { CommandError } from "@/lib/data/commands";
import { applyLocationRetention } from "@/lib/data/privacyCommands";
import { recordError } from "./errors";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { createSeed } from "@/lib/data/seed";
import { uid } from "@/lib/domain/ids";
import { getDb, type Tx } from "./sql";
import { deliver } from "./push";
import { noticesFor } from "@/lib/domain/notify";
import { loadState, persistState } from "./state";
import { authorize, fieldSiteIds, ForbiddenError, sanitizeResult, viewFor } from "./authz";
import { createSession, hashPassword, MEMBER_COLS, normalizeEmail, passwordProblem, toMember, type Member } from "./auth";

export async function getView(m: Member): Promise<{ rev: number; db: DemoDB }> {
  const db = await getDb();
  const state = await db.transaction((tx) => loadState(tx, m.companyId));
  return { rev: state.rev, db: viewFor(m, state) };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 활동 이력 조회 (대표·관리자) — 화면 데이터에는 최근 300건만 실리므로, 오래된 이력은 DB에서 조건으로 찾는다.
 * 이력은 지워지지 않는다 (추가만).
 */
export async function listActivity(m: Member, f: AuditFilter): Promise<{ logs: ActivityLog[]; truncated: boolean }> {
  requireAdmin(m);
  const real = (d: unknown) => {
    if (!DATE_RE.test(String(d))) return false;
    const t = Date.parse(`${d}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
  };
  if (!real(f.from) || !real(f.to) || f.from > f.to) throw new CommandError("기간을 확인해주세요.", "VALIDATION");
  const { fromIso, toIso } = auditRange(f);
  const params: unknown[] = [m.companyId, fromIso, toIso];
  const where = ["company_id = $1", "collection = 'activityLogs'", "data->>'at' >= $2", "data->>'at' <= $3"];
  const add = (expr: (n: string) => string, v: unknown) => {
    params.push(v);
    where.push(expr("$" + params.length));
  };
  if (f.siteId) add((n) => `data->>'siteId' = ${n}`, String(f.siteId).slice(0, 80));
  if (f.userId) add((n) => `data->>'by' = ${n}`, String(f.userId).slice(0, 80));
  if (f.type) add((n) => `data->>'type' = ${n}`, String(f.type).slice(0, 40));
  if (f.q?.trim()) add((n) => `position(lower(${n}) in lower(data->>'summary')) > 0`, f.q.trim().slice(0, 60));
  const db = await getDb();
  const rows = await db.query<{ data: ActivityLog | string }>(`select data from records where ${where.join(" and ")} order by data->>'at' desc limit ${AUDIT_LIMIT + 1}`, params);
  const logs = rows.map((r) => (typeof r.data === "string" ? (JSON.parse(r.data) as ActivityLog) : r.data));
  return { logs: logs.slice(0, AUDIT_LIMIT), truncated: logs.length > AUDIT_LIMIT };
}

/**
 * 전체 자료 백업 (대표 전용, 계약 4단계 인수인계) — 회사 데이터를 고객이 직접 보관할 수 있게 JSON으로 내려준다.
 * 비밀번호 해시·세션·QR 단말기 비밀값·중복 방지 키는 넣지 않는다. 사진 원본은 크기 때문에 제외(주소만) — DB 백업으로 보관.
 */
export async function exportCompany(m: Member): Promise<{ filename: string; body: string }> {
  if (m.role !== "ceo") throw new ForbiddenError("전체 자료 백업은 대표만 내려받을 수 있습니다.");
  const db = await getDb();
  const state = await db.transaction((tx) => loadState(tx, m.companyId));
  const members = await db.query<Parameters<typeof toMember>[0]>(`select ${MEMBER_COLS} from members where company_id = $1 order by role, name`, [m.companyId]);
  const kiosks = (state.kiosks ?? []).map((k) => {
    const { secret: _s, pairHash: _p, ...rest } = k;
    void _s;
    void _p;
    return rest;
  });
  const exportedAt = new Date().toISOString();
  // 활동 이력은 화면 데이터에 최근 300건만 실리므로, 백업에는 DB의 전체 이력을 넣는다 (D-41)
  const logRows = await db.query<{ data: unknown }>(`select data from records where company_id = $1 and collection = 'activityLogs' order by seq desc`, [m.companyId]);
  const activityLogs = logRows.map((r) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data));
  const data = { ...state, activityLogs, kiosks, idempotencyKeys: [], me: undefined, scope: undefined };
  const body = JSON.stringify(
    {
      format: "taekang-site-intelligence-backup",
      version: 1,
      exportedAt,
      companyId: m.companyId,
      exportedBy: m.id,
      note: "사진 원본은 포함되지 않습니다(사진 주소만). 사진까지 보관하려면 DB 전체 백업을 함께 보관하세요. 비밀번호·로그인 정보는 포함되지 않습니다.",
      members: members.map((r) => {
        const x = toMember(r);
        return { id: x.id, email: x.email, name: x.name, title: x.title, role: x.role, siteIds: x.siteIds, partnerSiteIds: x.partnerSiteIds, active: x.active };
      }),
      counts: Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])),
      data,
    },
    null,
    1,
  );
  const stamp = exportedAt.slice(0, 10).replace(/-/g, "");
  return { filename: `taekang_backup_${stamp}.json`, body };
}

export async function currentRev(companyId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.query<{ rev: string | number }>(`select rev from companies where id = $1`, [companyId]);
  return Number(row?.rev ?? 0);
}

export async function executeCommand(m: Member, name: unknown, args: unknown): Promise<{ result: unknown; rev: number; db: DemoDB }> {
  if (!isCommandName(name)) throw new CommandError("알 수 없는 요청입니다.");
  const db = await getDb();
  // 명령 안에서 난 예상 못 한 오류 — 사용자에게는 형식 오류로 알리고, 오류 기록에는 원래 오류를 남긴다 (D-47)
  let unexpected: unknown = null;
  let done: { response: { result: unknown; rev: number; db: DemoDB }; notices: Awaited<ReturnType<typeof noticesFor>> };
  try {
    done = await db.transaction(async (tx) => {
      await tx.query(`select rev from companies where id = $1 for update`, [m.companyId]);
      const loaded = await loadState(tx, m.companyId);
      const now = new Date();
      // 하루 한 번: 보관 기간이 지난 위치 좌표를 지운다 (명령과 같은 트랜잭션 — 명령이 실패하면 함께 되돌아감 · D-43)
      const state = applyLocationRetention(loaded, now);
      const safeArgs = authorize(m, name, args, state, now);
      const fn = COMMANDS[name as CommandName] as unknown as (d: DemoDB, a: unknown, c: { userId: string; now: Date }) => { db: DemoDB; result: unknown };
      let out: { db: DemoDB; result: unknown };
      try {
        out = fn(state, safeArgs, { userId: m.id, now });
      } catch (e) {
        if (e instanceof CommandError || e instanceof ForbiddenError) throw e;
        // 형식이 맞지 않는 입력으로 명령 내부에서 난 오류는 사용자에게는 형식 오류로
        console.error("[command]", name, e);
        unexpected = e;
        throw new CommandError("요청 형식이 올바르지 않습니다.");
      }
      // 알림 대상은 저장 전에 계산 (실행 전·후 비교)
      const notices = noticesFor(state, out.db, m.id);
      await persistState(tx, m.companyId, loaded, out.db);
      return { response: { result: sanitizeResult(m, out.result), rev: out.db.rev, db: viewFor(m, out.db) }, notices };
    });
  } catch (e) {
    const bug = unexpected ?? (e instanceof CommandError || e instanceof ForbiddenError ? null : e);
    if (bug) await recordError(m, { source: "server", route: `명령 ${name}`, message: bug instanceof Error ? bug.message : String(bug), stack: bug instanceof Error ? bug.stack : undefined }).catch(() => {});
    throw e;
  }
  const { response, notices } = done;
  // 저장이 끝난 뒤에 알림 — 실패해도 명령 결과에는 영향 없음
  if (notices.length) await deliver(m.companyId, notices).catch((e) => console.error("[push]", e));
  return response;
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
      ? {
          ...seed,
          company: { ...seed.company, name: input.companyName.trim() },
          settings: { ...DEFAULT_SETTINGS, sampleData: true },
          // 가상 단말기 비밀값은 소스에 공개된 DEMO 값 → 운영 서버에서는 새로 만든다
          kiosks: (seed.kiosks ?? []).map((k) => ({ ...k, secret: hex(randomBytes(32)) })),
        }
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
          attendance: [],
          consents: [],
          kiosks: [],
          crewChecks: [],
          attendanceRequests: [],
          workOrders: [],
          importBatches: [],
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
  /** 로그인된 기기 수 (만료 전 세션) · 마지막 사용 시각 (D-48) */
  devices: number;
  lastSeenAt: string | null;
}

function requireAdmin(m: Member) {
  if (m.role !== "ceo" && m.role !== "manager") throw new ForbiddenError("사용자 관리는 대표·관리자만 할 수 있습니다.");
}

async function bumpRev(tx: Tx, companyId: string) {
  await tx.query(`update companies set rev = rev + 1, updated_at = now() where id = $1`, [companyId]);
}

/** 사용자 관리(명령 밖) 변경을 활동 이력에 남긴다 — 누가 비밀번호를 초기화·로그아웃시켰는지 (D-48) */
async function appendActivity(tx: Tx, companyId: string, by: string, summary: string) {
  const log = { id: uid("log"), at: new Date().toISOString(), by, type: "member", summary, link: "/admin?tab=members" };
  await tx.query(`insert into records (company_id, collection, id, site_id, data) values ($1, 'activityLogs', $2, null, $3::jsonb)`, [companyId, log.id, JSON.stringify(log)]);
}

export async function listMembers(m: Member): Promise<MemberView[]> {
  requireAdmin(m);
  const db = await getDb();
  const rows = await db.query<Parameters<typeof toMember>[0] & { locked_until: string | Date | null; devices: number; last_seen: string | Date | null }>(
    `select ${MEMBER_COLS}, locked_until,
       (select count(*)::int from sessions s where s.member_id = members.id and s.expires_at > now()) as devices,
       (select max(s.last_seen_at) from sessions s where s.member_id = members.id) as last_seen
     from members where company_id = $1 order by active desc, role, name`,
    [m.companyId],
  );
  return rows.map((r) => {
    const x = toMember(r);
    return {
      ...x,
      lockedUntil: r.locked_until && new Date(r.locked_until).getTime() > Date.now() ? new Date(r.locked_until).toISOString() : null,
      devices: Number(r.devices ?? 0),
      lastSeenAt: r.last_seen ? new Date(r.last_seen).toISOString() : null,
    };
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
  if (creating || input.name !== undefined) if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 40) errors.name = "이름 (40자 이내)";
  if (input.title !== undefined && (typeof input.title !== "string" || input.title.length > 40)) errors.title = "40자 이내";
  // ‘비활성화’ 판단이 문자열 "false"로 우회되지 않게
  if (input.active !== undefined && typeof input.active !== "boolean") errors.active = "활성 여부 형식";
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
    await appendActivity(tx, m.companyId, m.id, `사용자 추가 — ${input.name!.trim()} (${ROLE_LABEL[input.role!]})`);
    await bumpRev(tx, m.companyId);
  });
  return (await listMembers(m)).find((x) => x.id === id)!;
}

/** 이 사람의 모든 기기에서 로그아웃 + 휴대폰 알림 해제 — 휴대폰 분실·퇴사 직후 (D-48) */
export async function signOutMember(m: Member, id: string): Promise<{ devices: number }> {
  requireAdmin(m);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.query<Parameters<typeof toMember>[0]>(`select ${MEMBER_COLS} from members where id = $1 and company_id = $2`, [id, m.companyId]);
    if (!row) throw new CommandError("사용자를 찾을 수 없습니다.", "NOT_FOUND");
    const target = toMember(row);
    if (target.role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 계정은 대표만 로그아웃시킬 수 있습니다.");
    const [c] = await tx.query<{ n: number }>(`select count(*)::int as n from sessions where member_id = $1 and expires_at > now()`, [id]);
    await tx.query(`delete from sessions where member_id = $1`, [id]);
    await tx.query(`delete from records where company_id = $1 and collection = 'pushSubscriptions' and data->>'userId' = $2`, [m.companyId, id]);
    await appendActivity(tx, m.companyId, m.id, `모든 기기 로그아웃 — ${target.name} (기기 ${Number(c?.n ?? 0)}대, 휴대폰 알림 해제)`);
    await bumpRev(tx, m.companyId);
    return { devices: Number(c?.n ?? 0) };
  });
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
    const what = [
      input.password !== undefined && "비밀번호 초기화 (첫 로그인 때 본인이 변경)",
      input.active === false && target.active && "비활성화 (로그인 종료·휴대폰 알림 해제)",
      input.active === true && !target.active && "다시 활성화",
      input.role !== undefined && input.role !== target.role && `역할 ${ROLE_LABEL[target.role]} → ${ROLE_LABEL[input.role]}`,
      (input.siteIds !== undefined || input.partnerSiteIds !== undefined) && "담당 현장 변경",
      (input.name !== undefined || input.title !== undefined || input.email !== undefined) && "정보 수정",
    ].filter(Boolean);
    if (what.length) await appendActivity(tx, m.companyId, m.id, `사용자 변경 — ${target.name}: ${what.join(", ")}`);
    // 비활성화·비밀번호 초기화·역할 변경 시 기존 로그인 세션을 끊는다
    if (input.active === false || input.password !== undefined || input.role !== undefined) {
      await tx.query(`delete from sessions where member_id = $1`, [id]);
    }
    // 비활성화·역할 변경 시 휴대폰 알림 구독도 지운다 (퇴사자 휴대폰에 회사 알림이 가지 않게)
    if (input.active === false || input.role !== undefined) {
      await tx.query(`delete from records where company_id = $1 and collection = 'pushSubscriptions' and data->>'userId' = $2`, [m.companyId, id]);
    }
    await bumpRev(tx, m.companyId);
  });
  return (await listMembers(m)).find((x) => x.id === id)!;
}

// ───────────── 현장 QR 단말기 (로그인하지 않은 태블릿) ─────────────

/** 연결 코드로 태블릿 연결 → 비밀값 1회 전달 */
export async function pairKioskByCode(code: unknown): Promise<Record<string, unknown>> {
  if (typeof code !== "string" || code.length > 40) throw new CommandError("연결 코드를 확인해주세요.");
  const db = await getDb();
  const [row] = await db.query<{ company_id: string }>(`select company_id from records where collection = 'kiosks' and data->>'pairHash' = $1 limit 1`, [pairHash(code)]);
  if (!row) throw new CommandError("연결 코드가 맞지 않거나 만료되었습니다. 본사에서 새 코드를 받아 주세요.", "NOT_FOUND");
  return db.transaction(async (tx) => {
    await tx.query(`select rev from companies where id = $1 for update`, [row.company_id]);
    const state = await loadState(tx, row.company_id);
    const out = pairKiosk(state, { code }, { userId: "system", now: new Date() });
    await persistState(tx, row.company_id, state, out.db);
    return { ...out.result, serverNow: Date.now() };
  });
}

/** 태블릿이 주기적으로 확인 — 해제됐는지 + 서버 시각 (태블릿 시계 오차 보정) */
export async function kioskStatus(id: unknown): Promise<{ active: boolean; now: number }> {
  const now = Date.now();
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{3,64}$/.test(id)) return { active: false, now };
  const db = await getDb();
  const [row] = await db.query<{ revoked: string | null; paired: string | null }>(`select data->>'revokedAt' as revoked, data->>'pairedAt' as paired from records where collection = 'kiosks' and id = $1 limit 1`, [id]);
  return { active: !!row && !row.revoked && !!row.paired, now };
}
