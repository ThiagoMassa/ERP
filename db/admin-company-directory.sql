-- Extend company metadata without exposing connection references or backup artifacts.
create index control_backups_company_latest on erp_control.backups(company_id,created_at desc,id desc);
create function erp_control.company_directory(filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare page_data jsonb; enriched jsonb;
begin
 -- Existing read enforces ADM, live session and AAL2 before returning any company.
 page_data:=erp_control.read('companies',filters);
 select coalesce(jsonb_agg(e.value||jsonb_build_object(
   'created_at',bu.created_at,'database_identity',c.database_identity,
   'linked_users',(select count(*) from erp_control.memberships m where m.company_id=c.id),
   'latest_backup_id',bk.id,'latest_backup_status',bk.status,
   'latest_backup_requested_at',bk.created_at,'latest_backup_verified_at',bk.verified_at,
   'latest_backup_retention_until',bk.retention_until
 ) order by e.ordinality),'[]'::jsonb) into enriched
 from jsonb_array_elements(page_data->'rows') with ordinality e(value,ordinality)
 join erp_control.companies c on c.id=(e.value->>'id')::uuid
 join public.business_units bu on bu.id=c.id
 left join lateral (
  select b.id,b.status,b.created_at,b.verified_at,b.retention_until
  from erp_control.backups b where b.company_id=c.id
  order by b.created_at desc,b.id desc limit 1
 ) bk on true;
 return jsonb_set(page_data,'{rows}',enriched);
end $$;
revoke all on function erp_control.company_directory(jsonb) from public,anon;
grant execute on function erp_control.company_directory(jsonb) to authenticated;
create or replace function public.erp_admin_read(p_section text,p_filters jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$
 select case when p_section='companies' then erp_control.company_directory(p_filters) else erp_control.read(p_section,p_filters) end
$$;
