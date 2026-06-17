# Codifies the clint-dev Supabase project's non-secret cloud settings (WS3 Phase D).
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
# project_ref is non-secret (clint-dev). On a project rebuild the ref changes and
# must be updated here.

resource "supabase_settings" "dev" {
  project_ref = "aiawpfmiadyoulcambxs"

  auth = jsonencode({
    site_url                              = "https://dev.clintapp.com"
    uri_allow_list                        = "https://dev.clintapp.com/auth/callback,https://*.dev.clintapp.com/auth/callback"
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
    # rate_limit_email_sent / rate_limit_sms_sent are omitted: the Management API
    # rejects writing them unless custom SMTP / an SMS provider is configured
    # (these projects use Supabase's default mailer). They read back fine but are
    # not writable here, so they stay unmanaged.
    rate_limit_anonymous_users            = 30
    rate_limit_token_refresh              = 150
    rate_limit_verify                     = 30
    rate_limit_otp                        = 30
    external_google_enabled               = true
    external_google_client_id             = "567708662585-j8eqkc9tbq4dih6at9dl5fqqql05c482.apps.googleusercontent.com"
    external_azure_enabled                = true
    external_azure_client_id              = "ccccbf13-a9f1-42d5-820b-7d2fed67374e"
    external_azure_url                    = "https://login.microsoftonline.com/common"
  })
}
