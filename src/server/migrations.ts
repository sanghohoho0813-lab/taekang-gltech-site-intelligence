/**
 * DB 스키마 — 앱이 처음 DB에 연결할 때 자동 적용 (적용 이력: schema_migrations).
 * supabase/migrations/001_init.sql 은 이 파일과 같은 내용 (단위 테스트로 일치 확인 — 뒤에 추가한 변경도 그 파일에 이어 붙는다).
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
  {
    // 보고서 링크(D-73): 로그인 없이 여는 주소는 회사 번호 없이 링크 id(해시)만으로 찾는다 — 그 조회가 전체 기록을 훑지 않게
    name: "002_share_lookup",
    sql: `
create index if not exists records_share_id on records(id) where collection = 'shares'
`,
  },
  {
    // 하자 접수 링크(D-74): 로그인 없이 접수 주소(링크 id)와 진행 확인 주소(요청의 statusKey)로 바로 찾는다
    name: "003_intake_lookup",
    sql: `
create index if not exists records_intake_id on records(id) where collection = 'intakes';
create index if not exists records_request_status_key on records((data->>'statusKey')) where collection = 'partnerRequests'
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
  const all = async (tx: Tx) => {
    // 서버 여러 대(서버리스)가 빈 DB에 동시에 처음 뜰 때 한 곳씩만 — 잠금을 맨 먼저 얻는다.
    // 적용 기록 표를 잠금 밖에서 동시에 만들면 Postgres가 중복 오류(pg_type_typname_nsp_index)를 낸다 (D-42)
    await tx.query(`select pg_advisory_xact_lock(7240311)`);
    await tx.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    // Supabase 공개 API로 적용 기록을 읽거나 고치지 못하게 (다른 표와 같은 원칙 · D-41)
    await tx.query(`alter table schema_migrations enable row level security`);
    const done = new Set((await tx.query<{ name: string }>(`select name from schema_migrations`)).map((r) => r.name));
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      for (const st of statements(m.sql)) await tx.query(st);
      await tx.query(`insert into schema_migrations (name) values ($1) on conflict (name) do nothing`, [m.name]);
    }
  };
  // 한 트랜잭션: 중간에 실패하면 전부 되돌아가 다음 시작 때 처음부터 다시 적용된다
  if (db.transaction) await db.transaction(all);
  else await all(db);
}

/** supabase/migrations/001_init.sql 과 같은 형태로 출력 (Supabase SQL Editor에 붙여넣기용) */
export function migrationSqlFile(): string {
  return MIGRATIONS.map((m) => `-- ${m.name}\n${statements(m.sql).join(";\n\n")};\n`).join("\n");
}
