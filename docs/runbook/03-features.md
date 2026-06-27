# Features

[Back to index](README.md)

---

Clint's feature inventory, broken down by surface. Each surface has a dedicated page under `features/` with narrative and a structured capability block. The list below is regenerated from those files.

To explore the matrix structurally:

- `npm run features:near -- --tables <name>`: find capabilities touching a table.
- `npm run features:near -- --rpcs <name>`: find capabilities calling an RPC.
- `npm run features:check`: verify the matrix against live code.

<!-- AUTO-GEN:SURFACES -->
| Surface | Summary | File |
|---|---|---|
| Agency Portal | Agency portal mounted at /admin/* on agency subdomains, gated by agencyGuard and authGuard. | [agency-portal.md](features/agency-portal.md) |
| Audit Log | Canonical Tier 1 writer that every privileged RPC calls to append a row to audit_events. | [audit-log.md](features/audit-log.md) |
| Branded Invite Emails | Supabase database webhook fires on tenant_invites insert and calls the send-invite-email Edge Function. | [branded-invite-emails.md](features/branded-invite-emails.md) |
| Branded Login | Single login component at /login on every host, branded via BrandContextService (logo, display name, provider buttons). | [branded-login.md](features/branded-login.md) |
| Command Palette | Open palette via Cmd+K, Ctrl+K, or slash key when focus is outside a text input. | [command-palette.md](features/command-palette.md) |
| CT.gov Integration | Idempotent ingest RPC that stores a CT.gov payload snapshot, materializes the trial row, and writes raw field diffs. | [ctgov-integration.md](features/ctgov-integration.md) |
| Data Management | CRUD interface for pharma/biotech company records (name, logo_url, display_order, color). | [data-management.md](features/data-management.md) |
| Domain-Allowlist Self-Join | Auto-add a signed-in user as tenant member when their email domain matches the tenant allowlist. | [domain-allowlist-self-join.md](features/domain-allowlist-self-join.md) |
| Engagement Landing | Slim slate-50 status band with engagement name, active-since subline, and inline trials/companies/assets inventory totals. | [engagement-landing.md](features/engagement-landing.md) |
| Events | Unified chronological data table mixing analyst events, timeline markers, and detected change events across four entity levels. Server-side pagination via {items, total} return shape. Marker rows show their category glyph and a projected/confirmed status; the overview pane shows a colour-coded category distribution. | [events.md](features/events.md) |
| Future Catalysts | Adaptive-bucket dense table of upcoming markers grouped by week, month, and quarter based on distance from today. | [catalysts.md](features/catalysts.md) |
| In-app Help Pages | Tenant-scoped help page describing space-membership roles and permissions; linked from the Space Members page. | [in-app-help.md](features/in-app-help.md) |
| Landscape Views | Shared landscape shell hosting Timeline, Bullseye, Heatmap, and Future Catalysts tabs with cross-tab filter and detail-panel continuity. | [landscape-views.md](features/landscape-views.md) |
| Marketing Landing | Default-host page with logo, tagline, and Find your workspace form; gated by marketingLandingGuard. | [marketing-landing.md](features/marketing-landing.md) |
| Materials Registry | materials table keyed on space_id with material_type (briefing, priority_notice, ad_hoc) and polymorphic material_links to six entity kinds (trial, marker, company, asset, space, event). | [materials-registry.md](features/materials-registry.md) |
| Multi-Tenant Workspaces | Owner-or-super-admin tenant creation with subdomain, branding fields, and first-user invite. | [multi-tenant-workspaces.md](features/multi-tenant-workspaces.md) |
| PowerPoint Export | Client-side PPTX generation via pptxgenjs replicating the dashboard view as shown, at the current on-screen zoom, directly from the header Export menu. | [pptx-export.md](features/pptx-export.md) |
| Primary Intelligence | Anchor-version model; primary_intelligence_anchors owns entity binding and lead/order; primary_intelligence rows are versions scoped to an anchor with draft, published, archived, withdrawn lifecycle and per-anchor version_number. | [primary-intelligence.md](features/primary-intelligence.md) |
| Source Document Import (AI-Extracted) | Cloudflare Worker route that fetches/cleans a source, calls Claude Sonnet 4.6, validates the response, enriches with CT.gov lookups, probes Brandfetch's Logo Link CDN with a 1-byte Range GET per new company to pick the best non-placeholder asset type (symbol > icon > logo by ETag), and returns structured proposals. | [source-import.md](features/source-import.md) |
| Super-Admin Portal | Super-admin portal mounted at /super-admin/*, gated by superAdminGuard with 404-equivalent redirect for non-admins. | [super-admin-portal.md](features/super-admin-portal.md) |
| Timeline Dashboard | Hierarchical Company / Asset / Indication / Trial grid with phase bars and event markers across a configurable time window. | [timeline-dashboard.md](features/timeline-dashboard.md) |
| Trial Change Feed | Four-stage observe-store-classify-surface pipeline ingesting CT.gov snapshots and analyst marker changes into typed trial_change_events. | [trial-change-feed.md](features/trial-change-feed.md) |
| Whitelabel Brand Resolution | Pre-bootstrap anon RPC resolves host header to a brand record (tenant, agency, super-admin, or default). | [whitelabel-brand-resolution.md](features/whitelabel-brand-resolution.md) |
<!-- /AUTO-GEN:SURFACES -->
