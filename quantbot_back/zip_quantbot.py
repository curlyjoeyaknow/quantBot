#!/usr/bin/env python3
"""
Create a .zip of a project directory (default: ./quantBot) while:
- NOT using .gitignore rules (i.e., we do not parse or honor .gitignore)
- Excluding the data/ directory
- Excluding common build artifact directories
- Excluding any file > --max-mb (default: 10 MB)

Usage examples:
  python3 zip_quantbot.py
  python3 zip_quantbot.py --root ./quantBot --output quantBot_backup.zip
  python3 zip_quantbot.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import zipfile
from pathlib import Path
from fnmatch import fnmatch

DEFAULT_EXCLUDE_DIRS = {
    # requested
    "data",

    # git + common junk
    ".git",

    # node/js build + caches
    "node_modules",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".vite",
    ".rollup.cache",
    "coverage",

    # python
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    "venv",

    # rust
    "target",

    # misc tooling
    ".pnpm-store",
}

DEFAULT_EXCLUDE_FILE_PATTERNS = {
    # build artifacts / generated files
    "*.tsbuildinfo",
    "*.pyc",
    "*.pyo",

    # avoid zipping prior archives inside archives
    "*.zip",
    "*.tar",
    "*.tar.gz",
    "*.tgz",
    "*.7z",
}

def is_under_any_dir(rel_parts: tuple[str, ...], excluded_dirs: set[str]) -> bool:
    # If any path component equals an excluded dir name, skip.
    return any(part in excluded_dirs for part in rel_parts)

def matches_any_pattern(name: str, patterns: set[str]) -> bool:
    return any(fnmatch(name, pat) for pat in patterns)

def human_bytes(n: int) -> str:
    # Simple binary units
    for unit in ["B", "KiB", "MiB", "GiB"]:
        if n < 1024 or unit == "GiB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n/1024:.2f}{unit}"
        n /= 1024
    return f"{n:.2f}GiB"

def main() -> int:
    ap = argparse.ArgumentParser(description="Zip quantBot directory excluding data/, build artifacts, and files > 10MB.")
    ap.add_argument("--root", default="./quantBot", help="Project root directory to zip (default: ./quantBot)")
    ap.add_argument("--output", default=None, help="Output zip filename (default: quantBot_YYYYmmdd_HHMMSS.zip next to root)")
    ap.add_argument("--max-mb", type=float, default=10.0, help="Max file size (MB) to include (default: 10)")
    ap.add_argument("--dry-run", action="store_true", help="Print what would be included/excluded without creating zip")
    ap.add_argument("--verbose", action="store_true", help="Print every included file (can be noisy)")
    ap.add_argument("--extra-exclude-dir", action="append", default=[], help="Additional directory name to exclude (repeatable)")
    ap.add_argument("--extra-exclude-pattern", action="append", default=[], help="Additional filename glob to exclude (repeatable)")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.exists() or not root.is_dir():
        print(f"ERROR: root directory does not exist or is not a directory: {root}", file=sys.stderr)
        return 2

    excluded_dirs = set(DEFAULT_EXCLUDE_DIRS) | set(args.extra_exclude_dir or [])
    excluded_patterns = set(DEFAULT_EXCLUDE_FILE_PATTERNS) | set(args.extra_exclude_pattern or [])

    max_bytes = int(args.max_mb * 1024 * 1024)

    if args.output:
        out_zip = Path(args.output).resolve()
    else:
        ts = time.strftime("%Y%m%d_%H%M%S")
        out_zip = root.parent / f"{root.name}_{ts}.zip"

    # Collect candidates first (lets us report stats, and makes dry-run clean)
    included: list[tuple[Path, str, int]] = []
    skipped: list[tuple[str, str]] = []  # (zip_path, reason)

    for path in root.rglob("*"):
        try:
            rel = path.relative_to(root)
        except Exception:
            continue

        # Skip excluded directories early
        rel_parts = rel.parts
        if rel_parts and is_under_any_dir(rel_parts, excluded_dirs):
            # If it's a directory or file under an excluded dir, skip
            skipped.append((rel.as_posix(), "excluded_dir"))
            continue

        # Skip symlinks (prevents zipping weird outside-tree targets)
        if path.is_symlink():
            skipped.append((rel.as_posix(), "symlink"))
            continue

        # Skip directories (zip writes files only)
        if path.is_dir():
            continue

        name = path.name

        # Skip via filename patterns
        if matches_any_pattern(name, excluded_patterns):
            skipped.append((rel.as_posix(), "excluded_pattern"))
            continue

        # Size filter
        try:
            size = path.stat().st_size
        except OSError:
            skipped.append((rel.as_posix(), "stat_failed"))
            continue

        if size > max_bytes:
            skipped.append((rel.as_posix(), f"too_large>{args.max_mb}MB"))
            continue

        zip_path = rel.as_posix()
        included.append((path, zip_path, size))

    # Report
    total_in = sum(s for _, _, s in included)
    print(f"Root:     {root}")
    print(f"Output:   {out_zip}")
    print(f"Max file: {args.max_mb} MB")
    print(f"Include:  {len(included)} files, ~{human_bytes(total_in)}")
    print(f"Skip:     {len(skipped)} entries (dirs/files under excluded dirs count as skips)")

    if args.verbose or args.dry_run:
        if included:
            print("\nIncluded files:")
            for _, zp, sz in included:
                if args.verbose or args.dry_run:
                    print(f"  + {zp} ({human_bytes(sz)})")
        if skipped:
            print("\nSkipped (sample up to 200):")
            for zp, reason in skipped[:200]:
                print(f"  - {zp} [{reason}]")
            if len(skipped) > 200:
                print(f"  ... {len(skipped) - 200} more")

    if args.dry_run:
        print("\nDry-run complete (no zip created).")
        return 0

    # Create zip
    out_zip.parent.mkdir(parents=True, exist_ok=True)

    # If output is inside the root, ensure it won't get included (we excluded *.zip anyway)
    compression = zipfile.ZIP_DEFLATED

    with zipfile.ZipFile(out_zip, "w", compression=compression, compresslevel=6) as zf:
        for src_path, zip_path, _ in included:
            # Ensure stable permissions metadata across OS a bit
            zi = zipfile.ZipInfo(zip_path)
            st = src_path.stat()
            # Preserve basic mtime
            mtime = time.localtime(st.st_mtime)
            zi.date_time = (mtime.tm_year, mtime.tm_mon, mtime.tm_mday, mtime.tm_hour, mtime.tm_min, mtime.tm_sec)
            # Unix permissions (regular file)
            zi.external_attr = (st.st_mode & 0xFFFF) << 16

            with src_path.open("rb") as f:
                data = f.read()
            zf.writestr(zi, data)

    final_size = out_zip.stat().st_size
    print(f"\n✅ Created: {out_zip} ({human_bytes(final_size)})")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
