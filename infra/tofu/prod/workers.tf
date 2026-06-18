# Prod clint Worker edge config: custom domains + route.
#
# The Worker *script* and its bindings (rate limiters, R2 binding, vars, cron) are
# owned by wrangler (src/client/wrangler.jsonc, deployed via GitHub Actions) and are
# deliberately NOT managed here, to avoid two tools fighting over one resource. What
# OpenTofu owns is the edge config that wrangler does not declare and that was
# previously dashboard-manual: the custom domains and the tenant-wildcard route.
#
# The clintapp.com zone is managed in the shared/ root (a separate state), so its id
# is referenced here as a documented constant rather than a cross-root resource link.
locals {
  clintapp_zone_id = "9d0444974192729e0cf0301633d7f0b5" # clintapp.com, managed in infra/tofu/shared
}

# Custom domains route apex + www directly to the clint Worker (Cloudflare manages
# the DNS record + TLS cert for each).
resource "cloudflare_workers_custom_domain" "apex" {
  account_id = var.cloudflare_account_id
  hostname   = "clintapp.com"
  service    = "clint"
  zone_id    = local.clintapp_zone_id
  zone_name  = "clintapp.com"
}

resource "cloudflare_workers_custom_domain" "www" {
  account_id = var.cloudflare_account_id
  hostname   = "www.clintapp.com"
  service    = "clint"
  zone_id    = local.clintapp_zone_id
  zone_name  = "clintapp.com"
}

# Route catching every tenant subdomain (*.clintapp.com) for the clint Worker.
# Pairs with the *.clintapp.com proxied placeholder DNS record (shared/dns.tf) that
# makes those hostnames resolve so this route can catch them.
resource "cloudflare_workers_route" "tenant_wildcard" {
  zone_id = local.clintapp_zone_id
  pattern = "*.clintapp.com/*"
  script  = "clint"
}
