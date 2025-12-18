#!/usr/bin/env python3
"""
OHLCV Worklist Query for DuckDB

Queries DuckDB for tokens/calls that need OHLCV candles ingested.
Returns a worklist of unique tokens with their earliest alert time.
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List

try:
    import duckdb
except ImportError:
    print("Error: duckdb package not installed. Install with: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def get_ohlcv_worklist(
    duckdb_path: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    side: str = 'buy'
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
            token_group_query = """
            SELECT 
                cl.mint,
                COALESCE(cl.chain, 'solana') as chain,
                MIN(cl.trigger_ts_ms) as earliest_ts_ms,
                COUNT(DISTINCT (cl.trigger_chat_id, cl.trigger_message_id)) as call_count
            FROM caller_links_d cl
            WHERE cl.mint IS NOT NULL
              AND cl.mint != ''
              AND cl.trigger_ts_ms IS NOT NULL
            """
            
            # Query 2: Individual calls with enriched data (for ATH/ATL)
            calls_query = """
            SELECT 
                cl.mint,
                COALESCE(cl.chain, 'solana') as chain,
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
            
            params = []
            
            if from_date:
                from_ts = int(datetime.fromisoformat(from_date.replace('Z', '+00:00')).timestamp() * 1000)
                token_group_query += " AND cl.trigger_ts_ms >= ?"
                calls_query += " AND cl.trigger_ts_ms >= ?"
                params.append(from_ts)
            
            if to_date:
                to_ts = int(datetime.fromisoformat(to_date.replace('Z', '+00:00')).timestamp() * 1000)
                token_group_query += " AND cl.trigger_ts_ms <= ?"
                calls_query += " AND cl.trigger_ts_ms <= ?"
                params.append(to_ts)
            
            token_group_query += " GROUP BY cl.mint, cl.chain"
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
                from_ts = int(datetime.fromisoformat(from_date.replace('Z', '+00:00')).timestamp() * 1000)
                token_group_query += " AND uc.call_ts_ms >= ?"
                calls_query += " AND uc.call_ts_ms >= ?"
                params.append(from_ts)
            
            if to_date:
                to_ts = int(datetime.fromisoformat(to_date.replace('Z', '+00:00')).timestamp() * 1000)
                token_group_query += " AND uc.call_ts_ms <= ?"
                calls_query += " AND uc.call_ts_ms <= ?"
                params.append(to_ts)
            
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
        
        # Convert token groups
        token_groups_list = []
        for row in token_groups:
            mint = row[0]
            chain = row[1] or 'solana'
            earliest_ts_ms = row[2]
            call_count = row[3]
            
            if earliest_ts_ms:
                earliest_alert_time = datetime.fromtimestamp(earliest_ts_ms / 1000.0).isoformat() + 'Z'
            else:
                earliest_alert_time = None
            
            token_groups_list.append({
                'mint': mint,
                'chain': chain,
                'earliestAlertTime': earliest_alert_time,
                'callCount': call_count,
            })
        
        # Convert individual calls
        calls_list = []
        for row in calls:
            mint = row[0]
            chain = row[1] or 'solana'
            trigger_ts_ms = row[2]
            trigger_chat_id = row[3]
            trigger_message_id = row[4]
            price_usd = row[5]
            mcap_usd = row[6]
            bot_ts_ms = row[7] if len(row) > 7 else None
            
            if trigger_ts_ms:
                alert_time = datetime.fromtimestamp(trigger_ts_ms / 1000.0).isoformat() + 'Z'
            else:
                alert_time = None
            
            calls_list.append({
                'mint': mint,
                'chain': chain,
                'alertTime': alert_time,
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
    
    args = parser.parse_args()
    
    try:
        result = get_ohlcv_worklist(
            args.duckdb,
            from_date=args.from_date,
            to_date=args.to_date,
            side=args.side
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

