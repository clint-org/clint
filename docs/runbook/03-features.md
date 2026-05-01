# Features

[Back to index](README.md)

---

## Timeline Dashboard

The primary view of the application. Displays a grid where rows represent clinical trials and columns represent time. The grid is organized hierarchically:

```
Company
  +-- Product
        +-- Trial (with phase bars and event markers)
```

**Phase Bars** -- horizontal bands that span the timeline for each trial phase. Color-coded by phase type:
- **Phase 1** -- Muted slate (`#94a3b8`, early/exploratory)
- **Phase 2** -- Cyan (`#67e8f9`, building evidence)
- **Phase 3** -- Teal (`#2dd4bf`, pivotal trials)
- **Phase 4** -- Violet (`#a78bfa`, post-approval)
- **Observational** -- Amber (`#fbbf24`, caution-adjacent)

**Event Markers** -- icons placed at specific dates on the timeline. 10 system-provided marker types plus custom user-defined types. Shapes include circles, diamonds, flags, arrows, bars, and X marks -- each with color coding by category:
- Green circles -- Data events
- Red diamonds -- Regulatory events
- Blue flags/bars -- Approval/Launch events
- Orange/red arrows/X -- Change/status events

**Notes** -- free-text annotations attached to trials, displayed inline.

## Timeline Zoom

Four zoom levels let users control the time granularity. The `TimelineService` defines pixel-per-year ratios for each:

| Zoom | Pixels/Year | Column Unit | Use Case |
|---|---|---|---|
| Yearly | 200 px | 1 year | 5-10 year pipelines |
| Quarterly | 600 px (150/quarter) | 1 quarter | 2-3 year views |
| Monthly | 1200 px (100/month) | 1 month | Near-term tracking |
| Daily | 1460 px (4/day) | 1 day | Precise event placement |

The `TimelineService` provides `dateToX()` and `xToDate()` methods for converting between pixel positions and ISO dates, plus `getColumns()` for generating hierarchical column headers with sub-columns.

## Filtering

The `FilterPanelComponent` lets users narrow the dashboard to:

- **Companies** -- show only selected companies
- **Products** -- show only selected products
- **Therapeutic Areas** -- filter by medical indication (Oncology, Cardiology, etc.)
- **Date Range** -- clamp the visible timeline window (start year / end year)
- **Recruitment Status** -- Active, Completed, Suspended, etc.
- **Study Type** -- Interventional, Observational, Expanded Access
- **Phase** -- P1, P2, P3, P4, Observational

All filter values are passed as arrays to the `get_dashboard_data()` RPC function.

## Legend

A grouped reference panel (`LegendComponent`) showing all marker types with their SVG icons and labels. Organized by category. Collapsible for more dashboard space.

## Data Management

A full CRUD interface for managing all data within a space:

| Section | What You Manage |
|---|---|
| Companies | Pharma/biotech company records (name, logo_url, display_order, color) |
| Products | Drug/therapy products linked to a company (name, generic_name, logo_url) |
| Trials | Clinical studies with all metadata + CT.gov dimensions |
| Trial Phases | Phase records with phase_type, start_date, end_date, color, label |
| Trial Markers | Event markers with event_date, end_date, tooltip_text, is_projected |
| Trial Notes | Free-text annotations on trials |
| Marker Types | Custom marker types beyond the 10 system defaults (each assigned to a category) |
| Therapeutic Areas | Medical indication categories (name, abbreviation) |

## Command Palette (Cmd+K)

A power-user finder/navigator/command runner. Mounted once in `AppShellComponent` so it is available on every space-level page. Not mounted in agency portal, super-admin, or marketing surfaces.

**Open:** `Cmd+K` (or `Ctrl+K`); `/` also opens when focus is not in a text input.

**Empty state** (no query): Pinned (top 10), Recents (top 8), Commands (filtered by `when()` predicates). Recents are bumped on entity navigation by both a Router-event listener (matches `/manage/(trials|products|companies)/:id`) and an explicit `recents.touch()` call after the palette activates an entity row.

**Search:** debounced 80ms, minimum 2 chars. Backed by `search_palette` RPC which unions across companies, products, trials, markers (catalyst kind), and events using `pg_trgm` similarity + prefix-match boost + trial-identifier exact-match boost. When no prefix token is used, matching navigation commands are merged into the result list (typing `bullseye` finds the "Go to Bullseye" command without needing the `>` prefix).

**Prefix tokens:** `>` commands, `@` companies, `#` trials, `!` catalysts. Backspacing the lone token returns to all-kinds.

**Activation targets:**
- trial -> `/manage/trials/:id` (detail page)
- company -> `/manage/companies?selected=<id>` (list filtered to that company)
- product -> `/manage/products?selected=<id>` (list filtered to that product)
- catalyst -> `/catalysts?markerId=<id>` (detail panel opens on load)
- event -> `/events?eventId=<id>` (detail panel opens on load)
- command -> client-side `run()` handler (router navigate, sign-out, etc.)

**Pinned/Recents storage:** `palette_pinned(user_id, space_id, kind, entity_id, position)` and `palette_recents(user_id, space_id, kind, entity_id, last_opened_at)`. Both RLS-scoped to `user_id = auth.uid()`. Recents trimmed to last 25 inside `palette_touch_recent`.

**RPCs:** `search_palette`, `palette_empty_state`, `palette_touch_recent`, `palette_set_pinned`, `palette_unpin` -- all `SECURITY DEFINER`, all gate on `has_space_access(p_space_id)`.

## Events (Intelligence Feed)

A unified chronological feed showing analyst-created events and timeline markers together. Events capture competitive intelligence at four entity levels: space (industry-wide), company, product, and trial.

**Route:** `/t/:tenantId/s/:spaceId/events`. Honors `?eventId=<id>` to deep-link a specific event into the detail panel on load (used by the command palette).

**Layout:** Data table (p-table) with sortable/filterable columns + a right-side overlay detail panel (340px, absolute-positioned, `@slidePanel` animation) that slides in on row click and hides when nothing is selected.

| Column | Content |
|---|---|
| Date | Event date, sorted descending by default |
| Source | Badge: "EVENT" (green) or "MARKER" (slate) |
| Title | Event title with thread indicator if applicable |
| Category | 6 system categories: Leadership, Regulatory, Financial, Strategic, Clinical, Commercial |
| Entity | Company / Product / Trial name, or "Industry" for space-level |
| Priority | Red dot for high, empty for low |

**Detail panel (340px overlay):** Description, source URLs, tags, thread context (ordered list of events in the narrative), related events (ad-hoc links), and created timestamp.

**Event features:** Free-form tags, multiple source URLs with labels, threads (sequential narrative chains), ad-hoc links between related events, high/low priority.

## Future Catalysts

The 4th tab in the landscape shell (Timeline | Bullseye | Positioning | **Future Catalysts**). Shows all upcoming markers (clinical trial milestones, data readouts, regulatory dates, approvals, LOE events) in chronological order, grouped into adaptive time buckets.

**Route:** `/t/:tenantId/s/:spaceId/catalysts` (child of landscape shell). Honors `?markerId=<id>` to deep-link a specific marker into the detail panel on load (used by the command palette).

**Layout:** Dense table (p-table with `rowGroupMode="subheader"`). No summary header -- straight to data. The detail panel is shared with other landscape views (see below).

**Grouping:** Adaptive time-bucket density based on distance from today:
- Current ISO week -> "This Week" (with date range)
- Next ISO week -> "Next Week" (with date range)
- Next 2 calendar months -> monthly ("May 2026")
- Beyond that -> quarterly ("Q3 2026")

| Column | Content |
|---|---|
| Date | Monospace, formatted as "Apr 15" |
| Category | Marker shape/color dot + category name (Data, Regulatory, Approval, Clinical Trial, LOE) |
| Catalyst | Title, bold |
| Company / Product | "COMPANY (uppercase) -- Product" |
| Status | "CONFIRMED" (green badge) or "PROJECTED" (amber badge), derived from `is_projected` |

**Filtering:** Uses the shared landscape filter panel (company, product, therapeutic area, MOA, ROA, phase, recruitment status, study type, marker category). The table also has its own text search via `createGridState` for quick in-table filtering.

**Data source:** Derived client-side from the shared `LandscapeStateService.filteredCatalysts` computed signal, which flattens the unfiltered dashboard dataset (fetched once via `get_dashboard_data`) to future markers. Detail panel uses `get_catalyst_detail` RPC.

**Cross-navigation:** Clicking a catalyst row opens the shared detail panel. Switching to the Timeline tab keeps the panel open with the same marker in spatial context. Filters carry over across all landscape tabs.

## PowerPoint Export

The `PptxExportService` generates a `.pptx` file replicating the dashboard view using `pptxgenjs`. Users can configure:

- Title slide content
- Which trials to include
- Date range for the export (start/end year)
- Zoom level

Export details:
- Fixed slide dimensions: 13.33" x 7.5" (widescreen)
- Label column width: 2.8" (Company / Product / Trial names)
- Phase bars rendered with exact colors matching the dashboard
- Markers rendered with shape/fill/color matching their type definitions
- Date labels on markers with overlap detection
- Alternating row backgrounds for readability
- Legend showing all marker types
- Runs entirely client-side -- no file is sent to a server

## CT.gov Integration

The `CtgovSyncService` can fetch trial data from the ClinicalTrials.gov API v2 by NCT ID and map it to internal fields. Trials can store 35+ fields from the ClinicalTrials.gov data model, including:

- **Logistics**: recruitment_status, sponsor_type, lead_sponsor, collaborators[], study_countries[], study_regions[]
- **Scientific Design**: study_type, phase, design_allocation, design_intervention_model, design_masking, design_primary_purpose, enrollment_type
- **Clinical Context**: conditions[], intervention_type, intervention_name, primary/secondary_outcome_measures (jsonb), is_rare_disease
- **Eligibility**: eligibility_sex, eligibility_min_age, eligibility_max_age, accepts_healthy_volunteers, eligibility_criteria, sampling_method
- **Timeline**: start_date, primary_completion_date, study_completion_date (each with _type: Actual|Estimated), plus posting dates
- **Regulatory**: has_dmc, is_fda_regulated_drug, is_fda_regulated_device, fda_designations[], submission_type
- **Sync Tracking**: ctgov_last_synced_at, ctgov_raw_json

Helper methods in the sync service handle phase mapping, masking conversion, sponsor class normalization, country extraction, and region inference.

## Multi-Tenant Workspaces

See [Multi-Tenant Model](09-multi-tenant-model.md) for full details.

- Each **agency** is an optional consulting-firm parent that resells the platform to pharma clients
- Each **tenant** represents an organization (a pharma client of an agency, or a direct customer)
- Each **space** within a tenant is a firewalled engagement scoped to a domain (a therapy area, asset class, client team) — pipelines, catalysts, and portfolio reads all live inside, with their own members and data
- Members can be invited to tenants via invite codes (7-day expiry); branded HTML invite emails are delivered via Resend
- `tenant_members` and `agency_members` are owner-only since migration 75; spaces use owner / editor / viewer (rendered Owner / Contributor / Reader)
- Data isolation is per-space — no implicit cascade from tenant or agency level (firewall introduced in migration 75)

## Whitelabel Brand Resolution

Every request resolves the visitor's identity from the host header before bootstrap, via the anon-callable RPC `get_brand_by_host(p_host)`:

| Host | Kind | Effect |
|---|---|---|
| `pfizer.yourproduct.com` (matches `tenants.subdomain`) | `tenant` | Renders tenant app, branded with that tenant |
| `competitive.pfizer.com` (matches `tenants.custom_domain`) | `tenant` | Same, via sales-led custom domain |
| `zs.yourproduct.com` (matches `agencies.subdomain`) | `agency` | Renders agency portal at `/admin/*` |
| `admin.yourproduct.com` | `super-admin` | Reserved subdomain, super-admin only |
| `yourproduct.com` (apex) | `default` | Marketing landing for unauthenticated visitors; legacy onboarding for direct customers |

`main.ts` synchronously sets `--brand-50..950` CSS vars, swaps the favicon, sets `document.title`, and builds a dynamic PrimeNG preset before bootstrapping Angular. The Tailwind `@theme` block in `styles.css` declares `--color-brand-*` tokens that fall back to the teal scale, so tenants without a brand override render identically to today.

## Branded Login

Single login component at `/login`, rendered on every host. Reads from `BrandContextService`:
- Logo + `app_display_name` headline ("Sign in to {{ brand.appDisplayName() }}")
- One button per provider in `brand.auth_providers` (Google, Microsoft)
- Self-join hint copy when `brand.has_self_join` is true ("Use your work email to join automatically")

The default-host login also surfaces a workspace hint when navigated to with `?workspace=<subdomain>` — used by the marketing landing's "Find your workspace" form.

## Agency Portal

A self-serve portal where consulting firms manage their pharma client tenants. Mounted at `/admin/*` on agency subdomains; gated by `agencyGuard` (kind === `agency`) + `authGuard`.

| Route | Component | Purpose |
|---|---|---|
| `/admin/tenants` | `agency-tenant-list` | Filterable table of all tenants in the agency (logo, name, subdomain, member count, status) |
| `/admin/tenants/new` | `agency-tenant-new` | Provisioning wizard: name, subdomain (debounced live availability), primary color picker, first-user invite |
| `/admin/tenants/:id` | `agency-tenant-detail` | View / edit tenant branding, list members, "Open tenant" cross-host redirect |
| `/admin/members` | `agency-members` | Add agency members (email lookup via `lookup_user_by_email`), change roles, remove |
| `/admin/branding` | `agency-branding` | Edit the agency portal's own brand (display name, primary color, contact email) |

All writes go through SECURITY DEFINER RPCs; agency owners do all writes, agency members get read-only visibility across the agency's tenants.

## Super-Admin Portal

The platform owner's UI for provisioning agencies, registering custom domains, and supervising the install. Mounted at `/super-admin/*`; gated by `superAdminGuard` (kind === `super-admin`) + `authGuard`. Non-admins get a 404-equivalent redirect (do not leak existence of the area).

| Route | Component | Purpose |
|---|---|---|
| `/super-admin/agencies` | `super-admin-agencies` | All agencies; "Provision agency" dialog (name, slug, subdomain, owner email, contact email). Owner email need not be a registered user — if no `auth.users` row matches, an `agency_invites` row is held and `handle_new_user` promotes it on first sign-in. Per-row trash action opens a typed-name confirmation dialog and calls `delete_agency` (refused if any tenants are still attached) |
| `/super-admin/tenants` | `super-admin-tenants` | All tenants across all agencies; filter by agency; register custom domain dialog |
| `/super-admin/domains` | `super-admin-domains` | Retired-hostnames hold list (90-day decommissioning window). Per-row "Release" action calls `release_retired_hostname` for super-admin override (use only after a deliberate super-admin delete; real customer decommissions should keep the holdback) |

Bootstrap is `INSERT INTO platform_admins (user_id) VALUES ('<uuid>')` via SQL — there is no UI to add platform admins.

## Domain-Allowlist Self-Join

Tenant owners can configure `email_domain_allowlist` (e.g., `pfizer.com`) and toggle `email_self_join_enabled`. When a user signs in to a tenant subdomain whose allowlist matches their email and self-join is enabled, the auth callback calls `self_join_tenant(p_subdomain)` and the user is auto-added at `member` role. UI lives in **Tenant Settings → Access**.

The RPC returns the **same generic error** for every failure mode (missing tenant, self-join off, allowlist mismatch, suspended tenant) to prevent enumeration of which subdomains exist and which corporate emails unlock them.

## Branded Invite Emails

When `tenantService.inviteMember()` inserts a row into `tenant_invites`, a Supabase database webhook triggers the `send-invite-email` Edge Function (Deno), which:
- Verifies the `webhook-signature` header against `EMAIL_WEBHOOK_SECRET`
- Reads tenant brand fields (`app_display_name`, `logo_url`, `primary_color`, `email_from_name`, `subdomain`/`custom_domain`) via the service-role client
- Composes HTML + plain-text bodies with brand color tinting and the tenant logo
- POSTs to Resend (`https://api.resend.com/emails`) with sender `noreply@yourproduct.com` and per-tenant display name
- The accept URL points at the tenant subdomain or custom domain: `https://{subdomain}.{apex}/onboarding?code={invite_code}`

The existing manual code-sharing flow stays functional — agency owners can copy invite codes from tenant settings if delivery fails.

## Branded PowerPoint Exports

`PptxExportService` reads from `BrandContextService`:
- **Cover slide** with tenant logo (downloaded as base64 once at slide build), `app_display_name` as title (28pt bold, primary color), "Clinical Trial Landscape" subtitle, today's date
- **Title bar accent** and trial label labels tinted with `brand.primary_color`
- **Per-slide footer** with `app_display_name` left, page number right
- Phase-bar fills, marker colors, slate / amber / red / green / cyan / violet stay hard-coded — those are data colors, not brand
- Logo download failure falls back to text-only header without failing the export

## Marketing Landing

Minimal page at `/` on the default host (apex) for unauthenticated visitors. Shows the Clint logo, name, tagline ("Competitive intelligence for pharma"), and a "Find your workspace" form. The form takes a subdomain and redirects to `https://{subdomain}.{apex}/login` (production) or `/login?workspace={subdomain}` (dev where `apexDomain` is empty). Authenticated visitors continue through the existing `onboardingRedirectGuard`. Gated by `marketingLandingGuard`. Brand color is applied via the SVG logo's inner stroke and the tagline (`text-brand-700`).

## Authentication

See [Authentication & Security](08-authentication-security.md) for full details.

Google OAuth and Microsoft (Azure AD) OAuth via Supabase Auth. Users sign in with one of the providers exposed by their tenant's `brand.auth_providers`; no password management required. Cross-subdomain session is shared via cookies on the apex domain.
