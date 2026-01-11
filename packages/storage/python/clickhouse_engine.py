#!/usr/bin/env python3
"""
ClickHouse Engine for Simulation Components

Provides Python interface to ClickHouse for:
- Querying OHLCV data
- Storing simulation events
- Aggregating metrics
"""

import argparse
import json
import sys
from typing import Dict, Any, List, Optional
from datetime import datetime

try:
    from clickhouse_connect import get_client
    CLICKHOUSE_AVAILABLE = True
except ImportError:
    CLICKHOUSE_AVAILABLE = False


def query_ohlcv(
    client,
    token_address: str,
    chain: str,
    start_time: datetime,
    end_time: datetime,
    interval: str = '5m'
) -> Dict[str, Any]:
    """Query OHLCV candles from ClickHouse."""
    try:
        database = 'quantbot'
        query = f"""
            SELECT 
                toUnixTimestamp(timestamp) as timestamp,
                open,
                high,
                low,
                close,
                volume
            FROM {database}.ohlcv_candles
            WHERE token_address = %(token_address)s
              AND chain = %(chain)s
              AND interval = %(interval)s
              AND timestamp >= %(start_time)s
              AND timestamp <= %(end_time)s
            ORDER BY timestamp ASC
        """
        
        result = client.query(
            query,
            parameters={
                'token_address': token_address,
                'chain': chain,
                'interval': interval,
                'start_time': start_time,
                'end_time': end_time
            }
        )
        
        candles = []
        for row in result.result_rows:
            candles.append({
                'timestamp': row[0],
                'open': float(row[1]),
                'high': float(row[2]),
                'low': float(row[3]),
                'close': float(row[4]),
                'volume': float(row[5])
            })
        
        return {'success': True, 'candles': candles, 'count': len(candles)}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def store_simulation_events(
    client,
    run_id: str,
    events: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Store simulation events in ClickHouse."""
    try:
        database = 'quantbot'
        table = f'{database}.simulation_events'
        
        rows = []
        for event in events:
            rows.append({
                'simulation_run_id': int(run_id),
                'token_address': event.get('token_address', ''),
                'chain': event.get('chain', 'solana'),
                'event_time': datetime.fromtimestamp(event['timestamp']),
                'event_type': event['event_type'],
                'price': float(event['price']),
                'quantity': float(event.get('quantity', 0)),
                'value_usd': float(event.get('value_usd', 0)),
                'pnl_usd': float(event.get('pnl_usd', 0)),
                'metadata': json.dumps(event.get('metadata', {}))
            })
        
        client.insert(table, rows)
        return {'success': True, 'stored_count': len(rows)}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def aggregate_metrics(
    client,
    run_id: str
) -> Dict[str, Any]:
    """Aggregate metrics from simulation events."""
    try:
        database = 'quantbot'
        query = f"""
            SELECT 
                COUNT(*) as event_count,
                SUM(pnl_usd) as total_pnl,
                AVG(pnl_usd) as avg_pnl,
                MIN(pnl_usd) as min_pnl,
                MAX(pnl_usd) as max_pnl
            FROM {database}.simulation_events
            WHERE simulation_run_id = %(run_id)s
        """
        
        result = client.query(query, parameters={'run_id': int(run_id)})
        row = result.result_rows[0] if result.result_rows else None
        
        if row:
            return {
                'success': True,
                'metrics': {
                    'event_count': row[0],
                    'total_pnl': float(row[1]) if row[1] else 0,
                    'avg_pnl': float(row[2]) if row[2] else 0,
                    'min_pnl': float(row[3]) if row[3] else 0,
                    'max_pnl': float(row[4]) if row[4] else 0
                }
            }
        else:
            return {'success': True, 'metrics': {}}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def main():
    parser = argparse.ArgumentParser(description='ClickHouse Engine for Simulation')
    parser.add_argument('--host', default='localhost', help='ClickHouse host')
    parser.add_argument('--port', type=int, default=8123, help='ClickHouse port')
    parser.add_argument('--database', default='quantbot', help='ClickHouse database')
    parser.add_argument('--username', help='ClickHouse username')
    parser.add_argument('--password', help='ClickHouse password')
    parser.add_argument('--operation', required=True, choices=['query_ohlcv', 'store_events', 'aggregate_metrics'])
    parser.add_argument('--data', required=True, help='JSON data for operation')
    
    args = parser.parse_args()
    
    if not CLICKHOUSE_AVAILABLE:
        print(json.dumps({'success': False, 'error': 'clickhouse-connect not installed'}))
        sys.exit(1)
    
    try:
        # Connect to ClickHouse
        client = get_client(
            host=args.host,
            port=args.port,
            database=args.database,
            username=args.username,
            password=args.password
        )
        
        # Parse data
        data = json.loads(args.data)
        
        # Execute operation
        if args.operation == 'query_ohlcv':
            result = query_ohlcv(
                client,
                data['token_address'],
                data['chain'],
                datetime.fromisoformat(data['start_time']),
                datetime.fromisoformat(data['end_time']),
                data.get('interval', '5m')
            )
        elif args.operation == 'store_events':
            result = store_simulation_events(
                client,
                data['run_id'],
                data['events']
            )
        elif args.operation == 'aggregate_metrics':
            result = aggregate_metrics(client, data['run_id'])
        else:
            result = {'success': False, 'error': f'Unknown operation: {args.operation}'}
        
        # Output result as JSON
        print(json.dumps(result))
        
        client.close()
        sys.exit(0 if result.get('success') else 1)
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()

