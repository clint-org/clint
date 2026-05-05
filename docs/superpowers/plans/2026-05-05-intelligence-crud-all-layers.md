# Intelligence CRUD at All Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add detail pages and add / edit / delete affordances for primary intelligence on the four entity layers that don't have them today (company, product, marker, engagement). Wire entry points and add a delete control that also closes the gap on trial intelligence.

**Architecture:** Reuse the existing entity-agnostic `IntelligenceBlock`, `IntelligenceEmpty`, and `IntelligenceDrawer` components on four new detail pages. Extract a pure `buildEntityRouterLink` helper and use it from both the intelligence feed and the block's link-chip resolver. Add a `Delete` output to `IntelligenceBlock` with a `p-confirmDialog` confirmation.

**Tech Stack:** Angular 19 standalone components, signals, PrimeNG (`Button`, `Dialog`, `ConfirmDialog`), Tailwind v4, Supabase RPCs, Playwright for unit tests (`npm run test:unit`) and e2e (`./e2e/run.sh`).

**Spec:** `docs/superpowers/specs/2026-05-05-intelligence-crud-all-layers-design.md`

---

## File Structure

**New files (this plan creates):**

| Path | Responsibility |
|---|---|
| `src/client/src/app/shared/utils/intelligence-router-link.ts` | Pure `buildEntityRouterLink(t, s, entityType, entityId)` helper |
| `src/client/src/app/shared/utils/intelligence-router-link.spec.ts` | Unit test for the helper |
| `src/client/src/app/core/services/primary-intelligence.service.spec.ts` | RPC contract tests for `upsert` and `delete` |
| `src/client/src/app/features/manage/companies/company-detail.component.ts` | Company detail page (logic) |
| `src/client/src/app/features/manage/companies/company-detail.component.html` | Company detail page (template) |
| `src/client/src/app/features/manage/products/product-detail.component.ts` | Product detail page (logic) |
| `src/client/src/app/features/manage/products/product-detail.component.html` | Product detail page (template) |
| `src/client/src/app/features/manage/markers/marker-detail.component.ts` | Marker detail page (logic) |
| `src/client/src/app/features/manage/markers/marker-detail.component.html` | Marker detail page (template) |
| `src/client/src/app/features/manage/engagement/engagement-detail.component.ts` | Engagement detail page (logic) |
| `src/client/src/app/features/manage/engagement/engagement-detail.component.html` | Engagement detail page (template) |
| `src/client/e2e/tests/intelligence-crud.spec.ts` | End-to-end add / edit / delete loop on a company |

**Existing files modified:**

| Path | Change |
|---|---|
| `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts` | Add `delete` output; replace `linkRoute` with helper |
| `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html` | Add Delete button + ConfirmDialog |
| `src/client/src/app/shared/components/intelligence-feed/intelligence-feed.component.ts` | Replace `entityRouterLink` with helper |
| `src/client/src/app/core/services/marker.service.ts` | Add `getById(id)` |
| `src/client/src/app/app.routes.ts` | Add 4 new routes |
| `src/client/src/app/features/manage/trials/trial-detail.component.ts` | Wire `(delete)` from block |
| `src/client/src/app/features/manage/trials/trial-detail.component.html` | Wire `(delete)`; wrap marker title in router link |
| `src/client/src/app/features/manage/companies/company-list.component.html` | Wrap company name in router link |
| `src/client/src/app/features/manage/products/product-list.component.html` | Wrap product name in router link |
| `src/client/src/app/core/layout/sidebar.component.ts` | Add Engagement nav entry |

---

## Task 1: Pure router-link helper + unit test

**Files:**
- Create: `src/client/src/app/shared/utils/intelligence-router-link.ts`
- Test: `src/client/src/app/shared/utils/intelligence-router-link.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/shared/utils/intelligence-router-link.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { buildEntityRouterLink } from './intelligence-router-link';

const T = 'tenant-1';
const S = 'space-1';

test.describe('buildEntityRouterLink', () => {
  test('routes a trial to the trial detail page', () => {
    expect(buildEntityRouterLink(T, S, 'trial', 'trial-1')).toEqual([
      '/t', T, 's', S, 'manage', 'trials', 'trial-1',
    ]);
  });

  test('routes a company to the company detail page', () => {
    expect(buildEntityRouterLink(T, S, 'company', 'co-1')).toEqual([
      '/t', T, 's', S, 'manage', 'companies', 'co-1',
    ]);
  });

  test('routes a product to the product detail page', () => {
    expect(buildEntityRouterLink(T, S, 'product', 'prod-1')).toEqual([
      '/t', T, 's', S, 'manage', 'products', 'prod-1',
    ]);
  });

  test('routes a marker to the marker detail page', () => {
    expect(buildEntityRouterLink(T, S, 'marker', 'm-1')).toEqual([
      '/t', T, 's', S, 'manage', 'markers', 'm-1',
    ]);
  });

  test('routes a space (engagement) to the engagement page (no id segment)', () => {
    expect(buildEntityRouterLink(T, S, 'space', 'ignored')).toEqual([
      '/t', T, 's', S, 'manage', 'engagement',
    ]);
  });

  test('returns null when tenant or space is missing', () => {
    expect(buildEntityRouterLink(null, S, 'trial', 'x')).toBeNull();
    expect(buildEntityRouterLink(T, null, 'trial', 'x')).toBeNull();
    expect(buildEntityRouterLink('', S, 'trial', 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:unit -- intelligence-router-link`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Implement the helper**

Create `src/client/src/app/shared/utils/intelligence-router-link.ts`:

```ts
import { IntelligenceEntityType } from '../../core/models/primary-intelligence.model';

/**
 * Builds the router-link command array for an intelligence entity.
 * Returns null when tenant or space is missing so callers can render a
 * non-anchor fallback. Engagement (space) is a singleton per space and
 * therefore has no id segment.
 */
export function buildEntityRouterLink(
  tenantId: string | null,
  spaceId: string | null,
  entityType: IntelligenceEntityType,
  entityId: string
): unknown[] | null {
  if (!tenantId || !spaceId) return null;
  const base = ['/t', tenantId, 's', spaceId, 'manage'];
  switch (entityType) {
    case 'trial':   return [...base, 'trials', entityId];
    case 'company': return [...base, 'companies', entityId];
    case 'product': return [...base, 'products', entityId];
    case 'marker':  return [...base, 'markers', entityId];
    case 'space':   return [...base, 'engagement'];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:unit -- intelligence-router-link`
Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/utils/intelligence-router-link.ts src/client/src/app/shared/utils/intelligence-router-link.spec.ts
git commit -m "feat(intelligence): pure router-link helper for all entity types"
```

---

## Task 2: Service contract spec for upsert + delete

**Files:**
- Test: `src/client/src/app/core/services/primary-intelligence.service.spec.ts`

The service is already implemented; this spec pins the RPC contract so future refactors can't silently rename params.

- [ ] **Step 1: Write the test**

Create `src/client/src/app/core/services/primary-intelligence.service.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { PrimaryIntelligenceService } from './primary-intelligence.service';

interface RpcCall { name: string; params: Record<string, unknown>; }

function makeService(): { svc: PrimaryIntelligenceService; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const fakeClient = {
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return Promise.resolve({ data: 'rpc-result-id', error: null });
    },
  };
  const svc = new PrimaryIntelligenceService();
  // Reach in to swap the supabase boundary. The service holds a single
  // private `supabase` field with a `client` getter.
  (svc as unknown as { supabase: { client: unknown } }).supabase = { client: fakeClient };
  return { svc, calls };
}

test.describe('PrimaryIntelligenceService.upsert', () => {
  test('calls upsert_primary_intelligence with named params', async () => {
    const { svc, calls } = makeService();
    await svc.upsert({
      id: null,
      space_id: 'space-1',
      entity_type: 'company',
      entity_id: 'co-1',
      headline: 'Headline',
      thesis_md: 'Thesis',
      watch_md: 'Watch',
      implications_md: 'Implications',
      state: 'draft',
      change_note: null,
      links: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('upsert_primary_intelligence');
    expect(calls[0].params).toMatchObject({
      p_id: null,
      p_space_id: 'space-1',
      p_entity_type: 'company',
      p_entity_id: 'co-1',
      p_headline: 'Headline',
      p_thesis_md: 'Thesis',
      p_watch_md: 'Watch',
      p_implications_md: 'Implications',
      p_state: 'draft',
      p_change_note: null,
    });
  });
});

test.describe('PrimaryIntelligenceService.delete', () => {
  test('calls delete_primary_intelligence with p_id', async () => {
    const { svc, calls } = makeService();
    await svc.delete('intel-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('delete_primary_intelligence');
    expect(calls[0].params).toEqual({ p_id: 'intel-1' });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd src/client && npm run test:unit -- primary-intelligence.service`
Expected: 2 passing tests (the service is already implemented).

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/primary-intelligence.service.spec.ts
git commit -m "test(intelligence): pin upsert and delete RPC contracts"
```

---

## Task 3: Add Delete output to IntelligenceBlock

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts`
- Modify: `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html`

- [ ] **Step 1: Add `delete` output and surface a current-id signal**

Edit `intelligence-block.component.ts`. Add the import for `ConfirmDialog` is **not** needed in the block; the dialog is rendered by the host page. The block emits an event and the host runs the confirm. Update the imports and outputs:

```ts
// Existing line:
//   readonly edit = output<void>();
// After it, add:
  readonly deleted = output<void>();
```

Inside the component class (right under `edit`), add:

```ts
  protected onDeleteClick(): void {
    this.deleted.emit();
  }
```

Why an event rather than the dialog inline: the block is a presenter that should not own confirmation flow or service calls. Hosts already own the intelligence service; they should also own delete confirmation.

- [ ] **Step 2: Add the Delete button to the template**

Edit `intelligence-block.component.html`. Find the existing Edit button (around line 38-46):

```html
      @if (agencyView()) {
        <p-button
          label="Edit"
          icon="fa-solid fa-pen"
          [text]="true"
          size="small"
          (onClick)="edit.emit()"
        />
      }
```

Replace with:

```html
      @if (agencyView()) {
        <div class="flex items-center gap-1">
          <p-button
            label="Edit"
            icon="fa-solid fa-pen"
            [text]="true"
            size="small"
            (onClick)="edit.emit()"
          />
          <p-button
            label="Delete"
            icon="fa-solid fa-trash"
            [text]="true"
            severity="danger"
            size="small"
            (onClick)="onDeleteClick()"
          />
        </div>
      }
```

- [ ] **Step 3: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts src/client/src/app/shared/components/intelligence-block/intelligence-block.component.html
git commit -m "feat(intelligence): add Delete output to IntelligenceBlock"
```

---

## Task 4: Wire delete on trial-detail (closes existing gap)

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Add the confirm-and-delete handler in the component**

Edit `trial-detail.component.ts`. The component already injects `ConfirmationService` (line 83) and `PrimaryIntelligenceService` (line 81). Add a handler near the existing `onIntelligenceEdit` / `onIntelligenceClosed` / `onIntelligencePublished` methods (around line 421):

```ts
  onIntelligenceDelete(): void {
    const i = this.intelligence();
    const id = i?.published?.record.id ?? i?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete primary intelligence?',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Primary intelligence removed.',
          });
          await this.loadIntelligence();
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: (err as Error).message,
          });
        }
      },
    });
  }
```

- [ ] **Step 2: Bind the (deleted) output in the template**

Edit `trial-detail.component.html`. Find the `<app-intelligence-block>` (around line 107-114):

```html
          <app-intelligence-block
            [published]="intelligence()?.published ?? null"
            [draft]="intelligence()?.draft ?? null"
            [agencyView]="spaceRole.canEdit()"
            [tenantId]="tenantIdSig()"
            [spaceId]="spaceIdSig()"
            (edit)="onIntelligenceEdit()"
          />
```

Add the `(deleted)` binding so it reads:

```html
          <app-intelligence-block
            [published]="intelligence()?.published ?? null"
            [draft]="intelligence()?.draft ?? null"
            [agencyView]="spaceRole.canEdit()"
            [tenantId]="tenantIdSig()"
            [spaceId]="spaceIdSig()"
            (edit)="onIntelligenceEdit()"
            (deleted)="onIntelligenceDelete()"
          />
```

- [ ] **Step 3: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.ts src/client/src/app/features/manage/trials/trial-detail.component.html
git commit -m "feat(trial-detail): wire intelligence delete with confirmation"
```

---

## Task 5: Add MarkerService.getById

**Files:**
- Modify: `src/client/src/app/core/services/marker.service.ts`

Marker detail needs to render the marker's category, type, title, date, and projection. The existing service has no fetch-by-id; add it.

- [ ] **Step 1: Add the method**

Edit `marker.service.ts`. Add the method below `delete()`:

```ts
  async getById(id: string): Promise<Marker | null> {
    const { data, error } = await this.supabase.client
      .from('markers')
      .select('*, marker_types(name, marker_categories(name))')
      .eq('id', id)
      .single();
    if (error) {
      if ((error as { code?: string }).code === 'PGRST116') return null;
      throw error;
    }
    return data as Marker;
  }
```

(The `marker_types(name, marker_categories(name))` shape mirrors what `trial-detail` reads for the markers table at `trial-detail.component.html:403`.)

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/marker.service.ts
git commit -m "feat(marker): add getById for marker-detail page"
```

---

## Task 6: CompanyDetailComponent + route

**Files:**
- Create: `src/client/src/app/features/manage/companies/company-detail.component.ts`
- Create: `src/client/src/app/features/manage/companies/company-detail.component.html`
- Modify: `src/client/src/app/app.routes.ts`

- [ ] **Step 1: Create the component file**

Create `src/client/src/app/features/manage/companies/company-detail.component.ts`:

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell/manage-page-shell.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';

import { CompanyService } from '../../../core/services/company.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { Company } from '../../../core/models/company.model';
import { IntelligenceDetailBundle } from '../../../core/models/primary-intelligence.model';

@Component({
  selector: 'app-company-detail',
  standalone: true,
  imports: [
    RouterLink,
    ConfirmDialogModule,
    ToastModule,
    ManagePageShellComponent,
    IntelligenceBlockComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    MaterialsSectionComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './company-detail.component.html',
})
export class CompanyDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private companyService = inject(CompanyService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  protected readonly companyId = signal<string>('');
  protected readonly company = signal<Company | null>(null);
  protected readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly loading = signal(true);

  protected readonly hasIntelligence = computed(() => {
    const i = this.intelligence();
    return !!(i?.published || i?.draft);
  });

  protected readonly tenantIdSig = computed(() => this.findAncestorParam('tenantId') ?? '');
  protected readonly spaceIdSig = computed(() => this.findAncestorParam('spaceId') ?? '');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.companyId.set(id);
    void this.loadCompany();
    void this.loadIntelligence();
  }

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  private async loadCompany(): Promise<void> {
    try {
      this.company.set(await this.companyService.getById(this.companyId()));
    } catch {
      this.company.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadIntelligence(): Promise<void> {
    try {
      this.intelligence.set(await this.intelligenceService.getCompanyDetail(this.companyId()));
    } catch {
      this.intelligence.set(null);
    }
  }

  protected onIntelligenceEdit(): void {
    this.drawerOpen.set(true);
  }

  protected async onIntelligenceClosed(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected async onIntelligencePublished(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected onIntelligenceDelete(): void {
    const i = this.intelligence();
    const id = i?.published?.record.id ?? i?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete primary intelligence?',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Primary intelligence removed.',
          });
          await this.loadIntelligence();
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: (err as Error).message,
          });
        }
      },
    });
  }
}
```

- [ ] **Step 2: Create the template**

Create `src/client/src/app/features/manage/companies/company-detail.component.html`:

```html
<p-toast />
<p-confirmDialog />

<app-manage-page-shell [narrow]="true">
  @if (loading()) {
    <div class="px-4 py-8 text-sm text-slate-500">Loading...</div>
  } @else if (company(); as c) {
    <header class="mb-4 border border-slate-200 bg-white px-4 py-3">
      <h1 class="text-base font-semibold uppercase tracking-[0.08em] text-slate-900">{{ c.name }}</h1>
      @if (c.country) {
        <p class="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">{{ c.country }}</p>
      }
    </header>

    @if (hasIntelligence()) {
      <app-intelligence-block
        [published]="intelligence()?.published ?? null"
        [draft]="intelligence()?.draft ?? null"
        [agencyView]="spaceRole.canEdit()"
        [tenantId]="tenantIdSig()"
        [spaceId]="spaceIdSig()"
        (edit)="onIntelligenceEdit()"
        (deleted)="onIntelligenceDelete()"
      />
    } @else {
      <app-intelligence-empty
        [canEdit]="spaceRole.canEdit()"
        entityLabel="company"
        (add)="onIntelligenceEdit()"
      />
    }

    <section class="mb-4 border border-slate-200 bg-white" aria-label="Reads referencing this company">
      <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Referenced in</h2>
        <span class="font-mono text-[10px] text-slate-400">
          {{ (intelligence()?.referenced_in ?? []).length }} reads
        </span>
      </header>
      <div class="px-4 py-3">
        @if ((intelligence()?.referenced_in ?? []).length === 0) {
          <p class="text-xs text-slate-400">No published reads link to this company yet.</p>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (ref of intelligence()?.referenced_in ?? []; track ref.id) {
              <li class="flex flex-wrap items-baseline gap-2 py-2">
                <span class="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  {{ ref.entity_type }}
                </span>
                <span class="text-sm text-slate-800">{{ ref.headline }}</span>
              </li>
            }
          </ul>
        }
      </div>
    </section>

    <section class="materials-section mb-4 border border-slate-200 bg-white" aria-label="Engagement materials">
      <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Materials</h2>
      </header>
      <app-materials-section entityType="company" [entityId]="companyId()" [spaceId]="spaceIdSig()" />
    </section>

    @if (spaceIdSig()) {
      <app-intelligence-drawer
        [visible]="drawerOpen()"
        [spaceId]="spaceIdSig()"
        entityType="company"
        [entityId]="companyId()"
        (closed)="onIntelligenceClosed()"
        (published)="onIntelligencePublished()"
      />
    }
  } @else {
    <div class="px-4 py-8 text-sm text-slate-500">Company not found.</div>
  }
</app-manage-page-shell>
```

- [ ] **Step 3: Register the route**

Edit `src/client/src/app/app.routes.ts`. Find the `manage/trials/:id` block (around line 369-374). Immediately after the `manage/trials/:id` route, add:

```ts
          {
            path: 'manage/companies/:id',
            loadComponent: () =>
              import('./features/manage/companies/company-detail.component').then(
                (m) => m.CompanyDetailComponent
              ),
          },
```

- [ ] **Step 4: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/companies/company-detail.component.ts src/client/src/app/features/manage/companies/company-detail.component.html src/client/src/app/app.routes.ts
git commit -m "feat(intelligence): company detail page with intelligence CRUD"
```

---

## Task 7: ProductDetailComponent + route

**Files:**
- Create: `src/client/src/app/features/manage/products/product-detail.component.ts`
- Create: `src/client/src/app/features/manage/products/product-detail.component.html`
- Modify: `src/client/src/app/app.routes.ts`

- [ ] **Step 1: Create the component file**

Create `src/client/src/app/features/manage/products/product-detail.component.ts`:

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell/manage-page-shell.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';

import { ProductService } from '../../../core/services/product.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { Product } from '../../../core/models/product.model';
import { IntelligenceDetailBundle } from '../../../core/models/primary-intelligence.model';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    RouterLink,
    ConfirmDialogModule,
    ToastModule,
    ManagePageShellComponent,
    IntelligenceBlockComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    MaterialsSectionComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './product-detail.component.html',
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private productService = inject(ProductService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  protected readonly productId = signal<string>('');
  protected readonly product = signal<Product | null>(null);
  protected readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly loading = signal(true);

  protected readonly hasIntelligence = computed(() => {
    const i = this.intelligence();
    return !!(i?.published || i?.draft);
  });

  protected readonly tenantIdSig = computed(() => this.findAncestorParam('tenantId') ?? '');
  protected readonly spaceIdSig = computed(() => this.findAncestorParam('spaceId') ?? '');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.productId.set(id);
    void this.loadProduct();
    void this.loadIntelligence();
  }

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  private async loadProduct(): Promise<void> {
    try {
      this.product.set(await this.productService.getById(this.productId()));
    } catch {
      this.product.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadIntelligence(): Promise<void> {
    try {
      this.intelligence.set(await this.intelligenceService.getProductDetail(this.productId()));
    } catch {
      this.intelligence.set(null);
    }
  }

  protected onIntelligenceEdit(): void {
    this.drawerOpen.set(true);
  }

  protected async onIntelligenceClosed(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected async onIntelligencePublished(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected onIntelligenceDelete(): void {
    const i = this.intelligence();
    const id = i?.published?.record.id ?? i?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete primary intelligence?',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Primary intelligence removed.',
          });
          await this.loadIntelligence();
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: (err as Error).message,
          });
        }
      },
    });
  }
}
```

- [ ] **Step 2: Create the template**

Create `src/client/src/app/features/manage/products/product-detail.component.html`:

```html
<p-toast />
<p-confirmDialog />

<app-manage-page-shell [narrow]="true">
  @if (loading()) {
    <div class="px-4 py-8 text-sm text-slate-500">Loading...</div>
  } @else if (product(); as p) {
    <header class="mb-4 border border-slate-200 bg-white px-4 py-3">
      <h1 class="text-base font-semibold uppercase tracking-[0.08em] text-slate-900">{{ p.name }}</h1>
      @if (p.inn) {
        <p class="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">INN: {{ p.inn }}</p>
      }
    </header>

    @if (hasIntelligence()) {
      <app-intelligence-block
        [published]="intelligence()?.published ?? null"
        [draft]="intelligence()?.draft ?? null"
        [agencyView]="spaceRole.canEdit()"
        [tenantId]="tenantIdSig()"
        [spaceId]="spaceIdSig()"
        (edit)="onIntelligenceEdit()"
        (deleted)="onIntelligenceDelete()"
      />
    } @else {
      <app-intelligence-empty
        [canEdit]="spaceRole.canEdit()"
        entityLabel="product"
        (add)="onIntelligenceEdit()"
      />
    }

    <section class="mb-4 border border-slate-200 bg-white" aria-label="Reads referencing this product">
      <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Referenced in</h2>
        <span class="font-mono text-[10px] text-slate-400">
          {{ (intelligence()?.referenced_in ?? []).length }} reads
        </span>
      </header>
      <div class="px-4 py-3">
        @if ((intelligence()?.referenced_in ?? []).length === 0) {
          <p class="text-xs text-slate-400">No published reads link to this product yet.</p>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (ref of intelligence()?.referenced_in ?? []; track ref.id) {
              <li class="flex flex-wrap items-baseline gap-2 py-2">
                <span class="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  {{ ref.entity_type }}
                </span>
                <span class="text-sm text-slate-800">{{ ref.headline }}</span>
              </li>
            }
          </ul>
        }
      </div>
    </section>

    <section class="materials-section mb-4 border border-slate-200 bg-white" aria-label="Engagement materials">
      <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Materials</h2>
      </header>
      <app-materials-section entityType="product" [entityId]="productId()" [spaceId]="spaceIdSig()" />
    </section>

    @if (spaceIdSig()) {
      <app-intelligence-drawer
        [visible]="drawerOpen()"
        [spaceId]="spaceIdSig()"
        entityType="product"
        [entityId]="productId()"
        (closed)="onIntelligenceClosed()"
        (published)="onIntelligencePublished()"
      />
    }
  } @else {
    <div class="px-4 py-8 text-sm text-slate-500">Product not found.</div>
  }
</app-manage-page-shell>
```

- [ ] **Step 3: Register the route**

Edit `src/client/src/app/app.routes.ts`. Right after the new `manage/companies/:id` route from Task 6, add:

```ts
          {
            path: 'manage/products/:id',
            loadComponent: () =>
              import('./features/manage/products/product-detail.component').then(
                (m) => m.ProductDetailComponent
              ),
          },
```

- [ ] **Step 4: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/products/product-detail.component.ts src/client/src/app/features/manage/products/product-detail.component.html src/client/src/app/app.routes.ts
git commit -m "feat(intelligence): product detail page with intelligence CRUD"
```

---

## Task 8: MarkerDetailComponent + route

**Files:**
- Create: `src/client/src/app/features/manage/markers/marker-detail.component.ts`
- Create: `src/client/src/app/features/manage/markers/marker-detail.component.html`
- Modify: `src/client/src/app/app.routes.ts`

- [ ] **Step 1: Create the component file**

Create `src/client/src/app/features/manage/markers/marker-detail.component.ts`:

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell/manage-page-shell.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';

import { MarkerService } from '../../../core/services/marker.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { Marker } from '../../../core/models/marker.model';
import { IntelligenceDetailBundle } from '../../../core/models/primary-intelligence.model';

@Component({
  selector: 'app-marker-detail',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    ConfirmDialogModule,
    ToastModule,
    ManagePageShellComponent,
    IntelligenceBlockComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    MaterialsSectionComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './marker-detail.component.html',
})
export class MarkerDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private markerService = inject(MarkerService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  protected readonly markerId = signal<string>('');
  protected readonly marker = signal<Marker | null>(null);
  protected readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly loading = signal(true);

  protected readonly hasIntelligence = computed(() => {
    const i = this.intelligence();
    return !!(i?.published || i?.draft);
  });

  protected readonly tenantIdSig = computed(() => this.findAncestorParam('tenantId') ?? '');
  protected readonly spaceIdSig = computed(() => this.findAncestorParam('spaceId') ?? '');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.markerId.set(id);
    void this.loadMarker();
    void this.loadIntelligence();
  }

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  private async loadMarker(): Promise<void> {
    try {
      this.marker.set(await this.markerService.getById(this.markerId()));
    } catch {
      this.marker.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadIntelligence(): Promise<void> {
    try {
      this.intelligence.set(await this.intelligenceService.getMarkerDetail(this.markerId()));
    } catch {
      this.intelligence.set(null);
    }
  }

  protected onIntelligenceEdit(): void {
    this.drawerOpen.set(true);
  }

  protected async onIntelligenceClosed(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected async onIntelligencePublished(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected onIntelligenceDelete(): void {
    const i = this.intelligence();
    const id = i?.published?.record.id ?? i?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete primary intelligence?',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Primary intelligence removed.',
          });
          await this.loadIntelligence();
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: (err as Error).message,
          });
        }
      },
    });
  }
}
```

- [ ] **Step 2: Create the template**

Create `src/client/src/app/features/manage/markers/marker-detail.component.html`:

```html
<p-toast />
<p-confirmDialog />

<app-manage-page-shell [narrow]="true">
  @if (loading()) {
    <div class="px-4 py-8 text-sm text-slate-500">Loading...</div>
  } @else if (marker(); as m) {
    <header class="mb-4 border border-slate-200 bg-white px-4 py-3">
      <h1 class="text-base font-semibold uppercase tracking-[0.08em] text-slate-900">{{ m.title }}</h1>
      <p class="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        {{ m.marker_types?.marker_categories?.name || '--' }}
        / {{ m.marker_types?.name || 'Unknown' }}
        @if (m.event_date) {
          / {{ m.event_date | date: 'mediumDate' }}
        }
      </p>
    </header>

    @if (hasIntelligence()) {
      <app-intelligence-block
        [published]="intelligence()?.published ?? null"
        [draft]="intelligence()?.draft ?? null"
        [agencyView]="spaceRole.canEdit()"
        [tenantId]="tenantIdSig()"
        [spaceId]="spaceIdSig()"
        (edit)="onIntelligenceEdit()"
        (deleted)="onIntelligenceDelete()"
      />
    } @else {
      <app-intelligence-empty
        [canEdit]="spaceRole.canEdit()"
        entityLabel="marker"
        (add)="onIntelligenceEdit()"
      />
    }

    <section class="mb-4 border border-slate-200 bg-white" aria-label="Reads referencing this marker">
      <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Referenced in</h2>
        <span class="font-mono text-[10px] text-slate-400">
          {{ (intelligence()?.referenced_in ?? []).length }} reads
        </span>
      </header>
      <div class="px-4 py-3">
        @if ((intelligence()?.referenced_in ?? []).length === 0) {
          <p class="text-xs text-slate-400">No published reads link to this marker yet.</p>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (ref of intelligence()?.referenced_in ?? []; track ref.id) {
              <li class="flex flex-wrap items-baseline gap-2 py-2">
                <span class="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  {{ ref.entity_type }}
                </span>
                <span class="text-sm text-slate-800">{{ ref.headline }}</span>
              </li>
            }
          </ul>
        }
      </div>
    </section>

    <section class="materials-section mb-4 border border-slate-200 bg-white" aria-label="Engagement materials">
      <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Materials</h2>
      </header>
      <app-materials-section entityType="marker" [entityId]="markerId()" [spaceId]="spaceIdSig()" />
    </section>

    @if (spaceIdSig()) {
      <app-intelligence-drawer
        [visible]="drawerOpen()"
        [spaceId]="spaceIdSig()"
        entityType="marker"
        [entityId]="markerId()"
        (closed)="onIntelligenceClosed()"
        (published)="onIntelligencePublished()"
      />
    }
  } @else {
    <div class="px-4 py-8 text-sm text-slate-500">Marker not found.</div>
  }
</app-manage-page-shell>
```

- [ ] **Step 3: Register the route**

Edit `src/client/src/app/app.routes.ts`. After the `manage/products/:id` route from Task 7, add:

```ts
          {
            path: 'manage/markers/:id',
            loadComponent: () =>
              import('./features/manage/markers/marker-detail.component').then(
                (m) => m.MarkerDetailComponent
              ),
          },
```

- [ ] **Step 4: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/markers/marker-detail.component.ts src/client/src/app/features/manage/markers/marker-detail.component.html src/client/src/app/app.routes.ts
git commit -m "feat(intelligence): marker detail page with intelligence CRUD"
```

---

## Task 9: EngagementDetailComponent + route

**Files:**
- Create: `src/client/src/app/features/manage/engagement/engagement-detail.component.ts`
- Create: `src/client/src/app/features/manage/engagement/engagement-detail.component.html`
- Modify: `src/client/src/app/app.routes.ts`

Engagement is the singleton per space. The route has no `:id`; the entity_id passed to the drawer is the spaceId itself (entity_type='space').

- [ ] **Step 1: Create the component file**

Create `src/client/src/app/features/manage/engagement/engagement-detail.component.ts`:

```ts
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell/manage-page-shell.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';

import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { IntelligenceDetailBundle } from '../../../core/models/primary-intelligence.model';

@Component({
  selector: 'app-engagement-detail',
  standalone: true,
  imports: [
    ConfirmDialogModule,
    ToastModule,
    ManagePageShellComponent,
    IntelligenceBlockComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    MaterialsSectionComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './engagement-detail.component.html',
})
export class EngagementDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  protected readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly loading = signal(true);

  protected readonly hasIntelligence = computed(() => {
    const i = this.intelligence();
    return !!(i?.published || i?.draft);
  });

  protected readonly tenantIdSig = computed(() => this.findAncestorParam('tenantId') ?? '');
  protected readonly spaceIdSig = computed(() => this.findAncestorParam('spaceId') ?? '');

  ngOnInit(): void {
    void this.loadIntelligence();
  }

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  private async loadIntelligence(): Promise<void> {
    try {
      const sid = this.spaceIdSig();
      if (!sid) return;
      this.intelligence.set(await this.intelligenceService.getSpaceIntelligence(sid));
    } catch {
      this.intelligence.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected onIntelligenceEdit(): void {
    this.drawerOpen.set(true);
  }

  protected async onIntelligenceClosed(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected async onIntelligencePublished(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected onIntelligenceDelete(): void {
    const i = this.intelligence();
    const id = i?.published?.record.id ?? i?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete primary intelligence?',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Primary intelligence removed.',
          });
          await this.loadIntelligence();
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: (err as Error).message,
          });
        }
      },
    });
  }
}
```

- [ ] **Step 2: Create the template**

Create `src/client/src/app/features/manage/engagement/engagement-detail.component.html`:

```html
<p-toast />
<p-confirmDialog />

<app-manage-page-shell [narrow]="true">
  @if (loading()) {
    <div class="px-4 py-8 text-sm text-slate-500">Loading...</div>
  } @else {
    <header class="mb-4 border border-slate-200 bg-white px-4 py-3">
      <h1 class="text-base font-semibold uppercase tracking-[0.08em] text-slate-900">Engagement</h1>
      <p class="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
        Space-level primary intelligence
      </p>
    </header>

    @if (hasIntelligence()) {
      <app-intelligence-block
        [published]="intelligence()?.published ?? null"
        [draft]="intelligence()?.draft ?? null"
        [agencyView]="spaceRole.canEdit()"
        [tenantId]="tenantIdSig()"
        [spaceId]="spaceIdSig()"
        (edit)="onIntelligenceEdit()"
        (deleted)="onIntelligenceDelete()"
      />
    } @else {
      <app-intelligence-empty
        [canEdit]="spaceRole.canEdit()"
        entityLabel="engagement"
        (add)="onIntelligenceEdit()"
      />
    }

    <section class="materials-section mb-4 border border-slate-200 bg-white" aria-label="Engagement materials">
      <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Materials</h2>
      </header>
      <app-materials-section entityType="space" [entityId]="spaceIdSig()" [spaceId]="spaceIdSig()" />
    </section>

    @if (spaceIdSig()) {
      <app-intelligence-drawer
        [visible]="drawerOpen()"
        [spaceId]="spaceIdSig()"
        entityType="space"
        [entityId]="spaceIdSig()"
        (closed)="onIntelligenceClosed()"
        (published)="onIntelligencePublished()"
      />
    }
  }
</app-manage-page-shell>
```

- [ ] **Step 3: Register the route**

Edit `src/client/src/app/app.routes.ts`. After the `manage/markers/:id` route from Task 8, add:

```ts
          {
            path: 'manage/engagement',
            loadComponent: () =>
              import('./features/manage/engagement/engagement-detail.component').then(
                (m) => m.EngagementDetailComponent
              ),
          },
```

- [ ] **Step 4: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/engagement/engagement-detail.component.ts src/client/src/app/features/manage/engagement/engagement-detail.component.html src/client/src/app/app.routes.ts
git commit -m "feat(intelligence): engagement detail page (singleton, space-level)"
```

---

## Task 10: Intelligence-feed link resolver uses helper

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-feed/intelligence-feed.component.ts`

- [ ] **Step 1: Replace the inline switch with the helper**

Edit `intelligence-feed.component.ts`. Add the import near the other shared imports at the top:

```ts
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';
```

Find the existing `entityRouterLink` method (around line 128-136):

```ts
  protected entityRouterLink(row: IntelligenceFeedRow): unknown[] {
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return [];
    if (row.entity_type === 'trial') {
      return ['/t', t, 's', s, 'manage', 'trials', row.entity_id];
    }
    return ['/t', t, 's', s, 'intelligence'];
  }
```

Replace with:

```ts
  protected entityRouterLink(row: IntelligenceFeedRow): unknown[] {
    return buildEntityRouterLink(this.tenantId(), this.spaceId(), row.entity_type, row.entity_id) ?? [];
  }
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-feed/intelligence-feed.component.ts
git commit -m "refactor(intelligence-feed): use shared router-link helper for all entity types"
```

---

## Task 11: Intelligence-block linkRoute uses helper

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts`

The block currently has fallbacks for marker / product / company that route to timeline or list views. Now that detail pages exist, route to them.

- [ ] **Step 1: Replace `linkRoute` with the helper**

Edit `intelligence-block.component.ts`. Add the import near the other imports at the top:

```ts
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';
```

Find `linkRoute` (around line 156-176):

```ts
  protected linkRoute(link: PrimaryIntelligenceLink): {
    commands: unknown[];
    queryParams?: Record<string, string>;
  } | null {
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return null;
    const base = ['/t', t, 's', s];
    switch (link.entity_type) {
      case 'trial':
        return { commands: [...base, 'manage', 'trials', link.entity_id] };
      case 'marker':
        return { commands: [...base, 'timeline'], queryParams: { markerId: link.entity_id } };
      case 'product':
        return { commands: [...base, 'timeline'], queryParams: { productIds: link.entity_id } };
      case 'company':
        return { commands: [...base, 'manage', 'companies'] };
      default:
        return null;
    }
  }
```

Replace with:

```ts
  protected linkRoute(link: PrimaryIntelligenceLink): {
    commands: unknown[];
    queryParams?: Record<string, string>;
  } | null {
    // IntelligenceLinkEntityType excludes 'space', so no engagement case here.
    const commands = buildEntityRouterLink(
      this.tenantId(),
      this.spaceId(),
      link.entity_type,
      link.entity_id
    );
    return commands ? { commands } : null;
  }
```

The `queryParams` shape stays in the return type so the template (`intelligence-block.component.html` lines 124-129) keeps working unchanged; it just renders `null` for queryParams now.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-block/intelligence-block.component.ts
git commit -m "refactor(intelligence-block): use shared helper to route linked-entity chips to detail pages"
```

---

## Task 12: Repoint company list name to detail page

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-list.component.html`
- Modify: `src/client/src/app/features/manage/companies/company-list.component.ts`

Today the company name in the list is a `<button (click)="openProducts(company.id)">` that filters the products list. The "View products" affordance still exists in the row-actions menu (`company-list.component.ts:131-133`), so it's safe to repoint the name click to the new detail page.

- [ ] **Step 1: Replace the click button with a router link**

Edit `company-list.component.html`. Find the body cell at lines 33-41:

```html
        <td>
          <button
            type="button"
            class="text-left text-brand-700 hover:text-brand-800 hover:underline focus:outline-none focus:ring-1 focus:ring-brand-500"
            (click)="openProducts(company.id)"
          >
            <span [innerHTML]="company.name | highlight: grid.debouncedGlobalSearch()"></span>
          </button>
        </td>
```

Replace with:

```html
        <td>
          <a
            [routerLink]="['/t', tenantId, 's', spaceId, 'manage', 'companies', company.id]"
            class="text-left text-brand-700 hover:text-brand-800 hover:underline focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <span [innerHTML]="company.name | highlight: grid.debouncedGlobalSearch()"></span>
          </a>
        </td>
```

(The component uses plain `tenantId` / `spaceId` properties at lines 63-64, not signals.)

- [ ] **Step 2: Add RouterLink to the imports array**

Edit `company-list.component.ts`. Add `RouterLink` to the `@angular/router` import (the file already imports `Router` and `ActivatedRoute`):

```ts
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
```

Find the `imports:` array on the component (around line 25) and add `RouterLink`:

```ts
  imports: [
    // ... existing entries ...
    RouterLink,
  ],
```

- [ ] **Step 3: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/companies/company-list.component.html src/client/src/app/features/manage/companies/company-list.component.ts
git commit -m "feat(companies): link company name in list to detail page"
```

---

## Task 13: Repoint product list name and company column to detail pages

**Files:**
- Modify: `src/client/src/app/features/manage/products/product-list.component.html`
- Modify: `src/client/src/app/features/manage/products/product-list.component.ts`

Same pattern as Task 12. Today the product name buttons (lines 70 and 88 of the template) call `openTrials(row.product.id)`, which filters trials by product. "View trials" remains in the row-actions menu (`product-list.component.ts:148-150`). The company column at line 82 is plain text and should also link to the company detail page.

- [ ] **Step 1: Replace the product-name buttons with router links**

Edit `product-list.component.html`. Lines 70 and 88 each contain a button like:

```html
<button
  type="button"
  ...
  (click)="openTrials(row.product.id)"
>
  <span [innerHTML]="row.product.name | highlight: grid.debouncedGlobalSearch()"></span>
</button>
```

Replace each occurrence (use `replace_all: true` only if both occurrences are textually identical; otherwise edit them in turn) with:

```html
<a
  [routerLink]="['/t', tenantId, 's', spaceId, 'manage', 'products', row.product.id]"
  class="text-left text-brand-700 hover:text-brand-800 hover:underline focus:outline-none focus:ring-1 focus:ring-brand-500"
>
  <span [innerHTML]="row.product.name | highlight: grid.debouncedGlobalSearch()"></span>
</a>
```

- [ ] **Step 2: Make the company column a router link**

In the same file, line 82 currently reads:

```html
<td class="col-secondary"><span [innerHTML]="row.companyName | highlight: grid.debouncedGlobalSearch()"></span></td>
```

Replace with:

```html
<td class="col-secondary">
  @if (row.product.company_id) {
    <a
      [routerLink]="['/t', tenantId, 's', spaceId, 'manage', 'companies', row.product.company_id]"
      class="text-brand-700 hover:underline"
    >
      <span [innerHTML]="row.companyName | highlight: grid.debouncedGlobalSearch()"></span>
    </a>
  } @else {
    <span [innerHTML]="row.companyName | highlight: grid.debouncedGlobalSearch()"></span>
  }
</td>
```

- [ ] **Step 3: Add RouterLink to the imports array**

Edit `product-list.component.ts`. Add `RouterLink` to the `@angular/router` imports and to the `imports:` array (mirror Task 12 step 2).

- [ ] **Step 4: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/products/product-list.component.html src/client/src/app/features/manage/products/product-list.component.ts
git commit -m "feat(products): link product and company names in list to detail pages"
```

---

## Task 14: Wire marker title as router link in trial-detail Markers table

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Wrap the marker title in a router link**

Edit `trial-detail.component.html`. Find the markers table body around line 406-411:

```html
                <td class="col-secondary max-w-xs">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate">{{ marker.title }}</span>
                    <app-ctgov-source-tag [metadata]="marker.metadata" />
                  </div>
                </td>
```

Replace with:

```html
                <td class="col-secondary max-w-xs">
                  <div class="flex items-center gap-1.5">
                    <a
                      [routerLink]="['/t', tenantIdSig(), 's', spaceIdSig(), 'manage', 'markers', marker.id]"
                      class="truncate text-brand-700 hover:underline"
                    >
                      {{ marker.title }}
                    </a>
                    <app-ctgov-source-tag [metadata]="marker.metadata" />
                  </div>
                </td>
```

`RouterLink` is already imported in `trial-detail.component.ts`.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 3: Manual smoke check**

Open any trial that has markers. Click a marker title in the Markers table. Browser should navigate to the marker detail page; the empty intelligence state should be visible (assuming no intelligence has been authored on that marker yet).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.html
git commit -m "feat(trial-detail): link marker title to marker detail page"
```

---

## Task 15: Add timeline marker pin "View detail" link

**Files:**
- Modify: `src/client/src/app/shared/components/marker-detail-content.component.ts`

The timeline marker panel is `MarkerDetailPanelComponent` (`src/client/src/app/shared/components/marker-detail-panel.component.ts`); the actual content lives in `MarkerDetailContentComponent`. The panel is mounted from `landscape-shell.component.ts:60-70`. Add a "View detail" anchor near the top of the content so it's visible without scrolling.

The catalyst payload exposes `catalyst.marker_id` (the underlying marker id). Confirm the field name with `grep -n "marker_id\|catalyst.id" src/client/src/app/core/models/catalyst.model.ts`. If the field is named differently (e.g. `id`), substitute below accordingly.

- [ ] **Step 1: Add the View detail link near the top of the panel content**

Edit `marker-detail-content.component.ts`. The template begins around line 35-40 with the date / projection block; the "Program" section starts at line 87. Just before the Program section (line 86), add:

```html
      @if (d.catalyst.marker_id && spaceId()) {
        <div class="mb-3 flex justify-end px-1">
          <a
            [routerLink]="['/t', tenantIdSig(), 's', spaceId(), 'manage', 'markers', d.catalyst.marker_id]"
            class="font-mono text-[10px] uppercase tracking-wider text-brand-700 hover:underline"
          >
            View detail
          </a>
        </div>
      }
```

If `marker-detail-content.component.ts` does not already expose a `tenantIdSig` accessor, add one. The component receives `spaceId` as an input (line 72 of the panel). Add an additional `tenantId` input on the content component (mirroring `spaceId`) and on the panel (forwarding from its parent), and the wiring in `landscape-shell.component.ts:62` to pass `tenantId="state.tenantIdSig()"`.

If wiring `tenantId` through the panel is heavier than expected, an acceptable shortcut is to inject `ActivatedRoute` directly in `MarkerDetailContentComponent` and read tenantId from the param tree (use the same `findAncestorParam` pattern as `trial-detail.component.ts:188`).

- [ ] **Step 2: Add RouterLink to the content component imports**

In `marker-detail-content.component.ts`, add `RouterLink` to `@angular/router` imports and to the `imports:` array.

- [ ] **Step 3: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 4: Manual smoke check**

Open the timeline. Click a marker pin. The panel should show "View detail" near the top. Click it. Browser navigates to the marker detail page.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/marker-detail-content.component.ts src/client/src/app/shared/components/marker-detail-panel.component.ts src/client/src/app/features/landscape/landscape-shell.component.ts
git commit -m "feat(timeline): add 'View detail' link in marker panel to marker detail page"
```

---

## Task 16: Add Engagement entry to sidebar nav

**Files:**
- Modify: `src/client/src/app/core/layout/sidebar.component.ts`

- [ ] **Step 1: Add the engagement entry under the Intelligence section**

Edit `sidebar.component.ts`. Find the Intelligence section (around line 56-65):

```ts
    label: 'Intelligence',
    items: [
      {
        label: 'Intelligence Feed',
        ...
      },
      { label: 'Materials', route: 'materials', icon: NAV_ICONS['materials'] },
      { label: 'Events', route: 'events', icon: NAV_ICONS['events'] },
    ],
  },
```

Add an `Engagement` entry as the first item (it's the top-level read for the space, so it should sit at the top of the section):

```ts
    label: 'Intelligence',
    items: [
      { label: 'Engagement', route: 'manage/engagement', icon: NAV_ICONS['engagement'] ?? NAV_ICONS['home'] },
      {
        label: 'Intelligence Feed',
        ...
      },
      { label: 'Materials', route: 'materials', icon: NAV_ICONS['materials'] },
      { label: 'Events', route: 'events', icon: NAV_ICONS['events'] },
    ],
```

If `NAV_ICONS['engagement']` is not defined, the `??` falls back to the home icon. (Adding an `engagement` icon to `nav-icons.ts` is optional and out of scope; the home glyph is a fine placeholder.)

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 3: Manual smoke check**

Open any space. Sidebar shows "Engagement" at the top of the Intelligence section. Click it. Lands on `manage/engagement` with the empty intelligence state.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/layout/sidebar.component.ts
git commit -m "feat(sidebar): link Engagement detail page from Intelligence section"
```

---

## Task 17: Trial-list company / product columns link to detail pages

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.html`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.ts`

Trial-list shows product (line 141) and company (line 144) as plain text. Make both clickable. `row.companyId` is already on `TrialRow` (line 38). Product id needs to be added to the row interface.

- [ ] **Step 1: Add productId to the TrialRow interface**

Edit `trial-list.component.ts`. Find the `TrialRow` interface (lines 34-41):

```ts
interface TrialRow {
  readonly trial: Trial;
  readonly productName: string;
  readonly companyName: string;
  readonly companyId: string;
  readonly phaseCount: number;
  readonly markerCount: number;
}
```

Add `productId`:

```ts
interface TrialRow {
  readonly trial: Trial;
  readonly productName: string;
  readonly productId: string;
  readonly companyName: string;
  readonly companyId: string;
  readonly phaseCount: number;
  readonly markerCount: number;
}
```

- [ ] **Step 2: Populate productId where rows are built**

Same file. Find the row construction (around line 145-155, inside the loop that builds rows). It should already reference the product. Add `productId: trial.product_id ?? '',` next to the existing `companyId` field.

If you cannot determine the exact line by inspection, run: `grep -n "companyId:" src/client/src/app/features/manage/trials/trial-list.component.ts` and add the new field next to it in the same object literal.

- [ ] **Step 3: Wrap the product and company cells in router links**

Edit `trial-list.component.html`. Replace the product cell (around line 140-142):

```html
        <td class="col-secondary">
          <span [innerHTML]="row.productName | highlight: grid.debouncedGlobalSearch()"></span>
        </td>
```

with:

```html
        <td class="col-secondary">
          @if (row.productId) {
            <a
              [routerLink]="['/t', tenantId(), 's', spaceId(), 'manage', 'products', row.productId]"
              class="text-brand-700 hover:underline"
            >
              <span [innerHTML]="row.productName | highlight: grid.debouncedGlobalSearch()"></span>
            </a>
          } @else {
            <span [innerHTML]="row.productName | highlight: grid.debouncedGlobalSearch()"></span>
          }
        </td>
```

Replace the company cell (around line 143-145):

```html
        <td class="col-secondary">
          <span [innerHTML]="row.companyName | highlight: grid.debouncedGlobalSearch()"></span>
        </td>
```

with:

```html
        <td class="col-secondary">
          @if (row.companyId) {
            <a
              [routerLink]="['/t', tenantId(), 's', spaceId(), 'manage', 'companies', row.companyId]"
              class="text-brand-700 hover:underline"
            >
              <span [innerHTML]="row.companyName | highlight: grid.debouncedGlobalSearch()"></span>
            </a>
          } @else {
            <span [innerHTML]="row.companyName | highlight: grid.debouncedGlobalSearch()"></span>
          }
        </td>
```

- [ ] **Step 4: Add RouterLink to imports**

`trial-list.component.ts` already imports `Router` from `@angular/router`. Add `RouterLink` to that import and to the `imports:` array on the component.

- [ ] **Step 5: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-list.component.html src/client/src/app/features/manage/trials/trial-list.component.ts
git commit -m "feat(trial-list): link product and company columns to detail pages"
```

---

## Task 18: Dashboard-grid consumers route company / product clicks to detail pages

**Files:**
- Modify: `src/client/src/app/features/landscape/timeline-view.component.ts`
- Modify: `src/client/src/app/features/landscape/timeline-view.component.html`
- Modify: `src/client/src/app/features/landscape/landscape.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape.component.html`

`DashboardGridComponent` already emits `companyClick = output<string>()` and `productClick = output<string>()` (`dashboard-grid.component.ts:76-77`). The current consumers (`timeline-view.onCompanyClick()` / `onProductClick()` and `landscape.onProductClick(productId)`) discard the id and route to the list. Repoint them to detail pages.

- [ ] **Step 1: Update timeline-view consumers to take the id and route to detail pages**

Edit `timeline-view.component.ts`. Find the existing handlers (lines 120-127):

```ts
  onCompanyClick(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'companies']);
  }

  onProductClick(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'products']);
  }
```

Replace with:

```ts
  onCompanyClick(companyId: string): void {
    if (!companyId) return;
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'companies', companyId]);
  }

  onProductClick(productId: string): void {
    if (!productId) return;
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'products', productId]);
  }
```

- [ ] **Step 2: Update timeline-view template to pass the event id**

Edit `timeline-view.component.html`. Lines 51-52 currently read:

```html
        (companyClick)="onCompanyClick()"
        (productClick)="onProductClick()"
```

Replace with:

```html
        (companyClick)="onCompanyClick($event)"
        (productClick)="onProductClick($event)"
```

- [ ] **Step 3: Update landscape consumer to route to product detail with the id**

Edit `landscape.component.ts`. Find `onProductClick` (around line 190):

```ts
  onProductClick(productId: string): void {
    // existing body
  }
```

If the body navigates to a filtered timeline (typical pattern: `router.navigate(..., 'timeline'], { queryParams: { productIds: productId } })`), replace it with a navigation to the product detail page:

```ts
  onProductClick(productId: string): void {
    if (!productId) return;
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'products', productId]);
  }
```

If the existing behavior (filter timeline by product) is wanted alongside the new detail navigation, you can promote it to a `(dblclick)` or row-action menu later. For this plan, the spec asks for company/product clicks to land on detail pages.

- [ ] **Step 4: Update onOpenCompany to take an id and route to detail**

Same file (`landscape.component.ts`), find `onOpenCompany` (around line 220):

```ts
  onOpenCompany(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'companies']);
  }
```

Replace with:

```ts
  onOpenCompany(companyId: string): void {
    if (!companyId) return;
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'companies', companyId]);
  }
```

Then in `landscape.component.html` line 60, the binding currently reads:

```html
                  (openCompany)="onOpenCompany()"
```

Replace with:

```html
                  (openCompany)="onOpenCompany($event)"
```

(`bullseye-detail-panel.component.ts:206` already emits the company id with `this.openCompany.emit(p.company_id)`; this just stops discarding it.)

- [ ] **Step 5: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/timeline-view.component.ts src/client/src/app/features/landscape/timeline-view.component.html src/client/src/app/features/landscape/landscape.component.ts src/client/src/app/features/landscape/landscape.component.html
git commit -m "feat(landscape): route grid + bullseye company/product clicks to detail pages"
```

---

## Task 19: Marker detail content "Program" company / product link

**Files:**
- Modify: `src/client/src/app/shared/components/marker-detail-content.component.ts`

The Program section in the marker panel (`marker-detail-content.component.ts` lines 87-105) renders company name and product name as plain text. The catalyst payload exposes `company_id` and `product_id`; make both clickable.

- [ ] **Step 1: Wrap the company and product names in router links**

Edit `marker-detail-content.component.ts`. Find the Program section (lines 87-105):

```html
      @if (d.catalyst.company_name) {
        <app-detail-panel-section [first]="true" label="Program">
          <div class="flex items-center gap-2 text-[13px] text-slate-900">
            @if (d.catalyst.company_logo_url) {
              <img
                [src]="d.catalyst.company_logo_url"
                [alt]="d.catalyst.company_name"
                class="h-5 w-5 flex-none rounded object-contain"
              />
            }
            <p>
              <span class="font-semibold uppercase">{{ d.catalyst.company_name }}</span>
              @if (d.catalyst.product_name) {
                &middot; {{ d.catalyst.product_name }}
              }
            </p>
          </div>
        </app-detail-panel-section>
      }
```

Replace with:

```html
      @if (d.catalyst.company_name) {
        <app-detail-panel-section [first]="true" label="Program">
          <div class="flex items-center gap-2 text-[13px] text-slate-900">
            @if (d.catalyst.company_logo_url) {
              <img
                [src]="d.catalyst.company_logo_url"
                [alt]="d.catalyst.company_name"
                class="h-5 w-5 flex-none rounded object-contain"
              />
            }
            <p>
              @if (d.catalyst.company_id && tenantIdSig() && spaceId()) {
                <a
                  [routerLink]="['/t', tenantIdSig(), 's', spaceId(), 'manage', 'companies', d.catalyst.company_id]"
                  class="font-semibold uppercase text-brand-700 hover:underline"
                >
                  {{ d.catalyst.company_name }}
                </a>
              } @else {
                <span class="font-semibold uppercase">{{ d.catalyst.company_name }}</span>
              }
              @if (d.catalyst.product_name) {
                &middot;
                @if (d.catalyst.product_id && tenantIdSig() && spaceId()) {
                  <a
                    [routerLink]="['/t', tenantIdSig(), 's', spaceId(), 'manage', 'products', d.catalyst.product_id]"
                    class="text-brand-700 hover:underline"
                  >
                    {{ d.catalyst.product_name }}
                  </a>
                } @else {
                  {{ d.catalyst.product_name }}
                }
              }
            </p>
          </div>
        </app-detail-panel-section>
      }
```

This depends on the same `tenantIdSig()` accessor added in Task 15. If Task 15 used the `ActivatedRoute` shortcut, this task automatically inherits it.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/marker-detail-content.component.ts
git commit -m "feat(marker-panel): link company and product names in Program section to detail pages"
```

---

## Task 20: Bullseye detail panel company link

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.html`

The panel currently fires `(click)="onCompanyClick()"` (line 30). The handler already emits the company id (`bullseye-detail-panel.component.ts:204-206`). Task 18 fixed the consumer to land on the detail page; this task just confirms the chrome reads as a link.

- [ ] **Step 1: Verify Task 18 made `onOpenCompany($event)` route to detail**

Run: `grep -n "onOpenCompany\|openCompany" src/client/src/app/features/landscape/landscape.component.ts src/client/src/app/features/landscape/landscape.component.html | head -10`

Confirm the consumer takes the id and routes to `manage/companies/:id`. If yes, this task is complete and no extra change is needed beyond visual polish in the next step.

- [ ] **Step 2: Optional polish on the chrome (if desired)**

The existing button (line 27-37) already reads as a link with the arrow icon. No template change is required unless you want to change the visible affordance. Skip this step if not needed.

- [ ] **Step 3: Manual smoke check**

Open a bullseye view. Click a product to open the panel. Click the Company section. Browser navigates to the new company detail page.

- [ ] **Step 4: Commit (only if files changed)**

If no template change was needed, skip. Otherwise:

```bash
git add src/client/src/app/features/landscape/bullseye-detail-panel.component.html
git commit -m "chore(bullseye-panel): confirm company link routes to detail page"
```

---

## Task 21: Command palette routes company / product items to detail pages

**Files:**
- Modify: `src/client/src/app/core/layout/command-palette/command-palette.component.ts`

Lines 194-195 today route to `manage/companies?selected=${id}` and `manage/products?selected=${id}`. Repoint them to the detail pages.

- [ ] **Step 1: Update the route construction**

Edit `command-palette.component.ts`. Find lines 194-195 inside the switch that maps an item kind to a route:

```ts
      case 'company':  return `${base}/manage/companies?selected=${item.id}`;
      case 'product':  return `${base}/manage/products?selected=${item.id}`;
```

Replace with:

```ts
      case 'company':  return `${base}/manage/companies/${item.id}`;
      case 'product':  return `${base}/manage/products/${item.id}`;
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint, successful build.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/command-palette/command-palette.component.ts
git commit -m "feat(command-palette): route company/product items to detail pages"
```

---

## Task 22: E2E spec for company intelligence add / edit / delete

**Files:**
- Create: `src/client/e2e/tests/intelligence-crud.spec.ts`

One layer covered end-to-end is enough (the other three pages are structurally identical).

- [ ] **Step 1: Write the spec**

Create `src/client/e2e/tests/intelligence-crud.spec.ts`:

```ts
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import { createTestTenant, createTestSpace } from '../helpers/test-data.helper';
import { fillInput } from '../helpers/form.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Primary intelligence CRUD on company detail', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;

  const companyDetailUrl = () => `/t/${tenantId}/s/${spaceId}/manage/companies/${companyId}`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Intel CRUD Org');
    spaceId = await createTestSpace(tenantId, 'Intel CRUD Space');
    page = await authenticatedPage(browser);

    // Create a company to attach intelligence to.
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Add Company' }).click();
    await expect(page.locator('#company-name')).toBeVisible({ timeout: 5000 });
    await fillInput(page, '#company-name', 'Intel Co');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/rest/') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Create Company' }).click(),
    ]);

    // Reload list, click the company name to navigate to detail.
    await page.goto(`/t/${tenantId}/s/${spaceId}/manage/companies`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Intel Co' }).click();
    await page.waitForURL(/\/manage\/companies\/[0-9a-f-]+$/, { timeout: 5000 });
    const match = page.url().match(/companies\/([0-9a-f-]+)$/);
    if (!match) throw new Error('failed to capture companyId from URL');
    companyId = match[1];
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('add primary intelligence as a published read', async () => {
    await page.goto(companyDetailUrl(), { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Add primary intelligence' }).click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await fillInput(page, 'input[name="headline"], #headline', 'Initial read on Intel Co');

    // Type a thesis into the ProseMirror editor.
    const thesis = page.locator('.ProseMirror').first();
    await thesis.click();
    await thesis.type('They are pivoting toward TTR amyloidosis.');

    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/rpc/upsert_primary_intelligence') && r.request().method() === 'POST'
      ),
      page.getByRole('button', { name: /^Publish/ }).click(),
    ]);

    await expect(page.getByText('Initial read on Intel Co')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Published')).toBeVisible();
  });

  test('edit the published intelligence', async () => {
    await page.goto(companyDetailUrl(), { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    await page.locator('input[name="headline"], #headline').fill('Updated read on Intel Co');

    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/rpc/upsert_primary_intelligence') && r.request().method() === 'POST'
      ),
      page.getByRole('button', { name: /^Publish/ }).click(),
    ]);

    await expect(page.getByText('Updated read on Intel Co')).toBeVisible({ timeout: 5000 });
  });

  test('delete the intelligence with confirmation', async () => {
    await page.goto(companyDetailUrl(), { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText('Delete primary intelligence?')).toBeVisible({ timeout: 5000 });
    await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/rpc/delete_primary_intelligence') && r.request().method() === 'POST'
      ),
      page.getByRole('button', { name: 'Delete', exact: true }).last().click(),
    ]);

    await expect(page.getByRole('button', { name: 'Add primary intelligence' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Updated read on Intel Co')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `cd src/client && ./e2e/run.sh -- intelligence-crud`
Expected: 3 passing tests in the new spec; existing suites unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/intelligence-crud.spec.ts
git commit -m "test(e2e): full add/edit/delete loop for company-layer intelligence"
```

---

## Verification

After all tasks land, run the full suite from `src/client/`:

```bash
cd src/client
ng lint
ng build
npm run test:unit
./e2e/run.sh
```

All four must pass cleanly. The new pages should be reachable via:

- Companies list -> click name -> company detail
- Products list -> click name -> product detail
- Products list -> click company column -> company detail
- Trial list -> click product or company column -> respective detail page
- Trial detail -> Markers table -> click title -> marker detail
- Sidebar -> Engagement -> engagement detail
- Intelligence feed -> click any non-trial row -> appropriate detail page
- Intelligence block link chips -> click a linked entity -> appropriate detail page
- Timeline marker pin panel -> "View detail" -> marker detail
- Timeline marker pin panel "Program" section -> click company / product name -> respective detail page
- Bullseye detail panel -> click Company section -> company detail
- Dashboard grid (timeline view) -> click company / product name in row -> respective detail page
- Command palette -> select a company / product result -> respective detail page

The Delete control should now appear on every intelligence block (trial + the four new pages) with a confirmation dialog.
