-- Single runtime entry point. Its context is constructed only by the authorized server.
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid:=(c->>'company')::uuid; u uuid; result jsonb;
begin
 if c is null or jsonb_typeof(c)<>'object' or data is null or jsonb_typeof(data)<>'object' or
 length(c::text)>40000 or length(data::text)>100000 then raise exception 'Solicitação inválida';end if;
 perform set_config('erp.context',c::text,true);
 u:=tenant.require_membership(b);
 insert into tenant.actors(id) values(u) on conflict do nothing;
 if mode='read' then result:=erp_private.read_data(b,operation,data);
 elsif mode='command' then result:=erp_private.command(b,operation,data,key);
 else raise exception 'Operação desconhecida' using errcode='42501';end if;
 return result;
end $$;
-- Do not expose core routines, tables, or direct SQL mutation to the runtime role.
revoke all on all functions in schema erp_private from public;
revoke all on all tables in schema erp_private,public from public;
revoke all on all sequences in schema erp_private,public,tenant from public;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid) from public;
do $$ declare t record;begin
 for t in select schemaname,tablename from pg_tables where schemaname in ('public','erp_private') loop
 execute format('alter table %I.%I enable row level security',t.schemaname,t.tablename);
 end loop;
end $$;
