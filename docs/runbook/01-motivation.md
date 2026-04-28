# Motivation

[Back to index](README.md)

---

## Positioning

**Competitive intelligence for pharma.** The product spans the four cuts that pharma CI professionals work in daily: pipeline intelligence, catalyst tracking, clinical trial timelines, and portfolio analysis. The buyer audiences are business development, strategy, portfolio, licensing, and executive leadership teams -- and the dedicated competitive intelligence function that supports them.

## The Problem

Pharmaceutical competitive intelligence, business development, and strategy teams track competitor pipelines, clinical trials, and catalysts using manually maintained PowerPoint slides and ad-hoc spreadsheets. This approach has fundamental limitations:

- **Stale data** -- slides are only as current as the last manual update
- **No collaboration** -- multiple teams maintain separate versions
- **Poor interactivity** -- no filtering, zooming, or drill-down
- **Limited scalability** -- adding companies or trials requires slide redesign
- **No audit trail** -- changes are invisible and untracked

## The Solution

Clint provides a purpose-built web application that mirrors the familiar visual language of the PowerPoint format (timeline grid, phase bars, event markers, bullseye competitive views) while adding:

- Real-time collaborative pipeline + catalyst + trial management
- Flexible filtering, zoom, and competitive cuts (by therapy area, mechanism of action, route of administration)
- Multi-tenant isolation so different organizations each have their own data
- PowerPoint export for stakeholders who still need slides

## Sales Motions

The product is sold along two paths, both supported by the same codebase:

- **Direct (apex domain).** Pharma teams sign up at `yourproduct.com`, create their own tenant, and use Clint as a stand-alone tool.
- **Whitelabel via consulting partner.** Consulting firms (the buyer) resell Clint to their pharma clients (the end user) under the consulting firm's brand. Each pharma client lives on its own subdomain (`pfizer.yourproduct.com` or, on a sales-led upgrade, `competitive.pfizer.com`) with its own logo, color, login screen, invite emails, and PPT exports. Consulting firms self-serve provision new pharma client tenants from an agency portal at their own subdomain. See [Multi-Tenant Model](09-multi-tenant-model.md) for the agency / tenant / space hierarchy.

## Design Principles

The product follows **Clinical Precision** as its core design personality -- inspired by medical journals and regulatory documents. The UI prioritizes:

- **Visual parsability** over decoration -- data density without noise
- **Markers pop** -- the events executives scan for are the primary visual element
- **Phase bars as backdrop** -- subtle context, not the focus
- **Teal + Slate palette** -- clinical and precise, not generic

See [docs/brand.md](../brand.md) for the full brand guide.
