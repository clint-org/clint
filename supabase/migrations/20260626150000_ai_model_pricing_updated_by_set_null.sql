-- Align ai_model_pricing.updated_by with the who-did-this stamp convention.
--
-- ai_model_pricing is a GLOBAL catalog: its rows carry no space_id/tenant_id,
-- so nothing cascades a row away when a user is deleted. With the updated_by FK
-- at ON DELETE NO ACTION, any user who ever edited model pricing (via
-- platform_admin_upsert_ai_model_pricing, which stamps updated_by = auth.uid())
-- could no longer be deleted -- the FK blocks it. In prod that silently wedges
-- platform-admin offboarding; in CI it broke the persona-fixture teardown
-- (deleteUser -> "Database error deleting user" -> next suite's createUser hits
-- "already registered" -> cascade-fails every downstream integration suite).
--
-- The established convention for a who-did-this stamp that is not scoped to a
-- cascading parent is ON DELETE SET NULL: audit_events.actor_user_id,
-- mechanisms_of_action.created_by, and routes_of_administration.created_by all
-- use it. Adopt the same here so user deletion is never FK-blocked while the
-- pricing history row is preserved with a null editor.

alter table public.ai_model_pricing
  drop constraint ai_model_pricing_updated_by_fkey;

alter table public.ai_model_pricing
  add constraint ai_model_pricing_updated_by_fkey
  foreign key (updated_by) references auth.users (id) on delete set null;
