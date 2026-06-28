-- migration: 20260628240000_event_sources_table
-- purpose: add event_sources side-table for the new unified events model (S1a).
--   Creates the table, RLS (space resolved through parent event), select grant
--   to authenticated, and the event_registry_url() pure helper.
--   Writes go through create_event(p_sources) / update_event_sources SECURITY
--   DEFINER RPCs (tasks S1b / S5). This migration is ADDITIVE -- no existing
--   migration is modified.

-- ############################################################
-- 1. event_sources table
-- ############################################################

create table public.event_sources (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  url         text not null,
  label       text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_event_sources_event on public.event_sources (event_id, sort_order, created_at);

-- ############################################################
-- 2. RLS (space resolved via parent event, mirrors events policies)
-- ############################################################

alter table public.event_sources enable row level security;

create policy "event_sources: select" on public.event_sources for select to authenticated
  using (
    public.has_space_access(
      (select e.space_id from public.events e where e.id = event_id)
    )
  );

create policy "event_sources: insert" on public.event_sources for insert to authenticated
  with check (
    public.has_space_access(
      (select e.space_id from public.events e where e.id = event_id),
      array['owner', 'editor']
    )
  );

create policy "event_sources: update" on public.event_sources for update to authenticated
  using (
    public.has_space_access(
      (select e.space_id from public.events e where e.id = event_id),
      array['owner', 'editor']
    )
  )
  with check (
    public.has_space_access(
      (select e.space_id from public.events e where e.id = event_id),
      array['owner', 'editor']
    )
  );

create policy "event_sources: delete" on public.event_sources for delete to authenticated
  using (
    public.has_space_access(
      (select e.space_id from public.events e where e.id = event_id),
      array['owner', 'editor']
    )
  );

-- ############################################################
-- 3. Grant: authenticated may read; writes go through DEFINER RPCs
-- ############################################################

grant select on public.event_sources to authenticated;

-- ############################################################
-- 4. event_registry_url helper
-- ############################################################
-- Returns the canonical ClinicalTrials.gov study URL for a given NCT
-- identifier, or null when the identifier is null / empty / whitespace.
--
-- Duplicates to be repointed in later tasks (S2 / C3 / C5):
--   supabase/migrations/20260527120100_events_rpc_unified_feed.sql
--   supabase/migrations/20260528050000_feed_rpcs_prefer_trial_acronym.sql
--   supabase/migrations/20260618140000_events_feed_status_glyph.sql
--   supabase/migrations/20260627130000_ctgov_trial_dates_markers.sql
--   supabase/migrations/20260503060000_seed_ctgov_markers_on_sync.sql
--   src/client/src/app/features/manage/trials/trial-detail.component.html

create function public.event_registry_url(p_identifier text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    case
      when nullif(trim(coalesce(p_identifier, '')), '') is not null
        then 'https://clinicaltrials.gov/study/' || trim(p_identifier)
      else null
    end
$$;

grant execute on function public.event_registry_url(text) to authenticated;

-- ############################################################
-- 5. In-file smoke
-- ############################################################

-- 5a. Unconditional: URL helper correctness (no data dependency, prod-safe).
do $$
begin
  if public.event_registry_url('NCT123') <> 'https://clinicaltrials.gov/study/NCT123' then
    raise exception 'SMOKE FAIL: event_registry_url(''NCT123'') returned unexpected value: %',
      public.event_registry_url('NCT123');
  end if;

  if public.event_registry_url(null) is not null then
    raise exception 'SMOKE FAIL: event_registry_url(null) should be null, got: %',
      public.event_registry_url(null);
  end if;

  if public.event_registry_url('  ') is not null then
    raise exception 'SMOKE FAIL: event_registry_url(whitespace) should be null, got: %',
      public.event_registry_url('  ');
  end if;

  raise notice 'SMOKE PASS: event_registry_url helper assertions passed';
end;
$$;

-- 5b. Data-conditional: event_sources round-trip in the demo space.
--   Skips when the demo space is absent (prod-safe).
do $$
declare
  v_space_id uuid := '00000000-0000-0000-0000-0000000d0100';
  v_event_id uuid;
  v_src1_id  uuid;
  v_src2_id  uuid;
  v_ordered  uuid[];
begin
  if not exists (select 1 from public.spaces where id = v_space_id) then
    raise notice 'S1a smoke skipped: demo space % absent', v_space_id;
    return;
  end if;

  -- pick any seeded event in the demo space
  select id into v_event_id from public.events where space_id = v_space_id limit 1;

  if v_event_id is null then
    raise notice 'S1a smoke skipped: demo space has no events yet';
    return;
  end if;

  -- insert two rows with different sort_order values
  insert into public.event_sources (event_id, url, label, sort_order)
  values (v_event_id, 'https://example.com/a', 'Source A', 1)
  returning id into v_src1_id;

  insert into public.event_sources (event_id, url, label, sort_order)
  values (v_event_id, 'https://example.com/b', 'Source B', 0)
  returning id into v_src2_id;

  -- assert they read back ordered by (sort_order, created_at): B(0) before A(1)
  select array_agg(id order by sort_order, created_at)
  into v_ordered
  from public.event_sources
  where event_id = v_event_id
    and id = any(array[v_src1_id, v_src2_id]);

  if v_ordered[1] <> v_src2_id or v_ordered[2] <> v_src1_id then
    raise exception
      'SMOKE FAIL: event_sources ordering wrong; expected [B,A] by sort_order, got %', v_ordered;
  end if;

  -- self-clean
  delete from public.event_sources where id = any(array[v_src1_id, v_src2_id]);

  raise notice 'SMOKE PASS: event_sources round-trip OK for event %', v_event_id;
end;
$$;

notify pgrst, 'reload schema';
