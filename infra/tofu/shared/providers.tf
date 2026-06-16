# The Cloudflare provider authenticates with an API token it reads from the
# CLOUDFLARE_API_TOKEN environment variable. The token is never written to a file
# or committed; it lives only in your shell now, and moves into Infisical in WS4.
provider "cloudflare" {}

# The B2 provider authenticates with a Backblaze application key it reads from the
# B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY environment variables. This is a
# dedicated read+write management key scoped to clint-db-backups, distinct from the
# write-only key the backup pipeline uses. Never committed; lives only in your shell
# (via infra/tofu/.env.local), and moves into Infisical in WS4.
provider "b2" {}
