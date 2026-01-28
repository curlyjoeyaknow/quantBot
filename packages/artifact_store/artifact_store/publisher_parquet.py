from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Sequence, Tuple

import duckdb

from .hashing import content_hash_from_parquet, sha256_file
from .manifest import (
    artifact_exists_by_file_hash,
    artifact_exists_by_semantic_key,
    connect_manifest,
    apply_migrations,
    insert_artifact,
    insert_lineage,
    insert_tags,
)
from .spec import get_spec

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

def atomic_rename(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    os.replace(str(src), str(dst))

def _write_sidecar(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    atomic_rename(tmp, path)

def _validate_schema(parquet_path: Path, required_cols: Sequence[str]) -> None:
    con = duckdb.connect(database=":memory:")
    cols = [r[0] for r in con.execute(
        f"DESCRIBE SELECT * FROM read_parquet('{parquet_path.as_posix()}')"
    ).fetchall()]
    con.close()
    missing = [c for c in required_cols if c not in cols]
    if missing:
        raise ValueError(f"Parquet missing required columns: {missing}")

def publish_parquet_file(
    *,
    manifest_db: Path,
    manifest_sql: Path,
    artifacts_root: Path,

    artifact_type: str,
    schema_version: int,
    logical_key: str,

    parquet_path: Path,
    tags: Optional[Iterable[Tuple[str, str]]] = None,
    input_artifact_ids: Optional[Sequence[str]] = None,

    writer_name: str,
    writer_version: str,
    git_commit: str,
    git_dirty: bool,
    params: Optional[Dict[str, Any]] = None,

    filename_hint: Optional[str] = None,
    status: str = "active",
) -> Dict[str, Any]:
    """
    Publish an existing Parquet file as an immutable artifact.
    - Validates schema against spec
    - Computes file_hash + content_hash + min/max/rows
    - Semantic dedupe (artifact_type, logical_key, content_hash)
    - Byte dedupe (file_hash)
    - Copies into artifacts_root via temp + atomic rename
    - Writes sidecar
    - Records SQLite manifest rows transactionally
    """
    spec = get_spec(artifact_type)
    parquet_path = parquet_path.resolve()

    # Validate required columns exist
    _validate_schema(parquet_path, spec.canonical_cols)

    # Compute hashes and stats from the source parquet
    file_hash = sha256_file(parquet_path)
    content_hash, row_count, min_ts, max_ts = content_hash_from_parquet(
        parquet_path=parquet_path,
        spec=spec,
    )

    con = connect_manifest(manifest_db)
    apply_migrations(con, manifest_sql)

    # 1) Exact-file dedupe
    existing = artifact_exists_by_file_hash(con, file_hash)
    if existing is not None:
        con.close()
        return {"deduped": True, "mode": "file_hash", "existing_artifact_id": existing, "file_hash": file_hash}

    # 2) Semantic dedupe
    existing2 = artifact_exists_by_semantic_key(
        con,
        artifact_type=artifact_type,
        logical_key=logical_key,
        content_hash=content_hash,
    )
    if existing2 is not None:
        con.close()
        return {"deduped": True, "mode": "content_hash", "existing_artifact_id": existing2, "content_hash": content_hash}

    # Destination paths
    base_dir = artifacts_root / artifact_type / f"v{schema_version}"
    tmp_dir = base_dir / "_tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    artifact_id = str(uuid.uuid4())
    created_at = utc_now_iso()

    ch_short = content_hash.split(":", 1)[1][:8]
    safe_hint = (filename_hint or logical_key).replace("/", "_").replace(" ", "_")
    final_name = f"{artifact_type}__v{schema_version}__{safe_hint}__ch={ch_short}.parquet"
    final_parquet = base_dir / final_name
    final_sidecar = final_parquet.with_suffix(".json")

    # Copy source parquet to tmp, then atomic rename
    tmp_parquet = tmp_dir / f"{final_name}.tmp"
    shutil.copy2(parquet_path, tmp_parquet)
    atomic_rename(tmp_parquet, final_parquet)

    sidecar: Dict[str, Any] = {
        "artifact_id": artifact_id,
        "artifact_type": artifact_type,
        "schema_version": schema_version,
        "status": status,
        "logical_key": logical_key,
        "created_at": created_at,
        "identity": {
            "file_hash": file_hash,
            "content_hash": content_hash,
            "row_count": row_count,
            "min_ts": min_ts,
            "max_ts": max_ts,
            "canonical_cols": list(spec.canonical_cols),
            "sort_keys": list(spec.sort_keys),
        },
        "provenance": {
            "writer": {"name": writer_name, "version": writer_version},
            "git": {"commit": git_commit, "dirty": bool(git_dirty)},
            "params": params or {},
            "inputs": list(input_artifact_ids or []),
        },
        "paths": {"parquet": final_parquet.as_posix(), "sidecar": final_sidecar.as_posix()},
        "source": {"original_path": parquet_path.as_posix()},
    }

    _write_sidecar(final_sidecar, sidecar)

    with con:
        insert_artifact(
            con,
            artifact_id=artifact_id,
            artifact_type=artifact_type,
            schema_version=schema_version,
            logical_key=logical_key,
            status=status,
            path_parquet=final_parquet.as_posix(),
            path_sidecar=final_sidecar.as_posix(),
            file_hash=file_hash,
            content_hash=content_hash,
            row_count=row_count,
            min_ts=min_ts,
            max_ts=max_ts,
        )
        if tags:
            insert_tags(con, artifact_id, tags)
        if input_artifact_ids:
            insert_lineage(con, artifact_id, input_artifact_ids)

    con.close()
    return sidecar
