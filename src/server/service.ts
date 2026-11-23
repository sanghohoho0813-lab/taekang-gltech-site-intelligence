/**
 * LIVE 서비스 — 명령 실행·데이터 조회·최초 설정·사용자 관리.
 * 모든 쓰기는 회사 단위 잠금(select ... for update) 안에서: 최신 데이터 로드 → 권한 검사 → 순수 명령 실행 → 차이 저장.
 */
import { pairHash, pairKiosk } from "@/lib/data/attendanceCommands";
import { hex, randomBytes } from "@/lib/domain/hmac";
import type { ActivityLog, DemoDB, RoleId } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/types";
import { normalizeOfficePhone, normalizePhone } from "@/lib/domain/intake";
import { AUDIT_LIMIT, auditRange, type AuditFilter } from "@/lib/domain/audit";
import { COMMANDS, isCommandName, type CommandName } from "@/lib/data/registry";
import { CommandError } from "@/lib/data/commands";
import { applyLocationRetention } from "@/lib/data/privacyCommands";
import { applyShareRetention } from "@/lib/data/shareCommands";
import { applyIntakeRetention } from "@/lib/data/intakeCommands";
import { runDailyChecks } from "@/lib/data/dailyJobs";
import { recordError } from "./errors";
import { MISSING_PHOTO } from "./missingPhoto";
import { cachedEntry, cachedState, rememberState } from "./stateCache";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { createSeed } from "@/lib/data/seed";
import { uid } from "@/lib/domain/ids";
import { getDb, type Tx } from "./sql";
import { createAppVapid, deliver, hasEnvVapid, pushReadyFor, vapidFor, vapidSubject } from "./push";
import { noticesFor, type Notice } from "@/lib/domain/notify";
import { COLLECTIONS, loadState, persistState } from "./state";
import { authorize, fieldSiteIds, ForbiddenError, sanitizeResult, viewFor } from "./authz";
import { photoWithdrawn } from "@/lib/domain/partnerFeed";
import { canApprove, createSession, hashPassword, MEMBER_COLS, normalizeEmail, passwordProblem, toMember, type Member, type SignupStatus } from "./auth";

export async function getView(m: Member): Promise<{ rev: number; db: DemoDB }> {
  const db = await getDb();
  // 같은 rev를 이미 읽어 두었으면 다시 읽지 않는다 (D-50). 새로 읽을 때는 한 시점 기준(repeatable read)으로 읽어 기억한다
  const rev = await currentRev(m.companyId);
  let loaded = cachedState(m.companyId, rev);
  if (!loaded) {
    loaded = await db.transaction(async (tx) => {
      await tx.query("set transaction isolation level repeatable read");
      return loadState(tx, m.companyId);
    });
    rememberState(m.companyId, loaded);
  }
  // 명령이 없는 날(주말 등)에도 보관 기간이 지난 좌표·접수자 연락처는 보내지 않는다 — 저장은 다음 명령 때 (rev는 DB 값 그대로 · D-49 · D-74 점검 10차)
  const at = new Date();
  const state = applyIntakeRetention(applyLocationRetention(loaded, at), at);
  const view = viewFor(m, state);
  // 가입 승인 대기 수 (D-90) — 본사 화면의 메뉴·처리 대기에. 승인 권한이 있는 사람에게만 숫자를 준다
  if (canApprove(m)) {
    const [c] = await db.query<{ n: number }>(`select count(*)::int as n from members where company_id = $1 and signup_status = 'pending'`, [m.companyId]);
    view.signup = { pending: Number(c?.n ?? 0), canApprove: true };
  } else if (m.role === "manager") view.signup = { pending: 0, canApprove: false };
  return { rev: loaded.rev, db: view };
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
  // 백업에도 보관 기간이 지난 좌표·접수자 연락처는 넣지 않는다 (D-49 · D-74 점검 10차)
  const now = new Date();
  const retained = applyIntakeRetention(applyLocationRetention(await db.transaction((tx) => loadState(tx, m.companyId)), now), now);
  // 하자 접수의 진행 확인 주소(비밀값·해시)와 내부 표시는 백업에 넣지 않는다 — 백업 파일로 진행 확인 화면을 열 수 없게
  const state = {
    ...retained,
    partnerRequests: retained.partnerRequests.map(({ statusKey: _k, statusToken: _t, intakeKey: _i, intakeSrc: _s, ...r }) => (void _k, void _t, void _i, void _s, r)),
  };
  // 가입 신청(승인 대기·승인 안 함)은 백업에 넣지 않는다 — 회사 사람이 아니고 개인정보라서 (D-90)
  const members = await db.query<Parameters<typeof toMember>[0]>(`select ${MEMBER_COLS} from members where company_id = $1 and (signup_status is null or signup_status = 'approved') order by role, name`, [m.companyId]);
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
      note: "사진 원본은 포함되지 않습니다(사진 기록·지문만) — ‘사진 백업 내려받기’(달마다 .zip)로 함께 보관하세요. 비밀번호·로그인 정보는 포함되지 않습니다. 새 시스템 첫 화면의 ‘백업 파일로 시작’으로 되살립니다.",
      members: members.map((r) => {
        const x = toMember(r);
        return { id: x.id, email: x.email, name: x.name, title: x.title, role: x.role, siteIds: x.siteIds, partnerSiteIds: x.partnerSiteIds, active: x.active, ...(x.approver ? { approver: true } : {}) };
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
  let done: { response: { result: unknown; rev: number; db: DemoDB }; notices: Awaited<ReturnType<typeof noticesFor>>; saved: DemoDB; loadedAt: number };
  try {
    done = await db.transaction(async (tx) => {
      const [lock] = await tx.query<{ rev: string | number }>(`select rev from companies where id = $1 for update`, [m.companyId]);
      // 회사 잠금을 잡은 뒤의 rev가 기억한 것과 같으면 1년치를 다시 읽지 않는다 (D-50)
      const hit = cachedEntry(m.companyId, Number(lock?.rev));
      const loadedAt = hit?.loadedAt ?? Date.now();
      const loaded = hit?.db ?? (await loadState(tx, m.companyId));
      const now = new Date();
      // 하루 한 번: 보관 기간이 지난 위치 좌표를 지운다 (명령과 같은 트랜잭션 — 명령이 실패하면 함께 되돌아감 · D-43)
      // 기한이 지난 보고서 링크의 내용도 함께 지운다 — 매일 점검(예약 작업)이 안 도는 배포에서도 남지 않게 (D-73 점검 9차)
      // 처리 끝난 지 90일이 지난 링크 접수의 이름·연락처도 지운다 (D-74)
      const state = applyIntakeRetention(applyShareRetention(applyLocationRetention(loaded, now), now), now);
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
      return { response: { result: sanitizeResult(m, out.result), rev: out.db.rev, db: viewFor(m, out.db) }, notices, saved: out.db, loadedAt };
    });
  } catch (e) {
    const bug = unexpected ?? (e instanceof CommandError || e instanceof ForbiddenError ? null : e);
    if (bug) await recordError(m, { source: "server", route: `명령 ${name}`, message: bug instanceof Error ? bug.message : String(bug), stack: bug instanceof Error ? bug.stack : undefined }).catch(() => {});
    throw e;
  }
  const { response, notices } = done;
  // 커밋된 뒤에만 기억한다 (다음 명령이 DB에서 다시 읽지 않게)
  rememberState(m.companyId, done.saved, done.loadedAt);
  // 저장이 끝난 뒤에 알림 — 실패해도 명령 결과에는 영향 없음
  if (notices.length) await deliver(m.companyId, notices).catch((e) => console.error("[push]", e));
  return response;
}

// ───────────── 매일 점검 (서버 예약 작업 · D-71) ─────────────

/**
 * 회사마다: 보관 기간이 지난 위치 좌표 지우기 + 하자보증 만료 알림. 한 회사가 실패해도 다음 회사는 계속한다.
 * 돌려주는 값은 숫자만 (회사 이름·현장 이름 없음 — 예약 작업 기록에 남으므로)
 */
export async function runDailyJobs(now = new Date()): Promise<{ companies: number; changed: number; warrantyNotices: number; briefs: number; pushed: number; failed: number }> {
  const db = await getDb();
  const companies = await db.query<{ id: string }>(`select id from companies order by id`);
  let changed = 0;
  let warrantyNotices = 0;
  let briefs = 0;
  let pushed = 0;
  let failed = 0;
  // 오래된 가입 신청(승인 안 함 30일 · 처리 안 됨 60일) 지우기 (D-90)
  await purgeSignups(now).catch((e) => (failed += 1, console.error("[daily signup purge]", e)));
  for (const { id } of companies) {
    try {
      // 알림 키(환경변수 또는 대표가 켠 키)가 있는 회사만 알림이 생기는 점검을 돌린다 (D-91)
      const ready = await pushReadyFor(id);
      const done = await db.transaction(async (tx) => {
        await tx.query(`select rev from companies where id = $1 for update`, [id]);
        const loaded = await loadState(tx, id);
        // 닫히거나 기한이 지난 보고서 링크의 내용·오래된 기록도 함께 지운다 (D-73)
        const retained = applyIntakeRetention(applyShareRetention(applyLocationRetention(loaded, now), now), now);
        // 알림 키가 없으면 하자보증 만료 알림은 건너뛴다 (‘보낸 알림’으로 남지 않게) — 위치 좌표 정리는 그대로
        const out = ready ? runDailyChecks(retained, now) : { db: retained, notices: [], warranty: [], brief: { hq: 0, field: 0 }, changed: false };
        if (out.db === loaded) return null;
        await persistState(tx, id, loaded, out.db);
        return out;
      });
      if (!done) continue;
      changed += 1;
      warrantyNotices += done.warranty.length;
      briefs += done.brief.hq + done.brief.field;
      if (done.notices.length) pushed += (await deliver(id, done.notices).catch((e) => (console.error("[push]", e), { sent: 0 }))).sent;
    } catch (e) {
      failed += 1;
      console.error("[daily]", e);
    }
  }
  return { companies: companies.length, changed, warrantyNotices, briefs, pushed, failed };
}

// ───────────── 회사 휴대폰 알림 켜기 (D-91) ─────────────

export interface PushStatus {
  /** 회사 알림 키가 있어 알림을 보낼 수 있는가 */
  enabled: boolean;
  /** env = Vercel 환경변수 · app = 운영 설정에서 켬 */
  source: "env" | "app" | null;
  /** 휴대폰이 구독할 때 쓰는 공개 키 (비밀 아님) */
  publicKey: string | null;
  /** 이 사람이 회사 알림을 켤 수 있는가 (대표 권한) */
  canEnable: boolean;
}

export async function companyPushStatus(m: Member): Promise<PushStatus> {
  const v = await vapidFor(m.companyId);
  return { enabled: !!v, source: v?.source ?? null, publicKey: v?.publicKey ?? null, canEnable: m.role === "ceo" };
}

/**
 * 대표가 운영 설정에서 ‘휴대폰 알림 켜기’ — 서버가 알림 키를 만들어 DB에 보관한다. Vercel 환경변수를 손대지 않아도 된다.
 * 환경변수 키가 있으면 그것을 쓰므로 아무것도 만들지 않는다. 이미 켰으면 그대로(키가 바뀌면 모든 휴대폰이 다시 켜야 하므로 덮어쓰지 않음).
 */
export async function enableCompanyPush(m: Member, origin?: string | null): Promise<PushStatus & { created: boolean }> {
  if (m.role !== "ceo") throw new ForbiddenError("회사 휴대폰 알림은 대표 권한으로만 켤 수 있습니다.");
  let created = false;
  if (!hasEnvVapid()) {
    const db = await getDb();
    created = await db.transaction(async (tx) => {
      await tx.query(`select rev from companies where id = $1 for update`, [m.companyId]);
      const made = await createAppVapid(tx, m.companyId, m.id, vapidSubject(origin));
      if (made) await appendActivity(tx, m.companyId, m.id, "회사 휴대폰 알림을 켰습니다 (서버가 알림 키를 만들어 보관)", "/admin?tab=settings");
      return made;
    });
  }
  return { ...(await companyPushStatus(m)), created };
}

// ───────────── 사진 ─────────────

export async function getPhoto(m: Member, id: string): Promise<{ mime: string; data: Uint8Array; missing?: true; fileName?: string } | null> {
  const db = await getDb();
  if (m.role === "partner") {
    // 발주처는 본사가 공개한 본인 현장 사진만 (D-67) — 취소한 보고·자재 기록의 사진은 빼고. 같은 rev면 기억해 둔 데이터를 쓴다(사진마다 회사 전체를 다시 읽지 않게)
    const rev = await currentRev(m.companyId);
    const state = cachedState(m.companyId, rev) ?? (await db.transaction((tx) => loadState(tx, m.companyId)));
    const p = state.photos.find((x) => x.id === id);
    if (!p || !m.partnerSiteIds.includes(p.siteId)) return null;
    // 본인이 하자보수 요청에 첨부한 사진은 본인이 다시 볼 수 있다 (D-68)
    const own = !!p.partnerRequestId && state.partnerRequests.some((r) => r.id === p.partnerRequestId && r.partnerUserId === m.id);
    if (!own && (!p.shared || photoWithdrawn(state, p))) return null;
    // 다른 발주처의 하자보수 회신 사진은 주지 않는다
    const reply = state.partnerRequests.find((r) => r.replyPhotoIds?.includes(p.id));
    if (reply && reply.partnerUserId !== m.id) return null;
  }
  const [row] = await db.query<{ mime: string; data: Uint8Array; site_id: string | null }>(
    `select mime, data, site_id from photo_blobs where id = $1 and company_id = $2`,
    [id, m.companyId],
  );
  // 현장·발주처에게는 PDF(변경공사 증빙만 PDF)를 어떤 길로도 주지 않는다 (D-88 점검 — 기록이 꼬여도)
  if (m.role !== "ceo" && m.role !== "manager" && row?.mime === "application/pdf") return null;
  if (m.role === "field") {
    const state = await db.transaction((tx) => loadState(tx, m.companyId));
    const p = state.photos.find((x) => x.id === id);
    // 사진 기록이 있는 원본만 — 같은 저장소의 변경공사 증빙 파일(D-88)은 현장 현장이어도 주지 않는다
    if (!p) return null;
    // 원본이 없으면(백업 복원 뒤) 사진 기록의 현장으로 권한을 본다 (D-86)
    const siteId = row ? row.site_id : p.siteId;
    if (!siteId || !fieldSiteIds(m, state).has(siteId)) return null;
    // 발주처·접수자가 올린 하자 사진은 본인에게 온 작업지시에 붙은 것만 (D-74 점검 10차)
    if (p?.partnerRequestId && !(state.workOrders ?? []).some((w) => w.assigneeUserId === m.id && (w.refPhotoIds ?? []).includes(id))) return null;
    if (!row) return MISSING_PHOTO;
  }
  if (!row) {
    // 백업 파일로 복원한 뒤 사진 백업을 아직 올리지 않은 사진 — 기록이 있으면 ‘사진 원본 없음’ 그림 (D-86). 발주처 권한은 위에서 확인
    // 회사 전체를 읽지 않고 그 사진 기록 한 줄만 본다 (사진마다 다시 읽지 않게 · 점검 반영). 증빙 파일(D-88)은 본사만 여기까지 온다
    const [rec] = await db.query<{ id: string }>(`select id from records where company_id = $1 and collection = any($3::text[]) and id = $2`, [m.companyId, id, m.role === "partner" ? ["photos"] : ["photos", "coEvidence"]]);
    return rec ? MISSING_PHOTO : null;
  }
  // 증빙 PDF는 올린 파일 이름으로 내려받게 (D-88)
  if (row.mime === "application/pdf") {
    const [rec] = await db.query<{ name: string | null }>(`select data->>'fileName' as name from records where company_id = $1 and collection = 'coEvidence' and id = $2`, [m.companyId, id]);
    return { mime: row.mime, data: row.data, fileName: rec?.name ?? "증빙.pdf" };
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
  /** 회사 전화번호 — 로그인 쪽지·현장 화면·하자 접수 화면의 ‘모르면 본사로 전화’ (D-77) */
  publicPhone?: string;
  /** 첫 계정의 직함 (기본 ‘대표’) — 개발 담당이 먼저 설정할 때 ‘개발자’ 등 (D-90) */
  title?: string;
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
  if (!email) errors.email = typeof input.email === "string" && input.email.trim() ? "이메일 형식을 확인해주세요." : "이메일(로그인 아이디)을 입력해주세요.";
  const pw = passwordProblem(input.password);
  if (pw) errors.password = pw;
  const phoneRaw = typeof input.publicPhone === "string" ? input.publicPhone.trim() : "";
  const publicPhone = phoneRaw ? normalizeOfficePhone(phoneRaw) : null;
  if (phoneRaw && !publicPhone) errors.publicPhone = "전화번호를 확인해 주세요. (예: 031-123-4567)";
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "대표";
  if (Array.from(title).length > 40) errors.title = "40자 이내";
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
          // 위 목록에 없는 새 자료 묶음(앱 의견·자재 기록·휴대폰 점검 등)도 빈 채로 시작 — 시연 자료가 섞여 들어가던 문제 (D-65 점검 반영)
          ...(Object.fromEntries(Object.keys(COLLECTIONS).filter((n) => n !== "sites").map((n) => [n, []])) as Partial<DemoDB>),
          settings: { ...DEFAULT_SETTINGS, ...(publicPhone ? { publicPhone, helpPhone: publicPhone } : {}) },
          rev: 1,
        };
    await tx.query(`insert into companies (id, name, info, rev) values ($1, $2, $3::jsonb, $4)`, [
      companyId,
      state.company.name,
      JSON.stringify({ product: state.company.product, tagline: state.company.tagline }),
      state.rev,
    ]);
    const hash = await hashPassword(input.password);
    await insertMember(tx, { id: ownerId, companyId, email: email!, name: input.name.trim(), title, role: "ceo", hash, mustChange: false });
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

export async function insertMember(
  tx: Tx,
  a: {
    id: string;
    companyId: string;
    email: string;
    name: string;
    title: string;
    role: RoleId;
    hash: string;
    mustChange: boolean;
    siteIds?: string[];
    partnerSiteIds?: string[];
    approver?: boolean;
    /** 회원가입 신청 (D-90) — 승인 전에는 로그인되지 않는다 */
    signup?: SignupInfo;
  },
) {
  await tx.query(
    `insert into members (id, company_id, email, name, title, role, site_ids, partner_site_ids, password_hash, must_change_password, approver, active, signup_status, signup)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb)`,
    [
      a.id,
      a.companyId,
      a.email,
      a.name,
      a.title,
      a.role,
      JSON.stringify(a.siteIds ?? []),
      JSON.stringify(a.partnerSiteIds ?? []),
      a.hash,
      a.mustChange,
      a.approver === true,
      !a.signup,
      a.signup ? "pending" : null,
      a.signup ? JSON.stringify(a.signup) : null,
    ],
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
  /** 가입 승인 담당 (D-90) */
  approver?: boolean;
  /** 회원가입 신청 상태 (D-90) — null: 관리자가 만든 계정 */
  signupStatus: SignupStatus | null;
  signup: SignupInfo | null;
  createdAt: string | null;
}

/** 회원가입 신청 때 적은 것과 처리 기록 (D-90) */
export interface SignupInfo {
  phone: string;
  /** 무슨 일로 쓰는지 — 승인할 때 역할을 고르는 참고 */
  kind: SignupKind;
  /** 소속·현장 등 (선택) */
  note: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decidedByName?: string;
  reason?: string;
}
export type SignupKind = "field" | "manager" | "partner" | "other";
export const SIGNUP_KIND_LABEL: Record<SignupKind, string> = { field: "현장 직원", manager: "본사 직원", partner: "발주처·협력사", other: "그 밖" };
/** 승인 대기로 쌓아 둘 수 있는 신청 수 — 넘으면 새 신청을 받지 않는다 (장난 신청이 쌓이지 않게) */
export const SIGNUP_PENDING_MAX = 30;
/** 승인 안 함 기록은 30일, 처리 안 된 신청은 60일 뒤 지운다 (개인정보 · 매일 점검) */
export const SIGNUP_REJECTED_KEEP_DAYS = 30;
export const SIGNUP_PENDING_KEEP_DAYS = 60;

function requireAdmin(m: Member) {
  if (m.role !== "ceo" && m.role !== "manager") throw new ForbiddenError("사용자 관리는 대표·관리자만 할 수 있습니다.");
}

/** 계정 추가·가입 승인/거절·일시 정지/다시 사용 — 대표 권한 또는 ‘가입 승인 담당’만 (D-90) */
function requireApprover(m: Member) {
  requireAdmin(m);
  if (!canApprove(m)) throw new ForbiddenError("가입 승인·계정 추가·일시 정지는 가입 승인 담당(대표 권한 또는 지정된 본사 담당)만 할 수 있습니다.");
}

async function bumpRev(tx: Tx, companyId: string) {
  await tx.query(`update companies set rev = rev + 1, updated_at = now() where id = $1`, [companyId]);
}

/** 사용자 관리(명령 밖) 변경을 활동 이력에 남긴다 — 누가 비밀번호를 초기화·로그아웃시켰는지 (D-48) */
async function appendActivity(tx: Tx, companyId: string, by: string, summary: string, link = "/admin?tab=members") {
  const log = { id: uid("log"), at: new Date().toISOString(), by, type: "member", summary, link };
  await tx.query(`insert into records (company_id, collection, id, site_id, data) values ($1, 'activityLogs', $2, null, $3::jsonb)`, [companyId, log.id, JSON.stringify(log)]);
}

export async function listMembers(m: Member): Promise<MemberView[]> {
  requireAdmin(m);
  const db = await getDb();
  const rows = await db.query<Parameters<typeof toMember>[0] & { locked_until: string | Date | null; devices: number; last_seen: string | Date | null; signup: SignupInfo | string | null; created_at: string | Date | null }>(
    `select ${MEMBER_COLS}, locked_until, signup, created_at,
       (select count(*)::int from sessions s where s.member_id = members.id and s.expires_at > now()) as devices,
       (select max(s.last_seen_at) from sessions s where s.member_id = members.id) as last_seen
     from members where company_id = $1 order by active desc, role, name`,
    [m.companyId],
  );
  // 승인 대기 신청의 휴대폰 번호는 승인 권한이 있는 사람에게만 (D-90)
  const approver = canApprove(m);
  return rows.map((r) => {
    const x = toMember(r);
    const raw = typeof r.signup === "string" ? (JSON.parse(r.signup) as SignupInfo) : r.signup;
    const signup = raw ? (approver ? raw : { ...raw, phone: "" }) : null;
    return {
      ...x,
      lockedUntil: r.locked_until && new Date(r.locked_until).getTime() > Date.now() ? new Date(r.locked_until).toISOString() : null,
      devices: Number(r.devices ?? 0),
      lastSeenAt: r.last_seen ? new Date(r.last_seen).toISOString() : null,
      signupStatus: (r.signup_status as SignupStatus | null) ?? null,
      signup,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
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
  /** 비밀번호 초기화를 ‘아직 첫 로그인 전’인 사람에게만 (시범 운영 준비의 로그인 쪽지 · 이미 자기 비밀번호를 쓰는 사람을 실수로 초기화하지 않게) */
  onlyIfMustChange?: boolean;
  /** 가입 승인 담당 (D-90) — 대표 권한만 정한다 · 본사관리자에게만 */
  approver?: boolean;
}

function validateMemberInput(input: MemberInput, creating: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (creating || input.email !== undefined) if (!normalizeEmail(input.email)) errors.email = typeof input.email === "string" && input.email.trim() ? "이메일 형식을 확인해주세요." : "로그인 아이디로 쓸 이메일을 입력해주세요. (개인 이메일이 없으면 이름@회사도메인처럼 정해 주세요)";
  if (creating || input.name !== undefined) if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 40) errors.name = "이름 (40자 이내)";
  if (input.title !== undefined && (typeof input.title !== "string" || input.title.length > 40)) errors.title = "40자 이내";
  // ‘비활성화’ 판단이 문자열 "false"로 우회되지 않게
  if (input.active !== undefined && typeof input.active !== "boolean") errors.active = "활성 여부 형식";
  if (input.approver !== undefined && typeof input.approver !== "boolean") errors.approver = "승인 담당 형식";
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
  requireApprover(m);
  const errors = validateMemberInput(input, true);
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  if (input.role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 권한은 대표만 부여할 수 있습니다.");
  approverRule(m, input.approver, input.role!);
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
      approver: input.approver === true,
    });
    await appendActivity(tx, m.companyId, m.id, `사용자 추가 — ${input.name!.trim()} (${ROLE_LABEL[input.role!]}${input.approver ? " · 가입 승인 담당" : ""})`);
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

/** 가입 승인 담당은 대표 권한만 정하고, 본사관리자에게만 줄 수 있다 (대표 권한은 늘 승인 가능) */
function approverRule(m: Member, approver: boolean | undefined, role: RoleId) {
  if (approver === undefined) return;
  if (m.role !== "ceo") throw new ForbiddenError("가입 승인 담당은 대표 권한으로만 정할 수 있습니다.");
  if (approver && role !== "manager") throw new CommandError("가입 승인 담당은 본사관리자에게만 줄 수 있습니다. (대표 권한은 원래 승인할 수 있습니다)", "VALIDATION", { approver: "본사관리자만" });
}

export async function updateMember(m: Member, id: string, input: MemberInput): Promise<MemberView> {
  requireAdmin(m);
  // 일시 정지·다시 사용은 승인 담당만 (D-90)
  if (input.active !== undefined) requireApprover(m);
  const errors = validateMemberInput(input, false);
  if (Object.keys(errors).length) throw new CommandError("입력값을 확인해주세요.", "VALIDATION", errors);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.query<Parameters<typeof toMember>[0]>(`select ${MEMBER_COLS} from members where id = $1 and company_id = $2 for update`, [id, m.companyId]);
    if (!row) throw new CommandError("사용자를 찾을 수 없습니다.", "NOT_FOUND");
    const target = toMember(row);
    if (target.role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 계정은 대표만 바꿀 수 있습니다.");
    if (input.role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 권한은 대표만 부여할 수 있습니다.");
    if (input.password !== undefined && input.onlyIfMustChange === true && !target.mustChangePassword)
      throw new CommandError(`${target.name}님은 이미 첫 로그인을 마쳐 자기 비밀번호를 쓰고 있어 초기화하지 않았습니다.`, "STATE");
    if (id === m.id && (input.active === false || (input.role && input.role !== m.role))) throw new ForbiddenError("본인 계정의 역할 변경·비활성화는 할 수 없습니다.");
    // 가입 신청은 ‘승인’·‘승인 안 함’으로만 처리한다 — 역할·현장을 정하지 않고 그냥 켜지지 않게 (D-90)
    const status = (row as { signup_status?: SignupStatus | null }).signup_status ?? null;
    if ((status === "pending" || status === "rejected") && Object.keys(input).some((k) => k !== "onlyIfMustChange"))
      throw new CommandError("가입 신청은 ‘승인’ 또는 ‘승인 안 함’으로 처리해 주세요.", "STATE");
    approverRule(m, input.approver, input.role ?? target.role);
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
    if (input.approver !== undefined) set("approver", input.approver);
    // 본사관리자가 아닌 역할로 바뀌면 승인 담당도 내려놓는다
    else if (input.role !== undefined && input.role !== "manager" && target.approver) set("approver", false);
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
      input.active === false && target.active && "일시 정지 (로그인 종료·휴대폰 알림 해제)",
      input.active === true && !target.active && "다시 사용",
      input.approver === true && !target.approver && "가입 승인 담당 지정",
      input.approver === false && target.approver && "가입 승인 담당 해제",
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

// ───────────── 회원가입 신청 · 승인 (D-90) ─────────────

export interface SignupRequest {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  phone?: unknown;
  /** 소속·직함 (예: OO건설 공무) */
  title?: unknown;
  kind?: unknown;
  note?: unknown;
  /** 개인정보 수집·이용 동의 */
  agree?: unknown;
}

const SIGNUP_KINDS: SignupKind[] = ["field", "manager", "partner", "other"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max * 2) : "");

/**
 * 로그인 없이 받는 회원가입 신청 — ‘승인 대기’로 저장되고 승인 전에는 로그인되지 않는다.
 * 승인 담당에게 휴대폰 알림(키가 있을 때). 회사가 아직 없으면(최초 설정 전) 받지 않는다.
 */
export async function signUp(input: SignupRequest, now = new Date()): Promise<{ notices: Notice[]; companyId: string }> {
  const errors: Record<string, string> = {};
  const name = text(input?.name, 40);
  if (!name || Array.from(name).length > 40) errors.name = "이름을 넣어 주세요 (40자 이내).";
  const email = normalizeEmail(input?.email);
  if (!email) errors.email = typeof input?.email === "string" && input.email.trim() ? "이메일 형식을 확인해 주세요." : "로그인 아이디로 쓸 이메일을 넣어 주세요.";
  const pw = passwordProblem(input?.password);
  if (pw) errors.password = pw;
  const phone = normalizePhone(input?.phone);
  if (!phone) errors.phone = "휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)";
  const title = text(input?.title, 40);
  if (Array.from(title).length > 40) errors.title = "40자 이내";
  const kind = SIGNUP_KINDS.includes(input?.kind as SignupKind) ? (input.kind as SignupKind) : null;
  if (!kind) errors.kind = "어떤 일로 쓰시는지 골라 주세요.";
  const note = text(input?.note, 200);
  if (Array.from(note).length > 200) errors.note = "200자 이내";
  if (input?.agree !== true) errors.agree = "개인정보 수집·이용에 동의해야 신청할 수 있습니다.";
  if (Object.keys(errors).length) throw new CommandError(Object.values(errors)[0], "VALIDATION", errors);

  const db = await getDb();
  return db.transaction(async (tx) => {
    const [co] = await tx.query<{ id: string }>(`select id from companies order by created_at limit 1`);
    if (!co) throw new ForbiddenError("아직 회사 설정 전이라 가입 신청을 받을 수 없습니다.");
    // 같은 이메일로 동시에 두 번 눌러도 하나만 — 회사 단위로 잠근다
    await tx.query(`select rev from companies where id = $1 for update`, [co.id]);
    const [dup] = await tx.query<{ signup_status: SignupStatus | null }>(`select signup_status from members where email = $1`, [email]);
    if (dup)
      throw new CommandError(
        dup.signup_status === "pending"
          ? "이미 가입 신청한 이메일입니다. 본사 승인을 기다려 주세요."
          : dup.signup_status === "rejected"
            ? "이 이메일은 가입이 승인되지 않았습니다. 잘못된 것이면 본사에 전화해 주세요."
            : "이미 가입된 이메일입니다. 로그인 화면에서 로그인해 주세요.",
        "DUPLICATE",
        { email: "이미 있음" },
      );
    const [p] = await tx.query<{ n: number }>(`select count(*)::int as n from members where company_id = $1 and signup_status = 'pending'`, [co.id]);
    if (Number(p?.n ?? 0) >= SIGNUP_PENDING_MAX) throw new CommandError("가입 신청이 많이 밀려 있어 지금은 받을 수 없습니다. 본사에 전화해 주세요.", "STATE");
    const id = uid("u");
    // 역할은 승인할 때 정한다 — 그 전에는 가장 좁은 ‘현장’ 자리로 둔다(로그인 자체가 막혀 있음). 본사·발주처를 고른 신청도 마찬가지
    await insertMember(tx, {
      id,
      companyId: co.id,
      email: email!,
      name,
      title,
      role: kind === "partner" ? "partner" : "field",
      hash: await hashPassword(input.password as string),
      mustChange: false,
      signup: { phone: phone!, kind: kind!, note, requestedAt: now.toISOString() },
    });
    await appendActivity(tx, co.id, id, `가입 신청 — ${name}${title ? ` ${title}` : ""} (${SIGNUP_KIND_LABEL[kind!]}) · 승인 대기`);
    await bumpRev(tx, co.id);
    const approvers = await tx.query<{ id: string }>(`select id from members where company_id = $1 and active = true and (role = 'ceo' or (role = 'manager' and approver = true))`, [co.id]);
    const notices: Notice[] = approvers.length
      ? [{ to: approvers.map((a) => a.id), title: "가입 신청 — 승인 대기", body: `${name}${title ? ` ${title}` : ""} (${SIGNUP_KIND_LABEL[kind!]}) · 운영 관리 → 사용자에서 승인하거나 승인 안 함`, url: "/admin?tab=members#signups", tag: "signup" }]
      : [];
    return { notices, companyId: co.id };
  });
}

export interface SignupDecision {
  action?: unknown;
  /** 승인: 역할·직함·현장 */
  role?: unknown;
  title?: unknown;
  siteIds?: unknown;
  partnerSiteIds?: unknown;
  approver?: unknown;
  /** 승인 안 함 이유 (선택) */
  reason?: unknown;
}

/** 가입 신청 처리 — 승인(역할·현장을 정해 바로 로그인 가능) · 승인 안 함(이유 · 로그인 막힘) · 지우기(장난·중복 신청) */
export async function decideSignup(m: Member, id: string, input: SignupDecision): Promise<MemberView | { deleted: true }> {
  requireApprover(m);
  const action = input?.action;
  if (action !== "approve" && action !== "reject" && action !== "delete") throw new CommandError("무엇을 할지 골라 주세요.", "VALIDATION");
  const db = await getDb();
  const out = await db.transaction(async (tx) => {
    const [row] = await tx.query<Parameters<typeof toMember>[0] & { signup: SignupInfo | string | null }>(`select ${MEMBER_COLS}, signup from members where id = $1 and company_id = $2 for update`, [id, m.companyId]);
    if (!row) throw new CommandError("가입 신청을 찾을 수 없습니다 (이미 처리했을 수 있습니다).", "NOT_FOUND");
    const status = (row as { signup_status?: SignupStatus | null }).signup_status ?? null;
    if (status !== "pending" && status !== "rejected") throw new CommandError("이미 처리한 가입 신청입니다.", "STATE");
    const info = (typeof row.signup === "string" ? JSON.parse(row.signup) : row.signup) as SignupInfo;
    const decided = { ...info, decidedAt: new Date().toISOString(), decidedBy: m.id, decidedByName: m.name };
    if (action === "delete") {
      await tx.query(`delete from members where id = $1`, [id]);
      await appendActivity(tx, m.companyId, m.id, `가입 신청 지움 — ${row.name} (${status === "pending" ? "승인 대기" : "승인 안 함"})`);
      await bumpRev(tx, m.companyId);
      return { deleted: true as const };
    }
    if (action === "reject") {
      if (status === "rejected") throw new CommandError("이미 ‘승인 안 함’으로 처리했습니다.", "STATE");
      const reason = text(input.reason, 200);
      await tx.query(`update members set signup_status = 'rejected', active = false, signup = $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify({ ...decided, reason })]);
      await tx.query(`delete from sessions where member_id = $1`, [id]);
      await appendActivity(tx, m.companyId, m.id, `가입 승인 안 함 — ${row.name}${reason ? ` (${reason})` : ""}`);
      await bumpRev(tx, m.companyId);
      return null;
    }
    // 승인 — 역할·현장을 정한다
    const role = input.role as RoleId;
    const errs = validateMemberInput({ role, title: typeof input.title === "string" ? input.title : undefined, siteIds: input.siteIds as string[] | undefined, partnerSiteIds: input.partnerSiteIds as string[] | undefined }, false);
    if (!ROLES.includes(role)) errs.role = "역할을 골라 주세요.";
    if (Object.keys(errs).length) throw new CommandError(Object.values(errs)[0], "VALIDATION", errs);
    if (role === "ceo" && m.role !== "ceo") throw new ForbiddenError("대표 권한은 대표만 줄 수 있습니다.");
    const approver = input.approver === true;
    if (input.approver !== undefined && typeof input.approver !== "boolean") throw new CommandError("승인 담당 형식", "VALIDATION");
    if (approver) approverRule(m, true, role);
    const siteIds = role === "field" ? ((input.siteIds as string[] | undefined) ?? []) : [];
    const partnerSiteIds = role === "partner" ? ((input.partnerSiteIds as string[] | undefined) ?? []) : [];
    const title = typeof input.title === "string" ? input.title.trim() : row.title;
    await tx.query(
      `update members set signup_status = 'approved', active = true, role = $2, title = $3, site_ids = $4::jsonb, partner_site_ids = $5::jsonb, approver = $6, signup = $7::jsonb, failed_logins = 0, locked_until = null, updated_at = now() where id = $1`,
      [id, role, title, JSON.stringify(siteIds), JSON.stringify(partnerSiteIds), approver, JSON.stringify(decided)],
    );
    await appendActivity(tx, m.companyId, m.id, `가입 승인 — ${row.name} (${ROLE_LABEL[role]}${approver ? " · 가입 승인 담당" : ""})${status === "rejected" ? " · 승인 안 함에서 다시 승인" : ""}`);
    await bumpRev(tx, m.companyId);
    return null;
  });
  if (out) return out;
  return (await listMembers(m)).find((x) => x.id === id)!;
}

/** 승인 안 함 30일 · 처리 안 된 신청 60일이 지나면 지운다 (매일 점검 · 개인정보 최소 보관) */
export async function purgeSignups(now = new Date()): Promise<number> {
  const db = await getDb();
  const day = 86_400_000;
  const rows = await db.query<{ id: string }>(
    `delete from members
      where (signup_status = 'rejected' and coalesce((signup->>'decidedAt')::timestamptz, updated_at) < $1)
         or (signup_status = 'pending' and created_at < $2)
      returning id`,
    [new Date(now.getTime() - SIGNUP_REJECTED_KEEP_DAYS * day).toISOString(), new Date(now.getTime() - SIGNUP_PENDING_KEEP_DAYS * day).toISOString()],
  );
  return rows.length;
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
