-- migration: 20260501115540_tenant_material_settings
-- purpose: per-tenant configurable upload limits for the materials registry.
--          register_material reads these to validate file size and mime type.

alter table public.tenants
  add column if not exists material_max_size_bytes bigint not null
    default 52428800,                                    -- 50 MB default
  add column if not exists material_allowed_mime_types text[] not null
    default array[
      -- .pptx
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      -- .pdf
      'application/pdf',
      -- .docx
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

comment on column public.tenants.material_max_size_bytes is
  'Per-tenant maximum file size (bytes) for engagement materials. '
  'register_material rejects files larger than this. Default 50 MB.';

comment on column public.tenants.material_allowed_mime_types is
  'Per-tenant allowlist of mime types accepted by register_material. '
  'Defaults to PPTX / PDF / DOCX.';
