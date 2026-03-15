-- migration: 20260315120000_create_core_tables
-- purpose: create the core domain tables for the clinical trial dashboard:
--          companies, products, and therapeutic_areas.
-- affected tables: public.companies, public.products, public.therapeutic_areas
-- notes: rls is enabled on all tables; policies will be added in a later migration.

-- =============================================================================
-- companies
-- =============================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  name varchar(255) not null,
  logo_url varchar(500),
  display_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.companies is 'Pharmaceutical or biotech companies that own products and run clinical trials.';

-- index on the owner foreign key for rls filtering and joins
create index idx_companies_user_id on public.companies (user_id);

alter table public.companies enable row level security;

-- =============================================================================
-- products
-- =============================================================================

create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  company_id uuid not null references public.companies (id),
  name varchar(255) not null,
  generic_name varchar(255),
  logo_url varchar(500),
  display_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.products is 'Drug or therapy products belonging to a company, each potentially involved in one or more clinical trials.';

-- indexes on foreign key columns
create index idx_products_user_id on public.products (user_id);
create index idx_products_company_id on public.products (company_id);

alter table public.products enable row level security;

-- =============================================================================
-- therapeutic_areas
-- =============================================================================

create table public.therapeutic_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  name varchar(255) not null,
  abbreviation varchar(50),
  created_at timestamptz default now()
);

comment on table public.therapeutic_areas is 'Medical therapeutic areas (e.g. oncology, cardiology) used to categorize clinical trials.';

-- index on the owner foreign key
create index idx_therapeutic_areas_user_id on public.therapeutic_areas (user_id);

alter table public.therapeutic_areas enable row level security;
