-- 001_init
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

alter table photo_blobs enable row level security;
