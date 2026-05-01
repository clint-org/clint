# Primary intelligence

## Goal

Stout's primary analytical work product (thesis, what to watch, linked entities, implications) attached to entities in the engagement. Surfaces the read at the top of trial detail and marker detail pages, in the engagement landing's Latest from Stout feed, in marker tooltips on the timeline, and in a filterable browse view.

This is the data layer behind priorities 2 (trial detail) and 3 (marker commentary, surfaced through the Future Catalysts feed UI) in the intelligence layer roadmap. Once shipped, future surfaces (company detail, product detail) plug into the same model with no schema changes.

**Note on terminology.** A *marker* is the database entity (a dated event with a shape, color, title, description). A *future catalyst* is a UI concept: the Future Catalysts feed shows future-dated markers in clinical / regulatory / approval / data categories. There is no separate `catalysts` table. Throughout this spec, primary intelligence attaches to *markers*, not to *catalysts*. The label "Future Catalysts" replaces the previous "Catalysts" label in the app to make the present-vs-future scope explicit.

Reference sketches:
- `src/client/public/internal/trial-detail-stout-read.html` (display layout on trial detail)
- `src/client/public/internal/authoring-surface.html` (authoring drawer)
- `src/client/public/internal/engagement-landing.html` (Latest feed)

## Scope

In v1:
- Primary intelligence on **trials**, **markers** (events on the timeline, including those surfaced as catalysts), **companies**, **products**, and the **engagement (space) itself**.
- Cross-entity linking via the structured `primary_intelligence_links` table. A single piece of intelligence has one primary anchor and any number of linked entities, each with a relationship type.
- Display block on each entity detail page (the primary intelligence FOR this entity), plus a "Referenced in" section listing intelligence pieces that link TO this entity. Same data model, two query directions.
- Authoring drawer for create / edit / publish. Same drawer regardless of entity level; entry point determines the primary anchor.
- Draft and published states. Drafts visible to agency only.
- Markdown body for thesis, watch, implications.
- Revision history on every save.
- Latest from Stout feed on engagement landing (recency-ordered) and the expanded browse view it links to.

Out of scope (deferred to v2):
- Entity-reference autocomplete in the editor.
- Inline material references.
- Collaborative drafts (multi-author).
- AI-assisted drafting.

## Data model

### Storage decision

Single polymorphic `primary_intelligence` table, polymorphic on `entity_type` + `entity_id`. Two child tables: `primary_intelligence_links` for linked entities, `primary_intelligence_revisions` for history.

Watch items and implications are stored as markdown text in single columns. Linked entities are structured (separate table) because each row carries a relationship type and we need both directions of lookup.

Setting `entity_type = 'space'` with `entity_id = <space_id>` lets a piece of intelligence be thematic (about the engagement as a whole) rather than tied to a specific trial or marker.

### `primary_intelligence`

```sql
create table primary_intelligence (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('trial', 'marker', 'company', 'product', 'space')),
  entity_id uuid not null,
  state text not null check (state in ('draft', 'published')) default 'draft',
  headline text not null,
  thesis_md text not null default '',
  watch_md text not null default '',
  implications_md text not null default '',
  last_edited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One published per (space, entity). Drafts can co-exist with the published row.
create unique index primary_intelligence_one_published
  on primary_intelligence (space_id, entity_type, entity_id)
  where state = 'published';

create index on primary_intelligence (entity_type, entity_id);
create index on primary_intelligence (space_id, state, updated_at desc);
```

`last_edited_by` is updated to the current user on every save. The full contributor list is derived from `primary_intelligence_revisions.edited_by` (every save writes a revision row).

### `primary_intelligence_links`

```sql
create table primary_intelligence_links (
  id uuid primary key default gen_random_uuid(),
  primary_intelligence_id uuid not null references primary_intelligence(id) on delete cascade,
  entity_type text not null check (entity_type in ('trial', 'marker', 'company', 'product')),
  entity_id uuid not null,
  relationship_type text not null,
  gloss text,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index on primary_intelligence_links (primary_intelligence_id);
create index on primary_intelligence_links (entity_type, entity_id);
```

`relationship_type` is free text in v1. Common values surfaced in the UI dropdown: Competitor, Same class, Predecessor, Combination, Future window, Partner. Constrain to an enum once usage stabilizes.

### `primary_intelligence_revisions`

Snapshot per save. Trigger writes to this table on every `INSERT` or `UPDATE` of `primary_intelligence`.

```sql
create table primary_intelligence_revisions (
  id uuid primary key default gen_random_uuid(),
  primary_intelligence_id uuid not null references primary_intelligence(id) on delete cascade,
  state text not null,
  headline text not null,
  thesis_md text not null,
  watch_md text not null,
  implications_md text not null,
  change_note text,                   -- optional one-line "what / why" the analyst writes at save time
  edited_by uuid not null references auth.users(id),
  edited_at timestamptz not null default now()
);

create index on primary_intelligence_revisions (primary_intelligence_id, edited_at desc);

create function write_primary_intelligence_revision()
returns trigger language plpgsql as $$
begin
  insert into primary_intelligence_revisions (
    primary_intelligence_id, state, headline, thesis_md, watch_md, implications_md, change_note, edited_by
  ) values (
    new.id, new.state, new.headline, new.thesis_md, new.watch_md, new.implications_md,
    current_setting('app.change_note', true),  -- set transient by upsert RPC
    new.last_edited_by
  );
  return new;
end $$;

create trigger primary_intelligence_revision_trigger
after insert or update on primary_intelligence
for each row execute function write_primary_intelligence_revision();
```

`change_note` is captured per save via a transient session variable that the `upsert_primary_intelligence` RPC sets before performing the update. Optional; visible to all viewers of the read (agency and client).

## RLS

```sql
alter table primary_intelligence enable row level security;
alter table primary_intelligence_links enable row level security;
alter table primary_intelligence_revisions enable row level security;

-- Published intelligence visible to everyone in the space.
create policy primary_intelligence_view_published on primary_intelligence for select
  using (state = 'published' and has_space_access(space_id));

-- Drafts visible to agency members only.
create policy primary_intelligence_view_drafts on primary_intelligence for select
  using (state = 'draft' and is_agency_member_of_space(space_id));

-- Agency members manage all intelligence in their spaces.
create policy primary_intelligence_agency_write on primary_intelligence for all
  using (is_agency_member_of_space(space_id));

-- Links inherit visibility from parent.
create policy primary_intelligence_links_view on primary_intelligence_links for select
  using (exists (
    select 1 from primary_intelligence p
    where p.id = primary_intelligence_links.primary_intelligence_id
      and (
        (p.state = 'published' and has_space_access(p.space_id))
        or (p.state = 'draft' and is_agency_member_of_space(p.space_id))
      )
  ));

create policy primary_intelligence_links_agency_write on primary_intelligence_links for all
  using (exists (
    select 1 from primary_intelligence p
    where p.id = primary_intelligence_links.primary_intelligence_id
      and is_agency_member_of_space(p.space_id)
  ));

-- Revisions: agency only.
create policy primary_intelligence_revisions_view on primary_intelligence_revisions for select
  using (exists (
    select 1 from primary_intelligence p
    where p.id = primary_intelligence_revisions.primary_intelligence_id
      and is_agency_member_of_space(p.space_id)
  ));
```

`has_space_access(space_id)` already exists. `is_agency_member_of_space(space_id)` may need to be added; check `supabase/migrations/` for an equivalent helper before creating one.

## RPCs

### `upsert_primary_intelligence`

```sql
create function upsert_primary_intelligence(
  p_id uuid,                 -- null to create
  p_space_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_headline text,
  p_thesis_md text,
  p_watch_md text,
  p_implications_md text,
  p_state text,              -- 'draft' or 'published'
  p_change_note text,        -- optional one-line "what / why" for the revision row; visible to all viewers
  p_links jsonb              -- array of { entity_type, entity_id, relationship_type, gloss, display_order }
) returns uuid
security definer
language plpgsql as $$
declare
  v_id uuid;
begin
  if not is_agency_member_of_space(p_space_id) then
    raise exception 'forbidden';
  end if;

  -- Stash the change_note in a session variable so the revision trigger picks it up.
  perform set_config('app.change_note', coalesce(p_change_note, ''), true);

  -- Publishing replaces the prior published row of the same (space, entity).
  if p_state = 'published' then
    delete from primary_intelligence
    where space_id = p_space_id
      and entity_type = p_entity_type
      and entity_id = p_entity_id
      and state = 'published'
      and id <> coalesce(p_id, gen_random_uuid());
  end if;

  if p_id is null then
    insert into primary_intelligence (
      space_id, entity_type, entity_id, state, headline,
      thesis_md, watch_md, implications_md, last_edited_by
    ) values (
      p_space_id, p_entity_type, p_entity_id, p_state, p_headline,
      p_thesis_md, p_watch_md, p_implications_md, auth.uid()
    ) returning id into v_id;
  else
    update primary_intelligence
    set state = p_state,
        headline = p_headline,
        thesis_md = p_thesis_md,
        watch_md = p_watch_md,
        implications_md = p_implications_md,
        last_edited_by = auth.uid(),
        updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;

  -- Replace links
  delete from primary_intelligence_links where primary_intelligence_id = v_id;
  insert into primary_intelligence_links (primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order)
  select v_id,
         (l->>'entity_type')::text,
         (l->>'entity_id')::uuid,
         (l->>'relationship_type')::text,
         l->>'gloss',
         coalesce((l->>'display_order')::int, 0)
  from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) l;

  return v_id;
end $$;
```

### `get_trial_detail_with_intelligence`

Returns the trial joined with the current published intelligence (or null), the current draft (if agency caller has one), the linked entities, and the most recent N revisions. Single round-trip from the client.

Equivalent fetchers for markers (`get_marker_detail_with_intelligence`), companies (`get_company_detail_with_intelligence`), products (`get_product_detail_with_intelligence`), and the engagement (`get_space_intelligence`).

### `list_primary_intelligence`

Backs the Latest from Stout feed, the expanded browse view, AND the "Referenced in" sections on entity detail pages. Filterable by entity_type, author, date range, free-text query against headline and thesis, and (for "Referenced in") by linked entity.

```sql
create function list_primary_intelligence(
  p_space_id uuid,
  p_entity_types text[],          -- filter by primary entity type, null for all
  p_author_id uuid,               -- null for all (matches any contributor via revisions)
  p_since timestamptz,            -- null for all
  p_query text,                   -- null for none
  p_referencing_entity_type text, -- "Referenced in" filter: rows where this entity appears in primary_intelligence_links
  p_referencing_entity_id uuid,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb ...
```

When `p_referencing_entity_type` and `p_referencing_entity_id` are set, the RPC returns intelligence pieces that LINK to that entity (via the `primary_intelligence_links` table), not pieces whose primary anchor matches.

### `delete_primary_intelligence`

Agency-only. Cascades to links and revisions.

## Frontend

### New files

```
src/client/src/app/
  core/
    models/
      primary-intelligence.model.ts            (PrimaryIntelligence, PrimaryIntelligenceLink, etc.)
    services/
      primary-intelligence.service.ts          (CRUD + cache layer)
      prose-mirror.service.ts                  (editor schema, plugins, markdown io)
  shared/
    components/
      intelligence-block/
        intelligence-block.component.ts        (display-only presenter)
        intelligence-block.component.html
      intelligence-drawer/
        intelligence-drawer.component.ts       (authoring drawer)
        intelligence-drawer.component.html
      intelligence-empty/
        intelligence-empty.component.ts        ("+ Add primary intelligence" placeholder, agency-only)
      intelligence-feed/
        intelligence-feed.component.ts         (Latest from Stout list, used on engagement landing and browse view)
      intelligence-browse/
        intelligence-browse.component.ts       (filterable expanded browse view)
      prose-mirror-editor/
        prose-mirror-editor.component.ts       (Angular wrapper around ProseMirror EditorView)
      recent-activity-feed/
        recent-activity-feed.component.ts      (revisions stream)
      linked-entities-picker/
        linked-entities-picker.component.ts    (chip picker with relationship dropdown)
```

### Modified files

```
src/client/src/app/features/manage/trials/
  trial-detail.component.ts                    (fetch intelligence alongside trial data)
  trial-detail.component.html                  (insert intelligence block, activity feed, materials, then markers)
```

### ProseMirror service

Encapsulates the editor schema (paragraph, text, bold, italic, link, bullet_list, ordered_list, list_item), key bindings (Mod-B, Mod-I, Tab for list nesting), and markdown serialization via `prosemirror-markdown`.

Exposes:
- `createEditor(target: HTMLElement, content: string, onChange: (md: string) => void): EditorView`
- `destroyEditor(view: EditorView): void`

The `prose-mirror-editor` Angular component is a thin wrapper that creates the EditorView in `ngAfterViewInit` and tears it down in `ngOnDestroy`. It accepts a `value: signal<string>` input (markdown) and emits a `valueChange` output.

### Authoring drawer behaviour

- Same drawer regardless of entity level. What differs is the entry point and the pre-set primary anchor:
  - From a trial / marker / company / product detail page: "+ Add primary intelligence" button pre-sets the anchor to that entity.
  - From the engagement landing: "+ Add primary intelligence" opens a small chooser ("what is this about?") asking the author to pick a specific entity or "thematic for the engagement" (space-level). The chooser searches across all entity types in the engagement.
  - From a draft in the drafts list: anchor is already set from when the draft was created; the drawer opens directly to the editor.
- Loads the current draft if one exists, otherwise opens with the published content pre-filled (creating a new draft on first edit).
- Auto-saves draft on field blur (debounced 1.5s for editor fields).
- Save state indicator in the header.
- Optional **Change note** input above the Save / Publish buttons. One line, e.g., "pulled the topline from Q3 to late Q2 after the protocol amendment came public." Attached to the resulting revision row; visible to all viewers of the read.
- "Publish" button promotes the draft to published, deletes the prior published row (its content lives in revisions), closes the drawer, refreshes the source page.

### Multi-author model

Any agency member with space access can edit and publish. The full contributor list is derived from the distinct `edited_by` values in `primary_intelligence_revisions`. Two display modes:

- **Agency-internal view of a read** shows the contributor initials list ("JM, RS, DK") and the publisher of the current version.
- **Client-facing view of a read** shows only the agency name as the byline ("Published by Stout, updated 2026-04-21"). No individual analyst attribution. Same data, different render — controlled at the component level based on the viewer's role (agency vs. client).

There is no separate "owner" or "contributor" role at the read level. Existing space-level roles (owner / editor) govern who can edit and publish.

### Cross-entity intelligence

A single piece of intelligence has one primary anchor (the entity it's most about) and any number of linked entities (other entities it references). The chip picker at the bottom of the drawer is the structured place to attach linked entities, each with a relationship type (Competitor, Same class, Predecessor, Combination, Future window, Partner).

The same `primary_intelligence_links` rows power two views (same data, two query directions):
- **Linked entities chips on the originating read** -- outgoing: "what does this read link to?"
- **Referenced in section on linked entities' detail pages** -- incoming: "what reads link to this entity?"

Truly cross-cutting intelligence with no obvious primary anchor uses `entity_type = 'space'` (thematic for the engagement) with all the specific entities in the links table.

### Entity detail page sections

Every entity detail page (trial, marker, company, product) renders these sections in order:

1. Entity chrome (breadcrumb, header, status pills) -- existing per entity type
2. Section nav strip (Primary intelligence | Referenced in | Recent activity | Materials | <entity-specific sections>)
3. Primary intelligence block (FOR this entity), or `<app-intelligence-empty>` placeholder if none exists
4. Referenced in (intelligence linking TO this entity, recency-ordered, paginated)
5. Recent activity feed
6. Materials section
7. Entity-specific sections (markers table for trials, etc.)

### UI labels

The block is labeled **Primary intelligence** in the section header. The byline shows the agency and the author: "by Stout, updated 2026-04-21 by JM". On a whitelabel host the agency name comes from the brand context. The component name does not include the agency name (no `stout-*` prefix in code).

### Page layout (trial-detail.component.html)

Top to bottom:

1. Breadcrumb (Company / Product / Trial) -- existing
2. Trial header (name, NCT, phase pill, status pill, LoE pill) -- existing
3. New: Section nav strip (Primary intelligence | Referenced in | Recent activity | Materials | Markers)
4. New: Primary intelligence block, OR `<app-intelligence-empty>` if none exists
5. New: Referenced in section (intelligence linking TO this trial)
6. New: Recent activity feed
7. Materials section (linked from priority 4 spec)
8. Markers table -- existing, moved below

The same pattern applies to marker, company, and product detail pages with their own entity chrome above and entity-specific sections below.

### Recent activity feed (event taxonomy)

Auto-detected events fall into four categories. Each entry shows: timestamp, author initials (agency-only) or just "Stout" (client view), the event-type pill (color-coded by category), the auto-generated subject line, and the optional change note from the analyst.

**Read events** (on `primary_intelligence`):
- Read created
- Read revised (any field change)
- Read published (draft → published)

**Linked entity events** (on `primary_intelligence_links`):
- Linked added
- Linked removed
- Linked relationship changed

**Marker events** (on `markers` for this entity):
- Marker added
- Marker edited
- Marker removed

**Material events** (on the materials registry, when priority 4 ships):
- Material attached
- Material removed

Twelve event types total. Render with category-colored pills (read = brand teal, linked = slate, marker = green/amber/red per category, material = amber). Each entry's subject line is auto-generated; the analyst's `change_note` (if any) follows on a continuation line.

### Engagement landing integration

The Latest from Stout feed on the engagement landing renders `<app-intelligence-feed>` with `state='published'` and recency-ordered limit 5. The "View feed" link routes to `/t/:tenant/s/:space/intelligence` which renders `<app-intelligence-browse>` (same component or filterable variant) with full pagination, filters, and search.

## Migration plan

1. Migration `<timestamp>_primary_intelligence.sql` with the three tables, indexes, trigger, RLS policies.
2. Migration `<timestamp>_primary_intelligence_rpcs.sql` with `upsert_primary_intelligence`, `get_trial_detail_with_intelligence`, `get_marker_detail_with_intelligence`, `get_company_detail_with_intelligence`, `get_product_detail_with_intelligence`, `get_space_intelligence`, `list_primary_intelligence`, `delete_primary_intelligence`.
3. If `is_agency_member_of_space` doesn't exist, add it.
4. Build display components (`intelligence-block`, `recent-activity-feed`, `intelligence-empty`, `intelligence-feed`).
5. Build ProseMirror service + editor component.
6. Build authoring drawer.
7. Wire to trial detail page.
8. Wire to engagement landing's Latest feed.
9. Build `intelligence-browse` page.

## Test plan

1. **Empty state.** Trial with no intelligence: agency sees "+ Add primary intelligence"; client sees nothing.
2. **Create draft.** Agency creates a draft: saves, only agency sees it.
3. **Publish.** Agency publishes: visible to everyone in engagement, appears in Latest from Stout feed.
4. **Edit published.** Agency clicks Edit: new draft created from published content; publishing again replaces the prior published version.
5. **Linked entities.** Add, change relationship type, reorder, remove.
6. **Change note.** Save without a change note; revision row has null change_note. Save with one; revision captures it; activity feed surfaces it on a continuation line.
7. **Markdown rendering.** Bold, italic, lists, links render correctly in display block.
8. **Revisions and activity feed.** Each save writes a revision row. The recent activity feed shows the four event categories (read, linked, marker, material) with appropriate pills.
9. **Multi-author display.** Agency-internal view of a read with contributors JM, RS shows both. Client view shows only "Published by Stout."
10. **Space-level intelligence.** Create a thematic piece with `entity_type='space'`. Confirm it shows in the Latest feed and browse view but does not attach to any specific entity page.
11. **Cross-entity linking.** Create intelligence with primary anchor on CARDIO-SHIELD (trial) and linked entities on Verzubrix (product) and AstraZeneca (company). Confirm it shows as the lead block on CARDIO-SHIELD's page with linked-entity chips visible, AND in the "Referenced in" section on both Verzubrix and AstraZeneca pages.
12. **Authoring entry points.** From a trial / marker / company / product page, "+ Add primary intelligence" pre-sets the anchor. From the engagement landing, the chooser dialog supports all five entity levels (including thematic / space-level).
13. **Browse view.** Filter by entity_type, author, date range. Search across headline and thesis. Pagination works.
14. **RLS.** Client-only user cannot see drafts. Agency user sees both.
15. **Cascade on entity delete.** Hard-delete a trial; confirm primary_intelligence rows for it (drafts and published) are removed via cascade. Revisions follow.
16. **Lint and build.** `cd src/client && ng lint && ng build` passes.

## Branch

`feat/primary-intelligence`. Three PRs:

- **PR 1:** Database (migrations, RLS, RPCs) + display components + page wiring (read-only).
- **PR 2:** Authoring drawer + ProseMirror integration.
- **PR 3:** Latest feed on engagement landing + filterable browse view.

Estimated diff: PR 1 ~700 lines, PR 2 ~600 lines, PR 3 ~400 lines.

## Open questions

- `relationship_type` taxonomy: free text in v1 or constrained enum? Spec says free text; revisit after a quarter of usage.
- Cascade-on-delete semantics: confirmed cascade for v1. Soft-delete pattern (deleted_at columns on entity tables) is a broader system-level decision; punt for now and revisit when the engagement-level retention pattern is set.
- Activity feed scope: revisions on this entity's intelligence, plus marker / linked / material events for this entity. Cross-entity revisions (revisions on linked entities' intelligence) are deferred.
- Future Catalysts UI rename: existing "Catalysts" tab and feed page rename to "Future Catalysts". Touches catalysts page, navigation, sketches, runbook docs. Track separately.
