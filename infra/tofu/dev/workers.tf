# Dev clint-dev Worker edge config: routes only (dev has no custom domains).
#
# The Worker *script* and its bindings (rate limiters, R2 binding, vars) are owned by
# wrangler (src/client/wrangler.jsonc `env.dev`, deployed via `wrangler deploy --env
# dev`) and are deliberately NOT managed here. OpenTofu owns only the dashboard-manual
# routes that wrangler does not declare.
#
# The clintapp.com zone is managed in the shared/ root (a separate state), so its id
# is referenced here as a documented constant rather than a cross-root resource link.
locals {
  clintapp_zone_id = "9d0444974192729e0cf0301633d7f0b5" # clintapp.com, managed in infra/tofu/shared
}

# Routes sending the dev hostnames to the clint-dev Worker. The wildcard pairs with
# the *.dev.clintapp.com proxied placeholder DNS record (shared/dns.tf).
resource "cloudflare_workers_route" "dev" {
  zone_id = local.clintapp_zone_id
  pattern = "dev.clintapp.com/*"
  script  = "clint-dev"
}

resource "cloudflare_workers_route" "dev_wildcard" {
  zone_id = local.clintapp_zone_id
  pattern = "*.dev.clintapp.com/*"
  script  = "clint-dev"
}
