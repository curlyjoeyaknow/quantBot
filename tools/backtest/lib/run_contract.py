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
class RunConfig:
    """
    Complete configuration for a reproducible run.
    
    Every parameter that affects results is captured here.
    Same config = same results (given same data).
    """
    # === Time Window ===
    date_from: str  # YYYY-MM-DD
    date_to: str    # YYYY-MM-DD
    
    # === Candle Params ===
    interval_seconds: int = 60
    horizon_hours: int = 48
    
    # === Entry Mode ===
    entry_mode: str = "immediate"  # 'immediate' | 'next_open' | 'dip_N'
    
    # === Data Source ===
    chain: str = "solana"
    slice_path: str = ""
    slice_fingerprint: str = ""  # Hash of slice content
    alerts_db_path: str = ""
    alerts_fingerprint: str = ""  # Hash of alerts query result
    
    # === Strategy Params ===
    tp_mult: Optional[float] = None
    sl_mult: Optional[float] = None
    
    # === Cost Model ===
    fee_bps: float = 30.0
    slippage_bps: float = 50.0
    intrabar_order: str = "sl_first"
    
    # === Risk Sizing ===
    risk_per_trade: float = 0.02
    max_position_pct: float = 1.0
    min_stop_distance: float = 0.02
    
    # === Caller Filter ===
    caller_filter: Optional[str] = None  # Comma-separated or None
    caller_group: Optional[str] = None   # Group name or None
    
    # === Scoring ===
    score_version: str = "v4"
    
    def compute_hash(self) -> str:
        """
        Compute deterministic hash for this config.
        
        This is the REPRODUCIBILITY HASH - same hash = same results.
        """
        # All fields that affect output
        data = {
            # Time
            "date_from": self.date_from,
            "date_to": self.date_to,
            # Candles
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            # Entry
            "entry_mode": self.entry_mode,
            # Data
            "chain": self.chain,
            "slice_fingerprint": self.slice_fingerprint,
            "alerts_fingerprint": self.alerts_fingerprint,
            # Strategy
            "tp_mult": self.tp_mult,
            "sl_mult": self.sl_mult,
            # Costs
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "intrabar_order": self.intrabar_order,
            # Risk sizing
            "risk_per_trade": self.risk_per_trade,
            "max_position_pct": self.max_position_pct,
            "min_stop_distance": self.min_stop_distance,
            # Caller filter
            "caller_filter": self.caller_filter,
            "caller_group": self.caller_group,
        }
        serialized = json.dumps(data, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(serialized.encode()).hexdigest()
    
    def compute_short_hash(self) -> str:
        """Short 16-char hash for display."""
        return self.compute_hash()[:16]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "date_from": self.date_from,
            "date_to": self.date_to,
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            "entry_mode": self.entry_mode,
            "chain": self.chain,
            "slice_path": self.slice_path,
            "slice_fingerprint": self.slice_fingerprint,
            "alerts_db_path": self.alerts_db_path,
            "alerts_fingerprint": self.alerts_fingerprint,
            "tp_mult": self.tp_mult,
            "sl_mult": self.sl_mult,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "intrabar_order": self.intrabar_order,
            "risk_per_trade": self.risk_per_trade,
            "max_position_pct": self.max_position_pct,
            "min_stop_distance": self.min_stop_distance,
            "caller_filter": self.caller_filter,
            "caller_group": self.caller_group,
            "score_version": self.score_version,
        }
    
    def to_json(self) -> str:
        """Serialize to JSON for storage."""
        return json.dumps(self.to_dict(), indent=2, sort_keys=True)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RunConfig":
        return cls(
            date_from=data["date_from"],
            date_to=data["date_to"],
            interval_seconds=int(data.get("interval_seconds", 60)),
            horizon_hours=int(data.get("horizon_hours", 48)),
            entry_mode=data.get("entry_mode", "immediate"),
            chain=data.get("chain", "solana"),
            slice_path=data.get("slice_path", ""),
            slice_fingerprint=data.get("slice_fingerprint", ""),
            alerts_db_path=data.get("alerts_db_path", ""),
            alerts_fingerprint=data.get("alerts_fingerprint", ""),
            tp_mult=data.get("tp_mult"),
            sl_mult=data.get("sl_mult"),
            fee_bps=float(data.get("fee_bps", 30.0)),
            slippage_bps=float(data.get("slippage_bps", 50.0)),
            intrabar_order=data.get("intrabar_order", "sl_first"),
            risk_per_trade=float(data.get("risk_per_trade", 0.02)),
            max_position_pct=float(data.get("max_position_pct", 1.0)),
            min_stop_distance=float(data.get("min_stop_distance", 0.02)),
            caller_filter=data.get("caller_filter"),
            caller_group=data.get("caller_group"),
            score_version=data.get("score_version", "v4"),
        )
    
    @classmethod
    def from_json(cls, json_str: str) -> "RunConfig":
        return cls.from_dict(json.loads(json_str))


# Legacy alias for backwards compatibility
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
            config_hash TEXT,  -- Full reproducibility hash
            
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
            alerts_db_path TEXT,
            alerts_fingerprint TEXT,
            
            -- Strategy params (nullable for baseline runs)
            tp_mult DOUBLE,
            sl_mult DOUBLE,
            fee_bps DOUBLE DEFAULT 30.0,
            slippage_bps DOUBLE DEFAULT 50.0,
            intrabar_order TEXT DEFAULT 'sl_first',
            
            -- Risk sizing
            risk_per_trade DOUBLE DEFAULT 0.02,
            max_position_pct DOUBLE DEFAULT 1.0,
            min_stop_distance DOUBLE DEFAULT 0.02,
            
            -- Caller filter
            caller_filter TEXT,
            caller_group TEXT,
            
            -- Counts (sacred)
            alerts_total INTEGER NOT NULL DEFAULT 0,
            alerts_ok INTEGER NOT NULL DEFAULT 0,
            alerts_missing INTEGER NOT NULL DEFAULT 0,
            
            -- Timestamps
            created_at TIMESTAMP NOT NULL,
            completed_at TIMESTAMP,
            
            -- Summary (JSON blob for flexibility)
            summary_json TEXT,
            
            -- Full config (JSON blob for reproducibility)
            config_json TEXT,
            
            -- Scoring
            score_version TEXT
        );
    """)
    
    # Index on fingerprint for deduplication queries
    con.execute("""
        CREATE INDEX IF NOT EXISTS runs_fingerprint_idx 
        ON runs.runs_d(fingerprint);
    """)
    
    # Index on config_hash for exact reproducibility queries
    con.execute("""
        CREATE INDEX IF NOT EXISTS runs_config_hash_idx 
        ON runs.runs_d(config_hash);
    """)
    
    # Index on date range for time-based queries
    con.execute("""
        CREATE INDEX IF NOT EXISTS runs_dates_idx 
        ON runs.runs_d(date_from, date_to);
    """)
    
    # Per-run caller leaderboard snapshot
    con.execute("""
        CREATE TABLE IF NOT EXISTS runs.caller_scores_d (
            -- Identity
            run_id TEXT NOT NULL,
            caller TEXT NOT NULL,
            
            -- Trade counts
            n_trades INTEGER NOT NULL,
            n_wins INTEGER NOT NULL,
            n_losses INTEGER NOT NULL,
            
            -- Token returns
            win_rate DOUBLE,
            avg_token_return DOUBLE,
            total_token_return DOUBLE,
            avg_winner DOUBLE,
            avg_loser DOUBLE,
            profit_factor DOUBLE,
            expectancy DOUBLE,
            
            -- R-multiple returns
            total_r DOUBLE,
            avg_r DOUBLE,
            avg_winner_r DOUBLE,
            avg_loser_r DOUBLE,
            profit_factor_r DOUBLE,
            
            -- Portfolio returns
            total_portfolio_pnl_pct DOUBLE,
            avg_portfolio_pnl_pct DOUBLE,
            
            -- Peak metrics
            avg_peak_mult DOUBLE,
            hit_2x_rate DOUBLE,
            hit_3x_rate DOUBLE,
            
            -- Score
            score_version TEXT,
            score DOUBLE,
            
            PRIMARY KEY (run_id, caller)
        );
    """)
    
    # Per-run summary stats (denormalized for fast queries)
    con.execute("""
        CREATE TABLE IF NOT EXISTS runs.run_summary_d (
            run_id TEXT PRIMARY KEY,
            
            -- Token returns
            win_rate DOUBLE,
            avg_token_return DOUBLE,
            total_token_return DOUBLE,
            profit_factor DOUBLE,
            expectancy DOUBLE,
            
            -- R-multiple returns
            total_r DOUBLE,
            avg_r DOUBLE,
            avg_winner_r DOUBLE,
            avg_loser_r DOUBLE,
            profit_factor_r DOUBLE,
            
            -- Portfolio returns
            total_portfolio_pnl_pct DOUBLE,
            avg_portfolio_pnl_pct DOUBLE,
            max_portfolio_gain_pct DOUBLE,
            max_portfolio_loss_pct DOUBLE,
            
            -- Position sizing
            avg_position_pct DOUBLE,
            
            -- Timing
            duration_seconds DOUBLE
        );
    """)


def store_run(con: duckdb.DuckDBPyConnection, record: RunRecord, config: Optional[RunConfig] = None) -> None:
    """Store a run record to DuckDB."""
    ensure_runs_schema(con)
    
    # Remove tzinfo for DuckDB
    created_at = record.created_at.replace(tzinfo=None) if record.created_at else None
    completed_at = record.completed_at.replace(tzinfo=None) if record.completed_at else None
    
    identity = record.identity
    
    # Compute config hash and JSON if provided
    config_hash = config.compute_hash() if config else None
    config_json = config.to_json() if config else None
    
    con.execute("""
        INSERT OR REPLACE INTO runs.runs_d (
            run_id, run_name, fingerprint, config_hash,
            date_from, date_to,
            interval_seconds, horizon_hours,
            entry_mode, chain, slice_fingerprint, slice_path,
            alerts_db_path, alerts_fingerprint,
            tp_mult, sl_mult, fee_bps, slippage_bps, intrabar_order,
            risk_per_trade, max_position_pct, min_stop_distance,
            caller_filter, caller_group,
            alerts_total, alerts_ok, alerts_missing,
            created_at, completed_at,
            summary_json, config_json, score_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        record.run_id,
        record.run_name,
        record.fingerprint,
        config_hash,
        identity.date_from,
        identity.date_to,
        identity.interval_seconds,
        identity.horizon_hours,
        identity.entry_mode,
        identity.chain,
        identity.slice_fingerprint,
        record.slice_path,
        config.alerts_db_path if config else None,
        config.alerts_fingerprint if config else None,
        identity.tp_mult,
        identity.sl_mult,
        identity.fee_bps,
        identity.slippage_bps,
        identity.intrabar_order,
        config.risk_per_trade if config else 0.02,
        config.max_position_pct if config else 1.0,
        config.min_stop_distance if config else 0.02,
        config.caller_filter if config else None,
        config.caller_group if config else None,
        record.alerts_total,
        record.alerts_ok,
        record.alerts_missing,
        created_at,
        completed_at,
        json.dumps(record.summary, separators=(",", ":"), default=str) if record.summary else None,
        config_json,
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


def store_run_summary(
    con: duckdb.DuckDBPyConnection,
    run_id: str,
    summary: Dict[str, Any],
    duration_seconds: float = 0.0,
) -> None:
    """Store run summary stats."""
    ensure_runs_schema(con)
    
    con.execute("""
        INSERT OR REPLACE INTO runs.run_summary_d (
            run_id,
            win_rate, avg_token_return, total_token_return, profit_factor, expectancy,
            total_r, avg_r, avg_winner_r, avg_loser_r, profit_factor_r,
            total_portfolio_pnl_pct, avg_portfolio_pnl_pct,
            max_portfolio_gain_pct, max_portfolio_loss_pct,
            avg_position_pct, duration_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        run_id,
        summary.get("tp_sl_win_rate") or summary.get("win_rate"),
        summary.get("tp_sl_avg_return_pct") or summary.get("avg_token_return"),
        summary.get("tp_sl_total_return_pct") or summary.get("total_token_return"),
        summary.get("tp_sl_profit_factor") or summary.get("profit_factor"),
        summary.get("tp_sl_expectancy_pct") or summary.get("expectancy"),
        summary.get("total_r"),
        summary.get("avg_r"),
        summary.get("avg_winner_r"),
        summary.get("avg_loser_r"),
        summary.get("profit_factor_r"),
        summary.get("total_portfolio_pnl_pct"),
        summary.get("avg_portfolio_pnl_pct"),
        summary.get("max_portfolio_gain_pct"),
        summary.get("max_portfolio_loss_pct"),
        summary.get("avg_position_pct"),
        duration_seconds,
    ])


def store_caller_scores(
    con: duckdb.DuckDBPyConnection,
    run_id: str,
    caller_stats: List[Dict[str, Any]],
    score_version: str,
) -> int:
    """
    Store per-caller scores for a run.
    
    Args:
        con: DuckDB connection
        run_id: Run ID
        caller_stats: List of caller stat dicts (from aggregate_by_caller or leaderboard)
        score_version: Score version used
        
    Returns:
        Number of rows inserted
    """
    ensure_runs_schema(con)
    
    rows_inserted = 0
    for cs in caller_stats:
        caller = cs.get("caller", "unknown")
        
        try:
            con.execute("""
                INSERT OR REPLACE INTO runs.caller_scores_d (
                    run_id, caller,
                    n_trades, n_wins, n_losses,
                    win_rate, avg_token_return, total_token_return,
                    avg_winner, avg_loser, profit_factor, expectancy,
                    total_r, avg_r, avg_winner_r, avg_loser_r, profit_factor_r,
                    total_portfolio_pnl_pct, avg_portfolio_pnl_pct,
                    avg_peak_mult, hit_2x_rate, hit_3x_rate,
                    score_version, score
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                run_id,
                caller,
                cs.get("n_trades", 0),
                cs.get("n_wins", 0),
                cs.get("n_losses", 0),
                cs.get("win_rate"),
                cs.get("avg_return") or cs.get("avg_token_return"),
                cs.get("total_return") or cs.get("total_token_return"),
                cs.get("avg_win") or cs.get("avg_winner"),
                cs.get("avg_loss") or cs.get("avg_loser"),
                cs.get("profit_factor"),
                cs.get("expectancy"),
                cs.get("total_r"),
                cs.get("avg_r"),
                cs.get("avg_winner_r"),
                cs.get("avg_loser_r"),
                cs.get("profit_factor_r"),
                cs.get("total_portfolio_pnl_pct") or cs.get("risk_adj_total_return_pct"),
                cs.get("avg_portfolio_pnl_pct") or cs.get("risk_adj_avg_return_pct"),
                cs.get("avg_peak") or cs.get("avg_peak_mult"),
                cs.get("hit_2x_rate"),
                cs.get("hit_3x_rate"),
                score_version,
                cs.get("score", 0.0),
            ])
            rows_inserted += 1
        except Exception as e:
            print(f"Warning: Failed to store caller score for {caller}: {e}")
    
    return rows_inserted


def get_caller_scores_for_run(
    con: duckdb.DuckDBPyConnection,
    run_id: str,
) -> List[Dict[str, Any]]:
    """Get caller scores for a specific run."""
    try:
        result = con.execute("""
            SELECT * FROM runs.caller_scores_d 
            WHERE run_id = ?
            ORDER BY score DESC
        """, [run_id]).fetchall()
        
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, row)) for row in result]
    except Exception:
        return []

