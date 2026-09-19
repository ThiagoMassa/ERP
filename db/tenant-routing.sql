-- Central control plane only. Does not migrate data or mark a company ready.
create function erp_control.tenant_context(b uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.actor();c erp_control.companies;permissions jsonb:='{}';actions jsonb;m text;a text;
begin
 select * into c from erp_control.companies where id=b;
 if c.id is null or c.status<>'active' or not exists(select 1 from erp_control.memberships where company_id=b and user_id=u and active) then
 raise exception 'Empresa suspensa ou vínculo indisponível.' using errcode='42501';end if;
 if exists(select 1 from public.business_units where id=b and deleted_at is not null) then
 raise exception 'Empresa arquivada.' using errcode='42501';end if;
 foreach m in array array['overview','sales','purchases','catalog','stock','finance','production','settings'] loop
  actions:='{}';foreach a in array array['available','visible','read','create','edit','delete','approve','cancel','reverse','export'] loop
   actions:=actions||jsonb_build_object(a,erp_control.effective(b,u,m,a));
  end loop;permissions:=permissions||jsonb_build_object(m,actions);
 end loop;
 return jsonb_build_object('actor',u,'company',b,'expires_at',clock_timestamp()+interval '25 seconds',
 'permissions',permissions,'provisioning',c.provisioning,'database_identity',c.database_identity,
 'credential_ref',c.credential_ref,'schema_version',c.schema_version);
end $$;
create function public.erp_tenant_context(p_company uuid) returns jsonb
language sql security invoker set search_path='' as $$ select erp_control.tenant_context(p_company) $$;
revoke all on function erp_control.tenant_context(uuid),public.erp_tenant_context(uuid) from public,anon;
grant execute on function erp_control.tenant_context(uuid),public.erp_tenant_context(uuid) to authenticated;
