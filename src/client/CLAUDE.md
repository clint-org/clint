# Angular Client -- Guardrails

Rules in this file apply to **all Angular work in `src/client/`**, including edits to existing files. When you touch a component or service that uses an outdated pattern, migrate that file to current conventions in the same change. Don't half-migrate; don't defer. The lint config (`eslint.config.js`) is mixed: clean rules ratchet to `error` (standalone, no-input-rename, native control flow, self-closing tags, etc.); rules with backlog stay at `warn` (`prefer-on-push`, `prefer-signals`, `prefer-output-readonly`, `template/no-call-expression`, ...). New v21 rules (`prefer-inject`, `prefer-output-emitter-ref`, `use-injectable-provided-in`, `template/prefer-at-empty`, `template/prefer-contextual-for-variables`) are at `warn` and will ratchet as the backlog clears. `no-uncalled-signals` is intentionally not enabled: it requires typed linting, which we'll consider enabling workspace-wide as a separate decision.

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

- If the file uses any deprecated pattern from sections 1-4, migrate the whole file in the same change. Several rules already block at `error`; the rest at `warn` will tighten as the backlog clears.
- If the migration would balloon the diff (e.g., a 1500-line component with 40 `*ngIf`s, paired with a 5-line bug fix), pause and ask whether to split into a focused modernization commit first.
- Don't introduce new code in old patterns to match the file's existing style. Consistency yields to current conventions.

## 12. Verification

```bash
cd src/client && ng lint && ng build
```

For UI changes, exercise the feature in a browser. Type checks verify code, not behavior.

## 13. Empty-state audit

Every user-facing surface must answer these questions in the UI itself, not in a help page:

1. **First-row state.** When data exists, the row labels and primary value column communicate what each row is without external context. Column headers use domain vocabulary (Marker, Trial, Catalyst), never generic ones (Item, Record).
2. **Empty state.** When there is no data, the empty state names what goes here and how to add one. For viewer-role surfaces (read-only), the empty state explains why it is empty without offering an action the role cannot take.
3. **Action labels.** Every button and link uses domain vocabulary in imperative form (Register material, Open command palette, Publish intelligence). No generic CTAs (Submit, Click here, Add).
4. **Tooltips on icon-only buttons.** Every button without text uses `pTooltip` from `primeng/tooltip`. Position right for nav rails, top for inline badges, bottom for editor toolbars.
5. **Role-appropriate affordances.** Surfaces shown to multiple roles hide actions the current role cannot take. No greyed-out buttons; no permission-denied toasts after click.
6. **Loading and error states.** Skeleton placeholder during fetch. Errors name what failed and what to do (retry, contact owner). Never silent empty.

**Exception.** Three editorial conventions cannot be carried by the UI alone and have dedicated help pages: marker color rules (`help/markers`), phase color rules (`help/phases`), role and permission model (`help/roles`). Adding a fourth requires a deliberate decision. By default, work harder on the surface first.

**When adding a new feature:** run `npm run features:near -- --tables <touched-tables> --rpcs <touched-rpcs>` to surface adjacent capabilities. Reference any hits in the spec under a "Related capabilities" header.

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
