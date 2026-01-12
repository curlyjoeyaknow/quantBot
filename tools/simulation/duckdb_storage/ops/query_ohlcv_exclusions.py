"""
Query OHLCV exclusions operation.

Pure DuckDB logic: queries exclusions to filter out excluded tokens.
"""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import duckdb
from ..utils import setup_ohlcv_exclusions_schema


class QueryOhlcvExclusionsInput(BaseModel):
    token_addresses: Optional[List[str]] = None
    chains: Optional[List[str]] = None
    intervals: Optional[List[str]] = None


class ExcludedItem(BaseModel):
    token_address: str
    chain: str
    interval: str
    reason: str
    excluded_at: str


class QueryOhlcvExclusionsOutput(BaseModel):
    success: bool
    excluded: Optional[List[ExcludedItem]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryOhlcvExclusionsInput) -> QueryOhlcvExclusionsOutput:
    """Query OHLCV exclusions - matches ClickHouse ohlcv_candles structure."""
    try:
        # Check if table exists before querying (read-only connections can't CREATE)
        try:
            con.execute("SELECT 1 FROM ohlcv_exclusions_d LIMIT 1")
        except Exception:
            # Table doesn't exist - return empty list
            return QueryOhlcvExclusionsOutput(success=True, excluded=[])

        # Build query with optional filters
        conditions = []
        params = []

        if input.token_addresses and len(input.token_addresses) > 0:
            placeholders = ','.join(['?' for _ in input.token_addresses])
            conditions.append(f"token_address IN ({placeholders})")
            params.extend(input.token_addresses)

        if input.chains and len(input.chains) > 0:
            placeholders = ','.join(['?' for _ in input.chains])
            conditions.append(f"chain IN ({placeholders})")
            params.extend(input.chains)

        if input.intervals and len(input.intervals) > 0:
            placeholders = ','.join(['?' for _ in input.intervals])
            conditions.append(f"interval IN ({placeholders})")
            params.extend(input.intervals)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        query = f"""
            SELECT token_address, chain, interval, reason, excluded_at
            FROM ohlcv_exclusions_d
            {where_clause}
        """

        result = con.execute(query, params).fetchall()

        excluded = [
            ExcludedItem(
                token_address=row[0],
                chain=row[1],
                interval=row[2],
                reason=row[3],
                excluded_at=row[4].isoformat()
                if isinstance(row[4], datetime)
                else str(row[4]),
            )
            for row in result
        ]

        return QueryOhlcvExclusionsOutput(success=True, excluded=excluded)
    except Exception as e:
        return QueryOhlcvExclusionsOutput(success=False, error=str(e))
