#!/usr/bin/env python3
"""WS3 Phase E: assert the should-match Supabase auth policy fields agree across
supabase/config.toml (local stack), infra/tofu/dev/supabase.tf, and
infra/tofu/prod/supabase.tf. Exits non-zero on any divergence. Credential-free.

EXCLUDED by design (documented so the mapping does not silently rot):
- MFA method enablement (mfa_totp/phone enroll/verify): legitimately env-dependent
  (TOTP is on in cloud, off in local dev); only mfa_max_enrolled_factors is compared.
- rate_limit_* : config.toml names (token_verifications, web3) do not map cleanly to
  the Management API names.
- site_url, uri_allow_list, external_*_client_id, external_azure_url: env-divergent
  by design.
"""
import re
import sys
import tomllib
from pathlib import Path

# canonical field -> (config.toml path into [auth], tofu key, invert?)
FIELDS = [
    ("password_min_length",                  ("minimum_password_length",),        "password_min_length",                   False),
    ("jwt_exp",                              ("jwt_expiry",),                      "jwt_exp",                               False),
    ("refresh_token_rotation_enabled",       ("enable_refresh_token_rotation",),   "refresh_token_rotation_enabled",        False),
    ("security_refresh_token_reuse_interval",("refresh_token_reuse_interval",),    "security_refresh_token_reuse_interval", False),
    ("disable_signup",                       ("enable_signup",),                   "disable_signup",                        True),
    ("external_anonymous_users_enabled",     ("enable_anonymous_sign_ins",),       "external_anonymous_users_enabled",      False),
    ("mfa_max_enrolled_factors",             ("mfa", "max_enrolled_factors"),      "mfa_max_enrolled_factors",              False),
]

def coerce(raw):
    raw = raw.strip()
    if raw == "true":
        return True
    if raw == "false":
        return False
    if raw.startswith('"') and raw.endswith('"'):
        return raw[1:-1]
    try:
        return int(raw)
    except ValueError:
        return raw

def parse_tf_auth(text):
    """Extract key=value pairs from the auth = jsonencode({ ... }) block."""
    m = re.search(r"auth\s*=\s*jsonencode\(\{(.*?)\}\)", text, re.S)
    if not m:
        raise ValueError("no auth jsonencode block found")
    out = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        km = re.match(r"(\w+)\s*=\s*(.+)$", line)
        if km:
            out[km.group(1)] = coerce(km.group(2))
    return out

def dig(table, path):
    cur = table
    for k in path:
        cur = cur[k]
    return cur

def compare(toml_auth, dev_tf, prod_tf):
    mismatches = []
    for canon, toml_path, tf_key, invert in FIELDS:
        try:
            tv = dig(toml_auth, toml_path)
        except (KeyError, TypeError):
            mismatches.append(f"{canon}: missing in config.toml")
            continue
        if invert:
            tv = not tv
        dv = dev_tf.get(tf_key)
        pv = prod_tf.get(tf_key)
        if not (tv == dv == pv):
            mismatches.append(f"{canon}: config.toml={tv} dev={dv} prod={pv}")
    return mismatches

def main():
    root = Path(__file__).resolve().parents[3]  # repo root from infra/tofu/scripts
    cfg = tomllib.loads((root / "supabase" / "config.toml").read_text())
    toml_auth = cfg["auth"]
    dev_tf = parse_tf_auth((root / "infra" / "tofu" / "dev" / "supabase.tf").read_text())
    prod_tf = parse_tf_auth((root / "infra" / "tofu" / "prod" / "supabase.tf").read_text())
    mismatches = compare(toml_auth, dev_tf, prod_tf)
    if mismatches:
        print("Auth policy parity FAILED:")
        for m in mismatches:
            print(f"  - {m}")
        sys.exit(1)
    print("Auth policy parity OK (config.toml == dev == prod for the compared fields).")

if __name__ == "__main__":
    main()
