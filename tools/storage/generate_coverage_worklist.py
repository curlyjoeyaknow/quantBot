#!/usr/bin/env python3
"""
Generate worklist to infill missing coverage.

Reads JSON output from check_continuous_event_windows.py and generates a worklist
of alerts that need coverage infilling.

Usage:
    python tools/storage/generate_coverage_worklist.py <input.json> <output_worklist.json>
"""

import json
import sys
import argparse
from typing import Dict, List, Any

TIME_WINDOWS = [12, 24, 36, 48, 72, 96]


def load_data(json_path: str) -> Dict[str, Any]:
    """Load JSON data from file."""
    with open(json_path, 'r') as f:
        data = json.load(f)
    return data


def generate_worklist(data: Dict[str, Any], min_windows_missing: int = 1) -> List[Dict[str, Any]]:
    """
    Generate worklist of alerts with missing coverage.
    
    Args:
        data: JSON data from check_continuous_event_windows.py
        min_windows_missing: Minimum number of windows that must be missing to include in worklist
        
    Returns:
        List of worklist items with mint, chain, alert_ts_ms, and missing windows
    """
    worklist = []
    
    alerts = data.get('alerts', [])
    
    for alert in alerts:
        mint = alert['mint']
        chain = alert['chain']
        alert_ts_ms = alert['alert_ts_ms']
        windows = alert.get('windows', {})
        
        # Find missing windows
        missing_windows = []
        for window_hours in TIME_WINDOWS:
            window_key = f'{window_hours}hr'
            if window_key in windows:
                has_coverage = windows[window_key].get('has_coverage', False)
                if not has_coverage:
                    missing_windows.append(window_hours)
        
        # Include in worklist if meets minimum threshold
        if len(missing_windows) >= min_windows_missing:
            worklist.append({
                'mint': mint,
                'chain': chain,
                'alert_ts_ms': alert_ts_ms,
                'missing_windows': missing_windows,
                'missing_window_count': len(missing_windows),
                'total_windows': len(TIME_WINDOWS)
            })
    
    # Sort by number of missing windows (descending) for priority
    worklist.sort(key=lambda x: x['missing_window_count'], reverse=True)
    
    return worklist


def main():
    """Main script entry point."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'input_json',
        help='Input JSON file from check_continuous_event_windows.py'
    )
    parser.add_argument(
        'output_worklist',
        help='Output worklist JSON file path'
    )
    parser.add_argument(
        '--min-windows-missing',
        type=int,
        default=1,
        help='Minimum number of windows that must be missing to include in worklist (default: 1)'
    )
    parser.add_argument(
        '--summary',
        action='store_true',
        help='Print summary statistics'
    )
    
    args = parser.parse_args()
    
    try:
        # Load data
        print(f"Loading data from {args.input_json}...", file=sys.stderr)
        data = load_data(args.input_json)
        print("✓ Data loaded\n", file=sys.stderr)
        
        # Generate worklist
        print("Generating worklist...", file=sys.stderr)
        worklist = generate_worklist(data, min_windows_missing=args.min_windows_missing)
        print(f"✓ Found {len(worklist)} alerts with missing coverage\n", file=sys.stderr)
        
        # Print summary if requested
        if args.summary:
            total_alerts = len(data.get('alerts', []))
            print(f"Summary:", file=sys.stderr)
            print(f"  Total alerts analyzed: {total_alerts}", file=sys.stderr)
            print(f"  Alerts with missing coverage: {len(worklist)}", file=sys.stderr)
            print(f"  Percentage: {len(worklist) / total_alerts * 100:.1f}%" if total_alerts > 0 else "  Percentage: 0%", file=sys.stderr)
            
            # Count by number of missing windows
            missing_counts = {}
            for item in worklist:
                count = item['missing_window_count']
                missing_counts[count] = missing_counts.get(count, 0) + 1
            
            print(f"\n  Missing windows distribution:", file=sys.stderr)
            for count in sorted(missing_counts.keys(), reverse=True):
                print(f"    {count} missing: {missing_counts[count]} alerts", file=sys.stderr)
            print("", file=sys.stderr)
        
        # Write worklist
        output_data = {
            'metadata': {
                'source_file': args.input_json,
                'total_items': len(worklist),
                'min_windows_missing': args.min_windows_missing,
                'time_windows': TIME_WINDOWS
            },
            'worklist': worklist
        }
        
        with open(args.output_worklist, 'w') as f:
            json.dump(output_data, f, indent=2)
        
        print(f"✓ Worklist saved to {args.output_worklist}", file=sys.stderr)
        print(f"  Total items: {len(worklist)}", file=sys.stderr)
        
    except FileNotFoundError as e:
        print(f"[error] File not found: {e}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"[error] Invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

