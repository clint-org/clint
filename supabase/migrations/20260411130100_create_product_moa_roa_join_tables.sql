-- create join tables for products <-> mechanisms_of_action and routes_of_administration

create table if not exists public.product_mechanisms_of_action (
  product_id uuid not null references public.products(id) on delete cascade,
  moa_id uuid not null references public.mechanisms_of_action(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, moa_id)
);

create index if not exists idx_product_mechanisms_by_moa
  on public.product_mechanisms_of_action (moa_id);

create table if not exists public.product_routes_of_administration (
  product_id uuid not null references public.products(id) on delete cascade,
  roa_id uuid not null references public.routes_of_administration(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, roa_id)
);

create index if not exists idx_product_routes_by_roa
  on public.product_routes_of_administration (roa_id);

-- RLS: gate by the parent product's space_id (rows in join tables inherit their space from the product)
alter table public.product_mechanisms_of_action enable row level security;
alter table public.product_routes_of_administration enable row level security;

create policy "space members can view product_mechanisms_of_action" on public.product_mechanisms_of_action for select to authenticated
using ( exists (select 1 from public.products p where p.id = product_mechanisms_of_action.product_id and public.has_space_access(p.space_id)) );
create policy "space editors can insert product_mechanisms_of_action" on public.product_mechanisms_of_action for insert to authenticated
with check ( exists (select 1 from public.products p where p.id = product_mechanisms_of_action.product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );
create policy "space editors can delete product_mechanisms_of_action" on public.product_mechanisms_of_action for delete to authenticated
using ( exists (select 1 from public.products p where p.id = product_mechanisms_of_action.product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );

create policy "space members can view product_routes_of_administration" on public.product_routes_of_administration for select to authenticated
using ( exists (select 1 from public.products p where p.id = product_routes_of_administration.product_id and public.has_space_access(p.space_id)) );
create policy "space editors can insert product_routes_of_administration" on public.product_routes_of_administration for insert to authenticated
with check ( exists (select 1 from public.products p where p.id = product_routes_of_administration.product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );
create policy "space editors can delete product_routes_of_administration" on public.product_routes_of_administration for delete to authenticated
using ( exists (select 1 from public.products p where p.id = product_routes_of_administration.product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );

-- note: no UPDATE policies; rows in join tables are immutable. setMechanisms / setRoutes always delete-then-insert.
