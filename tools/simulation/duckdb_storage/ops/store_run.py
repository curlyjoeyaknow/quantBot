"""
Store simulation run operation.

Pure DuckDB logic: stores a simulation run result and strategy configuration.
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import duckdb
import json
import hashlib


class StoreRunInput(BaseModel):
    run_id: str
    strategy_id: str
    strategy_name: str
    mint: str
    alert_timestamp: str
    start_time: str
    end_time: str
    initial_capital: float = Field(default=1000.0)
    final_capital: Optional[float] = None
    total_return_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None
    sharpe_ratio: Optional[float] = None
    win_rate: Optional[float] = None
    total_trades: int = Field(default=0)
    caller_name: Optional[str] = None
    # Strategy configuration (for reproducibility)
    entry_config: Dict[str, Any]
    exit_config: Dict[str, Any]
    reentry_config: Optional[Dict[str, Any]] = None
    cost_config: Optional[Dict[str, Any]] = None
    stop_loss_config: Optional[Dict[str, Any]] = None
    entry_signal_config: Optional[Dict[str, Any]] = None
    exit_signal_config: Optional[Dict[str, Any]] = None


class StoreRunOutput(BaseModel):
    success: bool
    run_id: Optional[str] = None
    strategy_config_id: Optional[str] = None
    error: Optional[str] = None


def _generate_strategy_config_id(
    strategy_id: str,
    entry_config: Dict[str, Any],
    exit_config: Dict[str, Any],
    reentry_config: Optional[Dict[str, Any]],
    cost_config: Optional[Dict[str, Any]],
    stop_loss_config: Optional[Dict[str, Any]],
    entry_signal_config: Optional[Dict[str, Any]],
    exit_signal_config: Optional[Dict[str, Any]],
) -> str:
    """Generate a unique ID for a strategy config based on its contents."""
    # Create a deterministic hash of the config
    config_dict = {
        "strategy_id": strategy_id,
        "entry_config": entry_config,
        "exit_config": exit_config,
        "reentry_config": reentry_config,
        "cost_config": cost_config,
        "stop_loss_config": stop_loss_config,
        "entry_signal_config": entry_signal_config,
        "exit_signal_config": exit_signal_config,
    }
    config_json = json.dumps(config_dict, sort_keys=True)
    config_hash = hashlib.sha256(config_json.encode()).hexdigest()[:16]
    return f"{strategy_id}_cfg_{config_hash}"


def run(con: duckdb.DuckDBPyConnection, input: StoreRunInput) -> StoreRunOutput:
    """Store a simulation run in DuckDB with strategy configuration."""
    try:
        # Insert into simulation_runs table
        con.execute("""
            INSERT OR REPLACE INTO simulation_runs
            (run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
             initial_capital, final_capital, total_return_pct, max_drawdown_pct,
             sharpe_ratio, win_rate, total_trades, caller_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            input.run_id,
            input.strategy_id,
            input.mint,
            input.alert_timestamp,
            input.start_time,
            input.end_time,
            input.initial_capital,
            input.final_capital,
            input.total_return_pct,
            input.max_drawdown_pct,
            input.sharpe_ratio,
            input.win_rate,
            input.total_trades,
            input.caller_name,
        ])

        # Generate or get strategy_config_id
        strategy_config_id = _generate_strategy_config_id(
            input.strategy_id,
            input.entry_config,
            input.exit_config,
            input.reentry_config,
            input.cost_config,
            input.stop_loss_config,
            input.entry_signal_config,
            input.exit_signal_config,
        )

        # Insert or replace into strategy_config table (replica of strategies with run-specific params)
        con.execute("""
            INSERT OR REPLACE INTO strategy_config
            (strategy_config_id, strategy_id, strategy_name, entry_config, exit_config,
             reentry_config, cost_config, stop_loss_config, entry_signal_config, exit_signal_config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            strategy_config_id,
            input.strategy_id,
            input.strategy_name,
            json.dumps(input.entry_config),
            json.dumps(input.exit_config),
            json.dumps(input.reentry_config) if input.reentry_config else None,
            json.dumps(input.cost_config) if input.cost_config else None,
            json.dumps(input.stop_loss_config) if input.stop_loss_config else None,
            json.dumps(input.entry_signal_config) if input.entry_signal_config else None,
            json.dumps(input.exit_signal_config) if input.exit_signal_config else None,
        ])

        # Insert into run_strategies_used table (links run to strategy config)
        con.execute("""
            INSERT OR REPLACE INTO run_strategies_used
            (run_id, strategy_config_id)
            VALUES (?, ?)
        """, [
            input.run_id,
            strategy_config_id,
        ])

        con.commit()
        return StoreRunOutput(success=True, run_id=input.run_id, strategy_config_id=strategy_config_id)
    except Exception as e:
        return StoreRunOutput(success=False, error=str(e))
