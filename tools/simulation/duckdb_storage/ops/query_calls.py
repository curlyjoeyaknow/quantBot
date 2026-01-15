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


class QueryCallsOutput(BaseModel):
    success: bool
    calls: Optional[List[CallItem]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryCallsInput) -> QueryCallsOutput:
            )
        
        # Setup exclusions schema if needed
        can_exclude = False
        if input.exclude_unrecoverable:
            try:
                setup_ohlcv_exclusions_schema(con)
                # Verify the table has the correct schema by checking for token_address column
                columns = con.execute("PRAGMA table_info('ohlcv_exclusions_d')").fetchall()
                column_names = [col[1] for col in columns] if columns else []
                can_exclude = 'token_address' in column_names
            except Exception:
                # If setup fails, skip exclusion check
                can_exclude = False

        if input.exclude_unrecoverable and can_exclude:
            base_query += """
                AND NOT EXISTS (
                    SELECT 1 FROM ohlcv_exclusions_d
                )
            """

        base_query += """
        params.append(input.limit)

        result = con.execute(base_query, params).fetchall()

        calls = []
        for row in result:
            mint = row[0]
            
            # Normalize caller_name: convert None, empty string, or whitespace to None
            caller_name = None
            if caller_name_raw:
                caller_name_str = str(caller_name_raw).strip()
                if caller_name_str:
                    caller_name = caller_name_str

            calls.append(CallItem(
                mint=str(mint),
                alert_timestamp=alert_timestamp,
                caller_name=caller_name,
            ))

        return QueryCallsOutput(success=True, calls=calls)
    except Exception as e:
        return QueryCallsOutput(success=False, error=str(e))
