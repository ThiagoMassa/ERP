alter table tenant.identity add column operational_state text not null default 'preparing' check(operational_state in ('preparing','active','maintenance'));
alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_core;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare state text;
begin
 select operational_state into state from tenant.identity where singleton for share;
 if state is distinct from 'active' then raise exception 'Banco empresarial em preparação ou manutenção' using errcode='55000';end if;
 return tenant.dispatch_core(c,mode,operation,data,key);
end $$;
-- Renaming an existing function keeps its grants. Remove the old runtime entry explicitly.
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_core(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_core(jsonb,text,text,jsonb,uuid) from public;
alter function tenant.health() rename to health_core;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.health_core() from %I',role_name);
end $$;
create function tenant.health() returns jsonb language sql security definer set search_path='' as $$
 select tenant.health_core()||jsonb_build_object('operational_state',operational_state) from tenant.identity where singleton
$$;
revoke all on function tenant.health() from public;
