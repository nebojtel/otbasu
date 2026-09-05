-- Deploy the vitrine's explicit product-column query BEFORE running this file.
-- Run as the database owner in Supabase SQL Editor. No product data is changed.
begin;

-- Anonymous catalog clients may only select public product fields.
revoke select on table public.products from public, anon;
revoke select (id, title, category_id, category, tag, status, image_url, images,
  kaspi_url, video_url, sort, note, created_by, created_at, updated_at)
  on public.products from public, anon;
grant select (id, title, category, tag, status, image_url, images,
  kaspi_url, video_url, sort, created_at, updated_at)
  on public.products to anon;
grant select on public.products to authenticated;

drop policy if exists "products_public_read_active" on public.products;
create policy "products_public_read_active" on public.products
  for select to anon using (status = 'active');

drop policy if exists "products_manage_content" on public.products;
create policy "products_manage_content" on public.products
  for all to authenticated
  using (public.can_manage_content()) with check (public.can_manage_content());

-- A signed-in account without a staff profile must not read internal fields.
drop policy if exists "products_staff_read_only" on public.products;
create policy "products_staff_read_only" on public.products
  as restrictive for select to authenticated using (public.can_manage_content());

notify pgrst, 'reload schema';
commit;
