-- 0004_library.sql
-- Firm-wide master tear-sheet library.
--
-- A reusable catalog of products that members drop into client projects. Each
-- row belongs to exactly one firm and is governed by the same subscription /
-- row-level-security model as `projects` (see 0001_init.sql): a member can
-- only touch their own firm's library while the firm is active; a platform
-- admin can see everything.
--
-- The product spec is stored as a single `data` jsonb blob (mirroring how
-- `projects.items` is already stored), so adding fields to the LibraryItem
-- shape later needs no migration. Idempotent — safe to re-run.

create table if not exists public.library_items (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists library_items_firm_id_idx
  on public.library_items (firm_id);

-- Keep updated_at fresh on every write (reuses the shared trigger fn from 0001).
drop trigger if exists library_items_touch_updated_at on public.library_items;
create trigger library_items_touch_updated_at
  before update on public.library_items
  for each row execute function public.touch_updated_at();

alter table public.library_items enable row level security;

-- RLS — identical shape to the projects_* policies in 0001_init.sql.
drop policy if exists library_items_select on public.library_items;
create policy library_items_select on public.library_items
  for select using (
    public.is_platform_admin()
    or (firm_id = public.current_firm_id() and public.firm_is_active(firm_id))
  );

drop policy if exists library_items_insert on public.library_items;
create policy library_items_insert on public.library_items
  for insert with check (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );

drop policy if exists library_items_update on public.library_items;
create policy library_items_update on public.library_items
  for update using (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  ) with check (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );

drop policy if exists library_items_delete on public.library_items;
create policy library_items_delete on public.library_items
  for delete using (
    firm_id = public.current_firm_id() and public.firm_is_active(firm_id)
  );
