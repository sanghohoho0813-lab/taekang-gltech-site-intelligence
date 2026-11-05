/**
 * 회사 데이터 메모리 재사용 (D-50) — 명령마다 1년치 기록 전체를 DB에서 다시 읽지 않게.
 *
 * 안전 장치
 * - 회사 잠금(select … for update)을 잡은 뒤 읽은 rev가 기억한 rev와 **같을 때만** 쓴다.
 *   모든 쓰기는 rev를 올린다(명령 저장은 persistState가 강제 · 사용자 관리는 bumpRev). 다른 서버가 바꿨으면 rev가 달라 다시 읽는다.
 * - 30초가 지나면 버린다 (DB를 직접 고친 경우 등 대비 — 그래도 직접 고친 뒤에는 rev를 올릴 것, 인수인계서 참고).
 * - 저장이 끝난(커밋된) 상태만 기억한다. 실패한 명령은 기억하지 않는다.
 * - 시험(NODE_ENV=test)이나 STATE_CACHE_FREEZE=1이면 기억한 데이터를 얼려서, 누가 고치려 하면 바로 오류가 나게 한다.
 * - STATE_CACHE=off 로 끌 수 있다.
 */
import type { DemoDB } from "@/lib/domain/types";

interface Entry {
  rev: number;
  /** DB에서 마지막으로 실제로 읽은 시각 — 명령이 이어져도 늘어나지 않는다 (리뷰 반영) */
  loadedAt: number;
  db: DemoDB;
}

const g = globalThis as unknown as { __tkStateCache?: Map<string, Entry> };
const cache: Map<string, Entry> = (g.__tkStateCache ??= new Map());

const enabled = () => process.env.STATE_CACHE !== "off";
const ttlMs = () => {
  const v = Number(process.env.STATE_CACHE_TTL_MS ?? 30_000);
  return Number.isFinite(v) ? Math.max(0, v) : 30_000;
};
const freeze = () => process.env.NODE_ENV === "test" || process.env.STATE_CACHE_FREEZE === "1";

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** rev가 같고, DB에서 읽은 지 오래되지 않았으면 기억한 회사 데이터 (고치지 말 것 — 명령은 복사해서 쓴다) */
export function cachedEntry(companyId: string, rev: number): { db: DemoDB; loadedAt: number } | null {
  if (!enabled()) return null;
  const e = cache.get(companyId);
  if (!e || e.rev !== rev || Date.now() - e.loadedAt > ttlMs()) return null;
  return { db: e.db, loadedAt: e.loadedAt };
}
export function cachedState(companyId: string, rev: number): DemoDB | null {
  return cachedEntry(companyId, rev)?.db ?? null;
}

/**
 * 커밋된 회사 데이터를 기억한다 (더 오래된 rev로 덮어쓰지 않음).
 * loadedAt: 이 데이터의 바탕을 DB에서 실제로 읽은 시각 — 기억한 데이터에서 이어진 명령이면 그 시각을 그대로 넘긴다.
 * 그래야 명령이 계속 이어져도 30초마다 한 번은 DB에서 다시 읽는다 (DB를 직접 고친 경우 대비).
 */
export function rememberState(companyId: string, db: DemoDB, loadedAt: number = Date.now()): void {
  if (!enabled()) return;
  const e = cache.get(companyId);
  if (e && e.rev > db.rev && Date.now() - e.loadedAt <= ttlMs()) return;
  cache.set(companyId, { rev: db.rev, loadedAt, db: freeze() ? deepFreeze(db) : db });
}

export function forgetState(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}
