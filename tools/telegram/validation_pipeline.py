#!/usr/bin/env python3
"""
Data Validation Pipeline

Validates data at each stage of the pipeline:
1. Telegram ingestion validation
2. OHLCV coverage validation
3. Simulation data validation
"""

import duckdb
from typing import Dict, Any, List
from dataclasses import dataclass


@dataclass
class ValidationResult:
    """Result of data validation"""
    stage: str
    passed: bool
    errors: List[str]
    warnings: List[str]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'stage': self.stage,
            'passed': self.passed,
            'errors': self.errors,
            'warnings': self.warnings,
        }


def validate_telegram_ingestion(con: duckdb.DuckDBPyConnection, chat_id: str) -> ValidationResult:
    """
    Validate Telegram ingestion data.
    
    Checks:
    - Missing mint addresses
    - Duplicate calls
    - Invalid timestamps
    """
    errors = []
    warnings = []
    
    # Check for missing mints
    missing_mints = con.execute("""
        SELECT COUNT(*) FROM user_calls_d
        WHERE mint IS NULL OR mint = ''
    """).fetchone()[0]
    
    if missing_mints > 0:
        errors.append(f"{missing_mints} calls missing mint addresses")
    
    # Check for duplicate calls (same caller, mint, timestamp)
    duplicates = con.execute("""
        SELECT caller_id, mint, call_ts_ms, COUNT(*) as cnt
        FROM user_calls_d
        GROUP BY caller_id, mint, call_ts_ms
        HAVING COUNT(*) > 1
    """).fetchall()
    
    if duplicates:
        warnings.append(f"{len(duplicates)} duplicate caller/mint/timestamp combinations")
    
    # Check for invalid timestamps
    invalid_timestamps = con.execute("""
        SELECT COUNT(*) FROM user_calls_d
        WHERE call_ts_ms IS NULL OR call_ts_ms <= 0
    """).fetchone()[0]
    
    if invalid_timestamps > 0:
        errors.append(f"{invalid_timestamps} calls with invalid timestamps")
    
    # Check for empty caller_id
    empty_caller = con.execute("""
        SELECT COUNT(*) FROM user_calls_d
        WHERE caller_id IS NULL OR caller_id = ''
    """).fetchone()[0]
    
    if empty_caller > 0:
        warnings.append(f"{empty_caller} calls with empty caller_id")
    
    return ValidationResult(
        stage='telegram_ingestion',
        passed=len(errors) == 0,
        errors=errors,
        warnings=warnings
    )


def validate_ohlcv_coverage(
    con: duckdb.DuckDBPyConnection,
    mint: str,
    start_timestamp: int,
    end_timestamp: int
) -> ValidationResult:
    """
    Validate OHLCV coverage for a token.
    
    Checks:
    - Candle coverage in time window
    - Missing candles
    - Invalid OHLCV values
    """
    errors = []
    warnings = []
    
    # Check if candles exist for the time window
    candle_count = con.execute("""
        SELECT COUNT(*) FROM ohlcv_candles_d
        WHERE mint = ? 
          AND timestamp >= ? 
          AND timestamp <= ?
    """, [mint, start_timestamp, end_timestamp]).fetchone()[0]
    
    if candle_count == 0:
        errors.append(f"No OHLCV candles found for mint {mint} in time window")
    
    # Check for invalid OHLCV values
    invalid_values = con.execute("""
        SELECT COUNT(*) FROM ohlcv_candles_d
        WHERE mint = ?
          AND (open <= 0 OR high <= 0 OR low <= 0 OR close <= 0 OR volume < 0
               OR high < low OR open > high OR close > high OR open < low OR close < low)
    """, [mint]).fetchone()[0]
    
    if invalid_values > 0:
        errors.append(f"{invalid_values} candles with invalid OHLCV values for mint {mint}")
    
    # Check for gaps in candle coverage
    if candle_count > 0:
        # Get expected interval (assume 5m = 300 seconds)
        expected_interval = 300
        expected_candles = (end_timestamp - start_timestamp) // expected_interval
        coverage_pct = (candle_count / expected_candles * 100) if expected_candles > 0 else 0
        
        if coverage_pct < 80:
            warnings.append(f"Low OHLCV coverage: {coverage_pct:.1f}% (expected ~{expected_candles}, got {candle_count})")
    
    return ValidationResult(
        stage='ohlcv_coverage',
        passed=len(errors) == 0,
        errors=errors,
        warnings=warnings
    )


def validate_simulation_data(con: duckdb.DuckDBPyConnection, run_id: str) -> ValidationResult:
    """
    Validate simulation run data.
    
    Checks:
    - Run exists
    - Events exist
    - Metrics are valid
    - Event ordering
    """
    errors = []
    warnings = []
    
    # Check run exists
    run = con.execute("""
        SELECT * FROM simulation_runs WHERE run_id = ?
    """, [run_id]).fetchone()
    
    if not run:
        errors.append(f"Run {run_id} not found")
        return ValidationResult('simulation_data', False, errors, warnings)
    
    # Check events exist
    event_count = con.execute("""
        SELECT COUNT(*) FROM simulation_events WHERE run_id = ?
    """, [run_id]).fetchone()[0]
    
    if event_count == 0:
        warnings.append("No events found for run")
    
    # Check metrics are valid
    # run columns: run_id, strategy_id, mint, alert_timestamp, start_time, end_time,
    #              initial_capital, final_capital, total_return_pct, max_drawdown_pct,
    #              sharpe_ratio, win_rate, total_trades, created_at
    final_capital_idx = 7
    if run[final_capital_idx] is not None and run[final_capital_idx] < 0:
        errors.append("Final capital cannot be negative")
    
    # Check event ordering (events should be in chronological order)
    if event_count > 0:
        out_of_order = con.execute("""
            SELECT COUNT(*) FROM (
                SELECT 
                    event_id,
                    timestamp,
                    LAG(timestamp) OVER (ORDER BY timestamp) as prev_timestamp
                FROM simulation_events
                WHERE run_id = ?
            ) WHERE prev_timestamp IS NOT NULL AND timestamp < prev_timestamp
        """, [run_id]).fetchone()[0]
        
        if out_of_order > 0:
            errors.append(f"{out_of_order} events are out of chronological order")
    
    # Check for missing required event fields
    missing_fields = con.execute("""
        SELECT COUNT(*) FROM simulation_events
        WHERE run_id = ?
          AND (event_type IS NULL OR timestamp IS NULL OR price IS NULL)
    """, [run_id]).fetchone()[0]
    
    if missing_fields > 0:
        errors.append(f"{missing_fields} events with missing required fields")
    
    return ValidationResult(
        stage='simulation_data',
        passed=len(errors) == 0,
        errors=errors,
        warnings=warnings
    )


def validate_all_stages(
    con: duckdb.DuckDBPyConnection,
    chat_id: str,
    mint: str = None,
    start_timestamp: int = None,
    end_timestamp: int = None,
    run_id: str = None
) -> List[ValidationResult]:
    """
    Run all validation stages.
    
    Returns list of validation results for each stage.
    """
    results = []
    
    # Stage 1: Telegram ingestion
    results.append(validate_telegram_ingestion(con, chat_id))
    
    # Stage 2: OHLCV coverage (if mint and timestamps provided)
    if mint and start_timestamp and end_timestamp:
        results.append(validate_ohlcv_coverage(con, mint, start_timestamp, end_timestamp))
    
    # Stage 3: Simulation data (if run_id provided)
    if run_id:
        results.append(validate_simulation_data(con, run_id))
    
    return results


if __name__ == '__main__':
    import argparse
    import json
    
    parser = argparse.ArgumentParser(description='Data Validation Pipeline')
    parser.add_argument('--duckdb', required=True, help='DuckDB file path')
    parser.add_argument('--chat-id', required=True, help='Chat ID to validate')
    parser.add_argument('--mint', help='Mint address for OHLCV validation')
    parser.add_argument('--start-timestamp', type=int, help='Start timestamp for OHLCV validation')
    parser.add_argument('--end-timestamp', type=int, help='End timestamp for OHLCV validation')
    parser.add_argument('--run-id', help='Run ID for simulation validation')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    
    args = parser.parse_args()
    
    con = duckdb.connect(args.duckdb)
    results = validate_all_stages(
        con,
        args.chat_id,
        args.mint,
        args.start_timestamp,
        args.end_timestamp,
        args.run_id
    )
    
    con.close()
    
    if args.json:
        print(json.dumps([r.to_dict() for r in results], indent=2))
    else:
        for result in results:
            status = "✓ PASSED" if result.passed else "✗ FAILED"
            print(f"\n{result.stage}: {status}")
            if result.errors:
                print("  Errors:")
                for error in result.errors:
                    print(f"    - {error}")
            if result.warnings:
                print("  Warnings:")
                for warning in result.warnings:
                    print(f"    - {warning}")

