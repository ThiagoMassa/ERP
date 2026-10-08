-- Central authorization and audit only. Native backup tools run in the private operator.
alter table erp_control.companies add column access_epoch uuid not null default '00000000-0000-0000-0000-000000000000';
alter function erp_control.tenant_context(uuid) rename to tenant_context_base;
revoke all on function erp_control.tenant_context_base(uuid) from public,anon,authenticated;
create function erp_control.tenant_context(b uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin return erp_control.tenant_context_base(b)||jsonb_build_object('access_epoch',(select access_epoch from erp_control.companies where id=b));end $$;
revoke all on function erp_control.tenant_context(uuid) from public,anon;
grant execute on function erp_control.tenant_context(uuid) to authenticated;

alter table erp_control.backups add column size_bytes bigint check(size_bytes>0),add column key_id text;
create table erp_control.maintenance_jobs(
 id uuid primary key,company_id uuid not null references erp_control.companies(id),kind text not null check(kind in ('backup','restore')),
 backup_id uuid not null references erp_control.backups(id),safety_id uuid references erp_control.backups(id),
 actor_id uuid not null references auth.users(id),session_id uuid not null,token_issued_at timestamptz not null,
 authorized_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 reason text not null check(length(trim(reason)) between 10 and 1000),retention_days integer not null check(retention_days between 1 and 3650),
 request_hash text not null,status text not null default 'requested' check(status in ('requested','running','complete','failed')),
 stage text not null default 'requested' check(stage in ('requested','running','safety','restoring','restored','activating','complete','failed')),
 access_epoch uuid not null,failure_code text,
 check((kind='restore')=(safety_id is not null))
);
create unique index maintenance_one_active on erp_control.maintenance_jobs(company_id) where status in ('requested','running') or (kind='restore' and status='failed');
alter table erp_control.maintenance_jobs enable row level security;
revoke all on erp_control.maintenance_jobs from public,anon,authenticated;

create function erp_control.request_maintenance(requested_kind text,b uuid,backup uuid,days integer,expected_version integer,why text,confirm_company uuid,confirm_backup uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid;c erp_control.companies;j erp_control.maintenance_jobs;safety uuid;hash text;message text;
begin
 begin
 u:=erp_control.require_admin(true);
 if requested_kind is null or requested_kind not in ('backup','restore') or request_id is null or why is null or length(trim(why)) not between 10 and 1000 or days is null or days not between 1 and 3650 then raise exception 'Solicitação ou justificativa inválida.';end if;
 if requested_kind='restore' and (b is distinct from confirm_company or backup is null or backup is distinct from confirm_backup) then raise exception 'Confirme a empresa e o backup antes de restaurar.';end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('kind',requested_kind,'company',b,'backup',backup,'days',days,'reason',trim(why),'actor',u)::text,'UTF8')),'hex');
 select * into c from erp_control.companies where id=b for update;
 if c.id is null then raise exception 'Empresa não encontrada.';end if;
 select * into j from erp_control.maintenance_jobs where id=request_id for update;
 if j.id is not null then
  if j.company_id<>b or j.request_hash<>hash then raise exception 'Identificador já utilizado por outra solicitação.';end if;
  if j.status<>'complete' then
   update erp_control.maintenance_jobs set status=case when status='failed' then 'requested' else status end,authorized_at=now(),session_id=(auth.jwt()->>'session_id')::uuid,token_issued_at=to_timestamp((auth.jwt()->>'iat')::bigint),failure_code=null,updated_at=now() where id=j.id returning * into j;
   insert into erp_control.audit(actor_id,company_id,action,entity,reason,result,correlation_id) values(u,b,'maintenance.reauthorize',j.id::text,trim(why),'success',j.id);
  end if;
  return jsonb_build_object('ok',true,'job',j.id,'status',j.status);
 end if;
 if c.version is distinct from expected_version then raise exception 'Empresa alterada. Atualize antes de continuar.';end if;
 if c.provisioning<>'ready' or c.database_identity is distinct from 'erp_'||replace(b::text,'-','') then raise exception 'Banco exclusivo ainda não está pronto.';end if;
 if exists(select 1 from erp_control.maintenance_jobs where company_id=b and (status in ('requested','running') or kind='restore' and status='failed')) then raise exception 'Já existe manutenção pendente nesta empresa. Acompanhe ou retome a solicitação.';end if;
 if requested_kind='backup' then
  backup:=request_id;
  insert into erp_control.backups(id,company_id,status,note) values(backup,b,'requested',trim(why));
 else
  if not exists(select 1 from erp_control.backups where id=backup and company_id=b and status='verified' and retention_until>now()) then raise exception 'Backup verificado e dentro da retenção não encontrado para esta empresa.';end if;
  safety:=gen_random_uuid();
  insert into erp_control.backups(id,company_id,status,note) values(safety,b,'requested','Cópia de segurança anterior à restauração '||request_id::text);
  update erp_control.companies set provisioning='suspended',access_epoch=gen_random_uuid(),version=version+1,updated_at=now(),provisioning_note='Restauração autorizada. Operações suspensas até a conclusão verificada.' where id=b returning * into c;
 end if;
 insert into erp_control.maintenance_jobs(id,company_id,kind,backup_id,safety_id,actor_id,session_id,token_issued_at,reason,retention_days,request_hash,access_epoch)
 values(request_id,b,requested_kind,backup,safety,u,(auth.jwt()->>'session_id')::uuid,to_timestamp((auth.jwt()->>'iat')::bigint),trim(why),days,hash,c.access_epoch);
 insert into erp_control.audit(actor_id,company_id,action,entity,before_data,after_data,reason,result,correlation_id)
 values(u,b,'maintenance.request.'||requested_kind,request_id::text,jsonb_build_object('provisioning','ready'),jsonb_build_object('backup',backup,'safety',safety,'provisioning',c.provisioning),trim(why),'success',request_id);
 return jsonb_build_object('ok',true,'job',request_id,'status','requested');
 exception when others then message:=sqlerrm;end;
 insert into erp_control.audit(actor_id,company_id,action,entity,reason,result,correlation_id) values(auth.uid(),b,'maintenance.request.denied',request_id::text,left(why,1000),'denied',coalesce(request_id,gen_random_uuid()));
 return jsonb_build_object('ok',false,'error',message);
end $$;

create function erp_control.authorize_maintenance(job uuid) returns erp_control.maintenance_jobs language plpgsql security definer set search_path='' as $$
declare j erp_control.maintenance_jobs;
begin
 select * into j from erp_control.maintenance_jobs where id=job;
 if j.id is null then raise exception 'Manutenção não encontrada.';end if;
 if j.authorized_at<now()-interval '10 minutes' or
 not exists(select 1 from erp_control.administrators where user_id=j.actor_id and active) or
 exists(select 1 from erp_control.user_access where user_id=j.actor_id and (status<>'active' or j.token_issued_at<=revoked_before)) or
 not exists(select 1 from auth.mfa_factors where user_id=j.actor_id and status='verified') or
 not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=j.session_id and s.user_id=j.actor_id and s.aal='aal2' and s.created_at>now()-interval '24 hours' and (s.not_after is null or s.not_after>now()) and (u.banned_until is null or u.banned_until<now())) then raise exception 'Confirme novamente a manutenção com MFA.' using errcode='42501';end if;
 return j;
end $$;

create function erp_control.maintenance_step(job uuid,step text,report jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j erp_control.maintenance_jobs;c erp_control.companies;artifact uuid;changed erp_control.backups;previous jsonb;
begin
 select company_id into c.id from erp_control.maintenance_jobs where id=job;
 select * into c from erp_control.companies where id=c.id for update;
 select * into j from erp_control.maintenance_jobs where id=job for update;
 if j.id is null then raise exception 'Manutenção não encontrada.';end if;
 if j.status='complete' then return to_jsonb(j)-'session_id'-'token_issued_at'-'request_hash';end if;
 if step<>'fail' then perform erp_control.authorize_maintenance(job);end if;
 previous:=jsonb_build_object('status',j.status,'stage',j.stage);
 if step='start' then
  if (j.kind='backup' and c.provisioning<>'ready') or (j.kind='restore' and (c.provisioning<>'suspended' or c.access_epoch<>j.access_epoch)) then raise exception 'Estado empresarial incompatível com a manutenção.';end if;
  j.status:='running';if j.stage in ('requested','failed') then j.stage:='running';end if;
 elsif step='artifact' then
  if j.status<>'running' then raise exception 'Manutenção não iniciada.';end if;
  artifact:=nullif(report->>'id','')::uuid;
  if artifact is distinct from (case when j.kind='backup' then j.backup_id else j.safety_id end) or report->>'company' is distinct from j.company_id::text or report->>'sha256' is null or report->>'sha256'!~'^[0-9a-f]{64}$' or nullif(report->>'verified_at','') is null or nullif(report->>'created_at','') is null or nullif(report->>'retention_until','') is null or coalesce((report->>'bytes')::bigint,0)<=0 or report->>'key_id' is null or report->>'key_id'!~'^[A-Za-z0-9_-]{1,64}$' then raise exception 'Artefato verificado inválido.';end if;
  select * into changed from erp_control.backups where id=artifact and company_id=j.company_id for update;
  if changed.status='verified' and changed.checksum is distinct from report->>'sha256' then raise exception 'Artefato registrado não pode ser substituído.';end if;
  update erp_control.backups set status='verified',created_at=(report->>'created_at')::timestamptz,verified_at=(report->>'verified_at')::timestamptz,retention_until=(report->>'retention_until')::timestamptz,artifact_ref='tenant-backup/'||j.company_id::text||'/'||artifact::text,checksum=report->>'sha256',size_bytes=(report->>'bytes')::bigint,key_id=report->>'key_id' where id=artifact;
  if j.kind='backup' then j.status:='complete';j.stage:='complete';else j.stage:='safety';end if;
 elsif step='restoring' then
  if j.kind<>'restore' or j.status<>'running' or not exists(select 1 from erp_control.backups where id=j.safety_id and status='verified') then raise exception 'Cópia de segurança não verificada.';end if;
  j.stage:='restoring';
 elsif step='restored' then
  if j.kind<>'restore' or j.status<>'running' or j.stage not in ('restoring','restored','activating') or report->>'backup' is distinct from j.backup_id::text or report->>'safety' is distinct from j.safety_id::text then raise exception 'Confirmação da restauração inválida.';end if;
  j.stage:='restored';
 elsif step='release' then
  if j.kind<>'restore' or j.status<>'running' or j.stage not in ('restored','activating') then raise exception 'Banco ainda não restaurado e conferido.';end if;
  j.stage:='activating';
 elsif step='complete' then
  if j.kind<>'restore' or j.status<>'running' or j.stage<>'activating' or c.access_epoch<>j.access_epoch then raise exception 'Liberação da manutenção inválida.';end if;
  update erp_control.companies set provisioning='ready',provisioning_note='Restauração verificada e auditada.',health_checked_at=now(),version=version+1,updated_at=now() where id=c.id;
  j.stage:='complete';j.status:='complete';
 elsif step='fail' then
  j.status:='failed';j.failure_code:=case when report->>'code' in ('BACKUP_INTEGRITY','BACKUP_AUTHENTICATION','BACKUP_RECONCILIATION','IDENTITY_MISMATCH','AUTHORIZATION_EXPIRED') then report->>'code' else 'MAINTENANCE_FAILED' end;
  if j.kind='backup' then update erp_control.backups set status='failed' where id=j.backup_id and status<>'verified';end if;
 else raise exception 'Etapa de manutenção desconhecida.';end if;
 update erp_control.maintenance_jobs set status=j.status,stage=j.stage,failure_code=j.failure_code,updated_at=now() where id=job;
 insert into erp_control.audit(actor_id,company_id,action,entity,before_data,after_data,reason,result,correlation_id) values(j.actor_id,j.company_id,'maintenance.'||j.kind||'.'||step,job::text,previous,jsonb_build_object('status',j.status,'stage',j.stage,'backup',j.backup_id,'safety',j.safety_id),j.reason,case when step='fail' then 'failed' else 'success' end,job);
 return to_jsonb(j)-'session_id'-'token_issued_at'-'request_hash';
end $$;

create function erp_control.read_maintenance(b uuid,p integer default 0,jp integer default 0,filter_status text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=erp_control.require_admin(false);result jsonb;
begin
 if b is null then raise exception 'Selecione uma empresa.';end if;
 if p is null or jp is null or p not between 0 and 100000 or jp not between 0 and 100000 or (filter_status is not null and filter_status not in ('requested','running','verified','failed')) then raise exception 'Filtros inválidos.';end if;
 select jsonb_build_object('company',c.id,'name',bu.name,'version',c.version,'provisioning',c.provisioning,
 'backup_count',(select count(*) from erp_control.backups where company_id=b and (filter_status is null or status=filter_status)),
 'job_count',(select count(*) from erp_control.maintenance_jobs where company_id=b),
 'busy',exists(select 1 from erp_control.maintenance_jobs where company_id=b and (status in ('requested','running') or kind='restore' and status='failed')),
 'backups',(select coalesce(jsonb_agg(x),'[]') from (select id,status,created_at,verified_at,retention_until,size_bytes,note,coalesce(retention_until<=now(),false) as expired,(status='verified' and retention_until>now()) as restore_eligible from erp_control.backups where company_id=b and (filter_status is null or status=filter_status) order by created_at desc,id limit 20 offset p*20) x),
 'jobs',(select coalesce(jsonb_agg(x),'[]') from (select id,kind,backup_id,safety_id,status,stage,reason,retention_days,failure_code,created_at,updated_at,actor_id from erp_control.maintenance_jobs where company_id=b order by created_at desc,id limit 20 offset jp*20) x)) into result
 from erp_control.companies c join public.business_units bu on bu.id=c.id where c.id=b;
 if result is null then raise exception 'Empresa não encontrada.';end if;
 insert into erp_control.audit(actor_id,company_id,action,result) values(actor,b,'maintenance.inspect','success');
 return result;
end $$;
create function public.erp_request_maintenance(p_kind text,p_company uuid,p_backup uuid,p_retention integer,p_version integer,p_reason text,p_confirm_company uuid,p_confirm_backup uuid,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$select erp_control.request_maintenance(p_kind,p_company,p_backup,p_retention,p_version,p_reason,p_confirm_company,p_confirm_backup,p_key)$$;
create function public.erp_read_maintenance(p_company uuid,p_page integer default 0,p_job_page integer default 0,p_status text default null) returns jsonb language sql security invoker set search_path='' as $$select erp_control.read_maintenance(p_company,p_page,p_job_page,p_status)$$;
revoke all on function erp_control.request_maintenance(text,uuid,uuid,integer,integer,text,uuid,uuid,uuid),erp_control.authorize_maintenance(uuid),erp_control.maintenance_step(uuid,text,jsonb),erp_control.read_maintenance(uuid,integer,integer,text),public.erp_request_maintenance(text,uuid,uuid,integer,integer,text,uuid,uuid,uuid),public.erp_read_maintenance(uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function erp_control.request_maintenance(text,uuid,uuid,integer,integer,text,uuid,uuid,uuid),erp_control.read_maintenance(uuid,integer,integer,text),public.erp_request_maintenance(text,uuid,uuid,integer,integer,text,uuid,uuid,uuid),public.erp_read_maintenance(uuid,integer,integer,text) to authenticated;
