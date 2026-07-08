#!/usr/bin/env bash
#
# Sync the bundled GitHub Action to its standalone, Marketplace-published repo.
#
# The monorepo (packages/github-action-sfn-diagram) is the single source of
# truth; the mirror repo is fully generated from it. GitHub only lists an action
# on the Marketplace when its action.yml sits at the repository root, which a
# monorepo subdirectory cannot satisfy — hence this mirror.
#
# Usage:
#   scripts/sync-action-mirror.sh
#
# Requirements:
#   - `gh` authenticated with push access to the mirror repo.
#   - Run from anywhere inside the repo.
#
# To cut a release: bump the version in
# packages/github-action-sfn-diagram/package.json, run this script, then create
# a GitHub Release for the new vX.Y.Z tag in the mirror (first time only: tick
# "Publish this Action to the GitHub Marketplace").

set -euo pipefail

MIRROR_REPO="${MIRROR_REPO:-yusufaf/sfn-diagram-action}"
PNPM="${PNPM:-pnpm}"   # override with e.g. PNPM="npx pnpm@9" if pnpm isn't on PATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/packages/github-action-sfn-diagram"

VERSION="$(node -p "require('$PKG/package.json').version")"
MAJOR="${VERSION%%.*}"
echo "Syncing action v$VERSION (major tag v$MAJOR) → $MIRROR_REPO"

# 1. Rebuild the committed bundle so the mirror can never ship stale code.
echo "Building bundle…"
$PNPM --filter github-action-sfn-diagram build

# 2. Clone the mirror into a throwaway dir (with its tags).
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
gh repo clone "$MIRROR_REPO" "$WORK" -- --quiet
git -C "$WORK" fetch --tags --force --quiet origin

# 3. Copy the generated payload (action.yml, bundle, README, LICENSE).
cp "$PKG/action.yml" "$WORK/action.yml"
mkdir -p "$WORK/dist"
cp "$PKG/dist/index.js" "$WORK/dist/index.js"
cp "$PKG/README.marketplace.md" "$WORK/README.md"
cp "$ROOT/LICENSE" "$WORK/LICENSE"

# 4. Commit + push to main only if something actually changed.
cd "$WORK"
git add -A
if git diff --cached --quiet; then
  echo "Mirror content already up to date."
else
  git commit --quiet -m "chore: sync action v$VERSION from monorepo"
  git push --quiet origin HEAD:main
  echo "Pushed synced content to $MIRROR_REPO@main"
fi

# 5. Create the immutable version tag (only if new) and move the major tag.
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists — bump package.json version to release a new one."
else
  git tag "v$VERSION"
  git push origin "v$VERSION"
  echo "Tagged v$VERSION"
fi
git tag -f "v$MAJOR" >/dev/null
git push -f origin "v$MAJOR"
echo "Moved major tag v$MAJOR → v$VERSION"

echo
echo "Done. Next: create a GitHub Release for v$VERSION at"
echo "  https://github.com/$MIRROR_REPO/releases/new?tag=v$VERSION"
echo "(first release only: tick 'Publish this Action to the GitHub Marketplace')."
