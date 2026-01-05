"""
Optimizer configuration for parameter grid search.

Provides flexible configuration for:
- TP/SL parameter ranges
- Future: ladder exits, trailing stops, time limits, delayed entries, re-entries
"""

from __future__ import annotations

import itertools
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple, Union

import yaml


@dataclass
class RangeSpec:
    """
    Specification for a numeric parameter range.
    
    Supports:
    - Explicit list of values
    - Start/end/step range
    - Log-scale ranges (for multipliers)
    """
    values: Optional[List[float]] = None
    start: Optional[float] = None
    end: Optional[float] = None
    step: Optional[float] = None
    log_scale: bool = False  # Use log spacing (good for multipliers)
    
    def __post_init__(self):
        if self.values is None and (self.start is None or self.end is None):
            raise ValueError("RangeSpec requires either 'values' or 'start'/'end'")
    
    def expand(self) -> List[float]:
        """Expand range spec into list of values."""
        if self.values is not None:
            return list(self.values)
        
        if self.start is None or self.end is None:
            return []
        
        if self.log_scale:
            # Use log spacing for multipliers (e.g., 1.5, 2.0, 3.0, 5.0, 10.0)
            import math
            if self.start <= 0:
                raise ValueError("Log scale requires positive start value")
            
            log_start = math.log10(self.start)
            log_end = math.log10(self.end)
            n_steps = int(self.step) if self.step else 10
            
            values = []
            for i in range(n_steps + 1):
                t = i / n_steps
                log_val = log_start + t * (log_end - log_start)
                values.append(round(10 ** log_val, 4))
            return values
        
        # Linear range
        step = self.step or 0.1
        values = []
        current = self.start
        while current <= self.end + 1e-9:
            values.append(round(current, 6))
            current += step
        return values
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {}
        if self.values is not None:
            d["values"] = self.values
        if self.start is not None:
            d["start"] = self.start
        if self.end is not None:
            d["end"] = self.end
        if self.step is not None:
            d["step"] = self.step
        if self.log_scale:
            d["log_scale"] = True
        return d
    
    @classmethod
    def from_dict(cls, data: Union[Dict[str, Any], List[float], float]) -> "RangeSpec":
        """Parse from dict, list, or single value."""
        if isinstance(data, (int, float)):
            return cls(values=[float(data)])
        if isinstance(data, list):
            return cls(values=[float(x) for x in data])
        
        return cls(
            values=data.get("values"),
            start=data.get("start"),
            end=data.get("end"),
            step=data.get("step"),
            log_scale=data.get("log_scale", False),
        )


@dataclass
class TpSlParamSpace:
    """
    Parameter space for basic TP/SL optimization.
    
    Attributes:
        tp_mult: Take-profit multipliers to test
        sl_mult: Stop-loss multipliers to test
        intrabar_order: Intrabar ambiguity resolution (fixed or sweep)
    """
    tp_mult: RangeSpec
    sl_mult: RangeSpec
    intrabar_order: List[str] = field(default_factory=lambda: ["sl_first"])
    
    def iter_params(self) -> Iterator[Dict[str, Any]]:
        """Iterate over all parameter combinations."""
        for tp in self.tp_mult.expand():
            for sl in self.sl_mult.expand():
                for order in self.intrabar_order:
                    yield {
                        "tp_mult": tp,
                        "sl_mult": sl,
                        "intrabar_order": order,
                    }
    
    def count(self) -> int:
        """Count total parameter combinations."""
        return (
            len(self.tp_mult.expand()) *
            len(self.sl_mult.expand()) *
            len(self.intrabar_order)
        )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "tp_mult": self.tp_mult.to_dict(),
            "sl_mult": self.sl_mult.to_dict(),
            "intrabar_order": self.intrabar_order,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TpSlParamSpace":
        return cls(
            tp_mult=RangeSpec.from_dict(data["tp_mult"]),
            sl_mult=RangeSpec.from_dict(data["sl_mult"]),
            intrabar_order=data.get("intrabar_order", ["sl_first"]),
        )


@dataclass
class LadderTpParamSpace:
    """
    Parameter space for ladder TP optimization (future).
    
    Allows testing different ladder configurations.
    """
    enabled: bool = False
    # Ladder level targets (list of target multipliers)
    level_targets: Optional[List[List[float]]] = None
    # Percentage to sell at each level (must match level_targets lengths)
    level_percents: Optional[List[List[float]]] = None
    
    def iter_params(self) -> Iterator[Dict[str, Any]]:
        """Iterate over ladder configurations."""
        if not self.enabled or not self.level_targets:
            return
        
        if self.level_percents is None:
            # Default: equal split at each level
            for targets in self.level_targets:
                pct = round(1.0 / len(targets), 4)
                percents = [pct] * (len(targets) - 1) + [1.0 - pct * (len(targets) - 1)]
                yield {
                    "ladder_tp": list(zip(targets, percents)),
                }
        else:
            for targets, percents in zip(self.level_targets, self.level_percents):
                yield {
                    "ladder_tp": list(zip(targets, percents)),
                }
    
    def count(self) -> int:
        if not self.enabled or not self.level_targets:
            return 0
        return len(self.level_targets)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "level_targets": self.level_targets,
            "level_percents": self.level_percents,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LadderTpParamSpace":
        return cls(
            enabled=data.get("enabled", False),
            level_targets=data.get("level_targets"),
            level_percents=data.get("level_percents"),
        )


@dataclass
class TrailingStopParamSpace:
    """
    Parameter space for trailing stop optimization.
    
    Trailing stop activates after price rises by activation_pct,
    then trails at trail_pct below the running high.
    """
    enabled: bool = False
    activation_pct: Optional[RangeSpec] = None  # When to activate (e.g., 0.30 = +30%)
    trail_pct: Optional[RangeSpec] = None       # Distance from peak (e.g., 0.15 = 15%)
    
    # Legacy aliases
    activation_mult: Optional[RangeSpec] = None
    trail_percent: Optional[RangeSpec] = None
    
    def __post_init__(self):
        # Support legacy names
        if self.activation_mult and not self.activation_pct:
            self.activation_pct = self.activation_mult
        if self.trail_percent and not self.trail_pct:
            self.trail_pct = self.trail_percent
    
    def iter_params(self) -> Iterator[Dict[str, Any]]:
        if not self.enabled:
            return
        
        activations = self.activation_pct.expand() if self.activation_pct else [0.30]
        trails = self.trail_pct.expand() if self.trail_pct else [0.15]
        
        for act in activations:
            for trail in trails:
                yield {
                    "trail_activation_pct": act,
                    "trail_distance_pct": trail,
                }
    
    def count(self) -> int:
        if not self.enabled:
            return 0
        act_count = len(self.activation_pct.expand()) if self.activation_pct else 1
        trail_count = len(self.trail_pct.expand()) if self.trail_pct else 1
        return act_count * trail_count
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"enabled": self.enabled}
        if self.activation_pct:
            d["activation_pct"] = self.activation_pct.to_dict()
        if self.trail_pct:
            d["trail_pct"] = self.trail_pct.to_dict()
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TrailingStopParamSpace":
        return cls(
            enabled=data.get("enabled", False),
            activation_pct=RangeSpec.from_dict(data["activation_pct"]) if data.get("activation_pct") else None,
            trail_pct=RangeSpec.from_dict(data["trail_pct"]) if data.get("trail_pct") else None,
        )


@dataclass
class BreakevenParamSpace:
    """
    Parameter space for break-even stop optimization.
    
    After price rises by trigger_pct, move SL to entry (+ offset).
    """
    enabled: bool = False
    trigger_pct: Optional[RangeSpec] = None  # When to trigger (e.g., 0.20 = +20%)
    offset_pct: Optional[RangeSpec] = None   # Offset from entry (e.g., 0.0 = exact entry)
    
    def iter_params(self) -> Iterator[Dict[str, Any]]:
        if not self.enabled:
            return
        
        triggers = self.trigger_pct.expand() if self.trigger_pct else [0.20]
        offsets = self.offset_pct.expand() if self.offset_pct else [0.0]
        
        for trig in triggers:
            for off in offsets:
                yield {
                    "breakeven_trigger_pct": trig,
                    "breakeven_offset_pct": off,
                }
    
    def count(self) -> int:
        if not self.enabled:
            return 0
        trig_count = len(self.trigger_pct.expand()) if self.trigger_pct else 1
        off_count = len(self.offset_pct.expand()) if self.offset_pct else 1
        return trig_count * off_count
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"enabled": self.enabled}
        if self.trigger_pct:
            d["trigger_pct"] = self.trigger_pct.to_dict()
        if self.offset_pct:
            d["offset_pct"] = self.offset_pct.to_dict()
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BreakevenParamSpace":
        return cls(
            enabled=data.get("enabled", False),
            trigger_pct=RangeSpec.from_dict(data["trigger_pct"]) if data.get("trigger_pct") else None,
            offset_pct=RangeSpec.from_dict(data["offset_pct"]) if data.get("offset_pct") else None,
        )


@dataclass
class TimeLimitParamSpace:
    """
    Parameter space for time stop optimization.
    
    Exit after time_stop_hours if TP/SL not hit.
    Prevents zombie positions from dominating DD.
    """
    enabled: bool = False
    time_stop_hours: Optional[RangeSpec] = None
    
    # Legacy alias
    max_hold_hours: Optional[RangeSpec] = None
    
    def __post_init__(self):
        if self.max_hold_hours and not self.time_stop_hours:
            self.time_stop_hours = self.max_hold_hours
    
    def iter_params(self) -> Iterator[Dict[str, Any]]:
        if not self.enabled:
            return
        
        hours = self.time_stop_hours.expand() if self.time_stop_hours else [24]
        for h in hours:
            yield {"time_stop_hours": float(h)}
    
    def count(self) -> int:
        if not self.enabled:
            return 0
        return len(self.time_stop_hours.expand()) if self.time_stop_hours else 1
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"enabled": self.enabled}
        if self.time_stop_hours:
            d["time_stop_hours"] = self.time_stop_hours.to_dict()
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TimeLimitParamSpace":
        return cls(
            enabled=data.get("enabled", False),
            time_stop_hours=RangeSpec.from_dict(data["time_stop_hours"]) if data.get("time_stop_hours") else None,
        )


@dataclass
class DelayedEntryParamSpace:
    """
    Parameter space for delayed entry optimization (future).
    """
    enabled: bool = False
    dip_percent: Optional[RangeSpec] = None  # Wait for dip before entry
    max_wait_candles: Optional[RangeSpec] = None
    
    def iter_params(self) -> Iterator[Dict[str, Any]]:
        if not self.enabled:
            return
        
        dips = self.dip_percent.expand() if self.dip_percent else [0.1]
        waits = self.max_wait_candles.expand() if self.max_wait_candles else [60]
        
        for dip in dips:
            for wait in waits:
                yield {
                    "dip_percent": dip,
                    "max_wait_candles": int(wait),
                }
    
    def count(self) -> int:
        if not self.enabled:
            return 0
        dip_count = len(self.dip_percent.expand()) if self.dip_percent else 1
        wait_count = len(self.max_wait_candles.expand()) if self.max_wait_candles else 1
        return dip_count * wait_count
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"enabled": self.enabled}
        if self.dip_percent:
            d["dip_percent"] = self.dip_percent.to_dict()
        if self.max_wait_candles:
            d["max_wait_candles"] = self.max_wait_candles.to_dict()
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DelayedEntryParamSpace":
        return cls(
            enabled=data.get("enabled", False),
            dip_percent=RangeSpec.from_dict(data["dip_percent"]) if data.get("dip_percent") else None,
            max_wait_candles=RangeSpec.from_dict(data["max_wait_candles"]) if data.get("max_wait_candles") else None,
        )


@dataclass
class ReentryParamSpace:
    """
    Parameter space for re-entry optimization (future).
    """
    enabled: bool = False
    max_reentries: Optional[RangeSpec] = None
    cooldown_candles: Optional[RangeSpec] = None
    reentry_on_sl: List[bool] = field(default_factory=lambda: [False])
    
    def iter_params(self) -> Iterator[Dict[str, Any]]:
        if not self.enabled:
            return
        
        max_res = self.max_reentries.expand() if self.max_reentries else [1]
        cooldowns = self.cooldown_candles.expand() if self.cooldown_candles else [10]
        
        for max_re in max_res:
            for cd in cooldowns:
                for on_sl in self.reentry_on_sl:
                    yield {
                        "max_reentries": int(max_re),
                        "cooldown_candles": int(cd),
                        "reentry_on_sl": on_sl,
                    }
    
    def count(self) -> int:
        if not self.enabled:
            return 0
        max_count = len(self.max_reentries.expand()) if self.max_reentries else 1
        cd_count = len(self.cooldown_candles.expand()) if self.cooldown_candles else 1
        return max_count * cd_count * len(self.reentry_on_sl)
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"enabled": self.enabled}
        if self.max_reentries:
            d["max_reentries"] = self.max_reentries.to_dict()
        if self.cooldown_candles:
            d["cooldown_candles"] = self.cooldown_candles.to_dict()
        d["reentry_on_sl"] = self.reentry_on_sl
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReentryParamSpace":
        return cls(
            enabled=data.get("enabled", False),
            max_reentries=RangeSpec.from_dict(data["max_reentries"]) if data.get("max_reentries") else None,
            cooldown_candles=RangeSpec.from_dict(data["cooldown_candles"]) if data.get("cooldown_candles") else None,
            reentry_on_sl=data.get("reentry_on_sl", [False]),
        )


@dataclass
class OptimizerConfig:
    """
    Complete optimizer configuration.
    
    Combines all parameter spaces with run settings.
    """
    # Required
    name: str
    date_from: str  # YYYY-MM-DD
    date_to: str    # YYYY-MM-DD
    
    # Data sources
    duckdb_path: str = "data/alerts.duckdb"
    chain: str = "solana"
    
    # Slice settings
    slice_dir: str = "slices"
    slice_path: Optional[str] = None  # Use existing slice
    reuse_slice: bool = True
    
    # Fixed settings
    interval_seconds: int = 60
    horizon_hours: int = 48
    fee_bps: float = 30.0
    slippage_bps: float = 50.0
    
    # Caller filtering
    caller_group: Optional[str] = None  # Name of caller group to filter
    caller_ids: Optional[List[str]] = None  # Direct list of caller IDs
    
    # Parameter spaces
    tp_sl: Optional[TpSlParamSpace] = None
    ladder_tp: Optional[LadderTpParamSpace] = None
    trailing_stop: Optional[TrailingStopParamSpace] = None
    breakeven: Optional[BreakevenParamSpace] = None
    time_limit: Optional[TimeLimitParamSpace] = None
    delayed_entry: Optional[DelayedEntryParamSpace] = None
    reentry: Optional[ReentryParamSpace] = None
    
    # Execution settings
    threads: int = 8
    parallel_runs: int = 1  # Number of parallel backtest runs
    store_duckdb: bool = True
    output_dir: str = "results/optimizer"
    
    # Risk settings for summary metrics
    risk_per_trade: float = 0.02  # 2%
    
    def count_combinations(self) -> int:
        """Count total parameter combinations."""
        # Start with TP/SL combinations (always required)
        if self.tp_sl is None:
            return 0
        
        count = self.tp_sl.count()
        
        # Extended exit params are multiplicative when enabled
        if self.time_limit and self.time_limit.enabled:
            count *= max(1, self.time_limit.count())
        if self.breakeven and self.breakeven.enabled:
            count *= max(1, self.breakeven.count())
        if self.trailing_stop and self.trailing_stop.enabled:
            count *= max(1, self.trailing_stop.count())
        
        return count
    
    def iter_all_params(self) -> Iterator[Tuple[int, Dict[str, Any]]]:
        """
        Iterate over all parameter combinations with index.
        
        Combines TP/SL with extended exit types (time stop, breakeven, trailing).
        
        Yields:
            (index, params_dict)
        """
        if self.tp_sl is None:
            return
        
        # Get base TP/SL params
        tp_sl_list = list(self.tp_sl.iter_params())
        
        # Get extended exit params (or single empty dict if not enabled)
        time_params = list(self.time_limit.iter_params()) if (self.time_limit and self.time_limit.enabled) else [{}]
        be_params = list(self.breakeven.iter_params()) if (self.breakeven and self.breakeven.enabled) else [{}]
        trail_params = list(self.trailing_stop.iter_params()) if (self.trailing_stop and self.trailing_stop.enabled) else [{}]
        
        # Combine all
        idx = 0
        for tp_sl in tp_sl_list:
            for time_p in time_params:
                for be_p in be_params:
                    for trail_p in trail_params:
                        combined = {**tp_sl, **time_p, **be_p, **trail_p}
                        yield idx, combined
                        idx += 1
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "name": self.name,
            "date_from": self.date_from,
            "date_to": self.date_to,
            "duckdb_path": self.duckdb_path,
            "chain": self.chain,
            "slice_dir": self.slice_dir,
            "reuse_slice": self.reuse_slice,
            "interval_seconds": self.interval_seconds,
            "horizon_hours": self.horizon_hours,
            "fee_bps": self.fee_bps,
            "slippage_bps": self.slippage_bps,
            "threads": self.threads,
            "parallel_runs": self.parallel_runs,
            "store_duckdb": self.store_duckdb,
            "output_dir": self.output_dir,
            "risk_per_trade": self.risk_per_trade,
        }
        
        if self.slice_path:
            d["slice_path"] = self.slice_path
        if self.caller_group:
            d["caller_group"] = self.caller_group
        if self.caller_ids:
            d["caller_ids"] = self.caller_ids
        
        if self.tp_sl:
            d["tp_sl"] = self.tp_sl.to_dict()
        if self.ladder_tp:
            d["ladder_tp"] = self.ladder_tp.to_dict()
        if self.trailing_stop:
            d["trailing_stop"] = self.trailing_stop.to_dict()
        if self.breakeven:
            d["breakeven"] = self.breakeven.to_dict()
        if self.time_limit:
            d["time_limit"] = self.time_limit.to_dict()
        if self.delayed_entry:
            d["delayed_entry"] = self.delayed_entry.to_dict()
        if self.reentry:
            d["reentry"] = self.reentry.to_dict()
        
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OptimizerConfig":
        return cls(
            name=data["name"],
            date_from=data["date_from"],
            date_to=data["date_to"],
            duckdb_path=data.get("duckdb_path", "data/alerts.duckdb"),
            chain=data.get("chain", "solana"),
            slice_dir=data.get("slice_dir", "slices"),
            slice_path=data.get("slice_path"),
            reuse_slice=data.get("reuse_slice", True),
            interval_seconds=data.get("interval_seconds", 60),
            horizon_hours=data.get("horizon_hours", 48),
            fee_bps=data.get("fee_bps", 30.0),
            slippage_bps=data.get("slippage_bps", 50.0),
            caller_group=data.get("caller_group"),
            caller_ids=data.get("caller_ids"),
            tp_sl=TpSlParamSpace.from_dict(data["tp_sl"]) if data.get("tp_sl") else None,
            ladder_tp=LadderTpParamSpace.from_dict(data["ladder_tp"]) if data.get("ladder_tp") else None,
            trailing_stop=TrailingStopParamSpace.from_dict(data["trailing_stop"]) if data.get("trailing_stop") else None,
            breakeven=BreakevenParamSpace.from_dict(data["breakeven"]) if data.get("breakeven") else None,
            time_limit=TimeLimitParamSpace.from_dict(data["time_limit"]) if data.get("time_limit") else None,
            delayed_entry=DelayedEntryParamSpace.from_dict(data["delayed_entry"]) if data.get("delayed_entry") else None,
            reentry=ReentryParamSpace.from_dict(data["reentry"]) if data.get("reentry") else None,
            threads=data.get("threads", 8),
            parallel_runs=data.get("parallel_runs", 1),
            store_duckdb=data.get("store_duckdb", True),
            output_dir=data.get("output_dir", "results/optimizer"),
            risk_per_trade=data.get("risk_per_trade", 0.02),
        )
    
    @classmethod
    def from_yaml(cls, path: str) -> "OptimizerConfig":
        """Load config from YAML file."""
        with open(path) as f:
            data = yaml.safe_load(f)
        return cls.from_dict(data)
    
    @classmethod
    def from_json(cls, path: str) -> "OptimizerConfig":
        """Load config from JSON file."""
        with open(path) as f:
            data = json.load(f)
        return cls.from_dict(data)
    
    def save_yaml(self, path: str) -> None:
        """Save config to YAML file."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False, sort_keys=False)
    
    def save_json(self, path: str) -> None:
        """Save config to JSON file."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)


def create_basic_optimizer_config(
    name: str,
    date_from: str,
    date_to: str,
    tp_values: List[float],
    sl_values: List[float],
    **kwargs,
) -> OptimizerConfig:
    """
    Create a basic TP/SL optimizer config.
    
    Args:
        name: Config name
        date_from: Start date (YYYY-MM-DD)
        date_to: End date (YYYY-MM-DD)
        tp_values: List of TP multipliers to test
        sl_values: List of SL multipliers to test
        **kwargs: Additional config options
    
    Returns:
        OptimizerConfig
    """
    return OptimizerConfig(
        name=name,
        date_from=date_from,
        date_to=date_to,
        tp_sl=TpSlParamSpace(
            tp_mult=RangeSpec(values=tp_values),
            sl_mult=RangeSpec(values=sl_values),
        ),
        **kwargs,
    )


def create_grid_search_config(
    name: str,
    date_from: str,
    date_to: str,
    tp_start: float = 1.5,
    tp_end: float = 5.0,
    tp_step: float = 0.5,
    sl_start: float = 0.3,
    sl_end: float = 0.7,
    sl_step: float = 0.1,
    **kwargs,
) -> OptimizerConfig:
    """
    Create a grid search optimizer config with ranges.
    
    Args:
        name: Config name
        date_from: Start date
        date_to: End date
        tp_start: TP range start
        tp_end: TP range end
        tp_step: TP step size
        sl_start: SL range start
        sl_end: SL range end
        sl_step: SL step size
        **kwargs: Additional config options
    
    Returns:
        OptimizerConfig
    """
    return OptimizerConfig(
        name=name,
        date_from=date_from,
        date_to=date_to,
        tp_sl=TpSlParamSpace(
            tp_mult=RangeSpec(start=tp_start, end=tp_end, step=tp_step),
            sl_mult=RangeSpec(start=sl_start, end=sl_end, step=sl_step),
        ),
        **kwargs,
    )

