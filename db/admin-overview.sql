-- Counts reconcile to all identities; operational alerts expose only safe metadata.
create function erp_control.overview() returns jsonb
language plpgsql security definer set search_path='' as $$
declare summary jsonb; users_summary jsonb; failures jsonb; security_events jsonb; provisioning_failures jsonb;
begin
 summary:=erp_control.read('overview','{}'); -- ADM, live session and AAL2.
 with classified as (
  select case when a.banned_until>now() or ac.status='blocked' then 'blocked'
   when ac.status='suspended' then 'suspended'
   when a.email_confirmed_at is null then 'pending' else 'active' end state
  from auth.users a left join erp_control.user_access ac on ac.user_id=a.id
 ) select jsonb_build_object('users',count(*),'active_users',count(*) filter(where state='active'),
  'blocked_users',count(*) filter(where state='blocked'),'suspended_users',count(*) filter(where state='suspended'),
  'pending_users',count(*) filter(where state='pending')) into users_summary from classified;
 select coalesce(jsonb_agg(x order by x.updated_at desc,x.id),'[]') into failures from (
  select j.id,j.company_id,bu.name as company_name,j.kind,j.stage,j.updated_at
  from erp_control.maintenance_jobs j join public.business_units bu on bu.id=j.company_id
  where j.status='failed' order by j.updated_at desc,j.id limit 10
 ) x;
 select coalesce(jsonb_agg(x order by x.occurred_at desc,x.id),'[]') into security_events from (
  select a.id::text as id,a.occurred_at,a.company_id,a.actor_id,a.action,a.result,a.correlation_id
  from erp_control.audit a where a.result in ('denied','failed') and a.occurred_at>now()-interval '24 hours'
  order by a.occurred_at desc,a.id desc limit 10
 ) x;
 select coalesce(jsonb_agg(x order by x.name,x.id),'[]') into provisioning_failures from (
  select c.id,bu.name,c.provisioning,c.updated_at from erp_control.companies c
  join public.business_units bu on bu.id=c.id where c.provisioning='failed'
  order by bu.name,c.id limit 10
 ) x;
 return summary||users_summary||jsonb_build_object('maintenance_failures',failures,'security_events',security_events,'provisioning_failures',provisioning_failures);
end $$;
revoke all on function erp_control.overview() from public,anon;
grant execute on function erp_control.overview() to authenticated;
create or replace function public.erp_admin_read(p_section text,p_filters jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$
 select case when p_section='companies' then erp_control.company_directory(p_filters)
  when p_section='overview' then erp_control.overview() else erp_control.read(p_section,p_filters) end
$$;
