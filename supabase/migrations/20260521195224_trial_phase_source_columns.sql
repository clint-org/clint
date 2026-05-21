-- migration: 20260521195224_trial_phase_source_columns
-- purpose: add per-field source tracking columns on public.trials so the
--   write path (next migration) can flip phase_type / phase_start_date /
--   phase_end_date to ct.gov-wins coalesce while preserving analyst-set
--   values where ct.gov has no value. backfill tags every existing row
--   based on whether the latest ct.gov snapshot would derive the same
--   value the column currently holds.
-- affected tables: public.trials (3 new nullable columns + backfill)
-- notes: schema-only; behavior is unchanged until the next migration
--   replaces _materialize_trial_from_snapshot.

alter table public.trials
  add column phase_type_source       text check (phase_type_source       in ('ctgov','analyst')),
  add column phase_start_date_source text check (phase_start_date_source in ('ctgov','analyst')),
  add column phase_end_date_source   text check (phase_end_date_source   in ('ctgov','analyst'));

comment on column public.trials.phase_type_source is
  'Per-field ownership tag: ''ctgov'' means the latest ct.gov sync wrote the value; ''analyst'' means a user wrote it (or backfill found a divergence). NULL when the field itself is NULL.';
comment on column public.trials.phase_start_date_source is
  'See phase_type_source.';
comment on column public.trials.phase_end_date_source is
  'See phase_type_source.';

-- =============================================================================
-- backfill: for every trial with at least one snapshot, compute what ct.gov
-- would derive today and compare with the stored column. matching -> 'ctgov',
-- diverging or ct.gov-derived-null -> 'analyst'. trials with no snapshot but
-- a non-null stored field -> 'analyst'.
-- =============================================================================

with latest_snapshot as (
  select distinct on (trial_id) trial_id, payload
    from public.trial_ctgov_snapshots
   order by trial_id, fetched_at desc
),
derived as (
  select
    ls.trial_id,
    public._derive_phase_type(
      ls.payload #> '{protocolSection,designModule,phases}',
      ls.payload #>> '{protocolSection,designModule,studyType}'
    ) as d_phase_type,
    public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}') as d_phase_start,
    coalesce(
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
    ) as d_phase_end
    from latest_snapshot ls
)
update public.trials t
   set phase_type_source = case
         when t.phase_type is null then null
         when d.d_phase_type is not null and d.d_phase_type = t.phase_type then 'ctgov'
         else 'analyst'
       end,
       phase_start_date_source = case
         when t.phase_start_date is null then null
         when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov'
         else 'analyst'
       end,
       phase_end_date_source = case
         when t.phase_end_date is null then null
         when d.d_phase_end is not null and d.d_phase_end = t.phase_end_date then 'ctgov'
         else 'analyst'
       end
  from derived d
 where d.trial_id = t.id;

-- trials with no snapshot at all: any non-null analyst-facing field is 'analyst'
update public.trials t
   set phase_type_source       = case when t.phase_type       is not null and t.phase_type_source       is null then 'analyst' else t.phase_type_source       end,
       phase_start_date_source = case when t.phase_start_date is not null and t.phase_start_date_source is null then 'analyst' else t.phase_start_date_source end,
       phase_end_date_source   = case when t.phase_end_date   is not null and t.phase_end_date_source   is null then 'analyst' else t.phase_end_date_source   end
 where not exists (
   select 1 from public.trial_ctgov_snapshots s where s.trial_id = t.id
 );

-- =============================================================================
-- inline psql smoke: fabricate four trial fixtures covering each backfill
-- branch, run a second backfill pass and assert zero rows changed
-- (idempotency), then tear the fixtures down.
-- =============================================================================
do $$
declare
  v_agency_id   uuid := '99999881-9999-9999-9999-999999999881';
  v_tenant_id   uuid := '99999882-9999-9999-9999-999999999882';
  v_user_id     uuid := '99999883-9999-9999-9999-999999999883';
  v_space_id    uuid := '99999884-9999-9999-9999-999999999884';
  v_company_id  uuid := '99999885-9999-9999-9999-999999999885';
  v_product_id  uuid := '99999886-9999-9999-9999-999999999886';
  v_ta_id       uuid := '99999887-9999-9999-9999-999999999887';
  -- (a) snapshot derives values matching existing columns
  v_t_match     uuid := '99999891-9999-9999-9999-999999999891';
  -- (b) snapshot derives values diverging from existing columns
  v_t_divrg     uuid := '99999892-9999-9999-9999-999999999892';
  -- (c) snapshot has phases:["NA"] (derive returns null) but row has phase_type
  v_t_na        uuid := '99999893-9999-9999-9999-999999999893';
  -- (d) no snapshot at all
  v_t_nosnap    uuid := '99999894-9999-9999-9999-999999999894';
  v_payload_p2  jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE2"]},"statusModule":{"startDateStruct":{"date":"2024-01-01"},"primaryCompletionDateStruct":{"date":"2025-12-31"}}}}'::jsonb;
  v_payload_na  jsonb := '{"protocolSection":{"designModule":{"phases":["NA"],"studyType":"INTERVENTIONAL"},"statusModule":{}}}'::jsonb;
  v_src_a       text;
  v_src_b       text;
  v_src_c       text;
  v_src_d       text;
  v_changed_rows int;
begin
  insert into auth.users (id, email) values (v_user_id, 'phase-source-backfill@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'PhaseSourceBackfill', 'phase-src-bf', 'phasesrcbf', 'PSB', 'psb@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PSB', 'phase-src-bf-t', 'phasesrcbft', 'PSB');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'PSB Co');
  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'PSB Drug');
  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'PSB TA');

  -- (a) matching
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_match, v_space_id, v_user_id, v_product_id, v_ta_id,
      'MATCH', 'NCT99999991', 'P2', '2024-01-01', '2025-12-31');
  insert into public.trial_ctgov_snapshots (trial_id, space_id, nct_id, ctgov_version,
    last_update_post_date, payload, fetched_via, fetched_at)
    values (v_t_match, v_space_id, 'NCT99999991', 1, '2024-01-01', v_payload_p2, 'manual_sync', now());

  -- (b) diverging (existing P3 but ct.gov derives P2)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_divrg, v_space_id, v_user_id, v_product_id, v_ta_id,
      'DIVERGE', 'NCT99999992', 'P3', '2024-01-01', '2025-12-31');
  insert into public.trial_ctgov_snapshots (trial_id, space_id, nct_id, ctgov_version,
    last_update_post_date, payload, fetched_via, fetched_at)
    values (v_t_divrg, v_space_id, 'NCT99999992', 1, '2024-01-01', v_payload_p2, 'manual_sync', now());

  -- (c) phases:["NA"] -> derive returns null; existing has phase_type
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_na, v_space_id, v_user_id, v_product_id, v_ta_id,
      'NA_DERIVE', 'NCT99999993', 'OBS', null, null);
  insert into public.trial_ctgov_snapshots (trial_id, space_id, nct_id, ctgov_version,
    last_update_post_date, payload, fetched_via, fetched_at)
    values (v_t_na, v_space_id, 'NCT99999993', 1, '2024-01-01', v_payload_na, 'manual_sync', now());

  -- (d) no snapshot, phase set
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_nosnap, v_space_id, v_user_id, v_product_id, v_ta_id,
      'NOSNAP', null, 'P1', '2023-06-01', null);

  -- re-run the backfill against the new fixtures
  with latest_snapshot as (
    select distinct on (trial_id) trial_id, payload
      from public.trial_ctgov_snapshots
     order by trial_id, fetched_at desc
  ),
  derived as (
    select ls.trial_id,
      public._derive_phase_type(
        ls.payload #> '{protocolSection,designModule,phases}',
        ls.payload #>> '{protocolSection,designModule,studyType}'
      ) as d_phase_type,
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}') as d_phase_start,
      coalesce(
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
      ) as d_phase_end
      from latest_snapshot ls
  )
  update public.trials t
     set phase_type_source = case
           when t.phase_type is null then null
           when d.d_phase_type is not null and d.d_phase_type = t.phase_type then 'ctgov'
           else 'analyst'
         end,
         phase_start_date_source = case
           when t.phase_start_date is null then null
           when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov'
           else 'analyst'
         end,
         phase_end_date_source = case
           when t.phase_end_date is null then null
           when d.d_phase_end is not null and d.d_phase_end = t.phase_end_date then 'ctgov'
           else 'analyst'
         end
    from derived d
   where d.trial_id = t.id;

  update public.trials t
     set phase_type_source = case when t.phase_type is not null and t.phase_type_source is null then 'analyst' else t.phase_type_source end,
         phase_start_date_source = case when t.phase_start_date is not null and t.phase_start_date_source is null then 'analyst' else t.phase_start_date_source end,
         phase_end_date_source = case when t.phase_end_date is not null and t.phase_end_date_source is null then 'analyst' else t.phase_end_date_source end
   where not exists (select 1 from public.trial_ctgov_snapshots s where s.trial_id = t.id);

  select phase_type_source into v_src_a from public.trials where id = v_t_match;
  select phase_type_source into v_src_b from public.trials where id = v_t_divrg;
  select phase_type_source into v_src_c from public.trials where id = v_t_na;
  select phase_type_source into v_src_d from public.trials where id = v_t_nosnap;

  if v_src_a is distinct from 'ctgov'   then raise exception 'backfill smoke FAIL (a) match: expected ctgov, got %', v_src_a; end if;
  if v_src_b is distinct from 'analyst' then raise exception 'backfill smoke FAIL (b) diverge: expected analyst, got %', v_src_b; end if;
  if v_src_c is distinct from 'analyst' then raise exception 'backfill smoke FAIL (c) NA derive: expected analyst, got %', v_src_c; end if;
  if v_src_d is distinct from 'analyst' then raise exception 'backfill smoke FAIL (d) no-snapshot: expected analyst, got %', v_src_d; end if;
  raise notice 'backfill smoke ok: match=ctgov diverge=analyst NA=analyst nosnap=analyst';

  -- idempotency: re-run, expect 0 row changes (every relevant row already tagged).
  -- the update statements use predicates that match only currently-null source
  -- columns OR derived-value-match comparisons. on re-run, no row's source flips.
  with latest_snapshot as (
    select distinct on (trial_id) trial_id, payload
      from public.trial_ctgov_snapshots
     order by trial_id, fetched_at desc
  ),
  derived as (
    select ls.trial_id,
      public._derive_phase_type(
        ls.payload #> '{protocolSection,designModule,phases}',
        ls.payload #>> '{protocolSection,designModule,studyType}'
      ) as d_phase_type,
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}') as d_phase_start,
      coalesce(
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
      ) as d_phase_end
      from latest_snapshot ls
  )
  update public.trials t
     set phase_type_source = case
           when t.phase_type is null then null
           when d.d_phase_type is not null and d.d_phase_type = t.phase_type then 'ctgov'
           else 'analyst'
         end,
         phase_start_date_source = case
           when t.phase_start_date is null then null
           when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov'
           else 'analyst'
         end,
         phase_end_date_source = case
           when t.phase_end_date is null then null
           when d.d_phase_end is not null and d.d_phase_end = t.phase_end_date then 'ctgov'
           else 'analyst'
         end
    from derived d
   where d.trial_id = t.id
     and (phase_type_source       is distinct from case when t.phase_type       is null then null when d.d_phase_type  is not null and d.d_phase_type  = t.phase_type       then 'ctgov' else 'analyst' end
       or phase_start_date_source is distinct from case when t.phase_start_date is null then null when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov' else 'analyst' end
       or phase_end_date_source   is distinct from case when t.phase_end_date   is null then null when d.d_phase_end   is not null and d.d_phase_end   = t.phase_end_date   then 'ctgov' else 'analyst' end);

  get diagnostics v_changed_rows = row_count;
  if v_changed_rows <> 0 then
    raise exception 'backfill smoke FAIL idempotency: expected 0 rows changed on re-run, got %', v_changed_rows;
  end if;
  raise notice 'backfill smoke ok: idempotent on re-run';

  -- cleanup
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'trial_phase_source_columns smoke test: PASS';
end$$;
