/**
 * 보내지 못한 보고함 (D-39) — 인터넷이 끊겨 못 보낸 현장 보고를 사진까지 휴대폰(IndexedDB)에 보관하고,
 * 신호가 잡히면(앱 열기·화면 다시 보기·연결 복구·30초마다) 자동으로 보낸다.
 * - 같은 중복 방지 키로 다시 보내므로, 사실 서버에 이미 저장됐다면 ‘중복’ 응답 → 보낸 것으로 처리
 * - 출근·퇴근도 보관한다 (D-55). 서버는 받은 시각으로 기록하고, 휴대폰이 적어 보낸 ‘누른 시각’은
 *   근태 수정 요청(본사 승인)으로만 반영한다 — 휴대폰 시계를 바꿔도 출퇴근 시각이 바뀌지 않는다.
 * - 자재 반입·설치도 보관한다 (D-63). 누른 시각(휴대폰 시계)은 날짜를 정하는 데만 쓰고, 24시간이 지나면 받은 날짜로 넣는다
 * - 작업 인원은 보관하지 않는다 (그날 사진·위치가 기준)
 */
import { CommandError } from "@/lib/data/commands";

export interface OutboxItem {
  id: string;
  userId: string;
  name: "submitFieldReport" | "checkIn" | "checkOut" | "recordMaterial";
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

const isAtt = (i: Pick<OutboxItem, "name">) => i.name === "checkIn" || i.name === "checkOut";
/** 출퇴근 위치 좌표·동의를 뺀 인자 (보낼 수 없게 된 기록·로그아웃·위치 기록 그만두기 · 리뷰 반영) */
export function withoutLocation(args: Record<string, unknown>): Record<string, unknown> {
  const { sample: _s, consent: _c, consentTerms: _t, ...rest } = args;
  void _s;
  void _c;
  void _t;
  return { ...rest, sample: null, noLocation: "skipped" };
}

/**
 * 보내는 순서: 만든 순서(휴대폰 시계)대로, 단 같은 현장의 출근은 언제나 퇴근보다 먼저
 * (그 사이 휴대폰 시계가 바뀌어도 퇴근이 먼저 가서 실패하지 않게 · 리뷰 반영)
 */
export function sendOrder(items: OutboxItem[]): OutboxItem[] {
  const byTime = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: OutboxItem[] = [];
  for (const it of byTime) {
    if (it.name === "checkIn") {
      const firstOut = out.findIndex((o) => o.name === "checkOut" && o.args.siteId === it.args.siteId);
      if (firstOut >= 0) {
        out.splice(firstOut, 0, it);
        continue;
      }
    }
    out.push(it);
  }
  return out;
}

/** 오래된 것부터 차례로 보낸다. 인터넷이 아직 안 되면(서버가 잠시 바쁜 것 포함) 멈춘다 */
export async function flushWith(store: OutboxStore, userId: string, runner: Runner): Promise<FlushResult> {
  const items = sendOrder((await store.all()).filter((i) => i.userId === userId && !i.failed));
  let sent = 0;
  let failed = 0;
  let offline = false;
  /** 이번에 받아 주지 않은 출근의 현장 — 그 현장 퇴근은 보내지 않는다 (줄줄이 실패 방지) */
  const failedIn = new Set<unknown>();
  for (const it of items) {
    if (it.name === "checkOut" && failedIn.has(it.args.siteId)) {
      await store.put({ ...it, args: withoutLocation(it.args), failed: "앞의 출근이 기록되지 않아 이 퇴근도 보내지 않았어요" });
      failed += 1;
      continue;
    }
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
        // 다시 보내도 안 되는 기록 — 출퇴근이면 휴대폰에 남은 위치 좌표는 지운다
        await store.put({ ...it, ...(isAtt(it) ? { args: withoutLocation(it.args) } : {}), tries: it.tries + 1, failed: e instanceof Error ? e.message : "보내지 못했습니다" });
        if (it.name === "checkIn") failedIn.add(it.args.siteId);
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

/** 저장해 둔 출퇴근의 위치 좌표·동의를 지운다 — 로그아웃·위치 기록 그만두기 때 (기록은 ‘위치 없음’으로 그대로 보냄) */
export async function scrubQueuedLocation(userId?: string): Promise<void> {
  try {
    for (const it of await idbStore.all()) {
      if (!isAtt(it) || (userId && it.userId !== userId)) continue;
      if (!it.args.sample && !it.args.consent) continue;
      await idbStore.put({ ...it, args: withoutLocation(it.args) });
    }
    outboxChanged();
  } catch {
    // 저장 공간을 못 쓰면 지울 것도 없다
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
