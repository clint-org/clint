# Motivation

[Back to index](README.md)

---

## The Problem

Pharmaceutical BD teams and executives track competitive clinical trial landscapes using manually maintained PowerPoint slides. This approach has fundamental limitations:

- **Stale data** -- slides are only as current as the last manual update
- **No collaboration** -- multiple teams maintain separate versions
- **Poor interactivity** -- no filtering, zooming, or drill-down
- **Limited scalability** -- adding companies or trials requires slide redesign
- **No audit trail** -- changes are invisible and untracked

## The Solution

Clint provides a purpose-built web application that mirrors the familiar visual language of the PowerPoint format (timeline grid, phase bars, event markers) while adding:

- Real-time collaborative data management
- Flexible filtering and zoom
- Multi-tenant isolation so different organizations each have their own data
- PowerPoint export for stakeholders who still need slides

## Design Principles

The product follows **Clinical Precision** as its core design personality -- inspired by medical journals and regulatory documents. The UI prioritizes:

- **Visual parsability** over decoration -- data density without noise
- **Markers pop** -- the events executives scan for are the primary visual element
- **Phase bars as backdrop** -- subtle context, not the focus
- **Teal + Slate palette** -- clinical and precise, not generic

See [docs/brand.md](../brand.md) for the full brand guide.
