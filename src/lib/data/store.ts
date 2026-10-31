/**
 * 저장소 — 모드에 따라 두 가지.
 * DEMO: 브라우저 로컬 저장소 (운영 DB 아님). 같은 Origin의 PC 화면과 Mobile Frame(iframe)이 같은 localStorage를 공유하고,
 *       BroadcastChannel + storage 이벤트로 변경을 즉시 동기화한다 (v4.1 Same Data / Same State).
 * LIVE: 서버 DB. 화면은 /api/state 로 역할별 데이터를 받고(5초 간격·포커스 시 갱신), 쓰기는 /api/commands 로 서버에서 실행한다.
 * 화면 코드는 모드와 관계없이 useDb()로 읽고 run(명령, 인자)로 쓴다.
 */
import { useSyncExternalStore } from "react";
import type { DemoDB, RoleId } from "@/lib/domain/types";
import { createSeed, ROLE_DEFAULT_USER } from "./seed";
import { CommandError } from "./commands";
import { COMMANDS, type CommandArgs, type CommandName, type CommandResult } from "./registry";
import { DEFAULT_THEME, type ThemeId } from "@/lib/theme/themes";
import { IS_LIVE } from "@/lib/mode";

import { DB_KEY, PREFS_KEY } from "./keys";
export { DB_KEY, PREFS_KEY };
const CHANNEL = "tk-site-intel";

export type DeviceView = "pc" | "mobile" | "dual";
export type FontScale = "sm" | "md" | "lg";

export interface Prefs {
  theme: ThemeId;
  fontScale: FontScale;
  reduceMotion: boolean;
  role: RoleId;
  deviceView: DeviceView;
  /** PC+Mobile 시연에서 모바일 Frame에 적용할 역할. same = PC와 동일 */
  mobilePersona: "same" | RoleId;
  tutorialDone: boolean;
  /** 기본 화면 보기 개정 번호. 2 = PC+Mobile 기본 (이전 버전에서 저장된 설정도 한 번은 PC+Mobile로 시작) */
  viewRev?: number;
}

const VIEW_REV = 2;

export const DEFAULT_PREFS: Prefs = {
  theme: DEFAULT_THEME,
  fontScale: "md",
  reduceMotion: false,
  role: "ceo",
  deviceView: "dual", // 넓은 화면은 처음부터 PC+Mobile 나란히 (1024px 미만은 DeviceStage가 PC 화면으로 표시)
  mobilePersona: "same",
  tutorialDone: false,
  viewRev: VIEW_REV,
};

export interface Repository {
  load(): DemoDB;
  save(db: DemoDB): void;
  reset(): DemoDB;
  readonly kind: "DEMO_LOCAL" | "SUPABASE";
}

type Listener = () => void;
const listeners = new Set<Listener>();
let dbCache: DemoDB | null = null;
let dbRaw: string | null = null;
let prefsCache: Prefs = DEFAULT_PREFS;
let prefsRaw: string | null = null;
let started = false;
let channel: BroadcastChannel | null = null;
let lastSavedAt: string | null = null;

const isBrowser = () => typeof window !== "undefined";

export function isFrameContext(): boolean {
  if (!isBrowser()) return false;
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin 접근 예외 = 프레임 안
  }
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22);
    throw new CommandError(
      quota ? "브라우저 저장 공간이 부족합니다. 사진 수를 줄이거나 Demo Reset 후 다시 시도해주세요." : "브라우저 저장소에 쓸 수 없습니다 (사생활 보호 모드 확인).",
      "STATE",
    );
  }
}

function readDb(): DemoDB {
  const raw = safeGet(DB_KEY);
  if (raw && raw === dbRaw && dbCache) return dbCache;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoDB;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.sites)) {
        dbRaw = raw;
        dbCache = parsed;
        return parsed;
      }
    } catch {
      // 손상된 데이터 → 시드로 복구
    }
  }
  const seed = createSeed();
  const s = JSON.stringify(seed);
  try {
    window.localStorage.setItem(DB_KEY, s);
  } catch {
    // 저장 불가 환경에서도 메모리로 시연은 가능
  }
  dbRaw = s;
  dbCache = seed;
  return seed;
}

function readPrefs(): Prefs {
  const raw = safeGet(PREFS_KEY);
  if (raw === prefsRaw) return prefsCache;
  prefsRaw = raw;
  try {
    const saved = raw ? (JSON.parse(raw) as Partial<Prefs>) : null;
    if (saved && (saved.viewRev ?? 1) < VIEW_REV) {
      saved.deviceView = "dual";
      saved.viewRev = VIEW_REV;
    }
    prefsCache = saved ? { ...DEFAULT_PREFS, ...saved } : DEFAULT_PREFS;
  } catch {
    prefsCache = DEFAULT_PREFS;
  }
  return prefsCache;
}

function emit() {
  listeners.forEach((l) => l());
}

function refreshFromStorage() {
  const beforeDb = dbCache;
  const beforePrefs = prefsCache;
  readDb();
  readPrefs();
  if (beforeDb !== dbCache || beforePrefs !== prefsCache) {
    applyPrefsToDocument(prefsCache);
    emit();
  }
}

function start() {
  if (started || !isBrowser()) return;
  started = true;
  if (IS_LIVE) {
    readPrefs();
    // 로그인·최초 설정·계정 화면에서는 회사 데이터를 받지 않는다 (로그인 전 401 → 새로고침 반복 방지)
    if (!STANDALONE_PATHS.includes(window.location.pathname)) startLive();
    return;
  }
  readDb();
  readPrefs();
  window.addEventListener("storage", (e) => {
    if (e.key === DB_KEY || e.key === PREFS_KEY || e.key === null) refreshFromStorage();
  });
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => refreshFromStorage();
  } catch {
    channel = null;
  }
  // 다른 탭/프레임에서 바뀐 뒤 포커스 복귀 시 재확인
  window.addEventListener("focus", refreshFromStorage);
}

// ───────────────────────── LIVE (서버 DB) ─────────────────────────

export const STANDALONE_PATHS = ["/login", "/setup", "/account"];

let liveDb: DemoDB | null = null;
let liveRev = -1;
let liveError: string | null = null;
let liveSyncedAt: string | null = null;
let inflight: Promise<void> | null = null;

function startLive() {
  window.addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY || e.key === null) refreshFromStorage();
  });
  try {
    channel = new BroadcastChannel(CHANNEL);
    // 같은 브라우저의 다른 탭·프레임이 저장하면 바로 다시 읽는다
    channel.onmessage = (ev: MessageEvent<{ kind?: string }>) => (ev.data?.kind === "db" ? void liveFetch() : refreshFromStorage());
  } catch {
    channel = null;
  }
  void liveFetch();
  window.setInterval(() => {
    if (document.visibilityState === "visible") void liveFetch();
  }, 5000);
  window.addEventListener("focus", () => void liveFetch());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void liveFetch();
  });
}

function goLogin() {
  if (STANDALONE_PATHS.includes(window.location.pathname) && window.location.pathname !== "/account") return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
}

/** 인증 문제면 화면 이동 후 true */
function handleAuth(status: number, body: { code?: string } | null): boolean {
  if (status === 401) {
    goLogin();
    return true;
  }
  if (status === 403 && body?.code === "MUST_CHANGE_PASSWORD") {
    if (window.location.pathname !== "/account") window.location.assign("/account?force=1");
    return true;
  }
  return false;
}

function applyLive(db: DemoDB, rev: number) {
  if (rev < liveRev) return;
  liveDb = db;
  liveRev = rev;
  liveError = null;
  liveSyncedAt = new Date().toISOString();
  lastSavedAt = liveSyncedAt;
  emit();
}

export function liveFetch(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(`/api/state${liveRev >= 0 ? `?rev=${liveRev}` : ""}`, { cache: "no-store", credentials: "same-origin" });
      if (r.status === 204) {
        liveSyncedAt = new Date().toISOString();
        if (liveError) {
          liveError = null;
          emit();
        }
        return;
      }
      const body = await r.json().catch(() => null);
      if (handleAuth(r.status, body)) return;
      if (!r.ok) {
        liveError = body?.error ?? "서버에서 데이터를 받지 못했습니다.";
        emit();
        return;
      }
      applyLive(body.db as DemoDB, Number(body.rev));
    } catch {
      liveError = "서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.";
      emit();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useLiveStatus(): { syncedAt: string | null; error: string | null } {
  const syncedAt = useSyncExternalStore(subscribe, () => liveSyncedAt, () => null);
  const error = useSyncExternalStore(subscribe, () => liveError, () => null);
  return { syncedAt, error };
}

export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    window.location.assign("/login");
  }
}

function broadcast(kind: "db" | "prefs") {
  try {
    channel?.postMessage({ kind, at: Date.now() });
  } catch {
    // 무시
  }
}

export const localRepository: Repository = {
  kind: "DEMO_LOCAL",
  load: () => readDb(),
  save(db) {
    const s = JSON.stringify(db);
    safeSet(DB_KEY, s);
    dbRaw = s;
    dbCache = db;
    lastSavedAt = new Date().toISOString();
    broadcast("db");
    emit();
  },
  reset() {
    const seed = createSeed();
    this.save(seed);
    return seed;
  },
};

function subscribe(l: Listener) {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getDb(): DemoDB {
  start();
  if (IS_LIVE) return liveDb as DemoDB;
  return readDb();
}

/** LIVE에서는 서버 데이터를 처음 받기 전까지 null (화면은 로딩 표시) */
export function useDb(): DemoDB | null {
  return useSyncExternalStore(
    subscribe,
    () => (isBrowser() ? (IS_LIVE ? (start(), liveDb) : getDb()) : null),
    () => null,
  );
}

export function getPrefs(): Prefs {
  start();
  return readPrefs();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    subscribe,
    () => (isBrowser() ? getPrefs() : DEFAULT_PREFS),
    () => DEFAULT_PREFS,
  );
}

export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...getPrefs(), ...patch };
  const s = JSON.stringify(next);
  try {
    window.localStorage.setItem(PREFS_KEY, s);
  } catch {
    // 저장 불가 → 메모리만
  }
  prefsRaw = s;
  prefsCache = next;
  applyPrefsToDocument(next);
  broadcast("prefs");
  emit();
}

const FONT_ROOT: Record<FontScale, string> = { sm: "0.9", md: "1", lg: "1.12" };

export function applyPrefsToDocument(p: Prefs) {
  if (!isBrowser()) return;
  const el = document.documentElement;
  el.dataset.theme = p.theme;
  el.dataset.font = p.fontScale;
  el.style.setProperty("--font-scale", FONT_ROOT[p.fontScale]);
  el.dataset.motion = p.reduceMotion ? "reduce" : "full";
}

/** 실제 화면에 적용되는 역할. LIVE = 로그인 사용자 역할 / DEMO = 역할 프리뷰 (PC+Mobile 시연 시 모바일 Frame 역할 옵션 반영) */
export function effectiveRole(p: Prefs): RoleId {
  if (IS_LIVE) {
    // 데이터를 받기 전에는 가장 좁은 권한으로 가정
    return liveDb?.users.find((u) => u.id === liveDb?.me)?.role ?? "field";
  }
  if (isFrameContext() && p.deviceView === "dual" && p.mobilePersona !== "same") return p.mobilePersona;
  return p.role;
}

export function useRole(): RoleId {
  return useSyncExternalStore(
    subscribe,
    () => (isBrowser() ? effectiveRole(getPrefs()) : IS_LIVE ? "field" : DEFAULT_PREFS.role),
    () => (IS_LIVE ? "field" : DEFAULT_PREFS.role),
  );
}

export function currentUserId(): string {
  if (IS_LIVE) return liveDb?.me ?? "";
  return ROLE_DEFAULT_USER[effectiveRole(getPrefs())];
}

/** DEMO 전용 저수준 쓰기 — 화면은 run()을 쓴다 */
export function dispatch<R>(fn: (db: DemoDB, ctx: { userId: string; now: Date }) => { db: DemoDB; result: R }): R {
  if (IS_LIVE) throw new Error("LIVE 모드에서는 run()을 사용하세요.");
  const db = getDb();
  const { db: next, result } = fn(db, { userId: currentUserId(), now: new Date() });
  localRepository.save(next);
  return result;
}

/**
 * 모든 쓰기 — 이름 있는 명령 실행.
 * DEMO: 브라우저에서 즉시 실행·저장. LIVE: 서버가 권한 확인 후 실행·저장하고 새 데이터를 돌려준다.
 * 실패하면 CommandError (fieldErrors 포함)를 던진다.
 */
export async function run<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<CommandResult<N>> {
  if (!IS_LIVE) {
    const fn = COMMANDS[name] as unknown as (d: DemoDB, a: CommandArgs<N>, c: { userId: string; now: Date }) => { db: DemoDB; result: CommandResult<N> };
    return dispatch((d, ctx) => fn(d, args, ctx));
  }
  let r: Response;
  try {
    r = await fetch("/api/commands", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ name, args }) });
  } catch {
    throw new CommandError("서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.", "STATE");
  }
  const body = await r.json().catch(() => null);
  if (handleAuth(r.status, body)) throw new CommandError("로그인이 필요합니다.", "STATE");
  if (!r.ok) {
    const code = ["VALIDATION", "DUPLICATE", "NOT_FOUND", "STATE"].includes(body?.code) ? body.code : "STATE";
    throw new CommandError(body?.error ?? "저장하지 못했습니다.", code, body?.fieldErrors ?? {});
  }
  applyLive(body.db as DemoDB, Number(body.rev));
  broadcast("db");
  return body.result as CommandResult<N>;
}

export function resetDemo(): DemoDB {
  if (IS_LIVE) throw new Error("LIVE 모드에서는 데모 초기화를 할 수 없습니다.");
  start();
  return localRepository.reset();
}

export function getLastSavedAt() {
  return lastSavedAt;
}
