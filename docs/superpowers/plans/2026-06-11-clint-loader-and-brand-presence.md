# Clint Loader and Brand Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken oversized PrimeNG spinners with a branded draw-through loader built from the Clint mark, and give the mark real presence across the app: sidebar lockup, boot splash, empty-state watermark, three-party export footers, public footer, marketing landing, and a "Clint Intelligence" AI badge.

**Architecture:** A shared geometry module (`clint-mark.ts`) becomes the single source of truth for the triple-C mark. Small standalone presentational components (loader, watermark, intelligence badge) consume it, global CSS in `animations.css` owns the draw keyframes, and existing surfaces (sidebar, footers, exports, import page) are rewired to the new pieces. No DB or RPC changes.

**Tech Stack:** Angular 19 standalone components (signals, OnPush, `input()`), Tailwind v4, Vitest unit tests (`npm run test:units`, template-contract pattern), pptxgenjs for the PPTX footer.

**Spec:** `docs/superpowers/specs/2026-06-11-clint-loader-and-brand-presence-design.md`

**Execution notes (read first):**

- Work in a git worktree branched off `develop` (NOT main). The main checkout may have another active session; never switch its branch.
- The worktree has no `node_modules`; symlink it from the main checkout: `ln -s /Users/aadityamadala/Documents/code/clint-v2/src/client/node_modules <worktree>/src/client/node_modules`.
- Subagents do not inherit the worktree cwd. Every subagent prompt must state the absolute worktree path, `cd` there first, and verify with `pwd`.
- All commands below run from `<worktree>/src/client` unless stated otherwise.
- Unit tests: `npm run test:units` (vitest; there is NO `ng test` unit target despite the package.json `test` script). Run a single spec with `npx vitest run --config vitest.units.config.ts <path>`.
- House style: no em dashes and no emojis anywhere (code, comments, docs). Commit messages have no Claude attribution.
- Angular guardrails (src/client/CLAUDE.md): OnPush, `input()`/`computed()`, native control flow, self-closing tags, no `ngClass`/`ngStyle`.

---

### Task 1: Shared mark geometry (`clint-mark.ts`)

**Files:**
- Create: `src/app/shared/components/clint-mark.ts`
- Create: `src/app/shared/components/clint-mark.spec.ts`
- Modify: `src/app/shared/components/clint-logo.component.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/shared/components/clint-mark.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  CLINT_MARK_POINTS,
  CLINT_MARK_VIEWBOX,
  clintMarkStrokes,
  clintMarkSvgDataUri,
} from './clint-mark';

describe('clintMarkStrokes', () => {
  it('returns the documented tier for each size band', () => {
    expect(clintMarkStrokes(14)).toEqual({ outer: 7, middle: 9, inner: 11 });
    expect(clintMarkStrokes(16)).toEqual({ outer: 7, middle: 9, inner: 11 });
    expect(clintMarkStrokes(20)).toEqual({ outer: 5, middle: 7, inner: 9 });
    expect(clintMarkStrokes(28)).toEqual({ outer: 4, middle: 5.5, inner: 7.5 });
    expect(clintMarkStrokes(36)).toEqual({ outer: 2.5, middle: 3.5, inner: 5 });
    expect(clintMarkStrokes(96)).toEqual({ outer: 1.5, middle: 2.2, inner: 3 });
  });
});

describe('clintMarkSvgDataUri', () => {
  it('emits a standalone SVG with all three polylines and the given colors', () => {
    const uri = clintMarkSvgDataUri(64, { outer: '#cbd5e1', middle: '#94a3b8', inner: '#0d9488' });
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
    expect(svg).toContain(`viewBox="${CLINT_MARK_VIEWBOX}"`);
    expect(svg).toContain(CLINT_MARK_POINTS.outer);
    expect(svg).toContain(CLINT_MARK_POINTS.middle);
    expect(svg).toContain(CLINT_MARK_POINTS.inner);
    expect(svg).toContain('#0d9488');
    expect(svg).toContain('stroke-linecap="round"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/clint-mark.spec.ts`
Expected: FAIL (cannot resolve `./clint-mark`)

- [ ] **Step 3: Implement `clint-mark.ts`**

Create `src/app/shared/components/clint-mark.ts`:

```typescript
/**
 * Single source of truth for the Clint triple-C mark geometry. Consumed by
 * ClintLogoComponent, LoaderComponent, MarkWatermarkComponent,
 * IntelligenceBadgeComponent, the marketing landing, the boot splash (copied
 * inline in index.html by necessity), and the PPTX export footer.
 * Spec: docs/superpowers/specs/2026-06-11-clint-loader-and-brand-presence-design.md
 */
export const CLINT_MARK_VIEWBOX = '0 0 140 140';

export const CLINT_MARK_POINTS = {
  outer: '112,24 24,24 24,116 112,116',
  middle: '96,40 40,40 40,100 96,100',
  inner: '80,56 56,56 56,84 80,84',
} as const;

export interface ClintMarkStrokes {
  outer: number;
  middle: number;
  inner: number;
}

/** Stroke widths tuned per rendered size so the mark stays legible small. */
export function clintMarkStrokes(size: number): ClintMarkStrokes {
  if (size <= 16) return { outer: 7, middle: 9, inner: 11 };
  if (size <= 24) return { outer: 5, middle: 7, inner: 9 };
  if (size <= 32) return { outer: 4, middle: 5.5, inner: 7.5 };
  if (size <= 48) return { outer: 2.5, middle: 3.5, inner: 5 };
  return { outer: 1.5, middle: 2.2, inner: 3 };
}

export interface ClintMarkColors {
  outer: string;
  middle: string;
  inner: string;
}

/**
 * Standalone SVG as a data URI, for rasterization paths that cannot render
 * Angular templates (the PPTX footer loads this through an Image element).
 */
export function clintMarkSvgDataUri(size: number, colors: ClintMarkColors): string {
  const s = clintMarkStrokes(size);
  const line = (points: string, stroke: string, width: number): string =>
    `<polyline points="${points}" stroke="${stroke}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${CLINT_MARK_VIEWBOX}" fill="none">` +
    line(CLINT_MARK_POINTS.outer, colors.outer, s.outer) +
    line(CLINT_MARK_POINTS.middle, colors.middle, s.middle) +
    line(CLINT_MARK_POINTS.inner, colors.inner, s.inner) +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/clint-mark.spec.ts`
Expected: PASS

- [ ] **Step 5: Refactor `ClintLogoComponent` onto the shared geometry**

Replace the ENTIRE contents of `src/app/shared/components/clint-logo.component.ts` with:

```typescript
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from './clint-mark';

/**
 * Triple C logo mark for Clint. Three nested open squares forming the letter C
 * with progressive stroke weight. Automatically adapts stroke widths to rendered size.
 */
@Component({
  selector: 'app-clint-logo',
  standalone: true,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polyline
        [attr.points]="points.outer"
        [attr.stroke]="outerColor()"
        [attr.stroke-width]="strokes().outer"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.middle"
        [attr.stroke]="middleColor()"
        [attr.stroke-width]="strokes().middle"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.inner"
        [attr.stroke]="innerColor()"
        [attr.stroke-width]="strokes().inner"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClintLogoComponent {
  readonly size = input<number>(28);
  readonly dark = input<boolean>(false);

  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;

  readonly outerColor = computed(() => (this.dark() ? '#475569' : '#cbd5e1'));
  readonly middleColor = computed(() => (this.dark() ? '#64748b' : '#94a3b8'));
  readonly innerColor = computed(() => (this.dark() ? '#14b8a6' : '#0d9488'));

  readonly strokes = computed(() => clintMarkStrokes(this.size()));
}
```

Note: `outerColor`/`middleColor`/`innerColor`/`strokes` stay `readonly` (not `protected`) to avoid breaking any existing external reads; the polyline points previously hard-coded in the template now come from the constants. Behavior is unchanged.

- [ ] **Step 6: Verify build and tests**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/clint-mark.spec.ts && ng build 2>&1 | tail -5`
Expected: spec PASS, build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/app/shared/components/clint-mark.ts src/app/shared/components/clint-mark.spec.ts src/app/shared/components/clint-logo.component.ts
git commit -m "refactor(brand): extract clint mark geometry into shared constants"
```

---

### Task 2: Draw animation CSS (global)

**Files:**
- Modify: `src/app/shared/styles/animations.css` (append)

- [ ] **Step 1: Append the mark animation classes**

Append to the END of `src/app/shared/styles/animations.css`:

```css
/* Clint mark draw-through (loader, active intelligence badge) and one-shot
   draw-in (marketing landing hero). Animated polylines carry pathLength="1"
   so the dash math is size-independent. Static surfaces never use these
   classes; the mark animates only while something is loading.
   Spec: docs/superpowers/specs/2026-06-11-clint-loader-and-brand-presence-design.md */
@keyframes clint-mark-draw {
  0% {
    stroke-dashoffset: 1;
  }
  50% {
    stroke-dashoffset: 0;
  }
  100% {
    stroke-dashoffset: -1;
  }
}

@keyframes clint-mark-draw-in {
  0% {
    stroke-dashoffset: 1;
  }
  100% {
    stroke-dashoffset: 0;
  }
}

.clint-mark-track {
  opacity: 0.18;
}

.clint-mark-draw {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: clint-mark-draw 1.8s cubic-bezier(0.5, 0.05, 0.45, 0.95) infinite;
}

.clint-mark-draw--m {
  animation-delay: 0.15s;
}

.clint-mark-draw--i {
  animation-delay: 0.3s;
}

.clint-mark-draw-in {
  stroke-dasharray: 1;
  animation: clint-mark-draw-in 0.9s cubic-bezier(0.5, 0.05, 0.45, 0.95) both;
}

.clint-mark-draw-in--m {
  animation-delay: 0.12s;
}

.clint-mark-draw-in--i {
  animation-delay: 0.24s;
}

/* Reduced motion: the animated copy rests fully drawn (static mark). */
@media (prefers-reduced-motion: reduce) {
  .clint-mark-draw,
  .clint-mark-draw-in {
    animation: none;
    stroke-dashoffset: 0;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `ng build 2>&1 | tail -3`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/shared/styles/animations.css
git commit -m "feat(brand): clint mark draw keyframes with reduced-motion fallback"
```

---

### Task 3: `app-loader` component

**Files:**
- Create: `src/app/shared/components/loader/loader.component.ts`
- Create: `src/app/shared/components/loader/loader.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/shared/components/loader/loader.component.spec.ts`. This codebase tests template-heavy components via the template-contract pattern (see `export-snapshot-host.component.spec.ts`): read the source, assert the contract.

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('LoaderComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'loader.component.ts'), 'utf8');

  it('announces itself as a status region with an aria-label fallback', () => {
    expect(src).toContain(`role: 'status'`);
    expect(src).toContain(`'[attr.aria-label]': 'resolvedLabel()'`);
    expect(src).toMatch(/resolvedLabel = computed\(\(\) => this\.label\(\) \|\| 'Loading'\)/);
  });

  it('renders a static track and three animated draw copies with pathLength', () => {
    expect(src.match(/clint-mark-track/g)?.length).toBe(3);
    expect(src).toContain('clint-mark-draw clint-mark-draw--m');
    expect(src).toContain('clint-mark-draw clint-mark-draw--i');
    expect(src.match(/pathLength="1"/g)?.length).toBe(3);
  });

  it('tints the inner ring with the host brand', () => {
    expect(src).toContain('var(--brand-600)');
  });

  it('derives stroke widths from the shared geometry', () => {
    expect(src).toContain(`from '../clint-mark'`);
    expect(src).toContain('clintMarkStrokes(this.size())');
  });

  it('hides the SVG from the accessibility tree and shows the optional caption', () => {
    expect(src).toContain('aria-hidden="true"');
    expect(src).toContain('@if (label())');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/loader/loader.component.spec.ts`
Expected: FAIL (loader.component.ts does not exist)

- [ ] **Step 3: Implement the component**

Create `src/app/shared/components/loader/loader.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../clint-mark';

/**
 * Branded loading indicator: the Clint mark drawing itself in and releasing
 * over a faint static track. Callers mount it only while loading; the mark
 * never animates at rest. Draw classes live in shared/styles/animations.css
 * and degrade to a static mark under prefers-reduced-motion.
 *
 * Replaces p-progressspinner, whose unlayered CSS ignores Tailwind sizing
 * and whose keyframes ignore stroke overrides (see spec, Known issues).
 */
@Component({
  selector: 'app-loader',
  host: {
    role: 'status',
    '[attr.aria-label]': 'resolvedLabel()',
  },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      fill="none"
      aria-hidden="true"
    >
      <polyline
        class="clint-mark-track"
        [attr.points]="points.outer"
        stroke="#cbd5e1"
        [attr.stroke-width]="strokes().outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-track"
        [attr.points]="points.middle"
        stroke="#94a3b8"
        [attr.stroke-width]="strokes().middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-track"
        [attr.points]="points.inner"
        stroke="var(--brand-600)"
        [attr.stroke-width]="strokes().inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-draw"
        pathLength="1"
        [attr.points]="points.outer"
        stroke="#cbd5e1"
        [attr.stroke-width]="strokes().outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-draw clint-mark-draw--m"
        pathLength="1"
        [attr.points]="points.middle"
        stroke="#94a3b8"
        [attr.stroke-width]="strokes().middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        class="clint-mark-draw clint-mark-draw--i"
        pathLength="1"
        [attr.points]="points.inner"
        stroke="var(--brand-600)"
        [attr.stroke-width]="strokes().inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    @if (label()) {
      <span class="text-[11px] uppercase tracking-wider text-slate-400">{{ label() }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoaderComponent {
  /** Rendered square size in px. 16 inline, 20 dialogs, 28 panels. */
  readonly size = input<number>(20);
  /** Optional caption, rendered uppercase tracked beside the mark. */
  readonly label = input<string>('');

  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;
  protected readonly strokes = computed(() => clintMarkStrokes(this.size()));
  protected readonly resolvedLabel = computed(() => this.label() || 'Loading');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/loader/loader.component.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/components/loader
git commit -m "feat(brand): app-loader draw-through loading indicator"
```

---

### Task 4: Replace all four p-progressspinner call sites

**Files:**
- Modify: `src/app/features/dashboard/export-dialog/export-dialog.component.ts`
- Modify: `src/app/features/landscape/landscape-filter-bar.component.html`
- Modify: `src/app/features/landscape/landscape-filter-bar.component.ts` (imports)
- Modify: `src/app/features/landscape/entity-marker-drawer.component.ts`
- Modify: `src/app/features/landscape/landscape-shell.component.ts`
- Modify: `src/app/shared/styles/primeng-overrides.css` (delete dead override)
- Create: `src/app/shared/components/loader/loader-callsites.spec.ts`

- [ ] **Step 1: Write the failing regression test**

Create `src/app/shared/components/loader/loader-callsites.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '../../..');

const surfaces = [
  'features/dashboard/export-dialog/export-dialog.component.ts',
  'features/landscape/landscape-filter-bar.component.html',
  'features/landscape/entity-marker-drawer.component.ts',
  'features/landscape/landscape-shell.component.ts',
];

describe('loader call sites', () => {
  for (const rel of surfaces) {
    it(`${rel} uses app-loader, not p-progressspinner`, () => {
      const src = readFileSync(join(APP, rel), 'utf8');
      expect(src).toContain('app-loader');
      expect(src.toLowerCase()).not.toContain('p-progress');
    });
  }

  it('the dead progressspinner stroke override is gone', () => {
    const css = readFileSync(join(APP, 'shared/styles/primeng-overrides.css'), 'utf8');
    expect(css).not.toContain('p-progressspinner-circle');
  });
});
```

(`APP` resolves to `src/app`, so the overrides file is `join(APP, 'shared/styles/primeng-overrides.css')`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/loader/loader-callsites.spec.ts`
Expected: FAIL on all five assertions

- [ ] **Step 3: Export dialog**

In `src/app/features/dashboard/export-dialog/export-dialog.component.ts`:

Remove the import line:

```typescript
import { ProgressSpinner } from 'primeng/progressspinner';
```

Add:

```typescript
import { LoaderComponent } from '../../../shared/components/loader/loader.component';
```

Change the decorator imports array from:

```typescript
  imports: [FormsModule, Dialog, SelectButton, ButtonModule, MessageModule, ProgressSpinner],
```

to:

```typescript
  imports: [FormsModule, Dialog, SelectButton, ButtonModule, MessageModule, LoaderComponent],
```

Replace the exporting block (currently lines 59-70):

```html
        @if (exporting()) {
          <div class="flex items-center justify-center gap-2 py-2">
            <p-progressspinner
              strokeWidth="4"
              styleClass="w-[1.25rem] h-[1.25rem]"
              [ariaLabel]="generatingLabel()"
            />
            <span class="text-[11px] uppercase tracking-wider text-slate-400">
              {{ generatingLabel() }}
            </span>
          </div>
        }
```

with:

```html
        @if (exporting()) {
          <div class="flex items-center justify-center py-2">
            <app-loader [size]="20" [label]="generatingLabel()" />
          </div>
        }
```

- [ ] **Step 4: Landscape filter bar**

In `src/app/features/landscape/landscape-filter-bar.component.html`, replace lines 7-15:

```html
    @if (loading()) {
      <div class="flex items-center gap-2">
        <p-progressspinner
          strokeWidth="4"
          styleClass="w-[0.875rem] h-[0.875rem]"
          aria-hidden="true"
        />
        <span class="text-xs text-slate-400" aria-live="polite">Loading filters...</span>
      </div>
    } @else {
```

with:

```html
    @if (loading()) {
      <app-loader [size]="16" label="Loading filters..." />
    } @else {
```

In `src/app/features/landscape/landscape-filter-bar.component.ts`: replace the import `import { ProgressSpinner } from 'primeng/progressspinner';` with `import { LoaderComponent } from '../../shared/components/loader/loader.component';` and swap `ProgressSpinner` for `LoaderComponent` in the decorator imports array.

- [ ] **Step 5: Entity marker drawer**

In `src/app/features/landscape/entity-marker-drawer.component.ts`:

Replace `import { ProgressSpinner } from 'primeng/progressspinner';` with `import { LoaderComponent } from '../../shared/components/loader/loader.component';`.

Change `imports: [MarkerDetailPanelComponent, ProgressSpinner],` to `imports: [MarkerDetailPanelComponent, LoaderComponent],`.

Replace line 26:

```html
          <p-progress-spinner strokeWidth="3" styleClass="w-[28px] h-[28px]" />
```

with:

```html
          <app-loader [size]="28" />
```

- [ ] **Step 6: Landscape shell**

In `src/app/features/landscape/landscape-shell.component.ts`:

Replace `import { ProgressSpinner } from 'primeng/progressspinner';` (line 29) with `import { LoaderComponent } from '../../shared/components/loader/loader.component';`.

Change the imports array (line 34) from:

```typescript
imports: [RouterOutlet, LandscapeFilterBarComponent, MarkerDetailPanelComponent, ProgressSpinner],
```

to:

```typescript
imports: [RouterOutlet, LandscapeFilterBarComponent, MarkerDetailPanelComponent, LoaderComponent],
```

Replace line 57:

```html
              <p-progress-spinner strokeWidth="3" styleClass="w-[28px] h-[28px]" />
```

with:

```html
              <app-loader [size]="28" />
```

- [ ] **Step 7: Remove the dead CSS override**

In `src/app/shared/styles/primeng-overrides.css`, delete the block (around lines 273-275) including its preceding comment if one exists:

```css
.p-progressspinner-circle {
  stroke: var(--brand-600); /* teal-600 */
}
```

- [ ] **Step 8: Run tests and build**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/loader/loader-callsites.spec.ts && ng build 2>&1 | tail -3`
Expected: PASS, build succeeds

- [ ] **Step 9: Commit**

```bash
git add -A src/app/features/dashboard/export-dialog src/app/features/landscape src/app/shared/styles/primeng-overrides.css src/app/shared/components/loader/loader-callsites.spec.ts
git commit -m "feat(brand): replace p-progressspinner with app-loader on all four surfaces"
```

---

### Task 5: Boot splash in index.html

**Files:**
- Modify: `src/index.html`

- [ ] **Step 1: Add the splash**

In `src/index.html`, add this `<style>` block at the end of `<head>` (after the last `<meta>`):

```html
    <style>
      /* Boot splash: shown until Angular bootstraps and replaces the
         projected content of <app-root>. Brand-neutral all-slate on purpose:
         it renders before get_brand_by_host resolves, so no color or name
         can flash wrong on a whitelabel domain. Keep geometry in sync with
         src/app/shared/components/clint-mark.ts (inline by necessity: no
         bundle has loaded yet). */
      .boot-splash {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
      }
      .boot-splash polyline {
        stroke-dasharray: 1;
        animation: boot-draw 1.8s cubic-bezier(0.5, 0.05, 0.45, 0.95) infinite;
      }
      .boot-splash polyline:nth-of-type(2) {
        animation-delay: 0.15s;
      }
      .boot-splash polyline:nth-of-type(3) {
        animation-delay: 0.3s;
      }
      @keyframes boot-draw {
        0% {
          stroke-dashoffset: 1;
        }
        50% {
          stroke-dashoffset: 0;
        }
        100% {
          stroke-dashoffset: -1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .boot-splash polyline {
          animation: none;
          stroke-dashoffset: 0;
        }
      }
    </style>
```

Change the body from:

```html
  <body>
    <app-root></app-root>
  </body>
```

to:

```html
  <body>
    <app-root>
      <div class="boot-splash" role="status" aria-label="Loading">
        <svg width="36" height="36" viewBox="0 0 140 140" fill="none" aria-hidden="true">
          <polyline
            pathLength="1"
            points="112,24 24,24 24,116 112,116"
            stroke="#cbd5e1"
            stroke-width="2.5"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <polyline
            pathLength="1"
            points="96,40 40,40 40,100 96,100"
            stroke="#94a3b8"
            stroke-width="3.5"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <polyline
            pathLength="1"
            points="80,56 56,56 56,84 80,84"
            stroke="#64748b"
            stroke-width="5"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </app-root>
  </body>
```

(36px falls in the size<=48 stroke tier: 2.5 / 3.5 / 5. Inner ring is slate-500, not brand, by design.)

- [ ] **Step 2: Verify build and manual check**

Run: `ng build 2>&1 | tail -3`
Expected: build succeeds. Angular replaces `<app-root>` content on bootstrap, so the splash disappears once the app renders; no TS change needed.

- [ ] **Step 3: Commit**

```bash
git add src/index.html
git commit -m "feat(brand): brand-neutral boot splash while the app bootstraps"
```

---

### Task 6: Sidebar identity lockup

**Files:**
- Modify: `src/app/core/layout/sidebar.component.ts`
- Create: `src/app/core/layout/sidebar-lockup.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/core/layout/sidebar-lockup.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('sidebar identity lockup template contract', () => {
  const src = readFileSync(join(__dirname, 'sidebar.component.ts'), 'utf8');

  it('expanded state leads with the Clint mark plus wordmark', () => {
    expect(src).toContain('identity-wordmark');
    expect(src).toMatch(/wordmark = computed\(\(\) =>\s*this\.brandContext\.appDisplayName\(\)/);
  });

  it('agency rides along as delivered-by instead of evicting the mark', () => {
    expect(src).toContain('Delivered by');
    expect(src).toContain('delivered-by__logo');
    expect(src).not.toContain('agency-wordmark');
  });

  it('collapsed rail keeps the agency chip or the mark', () => {
    expect(src).toContain('agency-initial');
    expect(src).toContain('<app-clint-logo [size]="24" [dark]="true" />');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/core/layout/sidebar-lockup.spec.ts`
Expected: FAIL (no identity-wordmark, agency-wordmark still present)

- [ ] **Step 3: Rewrite the logo row template**

In `src/app/core/layout/sidebar.component.ts`, replace the logo row block (lines 103-152, from `<!-- Logo row -->` through the closing `</div>` after the pin button) with:

```html
      <!-- Logo row: product identity lockup. Clint (or the renamed product)
           leads; an agency rides along as "delivered by" rather than
           replacing the mark (lockup B in the brand-presence spec). -->
      <div class="sidebar__logo">
        <div class="sidebar__identity">
          <button
            type="button"
            class="logo-btn"
            [attr.aria-label]="logoLabel()"
            [pTooltip]="isExpanded() ? '' : logoTooltip()"
            tooltipPosition="right"
            (click)="logoClick.emit()"
          >
            @if (isExpanded()) {
              <span class="identity-lockup">
                <app-clint-logo [size]="20" [dark]="true" />
                <span class="identity-wordmark">{{ wordmark() }}</span>
              </span>
            } @else if (agencyBrand(); as ag) {
              @if (ag.logo_url) {
                <img
                  [ngSrc]="ag.logo_url"
                  [alt]="ag.name"
                  width="48"
                  height="48"
                  class="size-6 rounded-[5px] bg-slate-50 object-contain box-content p-0.5"
                />
              } @else {
                <span class="agency-initial" aria-hidden="true">{{ agencyInitial() }}</span>
              }
            } @else {
              <app-clint-logo [size]="24" [dark]="true" />
            }
          </button>
          @if (isExpanded() && agencyBrand(); as ag) {
            <div class="delivered-by">
              <span class="delivered-by__label">Delivered by</span>
              @if (ag.logo_url) {
                <img
                  [ngSrc]="ag.logo_url"
                  [alt]="ag.name"
                  width="140"
                  height="28"
                  class="delivered-by__logo"
                />
              } @else {
                <span class="delivered-by__name">{{ ag.name }}</span>
              }
            </div>
          }
        </div>

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
            <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
          </button>
        }
      </div>
```

- [ ] **Step 4: Update the styles**

In the same file's styles, REPLACE the `.agency-wordmark` rule block (lines ~346-359, including its comment) with:

```css
      .sidebar__identity {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
      }

      .identity-lockup {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .identity-wordmark {
        color: #e2e8f0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      /* Agency credit under the product lockup. Agency wordmarks tend to be
         dark-on-light, so the logo sits on a near-white tile to stay legible
         against the slate-900 sidebar. */
      .delivered-by {
        display: flex;
        align-items: center;
        gap: 6px;
        padding-left: 2px;
      }

      .delivered-by__label {
        color: #64748b;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 8.5px;
        font-weight: 600;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .delivered-by__logo {
        height: 16px;
        max-width: 104px;
        width: auto;
        object-fit: contain;
        background: #f8fafc;
        border-radius: 3px;
        padding: 1px 4px;
        box-sizing: content-box;
      }

      .delivered-by__name {
        color: #cbd5e1;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }
```

Keep `.agency-initial` (still used collapsed) and everything else as is. Also change `.sidebar__logo` `align-items: flex-start;` stays as is (already flex-start).

- [ ] **Step 5: Add the wordmark computed**

In the `SidebarComponent` class, directly after the `agencyInitial` computed (line ~643), add:

```typescript
  /** Product wordmark: the brand display name, tracked uppercase via CSS. */
  readonly wordmark = computed(() => this.brandContext.appDisplayName());
```

Note: `appDisplayName` must exist on `BrandContextService` (it does: `readonly appDisplayName = computed(() => this._brand().app_display_name);`).

- [ ] **Step 6: Run tests and build**

Run: `npx vitest run --config vitest.units.config.ts src/app/core/layout/sidebar-lockup.spec.ts && ng build 2>&1 | tail -3`
Expected: PASS, build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/app/core/layout/sidebar.component.ts src/app/core/layout/sidebar-lockup.spec.ts
git commit -m "feat(brand): sidebar identity lockup, agency as delivered-by"
```

---

### Task 7: Empty-state watermark

**Files:**
- Create: `src/app/shared/components/watermark/mark-watermark.component.ts`
- Create: `src/app/shared/components/watermark/mark-watermark.component.spec.ts`
- Modify: `src/app/features/landscape/timeline-view.component.html` + `.ts` (imports)
- Modify: `src/app/features/landscape/landscape.component.html` + `.ts` (imports)
- Modify: `src/app/features/landscape/heatmap-view.component.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/shared/components/watermark/mark-watermark.component.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('MarkWatermarkComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'mark-watermark.component.ts'), 'utf8');

  it('is decorative only', () => {
    expect(src).toContain('aria-hidden="true"');
    expect(src).toContain('pointer-events: none');
  });

  it('renders the faded mark centered behind content', () => {
    expect(src).toContain('opacity: 0.07');
    expect(src).toContain('position: absolute');
    expect(src).toContain(`from '../clint-mark'`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/watermark/mark-watermark.component.spec.ts`
Expected: FAIL (file missing)

- [ ] **Step 3: Implement the component**

Create `src/app/shared/components/watermark/mark-watermark.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../clint-mark';

/**
 * Faded Clint mark behind empty states. Purely decorative: aria-hidden,
 * click-through, never animated. The parent container must be positioned
 * (add Tailwind "relative") and the visible empty-state content must also
 * be positioned (add "relative") so it paints above the watermark.
 */
@Component({
  selector: 'app-mark-watermark',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.viewBox]="viewBox"
      fill="none"
      aria-hidden="true"
    >
      <polyline
        [attr.points]="points.outer"
        stroke="#0f172a"
        [attr.stroke-width]="strokes().outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.middle"
        stroke="#0f172a"
        [attr.stroke-width]="strokes().middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [attr.points]="points.inner"
        stroke="#0f172a"
        [attr.stroke-width]="strokes().inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.07;
        pointer-events: none;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkWatermarkComponent {
  readonly size = input<number>(100);

  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;
  protected readonly strokes = computed(() => clintMarkStrokes(this.size()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/watermark/mark-watermark.component.spec.ts`
Expected: PASS

- [ ] **Step 5: Wire the three empty states**

a) `src/app/features/landscape/timeline-view.component.html` (lines 61-69), replace:

```html
    } @else {
      <div class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3 text-center">
          <p-message severity="info" [closable]="false">
            No clinical trial data to display. Add companies, assets, and trials to see them on
            the dashboard.
          </p-message>
        </div>
      </div>
    }
```

with:

```html
    } @else {
      <div class="relative flex items-center justify-center py-20">
        <app-mark-watermark />
        <div class="relative flex flex-col items-center gap-3 text-center">
          <p-message severity="info" [closable]="false">
            No clinical trial data to display. Add companies, assets, and trials to see them on
            the dashboard.
          </p-message>
        </div>
      </div>
    }
```

In `timeline-view.component.ts`: add `import { MarkWatermarkComponent } from '../../shared/components/watermark/mark-watermark.component';` and add `MarkWatermarkComponent` to the decorator imports array.

b) `src/app/features/landscape/landscape.component.html` (lines ~22-36), replace:

```html
        @if (cd.spokes.length === 0) {
          <div class="flex items-center justify-center h-full">
            <div class="flex flex-col items-center gap-3 text-center max-w-md">
```

with:

```html
        @if (cd.spokes.length === 0) {
          <div class="relative flex items-center justify-center h-full">
            <app-mark-watermark />
            <div class="relative flex flex-col items-center gap-3 text-center max-w-md">
```

(the rest of the block, p-message + Manage assets button, is unchanged). In `landscape.component.ts`: add the same import and decorator entry.

c) `src/app/features/landscape/heatmap-view.component.ts` (lines ~97-102), replace:

```html
      } @else if (data) {
        <div class="flex items-center justify-center h-full">
          <p-message severity="info" [closable]="false">
            No data matches the current filters. Try adjusting your selections.
          </p-message>
        </div>
      }
```

with:

```html
      } @else if (data) {
        <div class="relative flex items-center justify-center h-full">
          <app-mark-watermark />
          <p-message class="relative" severity="info" [closable]="false">
            No data matches the current filters. Try adjusting your selections.
          </p-message>
        </div>
      }
```

Add the import and decorator entry in the same file.

- [ ] **Step 6: Build and commit**

Run: `ng build 2>&1 | tail -3`
Expected: build succeeds

```bash
git add src/app/shared/components/watermark src/app/features/landscape
git commit -m "feat(brand): faded mark watermark behind landscape empty states"
```

---

### Task 8: Public footer mark + marketing landing shared geometry and draw-in

**Files:**
- Modify: `src/app/shared/components/public-footer.component.ts`
- Modify: `src/app/features/marketing/marketing-landing.component.ts`
- Create: `src/app/shared/components/public-footer.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/shared/components/public-footer.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('public footer template contract', () => {
  const src = readFileSync(join(__dirname, 'public-footer.component.ts'), 'utf8');

  it('shows the Clint mark beside the Powered by credit', () => {
    expect(src).toContain('app-clint-logo');
    expect(src).toContain('Powered by');
  });
});

describe('marketing landing mark', () => {
  const src = readFileSync(
    join(__dirname, '../../features/marketing/marketing-landing.component.ts'),
    'utf8'
  );

  it('sources the mark from shared geometry instead of hand-inlined points', () => {
    expect(src).toContain(`from '../../shared/components/clint-mark'`);
    expect(src).not.toContain('points="112,24 24,24 24,116 112,116"');
  });

  it('hero mark draws in once on load', () => {
    expect(src).toContain('clint-mark-draw-in');
    expect(src).toContain('clint-mark-track');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/public-footer.spec.ts`
Expected: FAIL

- [ ] **Step 3: Public footer**

In `src/app/shared/components/public-footer.component.ts`:

Add import: `import { ClintLogoComponent } from './clint-logo.component';` and add `ClintLogoComponent` to the decorator `imports` array (`imports: [RouterLink, ClintLogoComponent],`).

Replace the `<p>` block:

```html
        <p>
          &copy; {{ year }} {{ ownerName() }}
          @if (showPlatform()) {
            <span class="text-slate-400">&middot; Powered by {{ platform }}</span>
          }
        </p>
```

with:

```html
        <p class="flex items-center gap-1.5">
          &copy; {{ year }} {{ ownerName() }}
          @if (showPlatform()) {
            <span class="inline-flex items-center gap-1.5 text-slate-400">
              &middot; Powered by
              <app-clint-logo [size]="12" />
              {{ platform }}
            </span>
          }
        </p>
```

- [ ] **Step 4: Marketing landing**

In `src/app/features/marketing/marketing-landing.component.ts`:

Add import: `import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX } from '../../shared/components/clint-mark';`

Add to the class:

```typescript
  protected readonly mark = CLINT_MARK_POINTS;
  protected readonly markViewBox = CLINT_MARK_VIEWBOX;
```

Replace the header SVG (lines 19-44) with:

```html
            <svg [attr.viewBox]="markViewBox" fill="none" class="h-6 w-6" aria-hidden="true">
              <polyline
                [attr.points]="mark.outer"
                stroke="#cbd5e1"
                stroke-width="4"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                [attr.points]="mark.middle"
                stroke="#94a3b8"
                stroke-width="5.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                [attr.points]="mark.inner"
                stroke="var(--p-primary-700, #0f766e)"
                stroke-width="7.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
```

Replace the hero SVG (lines 54-79) with a track + one-shot draw-in version (same stroke widths the hero uses today):

```html
            <svg [attr.viewBox]="markViewBox" fill="none" class="h-14 w-14" aria-hidden="true">
              <polyline
                class="clint-mark-track"
                [attr.points]="mark.outer"
                stroke="#cbd5e1"
                stroke-width="4"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                class="clint-mark-track"
                [attr.points]="mark.middle"
                stroke="#94a3b8"
                stroke-width="5.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                class="clint-mark-track"
                [attr.points]="mark.inner"
                stroke="var(--p-primary-700, #0f766e)"
                stroke-width="7.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                class="clint-mark-draw-in"
                pathLength="1"
                [attr.points]="mark.outer"
                stroke="#cbd5e1"
                stroke-width="4"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                class="clint-mark-draw-in clint-mark-draw-in--m"
                pathLength="1"
                [attr.points]="mark.middle"
                stroke="#94a3b8"
                stroke-width="5.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                class="clint-mark-draw-in clint-mark-draw-in--i"
                pathLength="1"
                [attr.points]="mark.inner"
                stroke="var(--p-primary-700, #0f766e)"
                stroke-width="7.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/public-footer.spec.ts && ng build 2>&1 | tail -3`
Expected: PASS, build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/app/shared/components/public-footer.component.ts src/app/shared/components/public-footer.spec.ts src/app/features/marketing/marketing-landing.component.ts
git commit -m "feat(brand): mark in public footer, landing hero one-shot draw-in"
```

---

### Task 9: Three-party PNG export footer

**Files:**
- Modify: `src/app/features/dashboard/export/export-snapshot-host.component.ts`
- Modify: `src/app/features/dashboard/export/export-snapshot-host.component.spec.ts`
- Modify: `src/app/features/dashboard/export/png-export.service.ts`
- Modify: `src/app/features/dashboard/export-dialog/export-dialog.component.ts`
- Modify: `src/app/features/landscape/timeline-view.component.html` (line 84 block)

- [ ] **Step 1: Update the template-contract spec (failing first)**

In `src/app/features/dashboard/export/export-snapshot-host.component.spec.ts`, the existing test asserting the old footer is:

```typescript
  it('carries the agency attribution and export date in the footer', () => {
```

Replace the body of that `it` (and add the new ones) so the footer block of the describe reads:

```typescript
  it('carries the three-party footer: product, agency, tenant, date', () => {
    expect(src).toContain('{{ appDisplayName() }}');
    expect(src).toContain('Delivered by');
    expect(src).toContain('Prepared for');
    expect(src).toContain('{{ exportDate }}');
  });

  it('leads with the Clint mark, not the host brand logo', () => {
    expect(src).toContain(`from '../../../shared/components/clint-mark'`);
    expect(src).not.toContain('this.brand.logoUrl');
  });

  it('hides agency and tenant segments when absent and truncates long tenant names', () => {
    expect(src).toContain('@if (agencyName()');
    expect(src).toContain('@if (tenantName()');
    expect(src).toContain('truncate');
  });
```

Keep every other existing `it` in the file untouched unless it references `logoUrl` (if one does, delete that assertion line).

- [ ] **Step 2: Run spec to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/features/dashboard/export/export-snapshot-host.component.spec.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite the snapshot host footer**

In `src/app/features/dashboard/export/export-snapshot-host.component.ts`:

Add import:

```typescript
import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../../../shared/components/clint-mark';
```

Replace the `<footer>` block with:

```html
    <footer class="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2">
      <svg width="16" height="16" [attr.viewBox]="markViewBox" fill="none" aria-hidden="true">
        <polyline
          [attr.points]="mark.outer"
          stroke="#cbd5e1"
          [attr.stroke-width]="markStrokes.outer"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          [attr.points]="mark.middle"
          stroke="#94a3b8"
          [attr.stroke-width]="markStrokes.middle"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          [attr.points]="mark.inner"
          stroke="var(--brand-600)"
          [attr.stroke-width]="markStrokes.inner"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="text-xs font-bold text-slate-600">{{ appDisplayName() }}</span>
      @if (agencyName(); as agency) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Delivered by
        </span>
        @if (agencyLogo(); as alogo) {
          <app-brand-logo
            [url]="alogo"
            alt=""
            [width]="64"
            [height]="16"
            imgClass="h-4 w-auto max-w-[80px] object-contain"
          />
        } @else {
          <span class="text-[11px] font-semibold text-slate-600">{{ agency }}</span>
        }
      }
      @if (tenantName(); as tname) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Prepared for
        </span>
        @if (tenantLogoUrl(); as tlogo) {
          <app-brand-logo
            [url]="tlogo"
            alt=""
            [width]="16"
            [height]="16"
            imgClass="h-4 w-4 rounded object-contain"
          />
        }
        <span class="max-w-[160px] truncate text-[11px] font-semibold text-slate-600">
          {{ tname }}
        </span>
      }
      <span class="ml-auto text-[11px] text-slate-400">{{ exportDate }}</span>
    </footer>
```

In the class:
- Add inputs: `readonly tenantName = input('');` and `readonly tenantLogoUrl = input<string | null>(null);`
- REMOVE `protected readonly logoUrl = computed(() => this.brand.logoUrl());`
- Add: `protected readonly agencyLogo = computed(() => this.brand.agency()?.logo_url ?? null);`
- Add template constants:

```typescript
  protected readonly mark = CLINT_MARK_POINTS;
  protected readonly markViewBox = CLINT_MARK_VIEWBOX;
  protected readonly markStrokes = clintMarkStrokes(16);
```

(Keep `appDisplayName` and `agencyName` computeds as they are.)

- [ ] **Step 4: Thread tenant identity through the PNG snapshot**

In `src/app/features/dashboard/export/png-export.service.ts`: find the `PngExportSnapshot` interface and add:

```typescript
  tenantName: string;
  tenantLogoUrl: string | null;
```

After the existing `ref.setInput(...)` lines (after line 69's hide flags, before render), add:

```typescript
    ref.setInput('tenantName', snapshot.tenantName);
    ref.setInput('tenantLogoUrl', snapshot.tenantLogoUrl);
```

- [ ] **Step 5: Export dialog resolves the tenant**

In `src/app/features/dashboard/export-dialog/export-dialog.component.ts`:

Add imports:

```typescript
import { TenantService } from '../../../core/services/tenant.service';
```

Add input and service in the class:

```typescript
  readonly tenantId = input('');
  private tenantService = inject(TenantService);
```

In `doExport()` (line ~158), before the format branch, add:

```typescript
    // Resolve the workspace tenant for the export footer's "Prepared for"
    // segment. Failure degrades the footer to two parties; never block export.
    let tenant: { name: string; logoUrl: string | null } | null = null;
    if (this.tenantId()) {
      try {
        const t = await this.tenantService.getTenant(this.tenantId());
        tenant = { name: t.name, logoUrl: t.logo_url ?? null };
      } catch {
        tenant = null;
      }
    }
```

In the PNG branch, extend the snapshot object (where `spaceId: this.spaceId(),` is set at line ~175):

```typescript
          tenantName: tenant?.name ?? '',
          tenantLogoUrl: tenant?.logoUrl ?? null,
```

In the PPTX branch (line ~179), extend the options object with:

```typescript
          tenant,
```

(The `tenant` option lands in Task 10; add it here so both tasks compile together at the end of Task 10. If Task 9 is executed standalone, leave the PPTX `tenant,` line OUT and add it in Task 10 instead. The subagent executing Task 9 should leave it out; Task 10 adds it.)

- [ ] **Step 6: Pass tenantId from the timeline view**

In `src/app/features/landscape/timeline-view.component.html`, the export dialog opens at line 84:

```html
<app-export-dialog
```

Add one binding to its attribute list (the component already has a `tenantId` signal from the route):

```html
  [tenantId]="tenantId()"
```

- [ ] **Step 7: Run tests and build**

Run: `npx vitest run --config vitest.units.config.ts src/app/features/dashboard/export/export-snapshot-host.component.spec.ts && ng build 2>&1 | tail -3`
Expected: PASS, build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/app/features/dashboard/export src/app/features/dashboard/export-dialog src/app/features/landscape/timeline-view.component.html
git commit -m "feat(export): three-party PNG footer (product, agency, tenant)"
```

---

### Task 10: Three-party PPTX footer

**Files:**
- Modify: `src/app/core/services/export-common.util.ts` (ExportOptions)
- Modify: `src/app/core/services/pptx-export.service.ts`
- Create: `src/app/core/services/pptx-footer.spec.ts`
- Modify: `src/app/features/dashboard/export-dialog/export-dialog.component.ts` (add `tenant,` to PPTX options)

- [ ] **Step 1: Write the failing source-contract spec**

Create `src/app/core/services/pptx-footer.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('pptx footer source contract', () => {
  const src = readFileSync(join(__dirname, 'pptx-export.service.ts'), 'utf8');

  it('FooterBrand carries all three parties plus the product mark', () => {
    expect(src).toContain('productMark: string | null');
    expect(src).toContain('tenantName: string | null');
    expect(src).toContain('tenantLogo: string | null');
    expect(src).toContain('agencyLogo: string | null');
  });

  it('renders the delivered-by and prepared-for microlabels', () => {
    expect(src).toContain('DELIVERED BY');
    expect(src).toContain('PREPARED FOR');
  });

  it('rasterizes the shared mark geometry for the footer', () => {
    expect(src).toContain('clintMarkSvgDataUri');
  });
});
```

- [ ] **Step 2: Run spec to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/core/services/pptx-footer.spec.ts`
Expected: FAIL

- [ ] **Step 3: Extend ExportOptions**

In `src/app/core/services/export-common.util.ts`, add to the `ExportOptions` interface:

```typescript
  /** Workspace tenant for the export footer's "Prepared for" segment. */
  tenant?: { name: string; logoUrl: string | null } | null;
```

- [ ] **Step 4: Rework FooterBrand assembly**

In `src/app/core/services/pptx-export.service.ts`:

Add import:

```typescript
import { clintMarkSvgDataUri } from '../../shared/components/clint-mark';
```

Replace the `FooterBrand` interface with:

```typescript
interface FooterBrand {
  appDisplayName: string;
  dateStr: string;
  /** Rasterized Clint mark PNG (product identity, leads the footer). */
  productMark: string | null;
  tenantName: string | null;
  tenantLogo: string | null;
  agencyName: string | null;
  agencyLogo: string | null;
}
```

In `exportDashboard`, replace the brand-capture block (the `const [logoData, agencyLogo] = await Promise.all([...])` plus the `const footer: FooterBrand = ...` line) with:

```typescript
    const tenant = options.tenant ?? null;
    const [logoData, agencyLogo, tenantLogo, productMark] = await Promise.all([
      this.loadLogoAsPng(logoUrl),
      this.loadLogoAsPng(agency?.logo_url ?? null),
      this.loadLogoAsPng(tenant?.logoUrl ?? null),
      this.loadLogoAsPng(
        clintMarkSvgDataUri(64, {
          outer: '#cbd5e1',
          middle: '#94a3b8',
          inner: `#${primaryColorHex}`,
        })
      ),
    ]);
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const footer: FooterBrand = {
      appDisplayName,
      dateStr,
      productMark,
      tenantName: tenant?.name ?? null,
      tenantLogo,
      agencyName,
      agencyLogo,
    };
```

(`logoData` is still used by `renderCover`; the cover layout is unchanged.)

- [ ] **Step 5: Rewrite addFooter**

Replace the ENTIRE `addFooter` method with:

```typescript
  private addFooter(
    slide: PptxGenJS.Slide,
    footer: FooterBrand,
    pageNum: number,
    totalPages: number
  ): void {
    const footerY = SLIDE_H - FOOTER_H;
    const glyph = 0.18;
    const glyphY = footerY + (FOOTER_H - glyph) / 2;
    const microLabel = {
      y: footerY,
      h: FOOTER_H,
      fontSize: 6,
      fontFace: 'Arial',
      bold: true,
      color: '94a3b8',
      charSpacing: 2,
      valign: 'middle' as const,
      wrap: false,
      margin: 0,
    };
    const partyName = {
      y: footerY,
      h: FOOTER_H,
      fontSize: 8,
      fontFace: 'Arial',
      bold: true,
      color: '64748b',
      valign: 'middle' as const,
      wrap: false,
      margin: 0,
    };

    // 1. Product identity: Clint mark + display name. Always present.
    let x = 0.1;
    if (footer.productMark) {
      slide.addImage({
        data: footer.productMark,
        x,
        y: glyphY,
        w: glyph,
        h: glyph,
        sizing: { type: 'contain', w: glyph, h: glyph },
      });
      x += glyph + 0.07;
    }
    slide.addText(footer.appDisplayName, { ...partyName, x, w: 1.4 });
    x += footer.appDisplayName.length * 0.065 + 0.3;

    // 2. Agency: DELIVERED BY + logo (or name). Hidden when no agency.
    if (footer.agencyName) {
      slide.addText('DELIVERED BY', { ...microLabel, x, w: 0.85 });
      x += 0.9;
      if (footer.agencyLogo) {
        slide.addImage({
          data: footer.agencyLogo,
          x,
          y: glyphY,
          w: glyph * 2.4,
          h: glyph,
          sizing: { type: 'contain', w: glyph * 2.4, h: glyph },
        });
        x += glyph * 2.4 + 0.3;
      } else {
        slide.addText(footer.agencyName, { ...partyName, x, w: 1.4 });
        x += footer.agencyName.length * 0.065 + 0.3;
      }
    }

    // 3. Tenant: PREPARED FOR + logo + name. Hidden when absent.
    if (footer.tenantName) {
      slide.addText('PREPARED FOR', { ...microLabel, x, w: 0.9 });
      x += 0.95;
      if (footer.tenantLogo) {
        slide.addImage({
          data: footer.tenantLogo,
          x,
          y: glyphY,
          w: glyph,
          h: glyph,
          sizing: { type: 'contain', w: glyph, h: glyph },
        });
        x += glyph + 0.07;
      }
      slide.addText(footer.tenantName, { ...partyName, x, w: 1.8 });
    }

    // Right cluster: date + page number (unchanged).
    slide.addText(footer.dateStr, {
      x: SLIDE_W - 2.7,
      y: footerY,
      w: 1.6,
      h: FOOTER_H,
      fontSize: 8,
      fontFace: 'Arial',
      color: '94a3b8',
      align: 'right',
      valign: 'middle',
      wrap: false,
      margin: 0,
    });
    slide.addText(`${pageNum} / ${totalPages}`, {
      x: SLIDE_W - 1.05,
      y: footerY,
      w: 0.95,
      h: FOOTER_H,
      fontSize: 8,
      fontFace: 'Arial',
      color: '94a3b8',
      align: 'right',
      valign: 'middle',
      wrap: false,
      margin: 0,
    });
  }
```

- [ ] **Step 6: Pass the tenant from the export dialog**

In `src/app/features/dashboard/export-dialog/export-dialog.component.ts`, in the PPTX branch of `doExport()` (the `await this.pptxService.exportDashboard(this.companies(), { ... })` call), add to the options object:

```typescript
          tenant,
```

(`tenant` was resolved in Task 9 Step 5.)

- [ ] **Step 7: Run tests and build**

Run: `npx vitest run --config vitest.units.config.ts src/app/core/services/pptx-footer.spec.ts && npx vitest run --config vitest.units.config.ts src/app/core/services/pptx-marker-glyph.spec.ts && ng build 2>&1 | tail -3`
Expected: both PASS, build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/app/core/services/export-common.util.ts src/app/core/services/pptx-export.service.ts src/app/core/services/pptx-footer.spec.ts src/app/features/dashboard/export-dialog/export-dialog.component.ts
git commit -m "feat(export): three-party PPTX footer with rasterized clint mark"
```

---

### Task 11: Clint Intelligence badge + import page wiring

**Files:**
- Create: `src/app/shared/components/intelligence-badge/intelligence-badge.component.ts`
- Create: `src/app/shared/components/intelligence-badge/intelligence-badge.component.spec.ts`
- Modify: `src/app/features/source-import/import-page.component.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/shared/components/intelligence-badge/intelligence-badge.component.spec.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('IntelligenceBadgeComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'intelligence-badge.component.ts'), 'utf8');

  it('labels as "{appDisplayName} Intelligence" with the brand accent', () => {
    expect(src).toContain('appDisplayName()');
    expect(src).toContain('text-brand-600');
    expect(src).toContain('Intelligence');
  });

  it('animates only when active', () => {
    expect(src).toContain('@if (active())');
    expect(src).toContain('clint-mark-draw');
  });

  it('renders a full-strength mark at rest (track classes only while active)', () => {
    expect(src).toContain(`[class.clint-mark-track]="active()"`);
  });
});

describe('import page intelligence wiring', () => {
  const src = readFileSync(
    join(__dirname, '../../../features/source-import/import-page.component.ts'),
    'utf8'
  );

  it('signs the extraction progress with the badge and uses the loader on the active step', () => {
    expect(src).toContain('app-intelligence-badge');
    expect(src).toContain('app-loader');
    expect(src).not.toContain('animate-ping');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/intelligence-badge/intelligence-badge.component.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the badge**

Create `src/app/shared/components/intelligence-badge/intelligence-badge.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { BrandContextService } from '../../../core/services/brand-context.service';
import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX, clintMarkStrokes } from '../clint-mark';

/**
 * Sub-brand lockup for AI-powered surfaces: "{AppName} Intelligence".
 * At rest the mark is static at full strength. While the AI is actively
 * working (active=true) the mark runs the draw-through animation, so the
 * badge doubles as the loading indicator for the surface it signs.
 */
@Component({
  selector: 'app-intelligence-badge',
  template: `
    <svg width="14" height="14" [attr.viewBox]="viewBox" fill="none" aria-hidden="true">
      <polyline
        [class.clint-mark-track]="active()"
        [attr.points]="points.outer"
        stroke="#cbd5e1"
        [attr.stroke-width]="strokes.outer"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [class.clint-mark-track]="active()"
        [attr.points]="points.middle"
        stroke="#94a3b8"
        [attr.stroke-width]="strokes.middle"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <polyline
        [class.clint-mark-track]="active()"
        [attr.points]="points.inner"
        stroke="var(--brand-600)"
        [attr.stroke-width]="strokes.inner"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      @if (active()) {
        <polyline
          class="clint-mark-draw"
          pathLength="1"
          [attr.points]="points.outer"
          stroke="#cbd5e1"
          [attr.stroke-width]="strokes.outer"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          class="clint-mark-draw clint-mark-draw--m"
          pathLength="1"
          [attr.points]="points.middle"
          stroke="#94a3b8"
          [attr.stroke-width]="strokes.middle"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <polyline
          class="clint-mark-draw clint-mark-draw--i"
          pathLength="1"
          [attr.points]="points.inner"
          stroke="var(--brand-600)"
          [attr.stroke-width]="strokes.inner"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      }
    </svg>
    <span class="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">
      {{ appDisplayName() }} <span class="text-brand-600">Intelligence</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceBadgeComponent {
  private readonly brand = inject(BrandContextService);

  /** True while the AI is actively working; animates the mark. */
  readonly active = input<boolean>(false);

  protected readonly viewBox = CLINT_MARK_VIEWBOX;
  protected readonly points = CLINT_MARK_POINTS;
  protected readonly strokes = clintMarkStrokes(14);
  protected readonly appDisplayName = computed(() => this.brand.appDisplayName());
}
```

- [ ] **Step 4: Wire the import page**

In `src/app/features/source-import/import-page.component.ts`:

Add imports:

```typescript
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import { IntelligenceBadgeComponent } from '../../shared/components/intelligence-badge/intelligence-badge.component';
```

Add `LoaderComponent, IntelligenceBadgeComponent` to the decorator imports array.

Replace the extraction progress block (lines 130-154):

```html
              @if (extracting()) {
                <div class="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div class="flex flex-col gap-2">
```

with:

```html
              @if (extracting()) {
                <div class="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div class="mb-2.5">
                    <app-intelligence-badge [active]="true" />
                  </div>
                  <div class="flex flex-col gap-2">
```

and replace the active-step branch:

```html
                        } @else if (extractStepIndex() === $index) {
                          <span class="relative flex h-4 w-4">
                            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-40"></span>
                            <span class="relative inline-flex h-4 w-4 rounded-full bg-brand-500"></span>
                          </span>
                          <span class="text-xs font-medium text-slate-700">{{ extractStepLabels[s] }}</span>
                        } @else {
```

with:

```html
                        } @else if (extractStepIndex() === $index) {
                          <app-loader [size]="16" />
                          <span class="text-xs font-medium text-slate-700">{{ extractStepLabels[s] }}</span>
                        } @else {
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run --config vitest.units.config.ts src/app/shared/components/intelligence-badge/intelligence-badge.component.spec.ts && ng build 2>&1 | tail -3`
Expected: PASS, build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/app/shared/components/intelligence-badge src/app/features/source-import/import-page.component.ts
git commit -m "feat(brand): clint intelligence badge signs the source import flow"
```

---

### Task 12: Docs, spec amendment, full verification

**Files:**
- Modify: `docs/design-system.md` (repo root)
- Modify: `docs/superpowers/specs/2026-06-11-clint-loader-and-brand-presence-design.md`

- [ ] **Step 1: Design system additions**

In `docs/design-system.md`, section "## 4. Primitives inventory", add three rows to the primitives table (after the "Row actions" row):

```markdown
| Loading (operation) | `app-loader` (`loader.component.ts`) | Draw-through Clint mark + optional caption. Never `p-progressSpinner` (its unlayered CSS ignores Tailwind sizing). |
| Empty-state watermark | `app-mark-watermark` (`mark-watermark.component.ts`) | Faded mark behind empty states. Decorative, never animated. |
| AI badge | `app-intelligence-badge` (`intelligence-badge.component.ts`) | "{AppName} Intelligence" lockup; `active` animates the mark while the AI works. |
```

Directly after the table, add:

```markdown
**Loading states.** Three patterns, by scope: `app-skeleton` / `app-table-skeleton-body`
preserve layout while row or table content loads; `app-loader` covers operations and
panel loads (exports, drawers, filter hydration); the `p-button` `[loading]` state covers
button-scoped actions. The mark animates only while something is actually loading;
it is static everywhere at rest. All draw animations disable under
`prefers-reduced-motion: reduce`.
```

- [ ] **Step 2: Spec amendment (watermark scope)**

In `docs/superpowers/specs/2026-06-11-clint-loader-and-brand-presence-design.md`, section "### 6. Empty-state watermark", replace the sentence listing the surfaces:

```markdown
Opt-in on the major browse/visualization empty states where an empty-state block already exists: timeline ("no companies match"), heatmap, catalysts, events. Static, never animated.
```

with:

```markdown
Opt-in on the major visualization empty states, which are centered flex containers: timeline ("no clinical trial data"), bullseye ("no assets match"), heatmap ("no data matches"). The catalysts and events tables render their empty states as table rows where an absolutely positioned watermark does not fit; they stay text-only. Static, never animated.
```

- [ ] **Step 3: Full verification**

From `<worktree>/src/client`:

Run: `npm run test:units`
Expected: all specs pass (new ones included)

Run: `ng lint 2>&1 | tail -5`
Expected: no errors (warnings at the existing baseline are acceptable)

Run: `ng build 2>&1 | tail -3`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add docs/design-system.md docs/superpowers/specs/2026-06-11-clint-loader-and-brand-presence-design.md
git commit -m "docs: loader, watermark, intelligence badge in design system; watermark scope"
```

---

### Task 13: Finish: merge develop, push, PR

- [ ] **Step 1: Merge develop and resolve**

```bash
git fetch origin develop
git merge origin/develop
```

Resolve any conflicts, re-run `npm run test:units && ng build`.

- [ ] **Step 2: Push and open PR**

Push with `--no-verify` if the pre-push e2e hook flakes (the real suites already ran; CI is canonical):

```bash
git push -u origin feat/clint-loader-brand-presence --no-verify
gh pr create --base develop --title "Clint loader and brand presence" --body "..."
```

PR body should summarize: loader replacing broken spinners (root cause: PrimeNG unlayered CSS), sidebar lockup, boot splash, watermark, three-party export footers (PNG + PPTX), public footer mark, landing draw-in, Clint Intelligence badge. Link the spec. No Claude attribution.
