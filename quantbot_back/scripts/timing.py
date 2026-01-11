#!/usr/bin/env python3
"""
Drop-in timing utility for quick profiling.

Re-exports the core timing utilities from tools/backtest/lib/timing.py
for convenient use in scripts.

Usage in your runner:
    from scripts.timing import TimingContext, timed, format_ms

    ctx = TimingContext()
    with ctx.phase("slice_load"):
        load_data()
    with ctx.phase("compute"):
        compute()
    
    print(ctx.summary_line())
    # Output: [timing] total=14.82s slice_load=2.1s compute=8.7s

Or use the simple timed() context manager:
    parts = {}
    with timed("slice_load", parts):
        load_data()
    print(format_timing_parts(parts))
"""
from __future__ import annotations

import sys
from pathlib import Path

# Add tools/backtest to path for imports
_TOOLS_PATH = Path(__file__).parent.parent / "tools" / "backtest"
if str(_TOOLS_PATH) not in sys.path:
    sys.path.insert(0, str(_TOOLS_PATH))

# Re-export from the main timing module
from lib.timing import (
    TimingContext,
    TimingRecord,
    timed,
    timed_function,
    now_ms,
    format_ms,
    format_timing_parts,
)

__all__ = [
    "TimingContext",
    "TimingRecord",
    "timed",
    "timed_function",
    "now_ms",
    "format_ms",
    "format_timing_parts",
]

if __name__ == "__main__":
    # Demo usage
    import time
    
    ctx = TimingContext()
    
    with ctx.phase("phase_1"):
        time.sleep(0.1)
    
    with ctx.phase("phase_2"):
        time.sleep(0.2)
    
    with ctx.phase("phase_3"):
        time.sleep(0.05)
    
    ctx.end()
    print(ctx.summary_line())
    print(f"JSON: {ctx.to_dict()}")

