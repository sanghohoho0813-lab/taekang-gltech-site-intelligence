/**
 * DEMO Repository — 브라우저 로컬 저장소 (운영 DB 아님).
 * 같은 Origin의 PC 화면과 Mobile Frame(iframe)이 같은 localStorage를 공유하고,
 * BroadcastChannel + storage 이벤트로 변경을 즉시 동기화한다 (v4.1 Same Data / Same State).
 *
 * 실데이터 전환 시: Repository 인터페이스를 Supabase 구현으로 교체 (supabase/migrations 참고).
 */
import { useSyncExternalStore } from "react";
import type { DemoDB, RoleId } from "@/lib/domain/types";
import { createSeed, ROLE_DEFAULT_USER } from "./seed";
import { CommandError } from "./commands";
import { DEFAULT_THEME, type ThemeId } from "@/lib/theme/themes";

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
  return readDb();
}

export function useDb(): DemoDB | null {
  return useSyncExternalStore(
    subscribe,
    () => (isBrowser() ? getDb() : null),
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

/** 실제 화면에 적용되는 역할 (PC+Mobile 시연 시 모바일 Frame 역할 옵션 반영) */
export function effectiveRole(p: Prefs): RoleId {
  if (isFrameContext() && p.deviceView === "dual" && p.mobilePersona !== "same") return p.mobilePersona;
  return p.role;
}

export function useRole(): RoleId {
  const p = usePrefs();
  return effectiveRole(p);
}

export function currentUserId(): string {
  return ROLE_DEFAULT_USER[effectiveRole(getPrefs())];
}

/** 모든 쓰기는 dispatch를 통해 — 명령(순수 함수) 실행 → 저장 → 브로드캐스트 */
export function dispatch<R>(fn: (db: DemoDB, ctx: { userId: string; now: Date }) => { db: DemoDB; result: R }): R {
  const db = getDb();
  const { db: next, result } = fn(db, { userId: currentUserId(), now: new Date() });
  localRepository.save(next);
  return result;
}

export function resetDemo(): DemoDB {
  start();
  return localRepository.reset();
}

export function getLastSavedAt() {
  return lastSavedAt;
}
