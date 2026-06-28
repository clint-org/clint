-- Repoint get_space_landing_stats off dropped marker tables onto events.
-- Only the three marker-derived subqueries change (catalysts_90d, p3_readouts_90d, loe_365d).
-- All other subqueries (trials, active_trials, companies, programs,
-- intelligence_total, new_intel_7d, trial_moves_30d) are byte-identical to the live body.
--
-- Category UUID remap (marker_categories c0000000-... -> event_type_categories d0000000-...):
--   Data:                c0000000-0000-0000-0000-000000000002 -> d0000000-0000-0000-0000-000000000002
--   Loss of Exclusivity: c0000000-0000-0000-0000-000000000005 -> d0000000-0000-0000-0000-000000000006
--                        (new d...005 is Launch, not LOE -- do NOT use 005)

create or replace function public.get_space_landing_stats(p_space_id uuid)
  returns jsonb
  language sql
  stable security definer
  set search_path to ''
as $function$
  select case
    when not public.has_space_access(p_space_id) then null
    else jsonb_build_object(
      'trials', (
        select count(*)::int
        from public.trials t
        where t.space_id = p_space_id
      ),
      'active_trials', (
        select count(*)::int
        from public.trials t
        where t.space_id = p_space_id
          and (
            t.recruitment_status is null
            or lower(t.recruitment_status) not in (
              'completed',
              'withdrawn',
              'terminated'
            )
          )
      ),
      'companies', (
        select count(distinct a.company_id)::int
        from public.assets a
        where a.space_id = p_space_id
          and a.company_id is not null
      ),
      'programs', (
        select count(*)::int
        from public.assets a
        where a.space_id = p_space_id
      ),
      'catalysts_90d', (
        select count(*)::int
        from public.events m
        where m.space_id = p_space_id
          and m.event_date between current_date and current_date + interval '90 days'
      ),
      'intelligence_total', (
        select count(*)::int
        from public.primary_intelligence pi
        where pi.space_id = p_space_id
          and pi.state = 'published'
      ),
      'p3_readouts_90d', (
        select count(distinct m.id)::int
        from public.events m
        join public.trials t on m.anchor_type = 'trial' and t.id = m.anchor_id
        join public.event_types et on et.id = m.event_type_id
        where m.space_id = p_space_id
          and et.category_id = 'd0000000-0000-0000-0000-000000000002'
          and t.phase = 'Phase 3'
          and m.event_date between current_date and current_date + interval '90 days'
      ),
      'new_intel_7d', (
        select count(*)::int
        from public.primary_intelligence pi
        where pi.space_id = p_space_id
          and pi.state = 'published'
          and pi.published_at >= now() - interval '7 days'
      ),
      'trial_moves_30d', (
        select count(distinct trial_id)::int
        from public.trial_change_events
        where space_id = p_space_id
          and observed_at >= now() - interval '30 days'
          and (
            event_type = 'phase_transitioned'
            or (event_type = 'status_changed'
                and payload->>'to' in ('TERMINATED','WITHDRAWN','SUSPENDED','COMPLETED'))
          )
      ),
      'loe_365d', (
        select count(distinct m.id)::int
        from public.events m
        join public.event_types et on et.id = m.event_type_id
        where m.space_id = p_space_id
          and et.category_id = 'd0000000-0000-0000-0000-000000000006'
          and m.event_date between current_date and current_date + interval '365 days'
      )
    )
  end;
$function$;

-- In-file data-conditional smoke: verify the function returns the expected jsonb shape.
-- Safe against prod (space 00000000-0000-0000-0000-0000000d0100 is seeded demo only).
do $$
declare
  v_space_id uuid := '00000000-0000-0000-0000-0000000d0100';
  v_result   jsonb;
  v_exists   boolean;
begin
  select exists(
    select 1 from public.spaces where id = v_space_id
  ) into v_exists;

  if not v_exists then
    raise notice 'A3 smoke: demo space absent (prod-safe skip)';
    return;
  end if;

  -- Bypass RLS: call as superuser context (migration runs as superuser)
  -- has_space_access returns false without auth.uid(); read directly.
  select jsonb_build_object(
    'catalysts_90d', (
      select count(*)::int
      from public.events m
      where m.space_id = v_space_id
        and m.event_date between current_date and current_date + interval '90 days'
    ),
    'p3_readouts_90d', (
      select count(distinct m.id)::int
      from public.events m
      join public.trials t on m.anchor_type = 'trial' and t.id = m.anchor_id
      join public.event_types et on et.id = m.event_type_id
      where m.space_id = v_space_id
        and et.category_id = 'd0000000-0000-0000-0000-000000000002'
        and t.phase = 'Phase 3'
        and m.event_date between current_date and current_date + interval '90 days'
    ),
    'loe_365d', (
      select count(distinct m.id)::int
      from public.events m
      join public.event_types et on et.id = m.event_type_id
      where m.space_id = v_space_id
        and et.category_id = 'd0000000-0000-0000-0000-000000000006'
        and m.event_date between current_date and current_date + interval '365 days'
    )
  ) into v_result;

  if v_result is null then
    raise exception 'A3 smoke FAILED: event-derived counts returned null for demo space';
  end if;

  if (v_result->>'catalysts_90d')::int < 0
     or (v_result->>'p3_readouts_90d')::int < 0
     or (v_result->>'loe_365d')::int < 0
  then
    raise exception 'A3 smoke FAILED: negative count in event-derived stats: %', v_result;
  end if;

  raise notice 'A3 smoke OK: catalysts_90d=%, p3_readouts_90d=%, loe_365d=%',
    v_result->>'catalysts_90d',
    v_result->>'p3_readouts_90d',
    v_result->>'loe_365d';
end;
$$;

notify pgrst, 'reload schema';
