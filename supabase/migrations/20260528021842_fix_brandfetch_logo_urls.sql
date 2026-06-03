-- Fix Brandfetch logo URLs: the old format (cdn.brandfetch.io/domain/xxx.com)
-- no longer works. The Logo Link format is cdn.brandfetch.io/{domain}/logo.
-- The ?c= client ID is appended at render time by the Angular pipe.

-- 1. Fix "domain/xxx.com" format -> "xxx.com/logo"
UPDATE companies
SET logo_url = 'https://cdn.brandfetch.io/' ||
  regexp_replace(
    regexp_replace(logo_url, '\?.*$', ''),
    '^https://cdn\.brandfetch\.io/domain/', ''
  ) || '/logo'
WHERE logo_url LIKE 'https://cdn.brandfetch.io/domain/%';

-- 2. Strip query params from old id-based format (e.g. idXXX/theme/dark/logo.svg?c=...&t=...)
-- The pipe will re-add ?c= with the current valid client ID.
UPDATE companies
SET logo_url = regexp_replace(logo_url, '\?.*$', '')
WHERE logo_url LIKE 'https://cdn.brandfetch.io/id%'
  AND logo_url LIKE '%?%';

-- 3. Same fixes for tenants table
UPDATE tenants
SET logo_url = 'https://cdn.brandfetch.io/' ||
  regexp_replace(
    regexp_replace(logo_url, '\?.*$', ''),
    '^https://cdn\.brandfetch\.io/domain/', ''
  ) || '/logo'
WHERE logo_url LIKE 'https://cdn.brandfetch.io/domain/%';

UPDATE tenants
SET logo_url = regexp_replace(logo_url, '\?.*$', '')
WHERE logo_url LIKE 'https://cdn.brandfetch.io/id%'
  AND logo_url LIKE '%?%';

-- 4. Same fixes for agencies table
UPDATE agencies
SET logo_url = 'https://cdn.brandfetch.io/' ||
  regexp_replace(
    regexp_replace(logo_url, '\?.*$', ''),
    '^https://cdn\.brandfetch\.io/domain/', ''
  ) || '/logo'
WHERE logo_url LIKE 'https://cdn.brandfetch.io/domain/%';

UPDATE agencies
SET logo_url = regexp_replace(logo_url, '\?.*$', '')
WHERE logo_url LIKE 'https://cdn.brandfetch.io/id%'
  AND logo_url LIKE '%?%';
