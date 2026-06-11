# Pins the tool and provider versions so every machine and CI run behaves
# identically. `~> 5` means "any 5.x", letting patch/minor updates in but never a
# breaking major (6.x) without an explicit bump.
terraform {
  required_version = ">= 1.8"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }
}
