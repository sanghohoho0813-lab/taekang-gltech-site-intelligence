/**
 * DB 스키마 — 앱이 처음 DB에 연결할 때 자동 적용 (적용 이력: schema_migrations).
 * supabase/migrations/001_init.sql 은 이 파일과 같은 내용 (단위 테스트로 일치 확인).
 *
 * 설계 (DECISIONS D-19):
 * - 업무 데이터는 records(컬렉션·id·data jsonb) 한 표에 엔터티 단위로 저장 — 화면·계산이 쓰는 모양 그대로,
 *   서버가 명령 실행 전후를 비교해 바뀐 행만 쓴다. 회사·사용자·세션·사진 원본은 별도 표.
 * - 모든 표에 RLS를 켜고 정책을 두지 않는다 → Supabase 공개 API(anon/authenticated)로는 읽기·쓰기 불가.
 *   데이터 접근은 앱 서버(DATABASE_URL, 소유자 권한)만 하고, 권한 검사는 서버 코드(src/server/authz.ts)가 한다.
 */
import type { Tx } from "./sql";

export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_init",
    sql: `
create table if not exists companies (
  id text primary key,
  name text not null,
  info jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists company_state (
  company_id text primary key references companies(id) on delete cascade,
  seeded_at text not null,
  baseline jsonb not null default '{}'::jsonb,
  thresholds jsonb not null,
  settings jsonb not null default '{}'::jsonb,
  signal_states jsonb not null default '{}'::jsonb,
  idempotency_keys jsonb not null default '[]'::jsonb
);

create table if not exists members (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  email text not null unique,
  name text not null,
  title text not null default '',
  role text not null check (role in ('ceo', 'manager', 'field', 'partner')),
  site_ids jsonb not null default '[]'::jsonb,
  partner_site_ids jsonb not null default '[]'::jsonb,
  password_hash text not null,
  active boolean not null default true,
  must_change_password boolean not null default false,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists members_company on members(company_id);

create table if not exists sessions (
  token_hash text primary key,
  member_id text not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index if not exists sessions_member on sessions(member_id);

create table if not exists records (
  seq bigint generated always as identity,
  company_id text not null references companies(id) on delete cascade,
  collection text not null,
  id text not null,
  site_id text,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, collection, id)
);
create index if not exists records_company_collection on records(company_id, collection);
create index if not exists records_company_site on records(company_id, site_id);

create table if not exists photo_blobs (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  site_id text,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

alter table companies enable row level security;
alter table company_state enable row level security;
alter table members enable row level security;
alter table sessions enable row level security;
alter table records enable row level security;
alter table photo_blobs enable row level security
`,
  },
];

function statements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runMigrations(db: Tx & { transaction?: <R>(fn: (tx: Tx) => Promise<R>) => Promise<R> }) {
  await db.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    const apply = async (tx: Tx) => {
      // 서버 여러 대(서버리스)가 동시에 처음 뜰 때 한 곳만 적용하도록 잠금 → 잠금을 얻은 뒤 다시 확인
      await tx.query(`select pg_advisory_xact_lock(7240311)`);
      const [again] = await tx.query<{ n: string | number }>(`select count(*) as n from schema_migrations where name = $1`, [m.name]);
      if (Number(again?.n ?? 0) > 0) return;
      for (const st of statements(m.sql)) await tx.query(st);
      await tx.query(`insert into schema_migrations (name) values ($1) on conflict (name) do nothing`, [m.name]);
    };
    if (db.transaction) await db.transaction(apply);
    else await apply(db);
  }
}

/** supabase/migrations/001_init.sql 과 같은 형태로 출력 (Supabase SQL Editor에 붙여넣기용) */
export function migrationSqlFile(): string {
  return MIGRATIONS.map((m) => `-- ${m.name}\n${statements(m.sql).join(";\n\n")};\n`).join("\n");
}
