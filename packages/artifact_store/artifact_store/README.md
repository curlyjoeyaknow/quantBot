# Artifact Store v1 (Parquet Truth + SQLite Manifest + DuckDB Writer/Reader)

## What this is
- Immutable Parquet artifacts are the source of truth.
- SQLite is the authoritative receipt book (manifest).
- DuckDB is used for writing Parquet and for deterministic content hashing.

DuckDB databases are *not* included here on purpose: treat them as rebuildable caches.

## Install deps
You need:
- python3
- duckdb python package
- pandas (for the CLI helper)

## Initialize the manifest
python3 -m artifact_store.bin.artifacts_cli init \
  --manifest-db ./opn/manifest/manifest.sqlite \
  --manifest-sql ./artifact_store/sql/manifest_v1.sql

## Publish a CSV (dev helper)
python3 -m artifact_store.bin.artifacts_cli publish-csv \
  --manifest-db ./opn/manifest/manifest.sqlite \
  --manifest-sql ./artifact_store/sql/manifest_v1.sql \
  --artifacts-root ./opn/artifacts \
  --artifact-type ohlcv_slice \
  --schema-version 2 \
  --logical-key "token=4Zee.../res=1s/from=2026-01-26T00:00:00Z/to=2026-01-26T01:23:19Z" \
  --csv ./tmp/slice.csv \
  --writer-name slice_exporter \
  --writer-version 0.1.0 \
  --git-commit a1b2c3d \
  --params-json '{"resolution":"1s","source":"clickhouse","table":"ohlcv_1s"}' \
  --tag res=1s --tag kind=ohlcv_slice

## Notes
- Dedupe is by file_hash (exact bytes). Semantic dedupe is enabled via content_hash.
- content_hash is computed by reading Parquet deterministically (ORDER BY sort_keys) and hashing canonical columns.
- If you change DuckDB version, Parquet bytes might change; content_hash should remain stable if the data is the same.

## Next improvements (when you’re ready)
- Add an "indexer" that scans artifacts_root and backfills manifest (sidecar-first).
- Add a "supersede" command that marks older artifacts inactive without deleting files.
- Add optional per-column stats / checks.
