-- TAEKANG SITE INTELLIGENCE — 기본 스키마 (READY · 아직 실행되지 않음)
-- 모든 금액: 원 단위 bigint, 공급가액(부가세 별도)
-- 실행 전 Supabase 프로젝트를 만들고 SQL Editor 또는 supabase CLI(db push)로 순서대로 실행하세요.

create extension if not exists "pgcrypto";

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create type app_role as enum ('ceo', 'manager', 'field', 'partner');

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id),
  role app_role not null,
  display_name text not null,
  partner_client_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null
);

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  client_id uuid references clients(id),
  code text not null,
  name text not null,
  short_name text not null,
  work_type text not null,
  region text,
  status text not null default 'active' check (status in ('active','completed','hold')),
  start_date date,
  end_date date,
  progress_pct numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  manager_user_id uuid references profiles(id),
  field_user_id uuid references profiles(id),
  unique (company_id, code)
);

create table if not exists site_members (
  site_id uuid references sites(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (site_id, user_id)
);

create table if not exists site_stages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  progress_pct numeric(5,2) not null default 0,
  sort_order int not null default 0
);

create table if not exists site_contracts (
  site_id uuid primary key references sites(id) on delete cascade,
  contract_amount bigint not null check (contract_amount >= 0),
  planned_cost_total bigint not null check (planned_cost_total >= 0),
  signed_date date
);

create type cost_category as enum ('material','labor','subcontract','equipment','overhead');
-- 원가 이벤트가 EAC에 반영되는 방식 (중복 계산 금지)
create type forecast_impact as enum ('baseline','additional','within_forecast');

create table if not exists cost_budgets (
  site_id uuid references sites(id) on delete cascade,
  category cost_category not null,
  amount bigint not null check (amount >= 0),
  primary key (site_id, category)
);

create table if not exists cost_forecasts (
  site_id uuid references sites(id) on delete cascade,
  category cost_category not null,
  remaining bigint not null check (remaining >= 0),
  basis_date date not null,
  note text,
  primary key (site_id, category)
);

create table if not exists progress_updates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  report_date date not null,
  work_done text not null default '',
  issues text not null default '',
  tomorrow_plan text not null default '',
  status text not null default 'submitted' check (status in ('submitted','voided')),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  idempotency_key text unique
);

create table if not exists cost_entries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  report_id uuid references progress_updates(id),
  category cost_category not null,
  amount bigint not null check (amount > 0 and amount <= 5000000000),
  entry_date date not null,
  forecast_impact forecast_impact not null,
  reason text not null,
  note text not null default '',
  source text not null check (source in ('SEED','FIELD','PC','CSV')),
  status text not null default 'active' check (status in ('active','voided')),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists cost_entries_site_idx on cost_entries(site_id, status);

create table if not exists site_photos (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  report_id uuid references progress_updates(id),
  storage_path text not null, -- Supabase Storage 경로 (DEMO는 브라우저 data URL)
  caption text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists change_orders (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  title text not null,
  amount bigint not null check (amount > 0),
  approved_amount bigint,
  status text not null check (status in ('review','submitted','approved','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  source_action_id uuid,
  source_partner_request_id uuid,
  note text not null default ''
);

create table if not exists change_order_sources (
  change_order_id uuid references change_orders(id) on delete cascade,
  cost_entry_id uuid references cost_entries(id) on delete cascade,
  primary key (change_order_id, cost_entry_id)
);

create table if not exists progress_billings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  round int not null,
  amount bigint not null check (amount > 0),
  billed_date date not null,
  status text not null default 'confirmed' check (status in ('draft','confirmed'))
);

create table if not exists payments_received (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  billing_id uuid references progress_billings(id),
  amount bigint not null check (amount > 0),
  received_date date not null
);

create table if not exists partner_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  partner_user_id uuid not null references profiles(id),
  type text not null check (type in ('change_review','schedule','other')),
  title text not null check (char_length(title) <= 80),
  description text not null check (char_length(description) <= 800),
  desired_date date,
  status text not null default 'received' check (status in ('received','reviewing','answered')),
  reply text,
  replied_by uuid references profiles(id),
  linked_change_order_id uuid references change_orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key text unique
);

create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  signal_key text not null,
  rule text not null,
  title text not null,
  description text not null default '',
  signal_title text not null,
  signal_why jsonb not null default '[]',
  signal_detected_at timestamptz not null,
  assignee_user_id uuid references profiles(id),
  due_date date,
  status text not null check (status in ('recommended','assigned','in_progress','done','on_hold','dismissed')),
  approved_by uuid not null references profiles(id),
  kpi_before jsonb not null,
  result text,
  claim_amount bigint,
  change_order_id uuid references change_orders(id),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references profiles(id)
);

create table if not exists action_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions(id) on delete cascade,
  at timestamptz not null default now(),
  by_user uuid not null references profiles(id),
  from_status text,
  to_status text,
  note text,
  photo_id uuid references site_photos(id)
);

create table if not exists proof_events (
  proof_event_id uuid primary key default gen_random_uuid(),
  event_type text not null,
  site_id uuid not null references sites(id) on delete cascade,
  trigger text not null,
  decision text not null,
  decision_method text not null,
  why jsonb not null default '[]',
  human_approval jsonb not null,
  action text not null,
  action_id uuid references actions(id),
  result text not null,
  kpi_before jsonb not null,
  kpi_after jsonb not null,
  data_source text not null,
  user_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  result_confirmed_at timestamptz,
  confirmed_by uuid references profiles(id),
  evidence_link text,
  status text not null check (status in ('recorded','confirmed')),
  response_minutes int
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  site_id uuid references sites(id),
  at timestamptz not null default now(),
  by_user uuid references profiles(id),
  type text not null,
  summary text not null,
  link text
);

create table if not exists risk_thresholds (
  company_id uuid primary key references companies(id),
  target_margin_pct numeric(5,2) not null default 13,
  margin_drop_pp numeric(5,2) not null default 3,
  overrun_pct numeric(5,2) not null default 5,
  cost_progress_gap_pp numeric(5,2) not null default 10,
  receivable_days int not null default 60,
  change_order_pending_days int not null default 30
);

-- 위험 신호(risk_signals)는 저장하지 않고 위 데이터에서 매번 계산하는 파생값이다 (src/lib/domain/risk.ts).
-- 필요 시 조회 성능을 위해 materialized view로 전환한다.
