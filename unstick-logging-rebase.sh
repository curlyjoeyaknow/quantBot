#!/usr/bin/env bash
set -euo pipefail

WT="/home/memez/quantBot-logging"
BR="feature/lab-logging-followup"

cd "$WT"

echo "==> Fetch origin..."
git fetch origin --prune

STAMP="$(date +%F-%H%M%S)"
CUR_SHA="$(git rev-parse HEAD)"

echo "==> Status (before):"
git status -sb || true
echo "==> HEAD: $CUR_SHA"

echo "==> Safety branch + tag at current HEAD..."
git branch "backup/lab-logging-${STAMP}" "$CUR_SHA" 2>/dev/null || true
git tag -a "safety/lab-logging-${STAMP}" "$CUR_SHA" -m "safety tag ${STAMP}" 2>/dev/null || true

echo "==> Extra safety: save patch of current working tree (even with conflicts)..."
# These may fail if conflicts exist; that's okay. We still save what we can.
git diff > "/tmp/quantbot-logging-WIP-${STAMP}.patch" || true
git diff --staged > "/tmp/quantbot-logging-WIP-staged-${STAMP}.patch" || true
echo "Saved patches:"
ls -la "/tmp/quantbot-logging-WIP-${STAMP}.patch" "/tmp/quantbot-logging-WIP-staged-${STAMP}.patch" 2>/dev/null || true

echo "==> If a rebase is in progress, abort it (safe reset to pre-rebase state)..."
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  git rebase --abort || true
fi

echo "==> After abort:"
git status -sb || true

echo "==> Stash everything (including untracked) so branch switching is clean..."
git stash push -u -m "WIP logging recover ${STAMP}" || true

echo "==> Attach to $BR (create it at HEAD if it doesn't exist)..."
if git show-ref --verify --quiet "refs/heads/$BR"; then
  git switch "$BR"
else
  git switch -c "$BR"
fi

echo "==> Re-apply stash if present..."
if git stash list | grep -q "WIP logging recover ${STAMP}"; then
  git stash pop || true
fi

echo "==> Now rebase onto origin/integration (expected place for this branch)..."
git fetch origin --prune
git rebase "origin/integration" || true

echo
echo "==> If rebase stopped for conflicts:"
echo "   1) fix files"
echo "   2) git add -A"
echo "   3) git rebase --continue"
echo
echo "==> Final status:"
git status -sb || true

echo
echo "==> Push guidance (do this AFTER rebase completes):"
echo "git push --force-with-lease -u origin $BR"
