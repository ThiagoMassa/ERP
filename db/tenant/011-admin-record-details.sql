-- Administrative document inspection retains the original permission checks.
alter function erp_private.read_core(uuid,text,jsonb) rename to read_core_before_admin_details;
create function erp_private.read_core(b uuid,module text,filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb:=current_setting('erp.context',true)::jsonb; result jsonb; ident uuid; order_id uuid; extra jsonb;
begin
 if coalesce((c->>'administrative_read')::boolean,false)=false or module not in ('order_detail','title_detail') then
  return erp_private.read_core_before_admin_details(b,module,filters);
 end if;
 if c->>'admin_read_operation' is distinct from module or c->>'company' is distinct from b::text then raise exception 'Detalhamento administrativo não autorizado.' using errcode='42501';end if;
 perform tenant.require_membership(b);
 -- Operational commands lock this row FOR UPDATE. Keep related document rows
 -- coherent while collecting the details, without blocking other readers.
 perform 1 from public.business_units where id=b for share;
 result:=erp_private.read_core_before_admin_details(b,module,filters);
 ident:=(result->>'id')::uuid;
 if module='order_detail' then
  perform tenant.require_permission(b,'finance','read');
  perform tenant.require_permission(b,'stock','read');
  select jsonb_build_object(
   'fulfillment_items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.fulfillment_id,x.id),'[]') from (
    select fl.id,fl.fulfillment_id,fl.line_id,l.product_id,l.name,l.unit,fl.quantity,fl.amount,f.date,f.created_at,f.created_by,f.reversed_at,f.reason,f.warehouse_id,w.name as warehouse_name
    from public.erp_fulfillment_lines fl join public.erp_fulfillments f on f.id=fl.fulfillment_id
    join public.erp_order_lines l on l.id=fl.line_id and l.order_id=f.order_id and l.business_id=f.business_id
    join public.erp_warehouses w on w.id=f.warehouse_id and w.business_id=f.business_id
    where f.business_id=b and f.order_id=ident
   ) x),
   'stock_movements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from (
    select m.*,p.name,p.unit,w.name as warehouse_name from public.erp_stock_ledger m
    join public.erp_fulfillments f on f.id=m.source_id and f.business_id=m.business_id
    join public.products p on p.id=m.product_id and p.business_id=m.business_id
    join public.erp_warehouses w on w.id=m.warehouse_id and w.business_id=m.business_id
    where m.business_id=b and f.order_id=ident
   ) x),
   'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]') from public.erp_payments p join public.erp_titles t on t.id=p.title_id and t.business_id=p.business_id where p.business_id=b and t.order_id=ident)
  ) into extra;
 else
  order_id:=(result->>'order_id')::uuid;
  if order_id is not null then
   perform tenant.require_permission(b,case when o.kind='purchase' then 'purchases' else 'sales' end,'read') from public.erp_orders o where o.id=order_id and o.business_id=b;
  end if;
  select jsonb_build_object('orders',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.erp_orders o where o.id=order_id and o.business_id=b),
   'fulfillments',(select coalesce(jsonb_agg(to_jsonb(f)),'[]') from public.erp_fulfillments f where f.id=(result->>'fulfillment_id')::uuid and f.business_id=b)) into extra;
 end if;
 insert into tenant.audit(actor_id,company_id,action,entity,after_data,result,correlation_id)
 values(tenant.actor(),b,'records.detail',ident::text,jsonb_build_object('module',module),'success',(c->>'read_correlation')::uuid);
 return result||extra;
end $$;
revoke all on function erp_private.read_core(uuid,text,jsonb),erp_private.read_core_before_admin_details(uuid,text,jsonb) from public;
