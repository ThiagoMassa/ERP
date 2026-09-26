-- Fluxo operations v2. Apply once, after the four original migrations.
-- Privileged implementations live in a non-exposed schema; every public entry
-- checks the authenticated actor, business membership and operation permission.
create schema if not exists erp_private;
revoke all on schema erp_private from public, anon;
grant usage on schema erp_private to authenticated;

create table public.erp_members (
 business_id uuid not null references public.business_units(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('admin','sales','purchases','stock','finance','read')), active boolean not null default true,
 primary key(business_id,user_id)
);
create table public.erp_partners (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id),
 name text not null check(length(trim(name)) between 1 and 160), email text not null default '', phone text not null default '',
 document text not null default '', address text not null default '', customer boolean not null default true, supplier boolean not null default false,
 active boolean not null default true, created_at timestamptz not null default now(), unique(id,business_id), check(customer or supplier)
);
create unique index erp_partner_document on public.erp_partners(business_id,lower(trim(document))) where trim(document)<>'';
create table public.erp_warehouses (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id),
 name text not null check(length(trim(name)) between 1 and 100), branch text not null default 'Matriz',
 active boolean not null default true, created_at timestamptz not null default now(), unique(id,business_id), unique(business_id,name)
);
create table public.erp_accounts (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id),
 name text not null check(length(trim(name)) between 1 and 100), currency text not null check(currency ~ '^[A-Z]{3}$'),
 kind text not null default 'bank' check(kind in ('bank','cash')), active boolean not null default true,
 created_at timestamptz not null default now(), unique(id,business_id), unique(business_id,name,currency)
);
create table public.erp_terms (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), name text not null,
 installments integer not null default 1 check(installments between 1 and 36), interval_days integer not null default 30 check(interval_days between 1 and 365),
 method text not null default 'transfer', active boolean not null default true, created_at timestamptz not null default now(), unique(id,business_id)
);
create table public.erp_orders (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id),
 number bigint generated always as identity, kind text not null check(kind in ('sale','purchase','quote')),
 partner_id uuid not null, partner_name text not null, currency text not null check(currency ~ '^[A-Z]{3}$'),
 status text not null default 'draft' check(status in ('draft','confirmed','completed','cancelled','converted')),
 date date not null default current_date, due_date date not null default current_date,
 installments integer not null default 1 check(installments between 1 and 36), interval_days integer not null default 30 check(interval_days between 1 and 365),
 payment_method text not null default 'transfer', notes text not null default '', total numeric(18,4) not null default 0 check(total>=0),
 source_id uuid references public.erp_orders(id), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(id,business_id), foreign key(partner_id,business_id) references public.erp_partners(id,business_id)
);
create table public.erp_order_lines (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.erp_orders(id), business_id uuid not null references public.business_units(id),
 product_id uuid not null references public.products(id), name text not null, unit text not null, item_type text not null,
 quantity numeric(18,3) not null check(quantity>0), fulfilled numeric(18,3) not null default 0 check(fulfilled>=0 and fulfilled<=quantity),
 price numeric(18,4) not null check(price>=0), discount numeric(18,4) not null default 0 check(discount>=0), total numeric(18,4) not null check(total>=0),
 unique(id,business_id), foreign key(order_id,business_id) references public.erp_orders(id,business_id)
);
create table public.erp_fulfillments (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), order_id uuid not null,
 warehouse_id uuid not null, total numeric(18,4) not null default 0, date date not null default current_date,
 reversed_at timestamptz, reason text not null default '', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(order_id,business_id) references public.erp_orders(id,business_id), foreign key(warehouse_id,business_id) references public.erp_warehouses(id,business_id)
);
create table public.erp_fulfillment_lines (
 id uuid primary key default gen_random_uuid(), fulfillment_id uuid not null references public.erp_fulfillments(id),
 line_id uuid not null references public.erp_order_lines(id), quantity numeric(18,3) not null check(quantity>0), amount numeric(18,4) not null check(amount>=0)
);
create table public.erp_balances (
 business_id uuid not null references public.business_units(id), product_id uuid not null references public.products(id), warehouse_id uuid not null,
 quantity numeric(18,3) not null default 0 check(quantity>=0), reserved numeric(18,3) not null default 0 check(reserved>=0 and reserved<=quantity),
 primary key(product_id,warehouse_id), foreign key(warehouse_id,business_id) references public.erp_warehouses(id,business_id)
);
create table public.erp_stock_ledger (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), product_id uuid not null references public.products(id),
 warehouse_id uuid not null, delta numeric(18,3) not null check(delta<>0), balance numeric(18,3) not null check(balance>=0),
 kind text not null, source_id uuid, reversal_of uuid unique references public.erp_stock_ledger(id), reason text not null check(length(trim(reason)) between 1 and 500),
 actor_id uuid references auth.users(id), created_at timestamptz not null default now(),
 foreign key(warehouse_id,business_id) references public.erp_warehouses(id,business_id)
);
create table public.erp_titles (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), order_id uuid references public.erp_orders(id),
 fulfillment_id uuid references public.erp_fulfillments(id), description text not null check(length(trim(description)) between 1 and 240),
 type text not null check(type in ('income','expense')), currency text not null check(currency ~ '^[A-Z]{3}$'),
 amount numeric(18,4) not null check(amount>0), paid numeric(18,4) not null default 0 check(paid>=0 and paid<=amount),
 competence_date date not null, due_date date not null, installment integer not null default 1, category text not null default 'Operação',
 cancelled_at timestamptz, legacy_id uuid unique references public.entries(id), created_at timestamptz not null default now(), unique(id,business_id)
);
create table public.erp_payments (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), title_id uuid not null,
 account_id uuid not null, amount numeric(18,4) not null check(amount>0), date date not null, method text not null default 'transfer',
 reversed_at timestamptz, reason text not null default '', actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(title_id,business_id) references public.erp_titles(id,business_id), foreign key(account_id,business_id) references public.erp_accounts(id,business_id)
);
create table public.erp_audit (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), actor_id uuid references auth.users(id),
 action text not null, entity_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
create table erp_private.requests (
 business_id uuid not null, key uuid not null, actor_id uuid not null, action text not null, payload jsonb not null, result jsonb,
 created_at timestamptz not null default now(), primary key(business_id,key)
);
create table erp_private.currencies(code text primary key, digits integer not null check(digits between 0 and 4));

create table public.erp_printers (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), name text not null,
 model text not null check(model in ('A1 mini','A1','P1S','P2S','A2 (manual)')), nozzle numeric not null default .4 check(nozzle>0),
 watts numeric not null default 100 check(watts>=0), hourly_cost numeric(18,4) not null default 0 check(hourly_cost>=0),
 hours numeric(18,3) not null default 0 check(hours>=0), maintenance_hours numeric not null default 500 check(maintenance_hours>0),
 active boolean not null default true, created_at timestamptz not null default now(), unique(id,business_id)
);
create table public.erp_spools (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), product_id uuid not null references public.products(id),
 warehouse_id uuid not null, name text not null, manufacturer text not null default '', material text not null default 'PLA', color text not null default '', lot text not null default '',
 remaining_g numeric(18,3) not null check(remaining_g>=0), reserved_g numeric(18,3) not null default 0 check(reserved_g>=0 and reserved_g<=remaining_g),
 cost_kg numeric(18,4) not null check(cost_kg>=0), active boolean not null default true, created_at timestamptz not null default now(), unique(id,business_id),
 foreign key(warehouse_id,business_id) references public.erp_warehouses(id,business_id)
);
create table public.erp_recipes (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), product_id uuid not null references public.products(id),
 version integer not null, parameters jsonb not null, cost numeric(18,4) not null check(cost>=0), price numeric(18,4) not null check(price>=0),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(product_id,version)
);
create table public.erp_files (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), product_id uuid references public.products(id),
 name text not null, path text not null unique, size_bytes bigint not null check(size_bytes between 1 and 26214400),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(id,business_id)
);
create table public.erp_print_jobs (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.business_units(id), name text not null,
 product_id uuid not null references public.products(id), printer_id uuid not null, spool_id uuid not null, file_id uuid, order_id uuid,
 quantity numeric(18,3) not null check(quantity>0), estimated_g numeric(18,3) not null check(estimated_g>0), estimated_hours numeric(18,3) not null check(estimated_hours>0),
 actual_g numeric(18,3), actual_hours numeric(18,3), good_quantity numeric(18,3), estimated_cost numeric(18,4) not null,
 actual_cost numeric(18,4), kwh_price numeric(18,4) not null check(kwh_price>=0), watts numeric not null, hourly_cost numeric(18,4) not null, cost_kg numeric(18,4) not null,
 status text not null default 'planned' check(status in ('planned','printing','completed','failed','cancelled')), due_date date not null,
 notes text not null default '', created_at timestamptz not null default now(),
 foreign key(printer_id,business_id) references public.erp_printers(id,business_id), foreign key(spool_id,business_id) references public.erp_spools(id,business_id),
 foreign key(file_id,business_id) references public.erp_files(id,business_id), foreign key(order_id,business_id) references public.erp_orders(id,business_id)
);

create function erp_private.allowed(b uuid, area text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.business_units u where u.id=b and u.deleted_at is null and
 (u.owner_id=auth.uid() or exists(select 1 from public.erp_members m where m.business_id=b and m.user_id=auth.uid() and m.active and
 (area='read' or m.role='admin' or m.role=area or area='catalog' and m.role in ('sales','purchases','stock') or area='production' and m.role='stock'))));
$$;
create function erp_private.digits(c text) returns integer language plpgsql stable set search_path='' as $$
declare n integer; begin select digits into n from erp_private.currencies where code=c;
if n is null then raise exception 'Moeda inválida'; end if; return n; end $$;

-- A business lock serializes commands, including reservations, reversals and retries.
-- This favors correctness for small businesses; it never locks unrelated businesses.
create function erp_private.stock(b uuid,p uuid,w uuid,d numeric,k text,s uuid,n text,rev uuid default null) returns void
language plpgsql set search_path='' as $$
declare balance numeric; begin
 if d=0 then return; end if;
 if d is null or d<>round(d,3) then raise exception 'Quantidade inválida (até 3 casas decimais)'; end if;
 if not exists(select 1 from public.products where id=p and business_id=b and item_type<>'service') or
 not exists(select 1 from public.erp_warehouses where id=w and business_id=b and active) then raise exception 'Produto ou depósito inválido'; end if;
 insert into public.erp_balances(business_id,product_id,warehouse_id) values(b,p,w) on conflict do nothing;
 update public.erp_balances set quantity=quantity+d where product_id=p and warehouse_id=w and quantity+d>=reserved returning quantity into balance;
 if not found then raise exception 'Saldo disponível insuficiente. Confira também as reservas de impressão.'; end if;
 if balance < coalesce((select sum(s.remaining_g)/case when p2.unit='kg' then 1000 else 1 end from public.erp_spools s join public.products p2 on p2.id=s.product_id where s.product_id=p and s.warehouse_id=w and s.active group by p2.unit),0) then
  raise exception 'Saldo atribuído a bobinas. Registre o consumo pela produção ou desative a bobina sem reservas antes de ajustar';
 end if;
 insert into public.erp_stock_ledger(business_id,product_id,warehouse_id,delta,balance,kind,source_id,reason,actor_id,reversal_of)
 values(b,p,w,d,balance,k,s,n,auth.uid(),rev);
 update public.products set stock=(select coalesce(sum(quantity),0) from public.erp_balances where product_id=p) where id=p;
end $$;

create function erp_private.read_data(b uuid,module text,filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tbl text; query text:=left(coalesce(filters->>'query',''),160); page integer:=greatest(0,least(coalesce((filters->>'page')::integer,0),100000));
 size integer:=least(100,greatest(1,coalesce((filters->>'size')::integer,20))); data jsonb; count_rows bigint;
 dt date:=coalesce((nullif(filters->>'start',''))::date,date_trunc('month',current_date)::date); fin date:=coalesce((nullif(filters->>'end',''))::date,current_date);
 c text:=coalesce(filters->>'currency','BRL'); ident uuid:=nullif(filters->>'id','')::uuid; cond text;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta' using errcode='42501'; end if;
 if module='businesses' then return (select coalesce(jsonb_agg(to_jsonb(u)||jsonb_build_object('role',case when u.owner_id=auth.uid() then 'admin' else m.role end) order by u.created_at),'[]') from public.business_units u left join public.erp_members m on m.business_id=u.id and m.user_id=auth.uid() and m.active where u.owner_id=auth.uid() or m.user_id is not null); end if;
 if not erp_private.allowed(b,'read') then raise exception 'Empresa indisponível' using errcode='42501'; end if;
 if fin<dt or fin-dt>3660 then raise exception 'Selecione um período válido de até 10 anos'; end if;
 if module='lookups' then
  return jsonb_build_object(
   'products',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.products where business_id=b and deleted_at is null and currency=c and (name ilike '%'||query||'%' or sku ilike '%'||query||'%') order by name limit 100)x),
   'partners',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.erp_partners where business_id=b and active and name ilike '%'||query||'%' order by name limit 100)x),
   'warehouses',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.erp_warehouses x where business_id=b and active),
   'accounts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.erp_accounts x where business_id=b and active and currency=c),
   'terms',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.erp_terms x where business_id=b and active),
   'printers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.erp_printers x where business_id=b and active),
   'spools',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.erp_spools x where business_id=b and active),
   'files',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from public.erp_files where business_id=b order by created_at desc limit 100)x));
 elsif module='overview' then
  with cash as (
   select p.date,t.type,p.amount from public.erp_payments p join public.erp_titles t on t.id=p.title_id where p.business_id=b and t.currency=c
   union all select p.reversed_at::date,t.type,-p.amount from public.erp_payments p join public.erp_titles t on t.id=p.title_id where p.business_id=b and t.currency=c and p.reversed_at is not null
  ), days as (select generate_series(dt::timestamp,fin::timestamp,'1 day')::date as day), series as (
   select days.day,coalesce(sum(cash.amount) filter(where cash.type='income'),0) income,coalesce(sum(cash.amount) filter(where cash.type='expense'),0) expense
   from days left join cash on cash.date=days.day group by days.day
  ) select jsonb_build_object(
   'income',(select coalesce(sum(income),0) from series),'expense',(select coalesce(sum(expense),0) from series),
   'series',(select jsonb_agg(to_jsonb(s) order by day) from series s),
   'forecast',(select coalesce(jsonb_agg(to_jsonb(t) order by day),'[]') from(select due_date as day,sum(amount-paid) filter(where type='income') income,sum(amount-paid) filter(where type='expense') expense from public.erp_titles where business_id=b and currency=c and cancelled_at is null and due_date between dt and fin and paid<amount group by due_date)t),
   'receivable',(select coalesce(sum(amount-paid),0) from public.erp_titles where business_id=b and currency=c and type='income' and cancelled_at is null),
   'payable',(select coalesce(sum(amount-paid),0) from public.erp_titles where business_id=b and currency=c and type='expense' and cancelled_at is null),
   'overdue',(select coalesce(sum(amount-paid),0) from public.erp_titles where business_id=b and currency=c and due_date<current_date and cancelled_at is null),
   'sales',(select coalesce(sum(total),0) from public.erp_orders where business_id=b and currency=c and kind='sale' and status in ('confirmed','completed') and date between dt and fin),
   'low_stock',(select count(*) from public.products where business_id=b and currency=c and item_type<>'service' and deleted_at is null and stock<=min_stock),
   'open_orders',(select count(*) from public.erp_orders where business_id=b and currency=c and status='confirmed'),
   'printing',(select count(*) from public.erp_print_jobs where business_id=b and status in ('planned','printing')),
   'top_products',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select l.name,l.unit,sum(l.quantity) quantity,sum(l.total) total from public.erp_order_lines l join public.erp_orders o on o.id=l.order_id where o.business_id=b and o.currency=c and o.kind='sale' and o.status in ('confirmed','completed') and o.date between dt and fin group by l.name,l.unit order by sum(l.total) desc limit 5)x)
  ) into data; return data;
 elsif module='order_detail' then
  select to_jsonb(o)||jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from public.erp_order_lines l where order_id=o.id),
   'fulfillments',(select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]') from public.erp_fulfillments f where order_id=o.id),
   'titles',(select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date),'[]') from public.erp_titles t where order_id=o.id)) into data from public.erp_orders o where id=ident and business_id=b;
  if data is null then raise exception 'Pedido indisponível'; end if; return data;
 elsif module='title_detail' then
  select to_jsonb(t)||jsonb_build_object('payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') from public.erp_payments p where p.title_id=t.id)) into data from public.erp_titles t where id=ident and business_id=b;
  if data is null then raise exception 'Título indisponível'; end if; return data;
 elsif module='members' then
  if not erp_private.allowed(b,'admin') then raise exception 'Somente administradores podem consultar a equipe'; end if;
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'email',u.email,'role',m.role,'active',m.active)),'[]') from public.erp_members m join auth.users u on u.id=m.user_id where business_id=b),'count',(select count(*) from public.erp_members where business_id=b));
 elsif module='stock' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'count',(select count(*) from public.erp_balances z join public.products p on p.id=z.product_id where z.business_id=b and p.currency=c and p.deleted_at is null and p.name ilike '%'||query||'%')) into data
  from(select z.*,p.name,p.unit,p.min_stock,p.cost,p.currency,w.name warehouse_name,p.item_type from public.erp_balances z join public.products p on p.id=z.product_id join public.erp_warehouses w on w.id=z.warehouse_id where z.business_id=b and p.currency=c and p.deleted_at is null and p.name ilike '%'||query||'%' order by p.name,w.name limit size offset page*size)x;
  return data;
 elsif module='movements' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'count',(select count(*) from public.erp_stock_ledger l where business_id=b and created_at::date between dt and fin)) into data
  from(select l.*,p.name,p.unit,w.name warehouse_name from public.erp_stock_ledger l join public.products p on p.id=l.product_id join public.erp_warehouses w on w.id=l.warehouse_id where l.business_id=b and l.created_at::date between dt and fin order by l.created_at desc,l.id limit size offset page*size)x; return data;
 elsif module='accounts' then
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('balance',(select coalesce(sum(p.amount*case when t.type='income' then 1 else -1 end),0) from public.erp_payments p join public.erp_titles t on t.id=p.title_id where p.account_id=a.id and p.reversed_at is null))),'[]') from public.erp_accounts a where business_id=b and currency=c),'count',(select count(*) from public.erp_accounts where business_id=b and currency=c));
 end if;
 tbl:=case module when 'products' then 'products' when 'partners' then 'erp_partners' when 'orders' then 'erp_orders' when 'titles' then 'erp_titles'
 when 'warehouses' then 'erp_warehouses' when 'terms' then 'erp_terms' when 'printers' then 'erp_printers' when 'spools' then 'erp_spools'
 when 'jobs' then 'erp_print_jobs' when 'recipes' then 'erp_recipes' when 'files' then 'erp_files' when 'audit' then 'erp_audit' when 'legacy_movements' then 'stock_movements' else null end;
 if tbl is null then raise exception 'Módulo inválido'; end if;
 if module='legacy_movements' then
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select m.* from public.stock_movements m join public.products p on p.id=m.product_id where p.business_id=b order by m.created_at desc limit size offset page*size)x),'count',(select count(*) from public.stock_movements m join public.products p on p.id=m.product_id where p.business_id=b));
 end if;
 cond:='business_id=$1 and (coalesce(to_jsonb(t)->>''name'','''')||'' ''||coalesce(to_jsonb(t)->>''description'','''')||'' ''||coalesce(to_jsonb(t)->>''partner_name'','''')||'' ''||coalesce(to_jsonb(t)->>''sku'','''')) ilike ''%''||$2||''%''';
 if module in ('products','orders','titles') then cond:=cond||' and currency=$3'; end if;
 if module='orders' then
  cond:=cond||' and date between $4 and $5';
  if filters->>'kind' in ('sale','purchase','quote') then cond:=cond||format(' and kind=%L',filters->>'kind'); end if;
 end if;
 if module='products' then cond:=cond||case when filters->>'status'='archived' then ' and deleted_at is not null' else ' and deleted_at is null' end; end if;
 if module='titles' then
  cond:=cond||' and due_date between $4 and $5';
  cond:=cond||case filters->>'status' when 'open' then ' and paid<amount and cancelled_at is null' when 'paid' then ' and paid=amount and cancelled_at is null' when 'overdue' then ' and paid<amount and due_date<current_date and cancelled_at is null' when 'cancelled' then ' and cancelled_at is not null' else '' end;
 end if;
 execute format('select count(*) from public.%I t where %s',tbl,cond) into count_rows using b,query,c,dt,fin;
 execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]'') from(select * from public.%I t where %s order by created_at desc,id limit $6 offset $7)x',tbl,cond) into data using b,query,c,dt,fin,size,page*size;
 return jsonb_build_object('rows',data,'count',count_rows);
end $$;

create function erp_private.command(b uuid,a text,d jsonb,key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
<<command>>
declare request_key uuid:=key; actor uuid:=auth.uid(); owner uuid; area text; ident uuid; w uuid; w2 uuid; pid uuid; rid uuid; user_target uuid;
 result jsonb; prior erp_private.requests; obj jsonb; item jsonb; ord public.erp_orders; ln public.erp_order_lines;
 prod public.products; title public.erp_titles; pay public.erp_payments; fulfillment public.erp_fulfillments;
 job public.erp_print_jobs; spool public.erp_spools; printer public.erp_printers;
 qty numeric; amount numeric; value numeric; total numeric:=0; n integer; precision integer; reason text:=trim(coalesce(d->>'reason',''));
begin
 if actor is null then raise exception 'Entre na sua conta' using errcode='42501'; end if;
 if key is null or d is null or jsonb_typeof(d)<>'object' or length(d::text)>100000 then raise exception 'Operação inválida'; end if;
 if a='business.save' and b is null then
   b:=key;
   insert into public.business_units(id,owner_id,name,model,description,contact_email,phone)
   values(b,actor,trim(d->>'name'),coalesce(d->>'model','printing'),coalesce(d->>'description',''),coalesce(d->>'contact_email',''),coalesce(d->>'phone','')) on conflict(id) do nothing;
   if not exists(select 1 from public.erp_warehouses where business_id=b) then
    insert into public.erp_warehouses(business_id,name) values(b,'Depósito principal');
    insert into public.erp_terms(business_id,name) values(b,'À vista');
   end if;
 end if;
 select owner_id into owner from public.business_units where id=b for update;
 area:=case when a like 'business.%' or a like 'member.%' or a in ('warehouse.save','account.save','terms.save') then 'admin'
 when a like 'product.%' or a like 'partner.%' then 'catalog'
 when a like 'stock.%' then 'stock' when a like 'title.%' or a like 'payment.%' then 'finance'
 when a like 'printer.%' or a like 'spool.%' or a like 'job.%' or a like 'recipe.%' or a like 'file.%' then 'production'
 when a like 'order.%' or a like 'fulfillment.%' then 'read' else 'invalid' end;
 if not erp_private.allowed(b,area) and not(a='business.restore' and owner=actor) then raise exception 'Sem permissão para esta operação' using errcode='42501'; end if;
 select * into prior from erp_private.requests where business_id=b and requests.key=command.request_key;
 if found then
   if prior.actor_id<>actor or prior.action<>a or prior.payload<>d then raise exception 'Identificador já utilizado para outra operação'; end if;
   return prior.result;
 end if;
 insert into erp_private.requests(business_id,key,actor_id,action,payload) values(b,key,actor,a,d);
 ident:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
 if a='business.save' then
   update public.business_units set name=trim(d->>'name'),model=d->>'model',description=coalesce(d->>'description',''),contact_email=coalesce(d->>'contact_email',''),phone=coalesce(d->>'phone','') where id=b;
   ident:=b;
 elsif a in ('business.archive','business.restore') then
   if owner<>actor then raise exception 'Somente o proprietário pode arquivar ou restaurar a empresa'; end if;
   update public.business_units set deleted_at=case when a='business.archive' then now() else null end where id=b; ident:=b;
 elsif a='member.save' then
   select id into user_target from auth.users where lower(email)=lower(trim(d->>'email'));
   if user_target is null then raise exception 'A pessoa precisa criar uma conta antes de ser adicionada'; end if;
   if user_target=owner then raise exception 'O proprietário mantém acesso administrativo'; end if;
   insert into erp_control.memberships(company_id,user_id,role,active) values(b,user_target,d->>'role',coalesce((d->>'active')::boolean,true))
   on conflict(company_id,user_id) do update set role=excluded.role,active=excluded.active,version=erp_control.memberships.version+1; ident:=user_target;
 elsif a='partner.save' then
   if exists(select 1 from public.erp_partners where id=ident and business_id<>b) then raise exception 'Parceiro indisponível'; end if;
   insert into public.erp_partners(id,business_id,name,email,phone,document,address,customer,supplier,active)
   values(ident,b,trim(d->>'name'),coalesce(d->>'email',''),coalesce(d->>'phone',''),coalesce(d->>'document',''),coalesce(d->>'address',''),coalesce((d->>'customer')::boolean,true),coalesce((d->>'supplier')::boolean,false),coalesce((d->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,document=excluded.document,address=excluded.address,customer=excluded.customer,supplier=excluded.supplier,active=excluded.active;
 elsif a='warehouse.save' then
   if exists(select 1 from public.erp_warehouses where id=ident and business_id<>b) then raise exception 'Depósito indisponível'; end if;
   if d->>'active'='false' and exists(select 1 from public.erp_balances where warehouse_id=ident and quantity>0) then raise exception 'Transfira o saldo antes de inativar o depósito'; end if;
   insert into public.erp_warehouses(id,business_id,name,branch,active) values(ident,b,trim(d->>'name'),coalesce(d->>'branch','Matriz'),coalesce((d->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,branch=excluded.branch,active=excluded.active;
 elsif a='account.save' then
   perform erp_private.digits(d->>'currency');
   if exists(select 1 from public.erp_accounts where id=ident and (business_id<>b or currency<>d->>'currency')) then raise exception 'Empresa e moeda da conta não podem ser alteradas'; end if;
   insert into public.erp_accounts(id,business_id,name,currency,kind,active) values(ident,b,trim(d->>'name'),d->>'currency',d->>'kind',coalesce((d->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,kind=excluded.kind,active=excluded.active;
 elsif a='terms.save' then
   if exists(select 1 from public.erp_terms where id=ident and business_id<>b) then raise exception 'Condição indisponível'; end if;
   insert into public.erp_terms(id,business_id,name,installments,interval_days,method,active)
   values(ident,b,trim(d->>'name'),(d->>'installments')::integer,(d->>'interval_days')::integer,d->>'method',coalesce((d->>'active')::boolean,true))
   on conflict(id) do update set name=excluded.name,installments=excluded.installments,interval_days=excluded.interval_days,method=excluded.method,active=excluded.active;
 elsif a='product.save' then
   precision:=erp_private.digits(d->>'currency');
   select * into prod from public.products where id=ident;
   if found and (prod.business_id<>b or prod.currency<>d->>'currency' or prod.unit<>d->>'unit' or prod.item_type<>d->>'item_type') then raise exception 'Empresa, tipo, moeda e unidade de um item existente não podem ser alterados'; end if;
   insert into public.products(id,owner_id,business_id,name,category,description,sku,supplier,location,item_type,unit,cost,price,min_stock,currency,image_path)
   values(ident,owner,b,trim(d->>'name'),coalesce(nullif(d->>'category',''),'Geral'),coalesce(d->>'description',''),coalesce(d->>'sku',''),coalesce(d->>'supplier',''),coalesce(d->>'location',''),d->>'item_type',d->>'unit',round((d->>'cost')::numeric,precision),round((d->>'price')::numeric,precision),coalesce((d->>'min_stock')::numeric,0),d->>'currency',nullif(d->>'image_path',''))
   on conflict(id) do update set name=excluded.name,category=excluded.category,description=excluded.description,sku=excluded.sku,supplier=excluded.supplier,location=excluded.location,cost=excluded.cost,price=excluded.price,min_stock=excluded.min_stock,image_path=excluded.image_path;
   if prod.id is null and coalesce((d->>'stock')::numeric,0)>0 then
    select id into w from public.erp_warehouses where business_id=b and active order by created_at,id limit 1;
    perform erp_private.stock(b,ident,w,(d->>'stock')::numeric,'opening',ident,'Saldo inicial do cadastro');
   end if;
 elsif a in ('product.archive','product.restore') then
   if a='product.archive' and (exists(select 1 from public.erp_balances where product_id=ident and quantity>0) or exists(select 1 from public.erp_order_lines l join public.erp_orders o on o.id=l.order_id where l.product_id=ident and o.status in ('draft','confirmed')) or exists(select 1 from public.erp_print_jobs where product_id=ident and status in ('planned','printing'))) then raise exception 'Conclua os pedidos e zere o estoque antes de inativar o item'; end if;
   update public.products set deleted_at=case when a='product.archive' then now() else null end where id=ident and business_id=b;
   if not found then raise exception 'Produto indisponível'; end if;
 elsif a in ('stock.adjust','stock.transfer','stock.reverse') then
   if length(reason)<3 then raise exception 'Informe um motivo com pelo menos 3 caracteres'; end if;
   if a='stock.reverse' then
    select to_jsonb(l) into obj from public.erp_stock_ledger l where id=ident and business_id=b;
    if obj is null or obj->>'kind' not in ('adjustment','inventory') then raise exception 'Estorne esta operação pelo documento de origem'; end if;
    perform erp_private.stock(b,(obj->>'product_id')::uuid,(obj->>'warehouse_id')::uuid,-(obj->>'delta')::numeric,'reversal',ident,reason,ident);
   else
    pid:=(d->>'product_id')::uuid; w:=(d->>'warehouse_id')::uuid; qty:=(d->>'quantity')::numeric;
    if not exists(select 1 from public.products where id=pid and business_id=b and deleted_at is null) then raise exception 'Produto indisponível'; end if;
    if exists(select 1 from public.erp_spools where product_id=pid and warehouse_id=w and active) then raise exception 'Material controlado por bobina: registre o consumo na ordem de impressão'; end if;
    if a='stock.transfer' then
      w2:=(d->>'destination_id')::uuid;
      if qty<=0 or w=w2 then raise exception 'Informe uma quantidade positiva e depósitos diferentes'; end if;
      perform erp_private.stock(b,pid,w,-qty,'transfer',ident,reason); perform erp_private.stock(b,pid,w2,qty,'transfer',ident,reason);
    else
      if d->>'mode'='inventory' then
       if qty<0 then raise exception 'Contagem inválida'; end if;
       qty:=qty-coalesce((select quantity from public.erp_balances where product_id=pid and warehouse_id=w),0);
      end if;
      perform erp_private.stock(b,pid,w,qty,case when d->>'mode'='inventory' then 'inventory' else 'adjustment' end,ident,reason);
    end if;
   end if;
 elsif a='order.save' then
   area:=case when d->>'kind'='purchase' then 'purchases' else 'sales' end;
   if not erp_private.allowed(b,area) then raise exception 'Sem permissão para pedidos' using errcode='42501'; end if;
   select * into ord from public.erp_orders where id=ident;
   if found and (ord.business_id<>b or ord.status<>'draft' or ord.kind<>d->>'kind') then raise exception 'Somente rascunhos podem ser editados'; end if;
   if not exists(select 1 from public.erp_partners where id=(d->>'partner_id')::uuid and business_id=b and active and case when d->>'kind'='purchase' then supplier else customer end) then raise exception 'Selecione um parceiro ativo com a função correta'; end if;
   precision:=erp_private.digits(d->>'currency');
   if jsonb_typeof(d->'items')<>'array' or jsonb_array_length(d->'items') not between 1 and 100 then raise exception 'Inclua de 1 a 100 itens'; end if;
   insert into public.erp_orders(id,business_id,kind,partner_id,partner_name,currency,date,due_date,installments,interval_days,payment_method,notes,created_by)
   values(ident,b,d->>'kind',(d->>'partner_id')::uuid,(select name from public.erp_partners where id=(d->>'partner_id')::uuid),d->>'currency',(d->>'date')::date,(d->>'due_date')::date,coalesce((d->>'installments')::integer,1),coalesce((d->>'interval_days')::integer,30),coalesce(d->>'payment_method','transfer'),coalesce(d->>'notes',''),actor)
   on conflict(id) do update set partner_id=excluded.partner_id,partner_name=excluded.partner_name,currency=excluded.currency,date=excluded.date,due_date=excluded.due_date,installments=excluded.installments,interval_days=excluded.interval_days,payment_method=excluded.payment_method,notes=excluded.notes;
   delete from public.erp_order_lines where order_id=ident;
   for item in select * from jsonb_array_elements(d->'items') loop
     select * into prod from public.products where id=(item->>'product_id')::uuid and business_id=b and currency=d->>'currency' and deleted_at is null;
     if not found then raise exception 'Produto indisponível ou de outra moeda'; end if;
     qty:=(item->>'quantity')::numeric; value:=round((item->>'price')::numeric,precision); amount:=round(coalesce((item->>'discount')::numeric,0),precision);
     if qty<=0 or qty<>round(qty,3) or value<0 or amount<0 or amount>round(qty*value,precision) then raise exception 'Quantidade, preço ou desconto inválido'; end if;
     insert into public.erp_order_lines(order_id,business_id,product_id,name,unit,item_type,quantity,price,discount,total)
     values(ident,b,prod.id,prod.name,prod.unit,prod.item_type,qty,value,amount,round(qty*value,precision)-amount);
   end loop;
   update public.erp_orders set total=(select sum(l.total) from public.erp_order_lines l where order_id=ident) where id=ident;
 elsif a in ('order.confirm','order.cancel','order.convert','order.fulfill') then
   select * into ord from public.erp_orders where id=ident and business_id=b;
   if not found then raise exception 'Pedido indisponível'; end if;
   area:=case when ord.kind='purchase' then 'purchases' else 'sales' end;
   if not erp_private.allowed(b,area) and not(a='order.fulfill' and erp_private.allowed(b,'stock')) then raise exception 'Sem permissão para esta etapa' using errcode='42501'; end if;
   if a='order.confirm' then
    if ord.status<>'draft' or ord.kind='quote' then raise exception 'Converta o orçamento ou selecione um rascunho'; end if;
    update public.erp_orders set status='confirmed' where id=ident;
    if ord.kind='sale' then perform erp_private.installments(b,ident,null,'Venda #'||ord.number,'income',ord.currency,ord.total,ord.date,ord.due_date,ord.installments,ord.interval_days); end if;
   elsif a='order.cancel' then
    if ord.status not in ('draft','confirmed') or length(reason)<3 then raise exception 'Informe o motivo e selecione um pedido aberto'; end if;
    if exists(select 1 from public.erp_fulfillments where order_id=ident and reversed_at is null) or exists(select 1 from public.erp_titles where order_id=ident and paid>0) or exists(select 1 from public.erp_print_jobs where order_id=ident and status in ('planned','printing')) then raise exception 'Estorne os recebimentos/entregas, pagamentos e cancele as impressões antes de cancelar'; end if;
    update public.erp_titles set cancelled_at=now() where order_id=ident and cancelled_at is null;
    update public.erp_orders set status='cancelled' where id=ident;
   elsif a='order.convert' then
    if ord.kind<>'quote' or ord.status<>'draft' then raise exception 'Este orçamento já foi convertido ou cancelado'; end if;
    rid:=gen_random_uuid();
    insert into public.erp_orders(id,business_id,kind,partner_id,partner_name,currency,date,due_date,installments,interval_days,payment_method,notes,total,source_id,created_by)
    values(rid,b,'sale',ord.partner_id,ord.partner_name,ord.currency,current_date,ord.due_date,ord.installments,ord.interval_days,ord.payment_method,ord.notes,ord.total,ord.id,actor);
    insert into public.erp_order_lines(order_id,business_id,product_id,name,unit,item_type,quantity,price,discount,total)
    select rid,b,product_id,name,unit,item_type,quantity,price,discount,l.total from public.erp_order_lines l where order_id=ident;
    update public.erp_orders set status='converted' where id=ident; ident:=rid;
   else
    if ord.status<>'confirmed' then raise exception 'Confirme o pedido antes de atender'; end if;
    if jsonb_typeof(d->'items')<>'array' or jsonb_array_length(d->'items') not between 1 and 100 then raise exception 'Selecione os itens e quantidades'; end if;
    w:=(d->>'warehouse_id')::uuid; rid:=gen_random_uuid();
    insert into public.erp_fulfillments(id,business_id,order_id,warehouse_id,date,created_by) values(rid,b,ident,w,coalesce((d->>'date')::date,current_date),actor);
    for item in select * from jsonb_array_elements(d->'items') loop
     qty:=(item->>'quantity')::numeric;
     if qty=0 then continue; end if;
     select * into ln from public.erp_order_lines where id=(item->>'line_id')::uuid and order_id=ident;
     if not found or qty is null or qty<=0 or qty<>round(qty,3) or qty+ln.fulfilled>ln.quantity then raise exception 'Quantidade maior que o saldo do pedido ou item inválido'; end if;
     amount:=round(ln.total*(ln.fulfilled+qty)/ln.quantity,erp_private.digits(ord.currency))-round(ln.total*ln.fulfilled/ln.quantity,erp_private.digits(ord.currency));
     insert into public.erp_fulfillment_lines(fulfillment_id,line_id,quantity,amount) values(rid,ln.id,qty,amount);
     update public.erp_order_lines set fulfilled=fulfilled+qty where id=ln.id;
     if ln.item_type<>'service' then perform erp_private.stock(b,ln.product_id,w,qty*case when ord.kind='purchase' then 1 else -1 end,ord.kind,rid,'Pedido #'||ord.number); end if;
     total:=total+amount;
    end loop;
    if not exists(select 1 from public.erp_fulfillment_lines where fulfillment_id=rid) then raise exception 'Informe ao menos uma quantidade'; end if;
    update public.erp_fulfillments set total=command.total where id=rid;
    if ord.kind='purchase' then perform erp_private.installments(b,ident,rid,'Compra #'||ord.number,'expense',ord.currency,total,coalesce((d->>'date')::date,current_date),ord.due_date,ord.installments,ord.interval_days); end if;
    if not exists(select 1 from public.erp_order_lines where order_id=ident and fulfilled<quantity) then update public.erp_orders set status='completed' where id=ident; end if;
    result:=jsonb_build_object('id',ident,'fulfillment_id',rid);
   end if;
 elsif a='fulfillment.reverse' then
   select * into fulfillment from public.erp_fulfillments where id=ident and business_id=b and reversed_at is null;
   if not found or length(reason)<3 then raise exception 'Atendimento indisponível ou motivo não informado'; end if;
   select * into ord from public.erp_orders where id=fulfillment.order_id;
   if not erp_private.allowed(b,case when ord.kind='purchase' then 'purchases' else 'sales' end) then raise exception 'Sem permissão para devolução' using errcode='42501'; end if;
   if exists(select 1 from public.erp_titles where fulfillment_id=ident and paid>0) then raise exception 'Estorne os pagamentos dessa compra antes da devolução'; end if;
   for item in select to_jsonb(x) from public.erp_fulfillment_lines x where fulfillment_id=ident loop
    select * into ln from public.erp_order_lines where id=(item->>'line_id')::uuid;
    qty:=(item->>'quantity')::numeric;
    if ln.item_type<>'service' then perform erp_private.stock(b,ln.product_id,fulfillment.warehouse_id,qty*case when ord.kind='purchase' then -1 else 1 end,'return',ident,reason); end if;
    update public.erp_order_lines set fulfilled=fulfilled-qty where id=ln.id;
   end loop;
   update public.erp_fulfillments set reversed_at=now(),reason=command.reason where id=ident;
   update public.erp_titles set cancelled_at=now() where fulfillment_id=ident;
   update public.erp_orders set status='confirmed' where id=ord.id;
 elsif a='title.save' then
   precision:=erp_private.digits(d->>'currency'); amount:=round((d->>'amount')::numeric,precision);
   if amount<=0 then raise exception 'Informe um valor positivo'; end if;
   n:=coalesce((d->>'installments')::integer,1);
   if n not between 1 and 36 then raise exception 'Use de 1 a 36 parcelas'; end if;
   perform erp_private.installments(b,null,null,d->>'description',d->>'type',d->>'currency',amount,(d->>'competence_date')::date,(d->>'due_date')::date,n,30,coalesce(d->>'category','Operação'));
 elsif a='title.cancel' then
   update public.erp_titles set cancelled_at=now() where id=ident and business_id=b and order_id is null and paid=0 and cancelled_at is null and length(reason)>=3;
   if not found then raise exception 'Estorne as liquidações ou cancele pelo pedido de origem; informe um motivo'; end if;
 elsif a='payment.save' then
   select * into title from public.erp_titles where id=(d->>'title_id')::uuid and business_id=b and cancelled_at is null;
   if not found then raise exception 'Título indisponível'; end if;
   amount:=round((d->>'amount')::numeric,erp_private.digits(title.currency));
   if amount is null or amount<=0 or amount>title.amount-title.paid then raise exception 'Valor maior que o saldo em aberto'; end if;
   if not exists(select 1 from public.erp_accounts where id=(d->>'account_id')::uuid and business_id=b and active and currency=title.currency) then raise exception 'Selecione uma conta ativa da mesma moeda'; end if;
   insert into public.erp_payments(id,business_id,title_id,account_id,amount,date,method,actor_id) values(ident,b,title.id,(d->>'account_id')::uuid,amount,(d->>'date')::date,coalesce(d->>'method','transfer'),actor);
   update public.erp_titles set paid=paid+command.amount where id=title.id;
 elsif a='payment.reverse' then
   select * into pay from public.erp_payments where id=ident and business_id=b and reversed_at is null;
   if not found or length(reason)<3 then raise exception 'Pagamento indisponível ou motivo não informado'; end if;
   update public.erp_payments set reversed_at=now(),reason=command.reason where id=ident;
   update public.erp_titles set paid=paid-pay.amount where id=pay.title_id;
 else
   result:=erp_private.production(b,a,d,ident);
 end if;
 result:=coalesce(result,jsonb_build_object('id',ident));
 insert into public.erp_audit(business_id,actor_id,action,entity_id,detail) values(b,actor,a,ident,jsonb_build_object('reason',reason,'request_id',key));
 update erp_private.requests set result=command.result where business_id=b and requests.key=command.request_key;
 return result;
end $$;

-- Existing balances are imported as an explicit, dated opening reconciliation.
-- Old movement history stays untouched; it must not be replayed against this balance.
insert into public.erp_warehouses(business_id,name) select id,'Depósito principal' from public.business_units;
insert into public.erp_terms(business_id,name) select id,'À vista' from public.business_units;
insert into public.erp_balances(business_id,product_id,warehouse_id,quantity)
 select p.business_id,p.id,w.id,p.stock from public.products p join public.erp_warehouses w on w.business_id=p.business_id where p.item_type<>'service';
insert into public.erp_stock_ledger(business_id,product_id,warehouse_id,delta,balance,kind,reason)
 select business_id,product_id,warehouse_id,quantity,quantity,'opening','Saldo conciliado na migração; histórico anterior preservado separadamente.' from public.erp_balances where quantity>0;
insert into public.erp_accounts(business_id,name,currency)
 select distinct business_id,'Conta legada',currency from public.entries;
insert into public.erp_titles(business_id,description,type,currency,amount,paid,competence_date,due_date,category,cancelled_at,legacy_id)
 select business_id,description,type,currency,amount,case when status='paid' then amount else 0 end,date,date,category,deleted_at,id from public.entries;
insert into public.erp_payments(business_id,title_id,account_id,amount,date,method,actor_id,reason)
 select e.business_id,t.id,a.id,e.amount,e.date,e.payment_method,e.owner_id,'Importação legada: a data original foi preservada.'
 from public.entries e join public.erp_titles t on t.legacy_id=e.id join public.erp_accounts a on a.business_id=e.business_id and a.currency=e.currency and a.name='Conta legada'
 where e.status='paid' and e.deleted_at is null;
-- Archived legacy entries remain archived; don't create cash movements for them.
update public.erp_titles set paid=0 where cancelled_at is not null;
alter table public.products alter column business_id set not null;
alter table public.entries alter column business_id set not null;
create unique index products_unique_sku on public.products(business_id,lower(trim(sku))) where trim(sku)<>'';

create function erp_private.production(b uuid,a text,d jsonb,ident uuid) returns jsonb
language plpgsql set search_path='' as $$
<<production>>
declare prod public.products; spool public.erp_spools; printer public.erp_printers; job public.erp_print_jobs;
 factor numeric; qty numeric; grams numeric; hrs numeric; cost numeric; price numeric; params jsonb; x record;
begin
 if not erp_private.allowed(b,'production') then raise exception 'Sem permissão para produção' using errcode='42501'; end if;
 if a='printer.save' then
  if exists(select 1 from public.erp_printers where id=ident and business_id<>b) then raise exception 'Impressora indisponível'; end if;
  if d->>'active'='false' and exists(select 1 from public.erp_print_jobs where printer_id=ident and status in ('planned','printing')) then raise exception 'Conclua ou cancele as impressões antes de inativar'; end if;
  insert into public.erp_printers(id,business_id,name,model,nozzle,watts,hourly_cost,maintenance_hours,active)
  values(ident,b,trim(d->>'name'),d->>'model',(d->>'nozzle')::numeric,(d->>'watts')::numeric,(d->>'hourly_cost')::numeric,(d->>'maintenance_hours')::numeric,coalesce((d->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,model=excluded.model,nozzle=excluded.nozzle,watts=excluded.watts,hourly_cost=excluded.hourly_cost,maintenance_hours=excluded.maintenance_hours,active=excluded.active;
 elsif a='spool.save' then
  if d ? 'id' then
   update public.erp_spools set name=trim(d->>'name'),manufacturer=coalesce(d->>'manufacturer',''),material=coalesce(d->>'material','PLA'),color=coalesce(d->>'color',''),lot=coalesce(d->>'lot','') where id=ident and business_id=b;
   if not found then raise exception 'Bobina indisponível'; end if;
  else
   select * into prod from public.products where id=(d->>'product_id')::uuid and business_id=b and item_type='material' and unit in ('g','kg') and deleted_at is null;
   if not found then raise exception 'Cadastre o filamento como matéria-prima em g ou kg'; end if;
   factor:=case when prod.unit='kg' then 1000 else 1 end; grams:=(d->>'remaining_g')::numeric;
   if grams is null or grams<=0 or grams<>round(grams/factor,3)*factor or grams+coalesce((select sum(remaining_g) from public.erp_spools where product_id=prod.id and warehouse_id=(d->>'warehouse_id')::uuid and active),0)>
    coalesce((select quantity*factor from public.erp_balances where product_id=prod.id and warehouse_id=(d->>'warehouse_id')::uuid),0) then raise exception 'O peso deve caber no estoque ainda não atribuído a bobinas (kg: precisão de 1 g)'; end if;
   insert into public.erp_spools(id,business_id,product_id,warehouse_id,name,manufacturer,material,color,lot,remaining_g,cost_kg)
   values(ident,b,prod.id,(d->>'warehouse_id')::uuid,trim(d->>'name'),coalesce(d->>'manufacturer',''),coalesce(d->>'material','PLA'),coalesce(d->>'color',''),coalesce(d->>'lot',''),grams,prod.cost*factor/1000);
   -- Product cost is per unit: kg -> same; g -> multiply by 1000.
   update public.erp_spools set cost_kg=prod.cost*1000/factor where id=ident;
  end if;
 elsif a='spool.archive' then
  update public.erp_spools set active=false where id=ident and business_id=b and reserved_g=0;
  if not found then raise exception 'Cancele ou conclua as reservas desta bobina'; end if;
 elsif a='recipe.save' then
  select * into prod from public.products where id=(d->>'product_id')::uuid and business_id=b and deleted_at is null;
  if not found then raise exception 'Produto indisponível'; end if;
  params:=d->'parameters';
  if jsonb_typeof(params)<>'object' then raise exception 'Ficha inválida'; end if;
  for x in select * from jsonb_each_text(params) loop
    if x.value::numeric<0 or x.value::numeric>100000000 then raise exception 'Parâmetro inválido'; end if;
  end loop;
  if coalesce((params->>'monthlyMachineHours')::numeric,0)<=0 or coalesce((params->>'fees')::numeric,0)+coalesce((params->>'margin')::numeric,0)>=100 then raise exception 'Informe as horas mensais e uma margem válida'; end if;
  cost:=(params->>'grams')::numeric/1000*(params->>'kgCost')::numeric*(1+(params->>'loss')::numeric/100)
   +(params->>'power')::numeric/1000*(params->>'machineHours')::numeric*(params->>'kwh')::numeric
   +((params->>'maintenance')::numeric+(params->>'rent')::numeric+(params->>'otherFixed')::numeric)/(params->>'monthlyMachineHours')::numeric*(params->>'machineHours')::numeric
   +(params->>'finishHours')::numeric*(params->>'hourly')::numeric+(params->>'packaging')::numeric;
  price:=cost/(1-((params->>'fees')::numeric+(params->>'margin')::numeric)/100);
  insert into public.erp_recipes(id,business_id,product_id,version,parameters,cost,price,created_by)
  values(ident,b,prod.id,coalesce((select max(version)+1 from public.erp_recipes where product_id=prod.id),1),params,round(cost,erp_private.digits(prod.currency)),round(price,erp_private.digits(prod.currency)),auth.uid());
  if d->>'apply'='true' then update public.products set cost=round(production.cost,erp_private.digits(prod.currency)),price=round(production.price,erp_private.digits(prod.currency)) where id=prod.id; end if;
 elsif a='file.save' then
  if (d->>'path') not like b::text||'/%' or lower(right(d->>'name',4))<>'.3mf' or not exists(select 1 from storage.objects where bucket_id='erp-models' and name=d->>'path') then raise exception 'Envie um arquivo 3MF válido antes de registrar'; end if;
  if nullif(d->>'product_id','') is not null and not exists(select 1 from public.products where id=(d->>'product_id')::uuid and business_id=b) then raise exception 'Produto indisponível'; end if;
  insert into public.erp_files(id,business_id,product_id,name,path,size_bytes,created_by) values(ident,b,nullif(d->>'product_id','')::uuid,d->>'name',d->>'path',(d->>'size_bytes')::bigint,auth.uid());
 elsif a='job.save' then
  select * into prod from public.products where id=(d->>'product_id')::uuid and business_id=b and item_type='finished' and deleted_at is null;
  select * into spool from public.erp_spools where id=(d->>'spool_id')::uuid and business_id=b and active;
  select * into printer from public.erp_printers where id=(d->>'printer_id')::uuid and business_id=b and active;
  if prod.id is null or spool.id is null or printer.id is null then raise exception 'Selecione produto pronto, bobina e impressora ativos'; end if;
  if not exists(select 1 from public.products where id=spool.product_id and currency=prod.currency) then raise exception 'Produto e filamento devem usar a mesma moeda'; end if;
  if nullif(d->>'order_id','') is not null and not exists(select 1 from public.erp_orders o join public.erp_order_lines l on l.order_id=o.id where o.id=(d->>'order_id')::uuid and o.business_id=b and o.kind='sale' and o.status='confirmed' and l.product_id=prod.id) then raise exception 'Vincule um pedido de venda confirmado deste produto'; end if;
  grams:=(d->>'estimated_g')::numeric; hrs:=(d->>'estimated_hours')::numeric;
  select case when unit='kg' then 1000 else 1 end into factor from public.products where id=spool.product_id;
  if grams<=0 or grams>spool.remaining_g-spool.reserved_g or grams<>round(grams/factor,3)*factor then raise exception 'Filamento disponível insuficiente ou precisão inválida'; end if;
  cost:=grams/1000*spool.cost_kg+hrs*(printer.hourly_cost+printer.watts/1000*(d->>'kwh_price')::numeric);
  insert into public.erp_print_jobs(id,business_id,name,product_id,printer_id,spool_id,file_id,order_id,quantity,estimated_g,estimated_hours,estimated_cost,kwh_price,watts,hourly_cost,cost_kg,due_date,notes)
  values(ident,b,d->>'name',prod.id,printer.id,spool.id,nullif(d->>'file_id','')::uuid,nullif(d->>'order_id','')::uuid,(d->>'quantity')::numeric,grams,hrs,cost,(d->>'kwh_price')::numeric,printer.watts,printer.hourly_cost,spool.cost_kg,(d->>'due_date')::date,coalesce(d->>'notes',''));
  update public.erp_spools set reserved_g=reserved_g+grams where id=spool.id;
  update public.erp_balances set reserved=reserved+grams/factor where product_id=spool.product_id and warehouse_id=spool.warehouse_id;
 elsif a in ('job.start','job.finish','job.cancel') then
  select * into job from public.erp_print_jobs where id=ident and business_id=b and status in ('planned','printing');
  if not found then raise exception 'Ordem já finalizada ou indisponível'; end if;
  select * into spool from public.erp_spools where id=job.spool_id;
  select case when unit='kg' then 1000 else 1 end into factor from public.products where id=spool.product_id;
  if a='job.start' then
   if job.status<>'planned' or exists(select 1 from public.erp_print_jobs where printer_id=job.printer_id and status='printing') then raise exception 'A impressora já está ocupada ou a ordem já iniciou'; end if;
   update public.erp_print_jobs set status='printing' where id=ident;
  else
   if a='job.cancel' and (job.status<>'planned' or length(trim(coalesce(d->>'reason','')))<3) then raise exception 'Informe o motivo; uma impressão iniciada deve registrar o consumo como conclusão ou falha'; end if;
   update public.erp_spools set reserved_g=reserved_g-job.estimated_g where id=spool.id;
   update public.erp_balances set reserved=reserved-job.estimated_g/factor where product_id=spool.product_id and warehouse_id=spool.warehouse_id;
   if a='job.cancel' then update public.erp_print_jobs set status='cancelled',notes=notes||E'\n'||(d->>'reason') where id=ident;
   else
    grams:=(d->>'actual_g')::numeric; hrs:=(d->>'actual_hours')::numeric; qty:=(d->>'good_quantity')::numeric;
    if grams is null or hrs is null or qty is null or grams<0 or hrs<0 or qty<0 or qty>job.quantity or grams<>round(grams/factor,3)*factor or grams>spool.remaining_g-spool.reserved_g+job.estimated_g or qty<>round(qty,3) then raise exception 'Revise consumo, horas e quantidade aprovada'; end if;
    update public.erp_spools set remaining_g=remaining_g-grams where id=spool.id;
    perform erp_private.stock(b,spool.product_id,spool.warehouse_id,-grams/factor,'print',ident,'Consumo da impressão: '||job.name);
    if qty>0 then perform erp_private.stock(b,job.product_id,(d->>'warehouse_id')::uuid,qty,'production',ident,'Peças aprovadas: '||job.name); end if;
    update public.erp_printers set hours=hours+hrs where id=job.printer_id;
    update public.erp_print_jobs set status=case when qty=0 then 'failed' else 'completed' end,actual_g=grams,actual_hours=hrs,good_quantity=qty,
     actual_cost=grams/1000*job.cost_kg+hrs*(job.hourly_cost+job.watts/1000*job.kwh_price),notes=notes||E'\n'||coalesce(d->>'notes','') where id=ident;
   end if;
  end if;
 else raise exception 'Operação desconhecida';
 end if;
 return jsonb_build_object('id',ident);
end $$;

create function erp_private.installments(b uuid,o uuid,f uuid,descr text,typ text,c text,amount numeric,dt date,due date,n integer,gap integer,cat text default 'Pedidos') returns void
language plpgsql set search_path='' as $$
declare i integer; part numeric; rest numeric:=amount; begin
 if amount<=0 then return; end if;
 part:=trunc(amount/n,erp_private.digits(c));
 for i in 1..n loop
 if (case when i=n then rest else part end)>0 then
 insert into public.erp_titles(business_id,order_id,fulfillment_id,description,type,currency,amount,competence_date,due_date,installment,category)
 values(b,o,f,descr||' · '||i||'/'||n,typ,c,case when i=n then rest else part end,dt,due+(i-1)*gap,i,cat); end if;
 rest:=rest-part; end loop;
end $$;

create function public.erp_command(p_business uuid,p_action text,p_data jsonb,p_key uuid) returns jsonb
language sql security invoker set search_path='' as $$ select erp_private.command(p_business,p_action,p_data,p_key) $$;
create function public.erp_read(p_business uuid,p_module text,p_filters jsonb default '{}') returns jsonb
language sql stable security invoker set search_path='' as $$ select erp_private.read_data(p_business,p_module,p_filters) $$;

do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'erp_%' loop
  execute format('alter table public.%I enable row level security',t.tablename);
  execute format('revoke all on public.%I from anon,authenticated',t.tablename);
  if t.tablename not in ('erp_members','erp_fulfillment_lines') then
   execute format('create policy business_read on public.%I for select to authenticated using (erp_private.allowed(business_id,''read''))',t.tablename);
   execute format('grant select on public.%I to authenticated',t.tablename);
   execute format('create index %I on public.%I (business_id)',t.tablename||'_business',t.tablename);
  end if;
 end loop;
end $$;
create policy members_admin_read on public.erp_members for select to authenticated using(erp_private.allowed(business_id,'admin'));
create policy fulfillment_lines_read on public.erp_fulfillment_lines for select to authenticated using(exists(select 1 from public.erp_fulfillments f where f.id=fulfillment_id and erp_private.allowed(f.business_id,'read')));
grant select on public.erp_members,public.erp_fulfillment_lines to authenticated;
alter table erp_private.requests enable row level security;
alter table erp_private.currencies enable row level security;
revoke all on all tables in schema erp_private from public,anon,authenticated;
revoke all on all functions in schema erp_private from public,anon,authenticated;
grant execute on function erp_private.allowed(uuid,text),erp_private.command(uuid,text,jsonb,uuid),erp_private.read_data(uuid,text,jsonb) to authenticated;
revoke all on function public.erp_command(uuid,text,jsonb,uuid),public.erp_read(uuid,text,jsonb) from public,anon;
grant execute on function public.erp_command(uuid,text,jsonb,uuid),public.erp_read(uuid,text,jsonb) to authenticated;
revoke all on function public.adjust_stock(uuid,numeric,text) from public,anon,authenticated;
revoke all on public.products,public.entries,public.stock_movements,public.business_units,public.businesses from anon,authenticated;
grant select on public.products,public.entries,public.stock_movements,public.business_units,public.businesses to authenticated;
create policy team_products_read on public.products for select to authenticated using(erp_private.allowed(business_id,'read'));
create policy team_business_read on public.business_units for select to authenticated using(erp_private.allowed(id,'read'));

create index erp_orders_period on public.erp_orders(business_id,currency,date desc);
create index erp_titles_due on public.erp_titles(business_id,currency,due_date);
create index erp_payments_date on public.erp_payments(business_id,date);
create index erp_lines_order on public.erp_order_lines(order_id);
create index erp_fulfillment_order on public.erp_fulfillments(order_id);
create index erp_fulfillment_lines_parent on public.erp_fulfillment_lines(fulfillment_id);
create index erp_ledger_product on public.erp_stock_ledger(business_id,product_id,created_at desc);
create index erp_payments_title on public.erp_payments(title_id);
create index erp_audit_period on public.erp_audit(business_id,created_at desc);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('erp-models','erp-models',false,26214400,array['model/3mf','application/octet-stream','application/zip']) on conflict(id) do nothing;
create policy models_read on storage.objects for select to authenticated using(bucket_id='erp-models' and erp_private.allowed(((storage.foldername(name))[1])::uuid,'read'));
create policy models_insert on storage.objects for insert to authenticated with check(bucket_id='erp-models' and erp_private.allowed(((storage.foldername(name))[1])::uuid,'production'));
create policy models_cleanup on storage.objects for delete to authenticated using(bucket_id='erp-models' and erp_private.allowed(((storage.foldername(name))[1])::uuid,'production') and not exists(select 1 from public.erp_files f where f.path=name));
alter table public.products drop constraint image_owner_path;
alter table public.products add constraint image_business_path check(image_path is null or split_part(image_path,'/',1) in (owner_id::text,business_id::text));
create policy team_photo_read on storage.objects for select to authenticated using(bucket_id='product-photos' and erp_private.allowed(((storage.foldername(name))[1])::uuid,'read'));
create policy team_photo_insert on storage.objects for insert to authenticated with check(bucket_id='product-photos' and erp_private.allowed(((storage.foldername(name))[1])::uuid,'catalog'));
create policy team_photo_delete on storage.objects for delete to authenticated using(bucket_id='product-photos' and erp_private.allowed(((storage.foldername(name))[1])::uuid,'catalog') and not exists(select 1 from public.products p where p.image_path=name));

insert into erp_private.currencies(code,digits) values
('AED',2),
('AFN',0),
('ALL',0),
('AMD',2),
('ANG',2),
('AOA',2),
('ARS',2),
('AUD',2),
('AWG',2),
('AZN',2),
('BAM',2),
('BBD',2),
('BDT',2),
('BGN',2),
('BHD',3),
('BIF',0),
('BMD',2),
('BND',2),
('BOB',2),
('BRL',2),
('BSD',2),
('BTN',2),
('BWP',2),
('BYN',2),
('BZD',2),
('CAD',2),
('CDF',2),
('CHF',2),
('CLP',0),
('CNY',2),
('COP',0),
('CRC',2),
('CUC',2),
('CUP',2),
('CVE',2),
('CZK',2),
('DJF',0),
('DKK',2),
('DOP',2),
('DZD',2),
('EGP',2),
('ERN',2),
('ETB',2),
('EUR',2),
('FJD',2),
('FKP',2),
('GBP',2),
('GEL',2),
('GHS',2),
('GIP',2),
('GMD',2),
('GNF',0),
('GTQ',2),
('GYD',2),
('HKD',2),
('HNL',2),
('HRK',2),
('HTG',2),
('HUF',0),
('IDR',0),
('ILS',2),
('INR',2),
('IQD',0),
('IRR',0),
('ISK',0),
('JMD',2),
('JOD',3),
('JPY',0),
('KES',2),
('KGS',2),
('KHR',2),
('KMF',0),
('KPW',0),
('KRW',0),
('KWD',3),
('KYD',2),
('KZT',2),
('LAK',0),
('LBP',0),
('LKR',2),
('LRD',2),
('LSL',2),
('LYD',3),
('MAD',2),
('MDL',2),
('MGA',0),
('MKD',2),
('MMK',0),
('MNT',2),
('MOP',2),
('MRU',2),
('MUR',2),
('MVR',2),
('MWK',2),
('MXN',2),
('MYR',2),
('MZN',2),
('NAD',2),
('NGN',2),
('NIO',2),
('NOK',2),
('NPR',2),
('NZD',2),
('OMR',3),
('PAB',2),
('PEN',2),
('PGK',2),
('PHP',2),
('PKR',0),
('PLN',2),
('PYG',0),
('QAR',2),
('RON',2),
('RSD',2),
('RUB',2),
('RWF',0),
('SAR',2),
('SBD',2),
('SCR',2),
('SDG',2),
('SEK',2),
('SGD',2),
('SHP',2),
('SLE',2),
('SLL',0),
('SOS',0),
('SRD',2),
('SSP',2),
('STN',2),
('SVC',2),
('SYP',0),
('SZL',2),
('THB',2),
('TJS',2),
('TMT',2),
('TND',3),
('TOP',2),
('TRY',2),
('TTD',2),
('TWD',2),
('TZS',2),
('UAH',2),
('UGX',0),
('USD',2),
('UYU',2),
('UZS',2),
('VES',2),
('VND',0),
('VUV',0),
('WST',2),
('XAF',0),
('XCD',2),
('XCG',2),
('XDR',2),
('XOF',0),
('XPF',0),
('XSU',2),
('YER',0),
('ZAR',2),
('ZMW',2),
('ZWG',2),
('ZWL',2);

