-- Per-space "track preclinical" setting.
--
-- Preclinical activity is hard to track and is not usually tracked by CI teams,
-- so the PRECLIN phase is hidden by default. A space owner can opt in per space.
-- When the flag is false (default), preclinical trials/asset-indications are
-- excluded from every analytic surface (landscape index, bullseye, density,
-- dashboard) and from data-entry dropdowns. Enforcement lives server-side: each
-- analytic RPC reads this flag via space_shows_preclinical() and drops PRECLIN
-- rows accordingly, so a client cannot opt back in by passing a phase param.
--
-- Modeled on spaces.ctgov_field_visibility + update_space_field_visibility:
-- a single typed column plus an owner-gated update RPC (invoker rights, guarded
-- by has_space_access). This is a display/scope setting, not a governance action,
-- so it is not a Tier 1 audited RPC (mirrors update_space_field_visibility).

alter table public.spaces
  add column show_preclinical boolean not null default false;

comment on column public.spaces.show_preclinical is
  'When false (default), the PRECLIN phase is excluded from analytic views and data-entry dropdowns for this space. Owners opt in per space.';

-- Single source of truth for the flag, fully qualified for SET search_path = ''
-- callers. Each analytic RPC reads this once into a local variable; never call
-- it per row.
create or replace function public.space_shows_preclinical(p_space_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select s.show_preclinical from public.spaces s where s.id = p_space_id),
    false
  );
$$;

comment on function public.space_shows_preclinical(uuid) is
  'Returns whether the given space tracks the preclinical phase. Default false. Read once per analytic RPC; do not call per row.';

-- Owner-only update path. Mirrors update_space_field_visibility (invoker rights,
-- has_space_access owner guard, no audit -- a display setting, not Tier 1).
create or replace function public.update_space_show_preclinical(p_space_id uuid, p_show boolean)
returns void
language plpgsql
set search_path = 'public'
as $$
begin
  if not public.has_space_access(p_space_id, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.spaces
     set show_preclinical = coalesce(p_show, false)
   where id = p_space_id;
end;
$$;
