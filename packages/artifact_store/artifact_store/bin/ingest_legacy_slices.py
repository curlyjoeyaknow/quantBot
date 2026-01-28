from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import duckdb

from artifact_store.publisher_parquet import publish_parquet_file


def infer_logical_key_and_tags(p: Path):
    con = duckdb.connect(database=":memory:")
    row = con.execute(
        f"""
        SELECT
          ANY_VALUE(token_address) AS token_address,
          MIN(timestamp) AS mn,
          MAX(timestamp) AS mx
        FROM read_parquet('{p.as_posix()}')
        """
    ).fetchone()
    con.close()

    token = row[0]
    mn = row[1].strftime("%Y-%m-%dT%H:%M:%S.000000Z")
    mx = row[2].strftime("%Y-%m-%dT%H:%M:%S.000000Z")

    logical_key = f"token={token}/res=1m/from={mn}/to={mx}"
    tags = [
        ("token", token),
        ("res", "1m"),
        ("kind", "ohlcv_slice"),
        ("format", "v2"),
        ("source", "legacy_slices"),
    ]
    return logical_key, tags


def safe_print_line(obj) -> None:
    # Print JSON lines; ignore BrokenPipe so piping to `head` doesn't kill the job.
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        finally:
            raise SystemExit(0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-dir", required=True)
    ap.add_argument("--manifest-db", required=True)
    ap.add_argument("--manifest-sql", required=True)
    ap.add_argument("--artifacts-root", required=True)
    ap.add_argument("--git-commit", required=True)
    ap.add_argument("--git-dirty", action="store_true")
    args = ap.parse_args()

    indir = Path(args.input_dir)
    files = sorted(indir.glob("*.parquet"))
    if not files:
        raise SystemExit(f"No parquet files found in: {indir}")

    for p in files:
        logical_key, tags = infer_logical_key_and_tags(p)
        out = publish_parquet_file(
            manifest_db=Path(args.manifest_db),
            manifest_sql=Path(args.manifest_sql),
            artifacts_root=Path(args.artifacts_root),
            artifact_type="ohlcv_slice_v2",
            schema_version=2,
            logical_key=logical_key,
            parquet_path=p,
            tags=tags,
            writer_name="legacy_slice_ingestor",
            writer_version="1.0.0",
            git_commit=args.git_commit,
            git_dirty=args.git_dirty,
            params={"ingest": "legacy_per_token_v2"},
            filename_hint=logical_key.replace("/", "_"),
        )
        safe_print_line({"file": p.name, "result": out})


if __name__ == "__main__":
    main()
