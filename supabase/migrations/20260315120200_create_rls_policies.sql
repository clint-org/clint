-- migration: 20260315120200_create_rls_policies
-- purpose: create row level security policies for all tables in the clinical
--          trial dashboard, ensuring users can only access their own data.
-- affected tables: public.companies, public.products, public.therapeutic_areas,
--                  public.trials, public.trial_phases, public.marker_types,
--                  public.trial_markers, public.trial_notes
-- notes: all standard tables use user_id ownership checks. marker_types has
--        special handling to allow read access to system-provided types while
--        preventing mutation of system types by regular users.

-- =============================================================================
-- companies
-- =============================================================================

-- allow authenticated users to read only companies they created
create policy "users can view own companies"
on public.companies
for select
to authenticated
using ( auth.uid() = user_id );

-- allow authenticated users to insert companies they own
create policy "users can insert own companies"
on public.companies
for insert
to authenticated
with check ( auth.uid() = user_id );

-- allow authenticated users to update only companies they own
create policy "users can update own companies"
on public.companies
for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- allow authenticated users to delete only companies they own
create policy "users can delete own companies"
on public.companies
for delete
to authenticated
using ( auth.uid() = user_id );

-- =============================================================================
-- products
-- =============================================================================

-- allow authenticated users to read only products they created
create policy "users can view own products"
on public.products
for select
to authenticated
using ( auth.uid() = user_id );

-- allow authenticated users to insert products they own
create policy "users can insert own products"
on public.products
for insert
to authenticated
with check ( auth.uid() = user_id );

-- allow authenticated users to update only products they own
create policy "users can update own products"
on public.products
for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- allow authenticated users to delete only products they own
create policy "users can delete own products"
on public.products
for delete
to authenticated
using ( auth.uid() = user_id );

-- =============================================================================
-- therapeutic_areas
-- =============================================================================

-- allow authenticated users to read only therapeutic areas they created
create policy "users can view own therapeutic_areas"
on public.therapeutic_areas
for select
to authenticated
using ( auth.uid() = user_id );

-- allow authenticated users to insert therapeutic areas they own
create policy "users can insert own therapeutic_areas"
on public.therapeutic_areas
for insert
to authenticated
with check ( auth.uid() = user_id );

-- allow authenticated users to update only therapeutic areas they own
create policy "users can update own therapeutic_areas"
on public.therapeutic_areas
for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- allow authenticated users to delete only therapeutic areas they own
create policy "users can delete own therapeutic_areas"
on public.therapeutic_areas
for delete
to authenticated
using ( auth.uid() = user_id );

-- =============================================================================
-- trials
-- =============================================================================

-- allow authenticated users to read only trials they created
create policy "users can view own trials"
on public.trials
for select
to authenticated
using ( auth.uid() = user_id );

-- allow authenticated users to insert trials they own
create policy "users can insert own trials"
on public.trials
for insert
to authenticated
with check ( auth.uid() = user_id );

-- allow authenticated users to update only trials they own
create policy "users can update own trials"
on public.trials
for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- allow authenticated users to delete only trials they own
create policy "users can delete own trials"
on public.trials
for delete
to authenticated
using ( auth.uid() = user_id );

-- =============================================================================
-- trial_phases
-- =============================================================================

-- allow authenticated users to read only trial phases they created
create policy "users can view own trial_phases"
on public.trial_phases
for select
to authenticated
using ( auth.uid() = user_id );

-- allow authenticated users to insert trial phases they own
create policy "users can insert own trial_phases"
on public.trial_phases
for insert
to authenticated
with check ( auth.uid() = user_id );

-- allow authenticated users to update only trial phases they own
create policy "users can update own trial_phases"
on public.trial_phases
for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- allow authenticated users to delete only trial phases they own
create policy "users can delete own trial_phases"
on public.trial_phases
for delete
to authenticated
using ( auth.uid() = user_id );

-- =============================================================================
-- marker_types (special case: system types are visible to all authenticated users)
-- =============================================================================

-- allow authenticated users to read their own marker types and system-provided types
create policy "users can view own marker_types"
on public.marker_types
for select
to authenticated
using ( auth.uid() = user_id or is_system = true );

-- allow authenticated users to insert their own non-system marker types
create policy "users can insert own marker_types"
on public.marker_types
for insert
to authenticated
with check ( auth.uid() = user_id and is_system = false );

-- allow authenticated users to update only their own non-system marker types
create policy "users can update own marker_types"
on public.marker_types
for update
to authenticated
using ( auth.uid() = user_id and is_system = false )
with check ( auth.uid() = user_id and is_system = false );

-- allow authenticated users to delete only their own non-system marker types
create policy "users can delete own marker_types"
on public.marker_types
for delete
to authenticated
using ( auth.uid() = user_id and is_system = false );

-- =============================================================================
-- trial_markers
-- =============================================================================

-- allow authenticated users to read only trial markers they created
create policy "users can view own trial_markers"
on public.trial_markers
for select
to authenticated
using ( auth.uid() = user_id );

-- allow authenticated users to insert trial markers they own
create policy "users can insert own trial_markers"
on public.trial_markers
for insert
to authenticated
with check ( auth.uid() = user_id );

-- allow authenticated users to update only trial markers they own
create policy "users can update own trial_markers"
on public.trial_markers
for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- allow authenticated users to delete only trial markers they own
create policy "users can delete own trial_markers"
on public.trial_markers
for delete
to authenticated
using ( auth.uid() = user_id );

-- =============================================================================
-- trial_notes
-- =============================================================================

-- allow authenticated users to read only trial notes they created
create policy "users can view own trial_notes"
on public.trial_notes
for select
to authenticated
using ( auth.uid() = user_id );

-- allow authenticated users to insert trial notes they own
create policy "users can insert own trial_notes"
on public.trial_notes
for insert
to authenticated
with check ( auth.uid() = user_id );

-- allow authenticated users to update only trial notes they own
create policy "users can update own trial_notes"
on public.trial_notes
for update
to authenticated
using ( auth.uid() = user_id )
with check ( auth.uid() = user_id );

-- allow authenticated users to delete only trial notes they own
create policy "users can delete own trial_notes"
on public.trial_notes
for delete
to authenticated
using ( auth.uid() = user_id );
