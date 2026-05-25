-- migration: 20260524120200_rename_products_to_assets
-- purpose: rename public.products to public.assets and update all FK columns,
--          junction tables, indexes, RLS policies, triggers, and data references.
-- affected tables: products->assets, trials, events, product_mechanisms_of_action,
--                  product_routes_of_administration, asset_indications, palette_*,
--                  primary_intelligence*, material_links

-- =============================================================================
-- 1. rename the table
-- =============================================================================
alter table public.products rename to assets;

-- =============================================================================
-- 2. rename FK columns on referencing tables
-- =============================================================================
alter table public.trials rename column product_id to asset_id;
alter table public.events rename column product_id to asset_id;

-- =============================================================================
-- 3. rename junction tables and their columns
-- =============================================================================
alter table public.product_mechanisms_of_action rename to asset_mechanisms_of_action;
alter table public.asset_mechanisms_of_action rename column product_id to asset_id;

alter table public.product_routes_of_administration rename to asset_routes_of_administration;
alter table public.asset_routes_of_administration rename column product_id to asset_id;

-- =============================================================================
-- 4. rename indexes on assets (formerly products)
-- =============================================================================
alter index if exists idx_products_company_id rename to idx_assets_company_id;
alter index if exists idx_products_space_id rename to idx_assets_space_id;
alter index if exists products_name_trgm rename to assets_name_trgm;
alter index if exists products_generic_name_trgm rename to assets_generic_name_trgm;

-- rename indexes on trials
alter index if exists idx_trials_product_id rename to idx_trials_asset_id;

-- rename indexes on events
alter index if exists idx_events_product_id rename to idx_events_asset_id;

-- rename indexes on junction tables
alter index if exists idx_product_mechanisms_by_moa rename to idx_asset_mechanisms_by_moa;
alter index if exists idx_product_routes_by_roa rename to idx_asset_routes_by_roa;

-- =============================================================================
-- 5. drop and recreate RLS policies on assets (was products)
-- =============================================================================
drop policy if exists "space members can view products" on public.assets;
drop policy if exists "space editors can insert products" on public.assets;
drop policy if exists "space editors can update products" on public.assets;
drop policy if exists "space editors can delete products" on public.assets;

create policy "space members can view assets" on public.assets for select to authenticated
  using ( public.has_space_access(space_id) );
create policy "space editors can insert assets" on public.assets for insert to authenticated
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update assets" on public.assets for update to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) )
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete assets" on public.assets for delete to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- drop and recreate RLS policies on asset_mechanisms_of_action (was product_*)
drop policy if exists "space members can view product_mechanisms_of_action" on public.asset_mechanisms_of_action;
drop policy if exists "space editors can insert product_mechanisms_of_action" on public.asset_mechanisms_of_action;
drop policy if exists "space editors can delete product_mechanisms_of_action" on public.asset_mechanisms_of_action;

create policy "space members can view asset_mechanisms_of_action" on public.asset_mechanisms_of_action for select to authenticated
  using ( exists (select 1 from public.assets a where a.id = asset_mechanisms_of_action.asset_id and public.has_space_access(a.space_id)) );
create policy "space editors can insert asset_mechanisms_of_action" on public.asset_mechanisms_of_action for insert to authenticated
  with check ( exists (select 1 from public.assets a where a.id = asset_mechanisms_of_action.asset_id and public.has_space_access(a.space_id, array['owner', 'editor'])) );
create policy "space editors can delete asset_mechanisms_of_action" on public.asset_mechanisms_of_action for delete to authenticated
  using ( exists (select 1 from public.assets a where a.id = asset_mechanisms_of_action.asset_id and public.has_space_access(a.space_id, array['owner', 'editor'])) );

-- drop and recreate RLS policies on asset_routes_of_administration (was product_*)
drop policy if exists "space members can view product_routes_of_administration" on public.asset_routes_of_administration;
drop policy if exists "space editors can insert product_routes_of_administration" on public.asset_routes_of_administration;
drop policy if exists "space editors can delete product_routes_of_administration" on public.asset_routes_of_administration;

create policy "space members can view asset_routes_of_administration" on public.asset_routes_of_administration for select to authenticated
  using ( exists (select 1 from public.assets a where a.id = asset_routes_of_administration.asset_id and public.has_space_access(a.space_id)) );
create policy "space editors can insert asset_routes_of_administration" on public.asset_routes_of_administration for insert to authenticated
  with check ( exists (select 1 from public.assets a where a.id = asset_routes_of_administration.asset_id and public.has_space_access(a.space_id, array['owner', 'editor'])) );
create policy "space editors can delete asset_routes_of_administration" on public.asset_routes_of_administration for delete to authenticated
  using ( exists (select 1 from public.assets a where a.id = asset_routes_of_administration.asset_id and public.has_space_access(a.space_id, array['owner', 'editor'])) );

-- =============================================================================
-- 6. rename audit triggers on assets
-- =============================================================================
drop trigger if exists trg_products_set_created_by on public.assets;
drop trigger if exists trg_products_set_updated_audit on public.assets;

create trigger trg_assets_set_created_by
  before insert on public.assets
  for each row execute function public._set_created_by();
create trigger trg_assets_set_updated_audit
  before update on public.assets
  for each row execute function public._set_updated_audit();

-- =============================================================================
-- 7. update polymorphic cleanup trigger (entity_type 'product' -> 'asset')
-- =============================================================================
drop trigger if exists _cleanup_polymorphic_refs_product on public.assets;

create trigger _cleanup_polymorphic_refs_asset
  after delete on public.assets
  for each row execute function public._cleanup_polymorphic_refs('asset');

-- update CHECK constraints on polymorphic entity_type columns BEFORE updating data
alter table public.primary_intelligence
  drop constraint if exists primary_intelligence_entity_type_check;
alter table public.primary_intelligence
  add constraint primary_intelligence_entity_type_check
  check (entity_type in ('trial', 'marker', 'company', 'asset', 'product', 'space'));

alter table public.primary_intelligence_links
  drop constraint if exists primary_intelligence_links_entity_type_check;
alter table public.primary_intelligence_links
  add constraint primary_intelligence_links_entity_type_check
  check (entity_type in ('trial', 'marker', 'company', 'asset', 'product'));

update public.primary_intelligence set entity_type = 'asset' where entity_type = 'product';
update public.primary_intelligence_links set entity_type = 'asset' where entity_type = 'product';
update public.material_links set entity_type = 'asset' where entity_type = 'product';

-- =============================================================================
-- 8. update palette kind 'product' -> 'asset'
-- =============================================================================
update public.palette_pinned set kind = 'asset' where kind = 'product';
update public.palette_recents set kind = 'asset' where kind = 'product';

-- update CHECK constraints on palette tables
alter table public.palette_pinned drop constraint if exists palette_pinned_kind_check;
alter table public.palette_pinned add constraint palette_pinned_kind_check
  check (kind in ('company','asset','product','trial','catalyst','event'));

alter table public.palette_recents drop constraint if exists palette_recents_kind_check;
alter table public.palette_recents add constraint palette_recents_kind_check
  check (kind in ('company','asset','product','trial','catalyst','event'));

-- =============================================================================
-- 9. update events polymorphic constraint
-- =============================================================================
-- the events table has a CHECK that at most one of company_id, product_id (now
-- asset_id), trial_id is set. the constraint references column names by position
-- in the expression, which auto-update with rename. no action needed.

-- =============================================================================
-- 10. update trial change events payload references
-- =============================================================================
-- trial_change_events.event_type has 'product_name_changed' values; these are
-- historical data that should remain as-is (the event describes what happened
-- at that point in time). no migration needed for audit/change data.

-- =============================================================================
-- smoke tests
-- =============================================================================
do $$
declare
  v_assets_count   int;
  v_has_products   bool;
  v_trial_null     int;
  v_ama_count      int;
  v_ara_count      int;
begin
  select exists(
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'products'
  ) into v_has_products;
  assert not v_has_products, 'products table should not exist';

  select count(*) into v_assets_count from public.assets;

  select count(*) into v_trial_null
    from public.trials where asset_id is null;
  assert v_trial_null = 0, 'no trials should have null asset_id';

  select count(*) into v_ama_count from public.asset_mechanisms_of_action;
  select count(*) into v_ara_count from public.asset_routes_of_administration;

  raise notice 'smoke: products->assets rename passed (% assets, % MOA links, % ROA links)',
    v_assets_count, v_ama_count, v_ara_count;
end;
$$;
