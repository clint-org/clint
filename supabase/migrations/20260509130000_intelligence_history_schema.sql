-- migration: 20260509130000_intelligence_history_schema
-- purpose: extend primary_intelligence to support versioned history.
--   adds archived/withdrawn states, version_number, published_at,
--   withdrawn_at/withdrawn_by, two BEFORE triggers (assign version
--   on entry to published; reject illegal state transitions), and
--   backfills currently-published rows as v1.

-- =============================================================================
-- expand state CHECK
-- =============================================================================

alter table public.primary_intelligence
  drop constraint if exists primary_intelligence_state_check;

alter table public.primary_intelligence
  add constraint primary_intelligence_state_check
      check (state in ('draft','published','archived','withdrawn'));

-- =============================================================================
-- new columns
-- =============================================================================

alter table public.primary_intelligence
  add column if not exists version_number int,
  add column if not exists published_at  timestamptz,
  add column if not exists withdrawn_at  timestamptz,
  add column if not exists withdrawn_by  uuid references auth.users (id);

comment on column public.primary_intelligence.version_number is
  'Per-anchor sequence assigned on entry into state=published. Null for drafts. Preserved through archive/withdraw transitions.';
comment on column public.primary_intelligence.published_at is
  'Timestamp of the most recent transition into state=published. Preserved through archive/withdraw.';
comment on column public.primary_intelligence.withdrawn_at is
  'Timestamp of the published -> withdrawn transition. Null otherwise.';

-- =============================================================================
-- index for the history panel (versions list, newest first)
-- =============================================================================

create index if not exists idx_primary_intelligence_anchor_versions
  on public.primary_intelligence (space_id, entity_type, entity_id, version_number desc)
  where state in ('published','archived','withdrawn');

-- =============================================================================
-- trigger: assign_primary_intelligence_version
-- =============================================================================
-- BEFORE INSERT/UPDATE. When state is published and version_number is null,
-- stamp the next per-anchor version number and set published_at = now().

create or replace function public.assign_primary_intelligence_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.state = 'published' and new.version_number is null then
    new.version_number := coalesce((
      select max(version_number) + 1
        from public.primary_intelligence
       where space_id    = new.space_id
         and entity_type = new.entity_type
         and entity_id   = new.entity_id
         and (TG_OP = 'INSERT' or id <> new.id)
         and version_number is not null
    ), 1);
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists primary_intelligence_assign_version_trigger
  on public.primary_intelligence;

create trigger primary_intelligence_assign_version_trigger
  before insert or update on public.primary_intelligence
  for each row execute function public.assign_primary_intelligence_version();

-- =============================================================================
-- trigger: guard_primary_intelligence_state
-- =============================================================================
-- BEFORE UPDATE. Rejects illegal state transitions:
--   - any change out of archived or withdrawn (terminal except for purge=DELETE)
--   - published -> draft (use withdraw or republish a new draft)

create or replace function public.guard_primary_intelligence_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.state is distinct from new.state then
    if old.state = 'archived' or old.state = 'withdrawn' then
      raise exception 'cannot transition % from terminal state %', new.id, old.state
        using errcode = '22023';
    end if;
    if old.state = 'published' and new.state = 'draft' then
      raise exception 'cannot move published row back to draft (use withdraw or republish a new draft)'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists primary_intelligence_guard_state_trigger
  on public.primary_intelligence;

create trigger primary_intelligence_guard_state_trigger
  before update on public.primary_intelligence
  for each row execute function public.guard_primary_intelligence_state();

-- =============================================================================
-- backfill: every currently-published row becomes v1
-- =============================================================================

update public.primary_intelligence
   set version_number = 1,
       published_at  = coalesce(published_at, updated_at)
 where state = 'published'
   and version_number is null;
