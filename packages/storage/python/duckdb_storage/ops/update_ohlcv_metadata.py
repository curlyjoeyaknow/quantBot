"""
Update OHLCV metadata operation.

Pure DuckDB logic: updates OHLCV availability metadata.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import duckdb
from ..utils import setup_ohlcv_metadata_schema


class UpdateOhlcvMetadataInput(BaseModel):
    mint: str
    alert_timestamp: str
    interval_seconds: int = Field(gt=0)
    time_range_start: str
    time_range_end: str
    candle_count: int = Field(ge=0)


class UpdateOhlcvMetadataOutput(BaseModel):
    success: bool
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: UpdateOhlcvMetadataInput) -> UpdateOhlcvMetadataOutput:
    """Update OHLCV metadata table."""
    try:
        setup_ohlcv_metadata_schema(con)

        con.execute("""
            INSERT OR REPLACE INTO ohlcv_metadata_d
            (mint, alert_timestamp, interval_seconds, time_range_start, time_range_end, candle_count, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [
            input.mint,
            input.alert_timestamp,
            input.interval_seconds,
            input.time_range_start,
            input.time_range_end,
            input.candle_count,
            datetime.now(),
        ])
        con.commit()
        return UpdateOhlcvMetadataOutput(success=True)
    except Exception as e:
        return UpdateOhlcvMetadataOutput(success=False, error=str(e))
