"""
Simulation engine for backtesting trading strategies in DuckDB.
"""

from .simulator import DuckDBSimulator, StrategyConfig
from .sql_functions import setup_simulation_schema

__all__ = ['DuckDBSimulator', 'StrategyConfig', 'setup_simulation_schema']

