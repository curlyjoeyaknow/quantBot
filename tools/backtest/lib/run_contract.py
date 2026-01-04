"""
Run Contract - Sacred run persistence.

Every run MUST persist:
- run_id, run_name, date_from/to, interval, horizon, entry_mode
- alerts_total/ok/missing
- fingerprint of slice + query params

"What produced this number?" should never be a mystery.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import duckdb

UTC = timezone.utc


# =============================================================================
# Run Identity (immutable, defines "what produced this")
# =============================================================================

@dataclass(frozen=True)
class RunIdentity:
    """
    Immutable identity of a run. Two runs with same identity should produce same results.
    
    This is the "fingerprint" - if any of these change, it's a different run.
    """
    # Time window
    date_from: str  # YYYY-MM-DD
    date_to: str    # YYYY-MM-DD
    
    # Candle params
    interval_seconds: int
    horizon_hours: int
    
    # Entry mode
    entry_mode: str  # 'immediate' | 'next_open' | 'dip_N' etc
    
    # Data source fingerprint
    chain: str
    slice_fingerprint: str  # Hash of slice path + token set
    
    # Query params that affect results
    tp_mult: Optional[float] = None
    sl_mult: Optional[float] = None
    fee_bps: float = 30.0
    slippage_bps: float = 50.0
    intrabar_order: str = "sl_first"
    
    def compute_fingerprint(self) -> str:
        """Compute a deterministic fingerprint for this run identity."""
        data = json.dumps({
            "date_from": self.date_from,
            "date_to": self.date_to,
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            "entry_mode": self.entry_mode,
            "chain": self.chain,
            "slice_fingerprint": self.slice_fingerprint,
            "tp_mult": self.tp_mult,
            "sl_mult": self.sl_mult,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "intrabar_order": self.intrabar_order,
        }, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(data.encode()).hexdigest()[:16]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "date_from": self.date_from,
            "date_to": self.date_to,
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            "entry_mode": self.entry_mode,
            "chain": self.chain,
            "slice_fingerprint": self.slice_fingerprint,
            "tp_mult": self.tp_mult,
            "sl_mult": self.sl_mult,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "intrabar_order": self.intrabar_order,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RunIdentity":
        return cls(
            date_from=data["date_from"],
            date_to=data["date_to"],
            interval_seconds=int(data["interval_seconds"]),
            horizon_hours=int(data["horizon_hours"]),
            entry_mode=data.get("entry_mode", "immediate"),
            chain=data.get("chain", "solana"),
            slice_fingerprint=data.get("slice_fingerprint", ""),
            tp_mult=data.get("tp_mult"),
            sl_mult=data.get("sl_mult"),
            fee_bps=float(data.get("fee_bps", 30.0)),
            slippage_bps=float(data.get("slippage_bps", 50.0)),
            intrabar_order=data.get("intrabar_order", "sl_first"),
        )


# =============================================================================
# Run Record (what we persist)
# =============================================================================

@dataclass
class RunRecord:
    """
    Complete run record - everything needed to reproduce and understand a run.
    """
    # Identity
    run_id: str
    run_name: str
    identity: RunIdentity
    fingerprint: str  # Computed from identity
    
    # Timestamps
    created_at: datetime
    completed_at: Optional[datetime] = None
    
    # Counts (sacred - must always be present)
    alerts_total: int = 0
    alerts_ok: int = 0
    alerts_missing: int = 0
    
    # Summary metrics (computed)
    summary: Dict[str, Any] = field(default_factory=dict)
    
    # Provenance
    slice_path: Optional[str] = None
    score_version: Optional[str] = None
    
    @classmethod
    def create(
        cls,
        run_name: str,
        identity: RunIdentity,
        alerts_total: int = 0,
        alerts_ok: int = 0,
        alerts_missing: int = 0,
    ) -> "RunRecord":
        """Create a new run record."""
        now = datetime.now(UTC)
        return cls(
            run_id=uuid.uuid4().hex,
            run_name=run_name,
            identity=identity,
            fingerprint=identity.compute_fingerprint(),
            created_at=now,
            alerts_total=alerts_total,
            alerts_ok=alerts_ok,
            alerts_missing=alerts_missing,
        )
    
    def complete(self, summary: Dict[str, Any]) -> None:
        """Mark run as complete with summary."""
        self.completed_at = datetime.now(UTC)
        self.summary = summary
        self.alerts_total = summary.get("alerts_total", self.alerts_total)
        self.alerts_ok = summary.get("alerts_ok", self.alerts_ok)
        self.alerts_missing = summary.get("alerts_missing", self.alerts_missing)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "run_name": self.run_name,
            "identity": self.identity.to_dict(),
            "fingerprint": self.fingerprint,
            "created_at": self.created_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "alerts_total": self.alerts_total,
            "alerts_ok": self.alerts_ok,
            "alerts_missing": self.alerts_missing,
            "summary": self.summary,
            "slice_path": self.slice_path,
            "score_version": self.score_version,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RunRecord":
        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        else:
            created_at = datetime.now(UTC)
        
        completed_at = data.get("completed_at")
        if isinstance(completed_at, str):
            completed_at = datetime.fromisoformat(completed_at)
        
        return cls(
            run_id=data["run_id"],
            run_name=data["run_name"],
            identity=RunIdentity.from_dict(data["identity"]),
            fingerprint=data["fingerprint"],
            created_at=created_at,
            completed_at=completed_at,
            alerts_total=data.get("alerts_total", 0),
            alerts_ok=data.get("alerts_ok", 0),
            alerts_missing=data.get("alerts_missing", 0),
            summary=data.get("summary", {}),
            slice_path=data.get("slice_path"),
            score_version=data.get("score_version"),
        )


# =============================================================================
# DuckDB Schema for Runs
# =============================================================================

def ensure_runs_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Create the runs schema and tables if they don't exist."""
    con.execute("CREATE SCHEMA IF NOT EXISTS runs;")
    
    # Master runs table - one row per run
    con.execute("""
        CREATE TABLE IF NOT EXISTS runs.runs_d (
            -- Identity
            run_id TEXT PRIMARY KEY,
            run_name TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            
            -- Time window
            date_from DATE NOT NULL,
            date_to DATE NOT NULL,
            
            -- Candle params
            interval_seconds INTEGER NOT NULL,
            horizon_hours INTEGER NOT NULL,
            
            -- Entry mode
            entry_mode TEXT NOT NULL DEFAULT 'immediate',
            
            -- Data source
            chain TEXT NOT NULL DEFAULT 'solana',
            slice_fingerprint TEXT,
            slice_path TEXT,
            
            -- Strategy params (nullable for baseline runs)
            tp_mult DOUBLE,
            sl_mult DOUBLE,
            fee_bps DOUBLE DEFAULT 30.0,
            slippage_bps DOUBLE DEFAULT 50.0,
            intrabar_order TEXT DEFAULT 'sl_first',
            
            -- Counts (sacred)
            alerts_total INTEGER NOT NULL DEFAULT 0,
            alerts_ok INTEGER NOT NULL DEFAULT 0,
            alerts_missing INTEGER NOT NULL DEFAULT 0,
            
            -- Timestamps
            created_at TIMESTAMP NOT NULL,
            completed_at TIMESTAMP,
            
            -- Summary (JSON blob for flexibility)
            summary_json TEXT,
            
            -- Scoring
            score_version TEXT
        );
    """)
    
    # Index on fingerprint for deduplication queries
    con.execute("""
        CREATE INDEX IF NOT EXISTS runs_fingerprint_idx 
        ON runs.runs_d(fingerprint);
    """)
    
    # Index on date range for time-based queries
    con.execute("""
        CREATE INDEX IF NOT EXISTS runs_dates_idx 
        ON runs.runs_d(date_from, date_to);
    """)


def store_run(con: duckdb.DuckDBPyConnection, record: RunRecord) -> None:
    """Store a run record to DuckDB."""
    ensure_runs_schema(con)
    
    # Remove tzinfo for DuckDB
    created_at = record.created_at.replace(tzinfo=None) if record.created_at else None
    completed_at = record.completed_at.replace(tzinfo=None) if record.completed_at else None
    
    identity = record.identity
    
    con.execute("""
        INSERT OR REPLACE INTO runs.runs_d (
            run_id, run_name, fingerprint,
            date_from, date_to,
            interval_seconds, horizon_hours,
            entry_mode, chain, slice_fingerprint, slice_path,
            tp_mult, sl_mult, fee_bps, slippage_bps, intrabar_order,
            alerts_total, alerts_ok, alerts_missing,
            created_at, completed_at,
            summary_json, score_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        record.run_id,
        record.run_name,
        record.fingerprint,
        identity.date_from,
        identity.date_to,
        identity.interval_seconds,
        identity.horizon_hours,
        identity.entry_mode,
        identity.chain,
        identity.slice_fingerprint,
        record.slice_path,
        identity.tp_mult,
        identity.sl_mult,
        identity.fee_bps,
        identity.slippage_bps,
        identity.intrabar_order,
        record.alerts_total,
        record.alerts_ok,
        record.alerts_missing,
        created_at,
        completed_at,
        json.dumps(record.summary, separators=(",", ":"), default=str) if record.summary else None,
        record.score_version,
    ])


def load_run(con: duckdb.DuckDBPyConnection, run_id: str) -> Optional[RunRecord]:
    """Load a run record from DuckDB."""
    result = con.execute(
        "SELECT * FROM runs.runs_d WHERE run_id = ?", [run_id]
    ).fetchone()
    
    if not result:
        return None
    
    cols = [d[0] for d in con.description]
    row = dict(zip(cols, result))
    
    identity = RunIdentity(
        date_from=str(row["date_from"]),
        date_to=str(row["date_to"]),
        interval_seconds=row["interval_seconds"],
        horizon_hours=row["horizon_hours"],
        entry_mode=row["entry_mode"],
        chain=row["chain"],
        slice_fingerprint=row.get("slice_fingerprint") or "",
        tp_mult=row.get("tp_mult"),
        sl_mult=row.get("sl_mult"),
        fee_bps=row.get("fee_bps", 30.0),
        slippage_bps=row.get("slippage_bps", 50.0),
        intrabar_order=row.get("intrabar_order", "sl_first"),
    )
    
    summary = {}
    if row.get("summary_json"):
        try:
            summary = json.loads(row["summary_json"])
        except json.JSONDecodeError:
            pass
    
    return RunRecord(
        run_id=row["run_id"],
        run_name=row["run_name"],
        identity=identity,
        fingerprint=row["fingerprint"],
        created_at=row["created_at"].replace(tzinfo=UTC) if row["created_at"] else datetime.now(UTC),
        completed_at=row["completed_at"].replace(tzinfo=UTC) if row.get("completed_at") else None,
        alerts_total=row["alerts_total"],
        alerts_ok=row["alerts_ok"],
        alerts_missing=row["alerts_missing"],
        summary=summary,
        slice_path=row.get("slice_path"),
        score_version=row.get("score_version"),
    )


def find_run_by_fingerprint(con: duckdb.DuckDBPyConnection, fingerprint: str) -> Optional[RunRecord]:
    """Find an existing run with the same fingerprint."""
    result = con.execute(
        "SELECT run_id FROM runs.runs_d WHERE fingerprint = ? ORDER BY created_at DESC LIMIT 1",
        [fingerprint]
    ).fetchone()
    
    if result:
        return load_run(con, result[0])
    return None


def list_recent_runs(
    con: duckdb.DuckDBPyConnection,
    limit: int = 20,
    entry_mode: Optional[str] = None,
) -> List[RunRecord]:
    """List recent runs, optionally filtered by entry mode."""
    sql = "SELECT run_id FROM runs.runs_d"
    params: List[Any] = []
    
    if entry_mode:
        sql += " WHERE entry_mode = ?"
        params.append(entry_mode)
    
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    
    results = con.execute(sql, params).fetchall()
    runs = []
    for (run_id,) in results:
        record = load_run(con, run_id)
        if record:
            runs.append(record)
    return runs

