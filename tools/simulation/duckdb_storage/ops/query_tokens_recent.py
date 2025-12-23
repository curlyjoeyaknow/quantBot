"""
Query tokens with calls < 3 months old from DuckDB

Returns unique tokens with their earliest call timestamp.
"""

import duckdb
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pydantic import BaseModel


class TokenItem(BaseModel):
    mint: str
    chain: str
    earliest_call_timestamp: str  # ISO format
    call_count: int


class QueryTokensRecentInput(BaseModel):
    duckdb_path: str
    max_age_days: int = 90  # Default to 3 months


class QueryTokensRecentOutput(BaseModel):
    success: bool
    tokens: Optional[List[TokenItem]] = None
    error: Optional[str] = None


def run(con: duckdb.DuckDBPyConnection, input: QueryTokensRecentInput) -> QueryTokensRecentOutput:
    """Query tokens with calls < max_age_days old from DuckDB."""
    try:
        # Calculate cutoff date (max_age_days ago)
        cutoff_date = datetime.utcnow() - timedelta(days=input.max_age_days)
        cutoff_timestamp_ms = int(cutoff_date.timestamp() * 1000)

        # Check which table exists
        tables = con.execute("SHOW TABLES").fetchall()
        table_names = [table[0] for table in tables]

        tokens: List[TokenItem] = []

        if 'calls_d' in table_names or 'calls_list_d' in table_names:
            # Use calls_d or calls_list_d table
            table_name = 'calls_d' if 'calls_d' in table_names else 'calls_list_d'
            
            query = f"""
                SELECT 
                    cl.mint,
                    CASE 
                        WHEN LOWER(COALESCE(cl.chain, 'solana')) = 'bnb' THEN 'bsc'
                        ELSE LOWER(COALESCE(cl.chain, 'solana'))
                    END as chain,
                    MIN(cl.trigger_ts_ms) as earliest_ts_ms,
                    COUNT(DISTINCT (cl.trigger_ts_ms, cl.mint)) as call_count
                FROM {table_name} cl
                WHERE cl.mint IS NOT NULL 
                  AND TRIM(CAST(cl.mint AS VARCHAR)) != ''
                  AND cl.trigger_ts_ms IS NOT NULL
                  AND cl.trigger_ts_ms >= ?
                GROUP BY cl.mint, chain
                ORDER BY earliest_ts_ms DESC
            """
            
            result = con.execute(query, [cutoff_timestamp_ms]).fetchall()
            
            for row in result:
                mint = str(row[0])
                chain = str(row[1])
                earliest_ts_ms = row[2]
                call_count = row[3]
                
                # Convert timestamp to ISO format
                earliest_dt = datetime.fromtimestamp(earliest_ts_ms / 1000)
                earliest_iso = earliest_dt.isoformat() + 'Z'
                
                tokens.append(TokenItem(
                    mint=mint,
                    chain=chain,
                    earliest_call_timestamp=earliest_iso,
                    call_count=call_count
                ))
                
        elif 'user_calls_d' in table_names:
            # Use user_calls_d table
            query = """
                SELECT 
                    uc.mint,
                    'solana' as chain,
                    MIN(uc.call_ts_ms) as earliest_ts_ms,
                    COUNT(DISTINCT (uc.chat_id, uc.message_id)) as call_count
                FROM user_calls_d uc
                WHERE uc.mint IS NOT NULL
                  AND uc.mint != ''
                  AND uc.call_ts_ms IS NOT NULL
                  AND uc.call_ts_ms >= ?
                GROUP BY uc.mint
                ORDER BY earliest_ts_ms DESC
            """
            
            result = con.execute(query, [cutoff_timestamp_ms]).fetchall()
            
            for row in result:
                mint = str(row[0])
                chain = str(row[1])
                earliest_ts_ms = row[2]
                call_count = row[3]
                
                # Convert timestamp to ISO format
                earliest_dt = datetime.fromtimestamp(earliest_ts_ms / 1000)
                earliest_iso = earliest_dt.isoformat() + 'Z'
                
                tokens.append(TokenItem(
                    mint=mint,
                    chain=chain,
                    earliest_call_timestamp=earliest_iso,
                    call_count=call_count
                ))
        else:
            return QueryTokensRecentOutput(
                success=False,
                error=f"No supported calls table found. Available tables: {', '.join(table_names)}"
            )

        return QueryTokensRecentOutput(success=True, tokens=tokens)
    except Exception as e:
        return QueryTokensRecentOutput(success=False, error=str(e))

