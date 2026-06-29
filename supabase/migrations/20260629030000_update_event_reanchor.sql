-- migration: 20260629030000_update_event_reanchor
-- purpose: Stage 3 -- extend update_event so the merged Event form can
--   re-anchor (change anchor_type / anchor_id) and re-type (change event_type_id)
--   an event on edit.
--
-- New params added at the END with DEFAULT NULL so existing callers that omit
-- them continue to work unchanged (no behavior change on null).  Postgres
-- requires all params after the first DEFAULT to carry a DEFAULT; the existing
-- required params come first, so the three new optional params are at the end.
-- The Stage 3 frontend calls update_event by NAME (supabase-js named args), so
-- param position is irrelevant to it.
--
-- Anchor validation mirrors create_event exactly:
--   - p_anchor_type in ('space','company','asset','trial') or raise 22023
--   - non-space anchor_type requires p_anchor_id             or raise 22023
--   - anchor entity must exist in the event's own space      or raise 22023
--
-- Note: create_event raises 42501 for anchor-not-in-space; this fn raises 22023
-- (invalid parameter value) which is the semantically correct code for a bad
-- caller argument. The spec explicitly tests for 22023 on cross-space anchors.
--
-- p_event_type_id: when non-null, overwrites events.event_type_id.  The type is
-- NOT validated against event_types (create_event also skips this check -- parity).
--
-- CA emit (activity-wiring, task CA gap b): the analyst trial_change_events row
-- is now keyed to the EFFECTIVE (post-edit) anchor.  Moving an event OFF a trial
-- anchor (to company / asset / space) emits no new row -- there is no meaningful
-- trial_id to attach it to.  The existing no-re-anchor path is unchanged.
--
-- Order: DROP the single existing overload (avoids ambiguous-overload errors),
-- then CREATE the new 16-arg version, then re-grant to match the prior ACL.

-- =============================================================================
-- 1. drop the existing 13-arg overload
-- =============================================================================
drop function if exists public.update_event(
  uuid, text, date, text, text, date, text, boolean, text, text, text, text, boolean
);

-- =============================================================================
-- 2. create the new 16-arg version (13 required + 3 DEFAULT NULL)
-- =============================================================================
create or replace function public.update_event(
  p_event_id            uuid,
  p_title               text,
  p_event_date          date,
  p_projection          text,
  p_date_precision      text,
  p_end_date            date,
  p_end_date_precision  text,
  p_is_ongoing          boolean,
  p_description         text,
  p_source_url          text,        -- vestigial; kept for positional-caller compat
  p_significance        text,
  p_visibility          text,
  p_no_longer_expected  boolean,
  -- new params: DEFAULT NULL; applied only when non-null (backward-compat no-op)
  p_event_type_id       uuid    default null,
  p_anchor_type         text    default null,
  p_anchor_id           uuid    default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_space             uuid;
  v_old_event_date    date;
  v_anchor_type       text;
  v_anchor_id         uuid;
  v_old_title         text;
  v_old_description   text;
  v_event_type        text;
  v_ok                boolean;
  -- effective anchor after the edit (differs from old when re-anchoring)
  v_eff_anchor_type   text;
  v_eff_anchor_id     uuid;
begin
  -- capture-before: read the old row's space + the fields the Activity emit
  -- needs (event_date / anchor / title / description) in a single lookup.
  select space_id, event_date, anchor_type, anchor_id, title, description
    into v_space, v_old_event_date, v_anchor_type, v_anchor_id, v_old_title, v_old_description
    from public.events where id = p_event_id;
  if v_space is null then raise exception 'event not found' using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space, array['owner','editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_is_ongoing and p_end_date is not null then
    raise exception 'an ongoing event cannot have an end date' using errcode = '22023';
  end if;

  -- anchor validation: only when p_anchor_type is provided (mirrors create_event).
  if p_anchor_type is not null then
    if p_anchor_type not in ('space','company','asset','trial') then
      raise exception 'invalid anchor_type' using errcode = '22023';
    end if;
    if p_anchor_type <> 'space' and p_anchor_id is null then
      raise exception 'anchor_id required for anchor_type %', p_anchor_type using errcode = '22023';
    end if;
    -- anchor entity must exist in the event's own space
    if p_anchor_type = 'company' then
      select exists(select 1 from public.companies where id = p_anchor_id and space_id = v_space) into v_ok;
    elsif p_anchor_type = 'asset' then
      select exists(select 1 from public.assets    where id = p_anchor_id and space_id = v_space) into v_ok;
    elsif p_anchor_type = 'trial' then
      select exists(select 1 from public.trials    where id = p_anchor_id and space_id = v_space) into v_ok;
    else v_ok := true; end if;
    if not v_ok then
      raise exception 'anchor % not in space %', p_anchor_id, v_space using errcode = '22023';
    end if;
  end if;

  -- p_source_url is vestigial: citations flow through p_sources / event_sources.
  -- The param is kept for positional-caller stability and dropped in Stage 3.
  update public.events set
    title               = p_title,
    event_date          = p_event_date,
    projection          = p_projection,
    date_precision      = p_date_precision,
    end_date            = p_end_date,
    end_date_precision  = p_end_date_precision,
    is_ongoing          = p_is_ongoing,
    description         = p_description,
    significance        = p_significance,
    visibility          = p_visibility,
    no_longer_expected  = p_no_longer_expected,
    -- conditional updates: only overwrite when the caller supplies a value
    event_type_id       = coalesce(p_event_type_id, event_type_id),
    anchor_type         = coalesce(p_anchor_type,   anchor_type),
    anchor_id           = case
                            when p_anchor_type is null   then anchor_id
                            when p_anchor_type = 'space' then null
                            else p_anchor_id
                          end
  where id = p_event_id;

  -- compute the effective anchor for the Activity emit (new anchor when
  -- re-anchoring, old anchor otherwise)
  v_eff_anchor_type := coalesce(p_anchor_type, v_anchor_type);
  v_eff_anchor_id   := case
                         when p_anchor_type is null   then v_anchor_id
                         when p_anchor_type = 'space' then null
                         else p_anchor_id
                       end;

  -- Activity emit (task CA gap b). trial_change_events.trial_id is NOT NULL, so
  -- we emit ONLY when the event ends up trial-anchored after the edit.
  -- DOCUMENTED LIMITATION: moving an event OFF a trial anchor (to company /
  -- asset / space) emits no trial_change_events row -- there is no meaningful
  -- trial_id to attach it to. Company- / asset-anchored edits do not reach
  -- Activity in v1 regardless of re-anchor.
  if v_eff_anchor_type = 'trial' and v_eff_anchor_id is not null
     and (v_old_event_date is distinct from p_event_date
          or v_old_title is distinct from p_title
          or v_old_description is distinct from p_description) then
    v_event_type := case when v_old_event_date is distinct from p_event_date
                         then 'date_moved' else 'event_edited' end;
    insert into public.trial_change_events
      (trial_id, space_id, event_type, source, payload, occurred_at, event_id)
    values (
      v_eff_anchor_id,
      v_space,
      v_event_type,
      'analyst',
      case when v_event_type = 'date_moved'
           then jsonb_build_object(
             'which_date', 'event_date',
             'from',       v_old_event_date,
             'to',         p_event_date,
             'days_diff',  case when v_old_event_date is not null and p_event_date is not null
                                then p_event_date - v_old_event_date else null end,
             'direction',  case when v_old_event_date is null or p_event_date is null then null
                                when p_event_date > v_old_event_date then 'slip'
                                when p_event_date < v_old_event_date then 'accelerate'
                                else 'none' end
           )
           else jsonb_build_object('title', p_title)
      end,
      now(),
      p_event_id
    );
  end if;
end;
$function$;

-- =============================================================================
-- 3. re-grant to match the prior ACL (anon + authenticated + service_role)
-- =============================================================================
grant execute on function public.update_event(
  uuid, text, date, text, text, date, text, boolean, text, text, text, text, boolean,
  uuid, text, uuid
) to anon, authenticated, service_role;

-- =============================================================================
-- 4. smoke: prod-safe, data-conditional, self-cleaning.
--    Verifies: (1) p_anchor_type/p_anchor_id update the events row;
--              (2) p_event_type_id update applies when provided;
--              (3) CA emit is keyed to the NEW trial when re-anchoring.
--    Skips cleanly when the demo space is absent (db push / non-seeded env).
-- =============================================================================
do $$
declare
  v_space           uuid := '00000000-0000-0000-0000-0000000d0100';
  v_uid             uuid;
  v_company         uuid;
  v_asset           uuid;
  v_trial_a         uuid;
  v_trial_b         uuid;
  v_type_a          uuid;
  v_type_b          uuid;
  v_event           uuid;
  v_chk_anchor_type text;
  v_chk_anchor_id   uuid;
  v_chk_type_id     uuid;
  v_rows            int;
begin
  if not exists (select 1 from public.spaces where id = v_space) then
    raise notice 'E3 smoke: demo space absent (prod-safe skip)';
    return;
  end if;
  select user_id into v_uid from public.space_members
    where space_id = v_space and role = 'owner' limit 1;
  if v_uid is null then
    raise notice 'E3 smoke: no owner for demo space (prod-safe skip)';
    return;
  end if;

  -- two distinct system event types (space_id is null for system types)
  select id into v_type_a from public.event_types where space_id is null order by id limit 1;
  select id into v_type_b from public.event_types where space_id is null and id <> v_type_a order by id limit 1;

  -- scratch entities
  insert into public.companies (space_id, name, created_by)
    values (v_space, 'E3 Smoke Co', v_uid) returning id into v_company;
  insert into public.assets (space_id, company_id, name, created_by)
    values (v_space, v_company, 'E3 Smoke Asset', v_uid) returning id into v_asset;
  insert into public.trials (space_id, asset_id, name, created_by)
    values (v_space, v_asset, 'E3 Smoke Trial A', v_uid) returning id into v_trial_a;
  insert into public.trials (space_id, asset_id, name, created_by)
    values (v_space, v_asset, 'E3 Smoke Trial B', v_uid) returning id into v_trial_b;

  -- scratch event: trial-anchored to trial_a, using type_a
  insert into public.events
    (space_id, event_type_id, title, event_date, anchor_type, anchor_id, created_by, metadata)
    values (v_space, v_type_a, 'E3 Smoke Event', '2026-01-01', 'trial', v_trial_a, v_uid,
            jsonb_build_object('source', 'analyst'))
    returning id into v_event;

  -- impersonate the owner so has_space_access passes (same pattern as CA smoke)
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  -- re-anchor to trial_b + change type + move date (triggers date_moved emit)
  perform public.update_event(
    p_event_id           => v_event,
    p_title              => 'E3 Smoke Event',
    p_event_date         => '2026-06-01',
    p_projection         => 'actual',
    p_date_precision     => 'exact',
    p_end_date           => null,
    p_end_date_precision => 'exact',
    p_is_ongoing         => false,
    p_description        => null,
    p_source_url         => null,
    p_significance       => null,
    p_visibility         => null,
    p_no_longer_expected => false,
    p_event_type_id      => v_type_b,
    p_anchor_type        => 'trial',
    p_anchor_id          => v_trial_b
  );

  -- assert (1): anchor_type and anchor_id changed to trial_b
  select anchor_type, anchor_id, event_type_id
    into v_chk_anchor_type, v_chk_anchor_id, v_chk_type_id
    from public.events where id = v_event;
  if v_chk_anchor_type <> 'trial' or v_chk_anchor_id <> v_trial_b then
    raise exception 'E3 smoke: anchor not updated; anchor_type=% anchor_id=%',
      v_chk_anchor_type, v_chk_anchor_id;
  end if;

  -- assert (2): event_type_id changed to type_b
  if v_chk_type_id <> v_type_b then
    raise exception 'E3 smoke: event_type_id not updated; got %', v_chk_type_id;
  end if;

  -- assert (3): CA emit is on trial_b, not trial_a
  select count(*) into v_rows from public.trial_change_events
   where event_id = v_event and trial_id = v_trial_b and source = 'analyst';
  if v_rows <> 1 then
    raise exception 'E3 smoke: expected 1 analyst change-event for trial_b, got %', v_rows;
  end if;
  select count(*) into v_rows from public.trial_change_events
   where event_id = v_event and trial_id = v_trial_a and source = 'analyst';
  if v_rows <> 0 then
    raise exception 'E3 smoke: expected 0 analyst change-events for trial_a, got %', v_rows;
  end if;

  -- cleanup (self-cleaning)
  delete from public.trial_change_events where event_id = v_event;
  delete from public.events  where id = v_event;
  delete from public.trials  where id in (v_trial_a, v_trial_b);
  delete from public.assets  where id = v_asset;
  delete from public.companies where id = v_company;

  raise notice 'E3 smoke: PASS -- re-anchor + re-type applied; CA emit keyed to new trial';
end$$;

notify pgrst, 'reload schema';
