"""
Query calls operation.

Pure DuckDB logic: queries calls for batch simulation.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import duckdb
from ..utils import setup_ohlcv_exclusions_schema


class QueryCallsInput(BaseModel):
    limit: int = Field(default=1000, ge=1, le=10000)
    exclude_unrecoverable: bool = Field(default=True)


class CallItem(BaseModel):
    mint: str
    alert_timestamp: str


class QueryCallsOutput(BaseModel):
    success: bool
    calls: Optional[List[CallItem]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryCallsInput) -> QueryCallsOutput:
    """Query calls from DuckDB for batch simulation."""
    try:
        # Setup exclusions schema if needed
        if input.exclude_unrecoverable:
            setup_ohlcv_exclusions_schema(con)

        # Query user_calls_d table for mint addresses and alert timestamps
        base_query = """
            SELECT DISTINCT
                mint,
                call_datetime
            FROM user_calls_d
            WHERE mint IS NOT NULL 
              AND TRIM(CAST(mint AS VARCHAR)) != ''
              AND call_datetime IS NOT NULL
        """

        # Exclude unrecoverable tokens if requested
        if input.exclude_unrecoverable:
            base_query += """
                AND NOT EXISTS (
                    SELECT 1 FROM ohlcv_exclusions_d
                    WHERE ohlcv_exclusions_d.mint = user_calls_d.mint
                      AND ohlcv_exclusions_d.alert_timestamp = user_calls_d.call_datetime
                )
            """

        base_query += """
            ORDER BY call_datetime DESC
            LIMIT ?
        """

        result = con.execute(base_query, [input.limit]).fetchall()

        calls = []
        for row in result:
            mint = row[0]
            call_datetime = row[1]

            # Convert datetime to ISO format string
            if isinstance(call_datetime, datetime):
                alert_timestamp = call_datetime.isoformat()
            elif isinstance(call_datetime, str):
                alert_timestamp = call_datetime
            else:
                # Try to parse as timestamp
                try:
                    dt = datetime.fromtimestamp(call_datetime)
                    alert_timestamp = dt.isoformat()
                except Exception:
                    continue  # Skip invalid timestamps

            calls.append(CallItem(mint=str(mint), alert_timestamp=alert_timestamp))

        return QueryCallsOutput(success=True, calls=calls)
    except Exception as e:
        return QueryCallsOutput(success=False, error=str(e))
