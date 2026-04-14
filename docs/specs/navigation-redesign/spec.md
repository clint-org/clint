# Navigation Redesign: Icon Rail + Contextual Topbar

## Overview

Replace the flat 8-item horizontal topbar with a three-layer navigation system: a 48px icon rail (always visible), an expandable 220px sidebar (hover-to-peek, click-to-pin), and a contextual topbar that adapts per page. The goal is to separate analytical views from configuration pages, support two distinct user personas (executive consumers and data curators), and create room for the app to grow without crowding the primary navigation.

## Problem

The current navigation puts all eight top-level items (Landscape, Companies, Products, Trials, Markers, Areas, Events, Catalysts) at the same level in a single horizontal bar. This creates several issues:

- **No hierarchy:** Configuration pages (Companies, Marker Types, Therapeutic Areas) have the same visual prominence as the primary analytical views (Timeline, Bullseye, Events).
- **Wrong priority for most users:** Pharma executives spend ~80% of their time in visualization and intelligence views. The management pages they rarely touch consume half the nav bar.
- **No room to grow:** Adding new features (spaces management, org settings, new visualizations) means either cramming more items into the bar or creating overflow menus.
- **Missing items:** Therapeutic Areas, MOA, and ROA are routed but not visible in the primary nav -- they're only reachable via direct URL or from within the manage pages.
- **Two personas, one nav:** Data curators who maintain the competitive landscape need quick access to all CRUD pages. Executives just need the views. The current flat nav serves neither well.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout pattern | Narrow icon rail + expandable sidebar + topbar | Minimizes horizontal space loss (48px) while providing full hierarchical navigation on demand |
| Rail expand behavior | Hover-to-peek (overlay) + click-to-pin (push content) | Executives keep it collapsed; data curators pin it open. VS Code / Figma pattern. |
| Topbar behavior | Contextual per page type | Landscape gets view tabs; other pages get eyebrow + title + actions. Avoids duplicating sidebar navigation. |
| Bullseye dimensions | Nested in sidebar under Bullseye | Keeps topbar predictable (always shows Timeline/Bullseye/Positioning for Landscape). Dimensions are a property of the Bullseye view. |
| Taxonomy pages | Consolidated into single page with segmented control | Therapeutic Areas, MOA, ROA are all lookup tables -- merge into one "Taxonomies" page to reduce sidebar clutter. |
| Settings position | Pinned to sidebar bottom | Follows convention (Linear, VS Code, Notion). Visually separated from primary workflow. |

## Navigation Architecture

### Layer 1: Icon Rail (48px, always visible)

Dark background (`slate-900` / `#0f172a`). Vertically stacked icons.

**Layout (top to bottom):**

| Position | Element | Click Action |
|----------|---------|-------------|
| Top | App logo (teal, 28x28) | Navigate to current space's Timeline |
| Section 1 | Landscape icon | Navigate to Timeline (or last-used Landscape view) |
| Section 2 | Intelligence icon | Navigate to Events |
| Section 3 | Manage icon | Navigate to Companies |
| Bottom | Settings icon | Navigate to Taxonomies |
| Bottom | User avatar (initials) | Open account dropdown (email, sign out) |

**Interaction states:**

- **Default:** Slate icon (`slate-500`), no background
- **Hover:** Lighter icon (`slate-400`), subtle dark background (`slate-800`)
- **Active section:** Teal icon (`teal-600`), tinted background (`teal-600/15%`), 3px teal left-edge indicator bar
- **Tooltip:** Dark tooltip appears to the right of the icon on hover (when sidebar is collapsed)

### Layer 2: Expandable Sidebar (220px)

Same dark background as the rail. Two modes:

**Hover-to-peek (overlay):**
- Triggered when cursor enters the 48px rail zone (not a larger hit area -- the rail itself is the trigger)
- Sidebar expands as an overlay on top of the content area (content does not resize)
- Collapses when cursor leaves the expanded sidebar area (not just the rail)
- Slight delay on collapse (~200ms) to prevent flicker
- Mouse must leave the entire sidebar+rail zone to trigger collapse

**Click-to-pin:**
- Pin/unpin toggle icon in the top-right of the expanded sidebar header (pushpin icon that rotates when pinned)
- When pinned, sidebar pushes the content area (content resizes)
- Pin state persisted per user (localStorage)
- Pinned state survives page navigation

**Sidebar content (top to bottom):**

```
┌──────────────────────┐
│ Acme Pharma          │  Org name (click to switch orgs if 2+)
│ Oncology Pipeline ▾  │  Space picker dropdown
├──────────────────────┤
│ LANDSCAPE            │  Section header
│   ◎ Timeline         │  Active item: teal text + tinted bg
│   ○ Bullseye         │  Expandable: shows dimensions when active
│     ├ Therapy Area   │    Indented sub-items (only when Bullseye selected)
│     ├ Company        │
│     ├ MOA            │
│     └ ROA            │
│   ○ Positioning      │
│                      │
│ INTELLIGENCE         │
│   ○ Events           │
│   ○ Catalysts        │
│                      │
│ MANAGE               │
│   ○ Companies        │
│   ○ Products         │
│   ○ Trials           │
│                      │
├──────────────────────┤  Visual separator (pushed to bottom)
│ SETTINGS             │
│   ○ Taxonomies       │  Consolidated: Therapeutic Areas, MOA, ROA
│   ○ Marker Types     │
│   ○ Organization     │  Members, invites, roles (links to tenant-level route)
│   ○ Spaces           │  Space list, create space (links to tenant-level route)
└──────────────────────┘
```

**Active item styling:** Teal text (`teal-600`), subtle teal background tint (`teal-600/15%`), 2px left border indicator.

**Section headers:** 9px uppercase, wide letter-spacing, `slate-600` color. Not clickable.

**Bullseye sub-items:** Only visible when Bullseye or one of its dimensions is the active route. Indented 20px from parent. Slightly smaller font (11px vs 12px).

### Layer 3: Contextual Topbar

White background, single horizontal bar (~42px height). Content varies by page type:

**Landscape pages (Timeline, Bullseye, Positioning):**
```
┌─────────────────────────────────────────────────────────────┐
│ Landscape  │  Timeline   Bullseye   Positioning  │  Filters  Export  🔔 │
└─────────────────────────────────────────────────────────────┘
```
- Section label ("Landscape") on the left, bold
- View tabs with active indicator (teal bottom border)
- Filter chips and actions on the right
- When Bullseye is active with a dimension selected, entity picker dropdown appears after the view tabs

**Intelligence pages (Events, Catalysts):**
```
┌─────────────────────────────────────────────────────────────┐
│ INTELLIGENCE        │                    Category: All  Priority: All  + New Event │
│ Events              │                                                              │
└─────────────────────────────────────────────────────────────┘
```
- Eyebrow label (section name, 9px uppercase, `slate-400`)
- Page title below (13px, bold)
- Page-level filters and primary action on the right

**Manage pages (Companies, Products, Trials):**
```
┌─────────────────────────────────────────────────────────────┐
│ MANAGE              │                              12 companies  + Add Company │
│ Companies           │                                                         │
└─────────────────────────────────────────────────────────────┘
```
- Same eyebrow + title pattern
- Record count and primary action on the right

**Detail pages (Trial Detail):**
```
┌─────────────────────────────────────────────────────────────┐
│ ← Trials  │  PFIZER / IBRANCE                                    Edit │
│            │  NCT02513394 Phase III                                     │
└─────────────────────────────────────────────────────────────┘
```
- Back arrow + parent page name (clickable)
- Entity context (company/product as eyebrow)
- Entity title
- Page actions on the right

**Settings pages (Taxonomies, Marker Types, Organization, Spaces):**
```
┌─────────────────────────────────────────────────────────────┐
│ SETTINGS            │                                3 members  Invite Member │
│ Organization        │                                                        │
└─────────────────────────────────────────────────────────────┘
```
- Same eyebrow + title pattern as Manage

### Filter Bar

For pages that have filters (Landscape views, Events, Catalysts), the filter bar sits below the topbar as a separate thin strip (~30px). This is the existing `landscape-filter-bar` pattern, extended to other pages.

```
┌─────────────────────────────────────────────────────────────┐
│ Phase: All   Company: All   Area: Oncology          Export  │
└─────────────────────────────────────────────────────────────┘
```

Light background (`slate-50`), filter chips as pill buttons, subtle bottom border.

## Taxonomies Page

Consolidates three existing pages (Therapeutic Areas, Mechanisms of Action, Routes of Administration) into a single page with a segmented control at the top.

**Segmented control options:** Therapeutic Areas | MOA | ROA

Each segment shows the same table UI as the current individual pages. Active segment has white background with subtle shadow; inactive segments have transparent background.

The selected segment is reflected in a query parameter (`?tab=therapeutic-areas`) so it's linkable and survives refresh.

## Sidebar Sections to Icon Mapping

When the sidebar is collapsed, each section maps to a single icon in the rail:

| Section | Icon Concept | Notes |
|---------|-------------|-------|
| Landscape | Three horizontal bars with marker dots | Represents the timeline view -- the primary/default view |
| Intelligence | Star | Represents key events and catalysts |
| Manage | Rounded square with list lines | Represents data tables / record management |
| Settings | Gear with radiating lines | Standard settings convention |

Icons should be 20x20px SVG, 1.5px stroke weight, using the same color scheme as the interaction states described above.

## Org and Space Context

The org name and space picker move from the old horizontal topbar into the sidebar header (visible in expanded state).

**Collapsed rail:** No org/space text visible -- the user sees this context when they hover/expand the sidebar.

**Expanded sidebar header:**
- Org name: Bold, white, 13px. Clickable only if user has 2+ tenants (opens org switcher dropdown).
- Space name: Below org name, `slate-500`, 11px, with dropdown indicator. Clicking opens the space picker.

**Space picker dropdown:** Lists all spaces the user has access to, with a "Create Space" option at the bottom. Same data as the current SpaceListComponent but rendered as a dropdown overlay rather than a full page.

**Navigating to the Spaces page:** Still accessible via Settings > Spaces in the sidebar for full space management (create, configure, delete).

## Notification Bell

Moves from the old topbar to the contextual topbar's right edge. Visible on all pages when a space is active. Same behavior as current implementation.

## Route Structure

Existing routes remain the same -- this is a layout/chrome change, not a routing change. The only new route is for the consolidated Taxonomies page:

| Current Route | New Route | Notes |
|--------------|-----------|-------|
| `manage/therapeutic-areas` | `settings/taxonomies?tab=therapeutic-areas` | Moved to settings, consolidated |
| `manage/mechanisms-of-action` | `settings/taxonomies?tab=moa` | Moved to settings, consolidated |
| `manage/routes-of-administration` | `settings/taxonomies?tab=roa` | Moved to settings, consolidated |
| `manage/marker-types` | `settings/marker-types` | Moved to settings, space-scoped |
| (tenant-level) `settings` | (unchanged) `/t/:tenantId/settings` | Stays tenant-level; sidebar links to it |
| (tenant-level) `spaces` | (unchanged) `/t/:tenantId/spaces` | Stays tenant-level; sidebar links to it |

All existing `manage/companies`, `manage/products`, `manage/trials` routes stay the same. All landscape routes stay the same. Events and catalysts routes stay the same.

Old routes should redirect to new routes for backward compatibility.

## Component Architecture

### New Components

- **`AppShellComponent`** -- New layout wrapper. Contains the icon rail, expandable sidebar, and topbar. Replaces the current `HeaderComponent` + bare `router-outlet` pattern in `AppComponent`.
- **`IconRailComponent`** -- The 48px vertical icon strip. Receives the active section as input. Emits hover/pin events.
- **`SidebarComponent`** -- The expandable 220px navigation panel. Manages expand/collapse/pin state. Contains the org/space picker header and the four nav sections.
- **`ContextualTopbarComponent`** -- The top bar. Receives page metadata (type, title, eyebrow, tabs, actions) and renders the appropriate layout.
- **`TaxonomiesPageComponent`** -- New consolidated page for Therapeutic Areas, MOA, ROA with segmented control.

### Modified Components

- **`AppComponent`** -- Simplified. Wraps `AppShellComponent` (when authenticated) or bare `router-outlet` (login/onboarding).
- **`HeaderComponent`** -- Removed. Its responsibilities split between `IconRailComponent`, `SidebarComponent`, and `ContextualTopbarComponent`.
- **`LandscapeShellComponent`** -- Simplified. View mode controls (Timeline/Bullseye/Positioning) move to the topbar and sidebar. Filter bar stays. Dimension/entity selectors move to sidebar (dimensions) and topbar (entity picker dropdown).
- **`ManagePageShellComponent`** -- Simplified or removed. Its eyebrow/title/action pattern moves into `ContextualTopbarComponent`.

### Removed Components

- **`TherapeuticAreaListComponent`** -- Absorbed into `TaxonomiesPageComponent`
- **`MechanismOfActionListComponent`** -- Absorbed into `TaxonomiesPageComponent`
- **`RouteOfAdministrationListComponent`** -- Absorbed into `TaxonomiesPageComponent`

## State Management

### Sidebar State

- **Pinned/collapsed:** Persisted in `localStorage` per user. Key: `clint-sidebar-pinned`. Default: `false` (collapsed).
- **Active section:** Derived from the current route. No separate state needed.
- **Bullseye expanded:** Derived from the current route (if route includes `bullseye/`, show dimension sub-items).

### Topbar State

- **Page metadata:** Each routed component provides its topbar configuration via a service or route data. Includes: page type (landscape | detail | list), eyebrow text, title, available actions, tabs (if landscape).

## Accessibility

- **Keyboard navigation:** Tab through rail icons, Enter/Space to activate. When sidebar is pinned, it's in the tab order. When it's a hover overlay, it's triggered by focusing the rail and pressing Enter.
- **ARIA landmarks:** Rail is `nav` with `aria-label="Main navigation"`. Sidebar is `complementary` when pinned. Topbar is `banner`.
- **Active states:** `aria-current="page"` on the active sidebar item.
- **Expand/collapse:** Sidebar toggle has `aria-expanded` and `aria-controls`.
- **Screen readers:** Section headers use `role="heading"` with `aria-level="2"`. Tooltip content is accessible via `aria-label` on the icon buttons.
- **Focus trapping:** Not needed -- sidebar is not a modal. Focus flows naturally.
- **Reduced motion:** Sidebar expand/collapse animation respects `prefers-reduced-motion`.

## Responsive Behavior

This spec targets desktop only (the primary use case for pharma executives using this alongside Bloomberg Terminal and similar tools). The sidebar and rail are not designed for mobile viewports. If mobile support is needed in the future, the sidebar would become a full-screen overlay triggered by a hamburger menu.

## Migration

The navigation redesign is a chrome-level change. Page content components (timeline, bullseye, tables, forms, detail panels) remain unchanged. The migration path:

1. Build the new shell components (rail, sidebar, topbar) alongside the existing header
2. Create the consolidated Taxonomies page
3. Update route configuration to use new shell and redirect old taxonomy/settings routes
4. Remove the old `HeaderComponent` and `ManagePageShellComponent`
5. Update `LandscapeShellComponent` to delegate view controls to the new topbar/sidebar

No data model changes. No API changes. No Supabase migration needed.
