-- Add logo_url column to tenants table for organization branding
ALTER TABLE tenants ADD COLUMN logo_url text;

-- Create storage bucket for tenant logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: tenant owners can manage logos
CREATE POLICY "Tenant owners can manage logos"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text FROM tenants t
      JOIN tenant_members tm ON tm.tenant_id = t.id
      WHERE tm.user_id = auth.uid() AND tm.role = 'owner'
    )
  );

-- RLS: tenant members can read logos
CREATE POLICY "Tenant members can read logos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT t.id::text FROM tenants t
      JOIN tenant_members tm ON tm.tenant_id = t.id
      WHERE tm.user_id = auth.uid()
    )
  );
