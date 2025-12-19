"""
Add OHLCV exclusion operation.

Pure DuckDB logic: adds a token to the exclusions table.
"""

from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import duckdb
from ..utils import setup_ohlcv_exclusions_schema


class AddOhlcvExclusionInput(BaseModel):
    mint: str
    alert_timestamp: str
    reason: str


class AddOhlcvExclusionOutput(BaseModel):
    success: bool
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: AddOhlcvExclusionInput) -> AddOhlcvExclusionOutput:
    """Add token to OHLCV exclusions table."""
    try:
        setup_ohlcv_exclusions_schema(con)

        con.execute("""
            INSERT OR REPLACE INTO ohlcv_exclusions_d
            (mint, alert_timestamp, reason, excluded_at)
            VALUES (?, ?, ?, ?)
        """, [
            input.mint,
            input.alert_timestamp,
            input.reason,
            datetime.now(),
        ])
        con.commit()
        return AddOhlcvExclusionOutput(success=True)
    except Exception as e:
        return AddOhlcvExclusionOutput(success=False, error=str(e))
