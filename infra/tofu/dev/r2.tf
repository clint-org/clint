# R2 buckets (dev).
#
# clint-materials-dev holds tenant-uploaded materials for the dev environment, the
# dev counterpart of clint-materials (prod root). Imported into management in WS3
# Phase C. location ENAM = Eastern North America; Standard storage; default
# jurisdiction.
resource "cloudflare_r2_bucket" "materials_dev" {
  account_id    = var.cloudflare_account_id
  name          = "clint-materials-dev"
  jurisdiction  = "default"
  location      = "ENAM"
  storage_class = "Standard"
}
