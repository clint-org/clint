# R2 Materials Storage Design

**Status:** Draft, awaiting user review.
**Date:** 2026-05-01
**Author:** Brainstorming session with Aaditya.

## Goal

Move the engagement materials registry off Supabase Storage and onto Cloudflare R2. Browser uploads and downloads use short-lived presigned R2 URLs minted by a new Cloudflare Worker. Authorization continues to live in Postgres via the existing RPCs and `has_space_access()`. The Worker is a thin URL signer with no access logic of its own.

The materials registry was deployed in `20260501115539_materials.sql`. This spec assumes a clean cutover (decision A in the brainstorming): existing Supabase Storage objects are throwaway test uploads. No backfill migration.

## Why

1. R2 has no egress fees. Materials are PPTX, PDF, and DOCX files of meaningful size that get downloaded repeatedly. Egress is the bulk of any object-storage bill at pharma scale.
2. R2 sits next to the Cloudflare Worker that already serves the SPA. Same edge, same TLS termination, same logs.
3. Decouples bytes from Supabase. Supabase remains the system of record for the row, the access policy, and the audit trail. R2 holds bytes only.
4. Forces a cleaner upload flow (register-first), which removes the existing repath dance and a category of partial-failure bugs.

## Out of scope

- Backfilling existing files. Clean cutover.
- Inline preview rendering inside the drawer. Same as v1.
- Per-tenant or per-space rate limits. Global per-user limits only.
- A janitor for orphan rows or orphan R2 keys. Acceptable cleanup gap for v1.
- Multipart uploads for very large files. Tenant size limits enforced today are well under R2's 5 GB single-PUT ceiling.

## Architecture

```
                Browser (SPA on *.clintapp.com)
                    │
                    ▼
        ┌─────────────────────────────────────┐
        │      Cloudflare Worker (clint)      │
        │                                     │
        │   /api/materials/sign-upload        │
        │   /api/materials/sign-download      │
        │   /*  ──►  static SPA assets        │
        └─────────────────────────────────────┘
              │                       │
              │ (RPC, JWT forwarded)  │ (R2 SDK, presign)
              ▼                       ▼
         Supabase Postgres        Cloudflare R2
         RLS + RPCs               bucket: clint-materials
                                  key: {space_id}/{material_id}/{file_name}
```

**One Worker, route-split.** Extend the existing `src/client/wrangler.jsonc` with a `main` entry. Requests to `/api/materials/*` hit the Worker handler. Everything else falls through to the existing assets binding.

**Authorization in Postgres.** The Worker forwards the user's Supabase JWT in the `Authorization` header to RPC calls. PostgREST sets `auth.uid()` and RLS context. The Worker never makes an access decision and holds no service role key.

**Presigned URLs only.** The Worker signs short-lived R2 URLs (5 min for PUT, 60 s for GET). Browser uploads and downloads bytes directly to and from R2. No proxying through the Worker.

## Components

### Worker (`src/client/worker/index.ts`)

A single TypeScript module. Exports a default fetch handler that routes by `URL.pathname`. Two POST endpoints:

**`POST /api/materials/sign-upload`**
- Body: `{ material_id: string }`.
- Decodes (does not verify) the JWT to extract `sub` for rate limiting.
- Calls `UPLOAD_LIMITER.limit({ key: \`upload:${sub ?? ip}\` })`. On miss, returns 429 with `Retry-After: 60`.
- Forwards the user's `Authorization` header to Supabase RPC `prepare_material_upload(material_id)`.
- RPC returns `{ space_id, material_id, file_name, mime_type }` or raises 42501 / P0002 / 22023.
- Worker constructs key `${space_id}/${material_id}/${file_name}`.
- Worker signs a 5-minute PUT URL using `@aws-sdk/s3-request-presigner` against the R2 S3-compatible endpoint.
- Returns `{ url, key }`.

**`POST /api/materials/sign-download`**
- Body: `{ material_id: string }`.
- Same rate-limit step using `DOWNLOAD_LIMITER`.
- Forwards JWT to existing RPC `download_material(material_id)`.
- RPC returns `{ space_id, material_id, file_path, file_name, mime_type }` or raises 42501 / P0002. Updated to also raise P0002 when `finalized_at IS NULL`.
- Worker signs a 60-second GET URL with `ResponseContentDisposition: attachment; filename="<file_name>"` and `ResponseContentType: <mime_type>`.
- Returns `{ url, file_name, mime_type }`.

**Error mapping:**

| Postgres SQLSTATE | HTTP | Body |
|---|---|---|
| `42501` | 403 | `{ "error": "forbidden" }` |
| `P0002` | 404 | `{ "error": "not_found" }` |
| `22023` | 422 | `{ "error": "<original message>" }` |
| (no JWT, 401 from PostgREST) | 401 | `{ "error": "unauthenticated" }` |
| Anything else | 500 | `{ "error": "internal" }` (original logged, not returned) |

**CORS:** `Access-Control-Allow-Origin` echoes the request `Origin` if it matches `*.clintapp.com` or the configured apex from `environment.apexDomain`. `Access-Control-Allow-Headers: Authorization, Content-Type`. `Access-Control-Allow-Methods: POST, OPTIONS`.

**Logging:** one structured line per request via `console.log(JSON.stringify({ ts, route, material_id, status, duration_ms, error? }))`. No file names, no JWTs, no PII beyond UUIDs.

### Frontend service (`src/client/src/app/core/services/material.service.ts`)

External shape of `MaterialService` is preserved. Three internal changes:

- `uploadFile(material_id, file)` replaces `uploadFile(path, file)`. Calls `POST /api/materials/sign-upload`, then `fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })`. No Supabase Storage SDK calls.
- `getDownloadUrl(material_id)` keeps its signature. Internally swaps `supabase.storage.createSignedUrl()` for `POST /api/materials/sign-download`.
- `repath()` and `updateFilePath()` are deleted.

A new `finalize(material_id)` method calls Supabase RPC `finalize_material(material_id)`.

A small shared helper `errorMessage(e)` handles `PostgrestError`, `Response`, and plain `Error` objects, fixing the existing bug where `e instanceof Error` returned false for Postgrest errors and callers fell through to a generic string.

### Upload-zone component (`material-upload-zone.component.ts`)

The `upload()` method changes order:

```
old: build temp path → upload → register → repath → updateFilePath → emit
new: register → upload (using returned material_id) → finalize → emit
```

Roughly half the code path in `upload()` goes away. The dialog state machine, validation, picker, and emit shape are unchanged.

### Database migration (`<ts>_materials_r2_cutover.sql`)

One migration file containing:

1. `alter table public.materials add column finalized_at timestamptz`. Null until finalized.
2. New RPC `prepare_material_upload(p_material_id uuid) returns jsonb`. Security definer, stable. Validates row exists, `uploaded_by = auth.uid()`, has editor access on `space_id`, `finalized_at is null`. Returns `{ space_id, material_id, file_name, mime_type }`.
3. New RPC `finalize_material(p_material_id uuid) returns void`. Security definer. Same access checks as `prepare_material_upload`. Sets `finalized_at = now()`.
4. Update `list_materials_for_space`, `list_materials_for_entity`, `list_recent_materials_for_space`, `download_material` to filter `where m.finalized_at is not null`.
5. Drop the four `storage.objects` policies for the `materials` bucket.
6. `delete from storage.buckets where id = 'materials'`. Clean cutover.

### Wrangler config (`src/client/wrangler.jsonc`)

Add a `main` entry pointing at `./worker/index.ts`. Add an `r2_buckets` binding `{ binding: "R2", bucket_name: "clint-materials" }`. Add a `ratelimits` array. Exact key names follow the current Workers Rate Limiting API binding schema (verify in implementation):

```jsonc
"ratelimits": [
  { "name": "UPLOAD_LIMITER",   "namespace_id": "<from CF dashboard>",
    "simple": { "limit": 30,  "period": 60 } },
  { "name": "DOWNLOAD_LIMITER", "namespace_id": "<from CF dashboard>",
    "simple": { "limit": 120, "period": 60 } }
]
```

Worker secrets, set via `wrangler secret put`:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCOUNT_ID`

R2 bucket-level CORS is configured via `wrangler r2 bucket cors put` to allow PUT and GET from the same origin set as the Worker CORS rules.

## Data flow

### Upload, happy path

```
1. User picks file, fills metadata, clicks Upload.

2. Browser → Supabase RPC: register_material(space_id, file_name, size, mime, type, title, links)
   - Validates editor access, size limit, mime allowlist.
   - Inserts row with finalized_at = NULL.
   - Returns material_id.

3. Browser → Worker: POST /api/materials/sign-upload  { material_id }
   - Worker rate-limits, forwards JWT to RPC prepare_material_upload(material_id).
   - RPC checks: row exists, uploaded_by = auth.uid(), editor access, finalized_at IS NULL.
   - RPC returns { space_id, material_id, file_name, mime_type }.
   - Worker signs 5-minute PUT URL for {space_id}/{material_id}/{file_name}.
   - Returns { url } to browser.

4. Browser → R2: PUT <signed url> with file body, Content-Type: <mime>.

5. Browser → Supabase RPC: finalize_material(material_id)
   - Sets finalized_at = now(). Row becomes visible to readers.

6. Upload zone emits `uploaded` event. Section reloads list.
```

### Upload, failure modes

| Step that fails | Result | Visible to other users? | Cleanup |
|---|---|---|---|
| 2 (register) | No row, no R2 object | No | None |
| 3 (sign-upload) | Row with finalized_at=NULL, no R2 object | No, list filters on finalized_at | Future janitor |
| 4 (PUT) | Same as above | No | Future janitor |
| 5 (finalize) | R2 object + row with finalized_at=NULL | No | Browser can retry finalize once with 1s backoff. After that, manual refresh and retry from list |

### Download, happy path

```
1. User clicks Download.

2. Browser → Worker: POST /api/materials/sign-download  { material_id }
   - Worker rate-limits, forwards JWT to RPC download_material(material_id).
   - RPC validates has_space_access AND finalized_at IS NOT NULL.
   - RPC returns { file_path, file_name, mime_type }.
   - Worker signs 60s GET URL with ResponseContentDisposition: attachment; filename=<file_name>.
   - Returns { url, file_name, mime_type }.

3. Browser navigates a transient <a download> to the signed URL. R2 streams the file.
```

## Auth carriage

`SupabaseService.client.auth.getSession()` returns the access token. A small helper in `MaterialService` reads it and includes `Authorization: Bearer <token>` on the two `/api/materials/*` calls. The Worker reads the header and forwards it on the Supabase RPC call. PostgREST sets `auth.uid()` from the JWT. RLS enforces the rest.

The Worker does not verify the JWT signature. Supabase does, on every RPC. The Worker only decodes the unverified JWT to extract `sub` for the rate-limit key. This is safe because rate limiting is spam control, not access control.

## Rate limiting

Workers Rate Limiting API, two namespaces, configured in `wrangler.jsonc`:

- `UPLOAD_LIMITER`: 30 requests per 60 s per key.
- `DOWNLOAD_LIMITER`: 120 requests per 60 s per key.

Key derivation per request:

```
const key = jwtSubject(authHeader) ?? request.headers.get('CF-Connecting-IP') ?? 'anon';
const { success } = await env.UPLOAD_LIMITER.limit({ key: `upload:${key}` });
```

On miss: 429 response with `Retry-After: 60` header and body `{ error: "rate_limited" }`.

Order in the request lifecycle:

```
1. CORS preflight (if applicable)
2. Rate limit check    ← cheap, no Supabase call
3. Forward JWT to Supabase RPC
4. Sign R2 URL
5. Respond
```

The check runs before the Supabase round-trip so a misbehaving client cannot hammer Postgres regardless of auth state.

`MaterialService` recognizes 429 and surfaces "Too many requests, try again in a minute" via existing `uploadError` and `downloadError` signals. No retry storm.

## Security boundaries

- R2 credentials live only in Worker secrets. Browser only ever sees presigned URLs scoped to a single key, single method, with TTL of 5 min for PUT and 60 s for GET.
- Authorization is centralized in Supabase RPCs and `has_space_access()`. The Worker is a transport for the JWT.
- Path tampering is blocked at signing. The Worker computes the R2 key from RPC return values, not from request body input.
- The R2 bucket is private with no public read. Every download is gated.
- CORS on the Worker echoes the request `Origin` only if it matches `*.clintapp.com` or the configured apex.
- The R2 bucket-level CORS rules mirror the Worker's allowed origins.

## Observability

Worker emits one structured log line per request to `console.log` (visible in `wrangler tail` and Logpush):

```
{ "ts": "...", "route": "sign-upload", "material_id": "<uuid>",
  "status": 200, "duration_ms": 42 }
```

No PII beyond UUIDs. No file names, no JWTs, no tenant identity (tenant is implicit in the Host header, already in Cloudflare's request log).

If durable analytics become useful later, add a Workers Analytics Engine binding without changing the contract.

## Testing strategy

- **Worker unit tests** using Miniflare or `wrangler unstable_dev` with a mocked Supabase fetch. Cover the SQLSTATE-to-HTTP mapping table and rate-limit responses.
- **Migration test** (pgTAP or a hand-rolled SQL test) that registers, prepares, finalizes, lists, downloads, deletes. Asserts a registered-but-not-finalized row is invisible to all four list RPCs and to `download_material`.
- **Manual e2e** on a preview deploy: drop a PDF on a trial detail, refresh, see it; download it; delete it; confirm R2 object is gone.

## Migration steps (rough, finalized in implementation plan)

1. Land the database migration (adds `finalized_at`, new RPCs, drops the storage bucket and policies).
2. Land the Worker, wrangler config, R2 bucket, secrets, and CORS rules. Worker is deployed but unused.
3. Land the frontend changes behind no flag. The two paths flip together.
4. Drop `repath` and `updateFilePath` from `MaterialService`.
5. Verify on a preview deploy. Promote.

The bug visible today on the trial detail page (`Could not load materials` from `list_materials_for_entity`) is fixed as part of step 3 via the `errorMessage()` helper. The underlying RPC failure is captured in implementation, not in this spec.

## Open questions

None at the design level. Implementation-time questions (exact Miniflare test harness shape, exact `wrangler.jsonc` schema for `ratelimits`, R2 bucket name) belong in the plan.
