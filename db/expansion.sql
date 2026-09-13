alter table public.businesses drop constraint if exists businesses_niche_check;
alter table public.businesses add constraint business_niche_length check(length(trim(niche)) between 1 and 80);
alter table public.businesses add column custom_options jsonb not null default '[]'::jsonb check(jsonb_typeof(custom_options)='array' and jsonb_array_length(custom_options)<=50);
alter table public.products alter column stock type numeric(14,3);
alter table public.products add column item_type text not null default 'finished' check(item_type in ('finished','material','part','service'));
alter table public.products add column unit text not null default 'un' check(unit in ('un','kg','g','L','m','h'));
alter table public.products add column min_stock numeric(14,3) not null default 0 check(min_stock>=0);
alter table public.products add column image_path text;
alter table public.products add constraint image_owner_path check(image_path is null or split_part(image_path,'/',1)=owner_id::text);
create table public.stock_movements(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,product_id uuid not null,delta numeric(14,3) not null check(delta<>0),balance numeric(14,3) not null check(balance>=0),note text not null check(length(trim(note)) between 1 and 200),created_at timestamptz not null default now(),foreign key(product_id,owner_id) references public.products(id,owner_id));
create index stock_movements_owner_created on public.stock_movements(owner_id,created_at desc);
create index stock_movements_product_owner on public.stock_movements(product_id,owner_id);
alter table public.stock_movements enable row level security;
create policy owner_read on public.stock_movements for select to authenticated using((select auth.uid())=owner_id);
create policy owner_insert on public.stock_movements for insert to authenticated with check((select auth.uid())=owner_id);
revoke all on public.stock_movements from anon;
grant select,insert on public.stock_movements to authenticated;
create or replace function public.adjust_stock(p_product uuid,p_delta numeric,p_note text)
returns public.products language plpgsql security invoker set search_path='' as $$
declare changed public.products;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta';end if;
 if p_delta is null or p_delta=0 or p_delta<>round(p_delta,3) or p_note is null or length(trim(p_note)) not between 1 and 200 then raise exception 'Movimentação inválida';end if;
 update public.products set stock=stock+p_delta where id=p_product and owner_id=auth.uid() and item_type<>'service' and stock+p_delta>=0 returning * into changed;
 if not found then raise exception 'Saldo insuficiente ou item indisponível';end if;
 insert into public.stock_movements(owner_id,product_id,delta,balance,note) values(auth.uid(),p_product,p_delta,changed.stock,trim(p_note));
 return changed;
end $$;
revoke all on function public.adjust_stock(uuid,numeric,text) from public,anon;
grant execute on function public.adjust_stock(uuid,numeric,text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('product-photos','product-photos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy product_photo_select on storage.objects for select to authenticated using(bucket_id='product-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy product_photo_insert on storage.objects for insert to authenticated with check(bucket_id='product-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy product_photo_delete on storage.objects for delete to authenticated using(bucket_id='product-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
