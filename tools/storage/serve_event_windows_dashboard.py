#!/usr/bin/env python3
"""
End-to-end script to analyze event windows and serve the dashboard.

This script:
1. Runs check_continuous_event_windows.py to generate JSON data
2. Runs visualize_event_windows.py to generate HTML dashboard
3. Serves the HTML dashboard on a local HTTP server

Usage:
    python tools/storage/serve_event_windows_dashboard.py [--duckdb data/alerts.duckdb] [--limit 100] [--port 8000]
"""

import argparse
import sys
import subprocess
import os
import tempfile
import time
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--duckdb',
        default='data/alerts.duckdb',
        help='Path to DuckDB database (default: data/alerts.duckdb)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of alerts to process (for testing)'
    )
    parser.add_argument(
        '--port',
        type=int,
        default=8000,
        help='Port to serve HTTP server on (default: 8000)'
    )
    parser.add_argument(
        '--json',
        help='Use existing JSON file instead of generating (optional)'
    )
    
    args = parser.parse_args()
    
    # Get script directory
    script_dir = Path(__file__).parent
    
    # Create temp files for JSON and HTML
    if args.json:
        json_path = args.json
    else:
        json_path = os.path.join(script_dir, 'event_windows_results.json')
    
    html_path = os.path.join(script_dir, 'event_windows_dashboard.html')
    
    try:
        # Step 1: Generate JSON (if not using existing)
        if not args.json:
            print("Step 1: Analyzing event windows...", file=sys.stderr)
            cmd = [
                sys.executable,
                str(script_dir / 'check_continuous_event_windows.py'),
                '--duckdb', args.duckdb,
                '--output', json_path
            ]
            if args.limit:
                cmd.extend(['--limit', str(args.limit)])
            
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            if result.stderr:
                print(result.stderr, file=sys.stderr)
            print("✓ JSON data generated\n", file=sys.stderr)
        else:
            if not os.path.exists(json_path):
                print(f"[error] JSON file not found: {json_path}", file=sys.stderr)
                sys.exit(1)
            print(f"✓ Using existing JSON file: {json_path}\n", file=sys.stderr)
        
        # Step 2: Generate HTML
        print("Step 2: Generating HTML dashboard...", file=sys.stderr)
        cmd = [
            sys.executable,
            str(script_dir / 'visualize_event_windows.py'),
            json_path,
            html_path
        ]
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        print("✓ HTML dashboard generated\n", file=sys.stderr)
        
        # Step 3: Serve HTTP server
        print(f"Step 3: Starting HTTP server on port {args.port}...", file=sys.stderr)
        print(f"\n{'='*70}", file=sys.stderr)
        print(f"Dashboard is available at:", file=sys.stderr)
        print(f"  http://127.0.0.1:{args.port}/event_windows_dashboard.html", file=sys.stderr)
        print(f"{'='*70}\n", file=sys.stderr)
        print("Press Ctrl+C to stop the server\n", file=sys.stderr)
        
        # Start HTTP server
        import http.server
        import socketserver
        
        os.chdir(script_dir)
        Handler = http.server.SimpleHTTPRequestHandler
        with socketserver.TCPServer(("127.0.0.1", args.port), Handler) as httpd:
            httpd.serve_forever()
    
    except subprocess.CalledProcessError as e:
        print(f"[error] Command failed: {e}", file=sys.stderr)
        if e.stdout:
            print(e.stdout, file=sys.stderr)
        if e.stderr:
            print(e.stderr, file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[info] Server stopped by user", file=sys.stderr)
        sys.exit(0)
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

