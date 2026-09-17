-- Central administration. Operational data stays untouched until tenant cutover.
create schema if not exists erp_control;
revoke all on schema erp_control from public,anon,authenticated;
create table erp_control.administrators (
 user_id uuid primary key references auth.users(id), active boolean not null default true,
 granted_at timestamptz not null default now()
);
create table erp_control.user_access (
 user_id uuid primary key references auth.users(id), status text not null default 'active' check(status in ('active','blocked','suspended')),
 revoked_before timestamptz, version integer not null default 1, updated_at timestamptz not null default now()
);
create table erp_control.companies (
 id uuid primary key references public.business_units(id), status text not null default 'active' check(status in ('active','suspended')),
 legal_name text not null default '', document text not null default '',
 provisioning text not null default 'pending' check(provisioning in ('pending','provisioning','ready','failed','suspended')),
 database_identity text unique, credential_ref text unique, schema_version text,
 health_checked_at timestamptz, provisioning_note text not null default 'Banco exclusivo ainda não provisionado. Dados existentes permanecem na base legada.',
 version integer not null default 1, updated_at timestamptz not null default now(),
 check(provisioning<>'ready' or (database_identity is not null and credential_ref is not null and health_checked_at is not null))
);
insert into erp_control.companies(id) select id from public.business_units on conflict do nothing;
create table erp_control.memberships (
 company_id uuid not null references public.business_units(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('admin','sales','purchases','stock','finance','read')), active boolean not null default true,
 version integer not null default 1, primary key(company_id,user_id)
);
insert into erp_control.memberships(company_id,user_id,role) select id,owner_id,'admin' from public.business_units on conflict do nothing;
create index control_members_user on erp_control.memberships(user_id,company_id);
create table erp_control.permissions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.business_units(id),
 scope text not null check(scope in ('company','role','user')), subject text not null,
 module text not null check(module in ('overview','sales','purchases','catalog','stock','finance','production','settings')),
 action text not null check(action in ('available','visible','read','create','edit','delete','approve','cancel','reverse','export')),
 allowed boolean not null, version integer not null default 1, unique(company_id,scope,subject,module,action),
 check(scope<>'company' or subject='*'),
 check(scope<>'role' or subject in ('admin','sales','purchases','stock','finance','read'))
);
create table erp_control.audit (
 id bigint generated always as identity primary key, occurred_at timestamptz not null default now(),
 actor_id uuid, company_id uuid, subject_id uuid, action text not null, entity text,
 before_data jsonb, after_data jsonb, reason text, result text not null check(result in ('success','denied','failed')),
 correlation_id uuid not null default gen_random_uuid()
);
create index control_audit_date on erp_control.audit(occurred_at desc,id desc);
create index control_audit_company on erp_control.audit(company_id,occurred_at desc);
create table erp_control.backups (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.business_units(id),
 status text not null check(status in ('requested','running','verified','failed')), created_at timestamptz not null default now(),
 verified_at timestamptz, retention_until timestamptz, artifact_ref text, checksum text, note text not null default '',
 check(status<>'verified' or (verified_at is not null and artifact_ref is not null and checksum is not null))
);
create index control_backups_company on erp_control.backups(company_id,created_at desc);
do $$ declare t text; begin
 foreach t in array array['administrators','user_access','companies','memberships','permissions','audit','backups'] loop
 execute format('alter table erp_control.%I enable row level security',t);
 execute format('revoke all on erp_control.%I from public,anon,authenticated',t);
 end loop;
end $$;

create function erp_control.actor() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j jsonb:=auth.jwt();
begin
 if u is null or coalesce((j->>'exp')::bigint,0)<=extract(epoch from now()) then raise exception 'Sessão expirada. Entre novamente.' using errcode='28000';end if;
 if not exists(select 1 from auth.sessions s join auth.users a on a.id=s.user_id
 where s.id=(j->>'session_id')::uuid and s.user_id=u
 and (s.not_after is null or s.not_after>now()) and (a.banned_until is null or a.banned_until<now())
 and s.created_at>now()-interval '24 hours') then raise exception 'Sessão revogada ou expirada. Entre novamente.' using errcode='28000';end if;
 if exists(select 1 from erp_control.user_access x where x.user_id=u and
 (x.status<>'active' or to_timestamp((j->>'iat')::bigint)<=x.revoked_before)) then
 raise exception 'Acesso suspenso ou sessão revogada.' using errcode='28000';end if;
 return u;
end $$;

create function erp_control.require_admin(fresh boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.actor(); j jsonb:=auth.jwt(); verified_at numeric;
begin
 if not exists(select 1 from erp_control.administrators where user_id=u and active) then raise exception 'Acesso exclusivo do ADM global.' using errcode='42501';end if;
 if coalesce(j->>'aal','aal1')<>'aal2' or not exists(select 1 from auth.sessions s where s.id=(j->>'session_id')::uuid and s.user_id=u and s.aal='aal2')
 or not exists(select 1 from auth.mfa_factors f where f.user_id=u and f.status='verified') then
 raise exception 'Autenticação em dois fatores obrigatória.' using errcode='42501';end if;
 if fresh then
 select max((v->>'timestamp')::numeric) into verified_at from jsonb_array_elements(coalesce(j->'amr','[]')) v where v->>'method'='totp';
 if verified_at is null or verified_at<extract(epoch from now()-interval '5 minutes') or verified_at>extract(epoch from now()+interval '30 seconds') then raise exception 'Confirme novamente o código de dois fatores para esta operação.' using errcode='42501';end if;
 end if;
 return u;
end $$;

-- Deny always wins, including a disabled company module. Unknown operations deny.
create function erp_control.effective(p_company uuid,p_user uuid,p_module text,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text; matches jsonb; permitted boolean;
begin
 if p_module not in ('overview','sales','purchases','catalog','stock','finance','production','settings') or p_action not in ('available','visible','read','create','edit','delete','approve','cancel','reverse','export') then return jsonb_build_object('allowed',false,'origin','Função desconhecida');end if;
 if not exists(select 1 from erp_control.companies where id=p_company and status='active') then return jsonb_build_object('allowed',false,'origin','Empresa suspensa ou não cadastrada');end if;
 if exists(select 1 from erp_control.user_access where user_id=p_user and status<>'active') then return jsonb_build_object('allowed',false,'origin','Conta bloqueada');end if;
 select role into r from erp_control.memberships where company_id=p_company and user_id=p_user and active;
 if r is null then return jsonb_build_object('allowed',false,'origin','Sem vínculo ativo');end if;
 select jsonb_agg(jsonb_build_object('scope',scope,'action',action,'allowed',allowed)) into matches from erp_control.permissions
 where company_id=p_company and module=p_module and action in (p_action,'available') and
 (scope='company' or scope='role' and subject=r or scope='user' and subject=p_user::text);
 if exists(select 1 from jsonb_array_elements(coalesce(matches,'[]')) x where x->>'allowed'='false') then return jsonb_build_object('allowed',false,'origin','Bloqueio explícito','rules',matches);end if;
 if exists(select 1 from jsonb_array_elements(coalesce(matches,'[]')) x where x->>'action'=p_action and x->>'allowed'='true') then return jsonb_build_object('allowed',true,'origin','Permissão explícita','rules',matches);end if;
 permitted:=r='admin' or (p_action in ('available','visible','read') and p_module<>'settings') or r=p_module or r='stock' and p_module='production' or p_module='catalog' and r in ('sales','purchases','stock');
 return jsonb_build_object('allowed',permitted,'origin','Perfil: '||r,'rules',coalesce(matches,'[]'));
end $$;

create function erp_control.read(p_section text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; result jsonb; count_rows bigint; lim integer:=least(100,greatest(1,coalesce((p_filters->>'size')::integer,20))); offst integer:=greatest(0,coalesce((p_filters->>'page')::integer,0))*lim; q text:=left(coalesce(p_filters->>'query',''),160); b uuid:=nullif(p_filters->>'company','')::uuid;
begin
 if p_section='context' then
 u:=erp_control.actor();return jsonb_build_object('eligible',exists(select 1 from erp_control.administrators where user_id=u and active),'aal',auth.jwt()->>'aal');
 end if;
 u:=erp_control.require_admin(false);
 if p_section='overview' then
 return jsonb_build_object('companies',(select count(*) from erp_control.companies),'active_companies',(select count(*) from erp_control.companies where status='active'),
 'suspended_companies',(select count(*) from erp_control.companies where status='suspended'),'users',(select count(*) from auth.users),
 'blocked_users',(select count(*) from erp_control.user_access where status<>'active'),'pending_users',(select count(*) from auth.users where email_confirmed_at is null),
 'pending_databases',(select count(*) from erp_control.companies where provisioning<>'ready'),'failed_databases',(select count(*) from erp_control.companies where provisioning='failed'),
 'recent_errors',(select count(*) from erp_control.audit au where au.result<>'success' and au.occurred_at>now()-interval '24 hours'),
 'recent_audit',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_control.audit order by id desc limit 10) x));
 elsif p_section='companies' then
 select count(*) into count_rows from erp_control.companies c join public.business_units bu on bu.id=c.id where bu.name ilike '%'||q||'%' and (b is null or c.id=b);
 select coalesce(jsonb_agg(x),'[]') into result from (select c.id,bu.name,bu.contact_email,c.legal_name,c.document,c.status,c.provisioning,c.provisioning_note,c.schema_version,c.health_checked_at,c.version,
 (select count(*) from erp_control.memberships m where m.company_id=c.id and m.active) as members,
 (select max(verified_at) from erp_control.backups bk where bk.company_id=c.id and status='verified') as last_backup
 from erp_control.companies c join public.business_units bu on bu.id=c.id where bu.name ilike '%'||q||'%' and (b is null or c.id=b) order by bu.name,c.id limit lim offset offst) x;
 elsif p_section='users' then
 select count(*) into count_rows from auth.users a where (coalesce(a.email,'') ilike '%'||q||'%' or a.id::text=q) and (b is null or exists(select 1 from erp_control.memberships m where m.user_id=a.id and m.company_id=b));
 select coalesce(jsonb_agg(x),'[]') into result from (select a.id,a.email,a.created_at,a.last_sign_in_at,a.email_confirmed_at,coalesce(ac.status,'active') status,coalesce(ac.version,0) version,
 (select coalesce(jsonb_agg(jsonb_build_object('company_id',m.company_id,'name',bu.name,'role',m.role,'active',m.active,'version',m.version)),'[]') from erp_control.memberships m join public.business_units bu on bu.id=m.company_id where m.user_id=a.id) memberships
 from auth.users a left join erp_control.user_access ac on ac.user_id=a.id where (coalesce(a.email,'') ilike '%'||q||'%' or a.id::text=q) and (b is null or exists(select 1 from erp_control.memberships m where m.user_id=a.id and m.company_id=b)) order by a.created_at desc,a.id limit lim offset offst) x;
 elsif p_section='audit' then
 select count(*) into count_rows from erp_control.audit a where (b is null or a.company_id=b) and a.action ilike '%'||q||'%';
 select coalesce(jsonb_agg(x),'[]') into result from (select * from erp_control.audit a where (b is null or a.company_id=b) and a.action ilike '%'||q||'%' order by id desc limit lim offset offst) x;
 elsif p_section='permissions' then
 if b is null then raise exception 'Selecione uma empresa.';end if;
 select count(*) into count_rows from erp_control.permissions where company_id=b;
 select coalesce(jsonb_agg(x),'[]') into result from (select * from erp_control.permissions where company_id=b order by module,action,scope,subject limit lim offset offst) x;
 elsif p_section='effective' then
 if b is null then raise exception 'Selecione uma empresa.';end if;
 return erp_control.effective(b,(p_filters->>'user')::uuid,p_filters->>'module',p_filters->>'action');
 elsif p_section='backups' then
 select count(*) into count_rows from erp_control.backups where b is null or company_id=b;
 select coalesce(jsonb_agg(x),'[]') into result from (select id,company_id,status,created_at,verified_at,retention_until,note from erp_control.backups where b is null or company_id=b order by created_at desc,id limit lim offset offst) x;
 else raise exception 'Seção administrativa desconhecida.';end if;
 return jsonb_build_object('rows',result,'count',count_rows);
end $$;

create function erp_control.command(p_action text,p_data jsonb,p_correlation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; b uuid:=nullif(p_data->>'company','')::uuid; target uuid:=nullif(p_data->>'user','')::uuid;
 why text:=trim(coalesce(p_data->>'reason','')); old_data jsonb; new_data jsonb; err text; v integer; changed uuid;
begin
 begin
 u:=erp_control.require_admin(p_action<>'access');
 if p_action='access' then null;
 else
 if length(why) not between 10 and 1000 then raise exception 'Descreva o motivo em 10 a 1000 caracteres.';end if;
 if p_action='user.status' or p_action='user.revoke' then
 if target=u then raise exception 'Não é permitido bloquear ou revogar a própria conta por este formulário.';end if;
 if not exists(select 1 from auth.users where id=target) then raise exception 'Usuário não encontrado.';end if;
 insert into erp_control.user_access(user_id) values(target) on conflict do nothing;
 select to_jsonb(a),a.version into old_data,v from erp_control.user_access a where user_id=target for update;
 if coalesce((p_data->>'version')::integer,0) not in (v,case when v=1 then 0 else v end) then raise exception 'Registro alterado. Atualize antes de salvar.';end if;
 if p_action='user.status' then update erp_control.user_access set status=p_data->>'status',revoked_before=now(),version=version+1,updated_at=now() where user_id=target;
 update auth.users set banned_until=case when p_data->>'status'='active' then null else 'infinity'::timestamptz end where id=target;
 else update erp_control.user_access set revoked_before=now(),version=version+1,updated_at=now() where user_id=target;end if;
 delete from auth.sessions where user_id=target;
 select to_jsonb(a) into new_data from erp_control.user_access a where user_id=target;
 elsif p_action='company.update' then
 select to_jsonb(c),c.version into old_data,v from erp_control.companies c where id=b for update;
 if v is null or v<>coalesce((p_data->>'version')::integer,0) then raise exception 'Registro alterado ou empresa indisponível. Atualize antes de salvar.';end if;
 update erp_control.companies set legal_name=left(coalesce(p_data->>'legal_name',legal_name),240),document=left(coalesce(p_data->>'document',document),40),status=coalesce(p_data->>'status',status),version=version+1,updated_at=now() where id=b;
 select to_jsonb(c)-'credential_ref'-'database_identity' into new_data from erp_control.companies c where id=b;
 old_data:=old_data-'credential_ref'-'database_identity';
 elsif p_action='membership.save' then
 if not exists(select 1 from erp_control.companies where id=b) then raise exception 'Empresa não encontrada.';end if;
 perform 1 from erp_control.companies where id=b for update;
 select to_jsonb(m),m.version into old_data,v from erp_control.memberships m where company_id=b and user_id=target;
 if coalesce(v,0)<>coalesce((p_data->>'version')::integer,0) then raise exception 'Vínculo alterado. Atualize antes de salvar.';end if;
 insert into erp_control.memberships(company_id,user_id,role,active) values(b,target,p_data->>'role',(p_data->>'active')::boolean)
 on conflict(company_id,user_id) do update set role=excluded.role,active=excluded.active,version=erp_control.memberships.version+1;
 select to_jsonb(m) into new_data from erp_control.memberships m where company_id=b and user_id=target;
 elsif p_action='permission.save' then
 perform 1 from erp_control.companies where id=b for update;
 if not found then raise exception 'Empresa não encontrada.';end if;
 if p_data->>'scope'='user' and not exists(select 1 from erp_control.memberships where company_id=b and user_id=(p_data->>'subject')::uuid) then raise exception 'Usuário sem vínculo nesta empresa.';end if;
 select to_jsonb(p),p.version into old_data,v from erp_control.permissions p where company_id=b and scope=p_data->>'scope' and subject=p_data->>'subject' and module=p_data->>'module' and action=p_data->>'action';
 if coalesce(v,0)<>coalesce((p_data->>'version')::integer,0) then raise exception 'Permissão alterada. Atualize antes de salvar.';end if;
 insert into erp_control.permissions(company_id,scope,subject,module,action,allowed) values(b,p_data->>'scope',p_data->>'subject',p_data->>'module',p_data->>'action',(p_data->>'allowed')::boolean)
 on conflict(company_id,scope,subject,module,action) do update set allowed=excluded.allowed,version=erp_control.permissions.version+1 returning id into changed;
 select to_jsonb(p) into new_data from erp_control.permissions p where id=changed;
 elsif p_action='provision.note' then
 select to_jsonb(c)-'credential_ref'-'database_identity',c.version into old_data,v from erp_control.companies c where id=b for update;
 if v is null or v<>coalesce((p_data->>'version')::integer,0) then raise exception 'Registro alterado. Atualize antes de salvar.';end if;
 if p_data->>'status' not in ('pending','provisioning','failed') then raise exception 'Somente a verificação do servidor pode liberar um banco como pronto.';end if;
 if old_data->>'provisioning'='ready' then raise exception 'Banco ativo exige fluxo de manutenção.';end if;
 update erp_control.companies set provisioning=p_data->>'status',provisioning_note=why,version=version+1,updated_at=now() where id=b;
 select to_jsonb(c)-'credential_ref'-'database_identity' into new_data from erp_control.companies c where id=b;
 else raise exception 'Operação administrativa desconhecida.';end if;
 end if;
 insert into erp_control.audit(actor_id,company_id,subject_id,action,before_data,after_data,reason,result,correlation_id) values(u,b,target,p_action,old_data,new_data,why,'success',p_correlation);
 return jsonb_build_object('ok',true);
 exception when others then
 get stacked diagnostics err=message_text;
 end;
 insert into erp_control.audit(actor_id,company_id,subject_id,action,reason,result,correlation_id) values(auth.uid(),b,target,left(p_action,100),left(why,1000),'denied',p_correlation);
 return jsonb_build_object('ok',false,'error',err);
end $$;

create function public.erp_admin_read(p_section text,p_filters jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select erp_control.read(p_section,p_filters) $$;
create function public.erp_admin_command(p_action text,p_data jsonb,p_correlation uuid) returns jsonb language sql security invoker set search_path='' as $$ select erp_control.command(p_action,p_data,p_correlation) $$;
revoke all on all functions in schema erp_control from public,anon,authenticated;
revoke all on function public.erp_admin_read(text,jsonb),public.erp_admin_command(text,jsonb,uuid) from public,anon;
grant usage on schema erp_control to authenticated;
grant execute on function erp_control.read(text,jsonb),erp_control.command(text,jsonb,uuid) to authenticated;
grant execute on function public.erp_admin_read(text,jsonb),public.erp_admin_command(text,jsonb,uuid) to authenticated;

-- Keep newly created legacy companies visible in the control plane.
create function erp_control.register_company() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into erp_control.companies(id) values(new.id) on conflict do nothing;
 insert into erp_control.memberships(company_id,user_id,role) values(new.id,new.owner_id,'admin') on conflict do nothing;
 return new;
end $$;
revoke all on function erp_control.register_company() from public,anon,authenticated;
create trigger register_control_company after insert on public.business_units for each row execute function erp_control.register_company();


