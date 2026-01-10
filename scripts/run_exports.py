#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import duckdb
import sys

# Add scripts directory to path for db_lock import
sys.path.insert(0, str(Path(__file__).parent))
from db_lock import WriterLock


def read_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def run_exports(con: duckdb.DuckDBPyConnection, export_cfg: dict):
    if not export_cfg or not export_cfg.get("enabled"):
        print("[run_exports] export disabled")
        return

    export_dir = Path(export_cfg.get("export_dir", "data/exports"))
    export_dir.mkdir(parents=True, exist_ok=True)

    for job in export_cfg.get("jobs", []):
        name = job.get("name", "unnamed")
        out_path = export_dir / job.get("path", f"{name}.parquet")
        sql = job.get("sql")
        if not sql:
            print(f"[run_exports] {name}: missing sql")
            continue
        out_str = str(out_path).replace("'", "''")
        con.execute(f"COPY ({sql}) TO '{out_str}' (FORMAT PARQUET);")
        print(f"[run_exports] wrote {out_path}")


def main():
    cfg = read_json(Path("scripts/bus_config.json"))
    duckdb_path = cfg["duckdb_path"]
    lock_path = duckdb_path + ".writer.lock"

    with WriterLock(lock_path, meta={"task": "manual_exports"}, timeout_s=int(cfg.get("lock_timeout_s", 120))):
        con = duckdb.connect(duckdb_path)
        try:
            run_exports(con, cfg.get("export", {}))
        finally:
            con.close()


if __name__ == "__main__":
    main()

