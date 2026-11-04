/**
 * 보내지 못한 보고함 (D-39) — 인터넷이 끊겨 못 보낸 현장 보고를 사진까지 휴대폰(IndexedDB)에 보관하고,
 * 신호가 잡히면(앱 열기·화면 다시 보기·연결 복구·30초마다) 자동으로 보낸다.
 * - 같은 중복 방지 키로 다시 보내므로, 사실 서버에 이미 저장됐다면 ‘중복’ 응답 → 보낸 것으로 처리
 * - 출근·퇴근·작업 인원은 보관하지 않는다 (서버 시각·날짜가 기준이라 늦게 보내면 기록이 틀어짐)
 */
import { CommandError } from "@/lib/data/commands";

export interface OutboxItem {
  id: string;
  userId: string;
  name: "submitFieldReport";
  args: Record<string, unknown>;
  /** 화면에 보일 설명 (예: A현장 · 11월 4일 보고 · 사진 2장) */
  label: string;
  createdAt: string;
  tries: number;
  /** 서버가 거부한 이유 (다시 보내도 안 되는 경우) */
  failed?: string;
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 서버 호출 (테스트에서 바꿔 끼움) */
export type Runner = (name: OutboxItem["name"], args: Record<string, unknown>) => Promise<unknown>;

export interface FlushResult {
  sent: number;
  failed: number;
  waiting: number;
  offline: boolean;
}

/** 오래된 것부터 차례로 보낸다. 인터넷이 아직 안 되면 멈춘다 */
export async function flushWith(store: OutboxStore, userId: string, runner: Runner): Promise<FlushResult> {
  const items = (await store.all()).filter((i) => i.userId === userId && !i.failed).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sent = 0;
  let failed = 0;
  let offline = false;
  for (const it of items) {
    try {
      await runner(it.name, it.args);
      await store.remove(it.id);
      sent += 1;
    } catch (e) {
      if (e instanceof CommandError && e.code === "DUPLICATE") {
        // 끊기기 직전에 이미 저장된 보고
        await store.remove(it.id);
        sent += 1;
      } else if (e instanceof CommandError && e.code === "NETWORK") {
        await store.put({ ...it, tries: it.tries + 1 });
        offline = true;
        break;
      } else if (e instanceof CommandError && /로그인/.test(e.message)) {
        // 로그인이 풀림 — 다시 로그인하면 이어서 보낸다
        offline = true;
        break;
      } else {
        await store.put({ ...it, tries: it.tries + 1, failed: e instanceof Error ? e.message : "보내지 못했습니다" });
        failed += 1;
      }
    }
  }
  const waiting = (await store.all()).filter((i) => i.userId === userId && !i.failed).length;
  return { sent, failed, waiting, offline };
}

// ───────────── 브라우저 IndexedDB 저장소 ─────────────

const DB_NAME = "tk-site-intel-outbox";
const STORE = "items";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openIdb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(r ? (r.result as T) : undefined);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export const idbStore: OutboxStore = {
  all: async () => ((await tx<OutboxItem[]>("readonly", (s) => s.getAll())) ?? []) as OutboxItem[],
  put: async (item) => void (await tx("readwrite", (s) => void s.put(item))),
  remove: async (id) => void (await tx("readwrite", (s) => void s.delete(id))),
};

const EVENT = "tk-outbox-change";
export const outboxChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
};
export const onOutboxChange = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

export async function outboxAdd(item: Omit<OutboxItem, "tries" | "createdAt">): Promise<boolean> {
  try {
    await idbStore.put({ ...item, tries: 0, createdAt: new Date().toISOString() });
    outboxChanged();
    return true;
  } catch {
    return false;
  }
}

export async function outboxFor(userId: string): Promise<OutboxItem[]> {
  try {
    return (await idbStore.all()).filter((i) => i.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function outboxRemove(id: string) {
  await idbStore.remove(id).catch(() => {});
  outboxChanged();
}

let flushing: Promise<FlushResult> | null = null;
/** 동시에 두 번 보내지 않게 한 번에 하나만 */
export function flushOutbox(userId: string, runner: Runner): Promise<FlushResult> {
  if (!flushing)
    flushing = flushWith(idbStore, userId, runner)
      .catch(() => ({ sent: 0, failed: 0, waiting: 0, offline: true }))
      .finally(() => {
        flushing = null;
        outboxChanged();
      });
  return flushing;
}
