# Org and Space Settings UX

## Summary

Redesign the settings navigation so users can clearly manage organizations (name, logo, members) and spaces (name, description, members) through contextual entry points and a unified sidebar settings section. Wire up backend capabilities that exist but have no UI (rename, delete, member management at both levels).

## Decisions

| Question | Decision |
|----------|----------|
| Org settings scope | Minimal: name, logo, member management |
| Space settings scope | Minimal: name, description, members, delete |
| Org dropdown behavior | Lists orgs + "Organization settings" link at bottom |
| Space dropdown behavior | Lists spaces + "Space settings" + "New space" links at bottom |
| Settings location | Sidebar Settings section = unified space config; org settings via dropdown only |
| System admin | Out of scope for this spec |

## 1. Org Dropdown Enhancement

### Current behavior
- Lists tenants the user belongs to (only if 2+ tenants)
- Selecting a tenant navigates to `/t/{tenantId}/spaces`

### New behavior
- Always clickable (even with 1 tenant) for access to org settings
- If 2+ tenants: lists all tenants with active one highlighted, plus "Organization settings" link
- If 1 tenant: dropdown shows only the "Organization settings" link (no list since there's nothing to switch to)
- Footer section with "Organization settings" link
- Selecting "Organization settings" navigates to `/t/{tenantId}/settings`
- Selecting another tenant navigates to `/t/{tenantId}/spaces`

### Files affected
- `src/client/src/app/core/layout/contextual-topbar.component.ts` -- update org dropdown to always be interactive and add settings link

## 2. Space Dropdown Enhancement

### Current behavior
- Lists spaces in the current tenant
- Selecting a space navigates to `/t/{tenantId}/s/{spaceId}`

### New behavior
- Lists spaces with active one highlighted
- Footer section with two links:
  - "Space settings" -- navigates to `/t/{tenantId}/s/{spaceId}/settings/general`
  - "New space" -- closes the dropdown and opens a modal dialog (reusing the existing create space dialog pattern from `SpaceListComponent`)

### Files affected
- `src/client/src/app/core/layout/contextual-topbar.component.ts` -- add footer links to space dropdown
- `src/client/src/app/core/layout/app-shell.component.ts` -- handle "New space" action, add create space dialog

## 3. Sidebar Settings Section Redesign

### Current items
- Taxonomies (space-level data config)
- Marker Types (space-level data config)
- Organization (tenant-level -- navigates to `/t/{tenantId}/settings`)
- Spaces (tenant-level -- navigates to `/t/{tenantId}/spaces`)

### New items
- **General** -- space name, description, danger zone (delete space)
- **Members** -- space member list, invite, role management (owner/editor/viewer), remove
- **Taxonomies** -- existing page, unchanged
- **Marker Types** -- existing page, unchanged

"Organization" and "Spaces" items are removed from the sidebar. Org settings are accessed only via the org dropdown. The spaces list is accessed by clicking the space dropdown in the topbar.

### Routes

| Sidebar item | Route | Page |
|--------------|-------|------|
| General | `/t/{tenantId}/s/{spaceId}/settings/general` | SpaceGeneralSettingsComponent (new) |
| Members | `/t/{tenantId}/s/{spaceId}/settings/members` | SpaceMembersComponent (new) |
| Taxonomies | `/t/{tenantId}/s/{spaceId}/settings/taxonomies` | TaxonomiesPageComponent (existing) |
| Marker Types | `/t/{tenantId}/s/{spaceId}/settings/marker-types` | MarkerTypeListComponent (existing) |

### Files affected
- `src/client/src/app/core/layout/sidebar.component.ts` -- update `NAV_SECTIONS` settings items, remove Organization and Spaces items
- `src/client/src/app/app.routes.ts` -- add new settings routes
- Create: `src/client/src/app/features/space-settings/space-general.component.ts`
- Create: `src/client/src/app/features/space-settings/space-members.component.ts`

## 4. Space General Settings Page (new)

### Route
`/t/{tenantId}/s/{spaceId}/settings/general`

### Content
- **Space name** -- editable text input, save on blur or button
- **Description** -- editable textarea, save on blur or button
- **Danger zone** -- delete space button with confirmation dialog

### Behavior
- Only space owners and tenant owners can edit name/description
- Delete requires confirmation (type space name to confirm)
- After delete, navigate to `/t/{tenantId}/spaces`
- Uses `SpaceService.updateSpace()` and `SpaceService.deleteSpace()`

### Files affected
- Create: `src/client/src/app/features/space-settings/space-general.component.ts`

## 5. Space Members Page (new)

### Route
`/t/{tenantId}/s/{spaceId}/settings/members`

### Content
- **Member list** -- table showing email, display name, role (owner/editor/viewer), join date
- **Role management** -- dropdown to change role (owner/editor/viewer) per member
- **Remove member** -- action to remove a member from the space
- **Invite/add member** -- button to add existing org members to the space with a role. Only org members can be added to spaces (they must be invited to the org first).

### Behavior
- Only space owners and tenant owners can manage members
- Cannot remove the last owner
- Uses `SpaceService.listMembers()`, `SpaceService.addMember()`, `SpaceService.updateMemberRole()`, `SpaceService.removeMember()`

### Files affected
- Create: `src/client/src/app/features/space-settings/space-members.component.ts`

## 6. Organization Settings Page Redesign

### Route
`/t/{tenantId}/settings` (existing route, redesigned page)

### Current content
- Member list with remove action
- Invite section with pending invites table
- Invite dialog (email + role)

### New content
- **Org identity section** -- name (editable), logo (upload/remove)
- **Members section** -- member list with role display, role change dropdown (owner/member), remove action
- **Invite section** -- invite button, pending invites with expiry and code

### Logo handling
- Upload via Supabase Storage (new bucket: `tenant-logos`)
- Accept PNG/JPG/SVG, max 2MB
- Store URL in `tenants.logo_url` column (new migration)
- Display in org dropdown badge (replace the initial letter with the logo image)
- Display on the org settings page

### Files affected
- `src/client/src/app/features/tenant-settings/tenant-settings.component.ts` -- redesign to add name editing, logo upload, role management
- `src/client/src/app/core/services/tenant.service.ts` -- add `updateTenant()` for name changes, logo upload methods
- `src/client/src/app/core/layout/contextual-topbar.component.ts` -- display logo in org badge when available

## 7. Database Changes

### New migration: add logo_url to tenants

```sql
ALTER TABLE tenants ADD COLUMN logo_url text;
```

### Supabase Storage bucket

Create a `tenant-logos` storage bucket with RLS policies:
- Tenant owners can upload/delete logos
- Tenant members can read logos

## 8. Navigation Changes Summary

### Sidebar `NAV_SECTIONS` update

Current settings section:
```
Settings: [Taxonomies, Marker Types, Organization, Spaces]
```

New settings section:
```
Settings: [General, Members, Taxonomies, Marker Types]
```

### `AppShellComponent` routing changes

Remove special-case routing for `settings/organization` and `settings/spaces` -- these no longer appear in the sidebar. The org dropdown handles navigation to org settings directly.

Add route handling for `settings/general` and `settings/members` as space-scoped routes.

### Topbar title mapping update

Add to the title map:
```typescript
'settings/general': 'General',
'settings/members': 'Members',
```

## Component Impact Summary

| Component | Change |
|-----------|--------|
| `ContextualTopbarComponent` | Add settings + new space links to dropdowns, show logo in org badge |
| `SidebarComponent` | Update settings nav items (General, Members replace Organization, Spaces) |
| `AppShellComponent` | Remove org/spaces special routing, handle create space action |
| `TenantSettingsComponent` | Redesign with name editing, logo upload, role management |
| `SpaceGeneralComponent` | New: space name, description, delete |
| `SpaceMembersComponent` | New: space member list, roles, add/remove |
| `TenantService` | Add logo upload methods |
| `app.routes.ts` | Add settings/general and settings/members routes |

## Out of Scope

- System admin view (all orgs, all users)
- Billing/subscription management
- Audit logs
- Space archiving or duplication
- Bulk member operations
- Auto-provisioning changes (still creates default org/space for dev)
