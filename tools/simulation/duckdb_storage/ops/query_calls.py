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
    caller_name: Optional[str] = Field(default=None)


class CallItem(BaseModel):
    mint: str
    alert_timestamp: str
    caller_name: Optional[str] = None
    price_usd: Optional[float] = None  # Entry price from user_calls_d


class QueryCallsOutput(BaseModel):
    success: bool
    calls: Optional[List[CallItem]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryCallsInput) -> QueryCallsOutput:
    """Query calls from DuckDB for batch simulation."""
    try:
        # Check if user_calls_d table exists
        tables = con.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        if 'user_calls_d' not in table_names:
            return QueryCallsOutput(
                success=False,
                error=f"Table 'user_calls_d' not found in database. Available tables: {', '.join(table_names)}. Please ingest Telegram data first using the ingestion pipeline."
            )
        
        # Setup exclusions schema if needed
        if input.exclude_unrecoverable:
            setup_ohlcv_exclusions_schema(con)

        # Query user_calls_d table for mint addresses, alert timestamps, caller names, and entry price
        base_query = """
            SELECT DISTINCT
                mint,
                call_datetime,
                caller_name,
                price_usd
            FROM user_calls_d
            WHERE mint IS NOT NULL 
              AND TRIM(CAST(mint AS VARCHAR)) != ''
              AND call_datetime IS NOT NULL
        """
        
        # Filter by caller_name if provided
        if input.caller_name:
            base_query += """
                AND caller_name = ?
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

        # Build parameters list: caller_name (if provided) + limit
        params = []
        if input.caller_name:
            params.append(input.caller_name)
        params.append(input.limit)

        result = con.execute(base_query, params).fetchall()

        calls = []
        for row in result:
            mint = row[0]
            call_datetime = row[1]
            caller_name_raw = row[2] if len(row) > 2 else None
            price_usd_raw = row[3] if len(row) > 3 else None
            
            # Normalize caller_name: convert None, empty string, or whitespace to None
            caller_name = None
            if caller_name_raw:
                caller_name_str = str(caller_name_raw).strip()
                if caller_name_str:
                    caller_name = caller_name_str

            # Normalize price_usd: convert to float or None
            price_usd = None
            if price_usd_raw is not None:
                try:
                    price_usd = float(price_usd_raw)
                    # Validate price is positive and finite
                    if price_usd <= 0 or not (price_usd > 0 and price_usd < 1e20):
                        price_usd = None
                except (ValueError, TypeError):
                    price_usd = None

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

            calls.append(CallItem(
                mint=str(mint),
                alert_timestamp=alert_timestamp,
                caller_name=caller_name,
                price_usd=price_usd
            ))

        return QueryCallsOutput(success=True, calls=calls)
    except Exception as e:
        return QueryCallsOutput(success=False, error=str(e))
