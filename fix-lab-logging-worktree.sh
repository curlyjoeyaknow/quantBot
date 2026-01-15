#!/usr/bin/env bash
set -euo pipefail

WT="/home/memez/quantBot-logging"
BR="feature/lab-logging-followup"

echo "==> Enter worktree: $WT"
cd "$WT"

echo "==> Fetching origin..."
git fetch origin --prune

echo "==> Current status:"
git status -sb || true

# Capture current commit (works even when detached)
CUR_SHA="$(git rev-parse HEAD)"
STAMP="$(date +%F-%H%M%S)"

echo "==> Current HEAD: $CUR_SHA"

echo "==> Create safety backup branch + tag at HEAD (always safe)..."
git branch "backup/lab-logging-${STAMP}" "$CUR_SHA" || true
git tag -a "safety/lab-logging-${STAMP}" "$CUR_SHA" -m "safety tag from lab logging detached head ${STAMP}" || true

echo "==> Ensure we're on $BR (reattach if detached)..."
# If branch exists locally, switch to it; else create it at current HEAD.
if git show-ref --verify --quiet "refs/heads/$BR"; then
  git switch "$BR"
else
  git switch -c "$BR" "$CUR_SHA"
fi

echo "==> Status after (re)attaching branch:"
git status -sb || true

echo "==> Rebase onto origin/integration..."
git rebase "origin/integration"

echo "==> Final status:"
git status -sb || true

echo "==> Decide push strategy..."
# If remote branch exists, we may need --force-with-lease after rebase.
if git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then
  echo "==> Remote branch exists. Pushing with --force-with-lease (safe rebase push)..."
  git push --force-with-lease origin "$BR"
else
  echo "==> Remote branch does not exist. Pushing new branch..."
  git push -u origin "$BR"
fi

echo "✅ Done."
echo "Next: open PR from $BR -> integration, or merge locally into integration."
