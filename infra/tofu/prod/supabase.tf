# Codifies the clint (prod) Supabase project's non-secret cloud settings (WS3 Phase D).
# Schema/RLS/functions live in supabase/migrations; this manages only the dashboard
# settings the Management API exposes, and only the meaningful non-secret fields we
# choose. The provider does partial management: any field (or whole block) omitted
# here is left unmanaged, so platform-managed and secret fields stay out simply by
# not listing them. Secrets (OAuth client secrets, smtp_pass) are excluded on
# purpose: the API returns them hashed, which would drift on every plan. They are
# documented manual residue (see runbook domain 6).
#
# We do NOT use an import block: importing pulls the full settings blob into state,
# which forces managing every field (including platform-managed ones that drift).
# Instead we create the resource with only the fields below; create issues a partial
# PATCH of these (current) values, so the live project is unchanged and the plan
# settles to no-op, with the rest of the config left untouched and unmanaged.
#
# Only auth is codified: the redirect allow-list and OAuth/auth setup are the only
# settings moved off Supabase defaults. Other blocks (api/database/network/pooler/
# storage) are left at their defaults and are not managed here.
#
# project_ref is non-secret (clint prod). On a project rebuild the ref changes and
# must be updated here.

resource "supabase_settings" "prod" {
  project_ref = "gmgprkymyjzkzirbzqzd"

  auth = jsonencode({
    site_url                              = "https://clintapp.com"
    uri_allow_list                        = "https://*.clintapp.com/auth/callback,https://clintapp.com/auth/callback"
    jwt_exp                               = 3600
    refresh_token_rotation_enabled        = true
    security_refresh_token_reuse_interval = 10
    disable_signup                        = false
    external_anonymous_users_enabled      = false
    mailer_autoconfirm                    = false
    mailer_otp_exp                        = 3600
    password_min_length                   = 6
    mfa_max_enrolled_factors              = 10
    mfa_totp_enroll_enabled               = true
    mfa_totp_verify_enabled               = true
    mfa_phone_enroll_enabled              = false
    mfa_phone_verify_enabled              = false
    # rate_limit_email_sent / rate_limit_sms_sent omitted: the API rejects writing
    # them without custom SMTP / an SMS provider (prod uses the default mailer).
    rate_limit_anonymous_users = 30
    rate_limit_token_refresh   = 150
    rate_limit_verify          = 30
    rate_limit_otp             = 30
    external_google_enabled    = true
    external_google_client_id  = "567708662585-j8eqkc9tbq4dih6at9dl5fqqql05c482.apps.googleusercontent.com"
    external_azure_enabled     = true
    external_azure_client_id   = "829264b4-fd5b-48d4-a518-b793f78f0da9"
    external_azure_url         = "https://login.microsoftonline.com/common"
  })
}
