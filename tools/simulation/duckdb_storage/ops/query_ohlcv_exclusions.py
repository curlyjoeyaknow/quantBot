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
    mints: List[str]
    alert_timestamps: List[str]


class ExcludedItem(BaseModel):
    mint: str
    alert_timestamp: str
    reason: str


class QueryOhlcvExclusionsOutput(BaseModel):
    success: bool
    excluded: Optional[List[ExcludedItem]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryOhlcvExclusionsInput) -> QueryOhlcvExclusionsOutput:
    """Query OHLCV exclusions to filter out excluded tokens."""
    try:
        setup_ohlcv_exclusions_schema(con)

        if (
            not input.mints
            or not input.alert_timestamps
            or len(input.mints) != len(input.alert_timestamps)
        ):
            return QueryOhlcvExclusionsOutput(success=True, excluded=[])

        # Build query to check exclusions
        conditions = []
        params = []
        for mint, alert_ts in zip(input.mints, input.alert_timestamps):
            conditions.append("(mint = ? AND alert_timestamp = ?)")
            params.extend([mint, alert_ts])

        query = f"""
            SELECT mint, alert_timestamp, reason
            FROM ohlcv_exclusions_d
            WHERE {' OR '.join(conditions)}
        """

        result = con.execute(query, params).fetchall()

        excluded = [
            ExcludedItem(
                mint=row[0],
                alert_timestamp=row[1].isoformat()
                if isinstance(row[1], datetime)
                else str(row[1]),
                reason=row[2],
            )
            for row in result
        ]

        return QueryOhlcvExclusionsOutput(success=True, excluded=excluded)
    except Exception as e:
        return QueryOhlcvExclusionsOutput(success=False, error=str(e))
