"""
Store simulation run operation.

Pure DuckDB logic: stores a simulation run result.
"""

from pydantic import BaseModel, Field
from typing import Optional
import duckdb


class StoreRunInput(BaseModel):
    run_id: str
    strategy_id: str
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


class StoreRunOutput(BaseModel):
    success: bool
    run_id: Optional[str] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: StoreRunInput) -> StoreRunOutput:
    """Store a simulation run in DuckDB."""
    try:
        con.execute("""
            INSERT OR REPLACE INTO simulation_runs
            (run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
             initial_capital, final_capital, total_return_pct, max_drawdown_pct,
             sharpe_ratio, win_rate, total_trades)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        ])
        con.commit()
        return StoreRunOutput(success=True, run_id=input.run_id)
    except Exception as e:
        return StoreRunOutput(success=False, error=str(e))
