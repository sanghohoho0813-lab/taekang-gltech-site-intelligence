-- TAEKANG SITE INTELLIGENCE — Row Level Security (READY · 아직 실행되지 않음)
-- 원칙: 회사 단위 격리 + 현장 단위 접근 + 파트너는 자기 현장의 '공개 상태'만 조회, 내부 원가·이익·미수 비노출.

create or replace function current_profile() returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid()
$$;

create or replace function is_internal() returns boolean language sql stable as $$
  select (current_profile()).role in ('ceo','manager')
$$;

create or replace function can_see_site(s uuid) returns boolean language sql stable as $$
  select exists (
    select 1 from sites t
    where t.id = s and t.company_id = (current_profile()).company_id
      and (
        (current_profile()).role in ('ceo','manager')
        or exists (select 1 from site_members m where m.site_id = t.id and m.user_id = auth.uid())
      )
  )
$$;

alter table sites enable row level security;
alter table site_contracts enable row level security;
alter table cost_budgets enable row level security;
alter table cost_forecasts enable row level security;
alter table cost_entries enable row level security;
alter table progress_updates enable row level security;
alter table site_photos enable row level security;
alter table change_orders enable row level security;
alter table progress_billings enable row level security;
alter table payments_received enable row level security;
alter table partner_requests enable row level security;
alter table actions enable row level security;
alter table proof_events enable row level security;
alter table activity_logs enable row level security;

-- 현장: 내부 전체 / 현장직원·파트너는 배정 현장만
create policy sites_read on sites for select using (can_see_site(id));

-- 계약·예산·잔여예상·기성·입금·변경공사·Proof: 대표·관리자만 (현장직원·파트너 비노출)
create policy contracts_internal on site_contracts for select using (is_internal() and can_see_site(site_id));
create policy budgets_internal on cost_budgets for select using (is_internal() and can_see_site(site_id));
create policy forecasts_internal on cost_forecasts for all using (is_internal() and can_see_site(site_id));
create policy billings_internal on progress_billings for all using (is_internal() and can_see_site(site_id));
create policy payments_internal on payments_received for all using (is_internal() and can_see_site(site_id));
create policy change_orders_internal on change_orders for all using (is_internal() and can_see_site(site_id));
create policy proof_internal on proof_events for all using (is_internal() and can_see_site(site_id));
create policy logs_internal on activity_logs for select using (is_internal() and company_id = (current_profile()).company_id);

-- 원가 이벤트: 내부 전체 / 현장직원은 배정 현장 입력·본인 입력 조회
create policy cost_read on cost_entries for select using (
  can_see_site(site_id) and ((current_profile()).role in ('ceo','manager') or created_by = auth.uid())
);
create policy cost_insert on cost_entries for insert with check (
  can_see_site(site_id) and (current_profile()).role in ('ceo','manager','field') and created_by = auth.uid()
);
create policy cost_void on cost_entries for update using (
  can_see_site(site_id) and ((current_profile()).role in ('ceo','manager') or created_by = auth.uid())
);

-- 현장보고·사진: 배정 현장
create policy reports_rw on progress_updates for all using (can_see_site(site_id) and (current_profile()).role <> 'partner');
create policy photos_rw on site_photos for all using (can_see_site(site_id) and (current_profile()).role <> 'partner');

-- 조치: 내부 전체 / 현장직원은 본인 배정 건 조회·상태 변경
create policy actions_internal on actions for all using (is_internal() and can_see_site(site_id));
create policy actions_assignee on actions for select using (assignee_user_id = auth.uid());
create policy actions_assignee_update on actions for update using (assignee_user_id = auth.uid());

-- 파트너 요청: 파트너는 자기 요청만, 내부는 회사 현장 전체
create policy pr_partner_read on partner_requests for select using (partner_user_id = auth.uid() or (is_internal() and can_see_site(site_id)));
create policy pr_partner_insert on partner_requests for insert with check (
  partner_user_id = auth.uid() and (current_profile()).role = 'partner' and can_see_site(site_id)
);
create policy pr_internal_update on partner_requests for update using (is_internal() and can_see_site(site_id));

-- 파트너에게 공개할 현장 정보는 별도 view로만 제공 (원가·이익·미수 컬럼 없음)
create or replace view partner_site_status as
  select s.id, s.name, s.short_name, s.region, s.start_date, s.end_date, s.progress_pct
  from sites s where can_see_site(s.id);
