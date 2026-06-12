# R2 buckets (prod).
#
# clint-materials holds tenant-uploaded materials (the documents surfaced in the
# app). It is the prod counterpart of clint-materials-dev (dev root). Imported into
# management in WS3 Phase C. location ENAM = Eastern North America; Standard storage;
# default jurisdiction.
#
# Note: versioning / Object Lock hardening for this bucket is WS1 (materials
# durability); codifying the bucket here is the foundation that work builds on.
resource "cloudflare_r2_bucket" "materials" {
  account_id    = var.cloudflare_account_id
  name          = "clint-materials"
  jurisdiction  = "default"
  location      = "ENAM"
  storage_class = "Standard"
}
