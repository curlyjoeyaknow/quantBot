#!/usr/bin/env bash
set -euo pipefail

# QuantBot Worktree Sync
# - Updates integration by merging origin/main -> integration
# - Rebases feature branches in ALL worktrees onto origin/integration
#
# Safety:
# - Refuses to operate on dirty worktrees (unless ALLOW_DIRTY=1)
# - Creates backup branches before rebasing (unless NO_BACKUP=1)
#
# Optional knobs:
#   DRY_RUN=1            : print actions, do nothing
#   ALLOW_DIRTY=1        : will stash -u before rebase, and pop after (best effort)
#   NO_BACKUP=1          : skip backup branch creation
#   AUTO_PUSH=1          : push updated branches after rebase (force-with-lease)
#   SKIP_INTEGRATION=1   : don't update integration (only rebase feature worktrees)
#
# Usage:
#   ./scripts/git/sync-worktrees.sh
#   DRY_RUN=1 ./scripts/git/sync-worktrees.sh
#   AUTO_PUSH=1 ./scripts/git/sync-worktrees.sh

DRY_RUN="${DRY_RUN:-0}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"
NO_BACKUP="${NO_BACKUP:-0}"
AUTO_PUSH="${AUTO_PUSH:-0}"
SKIP_INTEGRATION="${SKIP_INTEGRATION:-0}"

say() { printf "\033[1m%s\033[0m\n" "$*"; }
warn() { printf "\033[33m%s\033[0m\n" "$*"; }
die() { printf "\033[31m%s\033[0m\n" "$*" >&2; exit 1; }

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY_RUN] $*"
  else
    eval "$@"
  fi
}

need_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not inside a git repo."
}

is_clean_tree() {
  # clean if no staged/unstaged/untracked changes
  git status --porcelain | grep -q . && return 1 || return 0
}

current_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "UNKNOWN"
}

worktree_list_porcelain() {
  git worktree list --porcelain
}

# Decide which branches we treat as "feature-ish" and should track integration
is_feature_branch() {
  local b="$1"
  case "$b" in
    main|integration|HEAD|UNKNOWN) return 1 ;;
    feature/*|enhancement/*|refactor/*|fix/*|hotfix/*|bugfix/*|chore/*|spike/*|wip/*)
      return 0 ;;
    *)
      # Conservative: treat other named branches as feature-ish too, unless you want stricter rules.
      return 0 ;;
  esac
}

timestamp() { date +%F-%H%M%S; }

create_backup_branch() {
  local branch="$1"
  local ts
  ts="$(timestamp)"
  local backup="backup/${branch//\//-}-$ts"
  run "git branch \"$backup\" \"$branch\""
  say "  - backup branch created: $backup"
}

stash_if_needed() {
  if is_clean_tree; then
    return 0
  fi

  if [[ "$ALLOW_DIRTY" != "1" ]]; then
    die "Worktree has uncommitted changes. Either commit/stash, or re-run with ALLOW_DIRTY=1"
  fi

  local ts
  ts="$(timestamp)"
  say "  - dirty tree detected; stashing (ALLOW_DIRTY=1)"
  run "git stash push -u -m \"auto-stash before sync $ts\" >/dev/null"
}

stash_pop_best_effort() {
  if [[ "$ALLOW_DIRTY" != "1" ]]; then
    return 0
  fi

  # Pop only if the most recent stash looks like ours (best effort)
  local top
  top="$(git stash list | head -n 1 || true)"
  if echo "$top" | grep -q "auto-stash before sync"; then
    say "  - popping auto-stash"
    run "git stash pop >/dev/null || true"
  fi
}

update_integration_from_main() {
  say "==> Updating integration from origin/main ..."

  run "git fetch origin --prune"

  # Ensure integration exists locally
  run "git show-ref --verify --quiet refs/heads/integration || git branch integration origin/integration"

  run "git switch integration"
  run "git pull --ff-only origin integration"

  # Merge main into integration (merge, not rebase, to preserve history)
  run "git merge --no-edit origin/main"

  if [[ "$AUTO_PUSH" == "1" ]]; then
    run "git push origin integration"
    say "  - pushed integration"
  else
    warn "  - AUTO_PUSH=0, not pushing integration"
  fi
}

rebase_worktree_branch_on_integration() {
  local path="$1"
  local branch="$2"

  say "==> Worktree: $path"
  say "    Branch:  $branch"

  # Enter worktree
  pushd "$path" >/dev/null || die "Failed to cd to $path"

  # If detached HEAD, skip (worktree should be attached to a branch)
  if [[ "$branch" == "HEAD" ]]; then
    warn "  - detached HEAD; skipping. (Reattach this worktree to a branch first.)"
    popd >/dev/null
    return 0
  fi

  run "git fetch origin --prune"

  # Make sure we're on the branch in this worktree (should already be true)
  run "git switch \"$branch\""

  # Safety: stash if needed
  stash_if_needed

  # Backup branch pointer
  if [[ "$NO_BACKUP" != "1" ]]; then
    create_backup_branch "$branch"
  else
    warn "  - NO_BACKUP=1, skipping backup branch"
  fi

  # Rebase onto integration
  say "  - rebasing onto origin/integration"
  run "git rebase origin/integration"

  # Optional push
  if [[ "$AUTO_PUSH" == "1" ]]; then
    say "  - pushing (force-with-lease) to origin/$branch"
    run "git push --force-with-lease origin \"$branch\""
  else
    warn "  - AUTO_PUSH=0, not pushing $branch"
  fi

  # Restore stash (best effort)
  stash_pop_best_effort

  popd >/dev/null
}

main() {
  need_git_repo

  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  say "Repo root: $repo_root"

  if [[ "$SKIP_INTEGRATION" != "1" ]]; then
    pushd "$repo_root" >/dev/null
    update_integration_from_main
    popd >/dev/null
  else
    warn "SKIP_INTEGRATION=1, not updating integration"
  fi

  # Gather worktrees from repo root (must run from root to list all)
  pushd "$repo_root" >/dev/null

  say "==> Discovering worktrees..."
  local wt_path=""
  local wt_branch=""

  # Parse porcelain output
  # blocks:
  # worktree /path
  # HEAD <sha>
  # branch refs/heads/<branch>   OR "detached"
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        wt_path="${line#worktree }"
        wt_branch=""
        ;;
      branch\ refs/heads/*)
        wt_branch="${line#branch refs/heads/}"
        ;;
      detached)
        wt_branch="HEAD"
        ;;
      "")
        # End of block
        if [[ -n "$wt_path" ]]; then
          # Skip integration worktree itself (we already updated there)
          if [[ "$wt_branch" != "integration" && "$wt_branch" != "main" ]]; then
            if is_feature_branch "$wt_branch"; then
              rebase_worktree_branch_on_integration "$wt_path" "$wt_branch"
            else
              warn "==> Skipping non-feature branch: $wt_branch ($wt_path)"
            fi
          else
            warn "==> Skipping $wt_branch worktree: $wt_path"
          fi
        fi
        wt_path=""
        wt_branch=""
        ;;
    esac
  done < <(worktree_list_porcelain)

  popd >/dev/null

  say "==> Done."
  if [[ "$AUTO_PUSH" != "1" ]]; then
    warn "Tip: re-run with AUTO_PUSH=1 to push rebased branches + integration automatically."
  fi
}

main "$@"
