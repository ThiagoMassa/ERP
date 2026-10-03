-- Central registry API. Apply with the tenant cutover migration and the new web client.
-- Company metadata stays central; this never creates operational tables for a user.
create table erp_control.workspace_requests(
 actor_id uuid not null references auth.users(id),request_key uuid not null,
 company_id uuid not null references erp_control.companies(id),action text not null,permission_action text not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table erp_control.workspace_requests enable row level security;
revoke all on erp_control.workspace_requests from public,anon,authenticated;

create function erp_control.workspace_member(b uuid,allow_archived boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.actor();
begin
 if not exists(select 1 from erp_control.memberships m join erp_control.companies c on c.id=m.company_id join public.business_units bu on bu.id=c.id where m.company_id=b and m.user_id=u and m.active and c.status='active' and (allow_archived or bu.deleted_at is null)) then
  raise exception 'Empresa suspensa, arquivada ou vínculo indisponível.' using errcode='42501';
 end if;
 return u;
end $$;
create function erp_control.workspace_permission(b uuid,m text,a text) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.workspace_member(b,true);
begin
 if not coalesce((erp_control.effective(b,u,m,a)->>'allowed')::boolean,false) then raise exception 'Sem permissão para esta ação.' using errcode='42501';end if;
end $$;

create function erp_control.workspace_read(b uuid,module text,filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.actor();result jsonb;total bigint;m text;a text;actions jsonb;permissions jsonb:='{}';
 lim integer:=coalesce((filters->>'size')::integer,20);page integer:=coalesce((filters->>'page')::integer,0);q text:=coalesce(filters->>'query','');
begin
 if filters is null or jsonb_typeof(filters)<>'object' or length(filters::text)>20000 or lim not between 1 and 100 or page not between 0 and 100000 or length(q)>160 then raise exception 'Filtros inválidos.';end if;
 if module='businesses' then
  select count(*) into total from erp_control.companies c join public.business_units bu on bu.id=c.id join erp_control.memberships x on x.company_id=c.id and x.user_id=u and x.active where bu.name ilike '%'||q||'%';
  select coalesce(jsonb_agg(r),'[]') into result from (
   select bu.id,bu.owner_id,bu.name,bu.model,bu.description,bu.contact_email,bu.phone,bu.created_at,bu.deleted_at,c.status,c.provisioning,c.provisioning_note,c.version,x.role,
    coalesce((erp_control.effective(c.id,u,'settings','edit')->>'allowed')::boolean,false) as can_edit,
    coalesce((erp_control.effective(c.id,u,'settings','delete')->>'allowed')::boolean,false) as can_archive
   from erp_control.companies c join public.business_units bu on bu.id=c.id join erp_control.memberships x on x.company_id=c.id and x.user_id=u and x.active
   where bu.name ilike '%'||q||'%' order by bu.created_at,bu.id limit lim offset page*lim
  ) r;
  return jsonb_build_object('rows',result,'count',total);
 end if;
 perform erp_control.workspace_member(b,module='permissions');
 if module='permissions' then
  foreach m in array array['overview','sales','purchases','catalog','stock','finance','production','settings'] loop
   actions:='{}';foreach a in array array['available','visible','read','create','edit','delete','approve','cancel','reverse','export'] loop
    actions:=actions||jsonb_build_object(a,erp_control.effective(b,u,m,a));
   end loop;permissions:=permissions||jsonb_build_object(m,actions);
  end loop;return permissions;
 elsif module='members' then
  perform erp_control.workspace_permission(b,'settings','read');
  if coalesce((filters->>'export')::boolean,false) then perform erp_control.workspace_permission(b,'settings','export');end if;
  select count(*) into total from erp_control.memberships x join auth.users au on au.id=x.user_id where company_id=b and (au.email ilike '%'||q||'%' or x.user_id::text=q);
  select coalesce(jsonb_agg(r),'[]') into result from (
   select x.user_id as id,au.email,x.role,x.active,x.version from erp_control.memberships x join auth.users au on au.id=x.user_id
   where company_id=b and (au.email ilike '%'||q||'%' or x.user_id::text=q) order by au.email,x.user_id limit lim offset page*lim
  ) r;
  if coalesce((filters->>'export')::boolean,false) then insert into erp_control.audit(actor_id,company_id,action,entity,after_data,result) values(u,b,'export.page','members',jsonb_build_object('page',page,'size',lim,'returned',jsonb_array_length(result)),'success');end if;
  return jsonb_build_object('rows',result,'count',total);
 end if;
 raise exception 'Consulta central desconhecida.' using errcode='42501';
end $$;

create function erp_control.workspace_command(b uuid,a text,d jsonb,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.actor();prior erp_control.workspace_requests;c erp_control.companies;target uuid;verb text;v integer;old_data jsonb;new_data jsonb;result jsonb;owner uuid;created boolean:=false;
begin
 if a is null or a not in ('business.save','business.archive','business.restore','member.save') or request_id is null or d is null or jsonb_typeof(d)<>'object' or length(d::text)>20000 then raise exception 'Solicitação central inválida.';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||'/'||request_id::text,0));
 select * into prior from erp_control.workspace_requests where actor_id=u and request_key=request_id;
 if b is null and a='business.save' then
  if prior.request_key is not null then b:=prior.company_id;
  else
   b:=request_id;
   if exists(select 1 from erp_control.companies where id=b) then raise exception 'Identificador indisponível.';end if;
   if d->>'name' is null or length(trim(d->>'name')) not between 1 and 80 or d->>'model' is null or d->>'model' not in ('printing','mechanic','food','lodging','retail','service') or length(coalesce(d->>'description',''))>1000 or length(coalesce(d->>'contact_email',''))>254 or length(coalesce(d->>'phone',''))>40 then raise exception 'Confira os dados do negócio.';end if;
   insert into public.business_units(id,owner_id,name,model,description,contact_email,phone) values(b,u,trim(d->>'name'),d->>'model',coalesce(d->>'description',''),coalesce(d->>'contact_email',''),coalesce(d->>'phone',''));
   created:=true;
  end if;
 end if;
 select * into c from erp_control.companies where id=b for update;
 perform erp_control.workspace_member(b,a like 'business.%');
 if c.data_location='migrating' then raise exception 'Aguarde a conclusão da migração para alterar o cadastro.' using errcode='55000';end if;
 select owner_id into owner from public.business_units where id=b;
 if a='member.save' then
  if d->>'email' is null or length(trim(d->>'email')) not between 3 and 254 then raise exception 'Informe o e-mail da conta cadastrada.';end if;
  select id into target from auth.users where lower(email)=lower(trim(d->>'email'));
  if target is null then raise exception 'A pessoa precisa criar uma conta antes de ser vinculada.';end if;
  verb:=case when exists(select 1 from erp_control.memberships where company_id=b and user_id=target) then 'edit' else 'create' end;
 else verb:=case when created then 'create' when a='business.archive' then 'delete' else 'edit' end;
 end if;
 verb:=coalesce(prior.permission_action,verb);
 perform erp_control.workspace_permission(b,'settings',verb);
 if prior.request_key is not null then
  if prior.company_id<>b or prior.action<>a or prior.payload<>d then raise exception 'Identificador já utilizado por outra operação.';end if;
  return prior.result;
 end if;
 if a='member.save' then
  if target=owner or target=u then raise exception 'O vínculo do proprietário e seu próprio perfil devem ser administrados pelo ADM global.';end if;
  if not exists(select 1 from erp_control.memberships where company_id=b and user_id=u and active and role='admin') then raise exception 'Somente o administrador da empresa gerencia os vínculos.' using errcode='42501';end if;
  if d->>'role' is null or d->>'role' not in ('admin','sales','purchases','stock','finance','read') or d->>'active' is null or d->>'active' not in ('true','false') then raise exception 'Perfil ou situação de vínculo inválidos.';end if;
  select to_jsonb(x),x.version into old_data,v from erp_control.memberships x where company_id=b and user_id=target;
  if coalesce(v,0) is distinct from (d->>'version')::integer then raise exception 'Vínculo alterado. Atualize antes de salvar.' using errcode='40001';end if;
  insert into erp_control.memberships(company_id,user_id,role,active) values(b,target,d->>'role',(d->>'active')::boolean)
  on conflict(company_id,user_id) do update set role=excluded.role,active=excluded.active,version=erp_control.memberships.version+1;
  select to_jsonb(x) into new_data from erp_control.memberships x where company_id=b and user_id=target;
  result:=jsonb_build_object('id',target,'version',new_data->'version');
 else
  if not created and c.version is distinct from (d->>'version')::integer then raise exception 'Negócio alterado. Atualize antes de salvar.' using errcode='40001';end if;
  select to_jsonb(bu) into old_data from public.business_units bu where id=b;
  if a='business.save' then
   if d->>'name' is null or length(trim(d->>'name')) not between 1 and 80 or d->>'model' is null or d->>'model' not in ('printing','mechanic','food','lodging','retail','service') or length(coalesce(d->>'description',''))>1000 or length(coalesce(d->>'contact_email',''))>254 or length(coalesce(d->>'phone',''))>40 then raise exception 'Confira os dados do negócio.';end if;
   if not created then update public.business_units set name=trim(d->>'name'),model=d->>'model',description=coalesce(d->>'description',''),contact_email=coalesce(d->>'contact_email',''),phone=coalesce(d->>'phone','') where id=b;end if;
  else
   update public.business_units set deleted_at=case when a='business.archive' then now() else null end where id=b;
  end if;
  if not created then update erp_control.companies set version=version+1,updated_at=now() where id=b returning * into c;end if;
  select to_jsonb(bu) into new_data from public.business_units bu where id=b;
  result:=jsonb_build_object('id',b,'version',c.version,'provisioning',c.provisioning);
 end if;
 insert into erp_control.workspace_requests(actor_id,request_key,company_id,action,permission_action,payload,result) values(u,request_id,b,a,verb,d,result);
 insert into erp_control.audit(actor_id,company_id,subject_id,action,entity,before_data,after_data,reason,result,correlation_id)
 values(u,b,target,'workspace.'||a,coalesce(target,b)::text,case when created then null else old_data end,new_data,'Alteração pelo administrador da empresa','success',request_id);
 return result;
end $$;

-- Central metadata can evolve after cutover; legacy operational rows remain frozen.
create or replace function erp_control.legacy_write_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare old_b uuid;new_b uuid;b uuid;location text;
begin
 if tg_table_name='business_units' then
  if tg_op<>'INSERT' then old_b:=old.id;end if;if tg_op<>'DELETE' then new_b:=new.id;end if;
 elsif tg_table_name in ('products','entries') then
  if tg_op<>'INSERT' then old_b:=old.business_id;end if;if tg_op<>'DELETE' then new_b:=new.business_id;end if;
 elsif tg_table_name='stock_movements' then
  if tg_op<>'INSERT' then select business_id into old_b from public.products where id=old.product_id;end if;
  if tg_op<>'DELETE' then select business_id into new_b from public.products where id=new.product_id;end if;
 else raise exception 'Tabela não autorizada para corte';end if;
 for b in select distinct value from unnest(array[old_b,new_b]) value where value is not null order by value loop
  select data_location into location from erp_control.companies where id=b for share;
  if location is not null and location<>'legacy' then
   if tg_table_name='business_units' and tg_op='UPDATE' and location='tenant' then
    if old.id=new.id and old.owner_id=new.owner_id and old.created_at=new.created_at then continue;end if;
   end if;
   raise exception 'Empresa em migração ou com dados no banco exclusivo.' using errcode='55000';
  end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;

create function public.erp_workspace_read(p_company uuid,p_module text,p_filters jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select erp_control.workspace_read(p_company,p_module,p_filters)$$;
create function public.erp_workspace_command(p_company uuid,p_action text,p_data jsonb,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$select erp_control.workspace_command(p_company,p_action,p_data,p_key)$$;
revoke all on function erp_control.workspace_member(uuid,boolean),erp_control.workspace_permission(uuid,text,text),erp_control.workspace_read(uuid,text,jsonb),erp_control.workspace_command(uuid,text,jsonb,uuid),public.erp_workspace_read(uuid,text,jsonb),public.erp_workspace_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function erp_control.workspace_read(uuid,text,jsonb),erp_control.workspace_command(uuid,text,jsonb,uuid),public.erp_workspace_read(uuid,text,jsonb),public.erp_workspace_command(uuid,text,jsonb,uuid) to authenticated;
-- Mandatory companion to this API: a browser must not bypass policy or version checks.
revoke all on public.business_units from anon,authenticated;
