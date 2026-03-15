-- migration: 20260315120100_create_trial_tables
-- purpose: create trial-related tables and marker types for the clinical trial
--          dashboard: trials, trial_phases, marker_types, trial_markers, trial_notes.
-- affected tables: public.trials, public.trial_phases, public.marker_types,
--                  public.trial_markers, public.trial_notes
-- notes: rls is enabled on all tables; policies will be added in a later migration.

-- =============================================================================
-- trials
-- =============================================================================

create table public.trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  product_id uuid not null references public.products (id),
  therapeutic_area_id uuid not null references public.therapeutic_areas (id),
  name varchar(255) not null,
  identifier varchar(100),
  sample_size int,
  status varchar(50),
  notes text,
  display_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.trials is 'Clinical trials associated with a product and therapeutic area, representing studies such as phase trials or observational studies.';

-- indexes on foreign key columns and filter columns
create index idx_trials_user_id on public.trials (user_id);
create index idx_trials_product_id on public.trials (product_id);
create index idx_trials_therapeutic_area_id on public.trials (therapeutic_area_id);
create index idx_trials_status on public.trials (status);

alter table public.trials enable row level security;

-- =============================================================================
-- trial_phases
-- =============================================================================

create table public.trial_phases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  trial_id uuid not null references public.trials (id),
  phase_type varchar(20) not null,
  start_date date not null,
  end_date date,
  color varchar(7),
  label varchar(100),
  created_at timestamptz default now()
);

comment on table public.trial_phases is 'Individual phases within a clinical trial (e.g. P1, P2, P3, P4, OBS), each with a date range and optional visual styling.';

-- indexes on foreign key columns and filter columns
create index idx_trial_phases_user_id on public.trial_phases (user_id);
create index idx_trial_phases_trial_id on public.trial_phases (trial_id);
create index idx_trial_phases_phase_type on public.trial_phases (phase_type);

alter table public.trial_phases enable row level security;

-- =============================================================================
-- marker_types
-- =============================================================================

create table public.marker_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  name varchar(100) not null,
  icon varchar(50),
  shape varchar(20) not null,
  fill_style varchar(20) not null,
  color varchar(7) not null,
  is_system boolean not null default false,
  display_order int not null default 0,
  created_at timestamptz default now()
);

comment on table public.marker_types is 'Configurable marker type definitions used to annotate trial timelines, including system-provided and user-created types.';

-- index on the owner foreign key
create index idx_marker_types_user_id on public.marker_types (user_id);

alter table public.marker_types enable row level security;

-- =============================================================================
-- trial_markers
-- =============================================================================

create table public.trial_markers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  trial_id uuid not null references public.trials (id),
  marker_type_id uuid not null references public.marker_types (id),
  event_date date not null,
  end_date date,
  tooltip_text text,
  tooltip_image_url varchar(500),
  is_projected boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.trial_markers is 'Individual marker events placed on a trial timeline, referencing a marker type for visual rendering.';

-- indexes on foreign key columns
create index idx_trial_markers_user_id on public.trial_markers (user_id);
create index idx_trial_markers_trial_id on public.trial_markers (trial_id);
create index idx_trial_markers_marker_type_id on public.trial_markers (marker_type_id);

alter table public.trial_markers enable row level security;

-- =============================================================================
-- trial_notes
-- =============================================================================

create table public.trial_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  trial_id uuid not null references public.trials (id),
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.trial_notes is 'Free-text notes attached to a clinical trial for user annotations and commentary.';

-- indexes on foreign key columns
create index idx_trial_notes_user_id on public.trial_notes (user_id);
create index idx_trial_notes_trial_id on public.trial_notes (trial_id);

alter table public.trial_notes enable row level security;
