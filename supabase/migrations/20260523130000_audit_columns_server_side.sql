-- migration: 20260523130000_audit_columns_server_side
-- purpose: enforce created_by / updated_by / updated_at from server context,
--          not client-supplied values. authenticated callers get auth.uid()
--          and now(); service_role callers fall back to the provided value
--          (created_by) or null (updated_by).

-- === trigger functions ===

create or replace function public._set_created_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;

create or replace function public._set_updated_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- === apply to entity tables ===

-- companies
create trigger trg_companies_set_created_by
  before insert on public.companies
  for each row execute function public._set_created_by();

create trigger trg_companies_set_updated_audit
  before update on public.companies
  for each row execute function public._set_updated_audit();

-- products
create trigger trg_products_set_created_by
  before insert on public.products
  for each row execute function public._set_created_by();

create trigger trg_products_set_updated_audit
  before update on public.products
  for each row execute function public._set_updated_audit();

-- trials
create trigger trg_trials_set_created_by
  before insert on public.trials
  for each row execute function public._set_created_by();

create trigger trg_trials_set_updated_audit
  before update on public.trials
  for each row execute function public._set_updated_audit();

-- markers
create trigger trg_markers_set_created_by
  before insert on public.markers
  for each row execute function public._set_created_by();

create trigger trg_markers_set_updated_audit
  before update on public.markers
  for each row execute function public._set_updated_audit();

-- events
create trigger trg_events_set_created_by
  before insert on public.events
  for each row execute function public._set_created_by();

create trigger trg_events_set_updated_audit
  before update on public.events
  for each row execute function public._set_updated_audit();

-- trial_notes
create trigger trg_trial_notes_set_created_by
  before insert on public.trial_notes
  for each row execute function public._set_created_by();

create trigger trg_trial_notes_set_updated_audit
  before update on public.trial_notes
  for each row execute function public._set_updated_audit();

-- therapeutic_areas (has created_by but no updated_at, so INSERT only)
create trigger trg_therapeutic_areas_set_created_by
  before insert on public.therapeutic_areas
  for each row execute function public._set_created_by();

-- marker_types (has created_by but no updated_at, so INSERT only)
create trigger trg_marker_types_set_created_by
  before insert on public.marker_types
  for each row execute function public._set_created_by();

-- event_links
create trigger trg_event_links_set_created_by
  before insert on public.event_links
  for each row execute function public._set_created_by();

-- event_threads
create trigger trg_event_threads_set_created_by
  before insert on public.event_threads
  for each row execute function public._set_created_by();

-- event_categories
create trigger trg_event_categories_set_created_by
  before insert on public.event_categories
  for each row execute function public._set_created_by();

-- marker_categories
create trigger trg_marker_categories_set_created_by
  before insert on public.marker_categories
  for each row execute function public._set_created_by();

-- mechanisms_of_action
create trigger trg_mechanisms_of_action_set_created_by
  before insert on public.mechanisms_of_action
  for each row execute function public._set_created_by();

-- routes_of_administration
create trigger trg_routes_of_administration_set_created_by
  before insert on public.routes_of_administration
  for each row execute function public._set_created_by();
