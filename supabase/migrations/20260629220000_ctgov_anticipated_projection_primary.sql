-- Fix: CT.gov anticipated/estimated trial dates were stored as projection
-- `company`, which the provenance-badge feature renders as a stray `c` letter on
-- the trial marker glyph. A CT.gov registry estimate is the `primary` tier (the
-- assumed registry default), which renders hollow with NO letter on a trial --
-- see src/client/src/app/core/models/marker-visual.ts and the projection-tier
-- table in docs/superpowers/plans/2026-06-29-seed-demo-remodel.md.
--
-- `company` means analyst/company-guided (and legitimately badges `c`); the CT.gov
-- registry has no such concept, so its non-ACTUAL date types map to `primary`.
--
-- Two parts:
--   1. _seed_ctgov_marker_upsert: map non-ACTUAL ct.gov date types to `primary`
--      (was `company`) so future syncs/adoptions store the correct tier.
--   2. Backfill existing ct.gov-owned events from `company` -> `primary`.
--
-- Body restated verbatim from the live definition (pg_get_functiondef), changing
-- only the v_projection mapping line, to avoid reverting any other logic.

create or replace function public._seed_ctgov_marker_upsert(p_trial_id uuid, p_space_id uuid, p_created_by uuid, p_marker_type_id uuid, p_title text, p_field text, p_date_string text, p_date_type text, p_snapshot_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_event_date date;
  v_precision  text;
  v_date_type  text;
  v_projection text;
  v_event_id   uuid;
  v_unowned    uuid[];
begin
  select resolved, "precision"
    into v_event_date, v_precision
    from public._ctgov_resolve_partial_date(p_date_string);

  if v_event_date is null then
    return false;  -- unparseable/absent: leave existing events untouched.
  end if;

  v_date_type  := upper(coalesce(nullif(p_date_type, ''), 'ANTICIPATED'));
  -- ACTUAL -> actual (filled). Any non-ACTUAL ct.gov date is the registry's own
  -- estimate -> `primary` (hollow, no provenance letter on a trial). NOT
  -- `company`: that tier is analyst/company-guided and badges `c`, which the
  -- registry default must not show.
  v_projection := case when v_date_type = 'ACTUAL' then 'actual' else 'primary' end;

  -- (a) steady-state: a ct.gov-owned event of this type already exists.
  select e.id
    into v_event_id
    from public.events e
   where e.anchor_type = 'trial'
     and e.anchor_id = p_trial_id
     and e.event_type_id = p_marker_type_id
     and e.metadata->>'source' = 'ctgov'
   limit 1;

  if v_event_id is not null then
    update public.events
       set event_date     = v_event_date,
           date_precision = v_precision,
           projection     = v_projection,
           metadata       = coalesce(metadata, '{}'::jsonb)
                            || jsonb_build_object(
                                 'snapshot_id',     p_snapshot_id,
                                 'ctgov_date_type', v_date_type
                               )
     where id = v_event_id;
    return true;
  end if;

  -- (b) adoption: exactly one un-owned event of this type for this trial.
  select array_agg(e.id)
    into v_unowned
    from public.events e
   where e.anchor_type = 'trial'
     and e.anchor_id = p_trial_id
     and e.event_type_id = p_marker_type_id
     and (e.metadata->>'source' is null or e.metadata->>'source' <> 'ctgov');

  if array_length(v_unowned, 1) = 1 then
    -- Adoption updates source + date/precision/projection (+ metadata) only.
    -- Preserve any analyst-authored description; fall back to the ct.gov
    -- default only when the adopted event has none. No source_url write: the
    -- registry link is derived by readers from the anchor trial's NCT.
    update public.events
       set event_date     = v_event_date,
           date_precision = v_precision,
           projection     = v_projection,
           description     = coalesce(description, 'Auto-derived from clinicaltrials.gov'),
           metadata       = coalesce(metadata, '{}'::jsonb)
                            || jsonb_build_object(
                                 'source',          'ctgov',
                                 'field',           p_field,
                                 'snapshot_id',     p_snapshot_id,
                                 'ctgov_date_type', v_date_type
                               )
     where id = v_unowned[1];
    return true;
  end if;

  -- (c) insert a fresh ct.gov-owned event anchored to the trial (no assignment,
  --     no source_url column write).
  insert into public.events (
    space_id, event_type_id, title, projection, event_date, date_precision,
    description, metadata, anchor_type, anchor_id, created_by
  ) values (
    p_space_id, p_marker_type_id, p_title, v_projection, v_event_date, v_precision,
    'Auto-derived from clinicaltrials.gov',
    jsonb_build_object(
      'source',          'ctgov',
      'field',           p_field,
      'snapshot_id',     p_snapshot_id,
      'ctgov_date_type', v_date_type
    ),
    'trial', p_trial_id,
    p_created_by
  );

  return true;
end;
$function$;

-- Backfill: existing ct.gov-owned events still carrying the old `company` tier.
-- ACTUAL ct.gov dates were already `actual` and are untouched; only the
-- anticipated/estimated ones were mis-tiered.
update public.events
   set projection = 'primary'
 where anchor_type = 'trial'
   and metadata->>'source' = 'ctgov'
   and projection = 'company';
