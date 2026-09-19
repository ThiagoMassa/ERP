-- Installed with the kernel, before the operational engine.
create table tenant.uploads (
 bucket_id text not null check(bucket_id in ('erp-models','product-photos')),
 name text not null, size_bytes bigint not null check(size_bytes>0),
 verified_at timestamptz not null default now(), primary key(bucket_id,name)
);
create table tenant.audit (
 id bigint generated always as identity primary key, occurred_at timestamptz not null default now(),
 actor_id uuid not null references tenant.actors(id), company_id uuid not null,
 action text not null, entity text, after_data jsonb, result text not null,
 correlation_id uuid not null default gen_random_uuid()
);
alter table tenant.uploads enable row level security;
alter table tenant.audit enable row level security;
revoke all on tenant.uploads,tenant.audit from public;

create function tenant.actor() returns uuid language plpgsql stable set search_path='' as $$
declare c jsonb:=nullif(current_setting('erp.context',true),'')::jsonb;
begin
 if c is null or nullif(c->>'actor','') is null or (c->>'expires_at')::timestamptz is null or
 (c->>'expires_at')::timestamptz<=statement_timestamp() or
 (c->>'expires_at')::timestamptz>statement_timestamp()+interval '30 seconds' then
 raise exception 'Contexto empresarial expirado ou ausente' using errcode='28000';end if;
 return (c->>'actor')::uuid;
end $$;
create function tenant.require_membership(b uuid) returns uuid language plpgsql stable set search_path='' as $$
declare u uuid:=tenant.actor();c jsonb:=current_setting('erp.context',true)::jsonb;
begin
 if not exists(select 1 from tenant.identity where company_id=b and database_name=current_database() and runtime_role=session_user) or
 (c->>'company')::uuid is distinct from b then raise exception 'Empresa não autorizada para esta conexão' using errcode='42501';end if;
 return u;
end $$;
create function tenant.effective(b uuid,u uuid,m text,a text) returns jsonb language plpgsql stable set search_path='' as $$
declare c jsonb:=nullif(current_setting('erp.context',true),'')::jsonb; d jsonb;
begin
 if tenant.require_membership(b) is distinct from u or m is null or a is null or
 m not in ('overview','sales','purchases','catalog','stock','finance','production','settings') or
 a not in ('available','visible','read','create','edit','delete','approve','cancel','reverse','export') then
 return jsonb_build_object('allowed',false,'origin','Função desconhecida');end if;
 if coalesce((c->'permissions'->m->'available'->>'allowed')::boolean,false)=false then return jsonb_build_object('allowed',false,'origin','Módulo indisponível');end if;
 d:=c->'permissions'->m->a;
 return coalesce(d,jsonb_build_object('allowed',false,'origin','Política ausente'));
end $$;
create function tenant.permitted(b uuid,m text,a text) returns boolean language sql stable set search_path='' as $$
 select coalesce((tenant.effective(b,tenant.actor(),m,a)->>'allowed')::boolean,false)
$$;
create function tenant.require_permission(b uuid,m text,a text) returns void language plpgsql stable set search_path='' as $$
begin if not tenant.permitted(b,m,a) then raise exception 'Sem permissão: % / %.',m,a using errcode='42501';end if;end $$;
revoke all on all functions in schema tenant from public;
