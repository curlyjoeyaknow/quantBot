#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -d packages ]; then
  echo "No ./packages directory found."
  exit 1
fi

echo "== package count =="
find packages -maxdepth 2 -name package.json | wc -l | awk '{print "packages: " $1}'
echo

echo "== packages by size (top 25) =="
# size by directory (human)
du -sh packages/* 2>/dev/null | sort -hr | head -n 25
echo

echo "== small packages (<= 200KB) =="
# merge candidates: tiny packages that likely don't deserve boundary
while IFS= read -r d; do
  sz_kb="$(du -sk "$d" | awk '{print $1}')"
  if [ "$sz_kb" -le 200 ]; then
    echo "$(printf '%6sKB' "$sz_kb")  $d"
  fi
done < <(find packages -maxdepth 1 -mindepth 1 -type d | sort)
echo

echo "== deps per package.json (name -> workspace deps) =="
node - <<'NODE'
const fs = require('fs');
const path = require('path');

function readJSON(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }

const pkgsDir = path.join(process.cwd(), 'packages');
const pkgDirs = fs.readdirSync(pkgsDir)
  .map(n => path.join(pkgsDir, n))
  .filter(p => fs.existsSync(path.join(p,'package.json')));

const pkgs = pkgDirs.map(d => {
  const j = readJSON(path.join(d,'package.json'));
  return { dir: d, name: j.name || path.basename(d), deps: Object.assign({}, j.dependencies||{}, j.devDependencies||{}) };
});

const names = new Set(pkgs.map(p => p.name));
for (const p of pkgs.sort((a,b)=>a.name.localeCompare(b.name))) {
  const wsDeps = Object.keys(p.deps).filter(d => names.has(d));
  console.log(`${p.name} -> ${wsDeps.length ? wsDeps.join(', ') : '(none)'}`);
}
NODE
