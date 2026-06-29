-- Stage 3: merge the Launch category into Commercial.
--
-- Launch (violet triangle) and Distribution (violet hexagon) are the same editorial
-- color family -- the commercial lifecycle -- yet sat in two separate single-type
-- categories. Collapse them into one Commercial category (Launch -> Distribution),
-- which keeps the category mono-color and matches the brand's "Launch and commercial
-- availability: violet" family. LOE stays its own amber category (a distinct family),
-- and Corporate stays rose.
--
-- System-row data change only. Type ids are preserved (UPDATE, not recreate) so
-- existing events and seed references stay valid. Mirrors the corporate-family
-- migration (re-parent + re-home leftovers + drop empty category + remote-safe smoke).

-- 0. Latent bug fix: event_type_categories carries the trg_etc_set_updated_audit
--    trigger (which sets new.updated_by + new.updated_at), but the table was created
--    without an updated_by column. So ANY update to a category row errors 42703
--    ("record new has no field updated_by") -- this migration's reorder below, and the
--    taxonomy admin's edit-category path, both hit it. Add the missing column so it
--    matches event_types (which has created_by + updated_by + updated_at).
alter table public.event_type_categories
  add column if not exists updated_by uuid references auth.users (id);

-- 1. Commercial takes Launch's lifecycle slot (order 5), so the legend reads
--    Approval (4) -> Commercial (5) -> Loss of Exclusivity (6).
update public.event_type_categories set display_order = 5
where id = 'd0000000-0000-0000-0000-000000000007'; -- Commercial

-- 2. Re-parent the Launch type into Commercial, ordered before Distribution
--    (launch precedes distribution within the commercial lifecycle).
update public.event_types set
  category_id = 'd0000000-0000-0000-0000-000000000007', display_order = 1
where id = 'a0000000-0000-0000-0000-000000000036'; -- Launch (violet triangle)

update public.event_types set display_order = 2
where id = 'a0000000-0000-0000-0000-000000000040'; -- Distribution (violet hexagon)

-- 3. Re-home any remaining (custom, space-scoped) types still filed under Launch into
--    Commercial, so the delete below is FK-safe on a populated DB. Their own
--    shape/color/inner-mark are left untouched.
update public.event_types
set category_id = 'd0000000-0000-0000-0000-000000000007'
where category_id = 'd0000000-0000-0000-0000-000000000005';

-- 4. Drop the now-empty Launch category.
delete from public.event_type_categories
where id = 'd0000000-0000-0000-0000-000000000005';

-- in-migration smoke: Launch resolves into Commercial, the Launch category is gone,
-- and Commercial sits before LOE. Reads tables directly (no access-guarded RPC, no
-- secret) so it is remote-safe on populated dev.
do $$
declare
  v_commercial uuid := 'd0000000-0000-0000-0000-000000000007';
  v_cat uuid; v_order int; v_commercial_order int; v_loe_order int;
begin
  select category_id into v_cat
    from public.event_types where id = 'a0000000-0000-0000-0000-000000000036';
  if v_cat is distinct from v_commercial then
    raise exception 'Launch type not re-parented into Commercial: cat=%', v_cat;
  end if;

  if exists (select 1 from public.event_type_categories
             where id = 'd0000000-0000-0000-0000-000000000005') then
    raise exception 'Launch category was not dropped';
  end if;

  select display_order into v_commercial_order
    from public.event_type_categories where id = v_commercial;
  select display_order into v_loe_order
    from public.event_type_categories where id = 'd0000000-0000-0000-0000-000000000006';
  if not (v_commercial_order < v_loe_order) then
    raise exception 'Commercial (%) should order before LOE (%)', v_commercial_order, v_loe_order;
  end if;
end $$;

notify pgrst, 'reload schema';
