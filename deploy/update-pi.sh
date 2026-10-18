#!/usr/bin/env bash
# Bootstrap from `git show origin/main:deploy/update-pi.sh`, without discarding edits.
set -euo pipefail
APP_ROOT="${1:?Pass the DigitalVilage checkout directory.}"
cd "$APP_ROOT"
if [[ "$(git branch --show-current)" != main ]]; then printf '%s\n' 'Switch to the intended main checkout before updating. No branch was changed.'; exit 1; fi
if ! git diff --quiet || ! git diff --cached --quiet; then printf '%s\n' 'There are local source edits. Preserve or commit them before updating; no files were overwritten.'; exit 1; fi
if [[ -f package-lock.json ]] && ! git ls-files --error-unmatch package-lock.json >/dev/null 2>&1; then
  APP_SAVED="$APP_ROOT/backups/pre-update-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$APP_SAVED"
  mv package-lock.json "$APP_SAVED/package-lock.json"
  printf '%s\n' 'The old generated dependency lockfile was preserved under backups/.'
fi
git merge --ff-only origin/main
exec bash deploy/pi-launch.sh --funnel
