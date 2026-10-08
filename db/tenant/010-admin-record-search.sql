-- Filter administrative records in one statement, before counting or paginating.
-- Ordinary company queries retain their existing semantics.
alter function erp_private.read_core(uuid,text,jsonb) rename to read_core_before_admin_search;
create function erp_private.read_core(b uuid,module text,filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb:=current_setting('erp.context',true)::jsonb; source text; tbl text; result jsonb;
 ident uuid; actor uuid; dt date; fin date; page integer; size integer; currency text; query text;
begin
 if coalesce((c->>'administrative_read')::boolean,false)=false or module not in ('products','partners','orders','titles','stock','movements','jobs','spools','printers','recipes') then
  return erp_private.read_core_before_admin_search(b,module,filters);
 end if;
 if c->>'admin_read_operation' is distinct from module or c->>'company' is distinct from b::text or not erp_private.allowed(b,'read') then raise exception 'Consulta administrativa não autorizada.' using errcode='42501';end if;
 if jsonb_typeof(filters)<>'object' or exists(select 1 from jsonb_object_keys(filters) k where k not in ('id','actor','start','end','page','size','currency','query','kind','status')) then raise exception 'Filtros inválidos.';end if;
 ident:=(filters->>'id')::uuid;actor:=(filters->>'actor')::uuid;dt:=(filters->>'start')::date;fin:=(filters->>'end')::date;
 page:=coalesce((filters->>'page')::integer,0);size:=coalesce((filters->>'size')::integer,20);currency:=filters->>'currency';query:=coalesce(filters->>'query','');
 if page not between 0 and 100000 or size not between 1 and 50 or length(query)>160 or (dt is null)<>(fin is null) or fin<dt or fin-dt>3660 or (currency is not null and currency!~'^[A-Z]{3}$') then raise exception 'Filtros inválidos.';end if;
 tbl:=case module when 'products' then 'products' when 'partners' then 'erp_partners' when 'orders' then 'erp_orders' when 'titles' then 'erp_titles' when 'movements' then 'erp_stock_ledger' when 'jobs' then 'erp_print_jobs' when 'spools' then 'erp_spools' when 'printers' then 'erp_printers' when 'recipes' then 'erp_recipes' end;
 if module='stock' then
  source:='select to_jsonb(z)||jsonb_build_object(''name'',p.name,''unit'',p.unit,''min_stock'',p.min_stock,''cost'',p.cost,''currency'',p.currency,''item_type'',p.item_type,''warehouse_name'',w.name,''product_created_at'',p.created_at) as row, p.id as record_id,p.created_at as stamp from public.erp_balances z join public.products p on p.id=z.product_id join public.erp_warehouses w on w.id=z.warehouse_id where z.business_id=$1 and p.deleted_at is null';
 elsif module='movements' then
  source:='select to_jsonb(t)||jsonb_build_object(''name'',p.name,''unit'',p.unit,''currency'',p.currency,''warehouse_name'',w.name) as row,t.id as record_id,t.created_at as stamp from public.erp_stock_ledger t join public.products p on p.id=t.product_id join public.erp_warehouses w on w.id=t.warehouse_id where t.business_id=$1';
 else source:=format('select to_jsonb(t) as row,t.id as record_id,t.created_at as stamp from public.%I t where t.business_id=$1',tbl);end if;
 execute 'with filtered as materialized (select s.* from ('||source||') s where
  ($2::uuid is null or record_id=$2)
  and ($3::uuid is null or row->>''created_by''=$3::text or row->>''actor_id''=$3::text
   or exists(select 1 from public.erp_audit a where a.business_id=$1 and a.entity_id=s.record_id and a.actor_id=$3)
   or exists(select 1 from tenant.audit a where a.company_id=$1 and a.entity=s.record_id::text and a.actor_id=$3 and a.action like ''admin.%'')
   or ($10=''stock'' and exists(select 1 from public.erp_stock_ledger l where l.business_id=$1 and l.product_id=s.record_id and l.warehouse_id=(s.row->>''warehouse_id'')::uuid and l.actor_id=$3)))
  and ($4::date is null or (case $10 when ''orders'' then (row->>''date'')::date when ''titles'' then (row->>''due_date'')::date else (stamp at time zone ''UTC'')::date end) between $4 and $5)
  and ($6::text is null or not(row ? ''currency'') or row->>''currency''=$6)
  and concat_ws('' '',row->>''name'',row->>''description'',row->>''sku'',row->>''partner_name'',row->>''reason'',row->>''warehouse_name'') ilike ''%''||$7||''%''
  and ($10<>''products'' or case when $11=''archived'' then row->>''deleted_at'' is not null else row->>''deleted_at'' is null end)
  and ($10<>''orders'' or $12::text is null or row->>''kind''=$12)
 ), page_rows as (select row from filtered order by stamp desc,record_id,row->>''warehouse_id'' limit $8 offset $9)
 select jsonb_build_object(''rows'',coalesce((select jsonb_agg(row) from page_rows),''[]''::jsonb),''count'',(select count(*) from filtered))'
 into result using b,ident,actor,dt,fin,currency,query,size,page*size,module,filters->>'status',filters->>'kind';
 insert into tenant.audit(actor_id,company_id,action,entity,after_data,result,correlation_id)
 values(tenant.actor(),b,'records.read',ident::text,jsonb_build_object('module',module,'filters',filters,'returned',jsonb_array_length(result->'rows')),'success',(c->>'read_correlation')::uuid);
 return result;
end $$;
revoke all on function erp_private.read_core(uuid,text,jsonb),erp_private.read_core_before_admin_search(uuid,text,jsonb) from public;
