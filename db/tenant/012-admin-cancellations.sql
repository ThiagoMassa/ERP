alter table public.erp_orders add column record_version integer not null default 1 check(record_version>0);
alter table public.erp_titles add column record_version integer not null default 1 check(record_version>0);
create trigger order_revision before update on public.erp_orders for each row execute function tenant.product_revision();
create trigger title_revision before update on public.erp_titles for each row execute function tenant.product_revision();

alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_before_cancellations;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;u uuid;target uuid;tbl text;area text;why text;v integer;hash text;cached tenant.admin_requests;before_row jsonb;after_row jsonb;result jsonb;
begin
 if operation is null or operation not in ('admin.order.cancel','admin.title.cancel') then return tenant.dispatch_before_cancellations(c,mode,operation,data,key);end if;
 perform tenant.dispatch_before_cancellations(c,'read','permissions','{}',null);
 b:=(c->>'company')::uuid;u:=tenant.actor();
 if mode is distinct from 'command' or coalesce((c->>'administrative')::boolean,false)=false or c->>'admin_action' is distinct from operation then raise exception 'Cancelamento administrativo não autorizado.' using errcode='42501';end if;
 if key is null or data is null or jsonb_typeof(data)<>'object' or octet_length(data::text)>8000 or exists(select 1 from jsonb_object_keys(data) x where x not in ('id','version','reason')) then raise exception 'Cancelamento inválido.';end if;
 why:=btrim(data->>'reason');v:=(data->>'version')::integer;target:=(data->>'id')::uuid;
 if target is null or why is null or length(why) not between 10 and 1000 or v is null or v<1 then raise exception 'Confira registro, versão e justificativa.';end if;
 perform 1 from public.business_units where id=b for update;
 tbl:=case when operation='admin.order.cancel' then 'erp_orders' else 'erp_titles' end;
 execute format('select to_jsonb(t) from public.%I t where id=$1 and business_id=$2 for update',tbl) into before_row using target,b;
 if before_row is null then raise exception 'Documento não encontrado.';end if;
 area:=case when operation='admin.title.cancel' then 'finance' when before_row->>'kind'='purchase' then 'purchases' else 'sales' end;
 perform tenant.require_permission(b,area,'cancel');
 hash:=encode(sha256(convert_to(jsonb_build_object('actor',u,'company',b,'operation',operation,'data',data)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(key::text,0));
 select * into cached from tenant.admin_requests where id=key;
 if cached.id is not null then
  if cached.actor_id<>u or cached.request_hash<>hash then raise exception 'Identificador já usado para outra alteração.';end if;
  return cached.result;
 end if;
 if (before_row->>'record_version')::integer<>v then raise exception 'Documento alterado. Atualize antes de cancelar.' using errcode='40001';end if;
 if operation='admin.order.cancel' then before_row:=before_row||jsonb_build_object('titles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.erp_titles t where t.business_id=b and t.order_id=target));end if;
 perform tenant.dispatch_before_cancellations(c,'command',substring(operation from 7),jsonb_build_object('id',target,'reason',why),key);
 execute format('select to_jsonb(t) from public.%I t where id=$1 and business_id=$2',tbl) into after_row using target,b;
 if operation='admin.order.cancel' then after_row:=after_row||jsonb_build_object('titles',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.erp_titles t where t.business_id=b and t.order_id=target));end if;
 insert into tenant.audit(actor_id,company_id,action,entity,before_data,after_data,reason,subject_id,result,correlation_id)
 values(u,b,operation,target::text,before_row,after_row,why,(before_row->>'created_by')::uuid,'success',key);
 result:=jsonb_build_object('id',target,'version',after_row->'record_version','correlation',key);
 insert into tenant.admin_requests values(key,u,hash,result);
 return result;
end $$;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_before_cancellations(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_before_cancellations(jsonb,text,text,jsonb,uuid) from public;
