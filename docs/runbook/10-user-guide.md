# User Guide

[Back to index](README.md)

---

## Getting Started

### Signing In

1. Navigate to the application URL
2. Click **Sign in with Google**
3. Authenticate with your Google account
4. On first sign-in, you'll be taken to the Onboarding screen

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
- Companies and products
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
- **Click a company name** -- Drills into the Products list filtered to that company (`?company=<id>`). A "Clear filter" button in the Products header pops back to the unfiltered view.
- **Edit / Delete / View products** -- Use the row overflow (`...`) menu. Delete is destructive and cascades to all linked products and trials.
- Companies are ordered by `display_order`.

### Products

**Navigate:** Products link in header

- **Add Product** -- Enter name, optional generic name, select parent company
- **Click a product name or its trial count** -- Drills into the Trials list filtered to that product (`?product=<id>`).
- **Company filter** -- Products list supports a `?company=<id>` query parameter (set automatically when drilling in from Companies) with a "Clear filter" button in the header to return to the unfiltered view.
- **Edit / Delete / View trials** -- Use the row overflow (`...`) menu.
- Products are ordered by `display_order` within their company.

### Trials

**Navigate:** Trials link in header (dense list of every trial in the space), or click a trial name on the dashboard

The Trials list supports a `?product=<id>` query filter (set automatically when you click a product's trial count) with a "Clear filter" button to return to the unfiltered view. Each row deep-links to the Trial Detail page via the overflow menu's **Open detail** action, or by clicking the trial name.

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
- **Edit organization name** -- Change the name and click **Save**
- **View members** -- Table showing all members with name, email, and role
- **Remove members** -- Click remove button (with confirmation)
- **Invite members** -- Generate an invite code by entering email and role
- **View pending invites** -- See codes, emails, roles, and expiration dates

---

## Spaces

**Navigate:** Click organization name in header, or navigate to Spaces link

- **Create a new space** -- Each space is an independent pipeline workspace
- **Switch spaces** -- Click a space from the list or use the space dropdown in the header
- **Space settings** -- Edit space name and description, then click **Save changes**. Manage space members and delete the space from the Settings pages.
- Spaces within the same organization share member access rules but have completely separate data
- Your last-visited tenant and space are remembered automatically
