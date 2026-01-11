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
    token_address: str
    chain: str
    interval: str
    reason: str


class AddOhlcvExclusionOutput(BaseModel):
    success: bool
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: AddOhlcvExclusionInput) -> AddOhlcvExclusionOutput:
    """Add token to OHLCV exclusions table - matches ClickHouse ohlcv_candles structure."""
    try:
        setup_ohlcv_exclusions_schema(con)

        con.execute("""
            INSERT OR REPLACE INTO ohlcv_exclusions_d
            (token_address, chain, interval, reason, excluded_at)
            VALUES (?, ?, ?, ?, ?)
        """, [
            input.token_address,
            input.chain,
            input.interval,
            input.reason,
            datetime.now(),
        ])
        con.commit()
        return AddOhlcvExclusionOutput(success=True)
    except Exception as e:
        return AddOhlcvExclusionOutput(success=False, error=str(e))
