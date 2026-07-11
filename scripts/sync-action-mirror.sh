#!/usr/bin/env bash
#
# Sync the bundled GitHub Action to its standalone, Marketplace-published repo.
#
# The monorepo (packages/github-action-sfn-diagram) is the single source of
# truth; the mirror repo is fully generated from it. GitHub only lists an action
# on the Marketplace when its action.yml sits at the repository root, which a
# monorepo subdirectory cannot satisfy — hence this mirror.
#
# This runs automatically from the `mirror-sync` job in
# .github/workflows/release-please.yml whenever release-please cuts a new action
# release. It is also safe to run by hand for recovery.
#
# Usage:
#   scripts/sync-action-mirror.sh
#
# Requirements:
#   - `gh` authenticated with push + release access to the mirror repo. In CI,
#     set GH_TOKEN to a token scoped to the mirror repo (the workflow mints one
#     from the release GitHub App, which must be installed on the mirror repo
#     with Contents: write).
#   - The version comes from packages/github-action-sfn-diagram/package.json;
#     release-please bumps it, so no manual edit is needed for automated runs.
#   - Run from anywhere inside the repo.
#
# First release of a brand-new Marketplace listing still needs a one-time manual
# tick of "Publish this Action to the GitHub Marketplace" on the release; every
# release after that is published automatically by this script.

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
# When GH_TOKEN is set (CI), route git auth for github.com through gh so pushes
# to the mirror use the minted token. Locally, GH_TOKEN is usually unset and the
# developer's existing gh credentials are used.
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git
fi
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
gh repo clone "$MIRROR_REPO" "$WORK" -- --quiet
git -C "$WORK" fetch --tags --force --quiet origin

# A fresh clone on a CI runner has no committer identity — set one (overridable).
git -C "$WORK" config user.name "${MIRROR_GIT_NAME:-sfn-diagram-release[bot]}"
git -C "$WORK" config user.email "${MIRROR_GIT_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"

# 3. Copy the generated payload (action.yml, bundle, README, LICENSE).
# The source is action.template.yml, not action.yml, so GitHub never detects the
# monorepo itself as an action (which would suppress this mirror on Marketplace).
# Render it to the mirror's root action.yml and strip the source-only comments.
cp "$PKG/action.template.yml" "$WORK/action.yml"
sed -i '/^#/d' "$WORK/action.yml"
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

# 6. Publish the GitHub Release (idempotent). For an action already listed on the
# Marketplace, a published (non-draft) release automatically becomes a new
# Marketplace version — no per-release UI step needed after the first listing.
if gh release view "v$VERSION" --repo "$MIRROR_REPO" >/dev/null 2>&1; then
  echo "Release v$VERSION already exists on $MIRROR_REPO — nothing to publish."
else
  gh release create "v$VERSION" \
    --repo "$MIRROR_REPO" \
    --target main \
    --title "v$VERSION" \
    --notes "Automated release of the sfn-diagram action v$VERSION. See the [monorepo changelog](https://github.com/yusufaf/sfn-diagram/blob/main/packages/github-action-sfn-diagram/CHANGELOG.md) for details."
  echo "Published release v$VERSION on $MIRROR_REPO"
fi

echo
echo "Done. Action v$VERSION synced, tagged, and released on $MIRROR_REPO."
