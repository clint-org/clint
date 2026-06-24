-- migration: 20260624140000_discard_pending_material
-- purpose: roll back an orphaned material registration.
--
-- The upload flow registers a material row (finalized_at NULL) before the
-- file is confirmed in R2 (register_material -> prepare_material_upload ->
-- worker sign -> browser PUT -> finalize_material). If any step after
-- register fails, the row lingers with finalized_at IS NULL -- invisible to
-- the list/download RPCs (they filter finalized_at IS NOT NULL) but still a
-- stray row. This RPC lets the uploader discard their own never-finalized
-- registration as a best-effort rollback.
--
-- Deliberately NOT audited: this is the rollback of an upload that never
-- completed, not a user-initiated delete of a real material. (Real deletes
-- go through delete_material, which IS audited as of the material-delete
-- migration.)

create or replace function public.discard_pending_material(
  p_material_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the uploader can discard, and only while the row has never been
  -- finalized. A finalized row, or another user's row, is left untouched
  -- (no error: this is a best-effort rollback called from a catch handler).
  delete from public.materials
  where id = p_material_id
    and finalized_at is null
    and uploaded_by = auth.uid();
end;
$$;

revoke execute on function public.discard_pending_material(uuid) from public, anon;
grant  execute on function public.discard_pending_material(uuid) to authenticated;

comment on function public.discard_pending_material(uuid) is
  'Best-effort rollback of an orphaned material registration. Deletes the '
  'row only when it has never been finalized (finalized_at IS NULL) and the '
  'caller is the uploader. No-op (no error) otherwise. Not audited: this '
  'undoes an upload that never completed, not a delete of a real material.';

notify pgrst, 'reload schema';
