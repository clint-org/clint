# Navigation and Layout Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four interrelated UX issues: sidebar always pushes content, topbar owns all page identity with org/space breadcrumb, remove redundant in-page headers, and add filter chip summary to landscape views.

**Architecture:** The shell layout (sidebar + topbar + content) is restructured so the sidebar always uses `position: relative`, the topbar gains org/space breadcrumb + page-specific identity (title/tabs/back), in-page headers are removed, and landscape filter bar gets a chip summary row. A new `TopbarStateService` lets routed pages contribute titles, counts, and action configs to the topbar.

**Tech Stack:** Angular 19 (standalone components, signals), PrimeNG 19, Tailwind CSS v4

---

### Task 1: Create TopbarStateService

**Files:**
- Create: `src/client/src/app/core/services/topbar-state.service.ts`

This service lets routed page components declare their topbar title, record count, and action buttons. The shell reads these signals and renders them in the topbar. Each page sets them on init and clears on destroy.

- [ ] **Step 1: Create the service file**

```typescript
// src/client/src/app/core/services/topbar-state.service.ts
import { Injectable, signal } from '@angular/core';

export interface TopbarAction {
  label: string;
  icon: string;
  severity?: string;
  outlined?: boolean;
  text?: boolean;
  callback: () => void;
}

@Injectable({ providedIn: 'root' })
export class TopbarStateService {
  /** Page title shown in topbar for list pages (e.g., "Events", "Companies"). */
  readonly title = signal('');

  /** Section eyebrow for detail pages (e.g., "Novo Nordisk"). */
  readonly entityContext = signal('');

  /** Entity title for detail pages (e.g., "TRIM-1"). */
  readonly entityTitle = signal('');

  /** Record count displayed beside the title (e.g., "247"). */
  readonly recordCount = signal('');

  /** Action buttons rendered in the topbar-actions area. */
  readonly actions = signal<TopbarAction[]>([]);

  /** Reset all page-specific state (call from page OnDestroy). */
  clear(): void {
    this.title.set('');
    this.entityContext.set('');
    this.entityTitle.set('');
    this.recordCount.set('');
    this.actions.set([]);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Build succeeds (unused service is tree-shaken, no errors).

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/topbar-state.service.ts
git commit -m "feat(layout): add TopbarStateService for page-to-topbar communication"
```

---

### Task 2: Simplify SidebarComponent (remove overlay, remove org/space)

**Files:**
- Modify: `src/client/src/app/core/layout/sidebar.component.ts`

Remove the overlay CSS rule (`.sidebar--expanded:not(.sidebar--pinned)`), remove org/space template markup and inputs, and simplify the header to logo + pin toggle only.

- [ ] **Step 1: Remove org/space template markup from the sidebar header**

In `sidebar.component.ts`, replace the logo row template section. The current logo row contains the org selector/name, space picker, and pin button. Replace with just logo + pin:

```typescript
      <!-- Logo row -->
      <div class="sidebar__logo">
        <button
          type="button"
          class="logo-btn"
          aria-label="Go to home"
          (click)="logoClick.emit()"
        >
          <div class="logo-square">C</div>
        </button>

        @if (isExpanded()) {
          <div class="flex-1"></div>
          <!-- Pin button -->
          <button
            type="button"
            class="pin-btn"
            [class.pin-btn--pinned]="pinned()"
            (click)="pinToggle.emit()"
            [attr.aria-label]="pinned() ? 'Unpin sidebar' : 'Pin sidebar'"
            [attr.aria-pressed]="pinned()"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 1.5L12.5 4L11 7.5V10H5V7.5L3.5 4L6 1.5H10Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
              <line x1="8" y1="10" x2="8" y2="14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </button>
        }
      </div>
```

- [ ] **Step 2: Remove org/space inputs from the component class**

Remove these inputs from the `SidebarComponent` class:

```typescript
  // REMOVE these inputs:
  // readonly tenantName = input<string>('');
  // readonly tenants = input<{ id: string; name: string }[]>([]);
  // readonly currentTenantId = input<string>('');
  // readonly spaceName = input<string>('');
  // readonly spaces = input<{ id: string; name: string }[]>([]);
  // readonly currentSpaceId = input<string>('');

  // REMOVE these outputs:
  // readonly tenantChange = output<string>();
  // readonly spaceChange = output<string>();

  // REMOVE this field:
  // spacePickerOpen = false;
```

Also remove the `FormsModule` and `Select` imports since they were only used for the tenant dropdown. Remove them from the `imports` array and the import statements.

- [ ] **Step 3: Remove overlay CSS**

In the styles array, remove the `.sidebar--expanded:not(.sidebar--pinned)` rule entirely:

```css
/* REMOVE this entire rule: */
.sidebar--expanded:not(.sidebar--pinned) {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 40;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.2);
}
```

Also remove the `.sidebar--pinned` rule since both states now use the same positioning:

```css
/* REMOVE: */
.sidebar--pinned {
  position: relative;
}
```

Remove the org/space-related CSS rules: `.logo-text`, `.org-name`, `.space-picker-btn`, `.space-picker-btn:hover`, `.space-picker-btn:focus-visible`, `.space-name-text`, `.space-chevron`, `.space-chevron--open`, `.space-dropdown`, `.space-dropdown-item`, `.space-dropdown-item:hover`, `.space-dropdown-item--active`, and the PrimeNG Select override block (`:host ::ng-deep .sidebar-select`).

- [ ] **Step 4: Remove selectSpace method**

Remove the `selectSpace` method from the component class since space selection now happens in the topbar.

- [ ] **Step 5: Verify it compiles**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Compile errors in `app-shell.component.ts` because it still passes removed inputs -- that's expected and will be fixed in Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/layout/sidebar.component.ts
git commit -m "refactor(sidebar): remove overlay mode and org/space UI, simplify to logo + pin"
```

---

### Task 3: Redesign ContextualTopbarComponent

**Files:**
- Modify: `src/client/src/app/core/layout/contextual-topbar.component.ts`

Add org/space breadcrumb, org/space dropdown logic, and page-specific content (list title+count+actions from `TopbarStateService`). The topbar becomes the single source of page identity.

- [ ] **Step 1: Rewrite the topbar component**

Replace the entire component. The new topbar structure:
- Left: Org badge + name (dropdown if 2+ tenants) / Space name (dropdown) | page-specific content
- Right: record count + action buttons + projected content (notification bell)

```typescript
import { Component, computed, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TopbarAction } from '../services/topbar-state.service';

export interface TopbarTab {
  label: string;
  value: string;
  active: boolean;
}

@Component({
  selector: 'app-contextual-topbar',
  standalone: true,
  imports: [ButtonModule],
  template: `
    <div class="topbar" role="banner">
      <!-- Org / Space breadcrumb -->
      <div class="breadcrumb">
        @if (tenants().length >= 2) {
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
                @for (t of tenants(); track t.id) {
                  <button type="button" class="dropdown-item" role="option"
                    [class.dropdown-item--active]="t.id === currentTenantId()"
                    (click)="onTenantSelect(t.id)">
                    {{ t.name }}
                  </button>
                }
              </div>
            }
          </div>
        } @else {
          <div class="org-static">
            <span class="org-badge">{{ orgInitial() }}</span>
            <span class="org-name">{{ tenantName() }}</span>
          </div>
        }

        <span class="breadcrumb-sep">/</span>

        @if (hasSpace()) {
          <div class="space-switcher">
            <button type="button" class="space-btn" (click)="spaceDropdownOpen.set(!spaceDropdownOpen())"
              [attr.aria-expanded]="spaceDropdownOpen()">
              <span class="space-name">{{ spaceName() }}</span>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true" class="chevron">
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            @if (spaceDropdownOpen()) {
              <div class="dropdown" role="listbox">
                @for (s of spaces(); track s.id) {
                  <button type="button" class="dropdown-item" role="option"
                    [class.dropdown-item--active]="s.id === currentSpaceId()"
                    (click)="onSpaceSelect(s.id)">
                    {{ s.name }}
                  </button>
                }
              </div>
            }
          </div>
        } @else {
          <span class="space-name" style="color: #94a3b8; font-size: 11px;">Select space</span>
        }
      </div>

      <!-- Divider between breadcrumb and page content -->
      @if (pageType() !== 'blank') {
        <div class="topbar-divider" aria-hidden="true"></div>
      }

      <!-- Page-specific content -->
      @switch (pageType()) {
        @case ('landscape') {
          <span class="topbar-section-label">Landscape</span>
          <div class="topbar-divider" aria-hidden="true"></div>
          <div role="tablist" class="flex items-center">
            @for (tab of tabs(); track tab.value) {
              <button
                role="tab"
                [attr.aria-selected]="tab.active"
                [class]="tab.active ? 'topbar-tab active' : 'topbar-tab'"
                (click)="onTabClick(tab.value)"
              >
                {{ tab.label }}
              </button>
            }
          </div>
        }
        @case ('list') {
          @if (listTitle()) {
            <span class="topbar-list-title">{{ listTitle() }}</span>
          }
        }
        @case ('detail') {
          <button
            class="topbar-back"
            (click)="onBackClick()"
            [attr.aria-label]="'Go back to ' + backLabel()"
          >
            <span aria-hidden="true">&larr;</span>
            <span>{{ backLabel() }}</span>
          </button>
          <div class="topbar-divider" aria-hidden="true"></div>
          <div class="flex flex-col justify-center">
            @if (entityContext()) {
              <span class="topbar-eyebrow">{{ entityContext() }}</span>
            }
            @if (entityTitle()) {
              <span class="topbar-detail-title">{{ entityTitle() }}</span>
            }
          </div>
        }
      }

      <!-- Right-side actions -->
      <div class="topbar-actions">
        @if (recordCount()) {
          <span class="topbar-record-count">{{ recordCount() }}</span>
        }
        @for (action of actionButtons(); track action.label) {
          <p-button
            [label]="action.label"
            [icon]="action.icon"
            [severity]="action.severity ?? 'secondary'"
            [outlined]="action.outlined ?? true"
            [text]="action.text ?? false"
            size="small"
            (onClick)="action.callback()"
          />
        }
        <ng-content select="[topbar-actions]"></ng-content>
      </div>
    </div>
  `,
  styles: [
    \`
      :host { display: block; }

      .topbar {
        display: flex;
        align-items: center;
        height: 42px;
        padding: 0 16px;
        background: white;
        border-bottom: 1px solid #e2e8f0;
      }

      /* Breadcrumb: Org / Space */
      .breadcrumb {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .org-switcher, .space-switcher {
        position: relative;
      }

      .org-btn, .org-static {
        display: flex;
        align-items: center;
        gap: 5px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        outline: none;
      }
      .org-static { cursor: default; }
      .org-btn:focus-visible, .space-btn:focus-visible {
        outline: 2px solid #0d9488;
        outline-offset: 2px;
        border-radius: 4px;
      }

      .org-badge {
        width: 20px;
        height: 20px;
        background: #0d9488;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 10px;
        font-weight: 700;
        flex-shrink: 0;
      }

      .org-name {
        font-size: 11px;
        color: #64748b;
        white-space: nowrap;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .chevron { color: #cbd5e1; flex-shrink: 0; }

      .breadcrumb-sep {
        font-size: 11px;
        color: #cbd5e1;
        user-select: none;
      }

      .space-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 5px;
        cursor: pointer;
        outline: none;
        transition: border-color 120ms ease;
      }
      .space-btn:hover { border-color: #cbd5e1; }

      .space-name {
        font-size: 11px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
      }

      .dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 180px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
        z-index: 50;
        overflow: hidden;
      }

      .dropdown-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 12px;
        font-size: 12px;
        color: #475569;
        background: transparent;
        border: none;
        cursor: pointer;
        outline: none;
      }
      .dropdown-item:hover { color: #0f172a; background: #f8fafc; }
      .dropdown-item--active { color: #0d9488; font-weight: 500; }
      .dropdown-item:focus-visible { outline: 2px solid #0d9488; outline-offset: -2px; }

      /* Dividers and page content */
      .topbar-divider {
        width: 1px;
        height: 16px;
        background: #e2e8f0;
        margin: 0 12px;
        flex-shrink: 0;
      }

      .topbar-section-label {
        font-size: 12px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
      }

      .topbar-list-title {
        font-size: 13px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
      }

      .topbar-tab {
        font-size: 11px;
        padding: 11px 0;
        margin-right: 16px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        color: #64748b;
        background: none;
        border-top: none;
        border-left: none;
        border-right: none;
        transition: color 120ms ease-out;
        white-space: nowrap;
      }
      .topbar-tab:hover { color: #0f172a; }
      .topbar-tab.active {
        color: #0d9488;
        font-weight: 500;
        border-bottom-color: #0d9488;
      }
      .topbar-tab:focus-visible {
        outline: 2px solid #0d9488;
        outline-offset: 2px;
      }

      .topbar-eyebrow {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #94a3b8;
        line-height: 1;
      }

      .topbar-detail-title {
        font-size: 12px;
        font-weight: 600;
        color: #0f172a;
        line-height: 1.3;
      }

      .topbar-back {
        font-size: 11px;
        color: #94a3b8;
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        transition: color 120ms ease-out;
      }
      .topbar-back:hover { color: #64748b; }
      .topbar-back:focus-visible {
        outline: 2px solid #0d9488;
        outline-offset: 2px;
      }

      .topbar-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .topbar-record-count {
        font-size: 11px;
        color: #94a3b8;
      }
    \`,
  ],
})
export class ContextualTopbarComponent {
  // Org/Space data
  readonly tenantName = input<string>('');
  readonly tenants = input<{ id: string; name: string }[]>([]);
  readonly currentTenantId = input<string>('');
  readonly spaceName = input<string>('');
  readonly spaces = input<{ id: string; name: string }[]>([]);
  readonly currentSpaceId = input<string>('');
  readonly hasSpace = input<boolean>(false);

  // Page type selector
  readonly pageType = input<'landscape' | 'list' | 'detail' | 'blank'>('blank');

  // Landscape mode
  readonly tabs = input<TopbarTab[]>([]);

  // List mode
  readonly listTitle = input<string>('');
  readonly recordCount = input<string>('');

  // Detail mode
  readonly backLabel = input<string>('');
  readonly entityContext = input<string>('');
  readonly entityTitle = input<string>('');

  // Action buttons from TopbarStateService
  readonly actionButtons = input<TopbarAction[]>([]);

  // Outputs
  readonly tabClick = output<string>();
  readonly backClick = output<void>();
  readonly tenantChange = output<string>();
  readonly spaceChange = output<string>();

  // Dropdown state
  readonly orgDropdownOpen = signal(false);
  readonly spaceDropdownOpen = signal(false);

  readonly orgInitial = computed(() => {
    const name = this.tenantName();
    return name ? name[0].toUpperCase() : '?';
  });

  onTabClick(value: string): void {
    this.tabClick.emit(value);
  }

  onBackClick(): void {
    this.backClick.emit();
  }

  onTenantSelect(tenantId: string): void {
    this.orgDropdownOpen.set(false);
    this.tenantChange.emit(tenantId);
  }

  onSpaceSelect(spaceId: string): void {
    this.spaceDropdownOpen.set(false);
    this.spaceChange.emit(spaceId);
  }
}
```

**Note on template literal:** The backticks in the `styles` array above use escaped backticks (`\``) for the plan document. In the actual code, use normal backticks.

- [ ] **Step 2: Verify it compiles**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Compile errors in `app-shell.component.ts` because it still uses old inputs -- expected, fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/contextual-topbar.component.ts
git commit -m "feat(topbar): add org/space breadcrumb and unified page identity"
```

---

### Task 4: Rewire AppShellComponent

**Files:**
- Modify: `src/client/src/app/core/layout/app-shell.component.ts`

Move org/space data from sidebar to topbar. Wire `TopbarStateService` signals into the topbar. Remove old sidebar bindings. Add click-outside handler for topbar dropdowns.

- [ ] **Step 1: Add TopbarStateService injection and update imports**

Add at the top of the class:

```typescript
private readonly topbarState = inject(TopbarStateService);
```

Add the import:

```typescript
import { TopbarStateService } from '../services/topbar-state.service';
```

- [ ] **Step 2: Remove org/space bindings from the sidebar template**

In the `<app-sidebar>` template tag, remove these bindings:

```
[tenantName]="currentTenantName()"
[tenants]="tenants()"
[currentTenantId]="tenantId()"
[spaceName]="currentSpaceName()"
[spaces]="spaces()"
[currentSpaceId]="spaceId()"
(tenantChange)="switchTenant($event)"
(spaceChange)="switchSpace($event)"
```

The sidebar tag should now look like:

```html
<app-sidebar
  [expanded]="sidebarHovering()"
  [pinned]="sidebarPinned()"
  [activeRoute]="activeSpaceRoute()"
  [hasSpace]="!!spaceId()"
  [userInitials]="initials()"
  [userEmail]="user()?.email ?? ''"
  (pinToggle)="togglePin()"
  (navItemClick)="onNavItemClick($event)"
  (logoClick)="onLogoClick()"
  (avatarClick)="toggleAccount()"
  (sectionClick)="onSectionClick($any($event))"
  (hoverChange)="onSidebarHoverChange($event)"
/>
```

- [ ] **Step 3: Add org/space and state bindings to the topbar template**

Update the `<app-contextual-topbar>` tag to pass org/space data and `TopbarStateService` signals:

```html
<app-contextual-topbar
  [pageType]="pageType()"
  [tenantName]="currentTenantName()"
  [tenants]="tenants()"
  [currentTenantId]="tenantId()"
  [spaceName]="currentSpaceName()"
  [spaces]="spaces()"
  [currentSpaceId]="spaceId()"
  [hasSpace]="!!spaceId()"
  [tabs]="landscapeTabs()"
  [listTitle]="topbarListTitle()"
  [recordCount]="topbarState.recordCount()"
  [backLabel]="topbarBackLabel()"
  [entityContext]="topbarState.entityContext()"
  [entityTitle]="topbarState.entityTitle()"
  [actionButtons]="topbarState.actions()"
  (tabClick)="onLandscapeTabClick($event)"
  (backClick)="onBackClick()"
  (tenantChange)="switchTenant($event)"
  (spaceChange)="switchSpace($event)"
>
  <div topbar-actions class="flex items-center gap-3">
    @if (spaceId()) {
      <app-notification-bell [spaceId]="spaceId()" />
    }
  </div>
</app-contextual-topbar>
```

- [ ] **Step 4: Rename topbarTitle to topbarListTitle and remove topbarEyebrow**

The `topbarEyebrow` computed is no longer needed (the topbar no longer shows an eyebrow for list pages). Rename `topbarTitle` to `topbarListTitle` and keep the same logic:

```typescript
readonly topbarListTitle = computed(() => {
  const route = this.activeSpaceRoute();
  const titleMap: Record<string, string> = {
    'manage/companies': 'Companies',
    'manage/products': 'Products',
    'manage/trials': 'Trials',
    events: 'Events',
    catalysts: 'Catalysts',
    'settings/taxonomies': 'Taxonomies',
    'settings/marker-types': 'Marker Types',
    'settings/organization': 'Organization',
    'settings/spaces': 'Spaces',
  };
  return titleMap[route] ?? this.topbarState.title();
});
```

Remove the `topbarEyebrow` computed and the `topbarRecordCount` signal (the topbar now reads `recordCount` from `TopbarStateService`). Also remove `topbarEntityContext` and `topbarEntityTitle` signals since the topbar now reads those from `TopbarStateService` too.

- [ ] **Step 5: Verify it compiles and test in browser**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Build succeeds.

Run: `cd src/client && npx ng serve`
Verify: Open the app, confirm org/space breadcrumb appears in topbar, sidebar no longer shows org/space, sidebar push behavior works on hover and pin.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/layout/app-shell.component.ts
git commit -m "refactor(shell): wire org/space to topbar, connect TopbarStateService"
```

---

### Task 5: Strip ManagePageShellComponent to padding wrapper

**Files:**
- Modify: `src/client/src/app/shared/components/manage-page-shell.component.ts`
- Modify: `src/client/src/app/shared/styles/page-shell.css`

Remove the eyebrow, title row, count badge, subtitle, and action slot. Keep only the padding wrapper with the `narrow` option.

- [ ] **Step 1: Strip the component template**

Replace the template with a simple wrapper:

```typescript
@Component({
  selector: 'app-manage-page-shell',
  standalone: true,
  template: `
    <div class="page-shell" [class.page-shell--narrow]="narrow()">
      <ng-content />
    </div>
  `,
})
export class ManagePageShellComponent {
  /** Cap the shell to a narrower width for form-heavy detail pages. */
  readonly narrow = input<boolean>(false);
}
```

Remove the `eyebrow`, `title`, `subtitle`, and `count` inputs.

- [ ] **Step 2: Strip page-shell.css**

Replace the CSS with only the wrapper styles:

```css
.page-shell {
  width: 100%;
  padding: 1rem 2rem 4rem;
}

.page-shell--narrow {
  max-width: 72rem;
  margin-left: auto;
  margin-right: auto;
}
```

Remove `.page-shell__eyebrow`, `.page-shell__title-row`, `.page-shell__title`, `.page-shell__count`, `.page-shell__subtitle`, `.page-shell__actions`.

- [ ] **Step 3: Verify it compiles**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Compile errors in pages that pass `eyebrow`, `title`, `count`, `subtitle` inputs -- expected, will be fixed in Tasks 6-8.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/manage-page-shell.component.ts src/client/src/app/shared/styles/page-shell.css
git commit -m "refactor(page-shell): strip to padding-only wrapper, remove title/eyebrow/actions"
```

---

### Task 6: Migrate list pages to use TopbarStateService (Manage section)

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-list.component.html`
- Modify: `src/client/src/app/features/manage/companies/company-list.component.ts`
- Modify: `src/client/src/app/features/manage/products/product-list.component.html`
- Modify: `src/client/src/app/features/manage/products/product-list.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.html`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Modify: `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html`
- Modify: `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts`
- Modify: `src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.html`
- Modify: `src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.ts`
- Modify: `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-list.component.html`
- Modify: `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-list.component.ts`
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-list.component.html`
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-list.component.ts`
- Modify: `src/client/src/app/features/manage/taxonomies/taxonomies-page.component.ts`

For each page:
1. Remove `eyebrow`, `title`, `count`, `subtitle` bindings from `<app-manage-page-shell>`
2. Remove the `<div actions>` block from within the shell
3. Inject `TopbarStateService` and set `recordCount` and `actions` on init
4. Clear state on destroy

The pattern for each page is the same. Here is the example for company-list:

- [ ] **Step 1: Update company-list HTML**

In `company-list.component.html`, change the opening `<app-manage-page-shell>` tag from:

```html
<app-manage-page-shell
  eyebrow="Manage"
  title="Companies"
  [count]="grid.totalRecords()"
  subtitle="Drug program sponsors tracked in this space."
>
  <div actions>
    <p-button
      label="Add company"
      icon="fa-solid fa-plus"
      severity="secondary"
      [outlined]="true"
      size="small"
      (onClick)="openCreateModal()"
    />
  </div>
```

To:

```html
<app-manage-page-shell>
```

Remove the `<div actions>` block entirely.

- [ ] **Step 2: Update company-list TypeScript**

In `company-list.component.ts`, inject `TopbarStateService`, set up the topbar state in `ngOnInit`, and clear on destroy:

```typescript
import { TopbarStateService } from '../../../core/services/topbar-state.service';

// In class:
private readonly topbarState = inject(TopbarStateService);

// In ngOnInit (or constructor effect):
ngOnInit() {
  // ... existing init code ...
  this.topbarState.actions.set([
    { label: 'Add company', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() },
  ]);
}

// Add effect to keep record count in sync:
private readonly countEffect = effect(() => {
  this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
});

ngOnDestroy() {
  this.topbarState.clear();
}
```

Add `OnDestroy` to the implements clause and `effect` to the Angular imports.

- [ ] **Step 3: Repeat for all other manage pages**

Apply the same pattern to each page. For each, the changes are:
- Remove `eyebrow`, `title`, `count`, `subtitle` from `<app-manage-page-shell>`
- Remove `<div actions>` block
- Inject `TopbarStateService`
- Set `actions` in `ngOnInit` with the page's specific button(s)
- Add `effect()` to sync record count
- Clear on `ngOnDestroy`

Specific action configs per page:

**product-list:** `{ label: 'Add product', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() }`

**trial-list:** `{ label: 'Add trial', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() }`

**trial-detail:** Two actions:
```typescript
[
  { label: 'Back', icon: 'fa-solid fa-arrow-left', text: true, callback: () => this.goBack() },
  { label: 'Edit trial', icon: 'fa-solid fa-pen', callback: () => this.editing.set(true) },
]
```
Also set `entityContext` and `entityTitle` from the trial data.

**therapeutic-area-list:** `{ label: 'Add therapeutic area', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() }`

**route-of-administration-list:** `{ label: 'Add route', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() }`

**mechanism-of-action-list:** `{ label: 'Add mechanism', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() }`

**marker-type-list:** `{ label: 'Add marker type', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() }`

**taxonomies-page:** Dynamic actions -- use an `effect()` to update the action label when the active tab changes:
```typescript
private readonly actionEffect = effect(() => {
  this.topbarState.actions.set([
    { label: this.addButtonLabel(), icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() },
  ]);
  this.topbarState.recordCount.set(String(this.activeCount() || ''));
});
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Compile errors for remaining pages (events, catalysts, settings, spaces) -- fixed in Tasks 7-8.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/
git commit -m "refactor(manage): migrate all manage pages to TopbarStateService"
```

---

### Task 7: Migrate Intelligence and Settings pages

**Files:**
- Modify: `src/client/src/app/features/events/events-page.component.html`
- Modify: `src/client/src/app/features/events/events-page.component.ts`
- Modify: `src/client/src/app/features/catalysts/catalysts-page.component.html`
- Modify: `src/client/src/app/features/catalysts/catalysts-page.component.ts`
- Modify: `src/client/src/app/features/tenant-settings/tenant-settings.component.ts`
- Modify: `src/client/src/app/features/spaces/space-list.component.ts`

Same pattern as Task 6.

- [ ] **Step 1: Update events-page**

In `events-page.component.html`, change:
```html
<app-manage-page-shell
  eyebrow="Intelligence"
  title="Events"
  [count]="grid.totalRecords()"
>
  <div actions>
    <p-button label="New Event" icon="fa-solid fa-plus" severity="secondary" [outlined]="true" size="small" (onClick)="openCreateModal()" />
  </div>
```
To:
```html
<app-manage-page-shell>
```

In `events-page.component.ts`:
```typescript
private readonly topbarState = inject(TopbarStateService);

// In ngOnInit:
this.topbarState.actions.set([
  { label: 'New Event', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() },
]);

private readonly countEffect = effect(() => {
  this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
});

ngOnDestroy() { this.topbarState.clear(); }
```

- [ ] **Step 2: Update catalysts-page**

In `catalysts-page.component.html`, change:
```html
<app-manage-page-shell
  eyebrow="Intelligence"
  title="Key Catalysts"
  [count]="totalCount()"
>
```
To:
```html
<app-manage-page-shell>
```

In `catalysts-page.component.ts`:
```typescript
private readonly topbarState = inject(TopbarStateService);

private readonly countEffect = effect(() => {
  this.topbarState.recordCount.set(String(this.totalCount() || ''));
});

ngOnDestroy() { this.topbarState.clear(); }
```

(Catalysts page has no action buttons in the shell.)

- [ ] **Step 3: Update tenant-settings**

In `tenant-settings.component.ts`, update the inline template to remove `eyebrow`, `title`, `subtitle` from `<app-manage-page-shell>` and remove the `<div actions>` block.

```typescript
private readonly topbarState = inject(TopbarStateService);

ngOnInit() {
  // ... existing init ...
  this.topbarState.actions.set([
    { label: 'Back to spaces', icon: 'fa-solid fa-arrow-left', text: true, callback: () => this.goBack() },
    { label: 'Invite member', icon: 'fa-solid fa-plus', callback: () => this.openInviteModal() },
  ]);
}

ngOnDestroy() { this.topbarState.clear(); }
```

- [ ] **Step 4: Update space-list**

In `space-list.component.ts`, update the inline template to remove `eyebrow`, `title`, `count`, `subtitle` from `<app-manage-page-shell>` and remove the `<div actions>` block.

```typescript
private readonly topbarState = inject(TopbarStateService);

ngOnInit() {
  // ... existing init ...
  this.topbarState.actions.set([
    { label: 'Settings', icon: 'fa-solid fa-gear', text: true, callback: () => this.openSettings() },
    { label: 'New space', icon: 'fa-solid fa-plus', callback: () => this.openCreateModal() },
  ]);
}

private readonly countEffect = effect(() => {
  this.topbarState.recordCount.set(String(this.spaces().length || ''));
});

ngOnDestroy() { this.topbarState.clear(); }
```

- [ ] **Step 5: Verify full build succeeds**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/events/ src/client/src/app/features/catalysts/ src/client/src/app/features/tenant-settings/ src/client/src/app/features/spaces/
git commit -m "refactor(pages): migrate events, catalysts, settings, spaces to TopbarStateService"
```

---

### Task 8: Move landscape view-specific controls into topbar

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-shell.component.ts`
- Modify: `src/client/src/app/core/layout/app-shell.component.ts`

The landscape shell currently renders view-specific controls (entity dropdown, grouping select, count unit toggle, export button) in its own row above the filter bar. The export button should move to the topbar. The other view-specific controls stay in the landscape shell since they're filter-level controls tied to the visualization.

- [ ] **Step 1: Move export button to topbar via TopbarStateService**

In `landscape-shell.component.ts`, inject `TopbarStateService` and set the export action when in timeline mode:

```typescript
private readonly topbarState = inject(TopbarStateService);

private readonly exportEffect = effect(() => {
  if (this.viewMode() === 'timeline') {
    this.topbarState.actions.set([
      { label: '', icon: 'fa-solid fa-file-powerpoint', text: true, severity: 'secondary', callback: () => this.onExportClick() },
    ]);
  } else {
    this.topbarState.actions.set([]);
  }
});
```

Add `OnDestroy`:
```typescript
ngOnDestroy() { this.topbarState.clear(); }
```

Remove the export button from the template (the `p-button` with `fa-file-powerpoint` icon inside the view-specific controls row).

- [ ] **Step 2: Verify it compiles and test**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Build succeeds.

Test in browser: navigate to Timeline view, confirm export button appears in the topbar actions area.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-shell.component.ts
git commit -m "refactor(landscape): move export button to topbar actions"
```

---

### Task 9: Add filter chip summary to landscape filter bar

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`

Add a chip summary row below the dropdown filter bar that shows individual active filter values as removable chips, matching the styling of `GridToolbarComponent`'s chips.

- [ ] **Step 1: Add activeChips computed signal to the component class**

In `landscape-filter-bar.component.ts`, add a computed signal that builds chip descriptors from the current filter state:

```typescript
interface FilterChip {
  field: keyof LandscapeFilters;
  header: string;
  value: string;
  id: string;
}

readonly activeChips = computed<FilterChip[]>(() => {
  const f = this.state.filters();
  const chips: FilterChip[] = [];

  const addChips = (
    ids: string[],
    options: SelectOption[],
    field: keyof LandscapeFilters,
    header: string,
  ) => {
    for (const id of ids) {
      const opt = options.find((o) => o.value === id);
      if (opt) chips.push({ field, header, value: opt.label, id });
    }
  };

  addChips(f.companyIds, this.companyOptions(), 'companyIds', 'Company');
  addChips(f.productIds, this.productOptions(), 'productIds', 'Product');
  addChips(f.therapeuticAreaIds, this.taOptions(), 'therapeuticAreaIds', 'Therapy Area');
  addChips(f.mechanismOfActionIds, this.moaOptions(), 'mechanismOfActionIds', 'MOA');
  addChips(f.routeOfAdministrationIds, this.roaOptions(), 'routeOfAdministrationIds', 'ROA');

  for (const phase of f.phases) {
    chips.push({ field: 'phases', header: 'Phase', value: phase, id: phase });
  }
  for (const status of f.recruitmentStatuses) {
    chips.push({ field: 'recruitmentStatuses', header: 'Status', value: status, id: status });
  }
  for (const type of f.studyTypes) {
    chips.push({ field: 'studyTypes', header: 'Study Type', value: type, id: type });
  }

  return chips;
});
```

Add a method to remove a single chip:

```typescript
removeChip(chip: FilterChip): void {
  this.state.filters.update((f) => {
    const arr = [...(f[chip.field] as string[])];
    const idx = arr.indexOf(chip.id);
    if (idx >= 0) arr.splice(idx, 1);
    return { ...f, [chip.field]: arr };
  });
}
```

- [ ] **Step 2: Add chip row to the template**

In `landscape-filter-bar.component.html`, add the chip summary row right before the closing `</div>` of the filter bar (after the `@if (hasAnyActive())` clear button block):

```html
  <!-- Active filter chips -->
  @if (activeChips().length > 0) {
    <div class="h-px w-full bg-slate-200 my-1"></div>
    <div class="flex flex-wrap items-center gap-1.5 px-3 pb-1.5" role="list" aria-label="Active filters">
      @for (chip of activeChips(); track chip.field + chip.id) {
        <span
          role="listitem"
          class="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
        >
          <span class="text-slate-500">{{ chip.header }}:</span>
          <span>{{ chip.value }}</span>
          <button
            type="button"
            class="-mr-0.5 ml-0.5 rounded text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
            [attr.aria-label]="'Remove ' + chip.header + ' ' + chip.value + ' filter'"
            (click)="removeChip(chip)"
          >
            <i class="fa-solid fa-xmark text-[10px]"></i>
          </button>
        </span>
      }
    </div>
  }
```

Note: This markup goes inside the existing outer `<div>` of the filter bar, but needs the template structure adjusted. The current template has a single flex div as the root. Wrap the existing filter controls and this chip section in a parent container:

Change the root element from a single-row flex to a column:
```html
<div class="border-b border-slate-200 bg-white">
  <div
    class="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto"
    role="toolbar"
    aria-label="Landscape filters"
  >
    <!-- existing filter content stays here -->
  </div>

  @if (activeChips().length > 0) {
    <div class="flex flex-wrap items-center gap-1.5 px-3 pb-1.5" role="list" aria-label="Active filters">
      <!-- chip markup from above -->
    </div>
  }
</div>
```

- [ ] **Step 3: Verify it compiles and test**

Run: `cd src/client && npx ng build --configuration production 2>&1 | tail -5`
Expected: Build succeeds.

Test in browser: navigate to Timeline or Positioning, select some filters (e.g., pick 2 products and a phase), confirm chips appear below the filter bar. Click the X on a chip, confirm the filter is removed. Click "Clear", confirm all chips disappear.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-filter-bar.component.ts src/client/src/app/features/landscape/landscape-filter-bar.component.html
git commit -m "feat(landscape): add filter chip summary row to landscape filter bar"
```

---

### Task 10: Lint, build, and verify

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

Run: `cd src/client && ng lint`
Expected: No errors. If there are lint errors from the changes, fix them.

- [ ] **Step 2: Run production build**

Run: `cd src/client && ng build --configuration production`
Expected: Build succeeds with no errors or warnings.

- [ ] **Step 3: Manual browser verification**

Start the dev server: `cd src/client && ng serve`

Verify each of these:
1. **Sidebar push behavior:** Hover over collapsed sidebar -- content pushes right. Pin sidebar -- content stays pushed. Unpin -- content slides back. No overlay, no shadow.
2. **Org/Space breadcrumb:** Topbar shows `Org / Space | Page`. Click space dropdown -- can switch spaces. Click org dropdown (if multi-tenant) -- can switch org.
3. **List page titles:** Navigate to Events, Companies, Products, Trials -- title appears in topbar, no in-page header. Action buttons appear in topbar.
4. **Landscape tabs:** Navigate to Timeline -- topbar shows `Org / Space | Landscape | Timeline Bullseye Positioning`. Export button in topbar actions.
5. **Detail page:** Click into a trial detail -- topbar shows `Org / Space | <- Trials | Company / Trial Name`.
6. **Filter chips on landscape:** Apply some filters on Timeline/Positioning -- chips appear below the filter bar. Remove individual chips. Clear all.
7. **Filter chips on list pages:** Apply column filters on Events -- chips appear below search bar (unchanged behavior).

- [ ] **Step 4: Commit any fixes**

If any verification issues were found and fixed:
```bash
git add -A
git commit -m "fix(layout): address issues found during navigation overhaul verification"
```
