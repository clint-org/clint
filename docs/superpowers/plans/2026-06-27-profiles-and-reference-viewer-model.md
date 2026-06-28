# Profiles + Reference Viewer Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the entity catalog browse-visible to every space member as "Profiles" (renamed from "Manage", routes `/manage` -> `/profiles`), and rationalize the read-only experience by giving viewers a "Reference" group of guides while gating the Taxonomies/Marker Types management pages to editors and owners.

**Architecture:** Two merged specs over one shared surface. The change is concentrated in the nav layer (`sidebar-nav.ts`, `app-shell.component.ts`, `icon-rail.component.ts`), the route table (`app.routes.ts`), and one new help page (`taxonomies-help`). No component bodies in `features/manage/**` change: their edit controls are already gated by `SpaceRoleService.canEdit()`, and the entity SELECT RLS policies already admit any member, so opening browse to viewers is purely a guard + nav change. The existing `editGuard` (owner/editor) is *removed* from the entity list routes and *reused* on the two reference-settings routes, so the editor gate relocates from "browsing entities" to "managing taxonomies/marker types".

**Tech Stack:** Angular 21 (standalone, signals, OnPush, native control flow), PrimeNG 21, Tailwind v4, Vitest (`npm run test:units`), Supabase (no DB change here).

## Global Constraints

- No emojis, no em dashes anywhere (UI, docs, comments). Use commas/colons/periods.
- Angular client rules in `src/client/CLAUDE.md` apply to every edited file: standalone, `ChangeDetectionStrategy.OnPush`, `inject()`, `input()`/`output()`/`model()`, native control flow (`@if`/`@for`/`@switch`), `signal()`/`computed()`, `bg-brand-*` not `bg-teal-*`, lint is fully ratcheted to `error`.
- Tailwind data colors (slate/red/amber/green/cyan/violet) stay hard-coded; brand colors use `bg-brand-*`.
- Reuse the existing `editGuard` for editor gating; do NOT create a new `spaceEditorGuard` (DRY deviation from the taxonomies spec, intentional).
- Keep the on-disk folder `src/app/features/manage/` as-is (internal `loadComponent` import paths keep referencing `./features/manage/...`); only URLs and labels change. Renaming the folder is an explicit non-goal to bound blast radius.
- Verify after every task touching `src/client`: `cd src/client && ng lint && ng build`. Unit tests: `cd src/client && npm run test:units`.
- `app.routes.ts` changes require a docs regen: `cd src/client && npm run docs:arch` (needs local Supabase running) committed in the same PR. This is the final task.

**Source specs:**
- `docs/superpowers/specs/2026-06-27-profiles-rename-and-viewer-access-design.md`
- `docs/superpowers/specs/2026-06-27-taxonomies-guide-and-settings-gating-design.md`

---

### Task 1: Route table -- rename `/manage` -> `/profiles`, relocate `editGuard`, add help routes

**Files:**
- Modify: `src/client/src/app/app.routes.ts`
- Test: `src/client/src/app/app.routes.spec.ts` (create if absent)

**Interfaces:**
- Produces route paths consumed by Tasks 3-5: `profiles/companies`, `profiles/assets`, `profiles/trials`, `profiles/trials/:id`, `profiles/companies/:id`, `profiles/assets/:id`, `profiles/engagement`, `help/taxonomies` (space-level), `help/phases` (new space-level alias).
- `editGuard` import already present (line 18). No new guard.

- [ ] **Step 1: Write the failing test** (`src/client/src/app/app.routes.spec.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { Route } from '@angular/router';
import { routes } from './app.routes';
import { editGuard } from './core/guards/edit.guard';

// Recursively collect every route with its full path joined by '/'.
function flatten(rs: Route[], prefix = ''): { path: string; route: Route }[] {
  const out: { path: string; route: Route }[] = [];
  for (const r of rs) {
    const path = [prefix, r.path ?? ''].filter(Boolean).join('/');
    out.push({ path, route: r });
    if (r.children) out.push(...flatten(r.children, path));
  }
  return out;
}

describe('app.routes profiles rename', () => {
  const all = flatten(routes);
  const find = (suffix: string) => all.find((e) => e.path.endsWith(suffix));

  it('exposes profiles/* entity routes and no manage/* routes', () => {
    expect(find('profiles/companies')).toBeTruthy();
    expect(find('profiles/assets')).toBeTruthy();
    expect(find('profiles/trials')).toBeTruthy();
    expect(find('profiles/engagement')).toBeTruthy();
    expect(all.some((e) => e.path.includes('manage/'))).toBe(false);
  });

  it('removes editGuard from profiles list routes (viewer-browsable)', () => {
    const companies = find('profiles/companies')!;
    expect(companies.route.canActivate ?? []).not.toContain(editGuard);
  });

  it('reuses editGuard on the two reference-settings routes', () => {
    const tax = find('settings/taxonomies')!;
    const markers = find('settings/marker-types')!;
    expect(tax.route.canActivate ?? []).toContain(editGuard);
    expect(markers.route.canActivate ?? []).toContain(editGuard);
  });

  it('adds a space-level taxonomies guide route', () => {
    expect(find('help/taxonomies')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd src/client && npx vitest run src/app/app.routes.spec.ts`
Expected: FAIL (manage/ routes still present, no help/taxonomies).

- [ ] **Step 3: Apply the route edits** in `src/app/app.routes.ts`:

1. In the three entity list routes (currently lines ~367-389), rename `path: 'manage/companies'` -> `'profiles/companies'`, `'manage/assets'` -> `'profiles/assets'`, `'manage/trials'` -> `'profiles/trials'`, and **delete the `canActivate: [editGuard],` line** from each (the parent `s/:spaceId` `spaceGuard` still enforces membership).
2. Rename the detail/engagement routes: `'manage/trials/:id'` -> `'profiles/trials/:id'`, `'manage/companies/:id'` -> `'profiles/companies/:id'`, `'manage/assets/:id'` -> `'profiles/assets/:id'`, `'manage/engagement'` -> `'profiles/engagement'`. Leave their `loadComponent` import paths pointing at `./features/manage/...` (folder unchanged).
3. Add `canActivate: [editGuard],` to the `settings/taxonomies` route (currently line ~434) and the `settings/marker-types` route (currently line ~420). Leave `settings/marker-categories` ungated (it is reached only from the marker-types page, itself now gated).
4. Delete the four legacy `manage/*` redirect routes (`manage/marker-types`, `manage/therapeutic-areas`, `manage/mechanisms-of-action`, `manage/routes-of-administration`, currently lines ~474-488). Greenfield: nothing links to them.
5. Beside the space-level `help/markers` route (currently line ~231, a direct child of `s/:spaceId`), add two routes:

```ts
{
  path: 'help/taxonomies',
  loadComponent: () =>
    import('./features/help/taxonomies-help.component').then((m) => m.TaxonomiesHelpComponent),
},
{
  // Space-level alias so the Reference nav group (space-relative links) can reach
  // the phases guide. The tenant-level help/phases route stays for the dashboard legend.
  path: 'help/phases',
  loadComponent: () =>
    import('./features/help/phases-help.component').then((m) => m.PhasesHelpComponent),
},
```

(`TaxonomiesHelpComponent` is created in Task 8. If executing strictly in order, add the `help/phases` alias now and add the `help/taxonomies` route block in Task 8; or stub the import and let Task 8 fill the component. Recommended: do Task 8 before running the full build at the end of Task 1.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd src/client && npx vitest run src/app/app.routes.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/app.routes.ts src/client/src/app/app.routes.spec.ts
git commit -m "feat(profiles): rename /manage routes to /profiles; relocate editGuard to reference settings"
```

---

### Task 2: `sidebar-nav.ts` -- rename section, add `editorOnly`, add Reference group, rewrite `filterNavSections`

**Files:**
- Modify: `src/client/src/app/core/layout/sidebar-nav.ts`
- Test: `src/client/src/app/core/layout/sidebar-nav.spec.ts`

**Interfaces:**
- Produces: `SidebarSectionId` now `'landscape' | 'intelligence' | 'profiles' | 'settings' | 'reference'`. Consumed by `app-shell.component.ts` (Task 3) and `icon-rail.component.ts` (Task 4), which must keep their `Section` unions in sync.
- `NavItem` gains `editorOnly?: boolean`.
- `filterNavSections(sections, canEdit, isOwner)` signature unchanged.

- [ ] **Step 1: Write the failing test** -- replace the role-filtering assertions in `sidebar-nav.spec.ts` (keep existing import style; add these cases):

```ts
import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, filterNavSections } from './sidebar-nav';

const ids = (sections: ReturnType<typeof filterNavSections>) => sections.map((s) => s.id);
const settingsItems = (sections: ReturnType<typeof filterNavSections>) =>
  sections.find((s) => s.id === 'settings')?.items.map((i) => i.route) ?? [];

describe('filterNavSections role gating', () => {
  it('viewer: keeps profiles + reference, drops settings entirely', () => {
    const out = filterNavSections(NAV_SECTIONS, false, false);
    expect(ids(out)).toContain('profiles');
    expect(ids(out)).toContain('reference');
    expect(ids(out)).not.toContain('settings');
  });

  it('editor: keeps profiles + reference + taxonomies/marker-types settings, no owner items', () => {
    const out = filterNavSections(NAV_SECTIONS, true, false);
    expect(ids(out)).toContain('profiles');
    expect(settingsItems(out)).toEqual(['settings/taxonomies', 'settings/marker-types']);
  });

  it('owner: keeps everything', () => {
    const out = filterNavSections(NAV_SECTIONS, true, true);
    expect(settingsItems(out)).toEqual(
      expect.arrayContaining([
        'settings/general',
        'settings/members',
        'settings/fields',
        'settings/taxonomies',
        'settings/marker-types',
        'settings/audit-log',
      ])
    );
  });

  it('reference group is visible to all roles', () => {
    for (const [canEdit, isOwner] of [[false, false], [true, false], [true, true]] as const) {
      expect(ids(filterNavSections(NAV_SECTIONS, canEdit, isOwner))).toContain('reference');
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd src/client && npx vitest run src/app/core/layout/sidebar-nav.spec.ts`
Expected: FAIL (`'manage'` still present, no `reference`, settings not dropped for viewer).

- [ ] **Step 3: Edit `sidebar-nav.ts`**:

Update the union (line 8):

```ts
export type SidebarSectionId =
  | 'landscape'
  | 'intelligence'
  | 'profiles'
  | 'settings'
  | 'reference';
```

Add `editorOnly` to `NavItem` (after the `ownerOnly` doc block):

```ts
  /**
   * When true, the item is hidden from non-editors (viewers). Used for the
   * reference-settings management pages (Taxonomies, Marker Types); the route
   * is also guarded by `editGuard` so a deep-link is denied too. Viewers get
   * the read-only guides in the Reference group instead.
   */
  editorOnly?: boolean;
```

Rename the `manage` section block (lines 64-72) to `profiles`:

```ts
  {
    id: 'profiles',
    label: 'Profiles',
    items: [
      { label: 'Companies', route: 'profiles/companies', icon: NAV_ICONS['companies'] },
      { label: 'Assets', route: 'profiles/assets', icon: NAV_ICONS['assets'] },
      { label: 'Trials', route: 'profiles/trials', icon: NAV_ICONS['trials'] },
    ],
  },
```

Update the Intelligence section's Engagement route (line 54): `route: 'manage/engagement'` -> `route: 'profiles/engagement'`.

In the Settings section, mark the two reference-settings items `editorOnly` and drop the stale comment (lines 81-83):

```ts
      { label: 'Taxonomies', route: 'settings/taxonomies', icon: NAV_ICONS['taxonomies'], editorOnly: true },
      { label: 'Marker Types', route: 'settings/marker-types', icon: NAV_ICONS['marker-types'], editorOnly: true },
```

Add a new Reference section at the end of `NAV_SECTIONS` (after the settings block), visible to all roles:

```ts
  {
    id: 'reference',
    label: 'Reference',
    bottom: true,
    items: [
      { label: 'Taxonomies guide', route: 'help/taxonomies', icon: NAV_ICONS['taxonomies'] },
      { label: 'Markers guide', route: 'help/markers', icon: NAV_ICONS['marker-types'] },
      { label: 'Phases guide', route: 'help/phases', icon: NAV_ICONS['phases'] },
    ],
  },
```

Rewrite `filterNavSections` (lines 96-118) so Profiles is never dropped, `editorOnly` items are dropped for non-editors, `ownerOnly` for non-owners, and empty sections fall away:

```ts
/**
 * Filter the nav sections for the current space role. Pure (no Angular deps)
 * so it can be unit-tested directly:
 * - `ownerOnly` items (General, Members, Fields, Audit log) drop for non-owners,
 * - `editorOnly` items (Taxonomies / Marker Types management) drop for viewers,
 * - the Profiles and Reference sections carry no flags, so they survive for all
 *   roles. A section left with no items is dropped.
 */
export function filterNavSections(
  sections: NavSection[],
  canEdit: boolean,
  isOwner: boolean
): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => (isOwner || !item.ownerOnly) && (canEdit || !item.editorOnly)
      ),
    }))
    .filter((section) => section.items.length > 0);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd src/client && npx vitest run src/app/core/layout/sidebar-nav.spec.ts`
Expected: PASS. (If the existing spec asserted the old `manage`-drop behavior, update those obsolete cases now.)

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/layout/sidebar-nav.ts src/client/src/app/core/layout/sidebar-nav.spec.ts
git commit -m "feat(profiles): Profiles+Reference nav, editorOnly gate, viewer-visible browse"
```

---

### Task 3: `app-shell.component.ts` -- sync Section union, rename `manage` -> `profiles`, add `reference`

**Files:**
- Modify: `src/client/src/app/core/layout/app-shell.component.ts`
- Test: `src/client/src/app/core/layout/app-shell.component.spec.ts` (add a focused `activeSection` case if a spec harness exists; otherwise rely on Task 1 + lint/build)

**Interfaces:**
- Consumes the route strings from Task 1 and the `SidebarSectionId` union from Task 2.

- [ ] **Step 1: Edit the Section union** (line 42):

```ts
type Section = 'landscape' | 'intelligence' | 'profiles' | 'settings' | 'reference';
```

- [ ] **Step 2: Update `activeSection()`** (lines 466-477). Replace the `manage` mappings:

```ts
    if (route === 'profiles/engagement') return 'intelligence';
    if (route.startsWith('profiles/')) return 'profiles';
    if (route.startsWith('settings/')) return 'settings';
    if (route.startsWith('help/')) return 'reference';
```

(Add the `help/` -> `reference` line so the Reference guides light the correct rail icon. Keep the existing `events`/`intelligence`/`materials` and `catalysts` lines.)

- [ ] **Step 3: Update `pageType()`** (line ~498): change `route.startsWith('manage/')` -> `route.startsWith('profiles/')`.

- [ ] **Step 4: Update the topbar section label map** (lines 511-517): rename the `manage: 'Manage'` key to `profiles: 'Profiles'` and add `reference: 'Reference'`. The `Record<Section, ...>` must cover every union member.

- [ ] **Step 5: Update the section-tabs `switch`** (lines 522-617): rename `case 'manage':` -> `case 'profiles':`; inside it change the three tab `value`/`active` route strings `manage/companies|assets|trials` -> `profiles/companies|assets|trials`. In the `intelligence` case, change `value: 'manage/engagement'` and `active: route === 'manage/engagement'` -> `profiles/engagement`. The `reference` section has no landscape tabs (guides are not landscape pages), so no case needed; `sectionTabs()` returns `[]` for it.

- [ ] **Step 6: Update `topbarListTitle()` map** (lines 618-620):

```ts
      'profiles/companies': 'Companies',
      'profiles/assets': 'Assets',
      'profiles/trials': 'Trials',
```

- [ ] **Step 7: Update `onSectionClick` defaultRoutes** (lines 716-722): rename `manage: 'manage/companies'` -> `profiles: 'profiles/companies'`, and add `reference: 'help/taxonomies'` so the Reference rail icon opens the taxonomies guide. Cover every Section key.

- [ ] **Step 8: Update `onSectionTabClick`** (lines 737-763): rename `case 'manage':` -> `case 'profiles':` and `this.navigateToSpaceRoute(`manage/${tab}`)` -> `` `profiles/${tab}` ``.

- [ ] **Step 9: Update the stray fallback** at line ~771 (`this.navigateToSpaceRoute('manage/trials')`) -> `'profiles/trials'`.

- [ ] **Step 10: Verify no `manage` literals remain** in this file:

Run: `cd src/client && grep -n "manage" src/app/core/layout/app-shell.component.ts`
Expected: no matches (or only unrelated words; there should be none).

- [ ] **Step 11: Build + commit**

```bash
cd src/client && ng lint && ng build
git add src/client/src/app/core/layout/app-shell.component.ts
git commit -m "feat(profiles): wire app-shell sections to Profiles + Reference"
```

---

### Task 4: `icon-rail.component.ts` -- sync Section union and rail entries

**Files:**
- Modify: `src/client/src/app/core/layout/icon-rail.component.ts`

- [ ] **Step 1: Edit the Section type** (line 5):

```ts
type Section = 'landscape' | 'intelligence' | 'profiles' | 'settings' | 'reference';
```

- [ ] **Step 2: Edit `allSections`** (lines 241-246):

```ts
  readonly allSections: NavSection[] = [
    { id: 'landscape', label: 'Landscape' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'profiles', label: 'Profiles' },
    { id: 'reference', label: 'Reference' },
    { id: 'settings', label: 'Settings' },
  ];
```

(`sectionIcon()` reads `NAV_ICONS[sectionId]`, so the `profiles` and `reference` icon keys added in Task 5 cover the rail glyphs. The `hasSpace()` filter keeps only `settings` when there is no space; reference/profiles correctly hide off-space.)

- [ ] **Step 3: Build + commit**

```bash
cd src/client && ng build
git add src/client/src/app/core/layout/icon-rail.component.ts
git commit -m "feat(profiles): icon-rail Profiles + Reference sections"
```

---

### Task 5: `nav-icons.ts` -- add `profiles`, `reference`, `phases` icon keys

**Files:**
- Modify: `src/client/src/app/shared/constants/nav-icons.ts`

- [ ] **Step 1: Edit the Sections block.** Rename `manage` -> `profiles` and add `reference`:

```ts
  // Sections (icon rail)
  landscape: 'fa-solid fa-chart-line',
  intelligence: 'fa-solid fa-star',
  profiles: 'fa-solid fa-id-card',
  reference: 'fa-solid fa-book',
  settings: 'fa-solid fa-gear',
```

- [ ] **Step 2: Add a `phases` key** (Reference group "Phases guide" item) near the settings page icons:

```ts
  phases: 'fa-solid fa-layer-group',
```

- [ ] **Step 3: Grep for any remaining `NAV_ICONS['manage']` usage** across the app:

Run: `cd src/client && grep -rn "NAV_ICONS\['manage'\]\|NAV_ICONS\[\"manage\"\]" src/app`
Expected: no matches. (Engagement uses `NAV_ICONS['engagement']`, unaffected.)

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/constants/nav-icons.ts
git commit -m "feat(profiles): profiles/reference/phases nav icons"
```

---

### Task 6: User-facing copy + comments referencing "Manage"

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape.component.html` (the `label="Manage assets"` CTA)
- Modify: `src/client/src/app/features/manage/trials/trial-edit-form.component.ts` (comments)

- [ ] **Step 1: Find the CTA** and surrounding context:

Run: `cd src/client && grep -n "Manage assets" src/app/features/landscape/landscape.component.html`

- [ ] **Step 2: Reword to browse intent.** Change the button label `Manage assets` -> `View assets` (imperative, browse-oriented, role-neutral; the bullseye empty state now applies to viewers too). If the button routes via a handler, repoint it at `profiles/assets`.

- [ ] **Step 3: Update stale comments** in `trial-edit-form.component.ts` that say "the Manage dialog" / "Manage CREATE dialog" -> "the Profiles trial dialog" etc. Comment-only; no behavior change.

- [ ] **Step 4: Sweep for any other user-facing "Manage" strings** introduced by the section:

Run: `cd src/client && grep -rn "Manage" src/app --include=*.html --include=*.ts | grep -iv "management\|manager\|// " | grep -i manage`
Expected: review each hit; rename only the ones that name the renamed section. Leave unrelated words (e.g. "Members management") alone.

- [ ] **Step 5: Commit**

```bash
git add -A src/client/src/app/features/landscape src/client/src/app/features/manage/trials/trial-edit-form.component.ts
git commit -m "feat(profiles): browse-oriented copy for the Profiles section"
```

---

### Task 7: Update specs/tests/e2e that assert `/manage` URLs

**Files:**
- Modify: any spec/e2e referencing `manage/` route strings (discover below).

- [ ] **Step 1: Discover references**

Run: `cd src/client && grep -rn "manage/companies\|manage/assets\|manage/trials\|manage/engagement" src e2e`

- [ ] **Step 2: Update each** to the `profiles/...` equivalent. For e2e specs (Playwright), update navigation URLs and any role-based visibility assertions: a viewer should now SEE the Profiles nav section and NOT see Add/Edit/Delete controls.

- [ ] **Step 3: Run unit tests**

Run: `cd src/client && npm run test:units`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A src/client/src src/client/e2e
git commit -m "test(profiles): update route assertions to /profiles"
```

---

### Task 8: New `taxonomies-help` guide page (live-rendered)

**Files:**
- Create: `src/client/src/app/features/help/taxonomies-help.component.ts`
- Create: `src/client/src/app/features/help/taxonomies-help.component.spec.ts`
- Confirm: the `help/taxonomies` route from Task 1 imports `TaxonomiesHelpComponent`.

**Interfaces:**
- Consumes: `IndicationService.list(spaceId)`, `MechanismOfActionService.list(spaceId)`, `RouteOfAdministrationService.list(spaceId)` (all return cached arrays; row shapes: Indication `{ name, abbreviation, display_order }`, MoA `{ name, description, display_order }`, RoA `{ name, abbreviation, display_order }`).
- Produces: `TaxonomiesHelpComponent` (the class name the route imports).
- Models on `markers-help.component.ts` (header + summary + tables + FAQ + back link, wrapped in `ManagePageShellComponent`, agency-aware copy via `BrandContextService`).

- [ ] **Step 1: Confirm service APIs**

Run: `cd src/client && grep -n "list(" src/app/core/services/indication.service.ts src/app/core/services/mechanism-of-action.service.ts src/app/core/services/route-of-administration.service.ts`
Note the exact method signature and row interface names for the imports below. The landscape filter bar uses `TherapeuticAreaService`; verify whether indications and therapeutic areas are the same table or a grouping, and label the first guide section to match the filter label viewers actually see (per the taxonomies spec naming-check).

- [ ] **Step 2: Write the failing render spec** (`taxonomies-help.component.spec.ts`)

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TaxonomiesHelpComponent } from './taxonomies-help.component';
import { IndicationService } from '../../core/services/indication.service';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';

describe('TaxonomiesHelpComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TaxonomiesHelpComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['spaceId', 's1'], ['tenantId', 't1']]) } } },
        { provide: IndicationService, useValue: { list: vi.fn().mockResolvedValue([{ name: 'NSCLC', abbreviation: 'NSCLC', display_order: 1 }]) } },
        { provide: MechanismOfActionService, useValue: { list: vi.fn().mockResolvedValue([{ name: 'EGFR inhibitor', description: 'x', display_order: 1 }]) } },
        { provide: RouteOfAdministrationService, useValue: { list: vi.fn().mockResolvedValue([{ name: 'Oral', abbreviation: 'PO', display_order: 1 }]) } },
      ],
    });
  });

  it('live-renders the three vocab tables after init', async () => {
    const fixture = TestBed.createComponent(TaxonomiesHelpComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('NSCLC');
    expect(text).toContain('EGFR inhibitor');
    expect(text).toContain('Oral');
  });
});
```

Note: `ActivatedRoute.snapshot.paramMap` in the real app is an Angular `ParamMap`, not a `Map`. If the component calls `.get(...)` only, the `Map` stub above suffices; if it calls `paramMap` helper methods, build a real `convertToParamMap({...})` from `@angular/router` instead. Adjust the stub to match the component's actual access pattern after Step 3.

- [ ] **Step 3: Run the test, verify it fails**

Run: `cd src/client && npx vitest run src/app/features/help/taxonomies-help.component.spec.ts`
Expected: FAIL (component does not exist).

- [ ] **Step 4: Implement `taxonomies-help.component.ts`** modeled on `markers-help`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { IndicationService } from '../../core/services/indication.service';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';

interface VocabRow {
  name: string;
  detail: string | null;
}

@Component({
  selector: 'app-taxonomies-help',
  standalone: true,
  imports: [RouterLink, ManagePageShellComponent, LoaderComponent],
  template: `
    <app-manage-page-shell>
      <div class="max-w-3xl">
        <header class="mb-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Help</p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Taxonomies and how they organize the landscape
          </h1>
          <p class="mt-1 max-w-xl text-sm text-slate-500">
            Taxonomies are the controlled vocabularies {{ analystSubject() }} use to tag assets and
            trials and to drive the landscape filters: therapeutic area / indication, mechanism of
            action, and route of administration. The tables below show the vocabulary set up for
            this space.
          </p>
        </header>

        @if (loading()) {
          <app-loader [size]="20" label="Loading taxonomies" />
        } @else {
          @for (group of groups(); track group.heading) {
            <section class="mb-8">
              <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {{ group.heading }}
              </h2>
              @if (group.rows.length === 0) {
                <p class="text-sm text-slate-500">{{ group.empty }}</p>
              } @else {
                <div class="border border-slate-200 bg-white">
                  @for (row of group.rows; track row.name) {
                    <div class="grid grid-cols-[12rem_1fr] gap-4 border-b border-slate-100 px-5 py-3 last:border-b-0">
                      <div class="text-sm font-medium text-slate-900">{{ row.name }}</div>
                      <div class="text-sm text-slate-600">{{ row.detail }}</div>
                    </div>
                  }
                </div>
              }
            </section>
          }
        }

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            How these are used
          </h2>
          <p class="text-sm text-slate-600">
            These vocabularies populate the landscape filter bar. Filtering by mechanism of action,
            route of administration, or therapeutic area narrows every chart to the assets and
            trials tagged with that value.
          </p>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Common questions
          </h2>
          <div class="space-y-5">
            @for (entry of faq(); track entry.q) {
              <div>
                <p class="text-sm font-semibold text-slate-900">{{ entry.q }}</p>
                <p class="mt-1 text-sm text-slate-600">{{ entry.a }}</p>
              </div>
            }
          </div>
        </section>

        <p class="mt-8 text-xs text-slate-400">
          <a [routerLink]="backLink()" class="text-brand-700 hover:underline">Back to timeline</a>
        </p>
      </div>
    </app-manage-page-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxonomiesHelpComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly indications = inject(IndicationService);
  private readonly moa = inject(MechanismOfActionService);
  private readonly roa = inject(RouteOfAdministrationService);
  private readonly brand = inject(BrandContextService);

  protected readonly loading = signal(true);
  private readonly indicationRows = signal<VocabRow[]>([]);
  private readonly moaRows = signal<VocabRow[]>([]);
  private readonly roaRows = signal<VocabRow[]>([]);

  protected readonly analystActor = computed(() => this.brand.agency()?.name ?? 'the analyst');
  protected readonly analystSubject = computed(() => this.brand.agency()?.name ?? 'analysts');

  protected readonly groups = computed(() => [
    {
      heading: 'Therapeutic areas / Indications',
      rows: this.indicationRows(),
      empty: 'No indications configured for this space yet.',
    },
    {
      heading: 'Mechanisms of action (MoA)',
      rows: this.moaRows(),
      empty: 'No mechanisms of action configured for this space yet.',
    },
    {
      heading: 'Routes of administration (RoA)',
      rows: this.roaRows(),
      empty: 'No routes of administration configured for this space yet.',
    },
  ]);

  protected readonly faq = computed(() => {
    const actor = this.analystActor();
    return [
      {
        q: 'Where do these values come from?',
        a: `Taxonomies are curated per space. ${actor} maintains them from Settings > Taxonomies; the landscape filters read the same lists.`,
      },
      {
        q: 'Can I edit a taxonomy?',
        a: 'Space editors and owners manage taxonomies from Settings > Taxonomies. Viewers see this read-only guide.',
      },
    ];
  });

  async ngOnInit(): Promise<void> {
    const spaceId = this.route.snapshot.paramMap.get('spaceId') ?? undefined;
    const order = (a: { display_order: number }, b: { display_order: number }) =>
      a.display_order - b.display_order;
    try {
      const [inds, moas, roas] = await Promise.all([
        this.indications.list(spaceId),
        this.moa.list(spaceId),
        this.roa.list(spaceId),
      ]);
      this.indicationRows.set(
        [...inds].sort(order).map((r) => ({ name: r.name, detail: r.abbreviation ?? null }))
      );
      this.moaRows.set(
        [...moas].sort(order).map((r) => ({ name: r.name, detail: r.description ?? null }))
      );
      this.roaRows.set(
        [...roas].sort(order).map((r) => ({ name: r.name, detail: r.abbreviation ?? null }))
      );
    } catch {
      this.indicationRows.set([]);
      this.moaRows.set([]);
      this.roaRows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected backLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    const spaceId = this.route.snapshot.paramMap.get('spaceId');
    if (tenantId && spaceId) return ['/t', tenantId, 's', spaceId, 'timeline'];
    if (tenantId) return ['/t', tenantId, 'spaces'];
    return ['/'];
  }
}
```

Adjust the three service `list()` calls and row property names to the exact signatures confirmed in Step 1 (e.g. if a service returns an Observable, `await firstValueFrom(...)` or call the cached array accessor the others use). Keep lint clean.

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd src/client && npx vitest run src/app/features/help/taxonomies-help.component.spec.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the route loads it.** Ensure Task 1's `help/taxonomies` route imports `TaxonomiesHelpComponent`.

- [ ] **Step 7: Build + commit**

```bash
cd src/client && ng lint && ng build
git add src/client/src/app/features/help/taxonomies-help.component.ts src/client/src/app/features/help/taxonomies-help.component.spec.ts
git commit -m "feat(reference): live-rendered Taxonomies guide for viewers"
```

---

### Task 9: Drift guard + help-page link affordance

**Files:**
- Modify: `.claude/hooks/runbook-review-guard.sh` (the `helpRules` map)
- Modify: the taxonomies settings page (`src/client/src/app/features/manage/taxonomies/taxonomies-page.component.*`) to add an inline uppercase-tracked link to `help/taxonomies` (matching how the dashboard legend links to `help/markers`), so editors/owners can reach the guide and the affordance exists.

- [ ] **Step 1: Extend `helpRules`.** Add a rule mapping changes in `indications`, `mechanisms_of_action`, `routes_of_administration` (migrations or the three services) to flag `taxonomies-help` for editorial review, mirroring the existing markers/phases entries. Inspect the current map first:

Run: `grep -n "helpRules\|markers-help\|phases-help" .claude/hooks/runbook-review-guard.sh`

Add the analogous entry following the file's existing rule shape.

- [ ] **Step 2: Add the inline guide link** on the taxonomies settings page header, short and uppercase-tracked (per CLAUDE.md "In-app Help Pages"), e.g. a `routerLink` to `help/taxonomies` reading "TAXONOMIES GUIDE". Match the markers legend link styling.

- [ ] **Step 3: Build + commit**

```bash
cd src/client && ng build
git add .claude/hooks/runbook-review-guard.sh src/client/src/app/features/manage/taxonomies
git commit -m "feat(reference): drift guard + inline guide link for taxonomies"
```

---

### Task 10: Docs + runbook + architecture regen

**Files:**
- Modify: any runbook/help docs naming the "Manage" area (discover below).
- Regen: `docs/runbook/*` auto-gen blocks via `npm run docs:arch`.

- [ ] **Step 1: Find runbook references**

Run: `grep -rn "Manage" docs/runbook | grep -iv management`
Update prose that names the renamed section to "Profiles"; note the viewer-visible browse + Reference group where the runbook describes the role model (`08-authentication-security.md`, `05-frontend-architecture.md`).

- [ ] **Step 2: Regenerate architecture docs** (routes changed):

Run: `cd src/client && npm run docs:arch`
Requires local Supabase running (`supabase start`). If the shared local DB is mid-reset by another session, wait or run after. Commit the regen.

- [ ] **Step 3: Full verification**

Run: `cd src/client && ng lint && ng build && npm run test:units`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A docs/runbook docs/superpowers
git commit -m "docs(profiles): runbook + architecture regen for Profiles/Reference"
```

---

## Self-Review

**Spec coverage (profiles spec):** rename Manage->Profiles (Tasks 2,3,4,5), routes /manage->/profiles (Task 1), drop editGuard so viewers browse (Task 1), edit controls already gated (verified, no task needed), engagement -> /profiles/engagement (Tasks 1,2,3), CTA copy (Task 6), tests/comments/docs (Tasks 7,10). Covered.

**Spec coverage (taxonomies spec):** taxonomies-help page (Task 8), Reference nav group (Task 2), space-level help/phases alias (Task 1), editorOnly flag + filterNavSections (Task 2), gate taxonomies/marker-types settings (Task 1, via reused editGuard), drift guard + tests (Tasks 8,9). Deviation: reuse `editGuard` instead of new `spaceEditorGuard` (Global Constraints + Task 1) -- editGuard already gates owner/editor; denial redirects to space root rather than the guide (acceptable, nav item is hidden). Covered.

**Placeholder scan:** no TBD/TODO; new component and filterNavSections shown in full; mechanical renames give exact literals and line anchors.

**Type consistency:** `SidebarSectionId` (sidebar-nav), `Section` (app-shell), `Section` (icon-rail) all updated to the same five-member union: `landscape | intelligence | profiles | settings | reference`. `TaxonomiesHelpComponent` class name matches the Task 1 route import. `editGuard` is the existing export reused in Task 1.

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** -- fresh subagent per task, review between tasks. Note: subagents must be anchored to the worktree (`cd /Users/aadityamadala/Documents/code/clint-v2/.claude/worktrees/profiles-reference-viewer-model && pwd` first) since they default to the host repo.
2. **Inline Execution** -- execute here with checkpoints.
