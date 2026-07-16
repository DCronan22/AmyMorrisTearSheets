-- 0005_inventory.sql
-- Firm-wide physical inventory. Run once in the Supabase SQL editor.
--
-- Tracks what the business physically has in stock, with quantities. Each row
-- belongs to exactly one firm and is governed by the same subscription /
-- row-level-security model as `library_items` (see 0004_library.sql): a member
-- can only touch their own firm's inventory while the firm is active; a
-- platform admin can see everything.
--
-- The product spec is stored as a single `data` jsonb blob (same shape as a
-- library item), so adding fields later needs no migration. The on-hand count
-- lives in its own `quantity` column: zero is allowed ("we stock this but have
-- none right now") — removing an entry is always an explicit delete.
-- Idempotent — safe to re-run.

create table if not exists public.inventory_items (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  quantity   integer not null default 1 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_items_firm_id_idx
  on public.inventory_items (firm_id);

-- Keep updated_at fresh on every write (reuses the shared trigger fn from 0001).
drop trigger if exists inventory_items_touch_updated_at on public.inventory_items;
create trigger inventory_items_touch_updated_at
  before update on public.inventory_items
  for each row execute function public.touch_updated_at();

alter table public.inventory_items enable row level security;

-- RLS — identical shape to the library_items_* policies in 0004_library.sql.
drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select on public.inventory_items
  for select using (
    public.is_platform_admin()
    or (firm_id = public.current_firm_id() and public.firm_is_active(firm_id))
  );

drop policy if exists inventory_items_insert on public.inventory_items;
create policy inventory_items_insert on public.inventory_items
  for insert with check (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );

drop policy if exists inventory_items_update on public.inventory_items;
create policy inventory_items_update on public.inventory_items
  for update using (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  ) with check (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );

drop policy if exists inventory_items_delete on public.inventory_items;
create policy inventory_items_delete on public.inventory_items
  for delete using (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );

-- Table grants (RLS still applies row-by-row). Supabase grants these to new
-- tables by default; stated explicitly so a re-run always leaves them correct.
grant select, insert, update, delete on public.inventory_items to authenticated;
