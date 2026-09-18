-- Transitional central authorization for the existing operational engine.
-- Apply after erp-operations.sql and admin-control.sql, before exposing v2.
-- This does NOT implement the distinct-database requirement; tenant routing is separate.
insert into erp_control.memberships(company_id,user_id,role,active)
select business_id,user_id,role,active from public.erp_members on conflict do nothing;

create function erp_control.permitted(b uuid,m text,a text) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.actor();
begin return coalesce((erp_control.effective(b,u,m,a)->>'allowed')::boolean,false);end $$;
create function erp_control.require_permission(b uuid,m text,a text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not erp_control.permitted(b,m,a) then raise exception 'Sem permissão: % / %.',m,a using errcode='42501';end if;
end $$;
create function erp_control.require_membership(b uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=erp_control.actor();
begin
 if not exists(select 1 from erp_control.memberships x join erp_control.companies c on c.id=x.company_id where x.company_id=b and x.user_id=u and x.active and c.status='active') then
 raise exception 'Empresa suspensa ou vínculo indisponível.' using errcode='42501';end if;
 return u;
end $$;

-- Core routines are no longer entry points. Wrappers below are the only grants.
alter function erp_private.command(uuid,text,jsonb,uuid) rename to command_core;
alter function erp_private.read_data(uuid,text,jsonb) rename to read_core;
revoke all on function erp_private.command_core(uuid,text,jsonb,uuid),erp_private.read_core(uuid,text,jsonb) from public,anon,authenticated;

create or replace function erp_private.allowed(b uuid,area text default 'read') returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform erp_control.require_membership(b);
 if not exists(select 1 from public.business_units where id=b and deleted_at is null) then return false;end if;
 -- Granular action checks happen in command/read wrappers. This helper is internal.
 return area in ('read','admin','sales','purchases','catalog','stock','finance','production');
exception when insufficient_privilege or invalid_authorization_specification then return false;
end $$;

create function erp_private.command(b uuid,a text,d jsonb,key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=erp_control.actor(); m text; verb text; kind text; target uuid; result jsonb;
begin
 if a='business.save' and b is null then
  if key is null then raise exception 'Identificador de solicitação obrigatório';end if;
  -- Retry must still pass current membership/policies once the company exists.
  if exists(select 1 from public.business_units where id=key) then
   perform erp_control.require_membership(key);perform erp_control.require_permission(key,'settings','create');
  end if;
  return erp_private.command_core(b,a,d,key);
 end if;
 perform erp_control.require_membership(b);
 -- Locking the control company also serializes membership/policy updates against writes.
 perform 1 from erp_control.companies where id=b for share;
 perform erp_control.require_membership(b);
 if a in ('business.save','business.archive','business.restore','member.save','warehouse.save','terms.save') then m:='settings';
 elsif a in ('product.save','product.archive','product.restore','partner.save') then m:='catalog';
 elsif a in ('stock.adjust','stock.transfer','stock.reverse') then m:='stock';
 elsif a in ('title.save','title.cancel','payment.save','payment.reverse','account.save') then m:='finance';
 elsif a in ('printer.save','spool.save','spool.archive','recipe.save','file.save','job.save','job.start','job.finish','job.cancel') then m:='production';
 elsif a in ('order.save','order.confirm','order.cancel','order.convert','order.fulfill','fulfillment.reverse') then
  if a='order.save' then
   kind:=d->>'kind';
  elsif a='fulfillment.reverse' then
   select o.kind into kind from public.erp_fulfillments f join public.erp_orders o on o.id=f.order_id where f.id=(d->>'id')::uuid and f.business_id=b;
  else select o.kind into kind from public.erp_orders o where o.id=(d->>'id')::uuid and o.business_id=b;end if;
  if kind not in ('sale','quote','purchase') or kind is null then raise exception 'Documento indisponível';end if;
  m:=case when kind='purchase' then 'purchases' else 'sales' end;
 else raise exception 'Operação sem política de acesso.' using errcode='42501';end if;
 verb:=case
 when a in ('business.archive','product.archive','spool.archive') then 'delete'
 when a in ('stock.reverse','payment.reverse','fulfillment.reverse') then 'reverse'
 when a in ('order.cancel','title.cancel','job.cancel') then 'cancel'
 when a in ('order.confirm','order.fulfill','job.start','job.finish') then 'approve'
 when a in ('order.convert','stock.adjust','stock.transfer','payment.save','title.save','recipe.save','file.save','job.save') then 'create'
 when a in ('business.restore','product.restore') then 'edit'
 when a='member.save' then
  case when exists(select 1 from erp_control.memberships x join auth.users u on u.id=x.user_id where x.company_id=b and lower(u.email)=lower(trim(d->>'email'))) then 'edit' else 'create' end
 else case when nullif(d->>'id','') is null then 'create' else 'edit' end end;
 perform erp_control.require_permission(b,m,verb);
 if a='member.save' and coalesce((select x.version from erp_control.memberships x join auth.users u on u.id=x.user_id where x.company_id=b and lower(u.email)=lower(trim(d->>'email'))),0)<>coalesce((d->>'version')::integer,0) then
  raise exception 'Vínculo alterado. Atualize antes de salvar.';
 end if;
 -- Saving an ID that does not exist is creation, even if a client supplies a UUID.
 if verb='edit' and a like '%.save' then
  target:=nullif(d->>'id','')::uuid;
  if (a='product.save' and not exists(select 1 from public.products where id=target and business_id=b)) or
     (a='partner.save' and not exists(select 1 from public.erp_partners where id=target and business_id=b)) or
     (a='order.save' and not exists(select 1 from public.erp_orders where id=target and business_id=b)) or
     (a='account.save' and not exists(select 1 from public.erp_accounts where id=target and business_id=b)) or
     (a='warehouse.save' and not exists(select 1 from public.erp_warehouses where id=target and business_id=b)) or
     (a='terms.save' and not exists(select 1 from public.erp_terms where id=target and business_id=b)) or
     (a='printer.save' and not exists(select 1 from public.erp_printers where id=target and business_id=b)) or
     (a='spool.save' and not exists(select 1 from public.erp_spools where id=target and business_id=b)) then
   perform erp_control.require_permission(b,m,'create');
  end if;
 end if;
 if a='recipe.save' and coalesce((d->>'apply')::boolean,false) then perform erp_control.require_permission(b,'catalog','edit');end if;
 if a='product.save' and coalesce((d->>'stock')::numeric,0)>0 then perform erp_control.require_permission(b,'stock','create');end if;
 result:=erp_private.command_core(b,a,d,key);
 return result;
end $$;

create function erp_private.read_data(b uuid,module text,filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=erp_control.actor(); m text; k text; result jsonb; permission_map jsonb:='{}'; actions jsonb; a text; is_export boolean:=coalesce((filters->>'export')::boolean,false);
begin
 if module='businesses' then
  return (select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('role',x.role,'status',c.status,'provisioning',c.provisioning) order by u.created_at,u.id),'[]')
  from public.business_units u join erp_control.memberships x on x.company_id=u.id and x.user_id=actor and x.active join erp_control.companies c on c.id=u.id where c.status='active');
 end if;
 perform erp_control.require_membership(b);
 if module='permissions' then
  foreach m in array array['overview','sales','purchases','catalog','stock','finance','production','settings'] loop
   actions:='{}';foreach a in array array['available','visible','read','create','edit','delete','approve','cancel','reverse','export'] loop
    actions:=actions||jsonb_build_object(a,erp_control.effective(b,actor,m,a));
   end loop;permission_map:=permission_map||jsonb_build_object(m,actions);
  end loop;return permission_map;
 end if;
 m:=case
 when module='overview' then 'overview' when module in ('products','partners') then 'catalog'
 when module in ('titles','title_detail','accounts','finance_summary') then 'finance' when module in ('stock','movements','legacy_movements','warehouses') then 'stock'
 when module in ('jobs','spools','printers','recipes','files') then 'production' when module in ('terms','members','audit') then 'settings'
 when module='lookups' then 'lookups' when module in ('orders','order_detail') then 'orders' else null end;
 if m is null then raise exception 'Consulta sem política de acesso.' using errcode='42501';end if;
 if m='orders' then
  if module='order_detail' then select kind into k from public.erp_orders where id=(filters->>'id')::uuid and business_id=b;else k:=filters->>'kind';end if;
  if k is not null and k not in ('sale','purchase','quote') then raise exception 'Tipo de pedido inválido';end if;
  if k is null then perform erp_control.require_permission(b,'sales','read');perform erp_control.require_permission(b,'purchases','read');
   if is_export then perform erp_control.require_permission(b,'sales','export');perform erp_control.require_permission(b,'purchases','export');end if;
  else m:=case when k='purchase' then 'purchases' else 'sales' end;perform erp_control.require_permission(b,m,'read');end if;
 elsif m<>'lookups' then perform erp_control.require_permission(b,m,'read');end if;
 if is_export then
  if m='lookups' or m='overview' then raise exception 'Use a exportação do módulo correspondente';end if;
  if m<>'orders' then perform erp_control.require_permission(b,m,'export');end if;
 end if;
 if module='members' then
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(jsonb_build_object('id',x.user_id,'email',u.email,'role',x.role,'active',x.active,'version',x.version)),'[]') from erp_control.memberships x join auth.users u on u.id=x.user_id where x.company_id=b),'count',(select count(*) from erp_control.memberships where company_id=b));
 end if;
 result:=erp_private.read_core(b,case when module='finance_summary' then 'overview' else module end,filters);
 if module='finance_summary' then result:=jsonb_build_object('income',result->'income','expense',result->'expense','series',result->'series');end if;
 if module='lookups' then
  if not erp_control.permitted(b,'catalog','read') then result:=result||'{"products":[],"partners":[]}';end if;
  if not erp_control.permitted(b,'finance','read') then result:=result||'{"accounts":[]}';end if;
  if not erp_control.permitted(b,'stock','read') then result:=result||'{"warehouses":[]}';end if;
  if not erp_control.permitted(b,'settings','read') and not erp_control.permitted(b,'sales','read') and not erp_control.permitted(b,'purchases','read') then result:=result||'{"terms":[]}';end if;
  if not erp_control.permitted(b,'production','read') then result:=result||'{"printers":[],"spools":[],"files":[]}';end if;
 elsif module='overview' then
  if not erp_control.permitted(b,'finance','read') then result:=result-'income'-'expense'-'series'-'forecast'-'receivable'-'payable'-'overdue';end if;
  if not erp_control.permitted(b,'sales','read') then result:=result-'sales'-'top_products';end if;
  if not erp_control.permitted(b,'stock','read') then result:=result-'low_stock';end if;
  if not erp_control.permitted(b,'production','read') then result:=result-'printing';end if;
  if not erp_control.permitted(b,'sales','read') or not erp_control.permitted(b,'purchases','read') then result:=result-'open_orders';end if;
 elsif module='order_detail' and not erp_control.permitted(b,'finance','read') then result:=result-'titles';
 end if;
 if is_export then insert into erp_control.audit(actor_id,company_id,action,entity,after_data,result) values(actor,b,'export.page',module,jsonb_build_object('page',filters->'page','size',filters->'size','returned',jsonb_array_length(coalesce(result->'rows','[]'))),'success');end if;
 return result;
end $$;

-- Remove direct SELECT paths that would bypass granular policy checks.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and (tablename like 'erp_%' or tablename in ('products','entries','stock_movements','business_units','businesses')) loop
 execute format('revoke all on public.%I from public,anon,authenticated',t.tablename);
 end loop;
end $$;
create or replace function public.erp_command(p_business uuid,p_action text,p_data jsonb,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select erp_private.command(p_business,p_action,p_data,p_key) $$;
create or replace function public.erp_read(p_business uuid,p_module text,p_filters jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select erp_private.read_data(p_business,p_module,p_filters) $$;
revoke all on function erp_control.permitted(uuid,text,text),erp_control.require_permission(uuid,text,text),erp_control.require_membership(uuid),erp_private.allowed(uuid,text),erp_private.command(uuid,text,jsonb,uuid),erp_private.read_data(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function erp_private.command(uuid,text,jsonb,uuid),erp_private.read_data(uuid,text,jsonb) to authenticated;
create function erp_control.authorize(b uuid,m text,a text) returns boolean language plpgsql security definer set search_path='' as $$
begin perform erp_control.require_permission(b,m,a);return true;end $$;
create function public.erp_authorize(p_business uuid,p_module text,p_action text) returns boolean language sql security invoker set search_path='' as $$ select erp_control.authorize(p_business,p_module,p_action) $$;
revoke all on function erp_control.authorize(uuid,text,text),public.erp_authorize(uuid,text,text) from public,anon;
grant execute on function erp_control.authorize(uuid,text,text),public.erp_authorize(uuid,text,text) to authenticated;
-- Storage policies need only an authorization predicate; no operational table grants.
create function erp_control.storage_allowed(path text,bucket text,op text) returns boolean language plpgsql security definer set search_path='' as $$
declare b uuid; folder text:=split_part(path,'/',1); m text; u uuid:=erp_control.actor();
begin
 if bucket not in ('product-photos','erp-models') or op not in ('read','create','delete') then return false;end if;
 m:=case when bucket='erp-models' then 'production' else 'catalog' end;
 if folder ~ '^[0-9a-fA-F-]{36}$' then
  select id into b from public.business_units where id=folder::uuid;
  if b is null and bucket='product-photos' and op='read' then select business_id into b from public.products where image_path=path limit 1;end if;
 end if;
 if b is null or not erp_control.permitted(b,m,op) then return false;end if;
 if op='delete' and (exists(select 1 from public.products where image_path=storage_allowed.path) or exists(select 1 from public.erp_files f where f.path=storage_allowed.path)) then return false;end if;
 return true;
exception when invalid_authorization_specification or insufficient_privilege or invalid_text_representation then return false;
end $$;
revoke all on function erp_control.storage_allowed(text,text,text) from public,anon;
grant execute on function erp_control.storage_allowed(text,text,text) to authenticated;
do $$ declare p record; begin
 for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' loop
  if p.policyname in ('models_read','models_insert','models_cleanup','team_photo_read','team_photo_insert','team_photo_delete') or p.policyname like '%photo%' then
   execute format('drop policy %I on storage.objects',p.policyname);
  end if;
 end loop;
end $$;
create policy controlled_files_read on storage.objects for select to authenticated using(erp_control.storage_allowed(name,bucket_id,'read'));
create policy controlled_files_insert on storage.objects for insert to authenticated with check(erp_control.storage_allowed(name,bucket_id,'create'));
create policy controlled_files_delete on storage.objects for delete to authenticated using(erp_control.storage_allowed(name,bucket_id,'delete'));
create policy controlled_files_guard on storage.objects as restrictive for all to authenticated using(erp_control.storage_allowed(name,bucket_id,case when current_setting('request.method',true)='DELETE' then 'delete' else 'read' end)) with check(erp_control.storage_allowed(name,bucket_id,'create'));

