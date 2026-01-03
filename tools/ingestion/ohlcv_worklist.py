#!/usr/bin/env python3
"""
OHLCV Worklist Query for DuckDB

Queries DuckDB for tokens/calls that need OHLCV candles ingested.
Returns a worklist of unique tokens with their earliest alert time.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, Any, Optional

# Add tools/shared to path for datetime_controller
sys.path.insert(0, str(Path(__file__).parent.parent / 'shared'))
from datetime_controller import dt

try:
    import duckdb
except ImportError:
    print("Error: duckdb package not installed. Install with: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def normalize_chain(chain: str) -> str:
    """
    Normalize chain abbreviations to full canonical names.
    
    Maps:
    - 'eth'/'ethereum' -> 'ethereum'
    - 'sol'/'solana' -> 'solana'
    - 'bsc'/'bnb' -> 'bsc' (BNB is BSC's native token, same chain)
    - 'base' -> 'base'
    """
    if not chain:
        return 'solana'  # Default to solana if empty/None
    
    chain_lower = chain.lower().strip()
    chain_map = {
        'eth': 'ethereum',
        'ethereum': 'ethereum',
        'sol': 'solana',
        'solana': 'solana',
        'bsc': 'bsc',
        'bnb': 'bsc',  # BNB is BSC's native token, same chain
        'base': 'base',
    }
    return chain_map.get(chain_lower, 'solana')  # Default to solana if unknown


def get_ohlcv_worklist(
    duckdb_path: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    side: str = 'buy',
    mints: Optional[list] = None
) -> Dict[str, Any]:
    """
    Query DuckDB for OHLCV worklist (calls + tokens with resolved mints).
    
    Returns both:
    1. Token groups (for efficient candle fetching - one fetch per token)
    2. Individual calls with enriched data (for ATH/ATL calculation)
    
    Args:
        duckdb_path: Path to DuckDB database file
        from_date: Optional start date filter (ISO format)
        to_date: Optional end date filter (ISO format)
        side: Call side filter ('buy' or 'sell', default 'buy')
        mints: Optional list of mint addresses to filter by
    
    Returns:
        Dict with:
        - tokenGroups: List of unique tokens (for candle fetching)
        - calls: List of individual calls with price/mcap data (for ATH/ATL)
    """
    if not Path(duckdb_path).exists():
        raise FileNotFoundError(f"DuckDB file not found: {duckdb_path}")
    
    con = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        # Check which tables exist - support both normalized and legacy schemas
        tables = con.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        # Determine which table to use for calls
        # Priority: caller_links_d (normalized) > user_calls_d (legacy)
        if 'caller_links_d' in table_names:
            # Query 1: Token groups (for efficient candle fetching)
            # Note: side parameter is accepted but caller_links_d may not have a side column
            # If side column exists, we'll add it to the WHERE clause
            # Normalize chain in SQL: BNB -> bsc (BNB is BSC's native token, same chain)
            token_group_query = """
            SELECT 
                cl.mint,
                CASE 
                    WHEN LOWER(COALESCE(cl.chain, 'solana')) = 'bnb' THEN 'bsc'
                    ELSE LOWER(COALESCE(cl.chain, 'solana'))
                END as chain,
                MIN(cl.trigger_ts_ms) as earliest_ts_ms,
                COUNT(DISTINCT (cl.trigger_chat_id, cl.trigger_message_id)) as call_count
            FROM caller_links_d cl
            WHERE cl.mint IS NOT NULL
              AND cl.mint != ''
              AND cl.trigger_ts_ms IS NOT NULL
            """
            
            # Try to add side filter if side column exists (check dynamically)
            # Most caller_links_d tables don't have side, so we'll make it optional
            try:
                # Check if side column exists
                columns = con.execute("PRAGMA table_info('caller_links_d')").fetchall()
                column_names = [col[1] for col in columns]
                if 'side' in column_names and side:
                    token_group_query += f" AND cl.side = '{side}'"
            except Exception:
                # If table_info fails or side column doesn't exist, continue without side filter
                pass
            
            # Query 2: Individual calls with enriched data (for ATH/ATL)
            # Normalize chain in SQL: BNB -> bsc (BNB is BSC's native token, same chain)
            calls_query = """
            SELECT 
                cl.mint,
                CASE 
                    WHEN LOWER(COALESCE(cl.chain, 'solana')) = 'bnb' THEN 'bsc'
                    ELSE LOWER(COALESCE(cl.chain, 'solana'))
                END as chain,
                cl.trigger_ts_ms,
                cl.trigger_chat_id,
                cl.trigger_message_id,
                cl.price_usd,
                cl.mcap_usd,
                cl.bot_ts_ms
            FROM caller_links_d cl
            WHERE cl.mint IS NOT NULL
              AND cl.mint != ''
              AND cl.trigger_ts_ms IS NOT NULL
            """
            
            # Add side filter if side column exists (same check as above)
            try:
                columns = con.execute("PRAGMA table_info('caller_links_d')").fetchall()
                column_names = [col[1] for col in columns]
                if 'side' in column_names and side:
                    calls_query += f" AND cl.side = '{side}'"
            except Exception:
                pass
            
            params = []
            
            if from_date:
                from_ts = dt.to_timestamp_ms(dt.from_iso(from_date))
                token_group_query += " AND cl.trigger_ts_ms >= ?"
                calls_query += " AND cl.trigger_ts_ms >= ?"
                params.append(from_ts)
            
            if to_date:
                to_ts = dt.to_timestamp_ms(dt.from_iso(to_date))
                token_group_query += " AND cl.trigger_ts_ms <= ?"
                calls_query += " AND cl.trigger_ts_ms <= ?"
                params.append(to_ts)
            
            # Add mint filter if provided
            if mints and len(mints) > 0:
                # Use parameterized query with IN clause
                placeholders = ','.join(['?' for _ in mints])
                token_group_query += f" AND cl.mint IN ({placeholders})"
                calls_query += f" AND cl.mint IN ({placeholders})"
                params.extend(mints)
            
            token_group_query += """ GROUP BY cl.mint, CASE 
                    WHEN LOWER(COALESCE(cl.chain, 'solana')) = 'bnb' THEN 'bsc'
                    ELSE LOWER(COALESCE(cl.chain, 'solana'))
                END"""
            calls_query += " ORDER BY cl.trigger_ts_ms"
            
        elif 'user_calls_d' in table_names:
            # Query 1: Token groups
            token_group_query = """
            SELECT 
                uc.mint,
                'solana' as chain,
                MIN(uc.call_ts_ms) as earliest_ts_ms,
                COUNT(DISTINCT (uc.chat_id, uc.message_id)) as call_count
            FROM user_calls_d uc
            WHERE uc.mint IS NOT NULL
              AND uc.mint != ''
              AND uc.call_ts_ms IS NOT NULL
            """
            
            # Query 2: Individual calls
            calls_query = """
            SELECT 
                uc.mint,
                'solana' as chain,
                uc.call_ts_ms as trigger_ts_ms,
                uc.chat_id as trigger_chat_id,
                uc.message_id as trigger_message_id,
                uc.price_usd,
                uc.mcap_usd,
                NULL as bot_ts_ms
            FROM user_calls_d uc
            WHERE uc.mint IS NOT NULL
              AND uc.mint != ''
              AND uc.call_ts_ms IS NOT NULL
            """
            
            params = []
            
            if from_date:
                from_ts = dt.to_timestamp_ms(dt.from_iso(from_date))
                token_group_query += " AND uc.call_ts_ms >= ?"
                calls_query += " AND uc.call_ts_ms >= ?"
                params.append(from_ts)
            
            if to_date:
                to_ts = dt.to_timestamp_ms(dt.from_iso(to_date))
                token_group_query += " AND uc.call_ts_ms <= ?"
                calls_query += " AND uc.call_ts_ms <= ?"
                params.append(to_ts)
            
            # Add mint filter if provided
            if mints and len(mints) > 0:
                # Use parameterized query with IN clause
                placeholders = ','.join(['?' for _ in mints])
                token_group_query += f" AND uc.mint IN ({placeholders})"
                calls_query += f" AND uc.mint IN ({placeholders})"
                params.extend(mints)
            
            token_group_query += " GROUP BY uc.mint"
            calls_query += " ORDER BY uc.call_ts_ms"
        else:
            raise ValueError(
                "No supported calls table found in DuckDB. "
                "Expected 'caller_links_d' or 'user_calls_d' table."
            )
        
        # Execute queries
        if params:
            token_groups = con.execute(token_group_query, params).fetchall()
            calls = con.execute(calls_query, params).fetchall()
        else:
            token_groups = con.execute(token_group_query).fetchall()
            calls = con.execute(calls_query).fetchall()
        
        # Debug: Log query results and total counts
        total_tokens_query = "SELECT COUNT(DISTINCT mint) FROM caller_links_d WHERE mint IS NOT NULL AND mint != '' AND trigger_ts_ms IS NOT NULL"
        if params and from_date:
            # Reuse from_date param if available
            total_tokens_query += " AND trigger_ts_ms >= ?"
            total_tokens_result = con.execute(total_tokens_query, [params[0]]).fetchone()
        else:
            total_tokens_result = con.execute(total_tokens_query).fetchone()
        total_tokens = total_tokens_result[0] if total_tokens_result else 0
        
        print(f"DEBUG: Query returned {len(token_groups)} token groups (grouped by mint+chain)", file=sys.stderr)
        print(f"DEBUG: Total unique tokens in date range: {total_tokens}", file=sys.stderr)
        print(f"DEBUG: Total calls in date range: {len(calls)}", file=sys.stderr)
        if from_date:
            print(f"DEBUG: Date filter FROM: {from_date}", file=sys.stderr)
        if to_date:
            print(f"DEBUG: Date filter TO: {to_date}", file=sys.stderr)
        
        # Convert token groups
        token_groups_list = []
        for row in token_groups:
            mint = row[0]
            chain_raw = row[1] or 'solana'
            chain = normalize_chain(chain_raw)  # Normalize chain abbreviation to full name
            earliest_ts_ms = row[2]
            call_count = row[3]
            
            # Return raw earliestAlertTsMs directly - let TypeScript handle conversion
            # This avoids all timezone/datetime parsing issues
            token_groups_list.append({
                'mint': mint,
                'chain': chain,
                'earliestAlertTsMs': int(earliest_ts_ms) if earliest_ts_ms is not None else None,
                'callCount': call_count,
            })
        
        # Convert individual calls
        calls_list = []
        for row in calls:
            mint = row[0]
            chain_raw = row[1] or 'solana'
            chain = normalize_chain(chain_raw)  # Normalize chain abbreviation to full name
            trigger_ts_ms = row[2]
            trigger_chat_id = row[3]
            trigger_message_id = row[4]
            price_usd = row[5]
            mcap_usd = row[6]
            bot_ts_ms = row[7] if len(row) > 7 else None
            
            # Return raw alertTsMs directly - let TypeScript convert to unix seconds
            # This avoids all timezone/datetime parsing issues
            calls_list.append({
                'mint': mint,
                'chain': chain,
                'alertTsMs': int(trigger_ts_ms) if trigger_ts_ms is not None else None,
                'chatId': trigger_chat_id,
                'messageId': str(trigger_message_id) if trigger_message_id else None,
                'priceUsd': float(price_usd) if price_usd is not None else None,
                'mcapUsd': float(mcap_usd) if mcap_usd is not None else None,
                'botTsMs': int(bot_ts_ms) if bot_ts_ms is not None else None,
            })
        
        return {
            'tokenGroups': token_groups_list,
            'calls': calls_list,
        }
    
    finally:
        con.close()


def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(description='Query DuckDB for OHLCV worklist')
    parser.add_argument('--duckdb', required=True, help='Path to DuckDB database file')
    parser.add_argument('--from', dest='from_date', help='Start date filter (ISO format)')
    parser.add_argument('--to', dest='to_date', help='End date filter (ISO format)')
    parser.add_argument('--side', default='buy', choices=['buy', 'sell'], help='Call side filter')
    parser.add_argument('--mints', nargs='*', help='Filter by specific mint addresses')
    
    args = parser.parse_args()
    
    try:
        result = get_ohlcv_worklist(
            args.duckdb,
            from_date=args.from_date,
            to_date=args.to_date,
            side=args.side,
            mints=args.mints
        )
        
        # Output as JSON (for PythonEngine integration)
        print(json.dumps(result))
    
    except Exception as e:
        print(json.dumps({
            'error': str(e),
            'tokenGroups': [],
            'calls': []
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

