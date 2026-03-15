-- migration: 20260315170100_add_space_id_to_data_tables
-- purpose: migrate all data tables from per-user ownership (user_id) to
--          per-space ownership (space_id). drops old rls policies and
--          creates new space-membership-based policies.
-- note: this is a destructive migration (drops user_id columns).
--       existing data must be migrated or re-seeded.

-- =============================================================================
-- drop all existing user_id-based rls policies
-- =============================================================================

drop policy if exists "users can view own companies" on public.companies;
drop policy if exists "users can insert own companies" on public.companies;
drop policy if exists "users can update own companies" on public.companies;
drop policy if exists "users can delete own companies" on public.companies;

drop policy if exists "users can view own products" on public.products;
drop policy if exists "users can insert own products" on public.products;
drop policy if exists "users can update own products" on public.products;
drop policy if exists "users can delete own products" on public.products;

drop policy if exists "users can view own therapeutic_areas" on public.therapeutic_areas;
drop policy if exists "users can insert own therapeutic_areas" on public.therapeutic_areas;
drop policy if exists "users can update own therapeutic_areas" on public.therapeutic_areas;
drop policy if exists "users can delete own therapeutic_areas" on public.therapeutic_areas;

drop policy if exists "users can view own trials" on public.trials;
drop policy if exists "users can insert own trials" on public.trials;
drop policy if exists "users can update own trials" on public.trials;
drop policy if exists "users can delete own trials" on public.trials;

drop policy if exists "users can view own trial_phases" on public.trial_phases;
drop policy if exists "users can insert own trial_phases" on public.trial_phases;
drop policy if exists "users can update own trial_phases" on public.trial_phases;
drop policy if exists "users can delete own trial_phases" on public.trial_phases;

drop policy if exists "users can view own marker_types" on public.marker_types;
drop policy if exists "users can insert own marker_types" on public.marker_types;
drop policy if exists "users can update own marker_types" on public.marker_types;
drop policy if exists "users can delete own marker_types" on public.marker_types;

drop policy if exists "users can view own trial_markers" on public.trial_markers;
drop policy if exists "users can insert own trial_markers" on public.trial_markers;
drop policy if exists "users can update own trial_markers" on public.trial_markers;
drop policy if exists "users can delete own trial_markers" on public.trial_markers;

drop policy if exists "users can view own trial_notes" on public.trial_notes;
drop policy if exists "users can insert own trial_notes" on public.trial_notes;
drop policy if exists "users can update own trial_notes" on public.trial_notes;
drop policy if exists "users can delete own trial_notes" on public.trial_notes;

-- =============================================================================
-- truncate all data tables (fresh start)
-- =============================================================================

truncate public.trial_notes cascade;
truncate public.trial_markers cascade;
truncate public.trial_phases cascade;
truncate public.trials cascade;
truncate public.products cascade;
truncate public.companies cascade;
truncate public.therapeutic_areas cascade;
-- keep system marker types, delete user-created ones
delete from public.marker_types where is_system = false;

-- =============================================================================
-- add space_id and created_by to data tables, drop user_id
-- =============================================================================

-- companies
alter table public.companies add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.companies add column created_by uuid references auth.users (id);
drop index if exists idx_companies_user_id;
alter table public.companies drop column if exists user_id;
alter table public.companies alter column space_id set not null;
alter table public.companies alter column created_by set not null;
create index idx_companies_space_id on public.companies (space_id);

-- products
alter table public.products add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.products add column created_by uuid references auth.users (id);
drop index if exists idx_products_user_id;
alter table public.products drop column if exists user_id;
alter table public.products alter column space_id set not null;
alter table public.products alter column created_by set not null;
create index idx_products_space_id on public.products (space_id);

-- therapeutic_areas
alter table public.therapeutic_areas add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.therapeutic_areas add column created_by uuid references auth.users (id);
drop index if exists idx_therapeutic_areas_user_id;
alter table public.therapeutic_areas drop column if exists user_id;
alter table public.therapeutic_areas alter column space_id set not null;
alter table public.therapeutic_areas alter column created_by set not null;
create index idx_therapeutic_areas_space_id on public.therapeutic_areas (space_id);

-- trials
alter table public.trials add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.trials add column created_by uuid references auth.users (id);
drop index if exists idx_trials_user_id;
alter table public.trials drop column if exists user_id;
alter table public.trials alter column space_id set not null;
alter table public.trials alter column created_by set not null;
create index idx_trials_space_id on public.trials (space_id);

-- trial_phases
alter table public.trial_phases add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.trial_phases add column created_by uuid references auth.users (id);
drop index if exists idx_trial_phases_user_id;
alter table public.trial_phases drop column if exists user_id;
alter table public.trial_phases alter column space_id set not null;
alter table public.trial_phases alter column created_by set not null;
create index idx_trial_phases_space_id on public.trial_phases (space_id);

-- trial_markers
alter table public.trial_markers add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.trial_markers add column created_by uuid references auth.users (id);
drop index if exists idx_trial_markers_user_id;
alter table public.trial_markers drop column if exists user_id;
alter table public.trial_markers alter column space_id set not null;
alter table public.trial_markers alter column created_by set not null;
create index idx_trial_markers_space_id on public.trial_markers (space_id);

-- trial_notes
alter table public.trial_notes add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.trial_notes add column created_by uuid references auth.users (id);
drop index if exists idx_trial_notes_user_id;
alter table public.trial_notes drop column if exists user_id;
alter table public.trial_notes alter column space_id set not null;
alter table public.trial_notes alter column created_by set not null;
create index idx_trial_notes_space_id on public.trial_notes (space_id);

-- marker_types: space_id is nullable (null for system types)
alter table public.marker_types add column space_id uuid references public.spaces (id) on delete cascade;
alter table public.marker_types add column created_by uuid references auth.users (id);
drop index if exists idx_marker_types_user_id;
alter table public.marker_types drop column if exists user_id;
create index idx_marker_types_space_id on public.marker_types (space_id);

-- =============================================================================
-- new rls policies for data tables (space-membership based)
-- =============================================================================

-- companies
create policy "space members can view companies" on public.companies for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert companies" on public.companies for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update companies" on public.companies for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete companies" on public.companies for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- products
create policy "space members can view products" on public.products for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert products" on public.products for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update products" on public.products for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete products" on public.products for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- therapeutic_areas
create policy "space members can view therapeutic_areas" on public.therapeutic_areas for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert therapeutic_areas" on public.therapeutic_areas for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update therapeutic_areas" on public.therapeutic_areas for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete therapeutic_areas" on public.therapeutic_areas for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- trials
create policy "space members can view trials" on public.trials for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert trials" on public.trials for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update trials" on public.trials for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete trials" on public.trials for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- trial_phases
create policy "space members can view trial_phases" on public.trial_phases for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert trial_phases" on public.trial_phases for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update trial_phases" on public.trial_phases for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete trial_phases" on public.trial_phases for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- trial_markers
create policy "space members can view trial_markers" on public.trial_markers for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert trial_markers" on public.trial_markers for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update trial_markers" on public.trial_markers for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete trial_markers" on public.trial_markers for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- trial_notes
create policy "space members can view trial_notes" on public.trial_notes for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert trial_notes" on public.trial_notes for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update trial_notes" on public.trial_notes for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete trial_notes" on public.trial_notes for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- marker_types (system types readable by all; user-created scoped to space)
create policy "authenticated can view system marker_types" on public.marker_types for select to authenticated
using ( is_system = true or public.has_space_access(space_id) );
create policy "space editors can insert marker_types" on public.marker_types for insert to authenticated
with check ( is_system = false and public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update marker_types" on public.marker_types for update to authenticated
using ( is_system = false and public.has_space_access(space_id, array['owner', 'editor']) )
with check ( is_system = false and public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete marker_types" on public.marker_types for delete to authenticated
using ( is_system = false and public.has_space_access(space_id, array['owner', 'editor']) );

-- =============================================================================
-- update get_dashboard_data() to use space_id instead of user_id
-- =============================================================================

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(company_obj order by c.display_order), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'products', coalesce((
        select jsonb_agg(product_obj order by p.display_order)
        from public.products p
        cross join lateral (
          select jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'generic_name', p.generic_name,
            'logo_url', p.logo_url,
            'display_order', p.display_order,
            'trials', coalesce((
              select jsonb_agg(trial_obj order by t.display_order)
              from public.trials t
              cross join lateral (
                select jsonb_build_object(
                  'id', t.id,
                  'name', t.name,
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'notes', t.notes,
                  'display_order', t.display_order,
                  'product_id', t.product_id,
                  'therapeutic_area_id', t.therapeutic_area_id,
                  'therapeutic_area', (
                    select jsonb_build_object('id', ta.id, 'name', ta.name, 'abbreviation', ta.abbreviation)
                    from public.therapeutic_areas ta where ta.id = t.therapeutic_area_id
                  ),
                  'phases', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tp.id, 'trial_id', tp.trial_id,
                        'phase_type', tp.phase_type, 'start_date', tp.start_date,
                        'end_date', tp.end_date, 'color', tp.color, 'label', tp.label
                      )
                      order by tp.start_date
                    )
                    from public.trial_phases tp
                    where tp.trial_id = t.id
                      and tp.space_id = p_space_id
                      and (p_start_year is null or extract(year from tp.end_date) >= p_start_year or tp.end_date is null)
                      and (p_end_year is null or extract(year from tp.start_date) <= p_end_year)
                  ), '[]'::jsonb),
                  'markers', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tm.id, 'trial_id', tm.trial_id,
                        'marker_type_id', tm.marker_type_id,
                        'event_date', tm.event_date, 'end_date', tm.end_date,
                        'tooltip_text', tm.tooltip_text, 'tooltip_image_url', tm.tooltip_image_url,
                        'is_projected', tm.is_projected,
                        'marker_type', (
                          select jsonb_build_object(
                            'id', mt.id, 'name', mt.name, 'icon', mt.icon,
                            'shape', mt.shape, 'fill_style', mt.fill_style,
                            'color', mt.color, 'is_system', mt.is_system,
                            'display_order', mt.display_order
                          )
                          from public.marker_types mt where mt.id = tm.marker_type_id
                        )
                      )
                      order by tm.event_date
                    )
                    from public.trial_markers tm
                    where tm.trial_id = t.id
                      and tm.space_id = p_space_id
                      and (p_start_year is null or extract(year from tm.event_date) >= p_start_year)
                      and (p_end_year is null or extract(year from tm.event_date) <= p_end_year)
                  ), '[]'::jsonb),
                  'trial_notes', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tn.id, 'content', tn.content,
                        'created_at', tn.created_at, 'updated_at', tn.updated_at
                      )
                      order by tn.created_at
                    )
                    from public.trial_notes tn
                    where tn.trial_id = t.id
                      and tn.space_id = p_space_id
                  ), '[]'::jsonb)
                ) as trial_obj
              ) as trial_lateral
              where t.product_id = p.id
                and t.space_id = p_space_id
                and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
            ), '[]'::jsonb)
          ) as product_obj
        ) as product_lateral
        where p.company_id = c.id
          and p.space_id = p_space_id
          and (p_product_ids is null or p.id = any(p_product_ids))
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$$;
