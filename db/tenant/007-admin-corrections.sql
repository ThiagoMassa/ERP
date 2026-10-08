-- Revision tracks ALL product updates, including ordinary ERP commands.
alter table public.products add column record_version integer not null default 1 check(record_version>0);
create function tenant.product_revision() returns trigger language plpgsql set search_path='' as $$
begin new.record_version:=old.record_version+1;return new;end $$;
create trigger product_revision before update on public.products for each row execute function tenant.product_revision();
alter table tenant.audit add column before_data jsonb,add column reason text,add column subject_id uuid;
create table tenant.admin_requests(id uuid primary key,actor_id uuid not null,request_hash text not null,result jsonb not null);
alter table tenant.admin_requests enable row level security;
revoke all on tenant.admin_requests from public;
revoke all on function tenant.product_revision() from public;

alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_before_corrections;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;u uuid;p public.products;before_value jsonb;after_value jsonb;patch jsonb;why text;v integer;hash text;cached tenant.admin_requests;result jsonb;k text;value text;
begin
 if operation is distinct from 'admin.product.correct' then return tenant.dispatch_before_corrections(c,mode,operation,data,key);end if;
 -- The previous entry enforces live expiry, company identity, maintenance and epoch.
 perform tenant.dispatch_before_corrections(c,'read','permissions','{}',null);
 b:=(c->>'company')::uuid;u:=tenant.actor();
 if mode is distinct from 'command' or coalesce((c->>'administrative')::boolean,false)=false or c->>'admin_action' is distinct from operation then raise exception 'Correção administrativa não autorizada.' using errcode='42501';end if;
 perform tenant.require_permission(b,'catalog','edit');
 if key is null or data is null or jsonb_typeof(data)<>'object' or octet_length(data::text)>8000 or exists(select 1 from jsonb_object_keys(data) x where x not in ('id','version','patch','reason')) then raise exception 'Correção inválida.';end if;
 patch:=data->'patch';why:=btrim(data->>'reason');v:=(data->>'version')::integer;
 if patch is null or jsonb_typeof(patch)<>'object' or patch='{}' or why is null or length(why) not between 10 and 1000 or v is null or v<1 then raise exception 'Confira campos, versão e justificativa.';end if;
 for k,value in select e.key,e.value from jsonb_each_text(patch) e loop
  if k not in ('name','description','category','sku','supplier','location') or jsonb_typeof(patch->k)<>'string' or value is null or length(value)>(case when k='description' then 2000 when k='name' then 160 else 240 end) or (k in ('name','category') and length(btrim(value))=0) then raise exception 'Campo não permitido ou inválido: %.',k;end if;
 end loop;
 hash:=encode(sha256(convert_to(jsonb_build_object('actor',u,'company',b,'operation',operation,'data',data)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(key::text,0));
 select * into cached from tenant.admin_requests where id=key;
 if cached.id is not null then
  if cached.actor_id<>u or cached.request_hash<>hash then raise exception 'Identificador já usado para outra correção.';end if;
  return cached.result;
 end if;
 select * into p from public.products where id=(data->>'id')::uuid and business_id=b for update;
 if p.id is null then raise exception 'Produto não encontrado.';end if;
 if p.record_version<>v then raise exception 'Registro alterado. Atualize antes de salvar.' using errcode='40001';end if;
 before_value:=jsonb_build_object('name',p.name,'description',p.description,'category',p.category,'sku',p.sku,'supplier',p.supplier,'location',p.location,'version',p.record_version);
 update public.products set name=coalesce(patch->>'name',name),description=coalesce(patch->>'description',description),category=coalesce(patch->>'category',category),sku=coalesce(patch->>'sku',sku),supplier=coalesce(patch->>'supplier',supplier),location=coalesce(patch->>'location',location) where id=p.id returning jsonb_build_object('name',name,'description',description,'category',category,'sku',sku,'supplier',supplier,'location',location,'version',record_version) into after_value;
 insert into tenant.audit(actor_id,company_id,action,entity,before_data,after_data,reason,subject_id,result,correlation_id)
 values(u,b,operation,p.id::text,before_value,after_value,why,p.owner_id,'success',key);
 result:=jsonb_build_object('id',p.id,'version',after_value->'version','correlation',key);
 insert into tenant.admin_requests values(key,u,hash,result);
 return result;
end $$;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_before_corrections(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_before_corrections(jsonb,text,text,jsonb,uuid) from public;
