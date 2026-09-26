-- A restrictive policy complements (never replaces) the existing ownership RLS.
-- Blocked accounts, revoked sessions and suspended companies cannot use old APIs.
create function erp_control.legacy_allowed(b uuid,p_module text,p_action text) returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 u:=erp_control.actor();
 if b is null then return true;end if;
 if p_action='create' and p_module='settings' and not exists(select 1 from erp_control.companies where id=b) then return true;end if;
 if exists(select 1 from erp_control.companies where id=b and status='suspended') and exists(select 1 from erp_control.administrators where user_id=u and active) then
 perform erp_control.require_admin(false);return true;
 end if;
 return coalesce((erp_control.effective(b,u,p_module,p_action)->>'allowed')::boolean,false);
exception when invalid_authorization_specification or insufficient_privilege then return false;
end $$;
revoke all on function erp_control.legacy_allowed(uuid,text,text) from public,anon;
grant execute on function erp_control.legacy_allowed(uuid,text,text) to authenticated;
do $$ declare t text; m text; col text; verb text; act text; condition text; begin
 foreach t in array array['business_units','products','entries','stock_movements','businesses'] loop
 m:=case t when 'business_units' then 'settings' when 'products' then 'catalog' when 'entries' then 'finance' when 'stock_movements' then 'stock' else 'settings' end;
 col:=case t when 'business_units' then 'id' when 'products' then 'business_id' when 'entries' then 'business_id' when 'stock_movements' then '(select p.business_id from public.products p where p.id=product_id)' else 'null::uuid' end;
 foreach verb in array array['select','insert','update','delete'] loop
 act:=case verb when 'select' then 'read' when 'insert' then 'create' when 'update' then 'edit' else 'delete' end;
 condition:=format('erp_control.legacy_allowed(%s,%L,%L)',col,m,act);
 execute format('create policy control_%s on public.%I as restrictive for %s to authenticated %s',verb,t,verb,
 case when verb='insert' then 'with check ('||condition||')' when verb='update' then 'using ('||condition||') with check ('||condition||')' else 'using ('||condition||')' end);
 end loop;
 end loop;
end $$;
create policy control_storage_session on storage.objects as restrictive for all to authenticated
 using(erp_control.legacy_allowed(null,'catalog','read')) with check(erp_control.legacy_allowed(null,'catalog','create'));

