# Database Backup Policy

Clint maintains automated, off-platform, encrypted backups of all production
data, independent of its primary database provider.

- **Cadence:** Daily automated backups, plus an additional snapshot before every
  production database change.
- **Retention (grandfather-father-son):** daily backups retained 7 days, weekly
  28 days, monthly 12 months.
- **Off-site and cross-cloud:** every backup is stored in two independent cloud
  providers in separate infrastructure, so no single provider failure can
  destroy all copies.
- **Immutable:** backups are write-once (object lock); they cannot be altered or
  deleted before their lock window elapses, including by an actor holding
  production credentials. The backup process itself has write-only, no-delete
  credentials.
- **Encrypted:** all backups are encrypted at rest; decryption keys are held
  offline by named custodians.
- **Tested:** restores are verified automatically every week and via a manual
  recovery drill each quarter.
- **Recovery objectives:** recovery point objective ~24 hours (sub-day where
  point-in-time recovery is enabled); recovery time objective 30-60 minutes.
