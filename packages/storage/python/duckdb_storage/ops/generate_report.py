"""
Generate report operation.

Pure DuckDB logic: generates reports from simulation data.
"""

from pydantic import BaseModel, Field
from typing import Optional
import duckdb


class GenerateReportInput(BaseModel):
    type: str = Field(..., pattern="^(summary|strategy_performance)$")
    strategy_id: Optional[str] = None


class ReportData(BaseModel):
    total_runs: Optional[int] = None
    avg_return_pct: Optional[float] = None
    avg_sharpe_ratio: Optional[float] = None
    avg_win_rate: Optional[float] = None
    total_trades: Optional[int] = None
    avg_drawdown_pct: Optional[float] = None
    strategy_id: Optional[str] = None
    run_count: Optional[int] = None


class GenerateReportOutput(BaseModel):
    success: bool
    report_type: Optional[str] = None
    data: Optional[ReportData] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: GenerateReportInput) -> GenerateReportOutput:
    """Generate a report from DuckDB simulation data."""
    try:
        if input.type == "summary":
            # Summary report: aggregate metrics across all runs
            result = con.execute("""
                SELECT 
                    COUNT(*) as total_runs,
                    AVG(total_return_pct) as avg_return,
                    AVG(sharpe_ratio) as avg_sharpe,
                    AVG(win_rate) as avg_win_rate,
                    SUM(total_trades) as total_trades,
                    AVG(max_drawdown_pct) as avg_drawdown
                FROM simulation_runs
                WHERE final_capital IS NOT NULL
            """).fetchone()

            return GenerateReportOutput(
                success=True,
                report_type="summary",
                data=ReportData(
                    total_runs=result[0] if result else 0,
                    avg_return_pct=float(result[1]) if result and result[1] else 0.0,
                    avg_sharpe_ratio=float(result[2]) if result and result[2] else 0.0,
                    avg_win_rate=float(result[3]) if result and result[3] else 0.0,
                    total_trades=result[4] if result else 0,
                    avg_drawdown_pct=float(result[5]) if result and result[5] else 0.0,
                ),
            )
        elif input.type == "strategy_performance":
            # Strategy performance report
            if not input.strategy_id:
                return GenerateReportOutput(
                    success=False,
                    error="strategy_id required for strategy_performance report",
                )

            result = con.execute("""
                SELECT 
                    strategy_id,
                    COUNT(*) as run_count,
                    AVG(total_return_pct) as avg_return,
                    AVG(sharpe_ratio) as avg_sharpe,
                    AVG(win_rate) as avg_win_rate,
                    SUM(total_trades) as total_trades
                FROM simulation_runs
                WHERE strategy_id = ? AND final_capital IS NOT NULL
                GROUP BY strategy_id
            """, [input.strategy_id]).fetchone()

            return GenerateReportOutput(
                success=True,
                report_type="strategy_performance",
                data=ReportData(
                    strategy_id=result[0] if result else input.strategy_id,
                    run_count=result[1] if result else 0,
                    avg_return_pct=float(result[2]) if result and result[2] else 0.0,
                    avg_sharpe_ratio=float(result[3]) if result and result[3] else 0.0,
                    avg_win_rate=float(result[4]) if result and result[4] else 0.0,
                    total_trades=result[5] if result else 0,
                ),
            )
        else:
            return GenerateReportOutput(
                success=False, error=f"Unknown report type: {input.type}"
            )
    except Exception as e:
        return GenerateReportOutput(success=False, error=str(e))
