-- Administrative inactivation/reactivation uses the ERP's existing integrity rules.
alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_before_product_status;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;u uuid;p public.products;why text;v integer;hash text;cached tenant.admin_requests;result jsonb;after_value jsonb;target_action text;
begin
 if operation is null or operation not in ('admin.product.archive','admin.product.restore') then return tenant.dispatch_before_product_status(c,mode,operation,data,key);end if;
 perform tenant.dispatch_before_product_status(c,'read','permissions','{}',null);
 b:=(c->>'company')::uuid;u:=tenant.actor();
 if mode is distinct from 'command' or coalesce((c->>'administrative')::boolean,false)=false or c->>'admin_action' is distinct from operation then raise exception 'Alteração administrativa não autorizada.' using errcode='42501';end if;
 perform tenant.require_permission(b,'catalog',case when operation='admin.product.archive' then 'delete' else 'edit' end);
 if key is null or data is null or jsonb_typeof(data)<>'object' or octet_length(data::text)>8000 or exists(select 1 from jsonb_object_keys(data) x where x not in ('id','version','reason')) then raise exception 'Alteração inválida.';end if;
 why:=btrim(data->>'reason');v:=(data->>'version')::integer;
 if why is null or length(why) not between 10 and 1000 or v is null or v<1 then raise exception 'Confira versão e justificativa.';end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('actor',u,'company',b,'operation',operation,'data',data)::text,'UTF8')),'hex');
 -- Same company row lock/order as ordinary ERP commands protects dependency checks.
 perform 1 from public.business_units where id=b for update;
 perform pg_advisory_xact_lock(hashtextextended(key::text,0));
 select * into cached from tenant.admin_requests where id=key;
 if cached.id is not null then
  if cached.actor_id<>u or cached.request_hash<>hash then raise exception 'Identificador já usado para outra alteração.';end if;
  return cached.result;
 end if;
 select * into p from public.products where id=(data->>'id')::uuid and business_id=b for update;
 if p.id is null then raise exception 'Produto não encontrado.';end if;
 if p.record_version<>v then raise exception 'Registro alterado. Atualize antes de salvar.' using errcode='40001';end if;
 if (operation='admin.product.archive' and p.deleted_at is not null) or (operation='admin.product.restore' and p.deleted_at is null) then raise exception 'O produto já está na situação solicitada. Atualize a consulta.';end if;
 target_action:=case when operation='admin.product.archive' then 'product.archive' else 'product.restore' end;
 -- This also refuses stock, open orders and pending production on inactivation.
 perform tenant.dispatch_before_product_status(c,'command',target_action,jsonb_build_object('id',p.id,'reason',why),key);
 select jsonb_build_object('deleted_at',deleted_at,'version',record_version) into after_value from public.products where id=p.id;
 insert into tenant.audit(actor_id,company_id,action,entity,before_data,after_data,reason,subject_id,result,correlation_id)
 values(u,b,operation,p.id::text,jsonb_build_object('deleted_at',p.deleted_at,'version',p.record_version),after_value,why,p.owner_id,'success',key);
 result:=jsonb_build_object('id',p.id,'version',after_value->'version','correlation',key);
 insert into tenant.admin_requests values(key,u,hash,result);
 return result;
end $$;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_before_product_status(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_before_product_status(jsonb,text,text,jsonb,uuid) from public;
