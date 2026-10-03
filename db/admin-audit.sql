-- Incremental control-plane module. Validate locally before registering/applying in production.
create function erp_control.audit_search(f jsonb,exporting boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; b uuid;actor uuid;subject uuid;entity_filter text;action_filter text;result_filter text;date_from date;date_to date;
 upper_id bigint;before_id bigint;lim integer;items jsonb;found integer;next_id text;correlation uuid:=gen_random_uuid();
begin
 if exporting is null or f is null or jsonb_typeof(f)<>'object' or length(f::text)>4000 then raise exception 'Filtros inválidos';end if;
 u:=erp_control.require_admin(exporting);
 if exists(select 1 from jsonb_object_keys(f) k where k not in ('company','actor','subject','entity','action','result','from','to','upper','before')) then raise exception 'Filtro desconhecido';end if;
 b:=nullif(f->>'company','')::uuid;actor:=nullif(f->>'actor','')::uuid;subject:=nullif(f->>'subject','')::uuid;
 entity_filter:=coalesce(f->>'entity','');action_filter:=coalesce(f->>'action','');result_filter:=nullif(f->>'result','');
 if length(entity_filter)>200 or length(action_filter)>160 or result_filter not in ('success','denied','failed') then raise exception 'Filtros inválidos';end if;
 if f->>'from' is null or f->>'to' is null or f->>'from' !~ '^\d{4}-\d{2}-\d{2}$' or f->>'to' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Informe o período';end if;
 date_from:=(f->>'from')::date;date_to:=(f->>'to')::date;
 if date_to<date_from or date_to-date_from>=366 then raise exception 'Selecione até 366 dias';end if;
 upper_id:=nullif(f->>'upper','')::bigint;before_id:=nullif(f->>'before','')::bigint;
 if upper_id<=0 or before_id<=0 then raise exception 'Cursor inválido';end if;
 if exporting and before_id is not null then raise exception 'Exportação exige o período completo';end if;
 lim:=case when exporting then 5000 else 50 end;
 -- The bounded selection and its count share a single statement snapshot.
 with ceiling as(select coalesce(upper_id,max(id),0) as id from erp_control.audit),
 selected as materialized(select a.* from erp_control.audit a,ceiling c where a.id<=c.id and (before_id is null or a.id<before_id)
  and (b is null or a.company_id=b) and (actor is null or a.actor_id=actor) and (subject is null or a.subject_id=subject)
  and (entity_filter='' or a.entity=entity_filter) and (action_filter='' or strpos(lower(a.action),lower(action_filter))>0)
  and (result_filter is null or a.result=result_filter)
  and a.occurred_at>=date_from::timestamp at time zone 'UTC' and a.occurred_at<(date_to+1)::timestamp at time zone 'UTC'
  order by a.id desc limit lim+1),
 page as(select * from selected order by id desc limit lim)
 select (select id from ceiling),(select count(*) from selected),
  coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('id',p.id::text) order by p.id desc) from page p),'[]'),
  (select min(id)::text from page) into upper_id,found,items,next_id;
 if exporting and found>lim then raise exception 'Mais de 5000 eventos. Reduza o período ou os filtros antes de exportar.';end if;
 insert into erp_control.audit(actor_id,company_id,subject_id,action,after_data,result,correlation_id)
 values(u,b,subject,case when exporting then 'audit.export' else 'audit.read' end,jsonb_build_object('filters',f,'upper',upper_id::text,'rows',jsonb_array_length(items)),'success',correlation);
 return jsonb_build_object('rows',items,'upper',case when upper_id=0 then null else upper_id::text end,'next',case when found>lim then next_id else null end,'correlation',correlation);
end $$;
create function public.erp_admin_audit(p_filters jsonb,p_export boolean default false) returns jsonb language sql security invoker set search_path='' as $$
 select erp_control.audit_search(p_filters,p_export)
$$;
revoke all on function erp_control.audit_search(jsonb,boolean),public.erp_admin_audit(jsonb,boolean) from public,anon;
grant execute on function erp_control.audit_search(jsonb,boolean),public.erp_admin_audit(jsonb,boolean) to authenticated;
