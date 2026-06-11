# R2 buckets.
#
# clint-db-backups holds the off-site, age-encrypted database backups (see
# docs/runbook/13-backup-and-restore.md). Imported into management in WS3 Phase A.
# location ENAM = Eastern North America; Standard storage; default jurisdiction.
resource "cloudflare_r2_bucket" "db_backups" {
  account_id    = var.cloudflare_account_id
  name          = "clint-db-backups"
  jurisdiction  = "default"
  location      = "ENAM"
  storage_class = "Standard"
}
