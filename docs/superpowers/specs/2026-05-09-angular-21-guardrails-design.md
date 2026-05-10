# Angular 21 + PrimeNG 21 Guardrails

## Background

We are migrating clint-v2 from Angular 19 + PrimeNG 19 to Angular 21 + PrimeNG 21 in a separate worktree. The current root `CLAUDE.md` has a partial set of Angular conventions but is missing most of the rules called out in Angular's official agent guidance:

- `https://angular.dev/assets/context/best-practices.md` (canonical AI context file)
- `https://angular.dev/style-guide`
- `https://angular.dev/best-practices/{security,a11y,error-handling,performance}`
- `https://angular.dev/ai/{develop-with-ai,agent-skills,mcp,design-patterns}`
- `https://angular.dev/tools/language-service`

The goal of this design is to land guardrails that hold for **all Angular work, including edits to existing files**, before the v21 migration begins. The migration sweep will then bring stale files forward to the new bar.

## Goals

1. Make Angular best practices the default for any Claude session editing `src/client/`, including non-greenfield edits.
2. Catch mechanical violations (missing `OnPush`, decorator-based inputs, `*ngIf`, `ngClass`, etc.) at lint time so CI fails fast.
3. Keep judgment-level guidance (when to migrate a file, when to split a PR, brand tokens) close to the code in `src/client/CLAUDE.md`.
4. Make Angular's authoritative guidance available in-session via the official agent skills and MCP server.

## Non-goals

- Authoring custom skills.
- Stop-hook drift guards (deferred — lint covers most of what a hook would catch; revisit if drift shows up after a few weeks).
- `.cursor/rules/` portability layer (deferred until we actually use Cursor or another tool that needs it).
- A bespoke Tailwind brand-token lint rule (out of scope; brand discipline stays in CLAUDE.md prose).

## Design

### File layout

| File | Action | Purpose |
|---|---|---|
| `src/client/CLAUDE.md` | NEW | Angular/PrimeNG/Tailwind/a11y/security/performance rules, scoped to the Angular subtree. ~120 lines, terse, action-oriented. |
| `CLAUDE.md` (root) | TRIM | Remove duplicated Angular/PrimeNG/Tailwind/Component-Patterns/Accessibility sections. Add a one-line pointer. Keep positioning, brand, Supabase, whitelabel, runbook, in-app help, spec location. |
| `src/client/eslint.config.js` | EXTEND | Add `@angular-eslint` recommended sets plus explicit overrides. |
| `src/client/package.json` | DEP | Ensure `@angular-eslint/eslint-plugin-template` is present; bump alongside the v21 migration. |
| `.mcp.json` (project root) | NEW | Register the Angular CLI MCP server. |
| Skills install | RUN | `npx skills add https://github.com/angular/skills` to install `angular-developer` and `angular-new-app`. |

### `src/client/CLAUDE.md` content (12 sections)

**Scope statement at the top of file:**

> Rules in this file apply to all Angular work in `src/client/`, including edits to existing files. When you touch a component or service that uses an outdated pattern, migrate that file to current conventions in the same change. Don't half-migrate; don't defer. The lint config below fails the build if you leave deprecated patterns in a file you've modified.

Section bodies are terse, one or two rules per line.

1. **Component shape (TS)** — Standalone only; never set `standalone: true`. `OnPush` on every component. `inject()` only. `input()` / `output()` / `model()` functions, never decorators. Mark inputs/outputs/models/queries `readonly`. `host` object on the decorator, never `@HostBinding` / `@HostListener`. `protected` for template-only members. Implement lifecycle interfaces.
2. **State** — `signal()` for component state; `computed()` for derived; `linkedSignal()` for state needing prior values. `update()` / `set()`, never `mutate()`. Reactive forms only. Move complex template expressions into `computed()`.
3. **Templates** — Native control flow only (`@if`, `@for`, `@switch`). `class` / `style` bindings, never `ngClass` / `ngStyle`. `NgOptimizedImage` for static images. `async` pipe for observables. No globals like `new Date()` in templates.
4. **Services & data** — Single responsibility; `providedIn: 'root'` for singletons. Lazy-load feature routes via `loadComponent` / `loadChildren`. `catchError` in the service that initiated the request. `ErrorHandler` is for unexpected errors only. Keep `provideBrowserGlobalErrorListeners()` in `app.config.ts`.
5. **Performance** — `@defer` for below-the-fold or heavy components. `NgOptimizedImage` with `priority` for above-the-fold. Zoneless change detection is the v21 default — don't reintroduce zone.js. Profile with Chrome DevTools before optimizing.
6. **Security** — Never bind user-controlled data to `[innerHTML]`. `bypassSecurityTrust*` requires a code comment justifying it and a security review. Validate resource URLs (iframe `src`, script `src`) before binding. Don't disable Angular's built-in XSRF.
7. **Accessibility (WCAG AA, must pass AXE)** — Dynamic ARIA via binding, static via plain HTML. `ariaCurrentWhenActive` on `routerLinkActive`. `cdkTrapFocus` on modals; Escape closes; focus returns to opener. CDK `LiveAnnouncer` or `aria-live` for dynamic content. Focus the main heading after route navigation. Keyboard-navigable; visible focus; semantic HTML.
8. **PrimeNG 21** — PrimeNG components for forms/tables/dialogs/overlays. `pTooltip`, never native `title=` (positions: `right` nav rails, `top` inline badges, `bottom` editor toolbars). Theme via custom Aura preset; never inline-override PrimeNG colors. Light mode only.
9. **Tailwind v4 / brand** — `bg-brand-*` / `text-brand-*` / `border-brand-*` / `ring-brand-*`. Never `bg-teal-*` or `bg-indigo-*`. Slate / red / amber / green / cyan / violet stay hard-coded as data colors.
10. **File & naming** — Hyphenated filenames; matching base names across `.ts` / `.html` / `.css` / `.spec.ts`. One concept per file. Feature-folder organization. Group Angular-specific class members near the top of the class.
11. **When updating an existing file** — If the file uses any deprecated pattern from sections 1–4, migrate the whole file in the same change. If the diff would balloon, pause and ask whether to land a focused modernization commit first. Don't introduce new code in old patterns "to match" the file's existing style. Consistency yields to current conventions.
12. **Verification** — `cd src/client && ng lint && ng build` before claiming done. For UI changes, exercise the feature in a browser. Type checks verify code, not behavior.

### ESLint config additions (`src/client/eslint.config.js`)

**Enable recommended sets:**
- `@angular-eslint/recommended`
- `@angular-eslint/template/recommended`
- `@angular-eslint/template/accessibility`

**Explicit TS overrides (all `error`):**
- `@angular-eslint/prefer-standalone`
- `@angular-eslint/prefer-on-push-component-change-detection`
- `@angular-eslint/prefer-signals`
- `@angular-eslint/prefer-output-readonly`
- `@angular-eslint/no-input-rename`
- `@angular-eslint/no-output-rename`
- `@angular-eslint/no-output-on-prefix`
- `@angular-eslint/contextual-decorator`
- `@angular-eslint/relative-url-prefix`
- `@angular-eslint/runtime-localize`

**Explicit template overrides (all `error`):**
- `@angular-eslint/template/prefer-control-flow`
- `@angular-eslint/template/prefer-ngsrc`
- `@angular-eslint/template/prefer-self-closing-tags`
- `@angular-eslint/template/no-call-expression`
- `@angular-eslint/template/no-any`
- `@angular-eslint/template/no-negated-async`
- `@angular-eslint/template/no-inline-styles`
- `@angular-eslint/template/no-duplicate-attributes`

**Cannot be lint-enforced (live in CLAUDE.md only):**
- Ban on `@HostBinding` / `@HostListener` decorators (no shipped rule today).
- "Migrate the whole file when you touch it" (judgment).
- `bypassSecurityTrust*` justification (judgment).
- Brand color tokens (out of scope; could be a custom Tailwind plugin later).

**Rule-availability check:** During implementation, verify each named rule exists in the version of `@angular-eslint` we land on. If renamed/removed, substitute and note in the implementation plan.

### Existing-code transition strategy

Existing files may not be `OnPush`, may use `*ngIf`, decorator inputs, etc. Three options:

- **(a) Fix-all-up-front:** ratchet rules to `error` and fix every violation as part of landing the guardrail. Largest single PR but cleanest tail state.
- **(b) Warn-then-ratchet (recommended):** introduce new rules at `warn`, let CI surface violations without blocking. The v21 + PrimeNG 21 migration in the worktree will sweep most of them. After migration completes, ratchet to `error` in a follow-up PR.
- **(c) Per-file overrides:** ship rules at `error` with `eslint-disable` comments on known-stale files; treat the disables as a migration backlog.

**Decision: (b).** The v21 migration is happening in another worktree and will rewrite most files anyway; warn-mode lets us land the guardrail without blocking unrelated work, and the ratchet is a small follow-up commit once the migration merges.

### Tooling install

**Angular agent skills:**
```bash
npx skills add https://github.com/angular/skills
```
Adds `angular-developer` (architectural guidance: signals, forms, DI, routing, SSR, a11y, testing, animations, styling, CLI) and `angular-new-app` (CLI scaffolding).

Open question for implementation: confirm install location (project-local vs `~/.claude/skills/`). Document the answer in `src/client/CLAUDE.md` so teammates know whether they need to run the command.

**Angular MCP server:**

Run `ng mcp` once to print the official config snippet, then add to `.mcp.json` at project root:
```json
{
  "mcpServers": {
    "angular": { "command": "npx", "args": ["-y", "@angular/cli", "mcp"] }
  }
}
```
Provides `get_best_practices`, `search_documentation`, `find_examples`, `onpush_zoneless_migration`, `list_projects`, `ai_tutor`. Highly useful during the v21 + PrimeNG 21 migration.

### Root `CLAUDE.md` trim

- Delete the **Angular Conventions**, **Component Patterns**, **PrimeNG Conventions**, **Tailwind CSS Conventions**, and **Accessibility** sections.
- Replace them with a one-line pointer under the existing **Tech Stack** section:
  > Angular/PrimeNG/Tailwind rules and a11y/security/performance guardrails live in `src/client/CLAUDE.md`.
- Everything else (positioning, brand, Supabase, whitelabel, runbook, in-app help, spec location) stays untouched.

## Verification

After implementation:

1. `cd src/client && ng lint` — passes (with new rules at `warn` per the transition strategy).
2. `cd src/client && ng build` — passes.
3. In a fresh Claude session in the repo, the Skill tool lists `angular-developer` and `angular-new-app`.
4. In a fresh Claude session, the Angular MCP tools (`get_best_practices`, etc.) are invokable.
5. Spot-check: open a known-stale component and confirm lint flags it as `warn`.
6. Spot-check: edit a fresh component using `*ngIf` and confirm lint flags `prefer-control-flow`.

## Out of scope

- Stop-hook drift guard (deferred; revisit if drift appears).
- `.cursor/rules/` portability layer.
- Custom Tailwind brand-token rule.
- Authoring project-specific skills.
- The actual Angular 21 + PrimeNG 21 migration (separate worktree, separate spec).
