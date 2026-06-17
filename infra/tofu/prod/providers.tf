# The Cloudflare provider authenticates with an API token it reads from the
# CLOUDFLARE_API_TOKEN environment variable. The token is never written to a file
# or committed; it lives only in your shell now (via infra/tofu/.env.local), and
# moves into Infisical in WS4.
provider "cloudflare" {}

# The Supabase provider authenticates with a Supabase management access token it
# reads from the SUPABASE_ACCESS_TOKEN environment variable, injected at runtime
# from Infisical (shared/iac). The token is account-scoped, so config must target
# only the clint (prod) project ref. Never committed to a file.
provider "supabase" {}
