# WS3 Phase E: IaC drift-check gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when live Cloudflare/B2/Supabase resources drift from `infra/tofu/`, via a credential-free PR gate (fmt + validate + config-parity) and a daily `tofu plan` drift job that opens a GitHub issue, closing out WS3.

**Architecture:** Two small scripts under `infra/tofu/scripts/` (`config_parity_check.py`, `drift-check.sh`) plus two GitHub workflows (`iac-pr-check.yml` credential-free on PRs; `iac-drift.yml` scheduled, authenticating to Infisical via the existing break-glass OIDC identity). Scalr stays on Local execution; the Scalr API token moves into Infisical `/iac` as `TF_TOKEN_clintapp_scalr_io` so `infisical run` injects it automatically.

**Tech Stack:** OpenTofu, Scalr remote state, Supabase/Cloudflare/B2 providers, Infisical CLI (OIDC machine identity), GitHub Actions, Python 3.11+ stdlib (`tomllib`, `unittest`), Bash.

---

## Conventions used in every task
- **Worktree:** `/Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish` on branch `infra/ws3-finish`. Verify `git branch --show-current` before any commit. **Commit only; never push** (the controller owns the single end-of-work push).
- **Infisical wrapper (bash array, avoids zsh word-split):** local runs use
  `infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=shared --path=/iac --silent -- <cmd>`.
- **Project refs:** prod `gmgprkymyjzkzirbzqzd`, dev `aiawpfmiadyoulcambxs`.
- Do not commit `src/client/node_modules` (a worktree symlink); stage only the listed files.

---

## Task 1: config_parity_check.py (TDD: test first)

Pure file comparison of the should-match auth policy across `supabase/config.toml`, `infra/tofu/dev/supabase.tf`, and `infra/tofu/prod/supabase.tf`. No credentials.

**Files:**
- Create: `infra/tofu/scripts/config_parity_check.py`
- Create: `infra/tofu/scripts/test_config_parity.py`

- [ ] **Step 1: Write the failing test** at `infra/tofu/scripts/test_config_parity.py`:

```python
import unittest
import config_parity_check as p

class TestParse(unittest.TestCase):
    def test_parse_tf_auth_block(self):
        tf = '''
resource "supabase_settings" "dev" {
  project_ref = "x"
  auth = jsonencode({
    site_url            = "https://dev.example.com"
    password_min_length = 6
    disable_signup      = false
    jwt_exp             = 3600
  })
}
'''
        got = p.parse_tf_auth(tf)
        self.assertEqual(got["password_min_length"], 6)
        self.assertEqual(got["disable_signup"], False)
        self.assertEqual(got["jwt_exp"], 3600)
        self.assertEqual(got["site_url"], "https://dev.example.com")

    def test_coerce(self):
        self.assertIs(p.coerce("true"), True)
        self.assertIs(p.coerce("false"), False)
        self.assertEqual(p.coerce("6"), 6)
        self.assertEqual(p.coerce('"hi"'), "hi")

class TestCompare(unittest.TestCase):
    def _toml(self, **over):
        base = {
            "minimum_password_length": 6, "jwt_expiry": 3600,
            "enable_refresh_token_rotation": True, "refresh_token_reuse_interval": 10,
            "enable_signup": True, "enable_anonymous_sign_ins": False,
            "mfa": {"max_enrolled_factors": 10},
        }
        base.update(over)
        return base

    def _tf(self, **over):
        base = {
            "password_min_length": 6, "jwt_exp": 3600,
            "refresh_token_rotation_enabled": True,
            "security_refresh_token_reuse_interval": 10,
            "disable_signup": False, "external_anonymous_users_enabled": False,
            "mfa_max_enrolled_factors": 10,
        }
        base.update(over)
        return base

    def test_all_match_no_mismatch(self):
        self.assertEqual(p.compare(self._toml(), self._tf(), self._tf()), [])

    def test_signup_inversion_match(self):
        # enable_signup True -> disable_signup False is a MATCH
        self.assertEqual(p.compare(self._toml(enable_signup=True),
                                   self._tf(disable_signup=False),
                                   self._tf(disable_signup=False)), [])

    def test_signup_inversion_mismatch(self):
        m = p.compare(self._toml(enable_signup=True),
                      self._tf(disable_signup=True),
                      self._tf(disable_signup=True))
        self.assertTrue(any("disable_signup" in x for x in m))

    def test_value_divergence_detected(self):
        m = p.compare(self._toml(), self._tf(password_min_length=8), self._tf())
        self.assertTrue(any("password_min_length" in x for x in m))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd infra/tofu/scripts && python3 -m unittest test_config_parity -v`
Expected: FAIL/ERROR (`ModuleNotFoundError: No module named 'config_parity_check'`).

- [ ] **Step 3: Write `infra/tofu/scripts/config_parity_check.py`**

```python
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

# canonical field -> (config.toml getter, tofu key, invert?)
# config.toml getter is a path into the parsed [auth] table.
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd infra/tofu/scripts && python3 -m unittest test_config_parity -v`
Expected: PASS (all tests OK).

- [ ] **Step 5: Run against the real repo files, verify it passes**

Run: `python3 infra/tofu/scripts/config_parity_check.py`
Expected: `Auth policy parity OK ...`. (MFA TOTP toggles are intentionally not compared, so the known local-off/cloud-on TOTP difference does not fail it. All compared fields already match: password_min_length=6, jwt_exp=3600, rotation=true, reuse=10, disable_signup=false, anon=false, mfa_max=10.) If it unexpectedly fails, STOP and report the mismatch rather than editing values.

- [ ] **Step 6: Commit**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add infra/tofu/scripts/config_parity_check.py infra/tofu/scripts/test_config_parity.py
git commit -m "feat(iac): add config.toml<->tofu auth-policy parity check + tests"
```

---

## Task 2: drift-check.sh

**Files:**
- Create: `infra/tofu/scripts/drift-check.sh`

- [ ] **Step 1: Write `infra/tofu/scripts/drift-check.sh`**

```bash
#!/usr/bin/env bash
# WS3 Phase E: IaC drift check. Runs `tofu plan -detailed-exitcode` in each root via
# Infisical-injected creds (/iac supplies the Cloudflare/B2/Supabase tokens AND
# TF_TOKEN_clintapp_scalr_io for the Scalr backend). Exit codes:
#   0 = all roots in sync; 2 = drift in >=1 root; 1 = check error in >=1 root (no drift).
# Locally, if /iac has no Scalr token yet, your `tofu login` credential is used instead.
set -uo pipefail

ROOTS=(shared dev prod)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # infra/tofu
PROJECT_ID="7c227e8b-b355-46cb-8912-701104e2415b"
IRUN=(infisical run --projectId "$PROJECT_ID" --env=shared --path=/iac --silent --)

run_plan() {  # $1 = root; writes plan output to $2; returns tofu exit code
  ( cd "$HERE/$1" \
    && "${IRUN[@]}" tofu init -input=false >/dev/null 2>&1 \
    && "${IRUN[@]}" tofu plan -detailed-exitcode -input=false -no-color >"$2" 2>&1 )
  return $?
}

drift=0; errored=0
declare -a drift_roots=() errored_roots=()
for root in "${ROOTS[@]}"; do
  log="$(mktemp)"
  run_plan "$root" "$log"; code=$?
  if [ "$code" = "1" ]; then sleep 5; run_plan "$root" "$log"; code=$?; fi  # retry transient
  case "$code" in
    0) echo "OK    $root: in sync" ;;
    2) echo "DRIFT $root: plan shows changes"; sed 's/^/    /' "$log" | tail -40; drift=1; drift_roots+=("$root") ;;
    *) echo "ERROR $root: tofu failed (exit $code)"; sed 's/^/    /' "$log" | tail -20; errored=1; errored_roots+=("$root") ;;
  esac
  rm -f "$log"
done

if [ "$drift" = "1" ]; then echo "::error::IaC drift detected in: ${drift_roots[*]}"; exit 2; fi
if [ "$errored" = "1" ]; then echo "::error::IaC drift check errored in: ${errored_roots[*]}"; exit 1; fi
echo "All roots in sync."; exit 0
```

- [ ] **Step 2: Make executable and run locally to verify all roots are in sync**

```bash
chmod +x infra/tofu/scripts/drift-check.sh
bash infra/tofu/scripts/drift-check.sh; echo "exit=$?"
```
Expected: `OK    shared: in sync`, `OK    dev: in sync`, `OK    prod: in sync`, `All roots in sync.`, `exit=0`. (Uses your local `tofu login` for Scalr until the token is added to /iac in Task 5.) If a root shows DRIFT, STOP and report it (do not "fix" by applying).

- [ ] **Step 3: Commit**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add infra/tofu/scripts/drift-check.sh
git commit -m "feat(iac): add drift-check.sh (tofu plan -detailed-exitcode across roots)"
```

---

## Task 3: format existing tofu + PR-gate workflow (credential-free)

The PR gate runs `tofu fmt -check`, so existing files must be fmt-clean first.

**Files:**
- Create: `.github/workflows/iac-pr-check.yml`
- Possibly modify: any `infra/tofu/**/*.tf` that `tofu fmt` reformats

- [ ] **Step 1: Format existing tofu and see what changes**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
tofu fmt -recursive infra/tofu && git status --porcelain infra/tofu
```
Expected: either no changes (already clean) or a few whitespace-only reformats. Review the diff; it must be whitespace/alignment only.

- [ ] **Step 2: Create `.github/workflows/iac-pr-check.yml`**

```yaml
name: IaC PR check
# WS3 Phase E: credential-free gate on tofu/config changes. Catches malformed config
# and local/cloud auth-policy divergence before merge. The credential-needing drift
# plan runs on a schedule in iac-drift.yml.
on:
  pull_request:
    paths:
      - 'infra/tofu/**'
      - 'supabase/config.toml'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: opentofu/setup-opentofu@v1
      - name: tofu fmt
        run: tofu fmt -check -recursive infra/tofu
      - name: tofu validate (each root, no backend)
        run: |
          set -e
          for r in shared dev prod; do
            echo "== $r =="
            tofu -chdir="infra/tofu/$r" init -backend=false -input=false
            tofu -chdir="infra/tofu/$r" validate
          done
      - name: Supabase auth-policy parity
        run: python3 infra/tofu/scripts/config_parity_check.py
```

- [ ] **Step 3: Verify the gate's steps locally (credential-free)**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
tofu fmt -check -recursive infra/tofu && echo "fmt ok"
for r in shared dev prod; do tofu -chdir="infra/tofu/$r" init -backend=false -input=false >/dev/null && tofu -chdir="infra/tofu/$r" validate; done
python3 infra/tofu/scripts/config_parity_check.py
```
Expected: fmt ok; each root `Success! The configuration is valid.`; parity OK.

- [ ] **Step 4: Commit**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add .github/workflows/iac-pr-check.yml infra/tofu
git commit -m "feat(ci): credential-free IaC PR gate (fmt, validate, auth-policy parity)"
```

---

## Task 4: scheduled drift workflow

**Files:**
- Create: `.github/workflows/iac-drift.yml`

- [ ] **Step 1: Create `.github/workflows/iac-drift.yml`** (auth step mirrors `secrets-break-glass.yml`)

```yaml
name: IaC drift check
# WS3 Phase E. Domain 6/7 in docs/runbook/14-disaster-recovery.md: detect when live
# Cloudflare/B2/Supabase resources drift from infra/tofu/. Read-only `tofu plan`.
on:
  schedule:
    - cron: "30 6 * * *"
  workflow_dispatch:

permissions:
  contents: read
  id-token: write   # mint GitHub OIDC token for Infisical auth

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: opentofu/setup-opentofu@v1
      - name: Install Infisical CLI
        run: |
          curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | sudo -E bash
          sudo apt-get install -y -qq infisical
      - name: Authenticate to Infisical via GitHub OIDC
        id: auth
        env:
          IDENTITY_ID: ${{ secrets.INFISICAL_MACHINE_IDENTITY_ID }}
        run: |
          oidc="$(curl -s "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=https://infisical.com" \
            -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" | jq -r '.value')"
          token="$(infisical login --method=oidc-auth --machine-identity-id="$IDENTITY_ID" \
            --jwt="$oidc" --plain --silent)"
          echo "::add-mask::$token"
          echo "token=$token" >> "$GITHUB_OUTPUT"
      - name: Supabase auth-policy parity
        run: python3 infra/tofu/scripts/config_parity_check.py
      - name: Drift check (tofu plan across roots)
        env:
          INFISICAL_TOKEN: ${{ steps.auth.outputs.token }}
        run: bash infra/tofu/scripts/drift-check.sh

  notify-failure:
    needs: [drift]
    if: failure()
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const label = 'iac-drift';
            const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
            const body = [
              'The scheduled IaC drift check failed.',
              '',
              `Run: ${runUrl}`,
              '',
              'Either live infrastructure drifted from infra/tofu/ (tofu plan exit 2),',
              'or the check errored (provider/backend, exit 1) — see the run log to tell which.',
              'Detection signal for domains 6 and 7 in docs/runbook/14-disaster-recovery.md.',
            ].join('\n');
            const open = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo, state: 'open', labels: label,
            });
            if (open.data.length > 0) {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo,
                issue_number: open.data[0].number, body,
              });
            } else {
              await github.rest.issues.create({
                owner: context.repo.owner, repo: context.repo.repo,
                title: 'IaC drift check failed', body, labels: [label],
              });
            }
```

- [ ] **Step 2: Lint the YAML locally**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/iac-drift.yml')); print('yaml ok')"
```
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add .github/workflows/iac-drift.yml
git commit -m "feat(ci): scheduled IaC drift check with GitHub-issue alert"
```

---

## Task 5 (INLINE with user): Scalr token prerequisite + live CI verification

- [ ] **Step 1: User mints a Scalr API token** in the Scalr UI (clintapp.scalr.io -> account settings -> API tokens, or a service-account token with read access to the `clint` environment workspaces).
- [ ] **Step 2: Add it to Infisical** under `shared/iac` with the exact key name **`TF_TOKEN_clintapp_scalr_io`** (OpenTofu reads `TF_TOKEN_<host-with-underscores>` for backend auth; `infisical run --path=/iac` then injects it automatically — no script change needed).
- [ ] **Step 3: Confirm local drift-check still green with the token injected**

```bash
bash infra/tofu/scripts/drift-check.sh; echo "exit=$?"
```
Expected: all roots in sync, `exit=0` (now using the injected `TF_TOKEN_clintapp_scalr_io`).

- [ ] **Step 4: Trigger the scheduled workflow manually and confirm green**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
gh workflow run iac-drift.yml --ref develop
sleep 20 && gh run list --workflow=iac-drift.yml -L 1
```
Then watch the run: `gh run watch <run-id>`. Expected: the `drift` job succeeds (all roots in sync, parity OK); `notify-failure` is skipped; no `iac-drift` issue opened. (This requires the commits to be on develop first; in subagent-driven execution this step runs after the controller's end-of-work push, or trigger from the branch if pushed.)

> Note: this is the one task needing the user (mint the Scalr token) and a pushed workflow. The controller coordinates: push first, then run this verification.

---

## Task 6: runbook + memory + WS3 close-out, then push

**Files:**
- Modify: `docs/runbook/14-disaster-recovery.md` (drift gate reference + action register + WS3 done)
- Modify: `infra/tofu/README.md` (mention the scripts + checks)

- [ ] **Step 1: Update the runbook.** In `docs/runbook/14-disaster-recovery.md`: in domains 6 and 7, note that drift from `infra/tofu/` is now detected daily by `.github/workflows/iac-drift.yml` (issue label `iac-drift`) and gated on PRs by `iac-pr-check.yml`. Update the action register: the WS3 IaC item's "drift-check command exists" criterion is satisfied; mark the IaC-foundation row done. Add a one-line pointer to `infra/tofu/scripts/`.

- [ ] **Step 2: Update `infra/tofu/README.md`** with a short "Drift detection" section: `scripts/drift-check.sh` (run via `infisical run` or directly; daily in CI) and `scripts/config_parity_check.py` (auth-policy parity; runs on PRs), and the `iac-pr-check.yml` / `iac-drift.yml` workflows.

- [ ] **Step 3: Commit docs**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add docs/runbook/14-disaster-recovery.md infra/tofu/README.md
git commit -m "docs(runbook): WS3 Phase E drift gate; WS3 complete"
```

- [ ] **Step 4: Update program memory** (`/Users/aadityamadala/.claude/projects/-Users-aadityamadala-Documents-code-clint-v2/memory/project_dr_remediation_program.md`): record Phase E done and **WS3 complete**; next is WS1/WS2/WS5. (Outside the repo; no commit.)

- [ ] **Step 5: Rebase and push** (controller; verify branch first)

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git fetch origin develop --quiet && git rebase origin/develop
test "$(git branch --show-current)" = "infra/ws3-finish" && git push origin HEAD:develop --no-verify
```

---

## Self-review notes (for the executor)
- The parity script is the only unit-tested piece (its mapping/inversion logic is error-prone); the shell + workflows are verified by running them (locally and via `workflow_dispatch`), not unit tests.
- `TF_TOKEN_clintapp_scalr_io` in Infisical `/iac` is what lets CI authenticate to the Scalr backend; without it (Task 5) the scheduled workflow's `tofu init` will fail backend auth. Local runs fall back to `tofu login`.
- Never let the drift check "fix" drift by applying. It detects and alerts only.
- Transient provider errors (exit 1, e.g. the Phase D `pg_bouncer` blip) are retried once and reported as a check error, distinct from real drift (exit 2).
```
