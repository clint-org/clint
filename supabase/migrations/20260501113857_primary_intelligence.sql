-- migration: 20260501113857_primary_intelligence
-- purpose: tables, indexes, revision trigger, rls policies, and the
--          is_agency_member_of_space helper for primary intelligence.
--
-- the primary_intelligence table is polymorphic on (entity_type, entity_id):
--   trial | marker | company | product | space. the unique partial index
--   guarantees one published row per (space, entity); drafts can co-exist.
--   primary_intelligence_links is the structured cross-entity relation;
--   primary_intelligence_revisions captures a snapshot per save via trigger.

-- =============================================================================
-- helper: is_agency_member_of_space
-- =============================================================================
-- mirrors has_space_access shape but answers "is the caller a member of the
-- agency that provisioned the tenant for this space?". used by the rls
-- policies on primary_intelligence to gate draft visibility and writes.

create or replace function public.is_agency_member_of_space(
  p_space_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_space_id
      and t.agency_id is not null
      and public.is_agency_member(t.agency_id)
  );
$$;

comment on function public.is_agency_member_of_space(uuid) is
  'RLS helper. True when the caller is a member of the agency that '
  'provisioned the tenant owning p_space_id. SECURITY DEFINER to keep RLS '
  'policies free of cross-table reads.';

revoke execute on function public.is_agency_member_of_space(uuid) from public;
revoke execute on function public.is_agency_member_of_space(uuid) from anon;
grant  execute on function public.is_agency_member_of_space(uuid) to authenticated;

-- =============================================================================
-- table: primary_intelligence
-- =============================================================================

create table public.primary_intelligence (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  entity_type text not null check (entity_type in ('trial', 'marker', 'company', 'product', 'space')),
  entity_id uuid not null,
  state text not null check (state in ('draft', 'published')) default 'draft',
  headline text not null,
  thesis_md text not null default '',
  watch_md text not null default '',
  implications_md text not null default '',
  last_edited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.primary_intelligence is
  'Stout-authored primary intelligence reads attached to space entities '
  '(trial, marker, company, product, or the space itself). One published '
  'row per (space_id, entity_type, entity_id); drafts may co-exist.';

-- one published row per (space, entity); drafts unrestricted.
create unique index primary_intelligence_one_published
  on public.primary_intelligence (space_id, entity_type, entity_id)
  where state = 'published';

create index idx_primary_intelligence_entity
  on public.primary_intelligence (entity_type, entity_id);

create index idx_primary_intelligence_space_state_updated
  on public.primary_intelligence (space_id, state, updated_at desc);

alter table public.primary_intelligence enable row level security;

-- =============================================================================
-- table: primary_intelligence_links
-- =============================================================================

create table public.primary_intelligence_links (
  id uuid primary key default gen_random_uuid(),
  primary_intelligence_id uuid not null
    references public.primary_intelligence (id) on delete cascade,
  entity_type text not null check (entity_type in ('trial', 'marker', 'company', 'product')),
  entity_id uuid not null,
  relationship_type text not null,
  gloss text,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.primary_intelligence_links is
  'Cross-entity links from a primary_intelligence read to other entities '
  'in the same space. Surfaces both as the linked-entity chips on the read '
  'and as the Referenced in section on the linked entity detail pages.';

create index idx_primary_intelligence_links_parent
  on public.primary_intelligence_links (primary_intelligence_id);

create index idx_primary_intelligence_links_entity
  on public.primary_intelligence_links (entity_type, entity_id);

alter table public.primary_intelligence_links enable row level security;

-- =============================================================================
-- table: primary_intelligence_revisions
-- =============================================================================

create table public.primary_intelligence_revisions (
  id uuid primary key default gen_random_uuid(),
  primary_intelligence_id uuid not null
    references public.primary_intelligence (id) on delete cascade,
  state text not null,
  headline text not null,
  thesis_md text not null,
  watch_md text not null,
  implications_md text not null,
  change_note text,
  edited_by uuid not null references auth.users (id),
  edited_at timestamptz not null default now()
);

comment on table public.primary_intelligence_revisions is
  'Snapshot per save of a primary_intelligence row. Written by trigger on '
  'every insert or update of primary_intelligence. Visible to agency '
  'members only; the change_note is also surfaced to clients via the '
  'public read API.';

create index idx_primary_intelligence_revisions_parent_edited
  on public.primary_intelligence_revisions (primary_intelligence_id, edited_at desc);

alter table public.primary_intelligence_revisions enable row level security;

-- =============================================================================
-- trigger: write_primary_intelligence_revision
-- =============================================================================
-- snapshot the row into primary_intelligence_revisions. picks up an optional
-- change_note from the session variable app.change_note, set by the upsert
-- rpc immediately before the underlying update.

create or replace function public.write_primary_intelligence_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_change_note text;
begin
  v_change_note := nullif(current_setting('app.change_note', true), '');

  insert into public.primary_intelligence_revisions (
    primary_intelligence_id, state, headline, thesis_md, watch_md,
    implications_md, change_note, edited_by
  ) values (
    new.id, new.state, new.headline, new.thesis_md, new.watch_md,
    new.implications_md, v_change_note, new.last_edited_by
  );

  return new;
end;
$$;

create trigger primary_intelligence_revision_trigger
after insert or update on public.primary_intelligence
for each row execute function public.write_primary_intelligence_revision();

-- =============================================================================
-- rls policies: primary_intelligence
-- =============================================================================

create policy "primary_intelligence published readable in space"
on public.primary_intelligence for select to authenticated
using (
  state = 'published'
  and public.has_space_access(space_id)
);

create policy "primary_intelligence drafts readable to agency"
on public.primary_intelligence for select to authenticated
using (
  state = 'draft'
  and public.is_agency_member_of_space(space_id)
);

create policy "primary_intelligence agency members can insert"
on public.primary_intelligence for insert to authenticated
with check ( public.is_agency_member_of_space(space_id) );

create policy "primary_intelligence agency members can update"
on public.primary_intelligence for update to authenticated
using ( public.is_agency_member_of_space(space_id) )
with check ( public.is_agency_member_of_space(space_id) );

create policy "primary_intelligence agency members can delete"
on public.primary_intelligence for delete to authenticated
using ( public.is_agency_member_of_space(space_id) );

-- =============================================================================
-- rls policies: primary_intelligence_links
-- =============================================================================

create policy "primary_intelligence_links readable when parent is"
on public.primary_intelligence_links for select to authenticated
using (
  exists (
    select 1 from public.primary_intelligence p
    where p.id = primary_intelligence_links.primary_intelligence_id
      and (
        (p.state = 'published' and public.has_space_access(p.space_id))
        or (p.state = 'draft' and public.is_agency_member_of_space(p.space_id))
      )
  )
);

create policy "primary_intelligence_links agency members can insert"
on public.primary_intelligence_links for insert to authenticated
with check (
  exists (
    select 1 from public.primary_intelligence p
    where p.id = primary_intelligence_links.primary_intelligence_id
      and public.is_agency_member_of_space(p.space_id)
  )
);

create policy "primary_intelligence_links agency members can update"
on public.primary_intelligence_links for update to authenticated
using (
  exists (
    select 1 from public.primary_intelligence p
    where p.id = primary_intelligence_links.primary_intelligence_id
      and public.is_agency_member_of_space(p.space_id)
  )
)
with check (
  exists (
    select 1 from public.primary_intelligence p
    where p.id = primary_intelligence_links.primary_intelligence_id
      and public.is_agency_member_of_space(p.space_id)
  )
);

create policy "primary_intelligence_links agency members can delete"
on public.primary_intelligence_links for delete to authenticated
using (
  exists (
    select 1 from public.primary_intelligence p
    where p.id = primary_intelligence_links.primary_intelligence_id
      and public.is_agency_member_of_space(p.space_id)
  )
);

-- =============================================================================
-- rls policies: primary_intelligence_revisions
-- =============================================================================

create policy "primary_intelligence_revisions agency view"
on public.primary_intelligence_revisions for select to authenticated
using (
  exists (
    select 1 from public.primary_intelligence p
    where p.id = primary_intelligence_revisions.primary_intelligence_id
      and public.is_agency_member_of_space(p.space_id)
  )
);

-- writes only happen via the trigger (security invoker), so no direct
-- insert/update/delete policies are needed.
