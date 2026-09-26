-- Central database: freeze legacy writes before a tenant copy can start.
alter table erp_control.companies add column data_location text not null default 'legacy'
 check(data_location in ('legacy','migrating','tenant'));
create table erp_control.cutovers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references erp_control.companies(id),
 requested_by uuid not null references auth.users(id), session_id uuid not null, token_issued_at timestamptz not null,
 reason text not null check(length(trim(reason)) between 10 and 1000),
 status text not null default 'requested' check(status in ('requested','running','verified','activated','failed','cancelled')),
 requested_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 source_digest text, target_digest text, counts jsonb, failure_code text,
 correlation_id uuid not null default gen_random_uuid(),
 check(status not in ('verified','activated') or (source_digest is not null and target_digest is not null and source_digest ~ '^[0-9a-f]{64}$' and source_digest=target_digest and counts is not null))
);
create unique index one_open_cutover_per_company on erp_control.cutovers(company_id) where status<>'cancelled';
alter table erp_control.cutovers enable row level security;
revoke all on erp_control.cutovers from public,anon,authenticated;

create function erp_control.legacy_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare old_b uuid; new_b uuid; b uuid; location text;
begin
 if tg_table_name='business_units' then
  if tg_op<>'INSERT' then old_b:=old.id;end if;if tg_op<>'DELETE' then new_b:=new.id;end if;
 elsif tg_table_name in ('products','entries') then
  if tg_op<>'INSERT' then old_b:=old.business_id;end if;if tg_op<>'DELETE' then new_b:=new.business_id;end if;
 elsif tg_table_name='stock_movements' then
  if tg_op<>'INSERT' then select business_id into old_b from public.products where id=old.product_id;end if;
  if tg_op<>'DELETE' then select business_id into new_b from public.products where id=new.product_id;end if;
 else raise exception 'Tabela não autorizada para corte';end if;
 -- SHARE locks drain in-flight legacy transactions before the control row switches.
 for b in select distinct value from unnest(array[old_b,new_b]) value where value is not null order by value loop
  select data_location into location from erp_control.companies where id=b for share;
  if location is not null and location<>'legacy' then
   raise exception 'Esta empresa está em migração ou já utiliza o banco exclusivo. Atualize a aplicação.' using errcode='55000';
  end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function erp_control.legacy_write_guard() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['business_units','products','entries','stock_movements'] loop
 execute format('create trigger tenant_cutover_write before insert or update or delete on public.%I for each row execute function erp_control.legacy_write_guard()',t);
 end loop;
end $$;

create function erp_control.legacy_data_visible(b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from erp_control.companies where id=b and data_location='legacy')
$$;
revoke all on function erp_control.legacy_data_visible(uuid) from public,anon;
grant execute on function erp_control.legacy_data_visible(uuid) to authenticated;
create policy tenant_cutover_read on public.products as restrictive for select to authenticated using(erp_control.legacy_data_visible(business_id));
create policy tenant_cutover_read on public.entries as restrictive for select to authenticated using(erp_control.legacy_data_visible(business_id));
create policy tenant_cutover_read on public.stock_movements as restrictive for select to authenticated using(erp_control.legacy_data_visible((select business_id from public.products p where p.id=product_id)));

create function erp_control.request_cutover(b uuid,expected_version integer,why text,correlation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.require_admin(true);c erp_control.companies;j erp_control.cutovers;
begin
 if why is null or length(trim(why)) not between 10 and 1000 then raise exception 'Justificativa obrigatória, de 10 a 1000 caracteres.';end if;
 select * into c from erp_control.companies where id=b for update;
 if c.id is null or c.version<>expected_version then raise exception 'Empresa alterada. Atualize antes de migrar.';end if;
 if c.data_location='tenant' then raise exception 'Empresa já utiliza banco exclusivo.';end if;
 select * into j from erp_control.cutovers where company_id=b and status<>'cancelled' for update;
 if j.id is not null and j.status not in ('failed','verified','requested') then raise exception 'Migração em execução.';end if;
 if j.id is null then
  insert into erp_control.cutovers(company_id,requested_by,session_id,token_issued_at,reason,correlation_id) values(b,u,(auth.jwt()->>'session_id')::uuid,to_timestamp((auth.jwt()->>'iat')::bigint),trim(why),correlation) returning * into j;
 else
  update erp_control.cutovers set status=case when status='verified' then 'verified' else 'requested' end,requested_by=u,session_id=(auth.jwt()->>'session_id')::uuid,token_issued_at=to_timestamp((auth.jwt()->>'iat')::bigint),reason=trim(why),requested_at=now(),updated_at=now(),failure_code=null,correlation_id=correlation where id=j.id returning * into j;
 end if;
 update erp_control.companies set data_location='migrating',provisioning='provisioning',provisioning_note='Gravações legadas bloqueadas; aguardando cópia e conciliação.',version=version+1,updated_at=now() where id=b;
 insert into erp_control.audit(actor_id,company_id,action,entity,before_data,after_data,reason,result,correlation_id)
 values(u,b,'tenant.cutover.request',j.id::text,jsonb_build_object('data_location',c.data_location),jsonb_build_object('data_location','migrating','job_id',j.id),why,'success',correlation);
 return jsonb_build_object('job_id',j.id,'status',j.status,'company',b);
end $$;
create function public.erp_request_cutover(p_company uuid,p_version integer,p_reason text,p_correlation uuid) returns jsonb language sql security invoker set search_path='' as $$
 select erp_control.request_cutover(p_company,p_version,p_reason,p_correlation)
$$;
revoke all on function erp_control.request_cutover(uuid,integer,text,uuid),public.erp_request_cutover(uuid,integer,text,uuid) from public,anon;
grant execute on function erp_control.request_cutover(uuid,integer,text,uuid),public.erp_request_cutover(uuid,integer,text,uuid) to authenticated;

-- Operator-only state machine. No browser or authenticated-role EXECUTE grant.
create function erp_control.cutover_step(job uuid,step text,report jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j erp_control.cutovers;c erp_control.companies;next_status text;db_name text;ref text;
begin
 select company_id into c.id from erp_control.cutovers where id=job;
 select * into c from erp_control.companies where id=c.id for update;
 select * into j from erp_control.cutovers where id=job for update;
 if j.id is null then raise exception 'Migração não encontrada';end if;
 if j.status='activated' then return jsonb_build_object('status','activated','company',j.company_id);end if;
 if c.data_location<>'migrating' or j.status='cancelled' then raise exception 'Empresa fora do processo de migração';end if;
 if step<>'fail' and (j.requested_at<now()-interval '10 minutes' or
  not exists(select 1 from erp_control.administrators where user_id=j.requested_by and active) or
  exists(select 1 from erp_control.user_access where user_id=j.requested_by and (status<>'active' or j.token_issued_at<=revoked_before)) or
  not exists(select 1 from auth.mfa_factors where user_id=j.requested_by and status='verified') or
  not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=j.session_id and s.user_id=j.requested_by and s.aal='aal2' and s.created_at>now()-interval '24 hours' and (s.not_after is null or s.not_after>now()) and (u.banned_until is null or u.banned_until<now()))) then
 raise exception 'Autorização de migração expirada. Confirme novamente com MFA.' using errcode='42501';end if;
 if step='start' then
  if j.status not in ('requested','running','failed','verified') then raise exception 'Etapa inválida';end if;
  next_status:=case when j.status='verified' then 'verified' else 'running' end;
 elsif step='verify' then
  if j.status not in ('running','verified') or report->>'source_digest' is null or report->>'source_digest' is distinct from report->>'target_digest' or report->>'source_digest' !~ '^[0-9a-f]{64}$' or jsonb_typeof(report->'counts') is distinct from 'object' then raise exception 'Conciliação inválida';end if;
  update erp_control.cutovers set source_digest=report->>'source_digest',target_digest=report->>'target_digest',counts=report->'counts' where id=job;
  next_status:='verified';
 elsif step='activate' then
  if j.status<>'verified' or j.source_digest is distinct from report->>'source_digest' or report->>'schema_version' is null then raise exception 'Banco ainda não conciliado';end if;
  db_name:='erp_'||replace(c.id::text,'-','');ref:='ERP_TENANT_'||upper(replace(c.id::text,'-',''))||'_URL';
  update erp_control.companies set data_location='tenant',provisioning='ready',database_identity=db_name,credential_ref=ref,schema_version=report->>'schema_version',health_checked_at=now(),provisioning_note='Banco exclusivo verificado e dados conciliados.',version=version+1,updated_at=now() where id=c.id;
  next_status:='activated';
 elsif step='fail' then
  next_status:='failed';update erp_control.cutovers set failure_code=case when report->>'code' in ('SOURCE_CHANGED','RECONCILIATION_FAILED','IDENTITY_MISMATCH','CONNECTION_FAILED','AUTHORIZATION_EXPIRED') then report->>'code' else 'MIGRATION_FAILED' end where id=job;
  update erp_control.companies set provisioning='failed',provisioning_note='Migração interrompida. Escrita legada permanece bloqueada para evitar divergência.',version=version+1,updated_at=now() where id=c.id;
 else raise exception 'Etapa desconhecida';end if;
 update erp_control.cutovers set status=next_status,updated_at=now() where id=job;
 insert into erp_control.audit(actor_id,company_id,action,entity,after_data,reason,result,correlation_id)
 values(j.requested_by,j.company_id,'tenant.cutover.'||step,job::text,jsonb_build_object('status',next_status,'source_digest',case when step in ('verify','activate') then report->>'source_digest' end),j.reason,case when step='fail' then 'failed' else 'success' end,j.correlation_id);
 return jsonb_build_object('status',next_status,'company',j.company_id,'actor',j.requested_by,'correlation',j.correlation_id);
end $$;
revoke all on function erp_control.cutover_step(uuid,text,jsonb) from public,anon,authenticated;

-- Read-only progress for the global ADM. Session IDs and operator secrets stay private.
create function erp_control.read_cutover(b uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.require_admin(false);c erp_control.companies;j jsonb;
begin
 select * into c from erp_control.companies where id=b;
 if c.id is null then raise exception 'Empresa indisponível' using errcode='42501';end if;
 select jsonb_build_object('id',id,'status',status,'requested_at',requested_at,'updated_at',updated_at,'counts',counts,'failure_code',failure_code,'correlation_id',correlation_id)
 into j from erp_control.cutovers where company_id=b and status<>'cancelled';
 insert into erp_control.audit(actor_id,company_id,action,entity,result,correlation_id) values(u,b,'tenant.cutover.read',b::text,'success',gen_random_uuid());
 return jsonb_build_object('company',c.id,'name',(select name from public.business_units where id=c.id),'version',c.version,'location',c.data_location,'provisioning',c.provisioning,'job',j);
end $$;
create function public.erp_read_cutover(p_company uuid) returns jsonb language sql security invoker set search_path='' as $$
 select erp_control.read_cutover(p_company)
$$;
revoke all on function erp_control.read_cutover(uuid),public.erp_read_cutover(uuid) from public,anon;
grant execute on function erp_control.read_cutover(uuid),public.erp_read_cutover(uuid) to authenticated;
