#!/usr/bin/env python3
"""
OHLCV Patch Worklist Generator

Generates a worklist for patching the 10-hour gap in OHLCV coverage.
For each token and interval (1m, 5m), calculates the fetch window:
- If no candles exist: Normal 10,000 candle fetch
- If candles exist: Gap fill (backwards from 10 hours ahead of alert)
"""

import argparse
import json
import sys
import subprocess
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

try:
    import duckdb
except ImportError:
    print("Error: duckdb package not installed. Install with: pip install duckdb", file=sys.stderr)
    sys.exit(1)


def get_patch_worklist(
    duckdb_path: str,
    clickhouse_container: str = "quantbot-clickhouse-1",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    side: str = 'buy',
    chain: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate patch worklist with calculated fetch windows.
    
    Returns worklist with:
    - For tokens with NO candles: Normal fetch (from 52 intervals before alert, 10,000 candles forward)
    - For tokens WITH candles: Gap fill (from 10 hours ahead - gap, backwards to fill)
    """
    if not Path(duckdb_path).exists():
        raise FileNotFoundError(f"DuckDB file not found: {duckdb_path}")
    
    con = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        # Get unique mints with earliest alert time from DuckDB
        tables = con.execute("SHOW TABLES").fetchall()
        table_names = [t[0] for t in tables]
        
        if 'caller_links_d' in table_names:
            query = """
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
            
            params = []
            if from_date:
                from_ts = int(datetime.fromisoformat(from_date.replace('Z', '+00:00')).timestamp() * 1000)
                query += " AND cl.trigger_ts_ms >= ?"
                params.append(from_ts)
            
            if to_date:
                to_ts = int(datetime.fromisoformat(to_date.replace('Z', '+00:00')).timestamp() * 1000)
                query += " AND cl.trigger_ts_ms <= ?"
                params.append(to_ts)
            
            if chain:
                query += f" AND LOWER(COALESCE(cl.chain, 'solana')) = LOWER(?)"
                params.append(chain)
            
            query += """ GROUP BY cl.mint, CASE 
                    WHEN LOWER(COALESCE(cl.chain, 'solana')) = 'bnb' THEN 'bsc'
                    ELSE LOWER(COALESCE(cl.chain, 'solana'))
                END"""
                
        elif 'user_calls_d' in table_names:
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
            """
            
            params = []
            if from_date:
                from_ts = int(datetime.fromisoformat(from_date.replace('Z', '+00:00')).timestamp() * 1000)
                query += " AND uc.call_ts_ms >= ?"
                params.append(from_ts)
            
            if to_date:
                to_ts = int(datetime.fromisoformat(to_date.replace('Z', '+00:00')).timestamp() * 1000)
                query += " AND uc.call_ts_ms <= ?"
                params.append(to_ts)
            
            query += " GROUP BY uc.mint"
        else:
            raise ValueError("No supported calls table found in DuckDB")
        
        if params:
            token_groups = con.execute(query, params).fetchall()
        else:
            token_groups = con.execute(query).fetchall()
        
        # Now check ClickHouse for existing candles and calculate fetch windows
        worklist_items: List[Dict[str, Any]] = []
        
        # Find actual ClickHouse container name (docker-compose may add prefix)
        actual_container = clickhouse_container
        try:
            # Try to find container by name pattern
            result = subprocess.run(
                ['docker', 'ps', '--format', '{{.Names}}', '--filter', f'name={clickhouse_container}'],
                capture_output=True,
                text=True,
                check=True,
                timeout=5
            )
            if result.stdout.strip():
                actual_container = result.stdout.strip().split('\n')[0]
        except Exception:
            # Fall back to provided name
            pass
        
        # Build a map of (mint, chain, interval) -> first_candle_epoch by batching ClickHouse queries
        # This is much faster than querying each token individually
        first_candle_map: Dict[tuple, Optional[int]] = {}
        
        if actual_container and token_groups:
            print(f"Querying ClickHouse for {len(token_groups)} tokens in batches...", file=sys.stderr)
            
            # Group tokens by chain and interval for batch queries
            for interval in ['1m', '5m']:
                interval_seconds = 60 if interval == '1m' else 300
                
                # Group tokens by chain
                tokens_by_chain: Dict[str, List[str]] = {}
                for row in token_groups:
                    mint = row[0]
                    chain = row[1] or 'solana'
                    if chain not in tokens_by_chain:
                        tokens_by_chain[chain] = []
                    tokens_by_chain[chain].append(mint)
                
                # Query each chain's tokens in batches (max 500 tokens per query to avoid "Argument list too long")
                for chain, mints in tokens_by_chain.items():
                    batch_size = 500
                    for i in range(0, len(mints), batch_size):
                        batch_mints = mints[i:i + batch_size]
                        # Escape mints for SQL
                        escaped_mints = [m.replace("'", "''") for m in batch_mints]
                        mint_list = ','.join([f"'{m}'" for m in escaped_mints])
                        escaped_chain = chain.replace("'", "''")
                        
                        # Batch query: get first candle epoch (min timestamp) for all tokens in this batch
                        batch_query = (
                            f"SELECT token_address, chain, min(toUnixTimestamp(timestamp)) as first_candle_epoch "
                            f"FROM quantbot.ohlcv_candles "
                            f"WHERE token_address IN ({mint_list}) "
                            f"AND chain = '{escaped_chain}' "
                            f"AND interval = {interval_seconds} "
                            f"GROUP BY token_address, chain"
                        )
                        
                        try:
                            result = subprocess.run(
                                ['docker', 'exec', actual_container, 'clickhouse-client', '--query', batch_query, '--format', 'JSONEachRow'],
                                capture_output=True,
                                text=True,
                                check=True,
                                timeout=30
                            )
                            if result.stdout.strip():
                                for line in result.stdout.strip().split('\n'):
                                    if line.strip():
                                        try:
                                            data = json.loads(line)
                                            mint_key = data['token_address']
                                            chain_key = data['chain']
                                            first_epoch = int(data['first_candle_epoch'])
                                            first_candle_map[(mint_key, chain_key, interval)] = first_epoch
                                        except (json.JSONDecodeError, KeyError, ValueError) as e:
                                            print(f"Warning: Failed to parse ClickHouse result: {e}", file=sys.stderr)
                        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                            if isinstance(e, subprocess.CalledProcessError):
                                print(f"Warning: ClickHouse batch query failed for {len(batch_mints)} tokens ({chain}, {interval}): {e.stderr}", file=sys.stderr)
                            # Continue - tokens without results will default to normal fetch
            
            print(f"Found first candles for {len(first_candle_map)} token/interval combinations", file=sys.stderr)
        
        # Now build worklist items using the batched results
        worklist_items: List[Dict[str, Any]] = []
        
        for row in token_groups:
            mint = row[0]
            chain = row[1] or 'solana'
            earliest_ts_ms = row[2]
            call_count = row[3]
            
            if not earliest_ts_ms:
                continue
            
            # Convert to UTC datetime
            earliest_alert_time = datetime.fromtimestamp(earliest_ts_ms / 1000.0, tz=timezone.utc)
            
            # Check ClickHouse for existing candles for both 1m and 5m
            for interval in ['1m', '5m']:
                interval_seconds = 60 if interval == '1m' else 300
                
                # Look up first candle epoch from batched query results
                first_candle_epoch = first_candle_map.get((mint, chain, interval))
                has_existing = first_candle_epoch is not None
                
                # Calculate fetch window
                if not has_existing or first_candle_epoch is None:
                    # No existing candles: Normal 10,000 candle fetch
                    # From: 52 intervals before alert
                    # To: 10,000 candles forward (including the 52 lookback)
                    lookback_seconds = 52 * interval_seconds
                    total_candles = 10000
                    forward_candles = total_candles - 52
                    forward_seconds = forward_candles * interval_seconds
                    
                    from_time = earliest_alert_time.timestamp() - lookback_seconds
                    to_time = earliest_alert_time.timestamp() + forward_seconds
                    fetch_type = 'normal'
                else:
                    # Has existing candles: Gap fill
                    # Find first candle timestamp, subtract 5000 intervals to get gap start
                    # Fetch 100 candles past first_candle_epoch for validation overlap
                    gap_candles = 5000
                    overlap_candles = 100  # Fetch past first candle for validation
                    gap_seconds = gap_candles * interval_seconds
                    overlap_seconds = overlap_candles * interval_seconds
                    
                    # Calculate from_time: first_candle - 5000 intervals
                    # Align to interval boundary to ensure Birdeye API returns data starting at this time
                    from_time_raw = first_candle_epoch - gap_seconds
                    # Align to the nearest lower interval boundary
                    from_time = (from_time_raw // interval_seconds) * interval_seconds
                    # Fetch 100 candles past first_candle_epoch for validation overlap
                    to_time = first_candle_epoch + overlap_seconds
                    fetch_type = 'gap_fill'
                
                worklist_items.append({
                    'mint': mint,
                    'chain': chain,
                    'interval': interval,
                    'alertTime': earliest_alert_time.isoformat().replace('+00:00', 'Z'),
                    'fromTime': datetime.fromtimestamp(from_time, tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    'toTime': datetime.fromtimestamp(to_time, tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    'fromUnix': int(from_time),
                    'toUnix': int(to_time),
                    'fetchType': fetch_type,
                    'hasExisting': has_existing,
                    'firstCandleEpoch': first_candle_epoch,  # Include for filtering in execute handler
                    'callCount': call_count,
                })
        
        # Separate into existing (gap fill) and new (normal fetch) worklists
        existing_items = [item for item in worklist_items if item['fetchType'] == 'gap_fill']
        new_items = [item for item in worklist_items if item['fetchType'] == 'normal']
        
        return {
            'items': worklist_items,
            'totalItems': len(worklist_items),
            'totalTokens': len(set(item['mint'] for item in worklist_items)),
            'existingItems': existing_items,
            'existingTotalItems': len(existing_items),
            'existingTotalTokens': len(set(item['mint'] for item in existing_items)),
            'newItems': new_items,
            'newTotalItems': len(new_items),
            'newTotalTokens': len(set(item['mint'] for item in new_items)),
        }
    
    finally:
        con.close()


def main():
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(description='Generate OHLCV patch worklist')
    parser.add_argument('--duckdb', required=True, help='Path to DuckDB database file')
    parser.add_argument('--clickhouse-container', default='quantbot-clickhouse-1', help='ClickHouse container name')
    parser.add_argument('--from', dest='from_date', help='Start date filter (ISO format)')
    parser.add_argument('--to', dest='to_date', help='End date filter (ISO format)')
    parser.add_argument('--side', default='buy', choices=['buy', 'sell'], help='Call side filter')
    parser.add_argument('--chain', help='Filter by chain (solana, ethereum, bsc, base)')
    parser.add_argument('--output-existing', default='patch-worklist-existing.json', help='Output file for existing tokens (gap fills)')
    parser.add_argument('--output-new', default='patch-worklist-new.json', help='Output file for new tokens (normal fetches)')
    parser.add_argument('--output-all', help='Optional: Output combined worklist to this file')
    
    args = parser.parse_args()
    
    try:
        result = get_patch_worklist(
            args.duckdb,
            clickhouse_container=args.clickhouse_container,
            from_date=args.from_date,
            to_date=args.to_date,
            side=args.side,
            chain=getattr(args, 'chain', None)
        )
        
        # Write separate worklists
        existing_worklist = {
            'items': result['existingItems'],
            'totalItems': result['existingTotalItems'],
            'totalTokens': result['existingTotalTokens'],
            'fetchType': 'gap_fill',
            'description': 'Tokens with existing candles - gap fill needed (1x 1m, 1x 5m)',
        }
        
        new_worklist = {
            'items': result['newItems'],
            'totalItems': result['newTotalItems'],
            'totalTokens': result['newTotalTokens'],
            'fetchType': 'normal',
            'description': 'Tokens with no candles - normal fetch needed (2x 1m, 2x 5m)',
        }
        
        # Resolve output paths to absolute paths (Python script runs from tools/ingestion, but files should be in project root)
        import os
        output_existing_path = os.path.abspath(args.output_existing) if not os.path.isabs(args.output_existing) else args.output_existing
        output_new_path = os.path.abspath(args.output_new) if not os.path.isabs(args.output_new) else args.output_new
        output_all_path = os.path.abspath(args.output_all) if args.output_all and not os.path.isabs(args.output_all) else args.output_all
        
        # Write existing worklist (gap fills)
        with open(output_existing_path, 'w') as f:
            json.dump(existing_worklist, f, indent=2)
        
        # Write new worklist (normal fetches)
        with open(output_new_path, 'w') as f:
            json.dump(new_worklist, f, indent=2)
        
        # Write combined if requested
        if output_all_path:
            with open(output_all_path, 'w') as f:
                json.dump(result, f, indent=2)
        
        # Output summary for TypeScript handler
        print(json.dumps({
            'summary': {
                'totalItems': result['totalItems'],
                'totalTokens': result['totalTokens'],
                'existingItems': result['existingTotalItems'],
                'existingTokens': result['existingTotalTokens'],
                'newItems': result['newTotalItems'],
                'newTokens': result['newTotalTokens'],
            },
            'files': {
                'existing': output_existing_path,
                'new': output_new_path,
                'all': output_all_path if output_all_path else None,
            }
        }, indent=2))
    
    except Exception as e:
        print(json.dumps({
            'error': str(e),
            'items': [],
            'totalItems': 0,
            'totalTokens': 0,
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

