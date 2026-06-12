# Inputs to the config. account_id identifies which Cloudflare account owns the
# resources. It is not a secret, but it is account-identifying, so we pass it in
# (via the TF_VAR_cloudflare_account_id env var) rather than hard-coding it.
variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID that owns the Clint resources."
}
