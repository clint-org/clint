# clintapp.com DNS zone and records. Imported in WS3 Phase C.
#
# The A/AAAA records are proxied placeholders (192.0.2.1 / 100:: are reserved
# documentation IPs); real traffic reaches the Worker via Workers routes, so the
# origin address is intentionally a dummy. The MX + TXT records carry Google
# Workspace mail and its auth (SPF, DKIM, DMARC) plus site verification.
#
# Each record's zone_id references cloudflare_zone.clintapp.id rather than a literal,
# so the records depend on the zone and the id lives in one place. ttl = 1 means
# "Automatic" (Cloudflare's default for proxied records).

resource "cloudflare_zone" "clintapp" {
  account = {
    id = var.cloudflare_account_id
  }
  name                = "clintapp.com"
  paused              = false
  type                = "full"
  vanity_name_servers = []
}

# --- A records (proxied placeholders) ---

resource "cloudflare_dns_record" "a_wildcard_apex" {
  comment         = null
  content         = "192.0.2.1"
  data            = null
  name            = "*.clintapp.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "A"
  zone_id = cloudflare_zone.clintapp.id
}

resource "cloudflare_dns_record" "a_wildcard_dev" {
  comment         = null
  content         = "192.0.2.1"
  data            = null
  name            = "*.dev.clintapp.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "A"
  zone_id = cloudflare_zone.clintapp.id
}

resource "cloudflare_dns_record" "a_dev" {
  comment         = null
  content         = "192.0.2.1"
  data            = null
  name            = "dev.clintapp.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "A"
  zone_id = cloudflare_zone.clintapp.id
}

# --- AAAA records (apex + www, proxied placeholders) ---

resource "cloudflare_dns_record" "aaaa_apex" {
  comment         = null
  content         = "100::"
  data            = null
  name            = "clintapp.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "AAAA"
  zone_id = cloudflare_zone.clintapp.id
}

resource "cloudflare_dns_record" "aaaa_www" {
  comment         = null
  content         = "100::"
  data            = null
  name            = "www.clintapp.com"
  priority        = null
  private_routing = null
  proxied         = true
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "AAAA"
  zone_id = cloudflare_zone.clintapp.id
}

# --- MX (Google Workspace mail) ---

resource "cloudflare_dns_record" "mx_google" {
  comment         = null
  content         = "smtp.google.com"
  data            = null
  name            = "clintapp.com"
  priority        = 1
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "MX"
  zone_id = cloudflare_zone.clintapp.id
}

# --- TXT (mail auth + verification) ---

resource "cloudflare_dns_record" "txt_spf" {
  comment         = null
  content         = "\"v=spf1 -all\""
  data            = null
  name            = "clintapp.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.clintapp.id
}

resource "cloudflare_dns_record" "txt_dmarc" {
  comment         = null
  content         = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;\""
  data            = null
  name            = "_dmarc.clintapp.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.clintapp.id
}

resource "cloudflare_dns_record" "txt_wildcard_domainkey" {
  comment         = null
  content         = "\"v=DKIM1; p=\""
  data            = null
  name            = "*._domainkey.clintapp.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.clintapp.id
}

resource "cloudflare_dns_record" "txt_google_domainkey" {
  comment         = null
  content         = "\"v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwydn1TGFKF7PMF3AAPVp3pyunbksNh07BltOkFRXNjIN1JyKh5Pr6xOI40pmwZtL4BQXsan5yqmm26uLi0kctPa6z1z3ZUNx2IeIMF6QXakbIhIaZ2t3V4kUxcn0H/rnjgQL1Tj01jo+aajC770QoUYfFOKYLq4nJR71bRn0WSG/bUXylFP/3Vawg0ySfEER0n4\" \"HWAMBPAV2EgHwBRwxhOzwIwYFxHJVtth1M3tWOlzN3WFNYMf005kehiTkWCGmzy4M13l6qbXCeH73I8nIemEMh64w+OOQgBUmPukl+XWGwpBILJlmsSNIBfnFm9/1xAcDfzXeZlaHxlhVY5QIzQIDAQAB\""
  data            = null
  name            = "google._domainkey.clintapp.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 1
  type    = "TXT"
  zone_id = cloudflare_zone.clintapp.id
}

resource "cloudflare_dns_record" "txt_google_site_verification" {
  comment         = null
  content         = "\"google-site-verification=CS_Mgb8cMZq32YXIGlWddZ2nv5JABKZ1AwsvGEGCvac\""
  data            = null
  name            = "clintapp.com"
  priority        = null
  private_routing = null
  proxied         = false
  settings = {
    flatten_cname = null
    ipv4_only     = null
    ipv6_only     = null
  }
  tags    = []
  ttl     = 3600
  type    = "TXT"
  zone_id = cloudflare_zone.clintapp.id
}
