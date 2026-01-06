"""
Store strategy operation.

Pure DuckDB logic: stores a strategy configuration.
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import duckdb
from pathlib import Path
import sys

# Import simulation schema
# Path: tools/simulation/duckdb_storage/ops/store_strategy.py -> tools/simulation/sql_functions.py
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from sql_functions import create_strategy


class StoreStrategyInput(BaseModel):
    strategy_id: str
    name: str
    entry_config: Dict[str, Any] = Field(default_factory=dict)
    exit_config: Dict[str, Any] = Field(default_factory=dict)
    reentry_config: Optional[Dict[str, Any]] = None
    cost_config: Optional[Dict[str, Any]] = None


class StoreStrategyOutput(BaseModel):
    success: bool
    strategy_id: Optional[str] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: StoreStrategyInput) -> StoreStrategyOutput:
    """Store a strategy in DuckDB."""
    try:
        create_strategy(
            con,
            strategy_id=input.strategy_id,
            name=input.name,
            entry_config=input.entry_config,
            exit_config=input.exit_config,
            reentry_config=input.reentry_config,
            cost_config=input.cost_config,
        )
        return StoreStrategyOutput(success=True, strategy_id=input.strategy_id)
    except Exception as e:
        return StoreStrategyOutput(success=False, error=str(e))
