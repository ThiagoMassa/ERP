-- Run in a NEW, separate PostgreSQL database, as its NOLOGIN owner role.
-- This is the identity/migration kernel; it does not mark the ERP engine ready.
create schema tenant;
revoke all on schema tenant from public;
create table tenant.identity (
 singleton boolean primary key default true check(singleton),
 company_id uuid not null unique,
 database_name text not null unique,
 runtime_role text not null unique,
 created_at timestamptz not null default now()
);
create table tenant.migrations (
 version text primary key,
 checksum text not null check(checksum ~ '^[0-9a-f]{64}$'),
 applied_at timestamptz not null default now()
);
-- Historical author IDs only. Identity, authentication and memberships remain central.
create table tenant.actors (
 id uuid primary key,
 first_seen_at timestamptz not null default now()
);
create table tenant.reconciliations (
 id uuid primary key,
 source text not null check(source in ('legacy','new-company','restore')),
 source_digest text not null check(source_digest ~ '^[0-9a-f]{64}$'),
 target_digest text not null check(target_digest ~ '^[0-9a-f]{64}$'),
 counts jsonb not null check(jsonb_typeof(counts)='object'),
 verified_at timestamptz not null default now(),
 check(source_digest=target_digest)
);
alter table tenant.identity enable row level security;
alter table tenant.migrations enable row level security;
alter table tenant.actors enable row level security;
alter table tenant.reconciliations enable row level security;
revoke all on all tables in schema tenant from public;

create function tenant.health() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'company_id',i.company_id,'database',current_database(),
  'runtime_role',i.runtime_role,'session_role',session_user,
  'identity_matches',i.database_name=current_database() and i.runtime_role=session_user,
  'runtime_restricted',exists(select 1 from pg_roles r where r.rolname=session_user and not (r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls or r.rolinherit))
   and not exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=session_user)
   and not exists(select 1 from pg_database d where d.datallowconn and d.datname<>current_database() and has_database_privilege(session_user,d.oid,'CONNECT')),
  'migrations',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum) order by version),'[]') from tenant.migrations),
  'reconciled',exists(select 1 from tenant.reconciliations),
  'engine_installed',to_regprocedure('tenant.dispatch(jsonb,text,text,jsonb,uuid)') is not null
 ) from tenant.identity i where singleton
$$;
revoke all on function tenant.health() from public;
