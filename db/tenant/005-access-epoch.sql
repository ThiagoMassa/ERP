-- A restore changes the epoch so queued authorizations from before maintenance cannot execute.
alter table tenant.identity add column access_epoch uuid not null default '00000000-0000-0000-0000-000000000000';
alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_maintenance;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare epoch uuid;
begin
 select access_epoch into epoch from tenant.identity where singleton for share;
 if c->>'epoch' is null or c->>'epoch'<>epoch::text then raise exception 'Contexto anterior à manutenção. Atualize a sessão empresarial.' using errcode='42501';end if;
 return tenant.dispatch_maintenance(c,mode,operation,data,key);
end $$;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_maintenance(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_maintenance(jsonb,text,text,jsonb,uuid) from public;
