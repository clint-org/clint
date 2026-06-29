# Stage 3 backend handoff (for the cutover / DB-owner session)

The Stage 3 merged Event form (write path) is built on `feat/event-model-stage-3`. Two
backend pieces are owned by the cutover/DB session (it owns the local DB + the activity
wiring). The frontend already calls these contracts; integration is deferred until they land.

Both parts are ONE coordinated change. Base every `create or replace` on the **live**
definition (use `pg_get_functiondef`, not an older migration copy) so the activity wiring
and auth checks are preserved. End the migration with `notify pgrst, 'reload schema'`.

---

## Part A: extend create_event + update_event

### A1. create_event gains `p_metadata jsonb`
Restores tags (a real prior feature) + regulatory pathway (marker-form, FDA-Submission
only) via `events.metadata` (the column already exists).

- Add a trailing param `p_metadata jsonb default null`.
- In the INSERT, set `metadata = p_metadata` (leave null when not provided).
- The current latest is `20260628320000_drop_events_source_url.sql` (already has `p_sources`).

Frontend note: `EventService.createEvent` sends `p_metadata` only when non-null (it is
omitted otherwise), so create keeps working before this lands; metadata persists after.

### A2. update_event gains type/anchor (re-anchor on edit) + `p_metadata`
User decision (2026-06-29): editing an event may change its **type and anchor**, not just
the mutable fields, so a mistyped anchor/type is fixable without recreating the event.

Add to `update_event` (live def: `20260628300000_activity_wiring.sql`):
- `p_event_type_id uuid`, `p_anchor_type text`, `p_anchor_id uuid` -> update those columns.
- `p_metadata jsonb default null` -> update `events.metadata`.
- Validate `anchor_type`/`anchor_id` exactly as `create_event` does (space => null id; else
  the entity must exist in the space).
- PRESERVE the existing `trial_change_events` activity-write (capture pre-edit date/anchor)
  and the auth checks. Re-anchor should still emit the activity row.

Frontend signatures the form calls (param names must match):
```
create_event(p_space_id, p_event_type_id, p_title, p_event_date, p_anchor_type, p_anchor_id,
  p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing,
  p_description, p_source_url, p_significance, p_visibility, p_source_doc_id, p_sources, p_metadata)
update_event(p_event_id, p_event_type_id, p_anchor_type, p_anchor_id, p_title, p_event_date,
  p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing, p_description,
  p_source_url, p_significance, p_visibility, p_no_longer_expected, p_metadata)
```

---

## Part B: rebuild the detail read path (get_event_detail) - Stage 3 Task 1, backend half

The detail read path is stale/de-routed: `get_catalyst_detail` + the frontend `EventDetail`
model + `event-detail-panel.component` all return/consume the OLD shape (`priority`, `tags`
as a column, `thread_id`, `entity_level`, `company_name`) with NO `registry_url`,
`event_type`, `anchor_type`, `significance`, `visibility`, `projection`, `date_precision`,
or `no_longer_expected`. The merged form's edit-hydration and the Stage 3 sources rendering
need the unified shape.

1. **Rename** `get_catalyst_detail` -> `get_event_detail` (the Stage 3 RPC rename), map it in
   `features:check`, and drop the dead `get_key_catalysts` mapping.
2. **Return the unified shape** (jsonb): `id`, `event_type { id, name, category { id, name } }`,
   `anchor_type`, `anchor_id`, `anchor_name`, `title`, `event_date`, `date_precision`,
   `end_date`, `end_date_precision`, `is_ongoing`, `projection`, `significance`, `visibility`,
   `no_longer_expected`, `description`, `source_doc_id`, `sources [{ id, url, label }]`,
   `registry_url` (DERIVED via `event_registry_url` for a trial anchor with an NCT; never
   stored), `metadata { tags, pathway }`, plus audit fields.
3. Coordinate the frontend `EventDetail` model rebuild with me (it lives in
   `core/models/event.model.ts`); the merged form's edit-hydration + the detail panel consume
   it. I can do the frontend model + detail-panel rebuild once the RPC returns the new shape -
   ping me when `get_event_detail` is ready.

---

## Coordination

- My branch (`feat/event-model-stage-3`) is off the cutover tip `cd67ce4d`. When you land
  these on `feat/event-model` (or develop after E4), I merge them in and un-defer the
  integration tests.
- Nothing here changes the timeline or any other shipped surface.
