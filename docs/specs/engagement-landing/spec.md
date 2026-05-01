# Engagement landing page

## Goal

Replace the timeline as the default page users land on when they click into a space. Make the engagement landing the home surface for both agency and client members. The timeline becomes a tab in the navigation.

This unifies the "single source of truth" pitch with what users actually see when they sign in.

Reference sketch: `src/client/public/internal/engagement-landing.html`

## Scope

In v1:
- New default route for `/t/:tenant/s/:space` rendering the engagement landing.
- Timeline moves to `/t/:tenant/s/:space/timeline` (still accessible, just no longer the default).
- Latest from Stout feed (recently published primary intelligence).
- Recent materials feed (placeholder if materials registry hasn't shipped yet).
- Your drafts widget (agency-only).
- Next 14 days catalysts widget.
- Engagement context strip with live stats.
- Onboarding tooltip on first post-deploy login pointing existing users to the new Timeline tab.

Out of scope (deferred to v2):
- Personalized "Catching up since you were last here" banner.
- Per-section configuration (let users hide widgets).
- Dashboard-style customizable layout.

## Routing

Current behavior: clicking a space routes to the timeline (effectively `/t/:tenant/s/:space/timeline` or whatever the existing root maps to).

New behavior:
- `/t/:tenant/s/:space` -> `EngagementLandingComponent` (new)
- `/t/:tenant/s/:space/timeline` -> existing timeline component (unchanged, just no longer the index)
- All existing sub-routes (bullseye, catalysts, materials, companies) keep their paths.

Implementation: add a new route entry in the space-scoped router config. The existing timeline route stays. Bookmarks to the timeline keep working.

## Page composition

### Top app bar
- Whitelabel brand on the left (already exists from the brand context fetch).
- Workspace name next to the brand.
- Nav tabs: Home (active), Timeline, Bullseye, Future Catalysts, Materials, Companies.
- Stout attribution mono label on the right (existing pattern).
- User menu on the right.

The "Future Catalysts" label replaces the existing "Catalysts" tab label per the locked terminology decision.

### Engagement context strip
Below the top bar.
- Engagement title (space name)
- Sub-line: "Engagement | active since YYYY-Q#"
- Five stats: active trials, companies, programs, catalysts in next 90 days, total primary intelligence pieces

The stats come from a new RPC `get_space_landing_stats(p_space_id)` that returns these counts in one call.

### Main column

**Latest from Stout (recent published primary intelligence).**
Renders `<app-intelligence-feed>` (per the primary intelligence spec) with `state='published'`, recency-ordered, limit 5. "View feed" link routes to `/t/:tenant/s/:space/intelligence` (the filterable browse view).

Each card shows the marker icon (with halo if applicable), type pills, breadcrumb (which entity the read is anchored to), headline, excerpt of the thesis, change-note if recent, attached-material indicator, "Read" link.

**Recent materials.**
List of recently registered materials in the engagement, recency-ordered, limit 5. "All materials" link routes to `/t/:tenant/s/:space/materials`.

If the materials registry hasn't shipped yet, render an empty-state placeholder with a "Coming soon" or omit the section entirely (feature-flag).

### Side rail

**Your drafts (agency-only).**
Renders only when the viewer is an agency member. Shows up to 3 in-progress drafts authored by anyone in the agency on this engagement. Each row shows title, target entity (with breadcrumb), author initials, last-edited stamp. "All drafts" link routes to a filterable drafts list.

**Next 14 days catalysts.**
Up to 5 upcoming markers in clinical / regulatory / approval / data categories with dates within 14 days. Each row shows date pill, headline, breadcrumb, status note (e.g., "DSMB statement pending" if active). "All catalysts" link routes to `/t/:tenant/s/:space/timeline/catalysts` or whatever the existing Future Catalysts route is.

## Data

### New RPCs

```sql
create function get_space_landing_stats(p_space_id uuid)
returns jsonb
security definer
language sql stable as $$
  select jsonb_build_object(
    'active_trials',     (select count(*) from trials where space_id = p_space_id and status not in ('completed','withdrawn')),
    'companies',         (select count(distinct company_id) from products where space_id = p_space_id),
    'programs',          (select count(*) from products where space_id = p_space_id),
    'catalysts_90d',     (select count(*) from markers where space_id = p_space_id and event_date between now() and now() + interval '90 days'),
    'intelligence_total',(select count(*) from primary_intelligence where space_id = p_space_id and state = 'published')
  );
$$;
```

(Schema names approximate; adjust to actual table column names. `status` column on trials may not exist; use whatever proxy makes sense.)

### Existing data

- **Latest from Stout** uses `list_primary_intelligence` from the primary intelligence spec.
- **Recent materials** uses `list_materials` from the materials registry spec (priority 4). Optional in v1.
- **Your drafts** uses `list_primary_intelligence` with `state='draft'` filter, scoped to the calling user's agency.
- **Next 14 days catalysts** uses the existing markers query with date filter; reuse whatever the current Future Catalysts feed uses.

## Frontend

### New files

```
src/client/src/app/features/engagement-landing/
  engagement-landing.component.ts         (page component, renders the layout)
  engagement-landing.component.html
  context-strip/
    context-strip.component.ts            (engagement title + stats)
  drafts-widget/
    drafts-widget.component.ts            (agency-only side rail card)
  upcoming-catalysts-widget/
    upcoming-catalysts-widget.component.ts(side rail card)
  recent-materials-widget/
    recent-materials-widget.component.ts  (main column section, placeholder if materials registry not yet shipped)
```

`<app-intelligence-feed>` is already specced in the primary intelligence spec; engagement landing reuses it directly.

### Modified files

```
src/client/src/app/app.routes.ts           (or wherever space-scoped routes are configured)
src/client/src/app/core/auth/...           (post-login redirect target; if it currently goes to /timeline, change to space root)
```

### Routing change details

In the space-scoped router config, add the new index route before the timeline route:

```ts
// space-scoped routes
{
  path: '',
  pathMatch: 'full',
  loadComponent: () => import('./features/engagement-landing/engagement-landing.component').then(m => m.EngagementLandingComponent),
},
{
  path: 'timeline',
  loadComponent: () => import('./features/dashboard/...').then(m => m.TimelineComponent),
},
// ...other existing routes
```

If post-login redirects currently target `/timeline`, change them to the space root.

### Onboarding tooltip

On first post-deploy login, show a one-time tooltip on the Timeline tab in the top nav: "Your timeline is now under the Timeline tab." Dismiss on click; persist dismissal in localStorage with a key like `clint.engagement-landing.onboarding-tooltip-seen`.

Implementation: a small directive or component that reads the flag from localStorage on app init, shows the tooltip if absent, sets it on dismiss. Cheap, no backend required.

## Migration plan

1. Build the new `EngagementLandingComponent` and child widgets.
2. Wire it as the index route under the space-scoped router.
3. Update post-login redirects.
4. Add the onboarding tooltip.
5. Smoke test: agency login lands on engagement landing; client login lands on engagement landing; existing bookmarks to `/timeline` still work.
6. Deploy. Cloudflare auto-deploys on push to main.

This change is order-dependent on primary intelligence (priority 5 from the index): the Latest from Stout feed needs `<app-intelligence-feed>` to exist. Engagement landing can ship in two phases:
- **Phase 1** (before primary intelligence): engagement landing exists at the space root, but Latest from Stout is empty / placeholder. Recent materials, Your drafts, Upcoming catalysts, context strip all still work using existing data (markers, etc.). Achieves the routing change.
- **Phase 2** (after primary intelligence): wire up the Latest from Stout feed and Recent materials feed.

If you want the routing change shipped first, Phase 1 is a single PR that doesn't depend on the primary intelligence work.

## Test plan

1. **Default route.** Sign in as agency, click into a space: lands on engagement landing.
2. **Default route, client.** Sign in as client (tenant member), click into a space: lands on engagement landing.
3. **Timeline still accessible.** Click Timeline tab from engagement landing: routes to `/t/:tenant/s/:space/timeline` and renders the timeline.
4. **Bookmarks.** Direct visit to `/t/:tenant/s/:space/timeline` works.
5. **Onboarding tooltip.** First load shows tooltip on Timeline tab. Dismiss. Reload: tooltip does not reappear.
6. **Whitelabel.** On a Pfizer subdomain, top bar shows Pfizer brand and Pfizer-blue active tab indicator.
7. **Stats.** Engagement context strip shows accurate counts for active trials, companies, programs, catalysts in next 90 days, and total primary intelligence.
8. **Latest from Stout.** Shows up to 5 most recent published primary intelligence pieces. Click "View feed": routes to the browse view.
9. **Your drafts.** Visible to agency only. Hidden from client tenant members.
10. **Next 14 days.** Shows upcoming catalysts within 14 days. Empty state if none.
11. **Recent materials.** When materials registry ships, shows recent items. Empty-state or hidden in v1 if not yet shipped.
12. **Lint and build.** `cd src/client && ng lint && ng build` passes.

## Branch

`feat/engagement-landing`. One PR if shipping Phase 1 only (routing change + skeleton page + non-intelligence widgets). Two PRs if shipping the full landing including Latest from Stout, paired with the primary intelligence rollout.

Estimated diff: ~600 lines for Phase 1, plus ~200 lines when wiring Phase 2 in.

## Open questions

- Stats: which exact fields and counts? The five in the sketch (active trials, companies, programs, catalysts in next 90 days, intelligence total) are a starting point. Confirm or trim.
- Recent materials section: hide entirely until materials registry ships, or render an empty-state with "Coming soon"? Probably hide.
- Default for users with no agency membership but tenant membership: same engagement landing? (Yes; the design is uniform across roles, only Your drafts is hidden for non-agency.)
- Mobile layout: the sketch is desktop-first. Mobile fallback collapses to single column with the side rail content stacked below. Confirm before build.
