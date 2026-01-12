"""
Query OHLCV metadata operation.

Pure DuckDB logic: queries OHLCV availability metadata.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import duckdb
from ..utils import setup_ohlcv_metadata_schema


class QueryOhlcvMetadataInput(BaseModel):
    mint: str
    alert_timestamp: str
    interval_seconds: int = Field(gt=0)
    required_start: Optional[str] = None
    required_end: Optional[str] = None


class QueryOhlcvMetadataOutput(BaseModel):
    success: bool
    available: Optional[bool] = None
    time_range_start: Optional[str] = None
    time_range_end: Optional[str] = None
    candle_count: Optional[int] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryOhlcvMetadataInput) -> QueryOhlcvMetadataOutput:
    """Query OHLCV metadata to check availability."""
    try:
        # Check if table exists before querying (read-only connections can't CREATE)
        try:
            con.execute("SELECT 1 FROM ohlcv_metadata_d LIMIT 1")
        except Exception:
            # Table doesn't exist - return not available
            return QueryOhlcvMetadataOutput(success=True, available=False)

        query = """
            SELECT time_range_start, time_range_end, candle_count
            FROM ohlcv_metadata_d
            WHERE mint = ? AND alert_timestamp = ? AND interval_seconds = ?
        """
        params = [
            input.mint,
            input.alert_timestamp,
            input.interval_seconds,
        ]

        if input.required_start and input.required_end:
            query += " AND time_range_start <= ? AND time_range_end >= ?"
            params.extend([input.required_start, input.required_end])

        result = con.execute(query, params).fetchone()

        if result:
            return QueryOhlcvMetadataOutput(
                success=True,
                available=True,
                time_range_start=result[0].isoformat()
                if isinstance(result[0], datetime)
                else str(result[0]),
                time_range_end=result[1].isoformat()
                if isinstance(result[1], datetime)
                else str(result[1]),
                candle_count=result[2],
            )
        else:
            return QueryOhlcvMetadataOutput(success=True, available=False)
    except Exception as e:
        return QueryOhlcvMetadataOutput(success=False, error=str(e))
