# Backblaze B2 bucket: the cross-cloud (off-Cloudflare) copy of the encrypted DB
# backups. Mirrors the R2 clint-db-backups bucket (see r2.tf); B2 is the only backup
# copy that survives a total Cloudflare account loss (see docs/runbook/14, domain 7).
# Imported in WS3 Phase C (B2 add-on).
#
# Object Lock in compliance mode makes objects immutable for the retention period:
# even an attacker with write access cannot delete or overwrite a backup before it
# expires. This is the anti-ransomware guarantee, so it is codified here rather than
# left to memory. The backup pipeline writes with a separate write-only key; this
# config is managed by a distinct read+write key (Infisical in WS4).
#
# The B2 application keys themselves (a secret resource) are intentionally NOT
# codified here yet; they land in WS4 with the rest of the secrets.
resource "b2_bucket" "db_backups" {
  bucket_info = {}
  bucket_name = "clint-db-backups"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    algorithm = "AES256"
    mode      = "SSE-B2"
  }

  # Compliance-mode Object Lock: 7-day immutable retention on every object.
  file_lock_configuration {
    is_file_lock_enabled = true
    default_retention {
      mode = "compliance"
      period {
        duration = 7
        unit     = "days"
      }
    }
  }

  # Hide objects after 365 days, then delete 1 day after hiding.
  lifecycle_rules {
    days_from_hiding_to_deleting                           = 1
    days_from_starting_to_canceling_unfinished_large_files = 0
    days_from_uploading_to_hiding                          = 365
    file_name_prefix                                       = ""
  }
}
