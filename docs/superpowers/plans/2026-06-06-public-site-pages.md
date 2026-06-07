# Host-aware Public Site Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the standard public-website furniture to Clint -- a host-aware footer, platform-owned Privacy/Terms pages, a branded 404, host-aware robots.txt, and SEO/OG meta with a generated share image.

**Architecture:** Five uncoupled units. Presentational Angular components (footer, legal pages, 404) follow the existing spec-less help-page pattern; testable logic is isolated into two pure modules -- `core/models/legal-content.ts` (legal text + platform constants) and `worker/robots.ts` (host -> robots body) -- which get Vitest specs in the node and worker pools respectively. Legal docs are platform-owned (attributed to "Clint"), not brand-swapped; only chrome (footer brand name, logo) is host-aware. The OG image is composed from the logo + brand tokens as HTML and rendered to PNG via the installed Chromium at 2x.

**Tech Stack:** Angular 19 standalone + Tailwind v4, Cloudflare Worker (`worker/index.ts`), Vitest (`test:units` node pool, `test:worker` workerd pool), Playwright Chromium (OG render only).

**Deviations from spec (intentional, codebase-consistent):**
- `legal-content.ts` lives in `core/models/` not `features/legal/`, so the `shared/` footer can import it without a shared -> features layering violation (mirrors `core/models/phase-colors.ts` consumed by help pages).
- Tests target the two pure modules, not DOM-rendered components. `test:units` is node-only (zero specs use Angular TestBed) and the existing help components ship no render specs; component wiring is verified by `ng build` + manual load.

---

## File Structure

- Create `src/client/src/app/core/models/legal-content.ts` -- platform constants + Privacy/Terms section data.
- Create `src/client/src/app/core/models/legal-content.spec.ts` -- node unit spec.
- Create `src/client/worker/robots.ts` -- pure `buildRobots(host, apexes)`.
- Create `src/client/worker/test/robots.spec.ts` -- workerd unit spec.
- Modify `src/client/worker/index.ts` -- import + `/robots.txt` handler.
- Create `src/client/src/app/shared/components/public-footer.component.ts`.
- Create `src/client/src/app/features/legal/privacy-policy.component.ts`.
- Create `src/client/src/app/features/legal/terms-of-service.component.ts`.
- Create `src/client/src/app/features/not-found/not-found.component.ts`.
- Modify `src/client/src/app/app.routes.ts` -- add `/privacy`, `/terms`; replace wildcard with 404.
- Modify `src/client/src/app/features/marketing/marketing-landing.component.ts` -- add footer.
- Modify `src/client/src/app/features/auth/login.component.ts` -- add footer (column wrapper).
- Modify `src/client/src/index.html` -- title/description/OG/Twitter meta.
- Create `src/client/scripts/og-image/og-image.html` -- banner source.
- Create `src/client/scripts/og-image/render.mjs` -- Chromium render to PNG.
- Modify `src/client/package.json` -- `og:image` script.
- Create `src/client/public/og-image.png` -- generated artifact.

---

## Task 1: Legal content module (pure data + constants)

**Files:**
- Create: `src/client/src/app/core/models/legal-content.ts`
- Test: `src/client/src/app/core/models/legal-content.spec.ts`

- [ ] **Step 1: Write the failing test**

`src/client/src/app/core/models/legal-content.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PRIVACY_SECTIONS,
  TERMS_SECTIONS,
  PLATFORM_OPERATOR,
  PLATFORM_LEGAL_EMAIL,
} from './legal-content';

const allText = [...PRIVACY_SECTIONS, ...TERMS_SECTIONS]
  .flatMap((s) => [s.heading, ...s.body])
  .join(' ');

describe('legal content', () => {
  it('attributes the documents to the platform operator', () => {
    expect(PLATFORM_OPERATOR).toBe('Clint');
    expect(allText).toContain('Clint');
  });

  it('exposes the platform legal contact email', () => {
    expect(PLATFORM_LEGAL_EMAIL).toBe('privacy@clintapp.com');
    expect(allText).toContain('privacy@clintapp.com');
  });

  it('is platform-owned, not brand-swapped to a tenant name', () => {
    expect(allText.toLowerCase()).not.toContain('acme');
  });

  it('has non-empty privacy and terms sections', () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(0);
    expect(TERMS_SECTIONS.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/models/legal-content.spec.ts`
Expected: FAIL -- cannot resolve `./legal-content`.

- [ ] **Step 3: Write the module**

`src/client/src/app/core/models/legal-content.ts`:

```ts
/**
 * Platform-owned legal content. These documents are authored as Clint's
 * (the platform operator / sub-processor) own Privacy Policy and Terms of
 * Service. They are NOT brand-swapped per host: a tenant's display name
 * never appears in the legal body. Only surrounding chrome (footer brand
 * name, logo) is host-aware. Per-agency uploaded legal docs are a future
 * feature; see docs/superpowers/specs/2026-06-06-public-site-pages-design.md.
 *
 * NOT LEGAL ADVICE. This is a generic starting template that must be
 * reviewed by qualified counsel before it is relied upon.
 */
export const PLATFORM_OPERATOR = 'Clint';
export const PLATFORM_LEGAL_EMAIL = 'privacy@clintapp.com';
export const LAST_UPDATED = 'June 6, 2026';

export interface LegalSection {
  heading: string;
  body: string[];
}

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: 'Who we are',
    body: [
      'Clint is a competitive intelligence platform for pharmaceutical teams, operated by Clint ("Clint", "we", "us"). This policy explains what personal data we process when you use the platform and the websites that serve it.',
      'Where Clint is provided to you through a consulting partner, that partner determines how the workspace is used. In data protection terms Clint generally acts as a processor or sub-processor and the partner or your organization acts as the controller. This policy describes Clint’s own processing as the platform operator.',
    ],
  },
  {
    heading: 'Data we process',
    body: [
      'Account data: your name, work email address, and authentication identifiers from the sign-in provider you use (for example Google).',
      'Usage data: technical logs such as IP address, browser type, and pages accessed, used to operate, secure, and improve the service.',
      'Content data: the competitive intelligence records, notes, and materials you and your team enter into a workspace. This content belongs to your organization; we process it to provide the service.',
    ],
  },
  {
    heading: 'How we use data',
    body: [
      'We use personal data to authenticate you, provide and maintain the platform, keep it secure, respond to support requests, and meet legal obligations. We do not sell personal data.',
    ],
  },
  {
    heading: 'Cookies and analytics',
    body: [
      'We use strictly necessary cookies to keep you signed in, including a session cookie scoped to our domain so that you stay authenticated across workspace subdomains. We use privacy-respecting product analytics to understand aggregate usage and improve the service.',
    ],
  },
  {
    heading: 'Sharing and sub-processors',
    body: [
      'We share data with infrastructure providers that host and deliver the platform (including our cloud database and content delivery providers) strictly to operate the service, under contractual confidentiality and data-protection terms.',
    ],
  },
  {
    heading: 'Data retention and security',
    body: [
      'We retain personal data for as long as your account or workspace is active, and as needed to comply with legal obligations. We apply technical and organizational measures, including encryption in transit and access controls, to protect data.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'Depending on your location you may have rights to access, correct, export, or delete your personal data, and to object to or restrict certain processing. To exercise these rights, contact us at privacy@clintapp.com. If your workspace is administered by a consulting partner or your employer, we may direct your request to that controller.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      'Questions about this policy or your data can be sent to privacy@clintapp.com.',
    ],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: 'Agreement',
    body: [
      'These Terms of Service govern your access to and use of the Clint platform operated by Clint. By accessing or using the platform you agree to these terms. If you use Clint on behalf of an organization, you accept these terms for that organization.',
      'Where Clint is delivered to you through a consulting partner, your relationship with that partner is governed by your separate agreement with them; these terms govern your use of the underlying Clint platform.',
    ],
  },
  {
    heading: 'Accounts',
    body: [
      'You are responsible for safeguarding your account and for all activity that occurs under it. You must provide accurate information and notify us promptly of any unauthorized use.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'You agree not to misuse the platform, including by attempting to access data you are not authorized to access, disrupting the service, reverse engineering it, or using it to violate any law or third-party right.',
    ],
  },
  {
    heading: 'Customer content',
    body: [
      'You retain ownership of the content you submit to your workspace. You grant Clint the rights necessary to host and process that content to provide the service. You are responsible for ensuring you have the rights to submit it.',
    ],
  },
  {
    heading: 'Intellectual property',
    body: [
      'The platform, including its software, design, and trademarks, is owned by Clint and its licensors. These terms do not grant you any rights to that intellectual property except the limited right to use the platform as permitted here.',
    ],
  },
  {
    heading: 'Disclaimers and liability',
    body: [
      'The platform is provided "as is" without warranties of any kind to the extent permitted by law. Clint is not liable for indirect, incidental, or consequential damages arising from your use of the platform. Nothing in these terms limits liability that cannot be limited by law.',
    ],
  },
  {
    heading: 'Changes and termination',
    body: [
      'We may update these terms from time to time; material changes will be reflected by the "last updated" date. We may suspend or terminate access for breach of these terms. You may stop using the platform at any time.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      'Questions about these terms can be sent to privacy@clintapp.com.',
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/core/models/legal-content.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/models/legal-content.ts src/client/src/app/core/models/legal-content.spec.ts
git commit -m "Add platform-owned legal content module + spec"
```

---

## Task 2: Host-aware robots.txt (Worker)

**Files:**
- Create: `src/client/worker/robots.ts`
- Test: `src/client/worker/test/robots.spec.ts`
- Modify: `src/client/worker/index.ts`

- [ ] **Step 1: Write the failing test**

`src/client/worker/test/robots.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRobots } from '../robots';

const APEX = ['clintapp.com'];

describe('buildRobots', () => {
  it('lets crawlers see the apex marketing site but blocks app paths', () => {
    const out = buildRobots('clintapp.com', APEX);
    expect(out).toContain('User-agent: *');
    expect(out).toContain('Disallow: /login');
    expect(out).toContain('Disallow: /admin');
    expect(out).toContain('Disallow: /super-admin');
  });

  it('blocks everything on a tenant subdomain', () => {
    const out = buildRobots('pfizer.clintapp.com', APEX);
    expect(out).toContain('Disallow: /');
    expect(out).not.toContain('Disallow: /login');
  });

  it('matches the apex case-insensitively', () => {
    expect(buildRobots('CLINTAPP.COM', APEX)).toContain('Disallow: /login');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/robots.spec.ts`
Expected: FAIL -- cannot resolve `../robots`.

- [ ] **Step 3: Write the module**

`src/client/worker/robots.ts`:

```ts
// Host-aware robots.txt. The apex (marketing site) is crawlable but app and
// auth paths are disallowed. Every workspace subdomain is fully disallowed so
// client workspaces are never indexed and the client list stays private.
export function buildRobots(host: string, apexes: string[]): string {
  const isApex = apexes.some((a) => a.trim().toLowerCase() === host.toLowerCase());
  if (isApex) {
    return [
      'User-agent: *',
      'Disallow: /login',
      'Disallow: /auth',
      'Disallow: /admin',
      'Disallow: /super-admin',
      '',
    ].join('\n');
  }
  return ['User-agent: *', 'Disallow: /', ''].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/robots.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the handler into the Worker**

In `src/client/worker/index.ts`, add the import after the existing `import { handleBrandfetchLookup } from './brandfetch';` line:

```ts
import { buildRobots } from './robots';
```

Then in the `fetch` handler, insert the robots check immediately before the `if (env.ASSETS) {` block (around line 101):

```ts
    if (url.pathname === '/robots.txt') {
      return new Response(buildRobots(url.hostname, apexes), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
```

- [ ] **Step 6: Verify the Worker still type-checks / tests pass**

Run: `cd src/client && npx vitest run --config worker/vitest.config.mts`
Expected: PASS (robots + existing worker specs).

- [ ] **Step 7: Commit**

```bash
git add src/client/worker/robots.ts src/client/worker/test/robots.spec.ts src/client/worker/index.ts
git commit -m "Serve host-aware robots.txt from the Worker"
```

---

## Task 3: Public footer component

**Files:**
- Create: `src/client/src/app/shared/components/public-footer.component.ts`

(Presentational; no render spec, per the help-page precedent. Depends on Task 1's `PLATFORM_LEGAL_EMAIL`.)

- [ ] **Step 1: Write the component**

`src/client/src/app/shared/components/public-footer.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BrandContextService } from '../../core/services/brand-context.service';
import { PLATFORM_LEGAL_EMAIL } from '../../core/models/legal-content';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="border-t border-slate-200 bg-white">
      <div
        class="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-5 text-xs text-slate-500 sm:flex-row"
      >
        <p>&copy; {{ year }} {{ brand.appDisplayName() }}</p>
        <nav class="flex items-center gap-5" aria-label="Legal and contact">
          <a routerLink="/privacy" class="hover:text-slate-900">Privacy</a>
          <a routerLink="/terms" class="hover:text-slate-900">Terms</a>
          <a [href]="mailto" class="hover:text-slate-900">Contact</a>
        </nav>
      </div>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicFooterComponent {
  protected readonly brand = inject(BrandContextService);
  protected readonly year = new Date().getFullYear();
  protected readonly mailto = `mailto:${PLATFORM_LEGAL_EMAIL}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/shared/components/public-footer.component.ts
git commit -m "Add host-aware public footer component"
```

---

## Task 4: Legal pages + routes

**Files:**
- Create: `src/client/src/app/features/legal/privacy-policy.component.ts`
- Create: `src/client/src/app/features/legal/terms-of-service.component.ts`
- Modify: `src/client/src/app/app.routes.ts`

- [ ] **Step 1: Write the privacy component**

`src/client/src/app/features/legal/privacy-policy.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent } from '../../shared/components/public-footer.component';
import { PRIVACY_SECTIONS, LAST_UPDATED, PLATFORM_OPERATOR } from '../../core/models/legal-content';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [RouterLink, PublicFooterComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <main class="flex-1">
        <div class="mx-auto max-w-3xl px-6 py-14">
          <a routerLink="/" class="text-xs text-brand-700 hover:underline">Back to home</a>
          <h1 class="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Privacy Policy</h1>
          <p class="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-slate-400">
            {{ operator }} &middot; Last updated {{ lastUpdated }}
          </p>
          @for (section of sections; track section.heading) {
            <section class="mt-8">
              <h2 class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">
                {{ section.heading }}
              </h2>
              @for (para of section.body; track para) {
                <p class="mt-3 text-sm leading-relaxed text-slate-600">{{ para }}</p>
              }
            </section>
          }
        </div>
      </main>
      <app-public-footer />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPolicyComponent {
  protected readonly sections = PRIVACY_SECTIONS;
  protected readonly lastUpdated = LAST_UPDATED;
  protected readonly operator = PLATFORM_OPERATOR;
}
```

- [ ] **Step 2: Write the terms component**

`src/client/src/app/features/legal/terms-of-service.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent } from '../../shared/components/public-footer.component';
import { TERMS_SECTIONS, LAST_UPDATED, PLATFORM_OPERATOR } from '../../core/models/legal-content';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [RouterLink, PublicFooterComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <main class="flex-1">
        <div class="mx-auto max-w-3xl px-6 py-14">
          <a routerLink="/" class="text-xs text-brand-700 hover:underline">Back to home</a>
          <h1 class="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Terms of Service</h1>
          <p class="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-slate-400">
            {{ operator }} &middot; Last updated {{ lastUpdated }}
          </p>
          @for (section of sections; track section.heading) {
            <section class="mt-8">
              <h2 class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">
                {{ section.heading }}
              </h2>
              @for (para of section.body; track para) {
                <p class="mt-3 text-sm leading-relaxed text-slate-600">{{ para }}</p>
              }
            </section>
          }
        </div>
      </main>
      <app-public-footer />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsOfServiceComponent {
  protected readonly sections = TERMS_SECTIONS;
  protected readonly lastUpdated = LAST_UPDATED;
  protected readonly operator = PLATFORM_OPERATOR;
}
```

- [ ] **Step 3: Add the routes**

In `src/client/src/app/app.routes.ts`, add these two entries immediately after the `auth/callback` route block (after its closing `},` near line 28):

```ts
  {
    path: 'privacy',
    loadComponent: () =>
      import('./features/legal/privacy-policy.component').then((m) => m.PrivacyPolicyComponent),
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./features/legal/terms-of-service.component').then((m) => m.TermsOfServiceComponent),
  },
```

- [ ] **Step 4: Build to verify wiring**

Run: `cd src/client && ng build`
Expected: build succeeds; `/privacy` and `/terms` lazy chunks emitted.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/legal/ src/client/src/app/app.routes.ts
git commit -m "Add platform Privacy and Terms pages with routes"
```

---

## Task 5: Branded 404 page

**Files:**
- Create: `src/client/src/app/features/not-found/not-found.component.ts`
- Modify: `src/client/src/app/app.routes.ts`

- [ ] **Step 1: Write the component**

`src/client/src/app/features/not-found/not-found.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ClintLogoComponent } from '../../shared/components/clint-logo.component';
import { PublicFooterComponent } from '../../shared/components/public-footer.component';
import { BrandContextService } from '../../core/services/brand-context.service';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, NgOptimizedImage, ClintLogoComponent, PublicFooterComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <main class="flex flex-1 items-center justify-center px-6 py-16">
        <div class="flex max-w-md flex-col items-center text-center">
          @if (brand.logoUrl(); as logo) {
            <img
              [ngSrc]="logo"
              [alt]="brand.appDisplayName() + ' logo'"
              width="160"
              height="40"
              class="h-10 w-auto object-contain"
            />
          } @else {
            <app-clint-logo [size]="48" />
          }
          <p class="mt-6 font-mono text-xs uppercase tracking-[0.16em] text-slate-400">Error 404</p>
          <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Page not found</h1>
          <p class="mt-2 text-sm text-slate-500">
            The page you are looking for does not exist or has moved.
          </p>
          <div class="mt-6 flex items-center gap-5 text-sm">
            <a routerLink="/" class="text-brand-700 hover:underline">Go home</a>
            <a routerLink="/login" class="text-slate-600 hover:text-slate-900">Sign in</a>
          </div>
        </div>
      </main>
      <app-public-footer />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {
  protected readonly brand = inject(BrandContextService);
}
```

- [ ] **Step 2: Replace the wildcard route**

In `src/client/src/app/app.routes.ts`, replace the final line `  { path: '**', redirectTo: '' },` with:

```ts
  {
    path: '**',
    loadComponent: () =>
      import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
```

- [ ] **Step 3: Build to verify**

Run: `cd src/client && ng build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/not-found/ src/client/src/app/app.routes.ts
git commit -m "Replace silent wildcard redirect with branded 404 page"
```

---

## Task 6: Mount footer on marketing landing + login

**Files:**
- Modify: `src/client/src/app/features/marketing/marketing-landing.component.ts`
- Modify: `src/client/src/app/features/auth/login.component.ts`

- [ ] **Step 1: Add footer to the marketing landing**

In `marketing-landing.component.ts`, add `PublicFooterComponent` to the imports:

- Add the import line near the other imports:
  ```ts
  import { PublicFooterComponent } from '../../shared/components/public-footer.component';
  ```
- Add it to the component `imports` array: `imports: [ButtonModule, InputTextModule, RouterLink, PublicFooterComponent],`
- In the template, insert `<app-public-footer />` immediately after the closing `</main>` tag and before the outer closing `</div>`:
  ```html
      </main>
      <app-public-footer />
    </div>
  ```

- [ ] **Step 2: Add footer to login (column wrapper)**

Read `login.component.ts` first. Its template root is:
`<div class="flex min-h-screen items-center justify-center bg-slate-50">` wrapping a single card `<div class="w-full max-w-sm border border-slate-200 bg-white"> ... </div>`.

Change the root wrapper to a column layout, wrap the card in a `main`, and append the footer:

- Add the import:
  ```ts
  import { PublicFooterComponent } from '../../shared/components/public-footer.component';
  ```
- Add `PublicFooterComponent` to the `imports` array.
- Change the opening `<div class="flex min-h-screen items-center justify-center bg-slate-50">` to:
  ```html
  <div class="flex min-h-screen flex-col bg-slate-50">
    <main class="flex flex-1 items-center justify-center px-6 py-12">
  ```
- At the end of the template, before the final closing `</div>` of that root wrapper, close the `main` and add the footer:
  ```html
      </main>
      <app-public-footer />
    </div>
  ```
  (The existing card `<div class="w-full max-w-sm ...">...</div>` now sits inside `<main>`.)

- [ ] **Step 3: Build to verify both render**

Run: `cd src/client && ng build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/marketing/marketing-landing.component.ts src/client/src/app/features/auth/login.component.ts
git commit -m "Mount public footer on marketing landing and login"
```

---

## Task 7: SEO meta tags in index.html

**Files:**
- Modify: `src/client/src/index.html`

- [ ] **Step 1: Replace the head contents**

Replace the entire `<head>...</head>` of `src/client/src/index.html` with:

```html
  <head>
    <meta charset="utf-8" />
    <title>Clint: Competitive intelligence for pharma</title>
    <meta
      name="description"
      content="Clint is the competitive intelligence platform for pharma: pipeline intelligence, catalyst tracking, clinical trial timelines, and portfolio analysis in one analytical instrument."
    />
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="favicon.svg" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Clint: Competitive intelligence for pharma" />
    <meta
      property="og:description"
      content="Pipeline intelligence, catalyst tracking, clinical trial timelines, and portfolio analysis for pharma CI teams."
    />
    <meta property="og:url" content="https://clintapp.com" />
    <meta property="og:image" content="https://clintapp.com/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Clint: Competitive intelligence for pharma" />
    <meta
      name="twitter:description"
      content="Pipeline intelligence, catalyst tracking, clinical trial timelines, and portfolio analysis for pharma CI teams."
    />
    <meta name="twitter:image" content="https://clintapp.com/og-image.png" />
  </head>
```

- [ ] **Step 2: Build to verify**

Run: `cd src/client && ng build`
Expected: build succeeds (the og-image.png referenced is generated in Task 8; the meta tag is a URL string so the build does not require the file).

- [ ] **Step 3: Commit**

```bash
git add src/client/src/index.html
git commit -m "Add SEO title, description, Open Graph and Twitter meta"
```

---

## Task 8: Generate the OG share image from the logo

**Files:**
- Create: `src/client/scripts/og-image/og-image.html`
- Create: `src/client/scripts/og-image/render.mjs`
- Modify: `src/client/package.json`
- Create: `src/client/public/og-image.png` (generated)

- [ ] **Step 1: Write the banner HTML**

`src/client/scripts/og-image/og-image.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1200px; height: 630px; overflow: hidden; }
      body {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #f8fafc;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 28px;
      }
      .wordmark {
        font-size: 34px;
        font-weight: 600;
        letter-spacing: 0.28em;
        color: #0f172a;
      }
      .tagline {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 18px;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: #0f766e;
      }
      .rule { width: 64px; height: 3px; background: #0d9488; }
    </style>
  </head>
  <body>
    <div class="card">
      <svg viewBox="0 0 140 140" fill="none" width="120" height="120" aria-hidden="true">
        <polyline points="112,24 24,24 24,116 112,116" stroke="#cbd5e1" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points="96,40 40,40 40,100 96,100" stroke="#94a3b8" stroke-width="5.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points="80,56 56,56 56,84 80,84" stroke="#0f766e" stroke-width="7.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="wordmark">CLINT</div>
      <div class="rule"></div>
      <div class="tagline">Competitive intelligence for pharma</div>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Write the render script**

`src/client/scripts/og-image/render.mjs`:

```js
// Renders the OG share banner to a high-DPI PNG using the Chromium that ships
// with @playwright/test. deviceScaleFactor: 2 -> crisp 2400x1260 output that
// share platforms downscale cleanly. Regenerate with `npm run og:image`.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, 'og-image.html');
const outPath = resolve(here, '../../public/og-image.png');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.goto('file://' + htmlPath);
await page.screenshot({ path: outPath });
await browser.close();
console.log('Wrote', outPath);
```

- [ ] **Step 3: Add the npm script**

In `src/client/package.json`, add to `scripts` (after `"docs:arch"`):

```json
    "og:image": "node scripts/og-image/render.mjs",
```

- [ ] **Step 4: Generate the image**

Run: `cd src/client && npm run og:image`
Expected: prints `Wrote .../public/og-image.png`; file exists.

Verify dimensions: `cd src/client && node -e "const b=require('fs').readFileSync('public/og-image.png');console.log('w',b.readUInt32BE(16),'h',b.readUInt32BE(20))"`
Expected: `w 2400 h 1260`.

- [ ] **Step 5: Commit**

```bash
git add src/client/scripts/og-image/ src/client/package.json src/client/public/og-image.png
git commit -m "Generate OG share image from the Clint logo and brand tokens"
```

---

## Task 9: Final verification

- [ ] **Step 1: Lint**

Run: `cd src/client && ng lint`
Expected: no errors (note: lint also runs the no-banana-ngmodel + supabase-rls checks; no migration here so RLS check is unaffected).

- [ ] **Step 2: Build**

Run: `cd src/client && ng build`
Expected: success.

- [ ] **Step 3: Unit + worker tests**

Run: `cd src/client && npm run test:units && npm run test:worker`
Expected: all pass, including `legal-content` and `buildRobots`.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Serve/preview and check: `/privacy`, `/terms` render with footer; an unknown path shows the 404; `/robots.txt` returns the app-path Disallow body on the apex and `Disallow: /` when loaded with a tenant dev override (`?wl_kind=tenant&wl_id=<uuid>` affects brand, not host; robots host behavior is verified by the worker spec). Eyeball `public/og-image.png`.

- [ ] **Step 5: Push / open PR per branch policy**

Follow finishing-a-development-branch.
```
