-- Stage 3: corporate event family + documented glyph allocation.
--
-- The event-model overhaul added four corporate/business categories (Commercial,
-- Leadership, Financial, Strategic) without a distinct visual treatment: Leadership
-- Change / Financial / Strategic were identical slate circles (colliding with trial
-- milestones) and Distribution was teal (colliding with the brand hero + phase bars).
--
-- The palette is exhausted after the clinical lifecycle (green/slate/orange/blue/
-- violet/amber are spent; teal is reserved for brand + phase bars), so the business
-- axis cannot get a color per category. It becomes a single rose "Corporate" family,
-- differentiated internally by inner-mark, plus Distribution joining the violet
-- commercialization family as commercial availability.
--
-- Allocation rule (see docs/brand.md + the Event-glyphs help page):
--   color = editorial family, shape = the family signature glyph,
--   inner-mark = the specific type within a family.
--
-- This is a system-row data change only. Type ids are preserved (UPDATE, not
-- recreate) so existing events and seed_demo references stay valid. Respects the
-- D2 space-name unique constraints + the system partial-name indexes (Corporate is
-- a new system name; the recolored types keep their names).

-- 1. New Corporate category (system, rose), ordered right after Commercial (7).
insert into public.event_type_categories (id, space_id, name, display_order, is_system, created_by) values
  ('d0000000-0000-0000-0000-00000000000b', null, 'Corporate', 8, true, null)
on conflict (id) do update set
  name = excluded.name, display_order = excluded.display_order, is_system = excluded.is_system;

-- 2. Re-parent + recolor the three governance types to rose hexagons, differentiated
--    by inner-mark: Leadership Change (none), Financial (dot), Strategic (dash).
update public.event_types set
  category_id = 'd0000000-0000-0000-0000-00000000000b',
  shape = 'hexagon', color = '#be123c', inner_mark = 'none'
where id = 'a0000000-0000-0000-0000-000000000050'; -- Leadership Change

update public.event_types set
  category_id = 'd0000000-0000-0000-0000-00000000000b',
  shape = 'hexagon', color = '#be123c', inner_mark = 'dot'
where id = 'a0000000-0000-0000-0000-000000000060'; -- Financial

update public.event_types set
  category_id = 'd0000000-0000-0000-0000-00000000000b',
  shape = 'hexagon', color = '#be123c', inner_mark = 'dash'
where id = 'a0000000-0000-0000-0000-000000000070'; -- Strategic

-- 3. Recolor Distribution teal -> violet (commercial availability joins the violet
--    commercialization family). Shape stays hexagon; category stays Commercial.
update public.event_types set color = '#7c3aed'
where id = 'a0000000-0000-0000-0000-000000000040'; -- Distribution

-- 4. Re-home any remaining (custom, space-scoped) types still filed under the doomed
--    governance categories into Corporate, so the delete below is FK-safe on a
--    populated DB. Their own shape/color/inner-mark are left untouched.
update public.event_types
set category_id = 'd0000000-0000-0000-0000-00000000000b'
where category_id in (
  'd0000000-0000-0000-0000-000000000008',
  'd0000000-0000-0000-0000-000000000009',
  'd0000000-0000-0000-0000-00000000000a'
);

-- 5. Drop the now-empty governance categories.
delete from public.event_type_categories
where id in (
  'd0000000-0000-0000-0000-000000000008', -- Leadership
  'd0000000-0000-0000-0000-000000000009', -- Financial
  'd0000000-0000-0000-0000-00000000000a'  -- Strategic
);

-- in-migration smoke: assert the four types resolve to the expected
-- shape/color/inner_mark/category and the empty categories are gone. Reads tables
-- directly (no access-guarded RPC, no secret) so it is remote-safe on populated dev.
do $$
declare
  v_corp uuid := 'd0000000-0000-0000-0000-00000000000b';
  v_commercial uuid := 'd0000000-0000-0000-0000-000000000007';
  v_shape text; v_color text; v_mark text; v_cat uuid;
begin
  select shape, color, inner_mark, category_id into v_shape, v_color, v_mark, v_cat
    from public.event_types where id = 'a0000000-0000-0000-0000-000000000050';
  if not (v_shape = 'hexagon' and v_color = '#be123c' and v_mark = 'none' and v_cat = v_corp) then
    raise exception 'Leadership Change not recolored: shape=% color=% mark=% cat=%', v_shape, v_color, v_mark, v_cat;
  end if;

  select shape, color, inner_mark, category_id into v_shape, v_color, v_mark, v_cat
    from public.event_types where id = 'a0000000-0000-0000-0000-000000000060';
  if not (v_shape = 'hexagon' and v_color = '#be123c' and v_mark = 'dot' and v_cat = v_corp) then
    raise exception 'Financial not recolored: shape=% color=% mark=% cat=%', v_shape, v_color, v_mark, v_cat;
  end if;

  select shape, color, inner_mark, category_id into v_shape, v_color, v_mark, v_cat
    from public.event_types where id = 'a0000000-0000-0000-0000-000000000070';
  if not (v_shape = 'hexagon' and v_color = '#be123c' and v_mark = 'dash' and v_cat = v_corp) then
    raise exception 'Strategic not recolored: shape=% color=% mark=% cat=%', v_shape, v_color, v_mark, v_cat;
  end if;

  select shape, color, category_id into v_shape, v_color, v_cat
    from public.event_types where id = 'a0000000-0000-0000-0000-000000000040';
  if not (v_shape = 'hexagon' and v_color = '#7c3aed' and v_cat = v_commercial) then
    raise exception 'Distribution not recolored: shape=% color=% cat=%', v_shape, v_color, v_cat;
  end if;

  if exists (
    select 1 from public.event_type_categories
    where id in (
      'd0000000-0000-0000-0000-000000000008',
      'd0000000-0000-0000-0000-000000000009',
      'd0000000-0000-0000-0000-00000000000a'
    )
  ) then
    raise exception 'governance categories were not dropped';
  end if;
end $$;

notify pgrst, 'reload schema';
