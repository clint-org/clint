# The Cloudflare provider authenticates with an API token it reads from the
# CLOUDFLARE_API_TOKEN environment variable. The token is never written to a file
# or committed; it lives only in your shell now (via infra/tofu/.env.local), and
# moves into Infisical in WS4.
provider "cloudflare" {}
