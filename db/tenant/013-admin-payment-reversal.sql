alter table public.erp_payments add column record_version integer not null default 1 check(record_version>0);
create trigger payment_revision before update on public.erp_payments for each row execute function tenant.product_revision();
alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_before_payment_reversal;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;u uuid;p public.erp_payments;why text;v integer;hash text;cached tenant.admin_requests;before_value jsonb;after_value jsonb;result jsonb;
begin
 if operation is distinct from 'admin.payment.reverse' then return tenant.dispatch_before_payment_reversal(c,mode,operation,data,key);end if;
 perform tenant.dispatch_before_payment_reversal(c,'read','permissions','{}',null);
 b:=(c->>'company')::uuid;u:=tenant.actor();
 if mode is distinct from 'command' or coalesce((c->>'administrative')::boolean,false)=false or c->>'admin_action' is distinct from operation then raise exception 'Estorno administrativo não autorizado.' using errcode='42501';end if;
 perform tenant.require_permission(b,'finance','reverse');
 if key is null or data is null or jsonb_typeof(data)<>'object' or octet_length(data::text)>8000 or exists(select 1 from jsonb_object_keys(data) x where x not in ('id','version','reason')) then raise exception 'Estorno inválido.';end if;
 why:=btrim(data->>'reason');v:=(data->>'version')::integer;
 if why is null or length(why) not between 10 and 1000 or v is null or v<1 then raise exception 'Confira versão e justificativa.';end if;
 perform 1 from public.business_units where id=b for update;
 hash:=encode(sha256(convert_to(jsonb_build_object('actor',u,'company',b,'operation',operation,'data',data)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(key::text,0));
 select * into cached from tenant.admin_requests where id=key;
 if cached.id is not null then
  if cached.actor_id<>u or cached.request_hash<>hash then raise exception 'Identificador já usado para outra alteração.';end if;
  return cached.result;
 end if;
 select * into p from public.erp_payments where id=(data->>'id')::uuid and business_id=b for update;
 if p.id is null then raise exception 'Pagamento não encontrado.';end if;
 if p.record_version<>v then raise exception 'Pagamento alterado. Atualize antes de estornar.' using errcode='40001';end if;
 select jsonb_build_object('payment',to_jsonb(p),'title',to_jsonb(t)) into before_value from public.erp_titles t where t.id=p.title_id and t.business_id=b for update;
 perform tenant.dispatch_before_payment_reversal(c,'command','payment.reverse',jsonb_build_object('id',p.id,'reason',why),key);
 select jsonb_build_object('payment',to_jsonb(pay),'title',to_jsonb(t)) into after_value from public.erp_payments pay join public.erp_titles t on t.id=pay.title_id and t.business_id=pay.business_id where pay.id=p.id and pay.business_id=b;
 insert into tenant.audit(actor_id,company_id,action,entity,before_data,after_data,reason,subject_id,result,correlation_id)
 values(u,b,operation,p.id::text,before_value,after_value,why,p.actor_id,'success',key);
 -- The title history also needs to expose the related financial adjustment.
 insert into tenant.audit(actor_id,company_id,action,entity,before_data,after_data,reason,subject_id,result,correlation_id)
 values(u,b,'admin.title.payment_reversed',p.title_id::text,before_value->'title',after_value->'title',why,p.actor_id,'success',key);
 result:=jsonb_build_object('id',p.id,'version',after_value->'payment'->'record_version','correlation',key);
 insert into tenant.admin_requests values(key,u,hash,result);
 return result;
end $$;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_before_payment_reversal(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_before_payment_reversal(jsonb,text,text,jsonb,uuid) from public;
