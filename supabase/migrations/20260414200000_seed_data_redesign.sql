-- migration: 20260414200000_seed_data_redesign
-- purpose: consolidate seed data architecture. remap old marker types to
--          canonical seed.sql IDs, drop legacy seed functions, create modular
--          helper functions and orchestrator for seed_demo_data().
-- affected objects:
--   - public.marker_types (old IDs remapped and deleted)
--   - public.seed_demo_data(uuid) (replaced)
--   - public.seed_demo_data() (dropped, no-arg overload)
--   - public.seed_pharma_demo() (dropped)
--   - public._seed_demo_* (9 new helper functions created)

-- =============================================================================
-- 1. remap old marker type IDs to canonical seed.sql IDs
-- =============================================================================

-- Data category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000013'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000009'
  );
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000030'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000014';
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000031'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000015';

-- Regulatory category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000032'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000003';
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000033'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000016'
  );
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000034'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000017';

-- Approval category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000035'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000018'
  );
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000036'
  where marker_type_id in (
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000019'
  );

-- Clinical Trial category remaps
update public.markers set marker_type_id = 'a0000000-0000-0000-0000-000000000008'
  where marker_type_id = 'a0000000-0000-0000-0000-000000000010';

-- delete old marker types (now orphaned)
delete from public.marker_types
  where id in (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000009',
    'a0000000-0000-0000-0000-000000000010',
    'a0000000-0000-0000-0000-000000000014',
    'a0000000-0000-0000-0000-000000000015',
    'a0000000-0000-0000-0000-000000000016',
    'a0000000-0000-0000-0000-000000000017',
    'a0000000-0000-0000-0000-000000000018',
    'a0000000-0000-0000-0000-000000000019'
  );

-- =============================================================================
-- 2. drop legacy seed functions
-- =============================================================================

drop function if exists public.seed_demo_data();
drop function if exists public.seed_demo_data(uuid);
drop function if exists public.seed_pharma_demo();
