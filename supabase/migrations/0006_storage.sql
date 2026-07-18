-- 0006_storage.sql
-- Item photos move out of jsonb rows into Supabase Storage. Run once in the
-- Supabase SQL editor. Idempotent — safe to re-run.
--
-- Bucket `item-images` is PUBLIC: objects are readable by anyone who has the
-- URL. Paths are `<firm_id>/<random-uuid>.<ext>`, so URLs are unguessable —
-- the practical privacy model of most SaaS product-photo hosting. Writes are
-- firm-scoped by RLS: a member can only upload into (or delete from) their OWN
-- firm's folder, and only while the firm's subscription is active.
--
-- The app is tolerant of this migration not having run: uploads fail softly
-- and items simply keep storing base64 data URLs like before.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  true,
  2097152, -- 2 MB; client compresses to ~100-300 KB JPEGs well under this
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects (already enabled by Supabase). Folder segment 1 of the
-- object path must be the caller's firm id — same tenancy rule as every table.

drop policy if exists item_images_insert on storage.objects;
create policy item_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = public.current_firm_id()::text
    and public.firm_is_active(public.current_firm_id())
  );

drop policy if exists item_images_delete on storage.objects;
create policy item_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = public.current_firm_id()::text
    and public.firm_is_active(public.current_firm_id())
  );

-- Listing/reading through the authenticated API (public-URL reads don't need
-- this, but the dashboard/API listing path does).
drop policy if exists item_images_select on storage.objects;
create policy item_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-images'
    and (
      public.is_platform_admin()
      or (storage.foldername(name))[1] = public.current_firm_id()::text
    )
  );
