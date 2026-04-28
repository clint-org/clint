# Whitelabel Theme + BrandContext Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. This combines plan-2 (theme refactor) and plan-3 (BrandContext + bootstrap) from the spec since they are tightly coupled — the theme refactor only matters once a BrandContext drives dynamic primary scale.

**Goal:** Make the app's primary color tenant-driven at runtime. Default theme is unchanged for tenants without a brand override; tenants with a custom `primary_color` see their color throughout the UI (PrimeNG components and Tailwind utilities).

**Architecture:**
- `primeng-theme.ts` — refactor `{teal.X}` references to `{primary.X}` so `semantic.primary` is the single source of truth. Replace static default export with `buildBrandPreset(scale?)` function.
- `styles.css` — add Tailwind v4 `@theme` block declaring `--color-brand-50` … `--color-brand-950` mapped to CSS variables that default to the teal scale.
- Codemod `bg-teal-*` / `text-teal-*` / `border-teal-*` / `ring-teal-*` / `from-teal-*` / `via-teal-*` / `to-teal-*` → `*-brand-*` across the client.
- `BrandContext` service — signal-based holder for the brand record from `get_brand_by_host`.
- `color-scale.ts` helper — generate a 50–950 hex scale from a single seed using the same algorithm Tailwind v4 uses (HSL adjustments).
- `main.ts` — async pre-bootstrap host fetch, set CSS vars + favicon + title, build dynamic preset, then `bootstrapApplication`.

**Tech Stack:** Angular 19, PrimeNG 19, Tailwind CSS v4, Supabase JS 2.49.

---

### Task 1: Refactor `primeng-theme.ts` to use `{primary.X}` consistently

**Files:**
- Modify: `src/client/src/app/config/primeng-theme.ts`

The preset already maps `semantic.primary.50..950` to `{teal.X}` at the top. Walk every other property in the file (button colors, focus rings, tabs, message colors, list option colors, etc.) and replace `{teal.X}` references with `{primary.X}`. Don't touch slate/red/amber/green — those are data colors.

**Hard rule:** every `{teal.<n>}` must become `{primary.<n>}`. Search-and-replace is fine; verify no false positives (there shouldn't be — teal is only used as the brand primary).

After the refactor, also convert the file from a static `export default ClinicalTheme` to a function:

```typescript
import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

export type BrandScale = {
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string; 950: string;
};

const TEAL_SCALE: BrandScale = {
  50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf',
  500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a', 950: '#042f2e',
};

export function buildBrandPreset(scale: BrandScale = TEAL_SCALE) {
  return definePreset(Aura, {
    semantic: {
      primary: scale,
      // ... (rest of existing semantic block, unchanged except {teal.X} -> {primary.X})
    },
    components: {
      // ... (rest of existing components block, unchanged except {teal.X} -> {primary.X})
    },
  });
}

// Default export preserved for any consumer that imports the symbol directly,
// though app.config.ts will switch to calling buildBrandPreset() explicitly.
export default buildBrandPreset();
```

The function takes a scale object (defaults to teal). Inside, `semantic.primary` is set to the passed scale; everything else uses `{primary.X}` to reference it transitively. Calling `buildBrandPreset()` with no argument returns the existing preset behavior.

- [ ] **Step 1:** Replace every `{teal.<n>}` in `primeng-theme.ts` with `{primary.<n>}`. Use a search-replace; verify with `grep '{teal\\.' src/client/src/app/config/primeng-theme.ts` returning zero matches.
- [ ] **Step 2:** Wrap the existing preset literal in a `buildBrandPreset(scale: BrandScale = TEAL_SCALE)` function. Replace `semantic.primary.<n>: '{teal.X}'` with `semantic.primary: scale`. Keep the default export by calling the function with no argument: `export default buildBrandPreset();`. Export `BrandScale` and `TEAL_SCALE` for the bootstrap.
- [ ] **Step 3:** `cd src/client && npx ng build` — must succeed.
- [ ] **Step 4:** Visually verify in `npx ng serve` that the app still looks identical (default scale = teal).
- [ ] **Step 5:** Commit `refactor(theme): primeng preset uses {primary.X} consistently; expose buildBrandPreset(scale)`.

---

### Task 2: Add Tailwind `@theme` brand tokens

**Files:**
- Modify: `src/client/src/styles.css`

Tailwind v4 lets you add custom color scales via `@theme`. Add a brand scale that defaults to teal but resolves CSS variables at runtime:

```css
@import 'tailwindcss';
@import '@fortawesome/fontawesome-free/css/all.min.css';
@import './app/shared/styles/primeng-overrides.css';
@import './app/shared/styles/data-table.css';
@import './app/shared/styles/page-shell.css';
@import './app/shared/styles/animations.css';
@import './app/features/landscape/landscape.css';
@plugin "tailwindcss-primeui";

@theme {
  --color-brand-50:  var(--brand-50,  #f0fdfa);
  --color-brand-100: var(--brand-100, #ccfbf1);
  --color-brand-200: var(--brand-200, #99f6e4);
  --color-brand-300: var(--brand-300, #5eead4);
  --color-brand-400: var(--brand-400, #2dd4bf);
  --color-brand-500: var(--brand-500, #14b8a6);
  --color-brand-600: var(--brand-600, #0d9488);
  --color-brand-700: var(--brand-700, #0f766e);
  --color-brand-800: var(--brand-800, #115e59);
  --color-brand-900: var(--brand-900, #134e4a);
  --color-brand-950: var(--brand-950, #042f2e);
}
```

The `var(--brand-X, <fallback>)` form means: when the runtime BrandContext sets `--brand-X` on `:root`, Tailwind picks it up; otherwise it falls back to the teal hex. So existing tenants without a brand render unchanged.

- [ ] **Step 1:** Edit `src/client/src/styles.css`, adding the `@theme` block at the end (after the `@plugin` line).
- [ ] **Step 2:** `cd src/client && npx ng build` — must succeed.
- [ ] **Step 3:** Commit `feat(theme): tailwind @theme brand-* tokens default to teal scale via css vars`.

---

### Task 3: Codemod `bg/text/border/ring/from/via/to-teal-*` → `*-brand-*`

**Files:**
- Modify: every `*.ts`, `*.html`, `*.css` file under `src/client/src/` that contains `teal-`. Expected ~29 files, ~73 occurrences.

Slate, red, amber, green are data colors and stay hard-coded. Only `teal-*` becomes `brand-*`.

The mechanical replacements:
- `bg-teal-` → `bg-brand-`
- `text-teal-` → `text-brand-`
- `border-teal-` → `border-brand-`
- `ring-teal-` → `ring-brand-`
- `from-teal-` → `from-brand-`
- `via-teal-` → `via-brand-`
- `to-teal-` → `to-brand-`
- `outline-teal-` → `outline-brand-`
- `decoration-teal-` → `decoration-brand-`
- `divide-teal-` → `divide-brand-`
- `placeholder-teal-` → `placeholder-brand-`
- `accent-teal-` → `accent-brand-`
- `caret-teal-` → `caret-brand-`
- `fill-teal-` → `fill-brand-`
- `stroke-teal-` → `stroke-brand-`

Easiest: `sed`-style replace via `find ... -exec`. Be careful not to rewrite hex colors that contain "teal" in a comment or any usage like `'teal.X'` token references in TypeScript (those are PrimeNG token strings — but you already converted those to `{primary.X}` in Task 1, so any remaining `teal.X` literal in the code is a candidate for review).

- [ ] **Step 1:** Find all teal usages: `grep -rn 'teal-' src/client/src --include='*.ts' --include='*.html' --include='*.css'`. Save the count for verification.
- [ ] **Step 2:** Run a codemod across `src/client/src` replacing the patterns above. Suggested:
  ```bash
  cd src/client/src
  find . -type f \( -name '*.ts' -o -name '*.html' -o -name '*.css' \) -print0 \
    | xargs -0 sed -i '' \
      -e 's/\bbg-teal-/bg-brand-/g' \
      -e 's/\btext-teal-/text-brand-/g' \
      -e 's/\bborder-teal-/border-brand-/g' \
      -e 's/\bring-teal-/ring-brand-/g' \
      -e 's/\bfrom-teal-/from-brand-/g' \
      -e 's/\bvia-teal-/via-brand-/g' \
      -e 's/\bto-teal-/to-brand-/g' \
      -e 's/\boutline-teal-/outline-brand-/g' \
      -e 's/\bdecoration-teal-/decoration-brand-/g' \
      -e 's/\bdivide-teal-/divide-brand-/g' \
      -e 's/\bplaceholder-teal-/placeholder-brand-/g' \
      -e 's/\baccent-teal-/accent-brand-/g' \
      -e 's/\bcaret-teal-/caret-brand-/g' \
      -e 's/\bfill-teal-/fill-brand-/g' \
      -e 's/\bstroke-teal-/stroke-brand-/g'
  ```
- [ ] **Step 3:** Verify zero remaining utility-class teal usages: `grep -rn 'bg-teal-\|text-teal-\|border-teal-\|ring-teal-\|from-teal-\|via-teal-\|to-teal-\|outline-teal-\|decoration-teal-\|divide-teal-\|placeholder-teal-\|accent-teal-\|caret-teal-\|fill-teal-\|stroke-teal-' src/client/src/`. Expected: zero matches.
- [ ] **Step 4:** Verify any *remaining* `teal` references are intentional (comments mentioning the old palette, brand guide docs in `docs/`, PrimeNG token strings if any survived Task 1 — none should). `grep -rn 'teal' src/client/src` — every hit should be either a brand-guide reference, a data-color comment, or something the human reviewer agrees is intentional. List anything ambiguous in the report.
- [ ] **Step 5:** `cd src/client && npx ng build` — must succeed (Tailwind compiles `bg-brand-X` against the new `@theme` tokens).
- [ ] **Step 6:** `cd src/client && npx ng lint` — no new lint errors introduced.
- [ ] **Step 7:** Commit `refactor(client): bg/text/border/ring-teal-* -> bg/text/border/ring-brand-* across the client`.

---

### Task 4: Color-scale generator helper

**Files:**
- Create: `src/client/src/app/core/util/color-scale.ts`

A small pure helper that takes a 6-char hex (the brand `primary_color`) and returns a `BrandScale` object with 11 hex values (50–950). Algorithm: convert hex to OKLCH, anchor lightness across the scale at the same lightness values Tailwind v4 uses for its hue families, recompose to hex.

Realistic v1 simpler approach (acceptable trade-off): convert hex → HSL, hold the hue and saturation roughly constant, vary lightness across [97, 93, 86, 76, 65, 54, 47, 39, 31, 23, 13] (approximate Tailwind teal lightness curve). Output hex strings.

```typescript
export interface BrandScale {
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string; 950: string;
}

const SCALE_LIGHTNESS = [97, 93, 86, 76, 65, 54, 47, 39, 31, 23, 13];
const SCALE_KEYS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

export function generateBrandScale(seedHex: string): BrandScale {
  const seed = seedHex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(seed)) {
    throw new Error(`Invalid hex color: ${seedHex}`);
  }
  const r = parseInt(seed.slice(0, 2), 16) / 255;
  const g = parseInt(seed.slice(2, 4), 16) / 255;
  const b = parseInt(seed.slice(4, 6), 16) / 255;
  const [h, s] = rgbToHsl(r, g, b);

  const out = {} as BrandScale;
  for (let i = 0; i < SCALE_KEYS.length; i++) {
    const l = SCALE_LIGHTNESS[i] / 100;
    const adjustedSat = i <= 1 ? Math.min(s, 0.4) : i >= 9 ? Math.min(s, 0.7) : s;
    out[SCALE_KEYS[i]] = hslToHex(h, adjustedSat, l);
  }
  return out;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
    case g: h = ((b - r) / d + 2); break;
    default: h = ((r - g) / d + 4);
  }
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
```

- [ ] **Step 1:** Create `src/client/src/app/core/util/color-scale.ts` with the code above.
- [ ] **Step 2:** Sanity-check by feeding `'#0d9488'` (teal-600) and inspecting that the generated 600 swatch is approximately `#0d9488` (within a few hex units). Add a temporary `console.log` if needed during development; remove before commit. The exact match isn't required (this is an approximation, not a 1:1 replication of Tailwind's algorithm) — just that the gradient is plausible.
- [ ] **Step 3:** `cd src/client && npx ng build` — must succeed.
- [ ] **Step 4:** Commit `feat(theme): color-scale generator from single hex seed`.

---

### Task 5: `BrandContext` service

**Files:**
- Create: `src/client/src/app/core/services/brand-context.service.ts`
- Create: `src/client/src/app/core/models/brand.model.ts`

```typescript
// brand.model.ts
export type BrandKind = 'tenant' | 'agency' | 'super-admin' | 'default';

export interface Brand {
  kind: BrandKind;
  id: string | null;
  app_display_name: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  accent_color: string | null;
  auth_providers: string[];
  has_self_join: boolean;
  suspended: boolean;
}
```

```typescript
// brand-context.service.ts
import { Injectable, signal, computed } from '@angular/core';
import { Brand } from '../models/brand.model';

const DEFAULT_BRAND: Brand = {
  kind: 'default',
  id: null,
  app_display_name: 'Clint',
  logo_url: null,
  favicon_url: null,
  primary_color: '#0d9488',
  accent_color: null,
  auth_providers: ['google'],
  has_self_join: false,
  suspended: false,
};

@Injectable({ providedIn: 'root' })
export class BrandContextService {
  private readonly _brand = signal<Brand>(DEFAULT_BRAND);

  readonly brand = this._brand.asReadonly();
  readonly kind = computed(() => this._brand().kind);
  readonly appDisplayName = computed(() => this._brand().app_display_name);
  readonly logoUrl = computed(() => this._brand().logo_url);
  readonly faviconUrl = computed(() => this._brand().favicon_url);
  readonly primaryColor = computed(() => this._brand().primary_color);
  readonly accentColor = computed(() => this._brand().accent_color);
  readonly authProviders = computed(() => this._brand().auth_providers);
  readonly hasSelfJoin = computed(() => this._brand().has_self_join);
  readonly suspended = computed(() => this._brand().suspended);

  setBrand(brand: Brand): void {
    this._brand.set(brand);
  }
}
```

- [ ] **Step 1:** Create both files with the code above.
- [ ] **Step 2:** `cd src/client && npx ng build` — must succeed.
- [ ] **Step 3:** Commit `feat(brand): BrandContext service holding the brand record`.

---

### Task 6: Pre-bootstrap host fetch and dynamic theme application

**Files:**
- Modify: `src/client/src/main.ts`
- Modify: `src/client/src/app/app.config.ts`

The bootstrap order changes:

1. Read `window.location.host`.
2. Create a temporary Supabase client (using the same env config the app uses) and call `supabase.rpc('get_brand_by_host', { p_host: host })`.
3. Apply side effects:
   - `document.title = brand.app_display_name`
   - Update favicon `<link>` if `brand.favicon_url` set
   - On `:root`, set `--brand-50` … `--brand-950` from `generateBrandScale(brand.primary_color)`
4. Build the dynamic preset: `buildBrandPreset(scale)` and pass it to `providePrimeNG`.
5. Provide the brand to the DI container so `BrandContextService` already holds it on first injection.
6. `bootstrapApplication(AppComponent, configWithDynamicTheme)`.

The Supabase client config is in `src/client/src/app/core/services/supabase.service.ts` — fetch the URL/anon-key from environment in the same way main.ts can. If they're hard-coded in environment files, import those.

```typescript
// main.ts
import 'zone.js';
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { providePrimeNG } from 'primeng/config';
import { bootstrapApplication } from '@angular/platform-browser';
import { createClient } from '@supabase/supabase-js';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { environment } from './environments/environment';
import { buildBrandPreset } from './app/config/primeng-theme';
import { generateBrandScale } from './app/core/util/color-scale';
import { BrandContextService } from './app/core/services/brand-context.service';
import { Brand } from './app/core/models/brand.model';

const DEFAULT_BRAND: Brand = {
  kind: 'default',
  id: null,
  app_display_name: 'Clint',
  logo_url: null,
  favicon_url: null,
  primary_color: '#0d9488',
  accent_color: null,
  auth_providers: ['google'],
  has_self_join: false,
  suspended: false,
};

async function fetchBrand(): Promise<Brand> {
  try {
    const supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
    const { data, error } = await supabase.rpc('get_brand_by_host', {
      p_host: window.location.host,
    });
    if (error || !data) return DEFAULT_BRAND;
    return data as Brand;
  } catch {
    return DEFAULT_BRAND;
  }
}

function applyBrandSideEffects(brand: Brand): void {
  document.title = brand.app_display_name;
  if (brand.favicon_url) {
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = brand.favicon_url;
  }
  const scale = generateBrandScale(brand.primary_color);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(scale)) {
    root.style.setProperty(`--brand-${key}`, value);
  }
}

(async () => {
  const brand = await fetchBrand();
  applyBrandSideEffects(brand);

  const dynamicConfig: ApplicationConfig = {
    providers: [
      providePrimeNG({
        theme: {
          preset: buildBrandPreset(generateBrandScale(brand.primary_color)),
          options: {
            prefix: 'p',
            darkModeSelector: false,
            cssLayer: false,
          },
        },
        ripple: false,
      }),
      {
        provide: BrandContextService,
        useFactory: () => {
          const svc = new BrandContextService();
          svc.setBrand(brand);
          return svc;
        },
      },
    ],
  };

  // Strip the static providePrimeNG out of appConfig and merge our dynamic one.
  await bootstrapApplication(AppComponent, mergeApplicationConfig(appConfig, dynamicConfig));
})().catch(err => console.error('bootstrap failed', err));
```

`app.config.ts`: remove the `providePrimeNG(...)` block (it's now in main.ts) and any `import ClinicalTheme from './config/primeng-theme';` reference. Keep everything else.

```typescript
// app.config.ts (after edit)
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withRouterConfig } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideAnimationsAsync(),
    ConfirmationService,
    MessageService,
  ],
};
```

- [ ] **Step 1:** Locate `environment.supabaseUrl` and `environment.supabaseAnonKey`. Confirm they're in `src/client/src/environments/environment.ts` (or `environment.development.ts`). If named differently, adjust the imports in `main.ts`.
- [ ] **Step 2:** Edit `app.config.ts` to remove `providePrimeNG` and the `ClinicalTheme` import.
- [ ] **Step 3:** Replace `main.ts` with the version above (adjust env imports to match the actual environment file).
- [ ] **Step 4:** `cd src/client && npx ng build` — must succeed.
- [ ] **Step 5:** `cd src/client && npx ng serve` and load `http://localhost:4200`. The default brand should render — same as before — with `document.title === 'Clint'` and `--brand-600` matching `#0d9488` on `:root` (inspect via DevTools).
- [ ] **Step 6:** Local DB test: insert a tenant with `subdomain = 'localhost'` and `primary_color = '#cc0000'` (red). Then with `127.0.0.1:4200` mapped via `/etc/hosts` or by editing `localhost.yourproduct.com` style — for v1 acceptance, just confirm the RPC call returns the brand and side effects apply when DOM-inspected. (A full subdomain test waits for plan 4 routing.) If localhost test is not feasible, manually invoke `fetchBrand()` from console with a different host.
- [ ] **Step 7:** Commit `feat(bootstrap): pre-bootstrap host fetch + dynamic CSS vars + dynamic PrimeNG preset`.

---

### Task 7: Verification + lint + build

- [ ] **Step 1:** `cd src/client && npx ng lint` — clean.
- [ ] **Step 2:** `cd src/client && npx ng build` — succeeds.
- [ ] **Step 3:** Manual smoke: serve, click around the dashboard, ensure no visual regressions vs main. Header, dashboard, manage pages, dialogs, tabs, buttons, forms.
- [ ] **Step 4:** Commit any final adjustments. End-of-plan summary: `feat(brand): theme + brand context + dynamic primary scale (closes plan 2-3)`.

---

## What this plan does NOT do

- No client routing changes (plan 4).
- No login screen rebuild (plan 5).
- No agency portal (plan 6).
- No email function (plan 7).
- No PPT export wiring (plan 8).
- The `kind`-aware routing is deferred — `BrandContext.kind()` returns `'default'` for now on every host; tenant-aware routing comes in plan 4.
