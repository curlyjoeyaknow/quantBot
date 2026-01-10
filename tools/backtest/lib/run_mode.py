"""
Run Mode Contract - The reproducibility backbone.

A RunMode fully defines an optimization run:
    mode preset → concrete config → stored + hashed → replayable

Every run can be described as:
    "SERIOUS@sha256:abc... on data@sha256:def... at commit f84f5ed0"

This is institutional memory.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Tuple

UTC = timezone.utc


# =============================================================================
# LANE PACKS
# =============================================================================

class LanePack(str, Enum):
    """Predefined stress lane configurations."""
    LITE = "lite"           # Fast iteration: baseline + worse + latency_1
    FULL = "full"           # Serious testing: all standard lanes
    ADVERSARIAL = "adversarial"  # War room: everything + extreme scenarios


# Lane pack definitions (lane_name → included)
LANE_PACK_DEFINITIONS: Dict[LanePack, List[str]] = {
    LanePack.LITE: [
        "baseline",
        "worse",
        "latency_1",
    ],
    LanePack.FULL: [
        "baseline",
        "worse",
        "ugly",
        "latency_1",
        "latency_2",
        "gap_model",
    ],
    LanePack.ADVERSARIAL: [
        "baseline",
        "worse",
        "ugly",
        "latency_1",
        "latency_2",
        "gap_model",
        # Adversarial additions
        "fee_spike",      # 3x fees
        "slip_spike",     # 5x slippage
        "delayed_exit",   # Exit delay simulation
        "full_stress",    # Everything at once
    ],
}


def get_lane_pack(pack: LanePack | str) -> List[str]:
    """Get lane names for a given pack."""
    if isinstance(pack, str):
        pack = LanePack(pack)
    return LANE_PACK_DEFINITIONS.get(pack, LANE_PACK_DEFINITIONS[LanePack.FULL])


# =============================================================================
# MODE TYPES
# =============================================================================

class ModeType(str, Enum):
    """Run mode presets."""
    CHEAP = "cheap"         # Fast iteration, UI tuning (15s runs)
    SERIOUS = "serious"     # Weekly decision-making (minutes)
    WAR_ROOM = "war_room"   # Pre-deploy proof (thorough)
    CUSTOM = "custom"       # User-defined


# =============================================================================
# GATE CONFIG
# =============================================================================

@dataclass
class GateThresholds:
    """
    Hard requirements for tradeable setups.
    All gates must pass for a setup to be considered viable.
    """
    # Win rate
    min_win_rate: float = 0.35
    
    # R-multiple bounds
    min_avg_r: float = 0.0
    max_avg_r_loss: float = -0.5   # Worst acceptable avg loss R
    min_avg_r_loss: float = -1.5   # Sanity floor
    
    # Drawdown
    max_median_dd_pre2x: float = 0.50
    max_p75_dd_pre2x: float = 0.65
    
    # Hit rates
    min_hit2x_pct: float = 0.30
    
    # Sample size
    min_trades: int = 20
    min_folds_positive: float = 0.50
    
    # Anti-overfit
    min_test_train_ratio: float = 0.20
    
    # Capital efficiency (optional)
    max_median_holding_hours: Optional[float] = None
    max_open_at_horizon_pct: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "min_win_rate": self.min_win_rate,
            "min_avg_r": self.min_avg_r,
            "max_avg_r_loss": self.max_avg_r_loss,
            "min_avg_r_loss": self.min_avg_r_loss,
            "max_median_dd_pre2x": self.max_median_dd_pre2x,
            "max_p75_dd_pre2x": self.max_p75_dd_pre2x,
            "min_hit2x_pct": self.min_hit2x_pct,
            "min_trades": self.min_trades,
            "min_folds_positive": self.min_folds_positive,
            "min_test_train_ratio": self.min_test_train_ratio,
            "max_median_holding_hours": self.max_median_holding_hours,
            "max_open_at_horizon_pct": self.max_open_at_horizon_pct,
        }


# =============================================================================
# OBJECTIVE WEIGHTS
# =============================================================================

@dataclass
class ObjectiveWeights:
    """
    Weights and curves for the objective function.
    Controls how different metrics are combined into the final score.
    """
    # DD penalty curve (exponential)
    dd_gentle_threshold: float = 0.30   # No penalty below this
    dd_brutal_threshold: float = 0.60   # Max penalty above this
    dd_penalty_exponent: float = 2.0    # Curve steepness
    
    # Ratio penalty
    ratio_penalty_severe: float = 0.10   # Below this = severe penalty
    ratio_penalty_moderate: float = 0.40 # Below this = moderate penalty
    
    # Pessimistic R lambda
    pessimistic_lambda: float = 0.15    # Penalty for train/test gap
    
    # Stress penalty weight
    stress_weight: float = 1.0          # How much stress affects score
    
    # Time boost (optional)
    time_boost_enabled: bool = False
    time_boost_threshold_min: float = 30.0
    time_boost_max: float = 0.10
    
    # Tail bonus (optional)
    tail_bonus_enabled: bool = False
    tail_bonus_p95_threshold: float = 4.0
    tail_bonus_max: float = 0.05
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "dd_gentle_threshold": self.dd_gentle_threshold,
            "dd_brutal_threshold": self.dd_brutal_threshold,
            "dd_penalty_exponent": self.dd_penalty_exponent,
            "ratio_penalty_severe": self.ratio_penalty_severe,
            "ratio_penalty_moderate": self.ratio_penalty_moderate,
            "pessimistic_lambda": self.pessimistic_lambda,
            "stress_weight": self.stress_weight,
            "time_boost_enabled": self.time_boost_enabled,
            "time_boost_threshold_min": self.time_boost_threshold_min,
            "time_boost_max": self.time_boost_max,
            "tail_bonus_enabled": self.tail_bonus_enabled,
            "tail_bonus_p95_threshold": self.tail_bonus_p95_threshold,
            "tail_bonus_max": self.tail_bonus_max,
        }


# =============================================================================
# DATA WINDOW
# =============================================================================

@dataclass
class DataWindow:
    """
    Train/test configuration and fold structure.
    """
    train_days: int = 14
    test_days: int = 7
    n_folds: int = 3
    fold_step_days: int = 7
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "train_days": self.train_days,
            "test_days": self.test_days,
            "n_folds": self.n_folds,
            "fold_step_days": self.fold_step_days,
        }


# =============================================================================
# SEARCH CONFIG
# =============================================================================

@dataclass
class SearchConfig:
    """
    Search space and sampling configuration.
    """
    n_trials: int = 200
    sampler: Literal["random", "grid", "sobol"] = "random"
    
    # Parameter bounds
    tp_min: float = 1.5
    tp_max: float = 3.5
    sl_min: float = 0.30
    sl_max: float = 0.60
    
    # Clustering
    n_clusters: int = 3
    top_n_candidates: int = 30
    
    # Early stopping (fast fail)
    fast_fail_enabled: bool = False
    fast_fail_min_trials: int = 50
    fast_fail_threshold: float = -10.0  # Abandon if best is below this
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "n_trials": self.n_trials,
            "sampler": self.sampler,
            "tp_min": self.tp_min,
            "tp_max": self.tp_max,
            "sl_min": self.sl_min,
            "sl_max": self.sl_max,
            "n_clusters": self.n_clusters,
            "top_n_candidates": self.top_n_candidates,
            "fast_fail_enabled": self.fast_fail_enabled,
            "fast_fail_min_trials": self.fast_fail_min_trials,
            "fast_fail_threshold": self.fast_fail_threshold,
        }


# =============================================================================
# STRESS CONFIG
# =============================================================================

@dataclass
class StressTestConfig:
    """
    Stress testing configuration.
    """
    lane_pack: LanePack = LanePack.FULL
    custom_lanes: Optional[List[str]] = None  # Override lane pack
    
    # Champion validation
    validate_champions: bool = True
    champions_per_island: int = 1
    require_island_stability: bool = False  # Multiple nearby params must pass
    
    # Base costs (multiplied by lane factors)
    base_fee_bps: float = 30.0
    base_slippage_bps: float = 50.0
    
    def get_lanes(self) -> List[str]:
        """Get effective lane list."""
        if self.custom_lanes:
            return self.custom_lanes
        return get_lane_pack(self.lane_pack)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "lane_pack": self.lane_pack.value if isinstance(self.lane_pack, LanePack) else self.lane_pack,
            "custom_lanes": self.custom_lanes,
            "validate_champions": self.validate_champions,
            "champions_per_island": self.champions_per_island,
            "require_island_stability": self.require_island_stability,
            "base_fee_bps": self.base_fee_bps,
            "base_slippage_bps": self.base_slippage_bps,
            "effective_lanes": self.get_lanes(),
        }


# =============================================================================
# FINGERPRINTS
# =============================================================================

def compute_data_fingerprint(
    duckdb_path: str,
    date_from: str,
    date_to: str,
    chain: str = "solana",
    caller_filter: Optional[str] = None,
) -> str:
    """
    Compute a hash of the data used for this run.
    Includes: alerts count, date range, caller filter.
    """
    import duckdb
    
    try:
        from tools.shared.duckdb_adapter import get_readonly_connection
        with get_readonly_connection(duckdb_path) as con:
            # Count alerts in range
            if caller_filter:
                query = f"""
                    SELECT COUNT(*), MIN(ts), MAX(ts)
                    FROM alerts
                    WHERE chain = ? AND ts >= ? AND ts < ? AND caller = ?
                """
                row = con.execute(query, [chain, date_from, date_to, caller_filter]).fetchone()
            else:
                query = f"""
                    SELECT COUNT(*), MIN(ts), MAX(ts)
                    FROM alerts
                    WHERE chain = ? AND ts >= ? AND ts < ?
                """
                row = con.execute(query, [chain, date_from, date_to]).fetchone()
            
            
            n_alerts = row[0] if row else 0
            min_ts = str(row[1]) if row and row[1] else ""
            max_ts = str(row[2]) if row and row[2] else ""
            
            # Build fingerprint
            fingerprint_data = {
                "duckdb_path": os.path.basename(duckdb_path),
                "chain": chain,
                "date_from": date_from,
                "date_to": date_to,
                "caller_filter": caller_filter,
                "n_alerts": n_alerts,
                "min_ts": min_ts,
                "max_ts": max_ts,
            }
            
            canonical = json.dumps(fingerprint_data, sort_keys=True, separators=(",", ":"))
            return hashlib.sha256(canonical.encode()).hexdigest()[:16]
        
    except Exception as e:
        # Fallback: hash the inputs
        fallback = f"{duckdb_path}:{chain}:{date_from}:{date_to}:{caller_filter}"
        return hashlib.sha256(fallback.encode()).hexdigest()[:16]


def get_git_commit() -> Optional[str]:
    """Get current git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


def get_git_dirty() -> bool:
    """Check if working directory has uncommitted changes."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return len(result.stdout.strip()) > 0
    except Exception:
        pass
    return False


# =============================================================================
# RUN MODE (the main contract)
# =============================================================================

@dataclass
class RunMode:
    """
    Complete run configuration contract.
    
    This object fully defines an optimization run:
        mode preset → concrete config → stored + hashed → replayable
    
    Every run can be described as:
        "SERIOUS@sha256:abc... on data@sha256:def... at commit f84f5ed0"
    """
    # Mode type
    mode: ModeType = ModeType.SERIOUS
    
    # Date range
    date_from: str = ""
    date_to: str = ""
    
    # Data sources
    duckdb_path: str = "data/alerts.duckdb"
    chain: str = "solana"
    slice_path: str = "slices/per_token"
    caller_filter: Optional[str] = None
    caller_group: Optional[str] = None
    
    # Sub-configs
    data_window: DataWindow = field(default_factory=DataWindow)
    search: SearchConfig = field(default_factory=SearchConfig)
    gates: GateThresholds = field(default_factory=GateThresholds)
    stress: StressTestConfig = field(default_factory=StressTestConfig)
    objective: ObjectiveWeights = field(default_factory=ObjectiveWeights)
    
    # Backtest params
    interval_seconds: int = 60
    horizon_hours: int = 48
    risk_per_trade: float = 0.02
    threads: int = 8
    
    # Determinism
    seed: Optional[int] = None
    
    # Fingerprints (computed at runtime)
    data_fingerprint: Optional[str] = None
    code_fingerprint: Optional[str] = None
    code_dirty: bool = False
    
    # Config hash (computed from canonical JSON)
    config_hash: Optional[str] = None
    
    # Metadata
    created_at: Optional[str] = None
    run_id: Optional[str] = None
    
    def __post_init__(self):
        """Compute fingerprints and hash."""
        if self.created_at is None:
            self.created_at = datetime.now(UTC).isoformat()
        
        # Compute fingerprints if not set
        if self.data_fingerprint is None and self.date_from and self.date_to:
            self.data_fingerprint = compute_data_fingerprint(
                self.duckdb_path,
                self.date_from,
                self.date_to,
                self.chain,
                self.caller_filter,
            )
        
        if self.code_fingerprint is None:
            self.code_fingerprint = get_git_commit()
            self.code_dirty = get_git_dirty()
        
        # Compute config hash
        if self.config_hash is None:
            self.config_hash = self._compute_config_hash()
    
    def _compute_config_hash(self) -> str:
        """Compute SHA256 of canonical config JSON."""
        # Exclude runtime-computed fields
        config_dict = self.to_dict(exclude_fingerprints=True)
        canonical = json.dumps(config_dict, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]
    
    def to_dict(self, exclude_fingerprints: bool = False) -> Dict[str, Any]:
        """Convert to dictionary for storage."""
        d = {
            "mode": self.mode.value if isinstance(self.mode, ModeType) else self.mode,
            "date_from": self.date_from,
            "date_to": self.date_to,
            "duckdb_path": self.duckdb_path,
            "chain": self.chain,
            "slice_path": self.slice_path,
            "caller_filter": self.caller_filter,
            "caller_group": self.caller_group,
            "data_window": self.data_window.to_dict(),
            "search": self.search.to_dict(),
            "gates": self.gates.to_dict(),
            "stress": self.stress.to_dict(),
            "objective": self.objective.to_dict(),
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            "risk_per_trade": self.risk_per_trade,
            "threads": self.threads,
            "seed": self.seed,
        }
        
        if not exclude_fingerprints:
            d["data_fingerprint"] = self.data_fingerprint
            d["code_fingerprint"] = self.code_fingerprint
            d["code_dirty"] = self.code_dirty
            d["config_hash"] = self.config_hash
            d["created_at"] = self.created_at
            d["run_id"] = self.run_id
        
        return d
    
    def signature(self) -> str:
        """
        Return the canonical signature for this run.
        Format: MODE@sha256:CONFIG on data@sha256:DATA at commit COMMIT
        """
        mode_str = self.mode.value.upper() if isinstance(self.mode, ModeType) else str(self.mode).upper()
        config_str = f"sha256:{self.config_hash}" if self.config_hash else "?"
        data_str = f"sha256:{self.data_fingerprint}" if self.data_fingerprint else "?"
        
        commit_str = self.code_fingerprint or "unknown"
        if self.code_dirty:
            commit_str += "*"
        
        return f"{mode_str}@{config_str} on data@{data_str} at commit {commit_str}"
    
    def short_signature(self) -> str:
        """Short signature for CLI output."""
        mode_str = self.mode.value.upper() if isinstance(self.mode, ModeType) else str(self.mode).upper()
        config_short = self.config_hash[:8] if self.config_hash else "?"
        data_short = self.data_fingerprint[:8] if self.data_fingerprint else "?"
        commit = self.code_fingerprint or "?"
        if self.code_dirty:
            commit += "*"
        
        return f"MODE={mode_str} CONFIG={config_short} DATA={data_short} COMMIT={commit}"
    
    def print_signature(self) -> None:
        """Print the signature to stderr."""
        import sys
        sig = self.short_signature()
        print(f"\n{'─'*60}", file=sys.stderr)
        print(f"  {sig}", file=sys.stderr)
        print(f"{'─'*60}\n", file=sys.stderr)
    
    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "RunMode":
        """Create from dictionary."""
        return cls(
            mode=ModeType(d.get("mode", "serious")),
            date_from=d.get("date_from", ""),
            date_to=d.get("date_to", ""),
            duckdb_path=d.get("duckdb_path", "data/alerts.duckdb"),
            chain=d.get("chain", "solana"),
            slice_path=d.get("slice_path", "slices/per_token"),
            caller_filter=d.get("caller_filter"),
            caller_group=d.get("caller_group"),
            data_window=DataWindow(**d.get("data_window", {})),
            search=SearchConfig(**d.get("search", {})),
            gates=GateThresholds(**d.get("gates", {})),
            stress=StressTestConfig(
                lane_pack=LanePack(d.get("stress", {}).get("lane_pack", "full")),
                custom_lanes=d.get("stress", {}).get("custom_lanes"),
                validate_champions=d.get("stress", {}).get("validate_champions", True),
                champions_per_island=d.get("stress", {}).get("champions_per_island", 1),
                require_island_stability=d.get("stress", {}).get("require_island_stability", False),
                base_fee_bps=d.get("stress", {}).get("base_fee_bps", 30.0),
                base_slippage_bps=d.get("stress", {}).get("base_slippage_bps", 50.0),
            ),
            objective=ObjectiveWeights(**d.get("objective", {})),
            interval_seconds=d.get("interval_seconds", 60),
            horizon_hours=d.get("horizon_hours", 48),
            risk_per_trade=d.get("risk_per_trade", 0.02),
            threads=d.get("threads", 8),
            seed=d.get("seed"),
            data_fingerprint=d.get("data_fingerprint"),
            code_fingerprint=d.get("code_fingerprint"),
            code_dirty=d.get("code_dirty", False),
            config_hash=d.get("config_hash"),
            created_at=d.get("created_at"),
            run_id=d.get("run_id"),
        )


# =============================================================================
# MODE PRESETS
# =============================================================================

def create_cheap_mode(
    date_from: str,
    date_to: str,
    duckdb_path: str = "data/alerts.duckdb",
    slice_path: str = "slices/per_token",
    seed: Optional[int] = None,
    **overrides,
) -> RunMode:
    """
    CHEAP mode: Fast iteration, UI tuning (15s runs).
    
    - 100-300 trials
    - 2-3 folds
    - lite lane pack (baseline, worse, latency_1)
    - Fast fail enabled
    - 1 champion per island
    """
    return RunMode(
        mode=ModeType.CHEAP,
        date_from=date_from,
        date_to=date_to,
        duckdb_path=duckdb_path,
        slice_path=slice_path,
        seed=seed,
        data_window=DataWindow(
            train_days=14,
            test_days=7,
            n_folds=2,
            fold_step_days=7,
        ),
        search=SearchConfig(
            n_trials=150,
            sampler="random",
            n_clusters=3,
            top_n_candidates=20,
            fast_fail_enabled=True,
            fast_fail_min_trials=30,
            fast_fail_threshold=-20.0,
        ),
        gates=GateThresholds(
            min_win_rate=0.30,
            min_trades=10,
        ),
        stress=StressTestConfig(
            lane_pack=LanePack.LITE,
            validate_champions=True,
            champions_per_island=1,
        ),
        objective=ObjectiveWeights(
            dd_gentle_threshold=0.35,
            dd_brutal_threshold=0.65,
        ),
        **overrides,
    )


def create_serious_mode(
    date_from: str,
    date_to: str,
    duckdb_path: str = "data/alerts.duckdb",
    slice_path: str = "slices/per_token",
    seed: Optional[int] = None,
    **overrides,
) -> RunMode:
    """
    SERIOUS mode: Weekly decision-making (minutes).
    
    - 1000+ trials
    - 5-8 folds
    - Full lane pack
    - Island stability required
    """
    return RunMode(
        mode=ModeType.SERIOUS,
        date_from=date_from,
        date_to=date_to,
        duckdb_path=duckdb_path,
        slice_path=slice_path,
        seed=seed,
        data_window=DataWindow(
            train_days=14,
            test_days=7,
            n_folds=5,
            fold_step_days=7,
        ),
        search=SearchConfig(
            n_trials=1000,
            sampler="random",
            n_clusters=3,
            top_n_candidates=30,
            fast_fail_enabled=False,
        ),
        gates=GateThresholds(
            min_win_rate=0.35,
            min_trades=20,
            min_test_train_ratio=0.25,
        ),
        stress=StressTestConfig(
            lane_pack=LanePack.FULL,
            validate_champions=True,
            champions_per_island=1,
            require_island_stability=True,
        ),
        objective=ObjectiveWeights(
            dd_gentle_threshold=0.30,
            dd_brutal_threshold=0.60,
        ),
        **overrides,
    )


def create_war_room_mode(
    date_from: str,
    date_to: str,
    duckdb_path: str = "data/alerts.duckdb",
    slice_path: str = "slices/per_token",
    seed: Optional[int] = None,
    **overrides,
) -> RunMode:
    """
    WAR_ROOM mode: Pre-deploy proof (thorough).
    
    - 5000+ trials (or until convergence)
    - 8+ folds with varied regimes
    - Adversarial lane pack
    - Regime split evaluation
    - Maximum scrutiny
    """
    return RunMode(
        mode=ModeType.WAR_ROOM,
        date_from=date_from,
        date_to=date_to,
        duckdb_path=duckdb_path,
        slice_path=slice_path,
        seed=seed,
        data_window=DataWindow(
            train_days=21,
            test_days=7,
            n_folds=8,
            fold_step_days=7,
        ),
        search=SearchConfig(
            n_trials=5000,
            sampler="random",
            n_clusters=4,
            top_n_candidates=50,
            fast_fail_enabled=False,
        ),
        gates=GateThresholds(
            min_win_rate=0.35,
            min_trades=30,
            min_test_train_ratio=0.30,
            min_folds_positive=0.60,
            max_median_dd_pre2x=0.45,
        ),
        stress=StressTestConfig(
            lane_pack=LanePack.ADVERSARIAL,
            validate_champions=True,
            champions_per_island=1,
            require_island_stability=True,
        ),
        objective=ObjectiveWeights(
            dd_gentle_threshold=0.25,
            dd_brutal_threshold=0.55,
            pessimistic_lambda=0.20,
        ),
        **overrides,
    )


# Factory function
def create_mode(
    mode: ModeType | str,
    date_from: str,
    date_to: str,
    **kwargs,
) -> RunMode:
    """Create a RunMode from a mode type."""
    if isinstance(mode, str):
        mode = ModeType(mode)
    
    if mode == ModeType.CHEAP:
        return create_cheap_mode(date_from, date_to, **kwargs)
    elif mode == ModeType.SERIOUS:
        return create_serious_mode(date_from, date_to, **kwargs)
    elif mode == ModeType.WAR_ROOM:
        return create_war_room_mode(date_from, date_to, **kwargs)
    else:
        # Custom mode - use defaults
        return RunMode(
            mode=ModeType.CUSTOM,
            date_from=date_from,
            date_to=date_to,
            **kwargs,
        )


# =============================================================================
# PRETTY PRINTING
# =============================================================================

def print_mode_summary(mode: RunMode) -> None:
    """Print a summary of the mode configuration."""
    import sys
    
    print(f"\n{'='*70}", file=sys.stderr)
    print(f"  RUN MODE: {mode.mode.value.upper()}", file=sys.stderr)
    print(f"{'='*70}", file=sys.stderr)
    
    print(f"\n  {mode.short_signature()}\n", file=sys.stderr)
    
    print(f"  Date Range:     {mode.date_from} → {mode.date_to}", file=sys.stderr)
    print(f"  Data Window:    {mode.data_window.train_days}d train / {mode.data_window.test_days}d test × {mode.data_window.n_folds} folds", file=sys.stderr)
    print(f"  Search:         {mode.search.n_trials} trials, {mode.search.n_clusters} clusters, top {mode.search.top_n_candidates}", file=sys.stderr)
    print(f"  Parameter Space: TP [{mode.search.tp_min}, {mode.search.tp_max}] × SL [{mode.search.sl_min}, {mode.search.sl_max}]", file=sys.stderr)
    print(f"  Lane Pack:      {mode.stress.lane_pack.value} ({len(mode.stress.get_lanes())} lanes)", file=sys.stderr)
    print(f"  Gates:          WR≥{mode.gates.min_win_rate:.0%}, DD≤{mode.gates.max_median_dd_pre2x:.0%}, n≥{mode.gates.min_trades}", file=sys.stderr)
    
    if mode.search.fast_fail_enabled:
        print(f"  Fast Fail:      Enabled (min {mode.search.fast_fail_min_trials} trials)", file=sys.stderr)
    
    if mode.seed is not None:
        print(f"  Seed:           {mode.seed}", file=sys.stderr)
    
    print(f"\n{'='*70}\n", file=sys.stderr)

