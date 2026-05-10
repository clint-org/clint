# Angular 21 + PrimeNG 21 Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Angular/PrimeNG/Tailwind guardrails (file-level rules in `src/client/CLAUDE.md`, lint enforcement, official agent skills, MCP server) so that all Angular work — including edits to existing files — follows current conventions before the v21 + PrimeNG 21 migration begins in another worktree.

**Architecture:** Three layers. (1) Prose rules in `src/client/CLAUDE.md` close to the Angular code, with the root `CLAUDE.md` trimmed to point at it. (2) `@angular-eslint` rule additions at `warn` level (warn-then-ratchet so the v21 worktree migration sweeps violations without blocking unrelated work). (3) Tooling: official Angular agent skills installed project-level under `.claude/skills/` and the Angular CLI MCP server registered in `.mcp.json` at the repo root.

**Tech Stack:** Angular 19 (current; will become 21 in worktree), `@angular-eslint@^19`, `typescript-eslint@^8`, `eslint@^9`, PrimeNG 19 (will become 21), Tailwind CSS v4, the `skills` npm CLI for skill installs, `@angular/cli mcp` for the MCP server.

**Reference spec:** `docs/superpowers/specs/2026-05-09-angular-21-guardrails-design.md`

---

## File Structure

| File | Action | Lines (approx) |
|---|---|---|
| `src/client/CLAUDE.md` | NEW | ~120 |
| `CLAUDE.md` (root) | MODIFY (trim) | net -80 |
| `src/client/eslint.config.js` | MODIFY (extend) | +30 |
| `.mcp.json` (project root) | NEW | ~10 |
| `.claude/skills/angular-developer` | NEW (symlink) | n/a |
| `.claude/skills/angular-new-app` | NEW (symlink) | n/a |
| `.agents/skills/angular-developer/...` | NEW (skill content) | varies |
| `.agents/skills/angular-new-app/...` | NEW (skill content) | varies |

Skill content files come from the official `github.com/angular/skills` repo and are vendored into `.agents/skills/<name>/` by the `skills` CLI. Both the symlinks and the content are committed (matches existing pattern for `supabase` and `supabase-postgres-best-practices`).

---

## Task 1: Verify @angular-eslint v19 rule availability

**Context:** The design lists rules drawn from Angular's current best-practices guide, but the project is on `@angular-eslint@^19.0.0`. Some rules (notably `prefer-signals`, template-side `prefer-ngsrc`, `prefer-self-closing-tags`) may have been added in a specific minor version. Verify each rule before adding it; the v21 migration in the worktree will pick up any additional rules later.

**Files:**
- Read-only: `src/client/node_modules/@angular-eslint/eslint-plugin/dist/index.js` (rule registry)
- Read-only: `src/client/node_modules/@angular-eslint/eslint-plugin-template/dist/index.js`

- [ ] **Step 1: List installed TS-side rules**

```bash
cd src/client
node -e "console.log(Object.keys(require('@angular-eslint/eslint-plugin').rules).sort().join('\n'))"
```
Expected: a sorted list of rule names (e.g., `prefer-on-push-component-change-detection`, `prefer-standalone`, `prefer-output-readonly`, ...).

- [ ] **Step 2: List installed template-side rules**

```bash
cd src/client
node -e "console.log(Object.keys(require('@angular-eslint/eslint-plugin-template').rules).sort().join('\n'))"
```
Expected: a sorted list of template rule names (e.g., `prefer-control-flow`, `no-call-expression`, `no-any`, ...).

- [ ] **Step 3: Cross-check against the planned rule set**

For each rule listed in the design (Section 3a of the spec), confirm it appears in Step 1 or Step 2 output.

The full planned list:

TS-side: `prefer-standalone`, `prefer-on-push-component-change-detection`, `prefer-signals`, `prefer-output-readonly`, `no-input-rename`, `no-output-rename`, `no-output-on-prefix`, `contextual-decorator`, `relative-url-prefix`, `runtime-localize`.

Template-side: `prefer-control-flow`, `prefer-ngsrc`, `prefer-self-closing-tags`, `no-call-expression`, `no-any`, `no-negated-async`, `no-inline-styles`, `no-duplicate-attributes`.

For any rule **not** in the registry: drop it from the lint config in Task 4. Add a TODO note in Task 5's `src/client/CLAUDE.md` that the rule will land with the v21 worktree merge.

- [ ] **Step 4: Record the verified rule set**

Capture the verified rule list (subset of the planned list) in a scratch comment that Task 4 will use. No commit at this step — this is investigation only.

---

## Task 2: Install Angular agent skills (project-level)

**Context:** The `skills` CLI installs to `.agents/skills/<name>/` and creates a symlink at `.claude/skills/<name>` (matches existing layout for `supabase`). Default scope is project-level when run from a project directory; verify with `--list` first to see what we'd be installing.

**Files:**
- Modify (via tool): `.agents/skills/angular-developer/`, `.agents/skills/angular-new-app/`
- Create (symlinks): `.claude/skills/angular-developer`, `.claude/skills/angular-new-app`

- [ ] **Step 1: Preview what would be installed**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
npx skills add https://github.com/angular/skills --list
```
Expected: lists `angular-developer` and `angular-new-app` skills.

- [ ] **Step 2: Install both skills project-level**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
npx skills add https://github.com/angular/skills --skill '*' --agent '*' -y
```
Expected: skills land under `.agents/skills/angular-developer/` and `.agents/skills/angular-new-app/` with symlinks under `.claude/skills/`.

- [ ] **Step 3: Verify install**

```bash
ls -la .claude/skills/angular-developer .claude/skills/angular-new-app
ls .agents/skills/angular-developer/ .agents/skills/angular-new-app/
```
Expected: symlinks point into `.agents/skills/<name>/`; each skill directory contains a `SKILL.md`.

- [ ] **Step 4: Confirm skills appear in `npx skills ls`**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
npx skills ls
```
Expected: `angular-developer` and `angular-new-app` both listed under project scope.

- [ ] **Step 5: Stage and commit**

```bash
git add .claude/skills/angular-developer .claude/skills/angular-new-app .agents/skills/angular-developer .agents/skills/angular-new-app
# If skills-lock.json was created/updated, stage it too:
git add skills-lock.json 2>/dev/null || true
git status
git commit -m "$(cat <<'EOF'
chore(skills): install official angular agent skills

angular-developer + angular-new-app from github.com/angular/skills,
project-level so the team picks them up automatically. These provide
authoritative Angular guidance during edits.
EOF
)"
```
Expected: clean commit; `git status` clean afterward.

---

## Task 3: Add Angular CLI MCP server config

**Context:** No `.mcp.json` exists at project root. Adding one registers the Angular MCP server (`get_best_practices`, `search_documentation`, `find_examples`, `onpush_zoneless_migration`, etc.) for any AI agent using the repo. The `npx -y @angular/cli mcp` command Angular publishes is the canonical entry point.

**Files:**
- Create: `.mcp.json` at project root

- [ ] **Step 1: Confirm `ng mcp` works in our env**

```bash
cd src/client
npx -y @angular/cli mcp --help 2>&1 | head -20
```
Expected: a help output mentioning MCP server, no error. (If it errors, capture the error and stop — do not write `.mcp.json` until resolved.)

- [ ] **Step 2: Create `.mcp.json`**

Create `/Users/aadityamadala/Documents/code/clint-v2/.mcp.json`:

```json
{
  "mcpServers": {
    "angular": {
      "command": "npx",
      "args": ["-y", "@angular/cli", "mcp"]
    }
  }
}
```

- [ ] **Step 3: Verify the JSON parses**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
node -e "JSON.parse(require('fs').readFileSync('.mcp.json', 'utf8')); console.log('valid')"
```
Expected: `valid`.

- [ ] **Step 4: Stage and commit**

```bash
git add .mcp.json
git commit -m "$(cat <<'EOF'
chore(mcp): register angular cli mcp server

Adds .mcp.json so any agent in the repo can call get_best_practices,
search_documentation, find_examples, and onpush_zoneless_migration
during Angular work.
EOF
)"
```
Expected: clean commit.

---

## Task 4: Extend `src/client/eslint.config.js` with verified rules at `warn`

**Context:** The current config enables `@angular-eslint/recommended` and the template-side `templateRecommended` + `templateAccessibility`. We add explicit `warn`-level overrides for the rules verified in Task 1. Warn level so the v21 migration in the worktree can sweep violations without blocking unrelated CI runs; we ratchet to `error` after the migration merges.

**Files:**
- Modify: `src/client/eslint.config.js`

- [ ] **Step 1: Add TS-side rule overrides**

Open `src/client/eslint.config.js`. Inside the `rules: { ... }` block of the first `tseslint.config(...)` entry (the `**/*.ts` block), after the existing `@angular-eslint/component-selector` rule, add the verified TS-side rules. Use only rules that passed Task 1 Step 3:

```js
      "@angular-eslint/prefer-standalone": "warn",
      "@angular-eslint/prefer-on-push-component-change-detection": "warn",
      "@angular-eslint/prefer-signals": "warn",
      "@angular-eslint/prefer-output-readonly": "warn",
      "@angular-eslint/no-input-rename": "warn",
      "@angular-eslint/no-output-rename": "warn",
      "@angular-eslint/no-output-on-prefix": "warn",
      "@angular-eslint/contextual-decorator": "warn",
      "@angular-eslint/relative-url-prefix": "warn",
      "@angular-eslint/runtime-localize": "warn",
```

Drop any rule that wasn't in Task 1's registry output.

- [ ] **Step 2: Add template-side rule overrides**

In the same file, replace `rules: {}` in the `**/*.html` config block with:

```js
    rules: {
      "@angular-eslint/template/prefer-control-flow": "warn",
      "@angular-eslint/template/prefer-ngsrc": "warn",
      "@angular-eslint/template/prefer-self-closing-tags": "warn",
      "@angular-eslint/template/no-call-expression": "warn",
      "@angular-eslint/template/no-any": "warn",
      "@angular-eslint/template/no-negated-async": "warn",
      "@angular-eslint/template/no-inline-styles": "warn",
      "@angular-eslint/template/no-duplicate-attributes": "warn",
    },
```

Drop any rule that wasn't in Task 1's registry output.

- [ ] **Step 3: Run lint to confirm rules load**

```bash
cd src/client
npx ng lint 2>&1 | tail -50
```
Expected: ng lint runs to completion. Output likely has new warnings on stale files (that's the point — we'll see them but they won't fail CI). No "Definition for rule X was not found" errors. If any rule errors with "not found", remove it from the config and re-run.

- [ ] **Step 4: Capture warning count**

```bash
cd src/client
npx ng lint 2>&1 | grep -E "warning|problem" | tail -5
```
Expected: a count of new warnings. Record the number — useful for deciding when to ratchet to `error` after the v21 migration.

- [ ] **Step 5: Confirm `ng build` still passes**

```bash
cd src/client
npx ng build 2>&1 | tail -20
```
Expected: build succeeds. (Lint warnings don't affect build, but this is sanity.)

- [ ] **Step 6: Stage and commit**

```bash
git add src/client/eslint.config.js
git commit -m "$(cat <<'EOF'
chore(lint): add @angular-eslint v21 guardrail rules at warn

Adds prefer-standalone, prefer-on-push, prefer-signals, control flow,
ngsrc, and other rules from Angular's official best-practices guide.
Set to warn so the v21 worktree migration can sweep violations
without blocking unrelated CI runs; ratchet to error after migration.
EOF
)"
```
Expected: clean commit.

---

## Task 5: Create `src/client/CLAUDE.md`

**Context:** The 12-section ruleset is the single source of truth for Angular work in `src/client/`. Terse, action-oriented, no narrative. Lives next to the code so it's loaded when Claude is editing in the subtree.

**Files:**
- Create: `src/client/CLAUDE.md`

- [ ] **Step 1: Create the file with the full content below**

Create `/Users/aadityamadala/Documents/code/clint-v2/src/client/CLAUDE.md` with this exact content:

````markdown
# Angular Client -- Guardrails

Rules in this file apply to **all Angular work in `src/client/`**, including edits to existing files. When you touch a component or service that uses an outdated pattern, migrate that file to current conventions in the same change. Don't half-migrate; don't defer. The lint config (`eslint.config.js`) flags deprecated patterns at `warn` today and will ratchet to `error` after the v21 migration.

If a file's existing style contradicts these rules, prioritize the rules over file-local consistency. Bring the file forward.

## 1. Component shape (TS)

- Standalone components only. Never set `standalone: true` (default in v20+).
- `changeDetection: ChangeDetectionStrategy.OnPush` on every component.
- `inject()` for dependency injection. No constructor injection.
- `input()` / `output()` / `model()` functions for I/O. Never `@Input` / `@Output` decorators.
- Mark inputs, outputs, models, and queries `readonly`.
- Host bindings/listeners go in the `host` object on the decorator. Never `@HostBinding` / `@HostListener`.
- `protected` for class members only used by the template, not `public`.
- Implement lifecycle interfaces (`OnInit`, `OnDestroy`, ...) when you implement the hook.
- Group Angular-specific class members near the top of the class.

## 2. State

- `signal()` for component state.
- `computed()` for derived state.
- `linkedSignal()` for derived state that needs prior values (e.g., chat history during streaming).
- `update()` / `set()`, never `mutate()`.
- Reactive forms only. No template-driven forms.
- Move complex template expressions into `computed()`.

## 3. Templates

- Native control flow only: `@if`, `@for`, `@switch`. No `*ngIf`, `*ngFor`, `*ngSwitch`.
- `class` and `style` bindings. Never `ngClass` or `ngStyle`.
- `NgOptimizedImage` for static images (does not work for inline base64).
- `async` pipe for observables.
- No globals like `new Date()` in templates -- compute upstream.

## 4. Services & data

- Single responsibility per service. `providedIn: 'root'` for singletons.
- Lazy-load feature routes via `loadComponent` / `loadChildren`.
- Surface errors at their origin: `catchError` in the service that initiated the request. `ErrorHandler` is for unexpected errors only.
- Keep `provideBrowserGlobalErrorListeners()` in `app.config.ts`.

## 5. Performance

- `@defer` for below-the-fold or heavy components.
- `NgOptimizedImage` with `priority` for above-the-fold imagery.
- Zoneless change detection is the v21 default. Don't reintroduce zone.js.
- Profile with Chrome DevTools before optimizing.

## 6. Security

- Never bind user-controlled data to `[innerHTML]`. If unavoidable, sanitize via `DomSanitizer.sanitize()`.
- `bypassSecurityTrust*` requires a code comment justifying the bypass and a security review.
- Validate resource URLs (iframe `src`, script `src`) before binding.
- Don't disable Angular's built-in XSRF protection.

## 7. Accessibility (WCAG AA -- must pass AXE)

- Dynamic ARIA via property/attribute binding (`[aria-label]`); static ARIA as plain HTML.
- `ariaCurrentWhenActive="page"` on `routerLinkActive` for nav.
- `cdkTrapFocus` on modals; Escape closes; focus returns to opener.
- CDK `LiveAnnouncer` or `aria-live` for dynamic announcements.
- After route navigation, focus the main heading.
- Keyboard-navigable, visible focus indicator, semantic HTML.

## 8. PrimeNG 21

- PrimeNG components for forms, tables, dialogs, overlays. Never reinvent.
- `pTooltip` from `primeng/tooltip`, never native `title=`. Position: `right` for nav rails, `top` for inline badges, `bottom` for editor toolbars.
- Theme via the custom Aura preset in `src/app/config/primeng-theme.ts`. Never inline-override PrimeNG colors with Tailwind color utilities.
- Light mode only. Dark mode is explicitly disabled in the preset.

## 9. Tailwind v4 / brand

- `bg-brand-*` / `text-brand-*` / `border-brand-*` / `ring-brand-*`. Never `bg-teal-*` or `bg-indigo-*`.
- Slate / red / amber / green / cyan / violet stay hard-coded -- those are data colors, not brand.

## 10. File & naming (Angular style guide)

- Hyphenated filenames; matching base names across `.ts`, `.html`, `.css`, `.spec.ts`.
- One concept per file. Prefer smaller, focused files.
- Feature-folder organization. No top-level `components/`, `services/`, `directives/` buckets.

## 11. When updating an existing file

- If the file uses any deprecated pattern from sections 1–4, migrate the whole file in the same change. Lint flags it at `warn` today; the v21 migration will ratchet to `error`.
- If the migration would balloon the diff (e.g., a 1500-line component with 40 `*ngIf`s, paired with a 5-line bug fix), pause and ask whether to split into a focused modernization commit first.
- Don't introduce new code in old patterns to match the file's existing style. Consistency yields to current conventions.

## 12. Verification

```bash
cd src/client && ng lint && ng build
```

For UI changes, exercise the feature in a browser. Type checks verify code, not behavior.

## Tooling available in-session

- **Skills:** `angular-developer` and `angular-new-app` (installed via `npx skills add github.com/angular/skills`). Invoke via the Skill tool when implementing components, forms, DI, routing, SSR, a11y, testing, animations, or styling.
- **Angular MCP server:** registered in `.mcp.json` at the repo root. Provides `get_best_practices`, `search_documentation`, `find_examples`, `onpush_zoneless_migration`, `list_projects`, `ai_tutor`. Useful during the v21 migration for sourcing official guidance.
- **Angular Language Service:** the LSP-backed editor extension surfaces template-aware diagnostics, autocomplete, and "go to definition." Keep it enabled in the editor.

## References

- Angular best-practices source: `https://angular.dev/assets/context/best-practices.md`
- Angular style guide: `https://angular.dev/style-guide`
- Security: `https://angular.dev/best-practices/security`
- Accessibility: `https://angular.dev/best-practices/a11y`
- Error handling: `https://angular.dev/best-practices/error-handling`
- Performance: `https://angular.dev/best-practices/performance`
- AI design patterns: `https://angular.dev/ai/design-patterns`
- Spec: `docs/superpowers/specs/2026-05-09-angular-21-guardrails-design.md`
````

- [ ] **Step 2: Verify file structure**

```bash
wc -l /Users/aadityamadala/Documents/code/clint-v2/src/client/CLAUDE.md
grep -c "^## " /Users/aadityamadala/Documents/code/clint-v2/src/client/CLAUDE.md
```
Expected: line count around 110-130, and 13 `##` headings (12 numbered sections + Tooling + References = actually 14, count whatever lands).

- [ ] **Step 3: Stage and commit**

```bash
git add src/client/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(client): add angular guardrails for src/client

Twelve-section ruleset covering component shape, state, templates,
services, performance, security, a11y, PrimeNG, Tailwind/brand,
naming, the "update existing files" rule, and verification. Lives
next to the code so it loads on every Angular edit.
EOF
)"
```
Expected: clean commit.

---

## Task 6: Trim root `CLAUDE.md`

**Context:** Root `CLAUDE.md` currently has duplicated Angular/PrimeNG/Tailwind/Component-Patterns/Accessibility sections that the new `src/client/CLAUDE.md` supersedes. Replace them with a one-line pointer. Everything else (positioning, brand, Supabase, whitelabel, runbook, in-app help, spec location) stays.

**Files:**
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Read the current file to confirm sections to remove**

Use Read tool on `/Users/aadityamadala/Documents/code/clint-v2/CLAUDE.md`. Identify these section headings (keep their exact line numbers handy):
- `## Angular Conventions`
- `## Accessibility`
- `## Component Patterns`
- `## PrimeNG Conventions`
- `## Tailwind CSS Conventions`

These are five contiguous-ish sections that all move into `src/client/CLAUDE.md`.

- [ ] **Step 2: Replace those five sections with a one-line pointer**

Use the Edit tool. Replace the block from the start of `## Angular Conventions` through the end of `## Tailwind CSS Conventions` (just before the next surviving section) with:

```markdown
## Angular / PrimeNG / Tailwind / a11y

Rules and conventions for Angular components, PrimeNG, Tailwind, accessibility, security, and performance live in `src/client/CLAUDE.md`. That file applies to all Angular work in `src/client/`, including edits to existing files.
```

- [ ] **Step 3: Verify the surviving sections are intact**

```bash
grep "^## " /Users/aadityamadala/Documents/code/clint-v2/CLAUDE.md
```
Expected: should still see `## Tech Stack`, `## Design Context`, `## Supabase Local Development`, `## Project Structure`, `## Verification`, `## Documentation Conventions`, `## In-app Help Pages`, `## Whitelabel Architecture (host-aware brand resolution)`, `## Spec Location`, plus the new `## Angular / PrimeNG / Tailwind / a11y` pointer.

- [ ] **Step 4: Verify line count dropped meaningfully**

```bash
wc -l /Users/aadityamadala/Documents/code/clint-v2/CLAUDE.md
```
Expected: file is shorter by roughly 50–80 lines vs before the trim.

- [ ] **Step 5: Stage and commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude-md): point angular/primeng/tailwind rules at client subtree

Removes duplicated Angular Conventions, Component Patterns, PrimeNG,
Tailwind, and Accessibility sections from the root CLAUDE.md. Replaces
with a one-line pointer to src/client/CLAUDE.md, which is the new
single source of truth.
EOF
)"
```
Expected: clean commit.

---

## Task 7: Final verification pass

**Context:** Confirm every layer works end-to-end before pushing.

- [ ] **Step 1: Lint passes (warnings allowed)**

```bash
cd src/client
npx ng lint 2>&1 | tail -10
```
Expected: exits 0; warnings are fine; no "rule not found" errors.

- [ ] **Step 2: Build passes**

```bash
cd src/client
npx ng build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 3: Skills are listable**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
npx skills ls
```
Expected: `angular-developer` and `angular-new-app` both shown under project scope.

- [ ] **Step 4: MCP config is valid**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
node -e "console.log(JSON.parse(require('fs').readFileSync('.mcp.json','utf8')).mcpServers.angular.command)"
```
Expected: `npx`.

- [ ] **Step 5: Confirm `src/client/CLAUDE.md` and trimmed root `CLAUDE.md` are committed**

```bash
git log --oneline -10
git status
```
Expected: clean working tree; the last 4–5 commits are the guardrail tasks.

---

## Task 8: Push to `main`

**Context:** Per the user's plan, these guardrails land on `main`, then the v21 migration worktree merges from `main` to pick them up before the migration completes and merges back.

- [ ] **Step 1: Push**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
git push origin main
```
Expected: push succeeds; CI runs and passes (lint exits 0 with warnings; build succeeds; Supabase advisor unaffected).

- [ ] **Step 2: Confirm CI is green**

```bash
gh run list --branch main --limit 3
```
Expected: most recent run is `completed` and `success` (or in-progress; wait if so).

---

## Self-review notes

- **Spec coverage:** All sections of the design spec are covered: file layout (Tasks 2–6), `src/client/CLAUDE.md` content (Task 5, all 12 sections), ESLint additions (Task 4), tooling install (Tasks 2 + 3), root trim (Task 6), verification (Task 7). Transition strategy (warn-then-ratchet) is honored throughout Task 4.
- **No placeholders:** Every step has concrete commands or file content. The one source of variability — which `@angular-eslint` rules exist in v19 — is resolved by Task 1 before the lint config is written, with explicit instructions to drop unverified rules.
- **Type/path consistency:** File paths are absolute and match the actual repo layout (verified via `ls` during planning). Skill install layout matches the existing pattern (`.agents/skills/<name>/` content + `.claude/skills/<name>` symlink).

## Out of scope for this plan

- Stop-hook drift guard (deferred per spec).
- `.cursor/rules/` portability (deferred per spec).
- Custom Tailwind brand-token lint rule (deferred per spec).
- The actual Angular 21 + PrimeNG 21 framework migration (separate worktree, separate plan).
- Ratcheting lint rules from `warn` to `error` (follow-up task after the v21 migration merges back to `main`).
