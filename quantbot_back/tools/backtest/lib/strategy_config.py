"""
Strategy configuration for backtesting.

Defines extensible exit strategy configuration that supports:
- Basic SL/TP
- Ladder exits (multiple TP levels)
- Trailing stops
- Max time limits
- Re-entries & delayed entries (future)

This module is designed to be incrementally extended.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


# =============================================================================
# Take Profit Configuration
# =============================================================================

@dataclass
class TakeProfitLevel:
    """
    A single take-profit level.
    
    Attributes:
        target: Price multiplier for TP (e.g., 2.0 for 2x)
        percent: Fraction of position to sell at this level (0-1)
    """
    target: float  # e.g., 2.0 for 2x
    percent: float  # e.g., 0.5 for 50% of position
    
    def __post_init__(self):
        if self.target <= 1.0:
            raise ValueError(f"TP target must be > 1.0, got {self.target}")
        if not 0 < self.percent <= 1:
            raise ValueError(f"TP percent must be in (0, 1], got {self.percent}")
    
    def to_dict(self) -> Dict[str, float]:
        return {"target": self.target, "percent": self.percent}
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TakeProfitLevel":
        return cls(target=float(data["target"]), percent=float(data["percent"]))


@dataclass
class TakeProfitConfig:
    """
    Take-profit configuration.
    
    Supports single TP (legacy) or ladder (multiple levels).
    
    Attributes:
        levels: List of TP levels (sorted by target ascending)
    """
    levels: List[TakeProfitLevel] = field(default_factory=list)
    
    @classmethod
    def single(cls, target: float) -> "TakeProfitConfig":
        """Create a simple single-TP config (100% exit at target)."""
        return cls(levels=[TakeProfitLevel(target=target, percent=1.0)])
    
    @classmethod
    def ladder(cls, levels: List[tuple[float, float]]) -> "TakeProfitConfig":
        """
        Create a ladder TP config.
        
        Args:
            levels: List of (target, percent) tuples.
                    Percents should sum to 1.0 or less.
        
        Example:
            TakeProfitConfig.ladder([(2.0, 0.3), (3.0, 0.3), (5.0, 0.4)])
        """
        tp_levels = [TakeProfitLevel(target=t, percent=p) for t, p in levels]
        tp_levels.sort(key=lambda l: l.target)
        return cls(levels=tp_levels)
    
    @property
    def first_target(self) -> Optional[float]:
        """Get the first (lowest) TP target."""
        return self.levels[0].target if self.levels else None
    
    def to_dict(self) -> Dict[str, Any]:
        return {"levels": [l.to_dict() for l in self.levels]}
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TakeProfitConfig":
        levels = [TakeProfitLevel.from_dict(l) for l in data.get("levels", [])]
        return cls(levels=levels)


# =============================================================================
# Stop Loss Configuration
# =============================================================================

@dataclass
class StopLossConfig:
    """
    Stop-loss configuration.
    
    Supports:
    - Fixed SL (initial only)
    - Trailing SL (activates after reaching threshold)
    
    Attributes:
        initial: Initial SL as multiplier (e.g., 0.5 for -50% from entry)
        trailing_activation: Price mult to activate trailing (e.g., 1.5 for +50%)
        trailing_percent: Trailing distance from peak (e.g., 0.25 for -25% from peak)
        trailing_window_size: Rolling window for trailing (optional, in candles)
    """
    initial: float  # e.g., 0.5 for -50% (exit at 50% of entry price)
    trailing_activation: Optional[float] = None  # e.g., 1.5 to activate after +50%
    trailing_percent: Optional[float] = None  # e.g., 0.25 for 25% from peak
    trailing_window_size: Optional[int] = None
    
    def __post_init__(self):
        if self.initial <= 0 or self.initial >= 1.0:
            raise ValueError(f"SL initial must be in (0, 1), got {self.initial}")
        if self.trailing_activation is not None and self.trailing_activation <= 1.0:
            raise ValueError(f"Trailing activation must be > 1.0, got {self.trailing_activation}")
        if self.trailing_percent is not None and not 0 < self.trailing_percent < 1:
            raise ValueError(f"Trailing percent must be in (0, 1), got {self.trailing_percent}")
    
    @classmethod
    def fixed(cls, sl_mult: float) -> "StopLossConfig":
        """Create a simple fixed SL config."""
        return cls(initial=sl_mult)
    
    @classmethod
    def with_trailing(
        cls,
        initial: float,
        activation: float,
        trail_percent: float,
        window_size: Optional[int] = None,
    ) -> "StopLossConfig":
        """Create an SL config with trailing stop."""
        return cls(
            initial=initial,
            trailing_activation=activation,
            trailing_percent=trail_percent,
            trailing_window_size=window_size,
        )
    
    @property
    def has_trailing(self) -> bool:
        return self.trailing_activation is not None and self.trailing_percent is not None
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"initial": self.initial}
        if self.trailing_activation is not None:
            d["trailing_activation"] = self.trailing_activation
        if self.trailing_percent is not None:
            d["trailing_percent"] = self.trailing_percent
        if self.trailing_window_size is not None:
            d["trailing_window_size"] = self.trailing_window_size
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StopLossConfig":
        return cls(
            initial=float(data["initial"]),
            trailing_activation=data.get("trailing_activation"),
            trailing_percent=data.get("trailing_percent"),
            trailing_window_size=data.get("trailing_window_size"),
        )


# =============================================================================
# Time Limit Configuration (Future)
# =============================================================================

@dataclass
class TimeLimitConfig:
    """
    Time-based exit configuration.
    
    Attributes:
        max_hold_hours: Maximum time to hold position
        exit_at_horizon: Whether to exit at horizon end (vs hold forever)
    """
    max_hold_hours: Optional[int] = None
    exit_at_horizon: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "max_hold_hours": self.max_hold_hours,
            "exit_at_horizon": self.exit_at_horizon,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TimeLimitConfig":
        return cls(
            max_hold_hours=data.get("max_hold_hours"),
            exit_at_horizon=data.get("exit_at_horizon", True),
        )


# =============================================================================
# Entry Configuration (Future: delayed/conditional entries)
# =============================================================================

@dataclass
class EntryConfig:
    """
    Entry configuration.
    
    Supports:
    - Immediate entry (at alert)
    - Delayed entry (wait for dip)
    - Conditional entry (future)
    
    Attributes:
        mode: 'immediate' | 'dip' | 'breakout'
        dip_percent: For dip mode, wait for this % drop before entry
        max_wait_candles: Max candles to wait for entry condition
    """
    mode: str = "immediate"
    dip_percent: Optional[float] = None  # e.g., 0.1 for 10% dip
    max_wait_candles: Optional[int] = None
    
    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"mode": self.mode}
        if self.dip_percent is not None:
            d["dip_percent"] = self.dip_percent
        if self.max_wait_candles is not None:
            d["max_wait_candles"] = self.max_wait_candles
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EntryConfig":
        return cls(
            mode=data.get("mode", "immediate"),
            dip_percent=data.get("dip_percent"),
            max_wait_candles=data.get("max_wait_candles"),
        )
    
    @classmethod
    def immediate(cls) -> "EntryConfig":
        return cls(mode="immediate")
    
    @classmethod
    def wait_for_dip(cls, dip_pct: float, max_wait: int = 60) -> "EntryConfig":
        """Wait for a dip before entering."""
        return cls(mode="dip", dip_percent=dip_pct, max_wait_candles=max_wait)


# =============================================================================
# Re-entry Configuration (Future)
# =============================================================================

@dataclass
class ReentryConfig:
    """
    Re-entry configuration (for future use).
    
    Attributes:
        enabled: Whether re-entry is enabled
        max_reentries: Maximum number of re-entries
        cooldown_candles: Candles to wait after exit before re-entry
        reentry_on_sl: Re-enter after stop loss hit
    """
    enabled: bool = False
    max_reentries: int = 0
    cooldown_candles: int = 10
    reentry_on_sl: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "enabled": self.enabled,
            "max_reentries": self.max_reentries,
            "cooldown_candles": self.cooldown_candles,
            "reentry_on_sl": self.reentry_on_sl,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReentryConfig":
        return cls(
            enabled=data.get("enabled", False),
            max_reentries=data.get("max_reentries", 0),
            cooldown_candles=data.get("cooldown_candles", 10),
            reentry_on_sl=data.get("reentry_on_sl", False),
        )


# =============================================================================
# Cost Configuration
# =============================================================================

@dataclass
class CostConfig:
    """
    Transaction cost configuration.
    
    Attributes:
        fee_bps: Trading fee in basis points (each way)
        slippage_bps: Slippage in basis points (each way)
    """
    fee_bps: float = 30.0  # 0.3%
    slippage_bps: float = 50.0  # 0.5%
    
    @property
    def total_entry_cost(self) -> float:
        """Total entry cost as fraction (fee + slippage)."""
        return (self.fee_bps + self.slippage_bps) / 10000.0
    
    @property
    def total_exit_cost(self) -> float:
        """Total exit cost as fraction (fee + slippage)."""
        return (self.fee_bps + self.slippage_bps) / 10000.0
    
    def to_dict(self) -> Dict[str, float]:
        return {"fee_bps": self.fee_bps, "slippage_bps": self.slippage_bps}
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CostConfig":
        return cls(
            fee_bps=float(data.get("fee_bps", 30.0)),
            slippage_bps=float(data.get("slippage_bps", 50.0)),
        )


# =============================================================================
# Complete Strategy Configuration
# =============================================================================

@dataclass
class StrategyConfig:
    """
    Complete strategy configuration.
    
    Combines all exit/entry/cost configurations into a single config object.
    This is the primary interface for defining trading strategies.
    """
    name: str
    take_profit: TakeProfitConfig
    stop_loss: StopLossConfig
    costs: CostConfig = field(default_factory=CostConfig)
    time_limit: TimeLimitConfig = field(default_factory=TimeLimitConfig)
    entry: EntryConfig = field(default_factory=EntryConfig.immediate)
    reentry: ReentryConfig = field(default_factory=ReentryConfig)
    
    # Intrabar ambiguity resolution
    intrabar_order: str = "sl_first"  # 'sl_first' or 'tp_first'
    
    def __post_init__(self):
        if self.intrabar_order not in ("sl_first", "tp_first"):
            raise ValueError(f"intrabar_order must be 'sl_first' or 'tp_first', got {self.intrabar_order}")
    
    @classmethod
    def simple_tp_sl(
        cls,
        name: str,
        tp_mult: float = 2.0,
        sl_mult: float = 0.5,
        fee_bps: float = 30.0,
        slippage_bps: float = 50.0,
        intrabar_order: str = "sl_first",
    ) -> "StrategyConfig":
        """
        Create a simple TP/SL strategy.
        
        Args:
            name: Strategy name
            tp_mult: Take-profit multiplier (e.g., 2.0 for 2x)
            sl_mult: Stop-loss multiplier (e.g., 0.5 for -50%)
            fee_bps: Trading fees in basis points
            slippage_bps: Slippage in basis points
            intrabar_order: Which exit to take if both hit in same candle
        
        Returns:
            StrategyConfig for simple TP/SL strategy
        """
        return cls(
            name=name,
            take_profit=TakeProfitConfig.single(tp_mult),
            stop_loss=StopLossConfig.fixed(sl_mult),
            costs=CostConfig(fee_bps=fee_bps, slippage_bps=slippage_bps),
            intrabar_order=intrabar_order,
        )
    
    @classmethod
    def ladder_tp(
        cls,
        name: str,
        tp_levels: List[tuple[float, float]],
        sl_mult: float = 0.5,
        fee_bps: float = 30.0,
        slippage_bps: float = 50.0,
    ) -> "StrategyConfig":
        """
        Create a ladder TP strategy with fixed SL.
        
        Args:
            name: Strategy name
            tp_levels: List of (target_mult, percent) tuples
            sl_mult: Stop-loss multiplier
            fee_bps: Trading fees
            slippage_bps: Slippage
        
        Example:
            StrategyConfig.ladder_tp(
                name="ladder_2x_3x_5x",
                tp_levels=[(2.0, 0.33), (3.0, 0.33), (5.0, 0.34)],
                sl_mult=0.5,
            )
        """
        return cls(
            name=name,
            take_profit=TakeProfitConfig.ladder(tp_levels),
            stop_loss=StopLossConfig.fixed(sl_mult),
            costs=CostConfig(fee_bps=fee_bps, slippage_bps=slippage_bps),
        )
    
    @classmethod
    def with_trailing_stop(
        cls,
        name: str,
        tp_mult: float = 2.0,
        initial_sl: float = 0.5,
        trail_activation: float = 1.5,
        trail_percent: float = 0.25,
        fee_bps: float = 30.0,
        slippage_bps: float = 50.0,
    ) -> "StrategyConfig":
        """
        Create a strategy with trailing stop.
        
        Args:
            name: Strategy name
            tp_mult: Take-profit multiplier
            initial_sl: Initial stop-loss multiplier
            trail_activation: Price mult to activate trailing
            trail_percent: Trailing distance from peak
            fee_bps: Trading fees
            slippage_bps: Slippage
        """
        return cls(
            name=name,
            take_profit=TakeProfitConfig.single(tp_mult),
            stop_loss=StopLossConfig.with_trailing(
                initial=initial_sl,
                activation=trail_activation,
                trail_percent=trail_percent,
            ),
            costs=CostConfig(fee_bps=fee_bps, slippage_bps=slippage_bps),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "take_profit": self.take_profit.to_dict(),
            "stop_loss": self.stop_loss.to_dict(),
            "costs": self.costs.to_dict(),
            "time_limit": self.time_limit.to_dict(),
            "entry": self.entry.to_dict(),
            "reentry": self.reentry.to_dict(),
            "intrabar_order": self.intrabar_order,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StrategyConfig":
        return cls(
            name=data.get("name", "unnamed"),
            take_profit=TakeProfitConfig.from_dict(data.get("take_profit", {"levels": []})),
            stop_loss=StopLossConfig.from_dict(data.get("stop_loss", {"initial": 0.5})),
            costs=CostConfig.from_dict(data.get("costs", {})),
            time_limit=TimeLimitConfig.from_dict(data.get("time_limit", {})),
            entry=EntryConfig.from_dict(data.get("entry", {})),
            reentry=ReentryConfig.from_dict(data.get("reentry", {})),
            intrabar_order=data.get("intrabar_order", "sl_first"),
        )
    
    @property
    def first_tp_mult(self) -> float:
        """Get the first TP target multiplier."""
        return self.take_profit.first_target or 2.0
    
    @property
    def sl_mult(self) -> float:
        """Get the SL multiplier."""
        return self.stop_loss.initial

