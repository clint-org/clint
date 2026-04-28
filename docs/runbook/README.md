# Clint -- Clinical Trial Status Dashboard

> A comprehensive reference for developers, Claude, and end users.

**Clint** is a web-based clinical trial status dashboard built for pharmaceutical executives and business development teams. It provides a structured, interactive timeline view of drug development pipelines -- organized by company, product, and therapeutic area -- with configurable zoom levels, event markers, and filtering capabilities.

The dashboard replaces static PowerPoint-based tracking workflows with a live, collaborative, data-driven application that supports multiple organizations and teams.

---

## Documentation Index

### Product

| Document | Description |
|---|---|
| [Motivation](01-motivation.md) | The problem we solve and our design principles |
| [Tech Stack](02-tech-stack.md) | Technologies, versions, and rationale for each choice |
| [Features](03-features.md) | Complete feature inventory with details |

### Architecture

| Document | Description |
|---|---|
| [Architecture Overview](04-architecture-overview.md) | System-level diagram and data flow |
| [Frontend Architecture](05-frontend-architecture.md) | Angular project structure, services, components, models |
| [Backend Architecture](06-backend-architecture.md) | Supabase services, RPC functions, views |
| [Database Schema](07-database-schema.md) | Tables, migrations, indexes, seed data |
| [Authentication & Security](08-authentication-security.md) | OAuth flow, RLS policies, route guards |
| [Multi-Tenant Model](09-multi-tenant-model.md) | Tenants, spaces, roles, onboarding flow |

### Guides

| Document | Description |
|---|---|
| [User Guide](10-user-guide.md) | End-user instructions for all features |
| [Developer Guide](11-developer-guide.md) | Local setup, conventions, adding features |
| [Deployment](12-deployment.md) | Cloudflare Workers config, environment variables, schema deployment |

---

*Last updated: 2026-04-27*
