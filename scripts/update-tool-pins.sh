#!/usr/bin/env bash
# Refresh the scanner versions pinned in .github/workflows/security.yml.
#
# Dependabot keeps the pinned actions current, but it cannot see the Semgrep
# image digest or the OSV-Scanner and Gitleaks binaries. This script looks up
# the latest releases, verifies the published checksums and rewrites the pins.
#
#   scripts/update-tool-pins.sh          rewrite the pins in place
#   scripts/update-tool-pins.sh --check  report stale pins and change nothing
#
# Needs: gh (authenticated), curl, jq, sha256sum.
set -euo pipefail

workflow=".github/workflows/security.yml"
check=false
[ "${1:-}" = "--check" ] && check=true

latest() { gh api "repos/$1/releases/latest" --jq '.tag_name' | sed 's/^v//'; }
current() { sed -nE "s/^  $1: (.*)$/\1/p" "$workflow"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

semgrep_version=$(latest semgrep/semgrep)
token=$(curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:semgrep/semgrep:pull" | jq -r .token)
semgrep_digest=$(curl -fsSI -H "Authorization: Bearer $token" \
  -H "Accept: application/vnd.oci.image.index.v1+json" \
  -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json" \
  "https://registry-1.docker.io/v2/semgrep/semgrep/manifests/${semgrep_version}" |
  tr -d '\r' | sed -nE 's/^docker-content-digest: (.*)$/\1/Ip')
semgrep_image="semgrep/semgrep:${semgrep_version}@${semgrep_digest}"

osv_version=$(latest google/osv-scanner)
gh release download "v${osv_version}" -R google/osv-scanner -p osv-scanner_SHA256SUMS -D "$tmp"
osv_sha=$(awk '$2 == "osv-scanner_linux_amd64" { print $1 }' "$tmp/osv-scanner_SHA256SUMS")

gitleaks_version=$(latest gitleaks/gitleaks)
gh release download "v${gitleaks_version}" -R gitleaks/gitleaks -p "gitleaks_${gitleaks_version}_checksums.txt" -D "$tmp"
gitleaks_sha=$(awk -v f="gitleaks_${gitleaks_version}_linux_x64.tar.gz" '$2 == f { print $1 }' "$tmp/gitleaks_${gitleaks_version}_checksums.txt")

for value in "$semgrep_digest" "$osv_sha" "$gitleaks_sha"; do
  if [ -z "$value" ]; then echo "Could not resolve a digest or checksum, stopping." >&2; exit 1; fi
done

stale=0
compare() {
  local name=$1 want=$2 have
  have=$(current "$name")
  if [ "$have" != "$want" ]; then
    stale=1
    echo "$name: $have -> $want"
    if [ "$check" = false ]; then
      sed -i -E "s|^  $name: .*$|  $name: $want|" "$workflow"
    fi
  fi
}
compare SEMGREP_IMAGE "$semgrep_image"
compare OSV_SCANNER_VERSION "$osv_version"
compare OSV_SCANNER_SHA256 "$osv_sha"
compare GITLEAKS_VERSION "$gitleaks_version"
compare GITLEAKS_SHA256 "$gitleaks_sha"

if [ "$stale" = 0 ]; then
  echo "All scanner pins are current."
elif [ "$check" = true ]; then
  echo "::warning::Scanner pins are out of date. Run scripts/update-tool-pins.sh and open a PR."
else
  echo "Updated $workflow. Read the release notes, then open a PR."
fi
