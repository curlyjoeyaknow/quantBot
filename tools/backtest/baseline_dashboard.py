#!/usr/bin/env python3
"""
Baseline Truth-Layer Dashboard

Shows:
- All alerts by callers (no trading strategy applied)
- Results over different horizons (30m, 2h, 6h, 12h, 24h, 7d)
- Caller leaderboards
- Drill-down into each token: raw price charts
- Performance metrics per caller (% 2x, %3x, %5x, %10x, drawdown pre-2x, etc)
"""

import sys
import json
from pathlib import Path
from urllib.parse import unquote
from http.server import BaseHTTPRequestHandler, HTTPServer
import duckdb
import pandas as pd

class BaselineDashboardHandler(BaseHTTPRequestHandler):
    """HTTP handler for baseline truth-layer dashboard."""
    
    def __init__(self, duckdb_path: str, slices_dir: str, *args, **kwargs):
        self.duckdb_path = duckdb_path
        self.slices_dir = slices_dir
        super().__init__(*args, **kwargs)
    
    def log_message(self, format, *args):
        """Suppress default logging."""
        pass
    
    def do_GET(self):
        """Handle GET requests."""
        try:
            path = unquote(self.path)
            
            if path == '/' or path == '/baseline':
                self.send_baseline_home()
            elif path.startswith('/baseline/caller/'):
                caller = path.split('/baseline/caller/')[1].split('?')[0]
                run_id = self.get_query_param('run_id')
                self.send_caller_detail(caller, run_id)
            elif path.startswith('/baseline/alert/'):
                alert_id = path.split('/baseline/alert/')[1].split('?')[0]
                run_id = self.get_query_param('run_id')
                self.send_alert_detail(alert_id, run_id)
            elif path.startswith('/api/baseline/leaderboard'):
                self.send_leaderboard_api()
            elif path.startswith('/api/baseline/caller/'):
                caller = path.split('/api/baseline/caller/')[1].split('?')[0]
                run_id = self.get_query_param('run_id')
                self.send_caller_alerts_api(caller, run_id)
            elif path.startswith('/api/baseline/alert/'):
                alert_id = path.split('/api/baseline/alert/')[1].split('?')[0]
                run_id = self.get_query_param('run_id')
                self.send_alert_data_api(alert_id, run_id)
            else:
                self.send_error(404, "Not found")
        except Exception as e:
            print(f"Error in do_GET: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            try:
                self.send_error(500, str(e))
            except:
                pass
    
    def get_query_param(self, key: str, default: str = None):
        """Extract query parameter from URL."""
        if '?' not in self.path:
            return default
        query = self.path.split('?')[1]
        params = {}
        for pair in query.split('&'):
            if '=' in pair:
                k, v = pair.split('=', 1)
                params[k] = v
        return params.get(key, default)
    
    def send_baseline_home(self):
        """Send baseline dashboard home page with caller leaderboard."""
        conn = duckdb.connect(self.duckdb_path, read_only=True)
        
        try:
            # Get caller leaderboard from baseline.caller_stats_f or aggregate from alert_results_f
            try:
                df = conn.execute("""
                    SELECT 
                        caller,
                        n as total_calls,
                        hit2x_pct,
                        hit3x_pct,
                        hit4x_pct,
                        hit5x_pct,
                        hit10x_pct,
                        median_ath as median_ath_mult,
                        median_dd_initial_pct,
                        median_dd_pre2x_pct
                    FROM baseline.caller_stats_f
                    WHERE run_id = (SELECT run_id FROM baseline.runs_d ORDER BY created_at DESC LIMIT 1)
                    ORDER BY total_calls DESC
                """).df()
            except:
                # Fallback: aggregate from alert_results_f
                df = conn.execute("""
                    SELECT 
                        caller,
                        COUNT(*) as total_calls,
                        AVG(CASE WHEN ath_mult >= 2.0 THEN 100.0 ELSE 0.0 END) as hit2x_pct,
                        AVG(CASE WHEN ath_mult >= 3.0 THEN 100.0 ELSE 0.0 END) as hit3x_pct,
                        AVG(CASE WHEN ath_mult >= 4.0 THEN 100.0 ELSE 0.0 END) as hit4x_pct,
                        AVG(CASE WHEN ath_mult >= 5.0 THEN 100.0 ELSE 0.0 END) as hit5x_pct,
                        AVG(CASE WHEN ath_mult >= 10.0 THEN 100.0 ELSE 0.0 END) as hit10x_pct,
                        MEDIAN(ath_mult) as median_ath_mult,
                        MEDIAN(dd_initial) * 100 as median_dd_initial_pct,
                        MEDIAN(dd_pre2x) * 100 as median_dd_pre2x_pct
                    FROM baseline.alert_results_f
                    WHERE status = 'ok'
                    GROUP BY caller
                    ORDER BY total_calls DESC
                """).df()
            
            callers = df.to_dict('records') if not df.empty else []
            
            # Get latest run_id
            run_id_row = conn.execute("SELECT run_id FROM baseline.runs_d ORDER BY created_at DESC LIMIT 1").fetchone()
            latest_run_id = run_id_row[0] if run_id_row else None
            
        finally:
            conn.close()
        
        html = self.render_baseline_home(callers, latest_run_id)
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        self.wfile.write(html.encode())
    
    def render_baseline_home(self, callers, run_id):
        """Render baseline home page HTML."""
        return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Baseline Truth-Layer Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        :root {{
            --bg-primary: #0a0e17;
            --bg-secondary: #111827;
            --bg-card: #1a2234;
            --bg-hover: #243044;
            --accent-green: #10b981;
            --accent-blue: #3b82f6;
            --accent-purple: #8b5cf6;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --border-color: #2d3748;
        }}
        
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 2rem;
        }}
        
        .container {{
            max-width: 1600px;
            margin: 0 auto;
        }}
        
        header {{
            margin-bottom: 2rem;
            padding: 1.5rem;
            background: var(--bg-card);
            border-radius: 12px;
            border: 1px solid var(--border-color);
        }}
        
        h1 {{
            font-size: 2rem;
            font-weight: 700;
            color: var(--accent-green);
            margin-bottom: 0.5rem;
        }}
        
        .subtitle {{
            color: var(--text-secondary);
            font-size: 0.9rem;
        }}
        
        .leaderboard {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
        }}
        
        .leaderboard-header {{
            padding: 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
        }}
        
        .leaderboard-table {{
            width: 100%;
            border-collapse: collapse;
        }}
        
        .leaderboard-table th {{
            text-align: left;
            padding: 1rem 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 2px solid var(--border-color);
            color: var(--text-secondary);
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
        }}
        
        .leaderboard-table td {{
            padding: 1rem 1.5rem;
            border-bottom: 1px solid var(--border-color);
            font-size: 0.9rem;
        }}
        
        .leaderboard-table tr {{
            cursor: pointer;
            transition: background 0.2s;
        }}
        
        .leaderboard-table tr:hover {{
            background: var(--bg-hover);
        }}
        
        .caller-name {{
            font-weight: 600;
            color: var(--accent-blue);
        }}
        
        .metric-value {{
            font-family: 'JetBrains Mono', monospace;
        }}
        
        .positive {{ color: var(--accent-green); }}
        .negative {{ color: #ef4444; }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>📊 Baseline Truth-Layer Dashboard</h1>
            <p class="subtitle">Raw price action metrics - No trading strategies applied</p>
        </header>
        
        <div class="leaderboard">
            <div class="leaderboard-header">
                <h2>Caller Leaderboard</h2>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.5rem;">
                    Click on any caller to view their alerts and performance charts
                </p>
            </div>
            
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th>Caller</th>
                        <th>Calls</th>
                        <th>% 2x</th>
                        <th>% 3x</th>
                        <th>% 5x</th>
                        <th>% 10x</th>
                        <th>Median ATH</th>
                        <th>Median DD (Initial)</th>
                        <th>DD Pre-2x</th>
                    </tr>
                </thead>
                <tbody>
                    {self.render_leaderboard_rows(callers, run_id)}
                </tbody>
            </table>
        </div>
    </div>
    
    <script>
        // Make rows clickable
        document.querySelectorAll('.leaderboard-table tbody tr').forEach(row => {{
            row.addEventListener('click', () => {{
                const caller = row.dataset.caller;
                window.location.href = `/baseline/caller/${{caller}}{'?run_id=' + run_id if run_id else ''}`;
            }});
        }});
    </script>
</body>
</html>'''
    
    def render_leaderboard_rows(self, callers, run_id):
        """Render leaderboard table rows."""
        if not callers:
            return '<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No callers found</td></tr>'
        
        rows = []
        for c in callers:
            caller = c.get('caller', 'Unknown')
            run_param = f'?run_id={run_id}' if run_id else ''
            rows.append(f'''
                <tr data-caller="{caller}">
                    <td class="caller-name">{caller}</td>
                    <td class="metric-value">{int(c.get('total_calls', 0))}</td>
                    <td class="metric-value positive">{float(c.get('hit2x_pct', 0)):.1f}%</td>
                    <td class="metric-value positive">{float(c.get('hit3x_pct', 0)):.1f}%</td>
                    <td class="metric-value positive">{float(c.get('hit5x_pct', 0)):.1f}%</td>
                    <td class="metric-value positive">{float(c.get('hit10x_pct', 0)):.1f}%</td>
                    <td class="metric-value">{float(c.get('median_ath_mult', 0)):.2f}x</td>
                    <td class="metric-value negative">{float(c.get('median_dd_initial_pct', 0)):.1f}%</td>
                    <td class="metric-value negative">{float(c.get('median_dd_pre2x_pct', 0)):.1f}%</td>
                </tr>
            ''')
        return ''.join(rows)
    
    def send_leaderboard_api(self):
        """Send leaderboard data as JSON."""
        conn = duckdb.connect(self.duckdb_path, read_only=True)
        try:
            # Similar query as above, return as JSON
            df = conn.execute("""
                SELECT 
                    caller,
                    COUNT(*) as total_calls,
                    AVG(CASE WHEN ath_mult >= 2.0 THEN 100.0 ELSE 0.0 END) as hit2x_pct,
                    AVG(CASE WHEN ath_mult >= 3.0 THEN 100.0 ELSE 0.0 END) as hit3x_pct,
                    AVG(CASE WHEN ath_mult >= 4.0 THEN 100.0 ELSE 0.0 END) as hit4x_pct,
                    AVG(CASE WHEN ath_mult >= 5.0 THEN 100.0 ELSE 0.0 END) as hit5x_pct,
                    AVG(CASE WHEN ath_mult >= 10.0 THEN 100.0 ELSE 0.0 END) as hit10x_pct,
                    MEDIAN(ath_mult) as median_ath_mult,
                    MEDIAN(dd_initial) * 100 as median_dd_initial_pct,
                    MEDIAN(dd_pre2x) * 100 as median_dd_pre2x_pct
                FROM baseline.alert_results_f
                WHERE status = 'ok'
                GROUP BY caller
                ORDER BY total_calls DESC
            """).df()
            callers = df.to_dict('records') if not df.empty else []
            self.send_json_response(callers)
        finally:
            conn.close()
    
    def send_caller_detail(self, caller, run_id):
        """Send caller detail page with their alerts."""
        # TODO: Implement caller detail view
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        self.wfile.write(f'<h1>Caller: {caller}</h1><p>Detail view coming soon...</p>'.encode())
    
    def send_alert_detail(self, alert_id, run_id):
        """Send alert detail page with raw price chart."""
        # TODO: Implement alert detail with chart
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        self.wfile.write(f'<h1>Alert: {alert_id}</h1><p>Chart view coming soon...</p>'.encode())
    
    def send_caller_alerts_api(self, caller, run_id):
        """Send caller alerts as JSON."""
        # TODO: Implement
        self.send_json_response([])
    
    def send_alert_data_api(self, alert_id, run_id):
        """Send alert data as JSON."""
        # TODO: Implement
        self.send_json_response({})
    
    def send_json_response(self, data):
        """Send JSON response."""
        json_str = json.dumps(data, default=str, indent=2)
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json_str.encode())


def create_handler(duckdb_path: str, slices_dir: str):
    """Create handler with closure over duckdb_path."""
    def handler(*args, **kwargs):
        return BaselineDashboardHandler(duckdb_path, slices_dir, *args, **kwargs)
    return handler


if __name__ == '__main__':
    import argparse
    import os
    
    parser = argparse.ArgumentParser(description='Baseline Truth-Layer Dashboard')
    parser.add_argument('--duckdb', default=os.getenv('DUCKDB_PATH', 'data/alerts.duckdb'),
                        help='Path to DuckDB file')
    parser.add_argument('--slices-dir', default='slices/per_token',
                        help='Directory for OHLCV slice files')
    parser.add_argument('--port', type=int, default=8081,
                        help='Port to serve on (default: 8081)')
    parser.add_argument('--host', default='0.0.0.0',
                        help='Host to bind to (default: 0.0.0.0)')
    args = parser.parse_args()
    
    if not os.path.exists(args.duckdb):
        print(f"Error: DuckDB file not found: {args.duckdb}", file=sys.stderr)
        sys.exit(1)
    
    handler = create_handler(args.duckdb, args.slices_dir)
    server = HTTPServer((args.host, args.port), handler)
    
    print(f"📊 Baseline Dashboard starting...")
    print(f"   DuckDB: {args.duckdb}")
    print(f"   Server: http://{args.host}:{args.port}/baseline")
    print(f"   Press Ctrl+C to stop")
    print()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.shutdown()

