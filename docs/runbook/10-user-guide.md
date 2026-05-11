# User Guide

[Back to index](README.md)

---

## Getting Started

### Signing In

The login screen is brand-aware. The logo, app display name, and the buttons that appear ("Sign in with Google" and/or "Sign in with Microsoft") are determined by the host you visited.

1. Navigate to your workspace URL (e.g. `https://pfizer.yourproduct.com`, your agency portal, or the apex `https://yourproduct.com`)
2. Click **Sign in with Google** or **Sign in with Microsoft** (whichever your workspace allows)
3. Authenticate with the provider
4. On first sign-in:
   - **Tenant subdomain with self-join enabled and your email matches the allowlist** -- you're auto-added to the workspace at `member` role, no further action needed
   - **Tenant subdomain via invite** -- you'll land on the invite acceptance page (visit the invite link `https://<workspace>.yourproduct.com/onboarding?code=<8-char-code>`)
   - **Agency portal** -- you'll land on the tenant list at `/admin/tenants`
   - **Apex (default host)** -- you'll be taken to the Onboarding screen

### Finding Your Workspace

If you don't remember your workspace subdomain, navigate to the apex domain (e.g. `https://yourproduct.com`). The marketing landing has a "Find your workspace" form — enter your subdomain and you'll be redirected to your branded login.

### First-Time Onboarding

If your organization is new to Clint:
1. Click **Create Organization**
2. Enter your organization name
3. You'll land on the Spaces page

If you've been invited to an existing organization:
1. Click **Join with Invite Code**
2. Enter the code provided by your organization admin
3. You'll be added to the organization and directed to its spaces

### Creating Your First Space

A Space is a workspace for one pipeline or project (e.g., "Oncology Pipeline Q1 2026").

1. On the Spaces page, click **New Space**
2. Enter a name and optional description
3. Click **Create**
4. You'll enter the space and see an empty dashboard

---

## Using the Dashboard

The dashboard is the main view. It shows a timeline grid with your trials.

### Navigation

The header shows your current **Organization** and **Space** as dropdowns. Click either to switch. Navigation links in the center (Dashboard, Companies, Products, Trials, Markers, Areas) are visible when inside a space. The signed-in account email and Sign out are available under the initials avatar button on the right.

### Timeline Grid

The grid has three sections:
- **Left panel** -- Company, Product, and Trial labels (sticky on horizontal scroll), plus optional MOA and ROA columns
- **Timeline header** -- Date columns scaled to the current zoom level (sticky on vertical scroll)
- **Trial rows** -- Phase bars and event markers for each trial
- **Right panel** -- Notes column (hidden on small screens)

### Column Visibility

Click the gear icon at the far left of the grid header to toggle optional columns on or off:
- **MOA** -- Mechanism of Action
- **ROA** -- Route of Administration
- **Notes** -- Trial notes (right side)

All columns are visible by default. Your choices persist for the browser session.

### Zoom Controls

Use the zoom buttons to change the timeline granularity:
- **Y** = Yearly (best for 5-10 year views)
- **Q** = Quarterly
- **M** = Monthly
- **D** = Daily (best for near-term precision)

### Filtering

The filter panel provides dropdowns for:
- Companies and assets
- Therapeutic areas
- Date range (start/end year)
- Recruitment status (Active, Completed, etc.)
- Study type (Interventional, Observational)
- Phase (P1-P4, Observational)

Filters are additive -- empty filters mean "show all."

### Reading the Timeline

**Phase Bars** -- colored horizontal bands showing when each clinical phase runs:
- Slate = Phase 1
- Cyan = Phase 2
- Teal = Phase 3
- Violet = Phase 4
- Amber = Observational

Labels appear inside bars when width allows, otherwise outside.

**Event Markers** -- icons at specific dates. Hover over any marker to see a tooltip with type name, date, and notes. Markers with an end date render as range indicators (bar type).

**Notes** -- text annotations displayed below a trial row.

Click any phase bar, marker, or trial name to navigate to the trial detail page.

### Legend

The **Legend** panel shows all marker types grouped by category with their icon previews. Use it as a reference for what each shape/color combination means.

---

## Managing Data

Access the management screens via the header navigation links.

### Companies

**Navigate:** Companies link in header

- **Add Company** -- Enter name, optional logo URL and display order
- **Logo column** -- When a company has a `logo_url` set, the Logo column renders the image as a small preview (lazy-loaded, 20px tall, max 128px wide). Broken / missing URLs fall back to a muted placeholder.
- **Click a company name** -- Drills into the Assets list filtered to that company (`?company=<id>`). A "Clear filter" button in the Products header pops back to the unfiltered view.
- **Edit / Delete / View assets** -- Use the row overflow (`...`) menu. Delete is destructive and cascades to all linked assets and trials.
- Companies are ordered by `display_order`.

### Products

**Navigate:** Products link in header

- **Add Product** -- Enter name, optional generic name, select parent company
- **Click an asset name or its trial count** -- Drills into the Trials list filtered to that asset (`?product=<id>`).
- **Company filter** -- Assets list supports a `?company=<id>` query parameter (set automatically when drilling in from Companies) with a "Clear filter" button in the header to return to the unfiltered view.
- **Edit / Delete / View trials** -- Use the row overflow (`...`) menu.
- Products are ordered by `display_order` within their company.

### Trials

**Navigate:** Trials link in header (dense list of every trial in the space), or click a trial name on the dashboard

The Trials list supports a `?product=<id>` query filter (set automatically when you click an asset trial count) with a "Clear filter" button to return to the unfiltered view. Each row deep-links to the Trial Detail page via the overflow menu's **Open detail** action, or by clicking the trial name.

The Trial Detail page provides a comprehensive form with sections:

**Basic info:**
- Name, identifier, sample size, status, notes, therapeutic area

**CT.gov fields (organized by category):**
- Logistics: recruitment status, sponsor type, lead sponsor, collaborators, countries, regions
- Design: study type, phase, allocation, intervention model, masking, primary purpose
- Clinical: conditions, intervention details, outcome measures, rare disease flag
- Eligibility: sex, age range, healthy volunteers, criteria text
- Timeline: start date, completion dates, posting dates
- Regulatory: DMC, FDA regulation, designations, submission type

**Phases tab:**
- View all phases for this trial
- **Add Phase** -- Select phase type (P1-P4, OBS), set start/end dates, optional color and label
- **Edit / Delete** phases

**Markers tab:**
- View all event markers
- **Add Marker** -- Select type, set event date (and optional end date for ranges), add tooltip text
- **Edit / Delete** markers
- **CT.gov auto-derived markers** -- For trials linked to an NCT identifier, three markers are auto-derived from clinicaltrials.gov on first sync and refreshed when newly populated: Trial Start, Primary Completion Date, and Trial End. They carry a small **CT.gov** badge in the marker title cell and on hover tooltips so they're identifiable at a glance. Click one to see source field, date type (anticipated by sponsor vs. actual), and last sync time. Deleting an auto-derived marker is allowed but the next CT.gov sync may re-create it -- to suppress permanently, replace it with a manual marker of the same type.

**Notes tab:**
- View all notes for this trial
- **Add Note** -- Enter free text content
- **Edit / Delete** notes

### Marker Types

**Navigate:** Markers link in header

You can create custom marker types beyond the 10 system defaults:
1. Click **Add Marker Type**
2. Select a **category** (Clinical Trial, Data, Regulatory, Approval, or Loss of Exclusivity)
3. Choose a name, shape (circle, diamond, flag, arrow, bar, x), fill style (filled, outline, striped, gradient), and color
4. Custom markers appear in the legend and are available when adding markers to trials

System marker types (the 10 defaults) cannot be modified or deleted.

### Therapeutic Areas

**Navigate:** Therapeutic Areas link in header

Manage the list of medical indication categories (name + abbreviation) used to classify trials.

---

## Activity & change feed

Every change to a trial -- whether it came from the daily CT.gov sync or from an analyst editing a row in Clint -- is recorded as a change event. Several surfaces expose those events.

### Activity page

**Navigate:** `/t/:tenantId/s/:spaceId/activity`

A filterable, paginated feed of every change in the space, newest first. Filters:

- Date range (last 7d / 30d / 90d / custom)
- Event type (date moved, phase transitioned, status changed, marker edited, etc.)
- Source (CT.gov vs. analyst)
- Trial

Each row shows who or what triggered the change, the field that moved, the before/after values, and the timestamp. Click a row to jump to the trial detail page.

### What changed widget

The engagement landing page surfaces a "What changed" panel with the top 5 high-signal events from the last 7 days. Click **View all** to open the full Activity page.

### Trial row badges

Trial names on the dashboard, the Trials list, and the engagement landing show a small dot badge:

- **Slate dot** -- any change in the last 7 days
- **Red dot** -- a `date_moved`, `phase_transitioned`, or `trial_withdrawn` event in the last 7 days

Hover the badge for a quick summary; click the trial to drill in.

### Marker history panel

On any marker detail, expand **History** to see who edited the marker, what fields changed, and when. Useful for auditing analyst overrides.

### Trial-detail Activity section

The bottom of every trial-detail page lists recent change events for that trial only. Same row format as the Activity page; scoped to the current trial.

### Sync from CT.gov

Trial-detail pages have a **Sync from CT.gov** button that forces an immediate poll of that trial's NCT identifier and recomputes its change feed. Available to space owners and editors. The daily 07:00 UTC sync still runs automatically; this button is for when you need a fresh read on demand (e.g. you saw a press release and want to confirm the registry update has landed).

### Per-space field visibility

**Navigate:** `/t/:tenantId/s/:spaceId/settings/fields`

Space owners pick which CT.gov fields appear on each surface (trial detail, bullseye detail, timeline detail, key catalysts panel, trial list). Useful for hiding noise fields the team doesn't track or for surfacing rare fields a particular engagement cares about. Choices are per-space.

---

## Exporting to PowerPoint

1. Click **Export** button in the dashboard toolbar
2. Configure the export:
   - Zoom level
   - Start/end year
3. Click **Generate** -- the `.pptx` file downloads immediately

The export renders phase bars and markers with visual fidelity matching the dashboard. It runs entirely client-side in your browser; nothing is uploaded to a server.

---

## Organization Settings

**Navigate:** Gear icon in header

Tenant owners can:
- **Branding** -- Edit display name, upload a logo, set the primary color, set the email sender display name (`email_from_name`). Changes propagate to every page after refresh and to all subsequent invite emails and PPT exports
- **Members** -- Table showing all members with name, email, and role; remove button (with confirmation)
- **Pending invites** -- Codes, emails, roles, and expiration dates
- **Invite a new member** -- Generate an invite code by entering email and role. A branded invite email is sent automatically (subject from your `email_from_name`, accept-button tinted with your `primary_color`, link to `https://<your-subdomain>.yourproduct.com/onboarding?code=...`). The code is also visible in the pending-invites table for manual sharing if email delivery fails.

### Access (self-join via domain allowlist)

Tenant owners see an **Access** section that controls who can join the workspace without an invite:

- **Allow employees to self-join this workspace** toggle -- when on, anyone signing in with an email at one of the allowlisted domains is added automatically at `member` role
- **Allowed email domains** -- chip editor (e.g. `pfizer.com`). Each domain validated against `^[a-z0-9.-]+\.[a-z]{2,}$` before saving
- The UI warns when a consumer domain (`gmail.com`, `yahoo.com`, etc.) is added — these are easy to abuse for self-join
- Save with **Save access settings**

Self-join failures are intentionally generic ("self-join not available for this workspace") regardless of cause — the workspace owner can see the actual reason in the Supabase logs but the user does not.

## Agency Portal (consulting partners)

Agency owners and members at consulting firms log in to the agency portal at their own subdomain (e.g. `https://zs.yourproduct.com`). The portal is mounted at `/admin/*`.

### Provisioning a New Pharma Client Tenant (owners only)

**Navigate:** `/admin/tenants` -> "Provision new tenant"

1. Enter the pharma client's organization name
2. Pick a subdomain (live availability check shows green/red as you type; debounced)
3. Pick a primary brand color (will be used as the tenant's accent throughout the UI)
4. Optional: enter the first user's email to issue an invite

On submit, the platform creates the tenant and adds the agency operator as tenant owner. (The legacy auto-creation of a "Workspace" space at this point was removed on 2026-04-30 — engagement spaces are created explicitly later via the Create-space flow on the spaces list.) If an email was supplied, a `tenant_invites` row is also written, whose INSERT triggers a branded invite email.

### Managing a Tenant

**Navigate:** `/admin/tenants/:id`

- **Branding** -- display name, logo URL, primary color, email_from_name. Saved via `update_tenant_branding`
- **Members** -- read-only list of the tenant's members (agency owners can also use the tenant's own settings page for write actions, via the "Open tenant" button)
- **Open tenant** -- cross-host redirect to the tenant subdomain. Your session cookie is shared on the apex, so you don't re-authenticate.

### Agency Members

**Navigate:** `/admin/members`

- **Add member** -- enter email; the platform looks up the user and adds them to your agency. Owners can add other owners or members.
- **Change role** -- promote/demote between owner and member
- **Remove member** -- with confirmation

Agency owners get full read+write access across all tenants in the agency. Agency members get read-only across the same set.

### Custom Domains

Custom domains are sales-led. Contact the platform team — they'll register the hostname as a Custom domain on the Cloudflare Worker and wire `tenants.custom_domain` from the super-admin portal. You'll provide the CNAME from the customer's DNS.

## PowerPoint Exports

Exports are branded with your tenant's logo and primary color:
- **Cover slide** with your logo, app display name in primary color, and today's date
- **Per-slide footer** with your app display name and page numbers
- Phase bars and marker colors stay as designed (data colors are part of the visualization)
- If the logo URL fails to download, the cover falls back to a text-only header — the export never fails

## Tenant Suspension

If your tenant is suspended (non-payment, abuse), the workspace becomes read-only:
- All data remains visible — you can still export to PPT
- A "this workspace is suspended" banner appears on every page
- New writes (creating trials, editing companies, inviting members, etc.) are blocked at the database level
- Self-join is also blocked — new users see the generic "self-join not available" error

Contact the platform team or your agency owner to resolve.

---

## Spaces

**Navigate:** Click organization name in header, or navigate to Spaces link

- **Create a new space** -- Each space is an independent pipeline workspace
- **Switch spaces** -- Click a space from the list or use the space dropdown in the header
- **Space settings** -- Edit space name and description, then click **Save changes**. Manage space members and delete the space from the Settings pages.
- Spaces within the same organization share member access rules but have completely separate data
- Your last-visited tenant and space are remembered automatically
