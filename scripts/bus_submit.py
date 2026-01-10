#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from datetime import datetime, timezone


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--bus-root", default="data/bus")
    p.add_argument("--job-id", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--producer", required=True)
    p.add_argument("--kind", required=True)
    p.add_argument("--artifact-id", required=True)
    p.add_argument("--parquet", required=True, help="path to parquet file to submit")
    p.add_argument("--schema-hint", default="")
    p.add_argument("--rows", type=int, default=0)
    p.add_argument("--meta-json", default="{}")
    args = p.parse_args()

    bus_root = Path(args.bus_root)
    inbox = bus_root / "inbox"
    job_dir = inbox / args.job_id
    tmp_dir = job_dir

    if job_dir.exists():
        shutil.rmtree(job_dir)
    job_dir.mkdir(parents=True, exist_ok=True)

    parquet_src = Path(args.parquet)
    parquet_dst = tmp_dir / f"{args.artifact_id}.parquet"
    shutil.copy2(parquet_src, parquet_dst)

    try:
        meta = json.loads(args.meta_json)
    except Exception:
        meta = {"raw": args.meta_json}

    manifest = {
        "run_id": args.run_id,
        "job_id": args.job_id,
        "producer": args.producer,
        "kind": args.kind,
        "created_at_utc": utc_now_iso(),
        "artifacts": [{
            "artifact_id": args.artifact_id,
            "format": "parquet",
            "relpath": parquet_dst.name,
            "schema_hint": args.schema_hint,
            "rows": args.rows
        }],
        "meta": meta
    }

    (tmp_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (tmp_dir / "COMMIT").write_text("ok\n", encoding="utf-8")
    print(f"[bus_submit] committed job {args.job_id} -> {job_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

