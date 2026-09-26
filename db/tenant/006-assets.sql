-- Immutable bounded files live with the tenant records and participate in native backup/restore.
create table tenant.assets(
 id uuid primary key, bucket_id text not null check(bucket_id in ('product-photos','erp-models')),
 name text not null unique, filename text not null check(length(filename) between 1 and 180),
 mime text not null, content bytea not null,
 size_bytes integer generated always as (octet_length(content)) stored,
 sha256 text generated always as (encode(sha256(content),'hex')) stored,
 created_by uuid not null references tenant.actors(id), created_at timestamptz not null default now(),
 check((bucket_id='product-photos' and mime in ('image/png','image/jpeg','image/webp') and octet_length(content) between 1 and 5242880) or
       (bucket_id='erp-models' and mime='model/3mf' and octet_length(content) between 1 and 26214400))
);
alter table tenant.assets enable row level security;
revoke all on tenant.assets from public;

create function tenant.asset_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='products' then
  if new.image_path is not null and not exists(select 1 from tenant.assets where bucket_id='product-photos' and name=new.image_path) then raise exception 'Foto não encontrada no banco desta empresa.';end if;
 else
  if not exists(select 1 from tenant.assets where bucket_id='erp-models' and name=new.path and size_bytes=new.size_bytes) then raise exception 'Arquivo não encontrado ou tamanho divergente.';end if;
 end if;
 return new;
end $$;
create trigger product_asset_reference before insert or update of image_path on public.products for each row execute function tenant.asset_reference();
create trigger model_asset_reference before insert or update of path,size_bytes on public.erp_files for each row execute function tenant.asset_reference();
revoke all on function tenant.asset_reference() from public;

alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_without_assets;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;u uuid;identity tenant.identity;asset tenant.assets;bytes bytea;bucket text;area text;extension text;path text;result jsonb;
begin
 if operation not in ('asset.save','asset.read') then return tenant.dispatch_without_assets(c,mode,operation,data,key);end if;
 if c is null or jsonb_typeof(c)<>'object' or length(c::text)>40000 or data is null or jsonb_typeof(data)<>'object' or length(data::text)>35000000 then raise exception 'Arquivo inválido.';end if;
 select * into identity from tenant.identity where singleton for share;
 if identity.operational_state<>'active' or c->>'epoch' is distinct from identity.access_epoch::text then raise exception 'Empresa em preparação/manutenção ou contexto expirado.' using errcode='42501';end if;
 perform set_config('erp.context',c::text,true);b:=(c->>'company')::uuid;u:=tenant.require_membership(b);
 bucket:=data->>'bucket';if bucket is null or bucket not in ('product-photos','erp-models') then raise exception 'Tipo de arquivo inválido.';end if;
 area:=case when bucket='product-photos' then 'catalog' else 'production' end;
 perform tenant.require_permission(b,area,'read');
 insert into tenant.actors(id) values(u) on conflict do nothing;
 if operation='asset.save' and mode='command' then
  if key is null then raise exception 'Identificador de envio obrigatório.';end if;
  -- Photo changes require the same policy as the associated product operation.
  if bucket='product-photos' and nullif(data->>'product_id','') is not null then
   perform tenant.require_permission(b,area,'edit');
   if not exists(select 1 from public.products where id=(data->>'product_id')::uuid and business_id=b) then raise exception 'Produto indisponível.';end if;
  else perform tenant.require_permission(b,area,'create');end if;
  if data->>'filename' is null or length(data->>'filename') not between 1 and 180 or data->>'content' is null then raise exception 'Nome ou conteúdo inválido.';end if;
  extension:=case data->>'mime' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' when 'model/3mf' then '3mf' else null end;
  if extension is null or (bucket='erp-models')<>(extension='3mf') then raise exception 'Formato não suportado.';end if;
  bytes:=decode(data->>'content','base64');
  if octet_length(bytes) not between 1 and (case when bucket='product-photos' then 5242880 else 26214400 end) then raise exception 'Arquivo excede o limite de tamanho.';end if;
  path:=b::text||'/'||key::text||'.'||extension;
  perform pg_advisory_xact_lock(hashtextextended(key::text,0));
  select * into asset from tenant.assets where id=key;
  if asset.id is not null then
   if asset.bucket_id<>bucket or asset.name<>path or asset.filename<>data->>'filename' or asset.mime<>data->>'mime' or asset.created_by<>u or asset.sha256<>encode(sha256(bytes),'hex') then raise exception 'Identificador de envio já utilizado com outro conteúdo.';end if;
  else
   insert into tenant.assets(id,bucket_id,name,filename,mime,content,created_by) values(key,bucket,path,data->>'filename',data->>'mime',bytes,u) returning * into asset;
   insert into tenant.uploads(bucket_id,name,size_bytes) values(bucket,path,asset.size_bytes);
   insert into tenant.audit(actor_id,company_id,action,entity,after_data,result,correlation_id) values(u,b,'asset.upload',key::text,jsonb_build_object('bucket',bucket,'sha256',asset.sha256,'size_bytes',asset.size_bytes),'success',key);
  end if;
  return jsonb_build_object('id',asset.id,'path',asset.name,'size_bytes',asset.size_bytes,'sha256',asset.sha256);
 elsif operation='asset.read' and mode='read' then
  if bucket='erp-models' then perform tenant.require_permission(b,area,'export');end if;
  select * into asset from tenant.assets where bucket_id=bucket and name=data->>'path';
  if asset.id is null or (bucket='product-photos' and not exists(select 1 from public.products where business_id=b and image_path=asset.name)) or
   (bucket='erp-models' and not exists(select 1 from public.erp_files f where f.business_id=b and f.path=asset.name)) then raise exception 'Arquivo indisponível.' using errcode='42501';end if;
  insert into tenant.audit(actor_id,company_id,action,entity,after_data,result) values(u,b,'asset.download',asset.id::text,jsonb_build_object('bucket',bucket,'sha256',asset.sha256),'success');
  result:=jsonb_build_object('content',encode(asset.content,'base64'),'mime',asset.mime,'filename',asset.filename,'sha256',asset.sha256,'size_bytes',asset.size_bytes);
  return result;
 end if;
 raise exception 'Operação de arquivo não autorizada.' using errcode='42501';
end $$;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_without_assets(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_without_assets(jsonb,text,text,jsonb,uuid) from public;
