-- migration: 20260530131948_unified_recent_change_indicator
-- purpose:  One definition of "recent change" across the product: a 14-day
--           window over trial_change_events PLUS published primary_intelligence
--           notes, computed server-side. Replaces the old split (7-day trial
--           dot from trial_change_events vs 30-day bullseye flag from marker
--           dates). Adds recent_change_window() as the single source of truth
--           for the window, rewires get_dashboard_data and get_bullseye_assets.
-- spec: docs/superpowers/specs/2026-05-29-unified-recent-change-indicator-design.md
-- depends on: 20260528130000 (latest get_dashboard_data / get_bullseye_assets bodies)
-- =============================================================================

-- 1. single source of truth for the recency window
create or replace function public.recent_change_window()
  returns interval
  language sql
  immutable
as $$ select interval '14 days' $$;

comment on function public.recent_change_window() is
  'Single source of truth for the "recent change" window used by the change-feed '
  'dot across dashboard, catalysts, and bullseye. See '
  '2026-05-29-unified-recent-change-indicator-design.md.';

do $$
begin
  if public.recent_change_window() <> interval '14 days' then
    raise exception 'recent_change_window smoke FAIL: expected 14 days, got %',
      public.recent_change_window();
  end if;
  raise notice 'recent_change_window smoke ok';
end$$;
