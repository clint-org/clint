# Org and Space Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign settings navigation so org settings are accessed via the org dropdown, space settings live in a unified sidebar section, and both levels expose name editing, member management, and (for orgs) logo upload.

**Architecture:** The sidebar settings section changes from [Taxonomies, Marker Types, Organization, Spaces] to [General, Members, Taxonomies, Marker Types] -- all space-scoped. Two new page components handle space general settings and space member management. The topbar dropdowns gain footer links for "Organization settings", "Space settings", and "New space". The existing tenant-settings page is enhanced with name editing, role management, and logo upload. A new migration adds `logo_url` to the tenants table.

**Tech Stack:** Angular 19 (standalone components, signals), PrimeNG 19, Tailwind CSS v4, Supabase (Database + Storage)

---

### Task 1: Database migration -- add logo_url to tenants

**Files:**
- Create: `supabase/migrations/20260414210000_add_tenant_logo_url.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add logo_url column to tenants table for organization branding
ALTER TABLE tenants ADD COLUMN logo_url text;

-- Create storage bucket for tenant logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: tenant owners can upload/delete logos
CREATE POLICY "Tenant owners can manage logos"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text FROM tenants t
      JOIN tenant_members tm ON tm.tenant_id = t.id
      WHERE tm.user_id = auth.uid() AND tm.role = 'owner'
    )
  );

-- RLS: tenant members can read logos
CREATE POLICY "Tenant members can read logos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text FROM tenants t
      JOIN tenant_members tm ON tm.tenant_id = t.id
      WHERE tm.user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Apply migration locally**

Run: `supabase db reset`
Expected: All migrations apply successfully including the new one.

- [ ] **Step 3: Update Tenant model**

In `src/client/src/app/core/models/tenant.model.ts`, add `logo_url` to the `Tenant` interface:

```typescript
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260414210000_add_tenant_logo_url.sql src/client/src/app/core/models/tenant.model.ts
git commit -m "feat(db): add logo_url column to tenants table"
```

---

### Task 2: Update sidebar settings navigation

**Files:**
- Modify: `src/client/src/app/core/layout/sidebar.component.ts`

- [ ] **Step 1: Update NAV_SECTIONS settings items**

In `sidebar.component.ts`, change the `settings` section in `NAV_SECTIONS` from:

```typescript
{
  id: 'settings',
  label: 'Settings',
  bottom: true,
  items: [
    { label: 'Taxonomies', route: 'settings/taxonomies' },
    { label: 'Marker Types', route: 'settings/marker-types' },
    { label: 'Organization', route: 'settings/organization' },
    { label: 'Spaces', route: 'settings/spaces' },
  ],
},
```

To:

```typescript
{
  id: 'settings',
  label: 'Settings',
  bottom: true,
  items: [
    { label: 'General', route: 'settings/general' },
    { label: 'Members', route: 'settings/members' },
    { label: 'Taxonomies', route: 'settings/taxonomies' },
    { label: 'Marker Types', route: 'settings/marker-types' },
  ],
},
```

- [ ] **Step 2: Remove ORG_ONLY_SECTIONS or update it**

The `ORG_ONLY_SECTIONS` array (shown when no space is selected) currently has Organization and Spaces. Since org settings are now accessed via the org dropdown and spaces via the space dropdown, this array should be empty. Set it to an empty array:

```typescript
const ORG_ONLY_SECTIONS: NavSection[] = [];
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/sidebar.component.ts
git commit -m "refactor(sidebar): update settings nav to General, Members, Taxonomies, Marker Types"
```

---

### Task 3: Add routes for new settings pages

**Files:**
- Modify: `src/client/src/app/app.routes.ts`
- Modify: `src/client/src/app/core/layout/app-shell.component.ts`

- [ ] **Step 1: Add settings/general and settings/members routes**

In `app.routes.ts`, inside the `s/:spaceId` children array, add these routes after the existing `settings/taxonomies` route:

```typescript
{
  path: 'settings/general',
  loadComponent: () =>
    import('./features/space-settings/space-general.component').then(
      (m) => m.SpaceGeneralComponent,
    ),
},
{
  path: 'settings/members',
  loadComponent: () =>
    import('./features/space-settings/space-members.component').then(
      (m) => m.SpaceMembersComponent,
    ),
},
```

- [ ] **Step 2: Update topbar title mapping**

In `app-shell.component.ts`, add to the `topbarListTitle` computed's `titleMap`:

```typescript
'settings/general': 'General',
'settings/members': 'Members',
```

- [ ] **Step 3: Remove special-case routing for Organization and Spaces**

In `app-shell.component.ts`, the `onNavItemClick` method has special cases for `settings/organization` and `settings/spaces` that route to tenant-level URLs. Remove these since those nav items no longer exist:

```typescript
// REMOVE these lines from onNavItemClick:
if (route === 'settings/organization') {
  this.router.navigate(['/t', this.tenantId(), 'settings']);
  return;
}
if (route === 'settings/spaces') {
  this.router.navigate(['/t', this.tenantId(), 'spaces']);
  return;
}
```

- [ ] **Step 4: Verify build**

Run: `cd src/client && npx ngc --noEmit`
Expected: Errors about missing SpaceGeneralComponent and SpaceMembersComponent -- expected, created in Tasks 4-5.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/app.routes.ts src/client/src/app/core/layout/app-shell.component.ts
git commit -m "feat(routes): add settings/general and settings/members routes"
```

---

### Task 4: Create SpaceGeneralComponent

**Files:**
- Create: `src/client/src/app/features/space-settings/space-general.component.ts`

This page shows space name (editable), description (editable), and a danger zone with delete.

- [ ] **Step 1: Create the component**

```typescript
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';

import { Space } from '../../core/models/space.model';
import { SpaceService } from '../../core/services/space.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-space-general',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputText,
    Textarea,
    MessageModule,
    ManagePageShellComponent,
  ],
  template: `
    <app-manage-page-shell [narrow]="true">
      @if (loading()) {
        <p class="text-sm text-slate-400">Loading...</p>
      } @else if (space()) {
        @if (error()) {
          <p-message severity="error" [closable]="true" (onClose)="error.set(null)" styleClass="mb-4">
            {{ error() }}
          </p-message>
        }
        @if (saved()) {
          <p-message severity="success" [closable]="true" (onClose)="saved.set(false)" styleClass="mb-4">
            Settings saved.
          </p-message>
        }

        <div class="max-w-xl">
          <div class="mb-6">
            <label for="space-name" class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Space name
            </label>
            <input
              pInputText
              id="space-name"
              class="w-full"
              [(ngModel)]="name"
              (blur)="saveIfChanged()"
            />
          </div>

          <div class="mb-6">
            <label for="space-desc" class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Description
            </label>
            <textarea
              pTextarea
              id="space-desc"
              class="w-full"
              [(ngModel)]="description"
              rows="3"
              (blur)="saveIfChanged()"
            ></textarea>
          </div>

          <div class="mt-12 border-t border-slate-200 pt-6">
            <h3 class="text-xs font-semibold text-red-600">Danger zone</h3>
            <p class="mt-1 text-xs text-slate-500">
              Deleting a space removes all its data permanently. This cannot be undone.
            </p>
            <p-button
              label="Delete space"
              severity="danger"
              [outlined]="true"
              size="small"
              styleClass="mt-3"
              (onClick)="confirmDelete()"
            />
          </div>
        </div>
      }
    </app-manage-page-shell>
  `,
})
export class SpaceGeneralComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaceService = inject(SpaceService);
  private confirmation = inject(ConfirmationService);
  private topbarState = inject(TopbarStateService);

  space = signal<Space | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  saved = signal(false);
  name = '';
  description = '';

  private tenantId = '';
  private spaceId = '';

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadSpace();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  async saveIfChanged(): Promise<void> {
    const s = this.space();
    if (!s) return;
    if (this.name.trim() === s.name && (this.description.trim() || '') === (s.description || '')) return;

    try {
      const updated = await this.spaceService.updateSpace(this.spaceId, {
        name: this.name.trim(),
        description: this.description.trim() || null,
      });
      this.space.set(updated);
      this.saved.set(true);
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to save');
    }
  }

  async confirmDelete(): Promise<void> {
    const ok = await new Promise<boolean>((resolve) => {
      this.confirmation.confirm({
        header: 'Delete space',
        message: `Are you sure you want to delete "${this.space()?.name}"? All data in this space will be permanently removed.`,
        acceptLabel: 'Delete',
        acceptButtonStyleClass: 'p-button-danger',
        rejectLabel: 'Cancel',
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
    if (!ok) return;

    try {
      await this.spaceService.deleteSpace(this.spaceId);
      this.router.navigate(['/t', this.tenantId, 'spaces']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to delete space');
    }
  }

  private async loadSpace(): Promise<void> {
    this.loading.set(true);
    try {
      const space = await this.spaceService.getSpace(this.spaceId);
      this.space.set(space);
      this.name = space.name;
      this.description = space.description ?? '';
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src/client && npx ngc --noEmit`
Expected: May still have errors for SpaceMembersComponent -- that's next.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/space-settings/space-general.component.ts
git commit -m "feat(space-settings): add space general settings page (name, description, delete)"
```

---

### Task 5: Create SpaceMembersComponent

**Files:**
- Create: `src/client/src/app/features/space-settings/space-members.component.ts`

This page shows space members with role management, add member (from org members), and remove.

- [ ] **Step 1: Create the component**

```typescript
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Select } from 'primeng/select';
import { MessageModule } from 'primeng/message';

import { SpaceMember } from '../../core/models/space.model';
import { TenantMember } from '../../core/models/tenant.model';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-space-members',
  standalone: true,
  imports: [
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    Select,
    MessageModule,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
  ],
  template: `
    <app-manage-page-shell>
      @if (error()) {
        <p-message severity="error" [closable]="true" (onClose)="error.set(null)" styleClass="mb-4">
          {{ error() }}
        </p-message>
      }

      <p-table
        styleClass="data-table"
        [value]="members()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '48rem' }"
        aria-label="Space members"
      >
        <ng-template #header>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th class="col-actions"></th>
          </tr>
        </ng-template>
        <ng-template #body let-member>
          <tr>
            <td>{{ member.display_name }}</td>
            <td class="col-identifier">{{ member.email }}</td>
            <td>
              <p-select
                [options]="spaceRoleOptions"
                [ngModel]="member.role"
                (ngModelChange)="changeRole(member, $event)"
                optionLabel="label"
                optionValue="value"
                size="small"
                [style]="{ minWidth: '8rem' }"
              />
            </td>
            <td class="col-actions">
              <app-row-actions
                [items]="memberMenu(member)"
                [ariaLabel]="'Actions for ' + member.display_name"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="4">No members.</td>
          </tr>
        </ng-template>
      </p-table>
    </app-manage-page-shell>

    <!-- Add member dialog -->
    <p-dialog
      header="Add member to space"
      [(visible)]="addDialogOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
    >
      <p class="mb-3 text-xs text-slate-500">
        Add an existing organization member to this space. They must be invited to the organization first.
      </p>
      <div class="mb-3">
        <label for="add-member" class="mb-1 block text-sm font-medium text-slate-700">
          Member
        </label>
        <p-select
          inputId="add-member"
          [options]="availableMembers()"
          [(ngModel)]="selectedUserId"
          optionLabel="label"
          optionValue="value"
          [filter]="true"
          filterPlaceholder="Search by email..."
          placeholder="Select a member"
          [style]="{ width: '100%' }"
        />
      </div>
      <div>
        <label for="add-role" class="mb-1 block text-sm font-medium text-slate-700">
          Role
        </label>
        <p-select
          inputId="add-role"
          [options]="spaceRoleOptions"
          [(ngModel)]="selectedRole"
          optionLabel="label"
          optionValue="value"
          [style]="{ width: '100%' }"
        />
      </div>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="addDialogOpen.set(false)" />
        <p-button label="Add member" (onClick)="addMember()" [loading]="adding()" [disabled]="!selectedUserId" />
      </ng-template>
    </p-dialog>
  `,
})
export class SpaceMembersComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private spaceService = inject(SpaceService);
  private tenantService = inject(TenantService);
  private confirmation = inject(ConfirmationService);
  private topbarState = inject(TopbarStateService);

  private readonly menuCache = new Map<string, MenuItem[]>();

  members = signal<SpaceMember[]>([]);
  orgMembers = signal<TenantMember[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  addDialogOpen = signal(false);
  adding = signal(false);
  selectedUserId = '';
  selectedRole: 'owner' | 'editor' | 'viewer' = 'viewer';

  private tenantId = '';
  private spaceId = '';

  readonly spaceRoleOptions = [
    { label: 'Owner', value: 'owner' },
    { label: 'Editor', value: 'editor' },
    { label: 'Viewer', value: 'viewer' },
  ];

  readonly availableMembers = signal<{ label: string; value: string }[]>([]);

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.topbarState.actions.set([
      { label: 'Add member', icon: 'fa-solid fa-plus', callback: () => this.openAddDialog() },
    ]);
    await this.loadData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  memberMenu(member: SpaceMember): MenuItem[] {
    const cached = this.menuCache.get(member.user_id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Remove from space',
        icon: 'fa-solid fa-user-minus',
        styleClass: 'row-actions-danger',
        command: () => this.removeMember(member),
      },
    ];
    this.menuCache.set(member.user_id, items);
    return items;
  }

  async changeRole(member: SpaceMember, newRole: 'owner' | 'editor' | 'viewer'): Promise<void> {
    try {
      await this.spaceService.updateMemberRole(this.spaceId, member.user_id, newRole);
      await this.loadData();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to update role');
    }
  }

  async removeMember(member: SpaceMember): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Remove member',
      message: `Remove ${member.display_name ?? member.email} from this space?`,
      acceptLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await this.spaceService.removeMember(this.spaceId, member.user_id);
      await this.loadData();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to remove member');
    }
  }

  async openAddDialog(): Promise<void> {
    // Refresh org members to compute available list
    const orgMembers = await this.tenantService.listMembers(this.tenantId);
    this.orgMembers.set(orgMembers);
    const spaceUserIds = new Set(this.members().map((m) => m.user_id));
    this.availableMembers.set(
      orgMembers
        .filter((m) => !spaceUserIds.has(m.user_id))
        .map((m) => ({ label: m.email ?? m.display_name ?? m.user_id, value: m.user_id })),
    );
    this.selectedUserId = '';
    this.selectedRole = 'viewer';
    this.addDialogOpen.set(true);
  }

  async addMember(): Promise<void> {
    if (!this.selectedUserId) return;
    this.adding.set(true);
    try {
      await this.spaceService.addMember(this.spaceId, this.selectedUserId, this.selectedRole);
      this.addDialogOpen.set(false);
      await this.loadData();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to add member');
    } finally {
      this.adding.set(false);
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      this.members.set(await this.spaceService.listMembers(this.spaceId));
      this.menuCache.clear();
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && npx ngc --noEmit`
Expected: Build succeeds (all routes now resolve).

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/space-settings/space-members.component.ts
git commit -m "feat(space-settings): add space members page with role management"
```

---

### Task 6: Enhance topbar dropdowns

**Files:**
- Modify: `src/client/src/app/core/layout/contextual-topbar.component.ts`

Add footer links to both org and space dropdowns. Make org dropdown always interactive.

- [ ] **Step 1: Update org dropdown to always be interactive**

In the topbar template, the org section currently has two branches: one for `tenants().length >= 2` (interactive dropdown) and one for single tenant (static text). Replace the single-tenant branch so it's also clickable and shows a dropdown with just the settings link.

Change the `@else` branch (`.org-static`) to be a button that opens the dropdown with only the settings link:

```html
} @else {
  <div class="org-switcher">
    <button type="button" class="org-btn" (click)="orgDropdownOpen.set(!orgDropdownOpen())"
      [attr.aria-expanded]="orgDropdownOpen()">
      <span class="org-badge">{{ orgInitial() }}</span>
      <span class="org-name">{{ tenantName() }}</span>
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true" class="chevron">
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    @if (orgDropdownOpen()) {
      <div class="dropdown" role="listbox">
        <button type="button" class="dropdown-item dropdown-item--footer" (click)="onOrgSettingsClick()">
          <i class="fa-solid fa-gear text-[10px]"></i> Organization settings
        </button>
      </div>
    }
  </div>
}
```

- [ ] **Step 2: Add "Organization settings" link to multi-tenant org dropdown**

In the existing multi-tenant dropdown (the `@if (tenants().length >= 2)` branch), add a footer link after the tenant list:

```html
<div class="dropdown-footer">
  <button type="button" class="dropdown-item dropdown-item--footer" (click)="onOrgSettingsClick()">
    <i class="fa-solid fa-gear text-[10px]"></i> Organization settings
  </button>
</div>
```

- [ ] **Step 3: Add footer to space dropdown**

In the space dropdown, after the space list items, add a footer with "Space settings" and "New space":

```html
<div class="dropdown-footer">
  <button type="button" class="dropdown-item dropdown-item--footer" (click)="onSpaceSettingsClick()">
    <i class="fa-solid fa-gear text-[10px]"></i> Space settings
  </button>
  <button type="button" class="dropdown-item dropdown-item--footer" (click)="onNewSpaceClick()">
    <i class="fa-solid fa-plus text-[10px]"></i> New space
  </button>
</div>
```

- [ ] **Step 4: Add new outputs and methods**

Add three new outputs to the component class:

```typescript
readonly orgSettingsClick = output<void>();
readonly spaceSettingsClick = output<void>();
readonly newSpaceClick = output<void>();
```

Add handler methods:

```typescript
onOrgSettingsClick(): void {
  this.orgDropdownOpen.set(false);
  this.orgSettingsClick.emit();
}

onSpaceSettingsClick(): void {
  this.spaceDropdownOpen.set(false);
  this.spaceSettingsClick.emit();
}

onNewSpaceClick(): void {
  this.spaceDropdownOpen.set(false);
  this.newSpaceClick.emit();
}
```

- [ ] **Step 5: Add footer CSS**

Add to the component styles:

```css
.dropdown-footer {
  border-top: 1px solid #e2e8f0;
}

.dropdown-item--footer {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-size: 11px;
}
.dropdown-item--footer:hover {
  color: #0f172a;
}
```

- [ ] **Step 6: Add logo_url input and conditional rendering**

Add a `tenantLogoUrl` input:

```typescript
readonly tenantLogoUrl = input<string | null>(null);
```

In the org badge, conditionally show the logo image instead of the initial letter:

```html
@if (tenantLogoUrl()) {
  <img [src]="tenantLogoUrl()" class="org-badge-img" alt="" />
} @else {
  <span class="org-badge">{{ orgInitial() }}</span>
}
```

Add CSS for the logo image:

```css
.org-badge-img {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/core/layout/contextual-topbar.component.ts
git commit -m "feat(topbar): add settings and new-space links to dropdowns, support logo"
```

---

### Task 7: Wire new topbar outputs in AppShellComponent

**Files:**
- Modify: `src/client/src/app/core/layout/app-shell.component.ts`

- [ ] **Step 1: Add event handlers for new topbar outputs**

In the `<app-contextual-topbar>` template tag, add bindings for the new outputs:

```html
(orgSettingsClick)="onOrgSettingsClick()"
(spaceSettingsClick)="onSpaceSettingsClick()"
(newSpaceClick)="onNewSpaceClick()"
```

Also add the `tenantLogoUrl` input:

```html
[tenantLogoUrl]="currentTenantLogoUrl()"
```

- [ ] **Step 2: Add handler methods and computed**

```typescript
readonly currentTenantLogoUrl = computed(() => {
  const id = this.tenantId();
  const tenant = this.tenants().find((t) => t.id === id);
  return tenant?.logo_url ?? null;
});

onOrgSettingsClick(): void {
  this.router.navigate(['/t', this.tenantId(), 'settings']);
}

onSpaceSettingsClick(): void {
  if (this.spaceId()) {
    this.navigateToSpaceRoute('settings/general');
  }
}

onNewSpaceClick(): void {
  this.createSpaceDialogOpen.set(true);
}
```

- [ ] **Step 3: Add create space dialog**

Add a signal and the dialog template. Reuse the same create-space pattern from `SpaceListComponent`:

Add to the class:

```typescript
readonly createSpaceDialogOpen = signal(false);
readonly creatingSpace = signal(false);
readonly createSpaceError = signal<string | null>(null);
newSpaceName = '';
newSpaceDesc = '';
```

Add to the template (after the account menu block):

```html
<!-- Create space dialog -->
<p-dialog
  header="Create space"
  [(visible)]="createSpaceDialogOpen"
  [modal]="true"
  [style]="{ width: '32rem' }"
  (onHide)="resetCreateSpaceForm()"
>
  <form (ngSubmit)="createSpace()" class="space-y-4">
    <p class="text-xs text-slate-500">
      A space is a workspace for organizing and visualizing a set of clinical trials.
    </p>
    <div>
      <label for="new-space-name" class="mb-1 block text-sm font-medium text-slate-700">Name</label>
      <input pInputText id="new-space-name" class="w-full" [(ngModel)]="newSpaceName" name="spaceName" placeholder="e.g. SGLT2 Pipeline" required />
    </div>
    <div>
      <label for="new-space-desc" class="mb-1 block text-sm font-medium text-slate-700">Description</label>
      <textarea pTextarea id="new-space-desc" class="w-full" [(ngModel)]="newSpaceDesc" name="spaceDesc" rows="2" placeholder="Optional description"></textarea>
    </div>
    @if (createSpaceError()) {
      <p-message severity="error" [closable]="false">{{ createSpaceError() }}</p-message>
    }
  </form>
  <ng-template #footer>
    <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="createSpaceDialogOpen.set(false)" />
    <p-button label="Create space" (onClick)="createSpace()" [loading]="creatingSpace()" />
  </ng-template>
</p-dialog>
```

Add the imports for `Dialog`, `InputText`, `Textarea`, `MessageModule`, `FormsModule` to the component imports array.

Add the methods:

```typescript
resetCreateSpaceForm(): void {
  this.newSpaceName = '';
  this.newSpaceDesc = '';
  this.createSpaceError.set(null);
}

async createSpace(): Promise<void> {
  if (!this.newSpaceName.trim()) return;
  this.creatingSpace.set(true);
  this.createSpaceError.set(null);
  try {
    const space = await this.spaceService.createSpace(
      this.tenantId(),
      this.newSpaceName.trim(),
      this.newSpaceDesc.trim() || undefined,
    );
    this.createSpaceDialogOpen.set(false);
    this.resetCreateSpaceForm();
    this.switchSpace(space.id);
  } catch (e) {
    this.createSpaceError.set(e instanceof Error ? e.message : 'Failed to create space');
  } finally {
    this.creatingSpace.set(false);
  }
}
```

- [ ] **Step 4: Verify build**

Run: `cd src/client && npx ngc --noEmit`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/layout/app-shell.component.ts
git commit -m "feat(shell): wire topbar dropdown actions, add create space dialog"
```

---

### Task 8: Redesign TenantSettingsComponent

**Files:**
- Modify: `src/client/src/app/features/tenant-settings/tenant-settings.component.ts`

Add org name editing, logo upload, and role change dropdown for members.

- [ ] **Step 1: Add name editing section to template**

Add an org identity section at the top of the template, before the members section:

```html
<!-- Org identity -->
<div class="mb-8 max-w-xl">
  <div class="flex items-start gap-4">
    <!-- Logo upload -->
    <div class="flex flex-col items-center gap-2">
      @if (tenant()?.logo_url) {
        <img [src]="tenant()!.logo_url" class="h-16 w-16 rounded-xl object-cover border border-slate-200" alt="Organization logo" />
        <button type="button" class="text-[10px] text-slate-400 hover:text-red-500" (click)="removeLogo()">Remove</button>
      } @else {
        <label class="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-[10px] text-slate-400 hover:border-teal-400 hover:text-teal-500 transition-colors">
          Logo
          <input type="file" class="hidden" accept="image/png,image/jpeg,image/svg+xml" (change)="onLogoSelect($event)" />
        </label>
      }
    </div>
    <div class="flex-1">
      <label for="org-name" class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        Organization name
      </label>
      <input
        pInputText
        id="org-name"
        class="w-full"
        [(ngModel)]="orgName"
        (blur)="saveOrgName()"
      />
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add role change dropdown to members table**

Replace the static `<app-status-tag>` for member role with an editable `<p-select>`:

```html
<td>
  <p-select
    [options]="roleOptions"
    [ngModel]="member.role"
    (ngModelChange)="changeMemberRole(member, $event)"
    optionLabel="label"
    optionValue="value"
    size="small"
    [style]="{ minWidth: '8rem' }"
  />
</td>
```

- [ ] **Step 3: Add methods for name editing, role change, and logo**

Add to the class:

```typescript
orgName = '';

async saveOrgName(): Promise<void> {
  const t = this.tenant();
  if (!t || this.orgName.trim() === t.name) return;
  try {
    const updated = await this.tenantService.updateTenant(this.tenantId, { name: this.orgName.trim() });
    this.tenant.set(updated);
  } catch (e) {
    this.removeError.set(e instanceof Error ? e.message : 'Failed to update name');
  }
}

async changeMemberRole(member: TenantMember, newRole: 'owner' | 'member'): Promise<void> {
  try {
    await this.tenantService.updateMemberRole(this.tenantId, member.user_id, newRole);
    await this.loadData();
  } catch (e) {
    this.removeError.set(e instanceof Error ? e.message : 'Failed to update role');
  }
}

async onLogoSelect(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    this.removeError.set('Logo must be under 2MB');
    return;
  }
  try {
    const logoUrl = await this.tenantService.uploadLogo(this.tenantId, file);
    const updated = await this.tenantService.updateTenant(this.tenantId, { logo_url: logoUrl });
    this.tenant.set(updated);
  } catch (e) {
    this.removeError.set(e instanceof Error ? e.message : 'Failed to upload logo');
  }
}

async removeLogo(): Promise<void> {
  try {
    await this.tenantService.deleteLogo(this.tenantId);
    const updated = await this.tenantService.updateTenant(this.tenantId, { logo_url: null });
    this.tenant.set(updated);
  } catch (e) {
    this.removeError.set(e instanceof Error ? e.message : 'Failed to remove logo');
  }
}
```

Update `ngOnInit` to set `orgName`:

```typescript
// After loadData():
this.orgName = this.tenant()?.name ?? '';
```

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/tenant-settings/tenant-settings.component.ts
git commit -m "feat(tenant-settings): add name editing, logo upload, role management"
```

---

### Task 9: Add logo upload methods to TenantService

**Files:**
- Modify: `src/client/src/app/core/services/tenant.service.ts`

- [ ] **Step 1: Add updateMemberRole method**

```typescript
async updateMemberRole(tenantId: string, userId: string, role: 'owner' | 'member'): Promise<void> {
  const { error } = await this.supabase.client
    .from('tenant_members')
    .update({ role })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId);
  if (error) throw error;
}
```

- [ ] **Step 2: Add uploadLogo and deleteLogo methods**

```typescript
async uploadLogo(tenantId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'png';
  const path = `${tenantId}/logo.${ext}`;

  const { error: uploadError } = await this.supabase.client.storage
    .from('tenant-logos')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = this.supabase.client.storage
    .from('tenant-logos')
    .getPublicUrl(path);

  return data.publicUrl;
}

async deleteLogo(tenantId: string): Promise<void> {
  // List files in the tenant's folder and delete them
  const { data: files } = await this.supabase.client.storage
    .from('tenant-logos')
    .list(tenantId);

  if (files && files.length > 0) {
    const paths = files.map((f) => `${tenantId}/${f.name}`);
    await this.supabase.client.storage.from('tenant-logos').remove(paths);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/core/services/tenant.service.ts
git commit -m "feat(tenant-service): add logo upload and delete methods"
```

---

### Task 10: Lint, build, and verify

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

Run: `cd src/client && ng lint`
Expected: No errors from our changes.

- [ ] **Step 2: Run Angular compile check**

Run: `cd src/client && npx ngc --noEmit`
Expected: Clean compile (may have pre-existing warnings).

- [ ] **Step 3: Manual browser verification**

Start dev server: `cd src/client && ng serve`

Verify:
1. **Sidebar settings section:** Shows General, Members, Taxonomies, Marker Types (not Organization, Spaces)
2. **Settings > General:** Shows space name and description (editable), danger zone with delete
3. **Settings > Members:** Shows space members table with role dropdowns, add member button works
4. **Org dropdown:** Click org name -- shows org list (if multi-tenant) + "Organization settings" link
5. **Space dropdown:** Click space name -- shows spaces + "Space settings" and "New space" links
6. **Organization settings page:** Shows name (editable), logo upload area, members with role dropdowns, invites
7. **"New space" from dropdown:** Opens create space dialog, creating a space works

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(settings): address issues found during org/space settings verification"
```
