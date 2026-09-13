-- Preserve minor units for ISO currencies with 0, 2, 3 or 4 decimal places.
alter table public.products alter column cost type numeric(18,4), alter column price type numeric(18,4);
alter table public.entries alter column amount type numeric(18,4);
