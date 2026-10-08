-- Administrative record history combines existing operational and tenant events.
create index tenant_audit_record on tenant.audit(company_id,entity,occurred_at desc,id desc);
create index erp_audit_record on public.erp_audit(business_id,entity_id,created_at desc,id desc);
alter function tenant.dispatch(jsonb,text,text,jsonb,uuid) rename to dispatch_before_history;
create function tenant.dispatch(c jsonb,mode text,operation text,data jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b uuid;u uuid;record_id uuid;from_date date;to_date date;actor uuid;subject uuid;action_filter text;
 size integer;upper_bound timestamptz;cursor_at timestamptz;cursor_key text;items jsonb;more boolean;next_cursor jsonb;last_item jsonb;
begin
 if operation is distinct from 'record_history' then return tenant.dispatch_before_history(c,mode,operation,data,key);end if;
 perform tenant.dispatch_before_history(c,'read','permissions','{}',null);
 b:=(c->>'company')::uuid;u:=tenant.actor();
 if mode is distinct from 'read' or key is not null or coalesce((c->>'administrative_read')::boolean,false)=false or c->>'admin_read_operation' is distinct from operation then raise exception 'Histórico administrativo não autorizado.' using errcode='42501';end if;
 perform tenant.require_permission(b,'settings','read');
 if data is null or jsonb_typeof(data)<>'object' or octet_length(data::text)>4096 or exists(select 1 from jsonb_object_keys(data) k where k not in ('id','start','end','actor','subject','action','size','upper','cursor')) then raise exception 'Filtros de histórico inválidos.';end if;
 record_id:=(data->>'id')::uuid;from_date:=(data->>'start')::date;to_date:=(data->>'end')::date;
 actor:=(data->>'actor')::uuid;subject:=(data->>'subject')::uuid;action_filter:=nullif(data->>'action','');size:=coalesce((data->>'size')::integer,20);
 upper_bound:=coalesce((data->>'upper')::timestamptz,clock_timestamp());
 if record_id is null or from_date is null or to_date is null or to_date<from_date or to_date-from_date>365 or size not between 1 and 50 or length(action_filter)>100 then raise exception 'Informe registro e período de até 366 dias.';end if;
 if data ? 'cursor' then
  if jsonb_typeof(data->'cursor')<>'object' or exists(select 1 from jsonb_object_keys(data->'cursor') k where k not in ('at','key')) then raise exception 'Página de histórico inválida.';end if;
  cursor_at:=(data->'cursor'->>'at')::timestamptz;cursor_key:=data->'cursor'->>'key';
  if cursor_at is null or cursor_key is null or cursor_key!~'^(tenant:[0-9]{20}|erp:[a-f0-9-]{36})$' then raise exception 'Página de histórico inválida.';end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.occurred_at desc,page.audit_key collate "C" desc),'[]') into items from (
  select * from (
   select 'tenant:'||lpad(a.id::text,20,'0') as audit_key,a.id::text as id,'tenant' as source,a.occurred_at,a.actor_id,a.subject_id,a.company_id,a.action,a.entity,
    a.before_data,a.after_data,a.reason,a.result,a.correlation_id::text as correlation_id
   from tenant.audit a where a.company_id=b and a.entity=record_id::text and a.action<>'record.history'
   union all
   select 'erp:'||a.id::text,a.id::text,'erp',a.created_at,a.actor_id,null::uuid,a.business_id,a.action,a.entity_id::text,
    null::jsonb,null::jsonb,a.detail->>'reason','success',a.detail->>'request_id'
   from public.erp_audit a where a.business_id=b and a.entity_id=record_id
  ) events where occurred_at>=from_date::timestamp at time zone 'UTC' and occurred_at<(to_date+1)::timestamp at time zone 'UTC'
   and occurred_at<=upper_bound and (actor is null or actor_id=actor) and (subject is null or subject_id=subject)
   and (action_filter is null or action=action_filter)
   and (cursor_at is null or (occurred_at,audit_key collate "C")<(cursor_at,cursor_key collate "C"))
  order by occurred_at desc,audit_key collate "C" desc limit size+1
 ) page;
 more:=jsonb_array_length(items)>size;
 if more then items:=items-size;last_item:=items->(size-1);next_cursor:=jsonb_build_object('at',last_item->'occurred_at','key',last_item->'audit_key');end if;
 insert into tenant.audit(actor_id,company_id,action,entity,after_data,result,correlation_id)
 values(u,b,'record.history',record_id::text,jsonb_build_object('start',from_date,'end',to_date,'returned',jsonb_array_length(items)),'success',(c->>'read_correlation')::uuid);
 return jsonb_build_object('company',b,'entity',record_id,'rows',items,'next_cursor',next_cursor,'upper',upper_bound);
end $$;
do $$ declare role_name text;begin
 select runtime_role into role_name from tenant.identity;
 execute format('revoke all on function tenant.dispatch_before_history(jsonb,text,text,jsonb,uuid) from %I',role_name);
end $$;
revoke all on function tenant.dispatch(jsonb,text,text,jsonb,uuid),tenant.dispatch_before_history(jsonb,text,text,jsonb,uuid) from public;
