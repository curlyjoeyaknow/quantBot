from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pandas as pd

from artifact_store.manifest import connect_manifest, apply_migrations
from artifact_store.publisher import publish_dataframe

def cmd_init(args: argparse.Namespace) -> None:
    con = connect_manifest(Path(args.manifest_db))
    apply_migrations(con, Path(args.manifest_sql))
    con.close()
    print("ok: manifest initialized")

def cmd_publish_csv(args: argparse.Namespace) -> None:
    df = pd.read_csv(args.csv)
    tags: List[Tuple[str,str]] = []
    for kv in args.tag or []:
        k, v = kv.split("=", 1)
        tags.append((k, v))

    sidecar = publish_dataframe(
        manifest_db=Path(args.manifest_db),
        manifest_sql=Path(args.manifest_sql),
        artifacts_root=Path(args.artifacts_root),

        artifact_type=args.artifact_type,
        schema_version=int(args.schema_version),
        logical_key=args.logical_key,

        df=df,
        tags=tags,
        input_artifact_ids=args.input_artifact_id or [],

        writer_name=args.writer_name,
        writer_version=args.writer_version,
        git_commit=args.git_commit,
        git_dirty=bool(args.git_dirty),
        params=json.loads(args.params_json) if args.params_json else {},
        filename_hint=args.filename_hint,
    )
    print(json.dumps(sidecar, indent=2, sort_keys=True))

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="artifacts")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="Initialize / migrate the SQLite manifest")
    p_init.add_argument("--manifest-db", required=True)
    p_init.add_argument("--manifest-sql", required=True)
    p_init.set_defaults(fn=cmd_init)

    p_pub = sub.add_parser("publish-csv", help="Publish a CSV as a Parquet artifact (dev/test helper)")
    p_pub.add_argument("--manifest-db", required=True)
    p_pub.add_argument("--manifest-sql", required=True)
    p_pub.add_argument("--artifacts-root", required=True)

    p_pub.add_argument("--artifact-type", required=True, help="alerts | ohlcv_slice | run_metrics (extend in spec.py)")
    p_pub.add_argument("--schema-version", required=True, type=int)
    p_pub.add_argument("--logical-key", required=True)

    p_pub.add_argument("--csv", required=True)
    p_pub.add_argument("--filename-hint", default=None)

    p_pub.add_argument("--tag", action="append", help="k=v (repeatable)")
    p_pub.add_argument("--input-artifact-id", action="append")

    p_pub.add_argument("--writer-name", required=True)
    p_pub.add_argument("--writer-version", required=True)
    p_pub.add_argument("--git-commit", required=True)
    p_pub.add_argument("--git-dirty", action="store_true")
    p_pub.add_argument("--params-json", default=None, help='JSON string of material params')

    p_pub.set_defaults(fn=cmd_publish_csv)

    return p

def main() -> None:
    p = build_parser()
    args = p.parse_args()
    args.fn(args)

if __name__ == "__main__":
    main()
