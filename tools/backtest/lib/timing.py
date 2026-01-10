"""
Timing utilities for backtest profiling.

Provides:
- Context managers for timing code sections
- Phase tracking for multi-step pipelines
- Formatted output for timing summaries
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class TimingRecord:
    """A single timing record with label and duration."""
    label: str
    duration_ms: int
    timestamp_ms: int


@dataclass
class TimingContext:
    """
    Aggregates timing records for a multi-phase operation.
    
    Usage:
        ctx = TimingContext()
        with ctx.phase("loading"):
            load_data()
        with ctx.phase("computing"):
            compute()
        print(ctx.summary_line())
    """
    records: List[TimingRecord] = field(default_factory=list)
    _start_ms: Optional[int] = None
    _end_ms: Optional[int] = None
    
    def start(self) -> None:
        """Mark the start of the overall operation."""
        self._start_ms = now_ms()
    
    def end(self) -> None:
        """Mark the end of the overall operation."""
        self._end_ms = now_ms()
    
    @contextmanager
    def phase(self, label: str):
        """
        Context manager for timing a phase.
        
        Args:
            label: Name of the phase
            
        Yields:
            None
        """
        if self._start_ms is None:
            self.start()
        
        t0 = time.perf_counter()
        ts = now_ms()
        try:
            yield
        finally:
            dt_ms = int((time.perf_counter() - t0) * 1000)
            self.records.append(TimingRecord(label=label, duration_ms=dt_ms, timestamp_ms=ts))
    
    @property
    def total_ms(self) -> int:
        """Total elapsed time in milliseconds."""
        if self._start_ms is None:
            return 0
        end = self._end_ms or now_ms()
        return end - self._start_ms
    
    @property
    def parts(self) -> Dict[str, int]:
        """Get timing parts as dict."""
        return {r.label: r.duration_ms for r in self.records}
    
    def summary_line(self, prefix: str = "[timing]") -> str:
        """
        Format a single-line timing summary.
        
        Example:
            [timing] total=14.82s slice=2.1s strat=8.7s agg=2.4s store=1.1s
        """
        parts = []
        parts.append(f"total={format_ms(self.total_ms)}")
        for r in self.records:
            parts.append(f"{r.label}={format_ms(r.duration_ms)}")
        return f"{prefix} {' '.join(parts)}"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for JSON serialization."""
        return {
            "total_ms": self.total_ms,
            "phases": [
                {"label": r.label, "duration_ms": r.duration_ms, "timestamp_ms": r.timestamp_ms}
                for r in self.records
            ],
        }


@contextmanager
def timed(label: str, parts: Optional[Dict[str, int]] = None, enabled: bool = True):
    """
    Simple context manager for timing a section.
    
    Args:
        label: Name for this section
        parts: Optional dict to store the timing in
        enabled: Whether to actually time (for toggling)
        
    Yields:
        None
    """
    if not enabled:
        yield
        return
    
    t0 = time.perf_counter()
    try:
        yield
    finally:
        dt_ms = int((time.perf_counter() - t0) * 1000)
        if parts is not None:
            parts[label] = dt_ms


def now_ms() -> int:
    """Get current time in milliseconds."""
    return int(time.time() * 1000)


def format_ms(ms: int) -> str:
    """
    Format milliseconds for display.
    
    Args:
        ms: Milliseconds
        
    Returns:
        Formatted string (e.g., "245ms", "3.45s", "2m14s")
    """
    if ms < 1000:
        return f"{ms}ms"
    elif ms < 60000:
        return f"{ms/1000:.2f}s"
    else:
        minutes = ms // 60000
        seconds = (ms % 60000) / 1000
        return f"{minutes}m{seconds:.0f}s"


def format_timing_parts(parts: Dict[str, int], prefix: str = "[timing]") -> str:
    """
    Format timing parts as a single line.
    
    Args:
        parts: Dict of label -> duration_ms
        prefix: Line prefix
        
    Returns:
        Formatted line
    """
    formatted = [f"{k}={format_ms(v)}" for k, v in parts.items()]
    return f"{prefix} {' '.join(formatted)}"


# =============================================================================
# Decorator
# =============================================================================

def timed_function(label: Optional[str] = None):
    """
    Decorator to time a function call.
    
    Args:
        label: Optional label (defaults to function name)
        
    Returns:
        Decorator
    """
    def decorator(fn):
        fn_label = label or fn.__name__
        
        def wrapper(*args, **kwargs):
            t0 = time.perf_counter()
            try:
                return fn(*args, **kwargs)
            finally:
                dt_ms = int((time.perf_counter() - t0) * 1000)
                print(f"[timing] {fn_label}={format_ms(dt_ms)}")
        
        return wrapper
    return decorator

