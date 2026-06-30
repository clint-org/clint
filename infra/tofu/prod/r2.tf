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

# WS1 materials durability: 7-day in-account immutability. Objects cannot be
# deleted or overwritten for 604800s (7 days) after they are written. The clock
# starts at write; the lock is a floor on lifetime, not a ceiling. This blocks the
# drain's legitimate deletes during the window too, so the drain is made lock-aware
# (reschedules on error 10069) BEFORE this is applied (see rollout order).
resource "cloudflare_r2_bucket_lock" "materials" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.materials.name
  rules = [{
    id      = "materials-7day-immutability"
    enabled = true
    condition = {
      type            = "Age"
      max_age_seconds = 604800
    }
  }]
}

# clint-evidence holds public bug-resolution screenshots linked from GitHub
# issue comments. Read-only public access is via the Worker `/evidence/*` route
# (src/client/worker/evidence.ts), NOT a public bucket ACL.
resource "cloudflare_r2_bucket" "evidence" {
  account_id    = var.cloudflare_account_id
  name          = "clint-evidence"
  jurisdiction  = "default"
  location      = "ENAM"
  storage_class = "Standard"
}
