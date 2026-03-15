-- migration: 20260315170000_create_tenant_space_tables
-- purpose: create multi-tenant and collaborative workspace tables:
--          tenants, tenant_members, tenant_invites, spaces, space_members.
--          also creates the has_space_access() helper function used by all
--          data table rls policies.

-- =============================================================================
-- tenants
-- =============================================================================

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  slug varchar(100) not null unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.tenants is 'Organizations that group users and workspaces together.';

alter table public.tenants enable row level security;

-- =============================================================================
-- tenant_members
-- =============================================================================

create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role varchar(20) not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz default now(),
  unique (tenant_id, user_id)
);

comment on table public.tenant_members is 'Membership join table between tenants and users with role assignment.';

create index idx_tenant_members_tenant_id on public.tenant_members (tenant_id);
create index idx_tenant_members_user_id on public.tenant_members (user_id);

alter table public.tenant_members enable row level security;

-- =============================================================================
-- tenant_invites
-- =============================================================================

create table public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email varchar(255) not null,
  role varchar(20) not null default 'member' check (role in ('owner', 'member')),
  invite_code varchar(50) not null unique,
  created_by uuid not null references auth.users (id),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz default now()
);

comment on table public.tenant_invites is 'Pending invitations to join a tenant, redeemable via unique invite code.';

create index idx_tenant_invites_tenant_id on public.tenant_invites (tenant_id);
create index idx_tenant_invites_invite_code on public.tenant_invites (invite_code);

alter table public.tenant_invites enable row level security;

-- =============================================================================
-- spaces
-- =============================================================================

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name varchar(255) not null,
  description text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.spaces is 'Collaborative workspaces within a tenant where clinical trial data is shared.';

create index idx_spaces_tenant_id on public.spaces (tenant_id);
create index idx_spaces_created_by on public.spaces (created_by);

alter table public.spaces enable row level security;

-- =============================================================================
-- space_members
-- =============================================================================

create table public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role varchar(20) not null default 'editor' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz default now(),
  unique (space_id, user_id)
);

comment on table public.space_members is 'Membership join table between spaces and users with role-based access control.';

create index idx_space_members_space_id on public.space_members (space_id);
create index idx_space_members_user_id on public.space_members (user_id);

alter table public.space_members enable row level security;

-- =============================================================================
-- helper function: has_space_access
-- =============================================================================
-- checks if the current user can access a space, either via explicit space
-- membership or implicitly as a tenant owner. when p_roles is provided,
-- only explicit space membership with one of those roles counts (but tenant
-- owners always pass regardless of p_roles).

create or replace function public.has_space_access(
  p_space_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members sm
    where sm.space_id = p_space_id
      and sm.user_id = auth.uid()
      and (p_roles is null or sm.role = any(p_roles))
  ) or exists (
    select 1 from public.spaces s
    join public.tenant_members tm on tm.tenant_id = s.tenant_id
    where s.id = p_space_id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  );
$$;

-- =============================================================================
-- helper function: is_tenant_member
-- =============================================================================

create or replace function public.is_tenant_member(
  p_tenant_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and (p_roles is null or tm.role = any(p_roles))
  );
$$;

-- =============================================================================
-- rls policies for tenants
-- =============================================================================

create policy "tenant members can view their tenants"
on public.tenants for select to authenticated
using ( public.is_tenant_member(id) );

create policy "authenticated users can create tenants"
on public.tenants for insert to authenticated
with check ( true );

create policy "tenant owners can update tenants"
on public.tenants for update to authenticated
using ( public.is_tenant_member(id, array['owner']) )
with check ( public.is_tenant_member(id, array['owner']) );

create policy "tenant owners can delete tenants"
on public.tenants for delete to authenticated
using ( public.is_tenant_member(id, array['owner']) );

-- =============================================================================
-- rls policies for tenant_members
-- =============================================================================

create policy "tenant members can view fellow members"
on public.tenant_members for select to authenticated
using ( public.is_tenant_member(tenant_id) );

create policy "tenant owners can add members"
on public.tenant_members for insert to authenticated
with check (
  public.is_tenant_member(tenant_id, array['owner'])
  or (user_id = auth.uid() and not exists (
    select 1 from public.tenant_members tm where tm.tenant_id = tenant_members.tenant_id
  ))
);

create policy "tenant owners can update members"
on public.tenant_members for update to authenticated
using ( public.is_tenant_member(tenant_id, array['owner']) )
with check ( public.is_tenant_member(tenant_id, array['owner']) );

create policy "tenant owners can remove members"
on public.tenant_members for delete to authenticated
using ( public.is_tenant_member(tenant_id, array['owner']) );

-- =============================================================================
-- rls policies for tenant_invites
-- =============================================================================

create policy "tenant owners can view invites"
on public.tenant_invites for select to authenticated
using ( public.is_tenant_member(tenant_id, array['owner']) );

create policy "tenant owners can create invites"
on public.tenant_invites for insert to authenticated
with check ( public.is_tenant_member(tenant_id, array['owner']) );

create policy "tenant owners can delete invites"
on public.tenant_invites for delete to authenticated
using ( public.is_tenant_member(tenant_id, array['owner']) );

-- allow anyone to read invites by code (for joining)
create policy "anyone can read invites by code"
on public.tenant_invites for select to authenticated
using ( true );

-- =============================================================================
-- rls policies for spaces
-- =============================================================================

create policy "space members and tenant owners can view spaces"
on public.spaces for select to authenticated
using (
  public.has_space_access(id)
  or public.is_tenant_member(tenant_id)
);

create policy "tenant members can create spaces"
on public.spaces for insert to authenticated
with check ( public.is_tenant_member(tenant_id) );

create policy "space owners and tenant owners can update spaces"
on public.spaces for update to authenticated
using ( public.has_space_access(id, array['owner']) )
with check ( public.has_space_access(id, array['owner']) );

create policy "space owners and tenant owners can delete spaces"
on public.spaces for delete to authenticated
using ( public.has_space_access(id, array['owner']) );

-- =============================================================================
-- rls policies for space_members
-- =============================================================================

create policy "space members can view fellow members"
on public.space_members for select to authenticated
using ( public.has_space_access(space_id) );

create policy "space owners and tenant owners can add members"
on public.space_members for insert to authenticated
with check ( public.has_space_access(space_id, array['owner']) );

create policy "space owners and tenant owners can update members"
on public.space_members for update to authenticated
using ( public.has_space_access(space_id, array['owner']) )
with check ( public.has_space_access(space_id, array['owner']) );

create policy "space owners and tenant owners can remove members"
on public.space_members for delete to authenticated
using ( public.has_space_access(space_id, array['owner']) );
