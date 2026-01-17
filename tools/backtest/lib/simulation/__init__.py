"""
Backtest Simulation Module

Python implementation of the simulation engine for the backtest package.
Migrated from TypeScript simulation code to provide better integration with Python tooling.
"""

from .simulator import Simulator, simulate_strategy
from .contracts import (
    SimInput,
    SimResult,
    SimEvent,
    SimMetrics,
    Candle,
    EntryConfig,
    ExitConfig,
    ReEntryConfig,
    CostConfig,
    StopLossConfig,
    ProfitTarget,
    CURRENT_CONTRACT_VERSION,
    SUPPORTED_CONTRACT_VERSIONS,
)

__all__ = [
    'Simulator',
    'simulate_strategy',
    'SimInput',
    'SimResult',
    'SimEvent',
    'SimMetrics',
    'Candle',
    'EntryConfig',
    'ExitConfig',
    'ReEntryConfig',
    'CostConfig',
    'StopLossConfig',
    'ProfitTarget',
    'CURRENT_CONTRACT_VERSION',
    'SUPPORTED_CONTRACT_VERSIONS',
]

