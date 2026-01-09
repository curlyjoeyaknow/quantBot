#!/usr/bin/env python3
from __future__ import annotations

import json
import time
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import duckdb
import sys

# Add scripts directory to path for db_lock import
sys.path.insert(0, str(Path(__file__).parent))
from db_lock import WriterLock


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(p: Path) -> Dict[str, Any]:
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(p: Path, obj: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def ensure_dirs(root: Path) -> Dict[str, Path]:
    inbox = root / "inbox"
    processed = root / "processed"
    rejected = root / "rejected"
    store = root / "store" / "runs"
    for d in (inbox, processed, rejected, store):
        d.mkdir(parents=True, exist_ok=True)
    return {"inbox": inbox, "processed": processed, "rejected": rejected, "store": store}


def is_committed(job_dir: Path) -> bool:
    return (job_dir / "COMMIT").exists()


def validate_manifest(m: Dict[str, Any], job_dir: Path) -> List[str]:
    errs = []
    for k in ("run_id", "job_id", "producer", "kind", "created_at_utc", "artifacts"):
        if k not in m:
            errs.append(f"missing field: {k}")
    if not isinstance(m.get("artifacts"), list) or len(m.get("artifacts", [])) == 0:
        errs.append("artifacts must be non-empty list")

    for a in m.get("artifacts", []):
        for k in ("artifact_id", "format", "relpath"):
            if k not in a:
                errs.append(f"artifact missing {k}")
        rel = a.get("relpath")
        if rel:
            fp = job_dir / rel
            if not fp.exists():
                errs.append(f"artifact file missing: {rel}")
    return errs


def ensure_catalog_schema(con: duckdb.DuckDBPyConnection) -> None:
    # Minimal catalog tables, safe to call repeatedly
    con.execute("CREATE SCHEMA IF NOT EXISTS catalog;")
    con.execute("""
      CREATE TABLE IF NOT EXISTS catalog.runs_d (
        run_id           VARCHAR PRIMARY KEY,
        producer         VARCHAR,
        created_at_utc   TIMESTAMP,
        meta_json        VARCHAR,
        first_seen_at    TIMESTAMP DEFAULT now(),
        last_seen_at     TIMESTAMP DEFAULT now()
      );
    """)
    con.execute("""
      CREATE TABLE IF NOT EXISTS catalog.artifacts_f (
        artifact_key     VARCHAR PRIMARY KEY,
        run_id           VARCHAR,
        artifact_id      VARCHAR,
        producer         VARCHAR,
        kind             VARCHAR,
        format           VARCHAR,
        canonical_path   VARCHAR,
        rows             BIGINT,
        schema_hint      VARCHAR,
        created_at_utc   TIMESTAMP,
        ingested_at      TIMESTAMP DEFAULT now(),
        meta_json        VARCHAR
      );
    """)
    con.execute("""
      CREATE VIEW IF NOT EXISTS catalog.latest_artifacts_v AS
      WITH ranked AS (
        SELECT
          *,
          row_number() OVER (PARTITION BY producer, kind, artifact_id ORDER BY created_at_utc DESC, ingested_at DESC) AS rn
        FROM catalog.artifacts_f
      ) SELECT * FROM ranked WHERE rn=1;
    """)


def canonicalize_and_catalog(
    con: duckdb.DuckDBPyConnection,
    bus_dirs: Dict[str, Path],
    job_dir: Path,
    manifest: Dict[str, Any],
) -> None:
    run_id = manifest["run_id"]
    producer = manifest.get("producer")
    kind = manifest.get("kind")
    created_at = manifest.get("created_at_utc")
    manifest_meta = manifest.get("meta", {})

    # Check for metadata.json file (backtest commands create this)
    metadata_path = job_dir / "metadata.json"
    metadata_content = None
    if metadata_path.exists():
        metadata_content = read_json(metadata_path)
        # Merge metadata.json into manifest meta
        manifest_meta = {**manifest_meta, **metadata_content}

    meta_json = json.dumps(manifest_meta, ensure_ascii=False)

    # Upsert run with metadata (daemon writes metadata.json content to catalog)
    con.execute(
        """
        INSERT INTO catalog.runs_d (run_id, producer, created_at_utc, meta_json, last_seen_at)
        VALUES (?, ?, ?, ?, now())
        ON CONFLICT(run_id) DO UPDATE SET
          producer=excluded.producer,
          created_at_utc=excluded.created_at_utc,
          meta_json=excluded.meta_json,
          last_seen_at=now();
        """,
        [run_id, producer, created_at, meta_json],
    )

    run_store = bus_dirs["store"] / run_id
    run_store.mkdir(parents=True, exist_ok=True)
    
    # Write meta.json in canonical store (includes metadata.json content if present)
    write_json(run_store / "meta.json", {
        "run_id": run_id,
        "producer": producer,
        "kind": kind,
        "created_at_utc": created_at,
        "ingested_at_utc": utc_now_iso(),
        "meta": manifest_meta,
        "job_id": manifest.get("job_id"),
        "has_metadata_json": metadata_content is not None,
    })

    # Move metadata.json to canonical store if it exists
    if metadata_path.exists():
        shutil.move(str(metadata_path), str(run_store / "metadata.json"))

    seq = 0
    for a in manifest["artifacts"]:
        seq += 1
        artifact_id = a["artifact_id"]
        fmt = a.get("format", "parquet")
        relpath = a["relpath"]
        schema_hint = a.get("schema_hint")
        rows = a.get("rows")

        a_meta = a.copy()
        a_meta.pop("relpath", None)

        src = job_dir / relpath
        art_dir = run_store / "artifacts" / artifact_id
        art_dir.mkdir(parents=True, exist_ok=True)

        dst = art_dir / f"data.{fmt}"
        if dst.exists():
            dst.unlink()
        shutil.move(str(src), str(dst))

        # optional schema json alongside parquet
        schema_path = job_dir / (Path(relpath).with_suffix(".schema.json").name)
        if schema_path.exists():
            shutil.move(str(schema_path), str(art_dir / "schema.json"))

        artifact_key = f"{run_id}:{artifact_id}:{seq}"
        canonical_path = str(dst)

        # Add metadata.json reference if this artifact has one
        if metadata_content and a_meta.get("metadataFile") == "metadata.json":
            a_meta["metadata_json_path"] = str(run_store / "metadata.json")

        con.execute(
            """
            INSERT INTO catalog.artifacts_f (
              artifact_key, run_id, artifact_id, producer, kind, format,
              canonical_path, rows, schema_hint, created_at_utc, meta_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(artifact_key) DO NOTHING;
            """,
            [
                artifact_key, run_id, artifact_id, producer, kind, fmt,
                canonical_path, rows, schema_hint, created_at, json.dumps(a_meta, ensure_ascii=False)
            ],
        )


def run_exports(con: duckdb.DuckDBPyConnection, export_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Regenerates golden Parquet exports from SQL.
    Uses COPY (SELECT ...) TO 'path' (FORMAT PARQUET).
    """
    if not export_cfg or not export_cfg.get("enabled"):
        return []

    export_dir = Path(export_cfg.get("export_dir", "data/exports"))
    export_dir.mkdir(parents=True, exist_ok=True)

    results: List[Dict[str, Any]] = []
    for job in export_cfg.get("jobs", []):
        name = job.get("name", "unnamed")
        out_path = export_dir / job.get("path", f"{name}.parquet")
        sql = job.get("sql")
        if not sql:
            results.append({"name": name, "ok": False, "error": "missing sql"})
            continue

        try:
            # DuckDB COPY requires a file path string literal; we embed safely by escaping single quotes
            out_str = str(out_path).replace("'", "''")
            con.execute(f"COPY ({sql}) TO '{out_str}' (FORMAT PARQUET);")
            results.append({"name": name, "ok": True, "path": str(out_path)})
        except Exception as e:
            results.append({"name": name, "ok": False, "error": str(e)})

    # write a tiny status file for humans
    status_path = export_dir / "_export_status.json"
    with status_path.open("w", encoding="utf-8") as f:
        json.dump({"ran_at_utc": utc_now_iso(), "results": results}, f, indent=2)

    return results


def process_one_job(config: Dict[str, Any], job_dir: Path) -> Optional[str]:
    manifest_path = job_dir / "manifest.json"
    if not manifest_path.exists():
        return f"missing manifest.json in {job_dir.name}"

    manifest = read_json(manifest_path)
    errs = validate_manifest(manifest, job_dir)
    if errs:
        return "manifest invalid: " + "; ".join(errs)

    bus_root = Path(config["bus_root"])
    bus_dirs = ensure_dirs(bus_root)

    duckdb_path = config["duckdb_path"]
    lock_path = duckdb_path + ".writer.lock"

    with WriterLock(lock_path, meta={"task": "bus_ingest", "job_dir": str(job_dir)}, timeout_s=int(config.get("lock_timeout_s", 120))):
        con = duckdb.connect(duckdb_path)
        try:
            ensure_catalog_schema(con)
            canonicalize_and_catalog(con, bus_dirs, job_dir, manifest)

            # 🔥 Golden exports (always after successful ingest)
            run_exports(con, config.get("export", {}))
        finally:
            con.close()

    dest = bus_dirs["processed"] / job_dir.name
    if dest.exists():
        shutil.rmtree(dest)
    shutil.move(str(job_dir), str(dest))
    return None


def main() -> int:
    cfg_path = Path("scripts/bus_config.json")
    if not cfg_path.exists():
        print("missing scripts/bus_config.json", flush=True)
        return 2

    config = read_json(cfg_path)
    bus_root = Path(config["bus_root"])
    bus_dirs = ensure_dirs(bus_root)

    poll = float(config.get("poll_interval_s", 1.0))
    print(f"[bus_daemon] up. inbox={bus_dirs['inbox']} duckdb={config['duckdb_path']}", flush=True)

    while True:
        try:
            for job_dir in sorted([p for p in bus_dirs["inbox"].iterdir() if p.is_dir()]):
                if not is_committed(job_dir):
                    continue
                err = process_one_job(config, job_dir)
                if err:
                    rej_dir = bus_dirs["rejected"] / job_dir.name
                    if rej_dir.exists():
                        shutil.rmtree(rej_dir)
                    shutil.move(str(job_dir), str(rej_dir))
                    write_json(rej_dir / "REJECT_REASON.json", {"error": err, "rejected_at_utc": utc_now_iso()})
                    print(f"[bus_daemon] rejected {job_dir.name}: {err}", flush=True)
                else:
                    print(f"[bus_daemon] processed {job_dir.name} + exports refreshed", flush=True)

            time.sleep(poll)
        except KeyboardInterrupt:
            print("[bus_daemon] bye", flush=True)
            return 0
        except Exception as e:
            print(f"[bus_daemon] error: {e}", flush=True)
            time.sleep(1.0)


if __name__ == "__main__":
    raise SystemExit(main())

