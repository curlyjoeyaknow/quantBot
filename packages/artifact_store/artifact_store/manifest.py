from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable, Optional, Tuple

MANIFEST_SCHEMA_VERSION = 1

def connect_manifest(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA synchronous=NORMAL;")
    con.execute("PRAGMA foreign_keys=ON;")
    con.execute("PRAGMA busy_timeout=5000;")  # ms
    return con

def apply_migrations(con: sqlite3.Connection, sql_path: Path) -> None:
    con.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);"
    )
    row = con.execute("SELECT MAX(version) AS v FROM schema_migrations;").fetchone()
    current = int(row["v"] or 0)

    target = MANIFEST_SCHEMA_VERSION
    if current >= target:
        return

    sql = sql_path.read_text(encoding="utf-8")
    with con:
        con.executescript(sql)
        con.execute(
            "INSERT OR REPLACE INTO schema_migrations(version, applied_at) "
            "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'));",
            (target,),
        )

def artifact_exists_by_file_hash(con: sqlite3.Connection, file_hash: str) -> Optional[str]:
    row = con.execute("SELECT artifact_id FROM artifacts WHERE file_hash = ?;", (file_hash,)).fetchone()
    return None if row is None else str(row["artifact_id"])

def artifact_exists_by_semantic_key(
    con: sqlite3.Connection, *, artifact_type: str, logical_key: str, content_hash: str
) -> Optional[str]:
    row = con.execute(
        "SELECT artifact_id FROM artifacts WHERE artifact_type = ? AND logical_key = ? AND content_hash = ? LIMIT 1;",
        (artifact_type, logical_key, content_hash),
    ).fetchone()
    return None if row is None else str(row["artifact_id"])

def insert_artifact(
    con: sqlite3.Connection,
    *,
    artifact_id: str,
    artifact_type: str,
    schema_version: int,
    logical_key: str,
    status: str,
    path_parquet: str,
    path_sidecar: str,
    file_hash: str,
    content_hash: str,
    row_count: int,
    min_ts: Optional[str],
    max_ts: Optional[str],
) -> None:
    con.execute(
        """
        INSERT INTO artifacts(
          artifact_id, artifact_type, schema_version, logical_key, status,
          path_parquet, path_sidecar,
          file_hash, content_hash,
          row_count, min_ts, max_ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """,
        (
            artifact_id, artifact_type, schema_version, logical_key, status,
            path_parquet, path_sidecar,
            file_hash, content_hash,
            row_count, min_ts, max_ts
        ),
    )

def insert_tags(con: sqlite3.Connection, artifact_id: str, tags: Iterable[Tuple[str,str]]) -> None:
    con.executemany(
        "INSERT OR IGNORE INTO artifact_tags(artifact_id, k, v) VALUES (?, ?, ?);",
        [(artifact_id, k, v) for (k, v) in tags],
    )

def insert_lineage(con: sqlite3.Connection, artifact_id: str, inputs: Iterable[str]) -> None:
    con.executemany(
        "INSERT OR IGNORE INTO artifact_lineage(artifact_id, input_artifact_id) VALUES (?, ?);",
        [(artifact_id, inp) for inp in inputs],
    )

def supersede(con: sqlite3.Connection, *, new_artifact_id: str, old_artifact_id: str) -> None:
    with con:
        con.execute("UPDATE artifacts SET status='superseded' WHERE artifact_id = ?;", (old_artifact_id,))
        con.execute(
            "INSERT OR REPLACE INTO artifact_supersedes(artifact_id, supersedes_artifact_id) VALUES (?, ?);",
            (new_artifact_id, old_artifact_id),
        )
