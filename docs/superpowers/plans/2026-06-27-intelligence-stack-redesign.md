# Intelligence Stack Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-part intelligence layout (lead hero + accordion of others + one shared bottom history panel) with a single unified stack of brief cards where each brief owns its own inline, lazily-loaded version history, and fix drag-reorder.

**Architecture:** A new presentational `intelligence-stack` component renders ALL briefs (lead first) as one consistent card list. The lead is locked at index 0; pinning is the only way to change it. Each card lazy-loads its own anchor's history (reusing the unchanged `intelligence-history-panel` inline) via a `requestHistory` output and a `histories` input map owned by the detail page. The four detail pages swap their three-component block for the one unified component. The reorder bug is fixed by emitting the FULL ordered anchor set (lead included) so it matches `reorder_intelligence`'s exact-set check.

**Tech Stack:** Angular 19 standalone + signals (OnPush, `input()`/`output()`), Angular CDK drag-drop, PrimeNG (button, tooltip, menu), Tailwind v4, Vitest (source-contract + pure-logic specs, no TestBed).

## Global Constraints

- Standalone components only; never set `standalone: true`. `ChangeDetectionStrategy.OnPush` on every component.
- `inject()` for DI; `input()`/`output()`/`signal()`/`computed()`/`linkedSignal()`; mark inputs/outputs `readonly`; `protected` for template-only members.
- Native control flow only (`@if`/`@for`/`@switch`); `class`/`style` bindings, never `ngClass`/`ngStyle`.
- Tailwind brand utilities `bg-brand-*`/`text-brand-*`/`border-brand-*`/`ring-brand-*` for brand color; slate/amber/red/green/cyan/violet are data colors and stay hard-coded. Never `bg-teal-*`.
- `pTooltip` from `primeng/tooltip`, never native `title=`. Icon-only buttons MUST have a tooltip + `ariaLabel`.
- No emojis, no em dashes (use commas/colons/periods) in any UI copy, comments, or docs.
- Test runner is Vitest. Unit test command: `npm run test:units` (run from `src/client`). Verification: `cd src/client && ng lint && ng build`.
- Do not modify any `supabase/migrations/` file. The `reorder_intelligence`, `set_intelligence_lead`, `get_primary_intelligence_history` RPC signatures are unchanged.
- Commit after every task. Do not push (the reviewer/orchestrator handles integration).

## File Structure

- Create: `src/client/src/app/shared/components/intelligence-stack/intelligence-stack.component.ts` (unified card list; presentational)
- Create: `src/client/src/app/shared/components/intelligence-stack/intelligence-stack.component.html`
- Create: `src/client/src/app/shared/components/intelligence-stack/reorder.ts` (pure reorder helper)
- Create: `src/client/src/app/shared/components/intelligence-stack/reorder.spec.ts`
- Create: `src/client/src/app/shared/components/intelligence-stack/intelligence-stack.component.spec.ts`
- Modify: `asset-detail`, `trial-detail`, `company-detail`, `engagement-detail` (`.ts` + `.html`) to mount the unified component.
- Delete (after rewire): `intelligence-block/` and `intelligence-brief-list/` component + spec files.
- Keep unchanged: `intelligence-history-panel/` (now mounted inline per card), `intelligence-drawer/`, `history-panel-host.ts`, `primary-intelligence.service.ts` (`loadHistory` reused as-is).

---

### Task 1: Pure reorder helper (fixes the bug at its root)

The original bug: the accordion emitted only non-lead anchor ids, but `reorder_intelligence` requires the FULL anchor set. This helper computes the full ordered anchor-id array with the lead pinned at index 0, so the emitted set always matches the entity's anchors.

**Files:**
- Create: `src/client/src/app/shared/components/intelligence-stack/reorder.ts`
- Test: `src/client/src/app/shared/components/intelligence-stack/reorder.spec.ts`

**Interfaces:**
- Consumes: `PrimaryIntelligenceBrief` from `../../../core/models/primary-intelligence.model`.
- Produces:
  - `leadFirst(briefs: PrimaryIntelligenceBrief[]): PrimaryIntelligenceBrief[]` — stable order with the `is_lead` brief first (falls back to existing order when none flagged).
  - `computeReorder(ordered: PrimaryIntelligenceBrief[], previousIndex: number, currentIndex: number): string[]` — moves one item within `ordered`, forces the lead back to index 0, returns the full `anchor_id` array.

- [ ] **Step 1: Write the failing test**

Create `reorder.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { PrimaryIntelligenceBrief } from '../../../core/models/primary-intelligence.model';
import { computeReorder, leadFirst } from './reorder';

function brief(id: string, is_lead = false, display_order = 0): PrimaryIntelligenceBrief {
  return {
    anchor_id: id,
    is_lead,
    display_order,
    published: null,
    draft: null,
    updated_at: null,
    version_count: 0,
  };
}

describe('leadFirst', () => {
  it('moves the is_lead brief to the front, preserving the rest order', () => {
    const out = leadFirst([brief('a'), brief('b', true), brief('c')]);
    expect(out.map((b) => b.anchor_id)).toEqual(['b', 'a', 'c']);
  });

  it('returns the input order when no brief is flagged lead', () => {
    const out = leadFirst([brief('a'), brief('b'), brief('c')]);
    expect(out.map((b) => b.anchor_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('computeReorder', () => {
  const ordered = [brief('lead', true), brief('x'), brief('y'), brief('z')];

  it('emits the FULL anchor set including the lead (regression: reorder bug)', () => {
    const ids = computeReorder(ordered, 2, 1); // move y above x
    expect(ids).toHaveLength(ordered.length);
    expect(new Set(ids)).toEqual(new Set(['lead', 'x', 'y', 'z']));
  });

  it('keeps the lead at index 0 and reorders the others', () => {
    const ids = computeReorder(ordered, 3, 1); // move z to position 1
    expect(ids[0]).toBe('lead');
    expect(ids).toEqual(['lead', 'z', 'x', 'y']);
  });

  it('never lets a non-lead land above the lead (drop into index 0 is clamped)', () => {
    const ids = computeReorder(ordered, 2, 0); // try to drop y at the very top
    expect(ids[0]).toBe('lead');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run src/app/shared/components/intelligence-stack/reorder.spec.ts`
Expected: FAIL with module not found / `computeReorder is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `reorder.ts`:

```typescript
import { moveItemInArray } from '@angular/cdk/drag-drop';

import { PrimaryIntelligenceBrief } from '../../../core/models/primary-intelligence.model';

/**
 * Stable order with the lead brief first. The detail RPCs already return
 * briefs ordered `is_lead desc, display_order asc`, so this is a defensive
 * guard for the component's local copy.
 */
export function leadFirst(briefs: PrimaryIntelligenceBrief[]): PrimaryIntelligenceBrief[] {
  const lead = briefs.find((b) => b.is_lead);
  if (!lead) return [...briefs];
  return [lead, ...briefs.filter((b) => b !== lead)];
}

/**
 * Apply a drag-drop move to the ordered brief list and return the FULL
 * ordered anchor_id array with the lead pinned at index 0. Emitting the
 * complete set (lead included) is what makes reorder_intelligence's
 * exact-set validation pass; the old accordion omitted the lead and always
 * failed.
 */
export function computeReorder(
  ordered: PrimaryIntelligenceBrief[],
  previousIndex: number,
  currentIndex: number
): string[] {
  const items = [...ordered];
  // Never let anything land above the lead at index 0.
  const target = Math.max(1, currentIndex);
  const from = Math.max(1, previousIndex);
  moveItemInArray(items, from, target);
  return leadFirst(items).map((b) => b.anchor_id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run src/app/shared/components/intelligence-stack/reorder.spec.ts`
Expected: PASS (3 + 2 assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-stack/reorder.ts src/client/src/app/shared/components/intelligence-stack/reorder.spec.ts
git commit -m "feat(intelligence): pure reorder helper emitting full anchor set (fixes reorder)"
```

---

### Task 2: Unified `intelligence-stack` component (TS + HTML)

One presentational component rendering all briefs as a consistent card list. Lead is the first card (badge, locked grip, expanded by default); others collapse/expand. Each card has pin + edit inline and a ⋯ menu (withdraw, purge version, purge entry). Inline history is added in Task 3 (this task leaves a `requestHistory` hook and renders the panel container, fed by an empty `histories` map for now).

**Files:**
- Create: `src/client/src/app/shared/components/intelligence-stack/intelligence-stack.component.ts`
- Create: `src/client/src/app/shared/components/intelligence-stack/intelligence-stack.component.html`
- Test: `src/client/src/app/shared/components/intelligence-stack/intelligence-stack.component.spec.ts`

**Interfaces:**
- Consumes: `computeReorder`, `leadFirst` from `./reorder`; `PrimaryIntelligenceBrief`, `PrimaryIntelligenceLink`, `IntelligenceHistoryPayload` from the model; `renderMarkdownInline`, `resolveAuthorName`, `buildEntityRouterLink` from `../../utils/*` (same imports the old brief-list used).
- Produces (outputs other tasks rely on):
  - `edit = output<string>()` (anchor_id)
  - `pin = output<string>()` (anchor_id)
  - `reorderTo = output<string[]>()` (full ordered anchor_id set, lead first)
  - `requestHistory = output<string>()` (anchor_id; emitted once when a card's history first opens)
  - `withdraw = output<{ anchorId: string; id: string; headline: string }>()`
  - `purgeVersion = output<{ id: string; confirmation: string }>()`
  - `purgeEntry = output<{ id: string; confirmation: string }>()`
  - `discardDraft = output<string>()` (anchor_id)
- Inputs:
  - `briefs = input<PrimaryIntelligenceBrief[]>([])`
  - `canManage = input<boolean>(false)`
  - `canPurge = input<boolean>(false)`
  - `authorMap = input<Record<string, string>>({})`
  - `tenantId = input<string | null>(null)`
  - `spaceId = input<string | null>(null)`
  - `histories = input<Record<string, IntelligenceHistoryPayload>>({})`

- [ ] **Step 1: Write the failing contract + logic spec**

Create `intelligence-stack.component.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const dir = join(__dirname);
const tsSrc = readFileSync(join(dir, 'intelligence-stack.component.ts'), 'utf8');
const htmlSrc = readFileSync(join(dir, 'intelligence-stack.component.html'), 'utf8');

describe('IntelligenceStackComponent contract', () => {
  it('is a standalone OnPush component with the required signals API', () => {
    expect(tsSrc).not.toContain('standalone: false');
    expect(tsSrc).toContain('ChangeDetectionStrategy.OnPush');
    expect(tsSrc).toContain('briefs = input<PrimaryIntelligenceBrief[]>([])');
    expect(tsSrc).toContain('canManage = input<boolean>(false)');
    expect(tsSrc).toContain('canPurge = input<boolean>(false)');
    expect(tsSrc).toContain('histories = input<Record<string, IntelligenceHistoryPayload>>({})');
    expect(tsSrc).toContain('edit = output<string>()');
    expect(tsSrc).toContain('pin = output<string>()');
    expect(tsSrc).toContain('reorderTo = output<string[]>()');
    expect(tsSrc).toContain('requestHistory = output<string>()');
    expect(tsSrc).toContain('withdraw = output<{ anchorId: string; id: string; headline: string }>()');
    expect(tsSrc).toContain('purgeVersion = output<{ id: string; confirmation: string }>()');
    expect(tsSrc).toContain('purgeEntry = output<{ id: string; confirmation: string }>()');
  });

  it('uses the pure reorder helper (full-set emit) on drop', () => {
    expect(tsSrc).toContain("from './reorder'");
    expect(tsSrc).toContain('computeReorder(');
    expect(tsSrc).toContain('this.reorderTo.emit(');
  });

  it('emits requestHistory at most once per anchor (lazy load guard)', () => {
    expect(tsSrc).toContain('requestedHistoryIds');
    expect(tsSrc).toContain('this.requestHistory.emit(');
  });
});

describe('IntelligenceStackComponent template contract', () => {
  it('renders one card per brief, lead distinguished and drag-locked', () => {
    expect(htmlSrc).toContain('data-testid="brief-card"');
    expect(htmlSrc).toContain('cdkDropList');
    expect(htmlSrc).toContain('cdkDragDisabled');
    expect(htmlSrc).toContain('Lead');
  });

  it('shows the Published/Draft state and a Draft pending pill on the lead', () => {
    expect(htmlSrc).toContain('Published');
    expect(htmlSrc).toContain('Draft pending');
  });

  it('gates pin/edit/menu behind canManage', () => {
    expect(htmlSrc).toContain('@if (canManage())');
    expect(htmlSrc).toContain('Pin as lead entry');
    expect(htmlSrc).toContain('Edit entry');
  });

  it('mounts the history panel inline, fed per-anchor payload', () => {
    expect(htmlSrc).toContain('app-intelligence-history-panel');
    expect(htmlSrc).toContain('histories()[brief.anchor_id]');
  });

  it('offers withdraw and purge in the overflow menu', () => {
    expect(htmlSrc).toContain('Withdraw');
    expect(htmlSrc).toContain('Purge');
  });
});

describe('lead-disabled pin logic', () => {
  // Mirror the component's canPinBrief rule as a pure check.
  function canPin(isLead: boolean, hasPublished: boolean): boolean {
    return !isLead && hasPublished;
  }
  it('disables pin on the lead and on draft-only briefs', () => {
    expect(canPin(true, true)).toBe(false);
    expect(canPin(false, false)).toBe(false);
    expect(canPin(false, true)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `cd src/client && npx vitest run src/app/shared/components/intelligence-stack/intelligence-stack.component.spec.ts`
Expected: FAIL (files do not exist yet).

- [ ] **Step 3: Implement the component TS**

Create `intelligence-stack.component.ts`:

```typescript
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { Menu } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { Tooltip } from 'primeng/tooltip';

import {
  IntelligenceHistoryPayload,
  PrimaryIntelligenceBrief,
  PrimaryIntelligenceLink,
} from '../../../core/models/primary-intelligence.model';
import { renderMarkdownInline } from '../../utils/markdown-render';
import { resolveAuthorName } from '../../utils/intelligence-authors';
import { buildEntityRouterLink } from '../../utils/intelligence-router-link';
import { IntelligenceHistoryPanelComponent } from '../intelligence-history-panel/intelligence-history-panel.component';
import { computeReorder, leadFirst } from './reorder';

/**
 * Unified vertical stack of intelligence briefs for an entity detail page.
 * The lead brief is the first card (badged, expanded by default, drag-locked);
 * the rest collapse and expand in place. Each card owns its version history,
 * rendered inline via the existing history panel and lazily requested on first
 * open. Purely presentational: all data arrives via inputs, all actions emit.
 */
@Component({
  selector: 'app-intelligence-stack',
  imports: [
    ButtonModule,
    Menu,
    Tooltip,
    RouterLink,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    IntelligenceHistoryPanelComponent,
  ],
  templateUrl: './intelligence-stack.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceStackComponent {
  readonly briefs = input<PrimaryIntelligenceBrief[]>([]);
  readonly canManage = input<boolean>(false);
  readonly canPurge = input<boolean>(false);
  readonly authorMap = input<Record<string, string>>({});
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);
  readonly histories = input<Record<string, IntelligenceHistoryPayload>>({});

  readonly edit = output<string>();
  readonly pin = output<string>();
  readonly reorderTo = output<string[]>();
  readonly requestHistory = output<string>();
  readonly withdraw = output<{ anchorId: string; id: string; headline: string }>();
  readonly purgeVersion = output<{ id: string; confirmation: string }>();
  readonly purgeEntry = output<{ id: string; confirmation: string }>();
  readonly discardDraft = output<string>();

  /** Local mutable copy for optimistic drag reorder; resets on new input. */
  protected readonly ordered = linkedSignal(() => leadFirst(this.briefs()));

  /** Which cards are expanded. Lead (index 0) is expanded by default. */
  protected readonly expandedIds = signal<ReadonlySet<string>>(new Set());

  /** Cards whose history has already been requested (lazy-load guard). */
  private readonly requestedHistoryIds = new Set<string>();

  protected readonly leadAnchorId = computed<string | null>(
    () => this.ordered().find((b) => b.is_lead)?.anchor_id ?? this.ordered()[0]?.anchor_id ?? null
  );

  protected isLead(brief: PrimaryIntelligenceBrief): boolean {
    return brief.anchor_id === this.leadAnchorId();
  }

  protected isExpanded(anchorId: string): boolean {
    // The lead is open by default until the user explicitly collapses it.
    if (anchorId === this.leadAnchorId() && !this.touchedIds().has(anchorId)) return true;
    return this.expandedIds().has(anchorId);
  }

  /** Anchors the user has explicitly toggled (so default-open can be undone). */
  private readonly touchedIds = signal<ReadonlySet<string>>(new Set());

  protected toggleExpand(anchorId: string): void {
    this.touchedIds.update((s) => new Set(s).add(anchorId));
    const willOpen = !this.isExpanded(anchorId);
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (next.has(anchorId)) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
    if (willOpen) this.ensureHistory(anchorId);
  }

  private ensureHistory(anchorId: string): void {
    if (this.requestedHistoryIds.has(anchorId)) return;
    this.requestedHistoryIds.add(anchorId);
    this.requestHistory.emit(anchorId);
  }

  protected onDrop(event: CdkDragDrop<PrimaryIntelligenceBrief[]>): void {
    const ids = computeReorder(this.ordered(), event.previousIndex, event.currentIndex);
    const byId = new Map(this.ordered().map((b) => [b.anchor_id, b]));
    this.ordered.set(ids.map((id) => byId.get(id)!).filter(Boolean));
    this.reorderTo.emit(ids);
  }

  protected canPinBrief(brief: PrimaryIntelligenceBrief): boolean {
    return !this.isLead(brief) && !!brief.published;
  }

  protected onPinClick(anchorId: string): void {
    this.pin.emit(anchorId);
  }

  protected onEditClick(anchorId: string): void {
    this.edit.emit(anchorId);
  }

  /** Build the ⋯ overflow menu for one brief. */
  protected menuFor(brief: PrimaryIntelligenceBrief): MenuItem[] {
    const items: MenuItem[] = [
      { label: 'Edit entry', command: () => this.edit.emit(brief.anchor_id) },
    ];
    const published = brief.published?.record;
    if (published) {
      items.push({
        label: 'Withdraw',
        command: () =>
          this.withdraw.emit({
            anchorId: brief.anchor_id,
            id: published.id,
            headline: published.headline,
          }),
      });
    }
    if (this.canPurge() && published) {
      items.push({
        separator: true,
      });
      items.push({
        label: 'Purge entry',
        styleClass: 'text-red-700',
        command: () => this.purgeEntry.emit({ id: published.id, confirmation: published.headline }),
      });
    }
    return items;
  }

  protected headlineFor(brief: PrimaryIntelligenceBrief): string {
    return (brief.published ?? brief.draft)?.record.headline ?? '';
  }

  protected bylineFor(brief: PrimaryIntelligenceBrief): string {
    const payload = brief.published ?? brief.draft ?? null;
    if (!payload) return '';
    return resolveAuthorName(payload.record.last_edited_by, payload.authors, this.authorMap());
  }

  protected updatedFor(brief: PrimaryIntelligenceBrief): string {
    return formatDate(brief.updated_at);
  }

  protected draftPendingFor(brief: PrimaryIntelligenceBrief): boolean {
    return !!brief.published && !!brief.draft;
  }

  protected summaryHtmlFor(brief: PrimaryIntelligenceBrief): string {
    return renderMarkdownInline((brief.published ?? brief.draft)?.record.summary_md ?? '');
  }

  protected implicationsHtmlFor(brief: PrimaryIntelligenceBrief): string {
    return renderMarkdownInline((brief.published ?? brief.draft)?.record.implications_md ?? '');
  }

  protected linkedGroupsFor(
    brief: PrimaryIntelligenceBrief
  ): { relationship: string; items: PrimaryIntelligenceLink[] }[] {
    const links = (brief.published ?? brief.draft)?.links ?? [];
    const groups = new Map<string, PrimaryIntelligenceLink[]>();
    for (const l of links) {
      const key = l.relationship_type || 'Linked';
      const arr = groups.get(key) ?? [];
      arr.push(l);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([relationship, items]) => ({ relationship, items }));
  }

  protected linkLabelFor(link: PrimaryIntelligenceLink): string {
    return link.entity_name?.trim()
      ? link.entity_name
      : `${link.entity_type} ${link.entity_id.slice(0, 8)}`;
  }

  protected linkRouteFor(
    link: PrimaryIntelligenceLink
  ): { commands: unknown[]; queryParams?: Record<string, string> } | null {
    const commands = buildEntityRouterLink(
      this.tenantId(),
      this.spaceId(),
      link.entity_type,
      link.entity_id
    );
    return commands ? { commands } : null;
  }

  protected historyFor(anchorId: string): IntelligenceHistoryPayload | null {
    return this.histories()[anchorId] ?? null;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
```

- [ ] **Step 4: Implement the component template**

Create `intelligence-stack.component.html`:

```html
<ol
  cdkDropList
  [cdkDropListData]="ordered()"
  [cdkDropListDisabled]="!canManage()"
  (cdkDropListDropped)="onDrop($event)"
  class="flex flex-col gap-2.5"
  aria-label="Intelligence entries"
>
  @for (brief of ordered(); track brief.anchor_id) {
    @let lead = isLead(brief);
    @let expanded = isExpanded(brief.anchor_id);
    <li
      cdkDrag
      [cdkDragDisabled]="!canManage() || lead"
      data-testid="brief-card"
      class="rounded-lg border bg-white"
      [class.border-brand-200]="lead"
      [class.border-slate-200]="!lead"
    >
      <!-- header row -->
      <div class="flex items-center gap-2 px-3.5 py-3">
        @if (canManage()) {
          <button
            cdkDragHandle
            type="button"
            class="shrink-0 touch-none text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            [class.cursor-grab]="!lead"
            [class.opacity-40]="lead"
            [disabled]="lead"
            [pTooltip]="lead ? 'Lead stays pinned at the top' : 'Drag to reorder entry'"
            tooltipPosition="top"
            aria-label="Drag to reorder this entry"
          >
            <i class="fa-solid fa-grip-vertical text-xs" aria-hidden="true"></i>
          </button>
        }

        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          [attr.aria-expanded]="expanded"
          [attr.aria-controls]="'brief-body-' + brief.anchor_id"
          (click)="toggleExpand(brief.anchor_id)"
        >
          <i
            class="fa-solid fa-chevron-right shrink-0 text-[10px] text-slate-400 transition-transform duration-150"
            [class.rotate-90]="expanded"
            aria-hidden="true"
          ></i>
          @if (lead) {
            <span
              class="shrink-0 rounded-sm border border-brand-200 bg-brand-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-brand-700"
              >Lead</span
            >
            @if (brief.published) {
              <span class="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-brand-700">
                <span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand-600 align-middle" aria-hidden="true"></span
                >Published
              </span>
            }
            @if (draftPendingFor(brief)) {
              <span
                class="shrink-0 rounded-sm border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-700"
                pTooltip="Unpublished changes are saved as a draft. Clients still see the published version. Click Edit to resume and publish."
                tooltipPosition="top"
                >Draft pending</span
              >
            }
          }
          <span class="truncate text-sm font-semibold leading-snug text-slate-800">{{
            headlineFor(brief)
          }}</span>
        </button>

        <div class="flex shrink-0 items-center gap-2 text-xs text-slate-400">
          <span class="hidden font-medium text-slate-600 sm:inline">{{ bylineFor(brief) }}</span>
          <span class="tabular-nums">{{ updatedFor(brief) }}</span>
          @if (brief.version_count > 1) {
            <span
              class="rounded-sm border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500"
              >v{{ brief.version_count }}</span
            >
          }
        </div>

        @if (canManage()) {
          <div class="flex shrink-0 items-center gap-0.5">
            <p-button
              icon="fa-solid fa-thumbtack"
              [text]="true"
              severity="secondary"
              size="small"
              [disabled]="!canPinBrief(brief)"
              pTooltip="Pin as lead entry"
              tooltipPosition="top"
              ariaLabel="Pin as lead entry"
              (onClick)="onPinClick(brief.anchor_id)"
            />
            <p-button
              icon="fa-solid fa-pen"
              [text]="true"
              severity="secondary"
              size="small"
              pTooltip="Edit entry"
              tooltipPosition="top"
              ariaLabel="Edit entry"
              (onClick)="onEditClick(brief.anchor_id)"
            />
            @let menuRef = menu;
            <p-button
              icon="fa-solid fa-ellipsis"
              [text]="true"
              severity="secondary"
              size="small"
              pTooltip="More actions"
              tooltipPosition="top"
              ariaLabel="More actions for this entry"
              (onClick)="menuRef.toggle($event)"
            />
            <p-menu #menu [model]="menuFor(brief)" [popup]="true" appendTo="body" />
          </div>
        }
      </div>

      <!-- expanded body -->
      @if (expanded) {
        @let summaryHtml = summaryHtmlFor(brief);
        @let implHtml = implicationsHtmlFor(brief);
        @let groups = linkedGroupsFor(brief);
        <div
          [id]="'brief-body-' + brief.anchor_id"
          class="border-t border-slate-100 px-4 pb-4 pt-3.5"
          role="region"
          [attr.aria-label]="'Details: ' + headlineFor(brief)"
        >
          @if (summaryHtml) {
            <div class="mb-4">
              <h4 class="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Summary
              </h4>
              <div class="prose-render text-sm leading-relaxed text-slate-800" [innerHTML]="summaryHtml"></div>
            </div>
          }
          @if (implHtml) {
            <div class="mb-4">
              <h4 class="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Implications
              </h4>
              <div class="border-l-[3px] border-brand-600 bg-brand-50 px-4 py-3">
                <div class="prose-render text-sm leading-relaxed text-slate-800" [innerHTML]="implHtml"></div>
              </div>
            </div>
          }
          @if (groups.length) {
            <div class="mb-4">
              <h4 class="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Linked entities
              </h4>
              <div class="flex flex-col gap-2">
                @for (g of groups; track g.relationship) {
                  <div>
                    <p class="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
                      {{ g.relationship }}
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                      @for (link of g.items; track link.entity_id) {
                        @let route = linkRouteFor(link);
                        @if (route) {
                          <a
                            [routerLink]="route.commands"
                            [queryParams]="route.queryParams ?? null"
                            class="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                          >
                            <span class="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">{{ link.entity_type }}</span>
                            <span class="truncate font-medium">{{ linkLabelFor(link) }}</span>
                          </a>
                        } @else {
                          <span class="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                            <span class="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">{{ link.entity_type }}</span>
                            <span class="truncate font-medium">{{ linkLabelFor(link) }}</span>
                          </span>
                        }
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- inline, per-anchor version history -->
          @if (historyFor(brief.anchor_id); as payload) {
            <app-intelligence-history-panel
              [payload]="payload"
              [currentUserCanEdit]="canManage()"
              [authorMap]="authorMap()"
              (withdraw)="
                withdraw.emit({
                  anchorId: brief.anchor_id,
                  id: brief.published?.record?.id ?? '',
                  headline: brief.published?.record?.headline ?? ''
                })
              "
              (purgeVersion)="purgeVersion.emit($event)"
              (purgeAnchor)="purgeEntry.emit($event)"
            />
          } @else {
            <p class="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">Loading history...</p>
          }
        </div>
      }
    </li>
  }
</ol>
```

Note on `intelligence-history-panel` outputs: it already emits `withdraw`, `purgeVersion`, `purgeAnchor`, and `draftClicked`. We bind `withdraw`/`purgeVersion`/`purgeAnchor`; `draftClicked` is left unbound (no-op here, editing happens via the card's Edit). Confirm these output names against `intelligence-history-panel.component.ts` lines 51-54 before wiring.

- [ ] **Step 5: Run the spec to verify it passes**

Run: `cd src/client && npx vitest run src/app/shared/components/intelligence-stack/`
Expected: PASS (contract + template + logic specs green).

- [ ] **Step 6: Type-check the new component compiles**

Run: `cd src/client && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors referencing `intelligence-stack`. (If `Menu`/`MenuItem` import paths differ in this PrimeNG version, fix to match an existing `p-menu` user, e.g. search `grep -rl "primeng/menu" src/app`.)

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-stack/
git commit -m "feat(intelligence): unified brief stack component with inline per-card history"
```

---

### Task 3: Wire `asset-detail` to the unified stack

Replace the three-component block with the single `app-intelligence-stack`, add a per-anchor `histories` signal populated lazily on `requestHistory`, and route withdraw to the card-supplied id.

**Files:**
- Modify: `src/client/src/app/features/manage/assets/asset-detail.component.ts`
- Modify: `src/client/src/app/features/manage/assets/asset-detail.component.html`

**Interfaces:**
- Consumes from Task 2: `IntelligenceStackComponent` and its outputs (`edit`, `pin`, `reorderTo`, `requestHistory`, `withdraw`, `purgeVersion`, `purgeEntry`).

- [ ] **Step 1: Replace the template block**

In `asset-detail.component.html`, replace the three elements (`<app-intelligence-block .../>`, the `@if (otherBriefs().length) { <app-intelligence-brief-list .../> }`, and `<app-intelligence-history-panel .../>`) with:

```html
<app-intelligence-stack
  [briefs]="intelligence()?.briefs ?? []"
  [canManage]="spaceRole.canAuthorIntelligence()"
  [canPurge]="spaceRole.canPurgeIntelligence()"
  [authorMap]="intelligence()?.authors ?? {}"
  [tenantId]="tenantIdSig()"
  [spaceId]="spaceIdSig()"
  [histories]="histories()"
  (edit)="openBriefInDrawer($event)"
  (pin)="onBriefPin($event)"
  (reorderTo)="onBriefReorder($event)"
  (requestHistory)="onRequestHistory($event)"
  (withdraw)="onWithdrawRequested($event)"
  (purgeVersion)="onPurgeRequested({ id: $event.id, headline: $event.confirmation }, false)"
  (purgeEntry)="onPurgeRequested({ id: $event.id, headline: $event.confirmation }, true)"
/>
```

(Keep the existing empty-state / "Add entry" affordance and the withdraw/purge dialogs that already live in this template.)

- [ ] **Step 2: Update the component TS**

In `asset-detail.component.ts`:

1. Imports array: remove `IntelligenceBlockComponent`, `IntelligenceBriefListComponent`, `IntelligenceHistoryPanelComponent`; add `IntelligenceStackComponent` from `'../../../shared/components/intelligence-stack/intelligence-stack.component'`.

2. Add a per-anchor history map signal and remove reliance on the single `historyHost.payload()` for rendering (the `historyHost` instance can stay for withdraw/purge service calls, or call the service directly):

```typescript
import { IntelligenceHistoryPayload } from '../../../core/models/primary-intelligence.model';

protected readonly histories = signal<Record<string, IntelligenceHistoryPayload>>({});
protected readonly withdrawTargetId = signal<string | null>(null);

protected async onRequestHistory(anchorId: string): Promise<void> {
  const p = this.asset();
  if (!p) return;
  try {
    const payload = await this.intelligenceService.loadHistory(anchorId, 'product', p.id);
    this.histories.update((m) => ({ ...m, [anchorId]: payload }));
  } catch {
    // Per-card history load failure must not block the page; the card keeps
    // its "Loading history..." line and the user can collapse/expand to retry.
  }
}

protected onWithdrawRequested(e: { anchorId: string; id: string; headline: string }): void {
  this.withdrawTargetId.set(e.id);
  this.withdrawDialogOpen.set(true);
}
```

3. Update `onWithdrawConfirmed()` to use `withdrawTargetId()` instead of `historyHost.payload().current?.id`:

```typescript
protected async onWithdrawConfirmed(reason: string): Promise<void> {
  const id = this.withdrawTargetId();
  if (!id) return;
  try {
    await this.intelligenceService.withdraw(id, reason);
    this.withdrawDialogOpen.set(false);
    await Promise.all([this.loadIntelligence(), this.loadAsset()]);
    this.histories.set({}); // drop cached per-anchor history so it reloads fresh
    this.messageService.add({ severity: 'success', summary: 'Intelligence withdrawn.', life: 3000 });
  } catch (err) {
    this.messageService.add({
      severity: 'error',
      summary: 'Withdraw failed',
      detail: err instanceof Error ? err.message : 'Check your connection and try again.',
      life: 4000,
    });
  }
}
```

4. In `onPurgeConfirmed()` (and `onBriefPin` / `onBriefReorder`), after the existing `loadIntelligence()` refresh, add `this.histories.set({});` so stale inline history is dropped. Remove `refreshHistory()` and its call site, and remove the now-unused `historyHost` field and `onViewHistory` method.

5. Keep `onBriefReorder(anchorIds: string[])` exactly as-is (it already calls `intelligenceService.reorder(...)` with the array). It now receives the FULL set from the stack, so the RPC's exact-set check passes.

- [ ] **Step 3: Build to verify the page compiles and renders**

Run: `cd src/client && ng build`
Expected: build succeeds with no references to the removed components in asset-detail.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/assets/
git commit -m "feat(intelligence): mount unified stack on asset detail; per-card history + reorder fix"
```

---

### Task 4: Wire `trial-detail` to the unified stack

Identical shape to Task 3 with `entityType` `'trial'` and the trial entity signal.

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Replace the template block** in `trial-detail.component.html` with the same `<app-intelligence-stack .../>` block from Task 3, Step 1 (unchanged bindings).

- [ ] **Step 2: Apply the same TS changes** as Task 3, Step 2, with two substitutions: use `'trial'` as the entity type, and use this component's existing trial id source (the same `entityType`/`entityId` already passed to `historyHost.load(...)` in this file's current `onViewHistory`/`refreshHistory`). Mirror the `histories` signal, `withdrawTargetId`, `onRequestHistory`, `onWithdrawRequested`, the `onWithdrawConfirmed` rewrite, the `histories.set({})` after pin/reorder/purge, and removal of `refreshHistory`/`historyHost`/`onViewHistory`. Swap the imports array (remove block/brief-list/history-panel, add `IntelligenceStackComponent`).

- [ ] **Step 3: Build**

Run: `cd src/client && ng build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/
git commit -m "feat(intelligence): mount unified stack on trial detail"
```

---

### Task 5: Wire `company-detail` to the unified stack

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.ts`
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.html`

- [ ] **Step 1:** Replace the template block with the Task 3, Step 1 `<app-intelligence-stack .../>` block.
- [ ] **Step 2:** Apply the Task 3, Step 2 TS changes with entity type `'company'` and this file's existing company id source. Swap imports.
- [ ] **Step 3: Build** — `cd src/client && ng build` (expected success).
- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/companies/
git commit -m "feat(intelligence): mount unified stack on company detail"
```

---

### Task 6: Wire `engagement-detail` to the unified stack

**Files:**
- Modify: `src/client/src/app/features/manage/engagement/engagement-detail.component.ts`
- Modify: `src/client/src/app/features/manage/engagement/engagement-detail.component.html`

- [ ] **Step 1:** Replace the template block with the Task 3, Step 1 `<app-intelligence-stack .../>` block.
- [ ] **Step 2:** Apply the Task 3, Step 2 TS changes with entity type `'space'` and this file's existing space id source (the value already passed to `historyHost.load(...)` here). Swap imports.
- [ ] **Step 3: Build** — `cd src/client && ng build` (expected success).
- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/engagement/
git commit -m "feat(intelligence): mount unified stack on engagement detail"
```

---

### Task 7: Delete the superseded components and verify nothing references them

**Files:**
- Delete: `src/client/src/app/shared/components/intelligence-block/` (component, template, spec `agency-byline-logo.spec.ts` only if it tests the deleted component; keep any shared util it covers)
- Delete: `src/client/src/app/shared/components/intelligence-brief-list/` (component, template, spec)

- [ ] **Step 1: Confirm no remaining consumers**

Run:
```bash
cd src/client && grep -rn "intelligence-block\|IntelligenceBlockComponent\|app-intelligence-brief-list\|IntelligenceBriefListComponent" src/app | grep -v "intelligence-stack"
```
Expected: no output. If any line remains (other than the files about to be deleted), fix that consumer first.

- [ ] **Step 2: Inspect `agency-byline-logo.spec.ts` before deleting**

Run: `cd src/client && sed -n '1,40p' src/app/shared/components/intelligence-block/agency-byline-logo.spec.ts`
If it asserts behavior of a util still used by the stack/history panel (e.g. an agency byline helper), MOVE that spec next to the util instead of deleting it. Otherwise delete it with the folder.

- [ ] **Step 3: Delete the folders**

```bash
cd src/client && git rm -r src/app/shared/components/intelligence-block src/app/shared/components/intelligence-brief-list
```

- [ ] **Step 4: Verify build + lint + units**

Run:
```bash
cd src/client && ng lint && ng build && npm run test:units
```
Expected: all green; no dangling imports.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(intelligence): remove superseded lead-block and brief-list components"
```

---

### Task 8: Editorial sweep + full verification

- [ ] **Step 1: Update help/runbook copy if it describes the old layout**

Run: `cd /Users/aadityamadala/Documents/code/clint-v2 && grep -rn "brief-list\|version history\|primary intelligence" src/client/src/app/features/help docs/runbook 2>/dev/null | grep -i "history\|brief\|lead"`
If any in-app help or runbook prose describes the old hero + accordion + bottom-panel layout (a shared history pane, "scroll to the bottom for history", etc.), update it to: each entry shows its own version history inline when expanded; the lead is pinned at the top; drag to reorder the rest. Keep it terse, no em dashes, no emoji.

- [ ] **Step 2: Full verification**

Run:
```bash
cd /Users/aadityamadala/Documents/code/clint-v2/src/client && ng lint && ng build && npm run test:units
```
Expected: lint clean, build succeeds, all unit specs pass (including `intelligence-stack/reorder.spec.ts` and `intelligence-stack.component.spec.ts`).

- [ ] **Step 3: Manual smoke (browser)**

Per the design's success criteria, manually confirm in the running app on a company/asset with 3+ briefs: lead is pinned + expanded by default; expanding a secondary brief loads its own history inline; pinning a secondary promotes it to lead; dragging a secondary reorders without the "anchor set does not match" error.

- [ ] **Step 4: Commit any doc edits**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2 && git add -A docs src/client/src/app/features/help && git commit -m "docs(intelligence): describe inline per-entry history and pinned lead"
```

---

## Self-Review

**Spec coverage:**
- Unified stack replacing block+list+bottom panel — Tasks 2-7. ✓
- Lead = first card, badged, expanded by default, drag-locked — Task 2 (`isLead`, `isExpanded` default-open, `cdkDragDisabled` on lead). ✓
- Inline lazy per-anchor history reusing existing panel — Task 2 (template mounts `app-intelligence-history-panel`, `requestHistory` guard) + Task 3 (`onRequestHistory` populates `histories`). ✓
- Reorder fix (full anchor set incl. lead) — Task 1 helper + Task 2 `onDrop` + regression test asserting full-set emit + lead-first. ✓
- Pinning via `set_intelligence_lead`, disabled for lead/draft-only — Task 2 (`canPinBrief`) + existing `onBriefPin`. ✓
- Lifecycle actions: Pin+Edit inline, Withdraw/Purge in ⋯ — Task 2 (`menuFor`, inline buttons). ✓
- Four detail pages rewired — Tasks 3-6. ✓
- Tests paired per unit (no deferred phase) — every task with a deliverable ships its spec/build check. ✓
- No schema/RPC change — Global Constraints + Task notes. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. The only deliberate "confirm against the file" notes (Task 2 Step 4 history-panel output names; Tasks 4-6 entity id source) point the implementer at exact existing lines rather than inventing values.

**Type consistency:** `histories: Record<string, IntelligenceHistoryPayload>` is the same shape produced by `service.loadHistory` (returns `IntelligenceHistoryPayload`) and consumed by `app-intelligence-history-panel` `[payload]`. `reorderTo`/`reorder` both use `string[]`. `withdraw` event `{ anchorId; id; headline }` is consumed by `onWithdrawRequested` with the matching shape. ✓
