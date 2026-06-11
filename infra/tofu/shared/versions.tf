# Pins the tool and provider versions so every machine and CI run behaves
# identically. `~> 5` means "any 5.x", letting patch/minor updates in but never a
# breaking major (6.x) without an explicit bump.
terraform {
  required_version = ">= 1.8"

  # State lives in Scalr (CLI-driven: we still run tofu locally; Scalr stores the
  # state). "organization" is the Scalr environment name; the workspace holds this
  # root's state and auto-creates on first init. Backend config must be literal
  # (no variables allowed here).
  backend "remote" {
    hostname     = "clintapp.scalr.io"
    organization = "clint"
    workspaces {
      name = "clint-shared"
    }
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }
}
