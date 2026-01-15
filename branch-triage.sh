#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-main}"

# Ensure we have latest refs
git fetch --all --prune >/dev/null 2>&1 || true

echo "Base: $BASE"
echo

# Header
printf "%-38s %-10s %-10s %-20s %s\n" "BRANCH" "AHEAD" "BEHIND" "LAST_COMMIT" "SUBJECT"
echo "------------------------------------------------------------------------------------------------------------------------"

# List local branches excluding base + detached
while read -r br; do
  [[ "$br" == "$BASE" ]] && continue

  # ahead/behind vs base
  ahead="$(git rev-list --count "${BASE}..${br}" 2>/dev/null || echo 0)"
  behind="$(git rev-list --count "${br}..${BASE}" 2>/dev/null || echo 0)"

  # last commit time + subject
  last="$(git log -1 --format='%cr' "$br" 2>/dev/null || echo '-')"
  subj="$(git log -1 --format='%s' "$br" 2>/dev/null || echo '-')"

  printf "%-38s %-10s %-10s %-20s %s\n" "$br" "$ahead" "$behind" "$last" "$subj"
done < <(git for-each-ref --format='%(refname:short)' refs/heads | sort)
