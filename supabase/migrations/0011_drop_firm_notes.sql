-- 0011_drop_firm_notes.sql
-- APPLY ONLY AFTER the frontend from the security-hardening branch is live
-- (it selects explicit firm columns; an old `select *` prepared before the drop
-- can fail once with "cached plan must not change result type"). Admin notes
-- now live in public.firm_admin_notes. Requires 0009 to have run first.
-- Idempotent — safe to re-run.
--
-- 0009 already copied every firms.notes value into public.firm_admin_notes and
-- blanked the old column; this removes the column for good so the private
-- notes can never reappear in the member-readable firms row (or in the row
-- returned by set_firm_style, which `returns public.firms`).

do $$
begin
  if to_regclass('public.firm_admin_notes') is null then
    raise exception '0011 requires 0009_security_hardening (firm_admin_notes missing)';
  end if;

  -- Last-chance copy in case anything wrote firms.notes after 0009 ran.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'firms' and column_name = 'notes'
  ) then
    insert into public.firm_admin_notes (firm_id, notes)
    select id, notes from public.firms
    where coalesce(notes, '') <> ''
    on conflict (firm_id) do nothing;
  end if;
end
$$;

alter table public.firms drop column if exists notes;

-- Let the REST API pick up the new firms shape right away.
notify pgrst, 'reload schema';
