-- Adds a `trials` (total) inventory count to get_space_landing_stats.
--
-- The engagement-landing header shows an inventory strip "N trials, M companies,
-- K assets". companies and programs (assets) are totals, but the trial count was
-- active_trials (excludes completed/withdrawn/terminated) while labeled just
-- "trials", so it disagreed with the Manage > Trials page (which lists all
-- trials). Add a total `trials` count so the inventory is consistent; keep
-- active_trials for the empty-space check that still relies on it.
--
-- Body is otherwise copied verbatim from the current definition (assets-based
-- inventory + motion signals) so nothing else changes.

create or replace function public.get_space_landing_stats(
  p_space_id uuid
) returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
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
        from public.markers m
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
        from public.markers m
        join public.marker_assignments ma on ma.marker_id = m.id
        join public.trials t on t.id = ma.trial_id
        join public.marker_types mt on mt.id = m.marker_type_id
        where m.space_id = p_space_id
          and mt.category_id = 'c0000000-0000-0000-0000-000000000002'
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
        from public.markers m
        join public.marker_types mt on mt.id = m.marker_type_id
        where m.space_id = p_space_id
          and mt.category_id = 'c0000000-0000-0000-0000-000000000005'
          and m.event_date between current_date and current_date + interval '365 days'
      )
    )
  end;
$$;

comment on function public.get_space_landing_stats(uuid) is
  'Returns engagement-landing stats for a space. Inventory: trials (total), '
  'active_trials, companies, programs. Catalyst totals: catalysts_90d, '
  'intelligence_total. Motion signals: p3_readouts_90d, new_intel_7d, '
  'trial_moves_30d, loe_365d. Gated on has_space_access.';
