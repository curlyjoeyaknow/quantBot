"""
Query calls operation.

Pure DuckDB logic: queries calls for batch simulation.

Uses canon.alerts_std view (replaces user_calls_d).
This is the canonical alert contract - one row per alert, stable columns forever.
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
    price_usd: Optional[float] = None  # Entry price (not available in alerts_std, kept for compatibility)


class QueryCallsOutput(BaseModel):
    success: bool
    calls: Optional[List[CallItem]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryCallsInput) -> QueryCallsOutput:
    """Query calls from DuckDB for batch simulation.
    
    Uses canon.alerts_std view (the canonical alert contract).
    This replaces user_calls_d - one row per alert, stable columns forever.
    """
    try:
        # Check if canon.alerts_std view exists
        # Try to query the view to see if it exists
        try:
            con.execute("SELECT 1 FROM canon.alerts_std LIMIT 1").fetchone()
        except Exception:
            # Check what views/tables are available
            try:
                views = con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'canon'").fetchall()
                view_names = [v[0] for v in views] if views else []
            except Exception:
                view_names = []
            
            return QueryCallsOutput(
                success=False,
                error=f"View 'canon.alerts_std' not found in database. Available canon views: {', '.join(view_names) if view_names else 'none'}. Please ensure the canonical schema is set up."
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

        # Query canon.alerts_std view for mint addresses, alert timestamps, and caller names
        # Schema: alert_id, alert_chat_id, alert_message_id, alert_ts_ms, alert_kind, mint, chain, 
        #         mint_source, caller_raw_name, caller_id, caller_name_norm, caller_base, alert_text, run_id, ingested_at
        base_query = """
            SELECT DISTINCT
                mint,
                alert_ts_ms,
                COALESCE(caller_name_norm, caller_raw_name) AS caller_name
            FROM canon.alerts_std
            WHERE mint IS NOT NULL 
              AND TRIM(CAST(mint AS VARCHAR)) != ''
              AND alert_ts_ms IS NOT NULL
        """
        
        # Filter by caller_name if provided (check both normalized and raw)
        if input.caller_name:
            base_query += """
                AND (caller_name_norm = ? OR caller_raw_name = ?)
            """

        # Exclude unrecoverable tokens if requested and table has correct schema
        if input.exclude_unrecoverable and can_exclude:
            base_query += """
                AND NOT EXISTS (
                    SELECT 1 FROM ohlcv_exclusions_d
                    WHERE ohlcv_exclusions_d.token_address = canon.alerts_std.mint
                )
            """

        base_query += """
            ORDER BY alert_ts_ms DESC
            LIMIT ?
        """

        # Build parameters list: caller_name (if provided, twice for norm and raw) + limit
        params = []
        if input.caller_name:
            params.append(input.caller_name)
            params.append(input.caller_name)
        params.append(input.limit)

        result = con.execute(base_query, params).fetchall()

        calls = []
        for row in result:
            mint = row[0]
            alert_ts_ms = row[1]
            caller_name_raw = row[2] if len(row) > 2 else None
            
            # Normalize caller_name: convert None, empty string, or whitespace to None
            caller_name = None
            if caller_name_raw:
                caller_name_str = str(caller_name_raw).strip()
                if caller_name_str:
                    caller_name = caller_name_str

            # Convert alert_ts_ms (milliseconds) to ISO format datetime string
            try:
                if isinstance(alert_ts_ms, (int, float)):
                    dt = datetime.fromtimestamp(alert_ts_ms / 1000.0)
                    alert_timestamp = dt.isoformat()
                elif isinstance(alert_ts_ms, datetime):
                    alert_timestamp = alert_ts_ms.isoformat()
                elif isinstance(alert_ts_ms, str):
                    alert_timestamp = alert_ts_ms
                else:
                    continue  # Skip invalid timestamps
            except Exception:
                continue  # Skip invalid timestamps

            # price_usd is not available in canon.alerts_std (would need to join with bot_cards or other source)
            # Keeping it as None for now - can be added later if needed
            calls.append(CallItem(
                mint=str(mint),
                alert_timestamp=alert_timestamp,
                caller_name=caller_name,
                price_usd=None  # Not available in alerts_std
            ))

        return QueryCallsOutput(success=True, calls=calls)
    except Exception as e:
        return QueryCallsOutput(success=False, error=str(e))
