create table public.business_units(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(trim(name)) between 1 and 80),model text not null check(model in ('printing','mechanic','food','lodging','retail','service')),description text not null default '',contact_email text not null default '',phone text not null default '',deleted_at timestamptz,created_at timestamptz not null default now(),unique(id,owner_id));
create index business_units_owner on public.business_units(owner_id);
alter table public.business_units enable row level security;
create policy own_units on public.business_units for all to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
revoke all on public.business_units from anon;
grant select,insert,update,delete on public.business_units to authenticated;
insert into public.business_units(owner_id,name,model) select owner_id,niche,case when niche='Impressão 3D' then 'printing' when niche in ('Mecânica','Pneus') then 'mechanic' when niche='Cozinha' then 'food' when niche='Hospedagem' then 'lodging' else 'service' end from public.businesses;
alter table public.products add column business_id uuid;
alter table public.entries add column business_id uuid;
update public.products p set business_id=b.id from public.business_units b where b.owner_id=p.owner_id;
update public.entries p set business_id=b.id from public.business_units b where b.owner_id=p.owner_id;
alter table public.products add constraint products_unit_owner foreign key(business_id,owner_id) references public.business_units(id,owner_id);
alter table public.entries add constraint entries_unit_owner foreign key(business_id,owner_id) references public.business_units(id,owner_id);
alter table public.products add column currency text not null default 'BRL' check(currency ~ '^[A-Z]{3}$');
alter table public.entries add column currency text not null default 'BRL' check(currency ~ '^[A-Z]{3}$');
alter table public.products add column description text not null default '';
alter table public.products add column sku text not null default '';
alter table public.products add column supplier text not null default '';
alter table public.products add column location text not null default '';
alter table public.products add column deleted_at timestamptz;
alter table public.entries add column deleted_at timestamptz;
alter table public.entries add column contact text not null default '';
alter table public.entries add column payment_method text not null default 'transfer';
alter table public.entries add column notes text not null default '';
create index products_business_owner on public.products(business_id,owner_id);
create index entries_business_owner on public.entries(business_id,owner_id);
create or replace function public.validate_entry_product() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.product_id is not null and not exists(select 1 from public.products p where p.id=new.product_id and p.owner_id=new.owner_id and p.business_id is not distinct from new.business_id and p.currency=new.currency) then raise exception 'Produto de outra empresa ou moeda';end if;return new;
end $$;
create trigger valid_entry_product before insert or update of product_id,business_id,currency on public.entries for each row execute function public.validate_entry_product();
create or replace function public.adjust_stock(p_product uuid,p_delta numeric,p_note text) returns public.products language plpgsql security invoker set search_path='' as $$
declare changed public.products;
begin
if auth.uid() is null then raise exception 'Entre na sua conta';end if;
if p_delta is null or p_delta=0 or p_delta<>round(p_delta,3) or p_note is null or length(trim(p_note)) not between 1 and 200 then raise exception 'Movimentação inválida';end if;
update public.products set stock=stock+p_delta where id=p_product and owner_id=auth.uid() and item_type<>'service' and deleted_at is null and stock+p_delta>=0 returning * into changed;
if not found then raise exception 'Saldo insuficiente ou item indisponível';end if;
insert into public.stock_movements(owner_id,product_id,delta,balance,note) values(auth.uid(),p_product,p_delta,changed.stock,trim(p_note));return changed;
end $$;
