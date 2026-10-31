/**
 * 서버 DB 연결 — 같은 SQL을 두 드라이버로 실행한다.
 *   DATABASE_URL=postgres://...      → 운영 (Supabase Postgres 등, `postgres` 드라이버)
 *   DATABASE_URL=pglite:./.data/pg   → 로컬 개발·테스트 (PGlite, 폴더에 저장되는 Postgres)
 *   DATABASE_URL=pglite:memory       → 테스트용 메모리 DB
 * 서버 코드에서만 import 한다.
 */
import { runMigrations } from "./migrations";

export interface Tx {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Tx {
  kind: "pglite" | "postgres";
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

const g = globalThis as unknown as { __tkDb?: Promise<Db>; __tkDbUrl?: string };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다. Vercel 환경변수에 Supabase Postgres 연결 문자열을 넣어주세요.");
  }
  return "pglite:./.data/pg";
}

/** 프로세스당 1개 연결(풀)을 재사용하고, 처음 열 때 스키마를 최신으로 맞춘다 */
export function getDb(): Promise<Db> {
  const url = databaseUrl();
  if (!g.__tkDb || g.__tkDbUrl !== url) {
    g.__tkDbUrl = url;
    g.__tkDb = open(url).then(async (db) => {
      await runMigrations(db);
      return db;
    });
    g.__tkDb.catch(() => {
      g.__tkDb = undefined;
    });
  }
  return g.__tkDb;
}

export async function open(url: string): Promise<Db> {
  if (url.startsWith("pglite:")) return openPglite(url.slice("pglite:".length));
  return openPostgres(url);
}

async function openPglite(location: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const inMemory = location === "memory" || location === "";
  if (!inMemory) {
    // PGlite는 상위 폴더를 만들지 않는다 → 처음 실행할 때 .data 폴더가 없어도 되게
    const { mkdirSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    mkdirSync(dirname(resolve(location)), { recursive: true });
  }
  const pg = inMemory ? new PGlite() : new PGlite(location);
  await pg.waitReady;
  const run: Tx["query"] = async (text, params) => (await pg.query(text, params as unknown[] | undefined)).rows as never;
  // PGlite는 연결이 1개 — 트랜잭션을 순서대로 실행되게 줄 세운다
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: "pglite",
    query: run,
    transaction: (fn) => {
      const p = chain.then(() => pg.transaction(async (tx) => fn({ query: async (t, ps) => (await tx.query(t, ps as unknown[] | undefined)).rows as never })));
      chain = p.catch(() => undefined);
      return p;
    },
    close: () => pg.close(),
  };
}

async function openPostgres(url: string): Promise<Db> {
  const postgres = (await import("postgres")).default;
  // Supabase 트랜잭션 풀러(6543)는 prepared statement를 지원하지 않으므로 prepare: false
  const sql = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5), idle_timeout: 20, connect_timeout: 15 });
  type Runner = { unsafe: (text: string, params?: never[]) => Promise<unknown> };
  const q = (s: Runner): Tx["query"] => (async (text: string, params?: unknown[]) => (await s.unsafe(text, (params ?? []) as never[])) as never) as Tx["query"];
  return {
    kind: "postgres",
    query: q(sql as unknown as Runner),
    transaction: (fn) => sql.begin((tx) => fn({ query: q(tx as unknown as Runner) })) as never,
    close: () => sql.end({ timeout: 5 }),
  };
}
