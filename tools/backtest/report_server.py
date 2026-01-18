#!/usr/bin/env python3
"""
Unified Backtest Report Server

Serves all backtest runs (baseline, optimization, strategy) through a web interface.
Generates reports on-demand from DuckDB data.
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import unquote

import duckdb
import pandas as pd

# Add parent directory to path for imports
tools_backtest_dir = str(Path(__file__).parent)
sys.path.insert(0, tools_backtest_dir)
sys.path.insert(0, str(Path(__file__).parent.parent))

from http.server import HTTPServer, BaseHTTPRequestHandler

# Import generate_drilldown_report function
# CRITICAL FIX for multiprocessing pickle error:
# When process_single_trade is pickled for ProcessPoolExecutor, Python needs to
# be able to import the module in worker processes. Since the source file has
# hyphens in the name (generate-drilldown-report.py), we can't import it normally.
#
# Solution: Create a copy/symlink with a valid Python module name that can be
# imported normally, so pickle works correctly.

import importlib.util
import shutil
import tempfile

module_file = Path(__file__).parent / "generate-drilldown-report.py"
module_abs_path = str(module_file.resolve())

# Create a temporary directory with the module as a valid Python module name
# This allows pickle to import it in worker processes
temp_module_dir = Path(tempfile.gettempdir()) / "quantbot_backtest"
temp_module_dir.mkdir(parents=True, exist_ok=True)
temp_module_file = temp_module_dir / "generate_drilldown_report.py"

# Copy the file with a valid Python module name (no hyphens)
# Update if source file is newer
if not temp_module_file.exists() or temp_module_file.stat().st_mtime < module_file.stat().st_mtime:
    shutil.copy2(module_file, temp_module_file)
    print(f"Copied module to {temp_module_file} for multiprocessing compatibility", file=sys.stderr)

# Add temp dir to Python path so it can be imported
if str(temp_module_dir) not in sys.path:
    sys.path.insert(0, str(temp_module_dir))

# Now import normally - this works with pickle!
try:
    import generate_drilldown_report as generate_drilldown_module
    generate_drilldown_report = generate_drilldown_module.generate_drilldown_report
except ImportError as e:
    # Fallback: use importlib if normal import fails
    print(f"Warning: Could not import normally, using importlib fallback: {e}", file=sys.stderr)
    spec = importlib.util.spec_from_file_location("generate_drilldown_report", temp_module_file)
    generate_drilldown_module = importlib.util.module_from_spec(spec)
    sys.modules["generate_drilldown_report"] = generate_drilldown_module
    spec.loader.exec_module(generate_drilldown_module)
    generate_drilldown_report = generate_drilldown_module.generate_drilldown_report


class ReportHandler(BaseHTTPRequestHandler):
    """HTTP handler for report server."""
    
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
            
            if path == '/' or path == '/index.html':
                self.send_index()
            elif path.startswith('/run/'):
                run_id = path.split('/run/')[1].split('?')[0]
                run_type = self.get_query_param('type', 'baseline')
                self.send_run_report(run_id, run_type)
            elif path.startswith('/api/runs'):
                self.send_runs_api()
            elif path.startswith('/api/run/'):
                run_id = path.split('/api/run/')[1].split('?')[0]
                run_type = self.get_query_param('type', 'baseline')
                self.send_run_data_api(run_id, run_type)
            else:
                self.send_error(404, "Not found")
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            # Client disconnected - not an error, just log it
            print(f"Client disconnected: {e}", file=sys.stderr)
            return
        except Exception as e:
            print(f"Unexpected error in do_GET: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            try:
                self.send_error(500, f"Internal server error: {str(e)}")
            except:
                pass  # Connection might be broken
    
    def get_query_param(self, key: str, default: str = None) -> Optional[str]:
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
    
    def send_index(self):
        """Send index page with list of all runs."""
        runs = self.list_all_runs()
        
        html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QuantBot Backtest Reports</title>
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
            font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            padding: 2rem;
        }}
        
        .container {{
            max-width: 1400px;
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
        
        .runs-section {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
        }}
        
        .runs-header {{
            padding: 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}
        
        .runs-header h2 {{
            font-size: 1.25rem;
            font-weight: 600;
        }}
        
        .runs-table {{
            width: 100%;
            border-collapse: collapse;
        }}
        
        .runs-table th {{
            text-align: left;
            padding: 1rem 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 2px solid var(--border-color);
            color: var(--text-secondary);
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
        }}
        
        .runs-table td {{
            padding: 1rem 1.5rem;
            border-bottom: 1px solid var(--border-color);
            font-size: 0.9rem;
        }}
        
        .runs-table tr {{
            cursor: pointer;
            transition: background 0.2s;
        }}
        
        .runs-table tr:hover {{
            background: var(--bg-hover);
        }}
        
        .run-type {{
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }}
        
        .run-type.baseline {{ background: rgba(59, 130, 246, 0.2); color: var(--accent-blue); }}
        .run-type.strategy {{ background: rgba(139, 92, 246, 0.2); color: var(--accent-purple); }}
        .run-type.optimizer {{ background: rgba(16, 185, 129, 0.2); color: var(--accent-green); }}
        
        .run-name {{
            font-weight: 600;
            color: var(--accent-blue);
        }}
        
        .run-date {{
            font-family: 'JetBrains Mono', monospace;
            color: var(--text-secondary);
            font-size: 0.85rem;
        }}
        
        .view-btn {{
            background: var(--accent-blue);
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
        }}
        
        .view-btn:hover {{
            opacity: 0.8;
        }}
        
        .empty-state {{
            padding: 4rem 2rem;
            text-align: center;
            color: var(--text-secondary);
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>⚡ QuantBot Backtest Reports</h1>
            <p class="subtitle">View all backtest runs: baseline, strategy, and optimization</p>
        </header>
        
        <div class="runs-section">
            <div class="runs-header">
                <h2>All Runs ({len(runs)} total)</h2>
            </div>
            
            {self.render_runs_table(runs)}
        </div>
    </div>
    
    <script>
        function viewRun(runId, runType) {{
            window.location.href = `/run/${{runId}}?type=${{runType}}`;
        }}
    </script>
</body>
</html>'''
        
        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        self.wfile.write(html.encode())
    
    def render_runs_table(self, runs: List[Dict]) -> str:
        """Render runs table HTML."""
        if not runs:
            return '<div class="empty-state">No runs found in database</div>'
        
        rows = []
        for run in runs:
            run_type = run.get('run_type', 'baseline')
            run_name = run.get('run_name', run.get('name', run.get('run_id', 'Unknown')))
            created_at = run.get('created_at', run.get('created_at'))
            if created_at:
                if isinstance(created_at, str):
                    date_str = created_at[:10] if len(created_at) >= 10 else created_at
                else:
                    date_str = str(created_at)[:10]
            else:
                date_str = 'N/A'
            
            date_range = f"{run.get('date_from', 'N/A')} to {run.get('date_to', 'N/A')}"
            
            rows.append(f'''
                <tr onclick="viewRun('{run['run_id']}', '{run_type}')">
                    <td><span class="run-type {run_type}">{run_type}</span></td>
                    <td class="run-name">{run_name}</td>
                    <td class="run-date">{date_str}</td>
                    <td>{date_range}</td>
                    <td>{run.get('interval_seconds', 'N/A')}s</td>
                    <td>{run.get('horizon_hours', 'N/A')}h</td>
                    <td><button class="view-btn" onclick="event.stopPropagation(); viewRun('{run['run_id']}', '{run_type}')">View Report</button></td>
                </tr>
            ''')
        
        return f'''
        <table class="runs-table">
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Created</th>
                    <th>Date Range</th>
                    <th>Interval</th>
                    <th>Horizon</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                {''.join(rows)}
            </tbody>
        </table>
        '''
    
    def list_all_runs(self) -> List[Dict]:
        """List all runs from all schemas."""
        try:
            conn = duckdb.connect(self.duckdb_path, read_only=True)
        except Exception as e:
            print(f"Error connecting to DuckDB: {e}", file=sys.stderr)
            return []
        
        runs = []
        
        # Query baseline runs
        try:
            # Check if schema exists first - try to query information_schema
            try:
                schemas = [row[0] for row in conn.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'temp')").fetchall()]
            except:
                # Fallback: just try the query and catch if it fails
                schemas = ['baseline', 'bt', 'optimizer']  # Assume they exist
            
            # Query baseline runs
            if 'baseline' in schemas:
                baseline_runs = conn.execute("""
                    SELECT run_id, run_name, created_at, date_from, date_to, 
                           interval_seconds, horizon_hours, chain
                    FROM baseline.runs_d
                    ORDER BY created_at DESC
                """).fetchall()
                
                for row in baseline_runs:
                    runs.append({
                        'run_id': row[0],
                        'run_name': row[1] if row[1] else f"baseline_{row[0][:8]}",
                        'created_at': row[2],
                        'date_from': row[3],
                        'date_to': row[4],
                        'interval_seconds': row[5],
                        'horizon_hours': row[6],
                        'chain': row[7] if len(row) > 7 else 'solana',
                        'run_type': 'baseline'
                    })
                print(f"Found {len(baseline_runs)} baseline runs", file=sys.stderr)
            else:
                print("baseline schema not found", file=sys.stderr)
        except Exception as e:
            print(f"Warning: Could not query baseline runs: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
        
            # Query bt (strategy) runs
            if 'bt' in schemas:
                bt_runs = conn.execute("""
                    SELECT run_id, run_name, created_at, date_from, date_to,
                           interval_seconds, horizon_hours, chain
                    FROM bt.runs_d
                    ORDER BY created_at DESC
                """).fetchall()
                
                for row in bt_runs:
                    runs.append({
                        'run_id': row[0],
                        'run_name': row[1] if row[1] else f"strategy_{row[0][:8]}",
                        'created_at': row[2],
                        'date_from': row[3],
                        'date_to': row[4],
                        'interval_seconds': row[5],
                        'horizon_hours': row[6],
                        'chain': row[7] if len(row) > 7 else 'solana',
                        'run_type': 'strategy'
                    })
                print(f"Found {len(bt_runs)} strategy runs", file=sys.stderr)
            else:
                print("bt schema not found", file=sys.stderr)
            
            # Query optimizer runs
            if 'optimizer' in schemas:
                opt_runs = conn.execute("""
                    SELECT run_id, name, created_at, date_from, date_to,
                           interval_seconds, horizon_hours
                    FROM optimizer.runs_d
                    ORDER BY created_at DESC
                """).fetchall()
            
                for row in opt_runs:
                    runs.append({
                        'run_id': row[0],
                        'run_name': row[1] if row[1] else f"optimizer_{row[0][:8]}",
                        'created_at': row[2],
                        'date_from': row[3],
                        'date_to': row[4],
                        'interval_seconds': row[5],
                        'horizon_hours': row[6],
                        'chain': 'solana',
                        'run_type': 'optimizer'
                    })
                print(f"Found {len(opt_runs)} optimizer runs", file=sys.stderr)
            else:
                print("optimizer schema not found", file=sys.stderr)
        except Exception as e:
            print(f"Warning: Could not query runs: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
        finally:
            conn.close()
        
        print(f"Total runs found: {len(runs)}", file=sys.stderr)
        return runs
    
    def send_runs_api(self):
        """Send runs list as JSON API."""
        runs = self.list_all_runs()
        self.send_json_response(runs)
    
    def send_run_data_api(self, run_id: str, run_type: str):
        """Send run data as JSON API."""
        # Export run data to CSV first, then return metadata
        csv_path = self.export_run_to_csv(run_id, run_type)
        if csv_path:
            self.send_json_response({
                'run_id': run_id,
                'run_type': run_type,
                'csv_path': csv_path,
                'status': 'ready'
            })
        else:
            self.send_error(404, "Run not found")
    
    def export_run_to_csv(self, run_id: str, run_type: str) -> Optional[str]:
        """Export run data from DuckDB to CSV."""
        try:
            conn = duckdb.connect(self.duckdb_path, read_only=True)
        except Exception as e:
            print(f"Error connecting to DuckDB: {e}", file=sys.stderr)
            return None
        
        csv_path = os.path.abspath(f"results/tmp_{run_id}.csv")
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        
        try:
            if run_type == 'baseline':
                # Export from baseline.alert_results_f
                print(f"Exporting baseline run {run_id}...", file=sys.stderr)
                df = conn.execute("""
                    SELECT 
                        alert_id, mint, caller, alert_ts_utc, entry_ts_utc,
                        status, candles, entry_price, ath_mult, time_to_2x_s, time_to_5x_s,
                        dd_initial, dd_overall, ret_end_pct as tp_sl_ret,
                        CASE WHEN ret_end_pct > 0 THEN 'tp' ELSE 'horizon' END as tp_sl_exit_reason
                    FROM baseline.alert_results_f
                    WHERE run_id = ?
                    AND status = 'ok'
                """, [run_id]).df()
                print(f"Exported {len(df)} rows from baseline", file=sys.stderr)
            elif run_type == 'strategy':
                # Export from bt.alert_outcomes_f joined with bt.alert_scenarios_d
                print(f"Exporting strategy run {run_id}...", file=sys.stderr)
                df = conn.execute("""
                    SELECT 
                        s.scenario_id as alert_id, 
                        s.mint, 
                        COALESCE(s.caller_name, '') as caller,
                        s.alert_ts_ms / 1000.0 as alert_ts_utc,
                        o.entry_ts_ms / 1000.0 as entry_ts_utc,
                        'ok' as status, 
                        COALESCE(o.candles_seen, 0) as candles,
                        o.entry_price_usd as entry_price, 
                        o.ath_multiple as ath_mult,
                        o.time_to_2x_s, 
                        NULL as time_to_5x_s,
                        COALESCE(o.max_drawdown_pct, 0.0) / 100.0 as dd_initial,
                        COALESCE(o.max_drawdown_pct, 0.0) / 100.0 as dd_overall,
                        COALESCE(o.tp_sl_ret, 0.0) as tp_sl_ret,
                        COALESCE(o.tp_sl_exit_reason, 'horizon') as tp_sl_exit_reason
                    FROM bt.alert_scenarios_d s
                    JOIN bt.alert_outcomes_f o ON s.scenario_id = o.scenario_id
                    WHERE s.run_id = ?
                """, [run_id]).df()
                print(f"Exported {len(df)} rows from strategy", file=sys.stderr)
            else:
                print(f"Unknown run type: {run_type}", file=sys.stderr)
                conn.close()
                return None
            
            if df.empty:
                print(f"No data found for {run_type} run {run_id}", file=sys.stderr)
                conn.close()
                return None
            
            # Check what columns we actually have
            print(f"Columns in export: {list(df.columns)}", file=sys.stderr)
            
            # Add required columns for report generator
            if 'token_symbol' not in df.columns:
                if 'mint' in df.columns:
                    df['token_symbol'] = df['mint'].astype(str).str[:4].str.upper()
                else:
                    df['token_symbol'] = 'UNKN'
            if 'token_name' not in df.columns:
                df['token_name'] = 'Unknown Token'
            
            # Ensure all required numeric columns exist
            required_cols = {
                'ath_mult': 1.0,
                'tp_sl_ret': 0.0,
                'dd_initial': 0.0,
                'dd_overall': 0.0,
                'time_to_2x_s': None,
                'time_to_5x_s': None,
                'entry_price': 0.0,
                'candles': 0,
            }
            for col, default in required_cols.items():
                if col not in df.columns:
                    df[col] = default
            
            # Ensure exit_reason column exists
            if 'tp_sl_exit_reason' not in df.columns:
                if 'exit_reason' in df.columns:
                    df['tp_sl_exit_reason'] = df['exit_reason']
                else:
                    df['tp_sl_exit_reason'] = 'horizon'
            
            # Ensure alert_ts_utc is in the right format
            if 'alert_ts_utc' in df.columns:
                # Convert timestamp to string if needed
                df['alert_ts_utc'] = pd.to_datetime(df['alert_ts_utc']).dt.strftime('%Y-%m-%d %H:%M:%S')
            
            # Save to CSV
            df.to_csv(csv_path, index=False)
            print(f"Saved CSV to {csv_path} with {len(df)} rows", file=sys.stderr)
            conn.close()
            return csv_path
        except Exception as e:
            print(f"Error exporting run: {e}", file=sys.stderr)
            conn.close()
            return None
    
    def send_run_report(self, run_id: str, run_type: str):
        """Generate and send report for a specific run."""
        # Export to CSV first
        csv_path = self.export_run_to_csv(run_id, run_type)
        if not csv_path:
            self.send_error(404, f"Run {run_id} not found or export failed")
            return
        
        if not os.path.exists(csv_path):
            self.send_error(404, f"CSV file was not created: {csv_path}")
            return
        
        csv_size = os.path.getsize(csv_path)
        print(f"CSV exported: {csv_path} ({csv_size} bytes)", file=sys.stderr)
        
        if csv_size == 0:
            self.send_error(500, f"CSV file is empty: {csv_path}")
            return
        
        # Generate report
        try:
            # Get run config from DuckDB to extract TP/SL params
            conn = duckdb.connect(self.duckdb_path, read_only=True)
            config = {}
            
            if run_type == 'baseline':
                row = conn.execute("""
                    SELECT config_json FROM baseline.runs_d WHERE run_id = ?
                """, [run_id]).fetchone()
            elif run_type == 'strategy':
                # Try config_json first, then fallback to strategy fields
                row = conn.execute("""
                    SELECT config_json, strategy_name FROM bt.runs_d WHERE run_id = ?
                """, [run_id]).fetchone()
                if row and row[0]:
                    config = json.loads(row[0])
                elif row and row[1]:
                    # Extract from strategy_name or use defaults
                    config = {}
            elif run_type == 'optimizer':
                row = conn.execute("""
                    SELECT config_json FROM optimizer.runs_d WHERE run_id = ?
                """, [run_id]).fetchone()
            
            if not config and row and row[0]:
                try:
                    config = json.loads(row[0]) if isinstance(row[0], str) else row[0]
                except:
                    config = {}
            conn.close()
            
            tp_mult = config.get('tp_mult', config.get('first_tp_mult', 80.0))
            sl_mult = config.get('sl_mult', 0.7)
            risk_per_trade = config.get('risk_per_trade', 0.02)
            
            # Generate HTML report - use absolute paths
            html_path = os.path.abspath(f"results/tmp_{run_id}_report.html")
            csv_path_abs = os.path.abspath(csv_path)
            
            print(f"Generating report from CSV: {csv_path_abs}", file=sys.stderr)
            print(f"Output HTML path: {html_path}", file=sys.stderr)
            
            # Ensure results directory exists
            os.makedirs(os.path.dirname(html_path), exist_ok=True)
            
            try:
                generate_drilldown_report(
                    csv_path=csv_path_abs,
                    output_path=html_path,
                    max_trades_per_caller=None,  # No limit - process all trades
                    risk_per_trade=risk_per_trade,
                    default_tp_mult=tp_mult,
                    default_sl_mult=sl_mult,
                    max_workers=None
                )
            except Exception as gen_error:
                print(f"Error in generate_drilldown_report: {gen_error}", file=sys.stderr)
                import traceback
                traceback.print_exc()
                raise
            
            # Verify file was created
            if not os.path.exists(html_path):
                raise FileNotFoundError(f"Report file was not created at: {html_path}")
            
            file_size = os.path.getsize(html_path)
            print(f"Report file created: {html_path} ({file_size} bytes)", file=sys.stderr)
            
            if file_size == 0:
                raise ValueError(f"Report file is empty: {html_path}")
            
            # Read and send HTML
            with open(html_path, 'r', encoding='utf-8') as f:
                html = f.read()
            
            if not html or len(html.strip()) == 0:
                raise ValueError(f"Report HTML is empty after reading from {html_path}")
            
            # Validate HTML structure - should contain JavaScript data
            if 'tradeData' not in html or 'callerStats' not in html:
                print(f"WARNING: HTML file may be missing JavaScript data. File size: {len(html)} bytes", file=sys.stderr)
                # Check first 1000 chars
                print(f"First 500 chars: {html[:500]}", file=sys.stderr)
                # Don't fail - might still be valid, just warn
            
            print(f"Read {len(html)} bytes of HTML from {html_path}", file=sys.stderr)
            
            # Check if connection is still alive before sending
            try:
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.send_header('Content-Length', str(len(html.encode())))
                self.end_headers()
                
                # Write in chunks to avoid overwhelming the connection
                html_bytes = html.encode()
                chunk_size = 1024 * 1024  # 1MB chunks
                for i in range(0, len(html_bytes), chunk_size):
                    chunk = html_bytes[i:i + chunk_size]
                    try:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        # Client disconnected - not an error, just stop sending
                        print(f"Client disconnected while sending report for {run_id}", file=sys.stderr)
                        return
            except (BrokenPipeError, ConnectionResetError, OSError) as e:
                # Client disconnected - not an error, just log and return
                print(f"Client disconnected before/during report send for {run_id}: {e}", file=sys.stderr)
                return
            
            # DON'T clean up files immediately - keep them for debugging
            # Clean up temp files only after successful send
            # (They'll be cleaned up on next request or by a cleanup job)
            print(f"Report sent successfully. Files kept for debugging: {csv_path}, {html_path}", file=sys.stderr)
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            # Client disconnected - not a real error, just log it
            print(f"Client disconnected during report generation for {run_id}: {e}", file=sys.stderr)
            return
        except Exception as e:
            print(f"Error generating report: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            try:
                # Only send error if connection is still alive
                self.send_error(500, f"Error generating report: {str(e)}")
            except (BrokenPipeError, ConnectionResetError, OSError):
                # Client already disconnected, can't send error
                print(f"Client disconnected before error response could be sent", file=sys.stderr)
                return
    
    def send_json_response(self, data):
        """Send JSON response."""
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


def create_handler(duckdb_path: str, slices_dir: str):
    """Create handler with closure over duckdb_path."""
    def handler(*args, **kwargs):
        return ReportHandler(duckdb_path, slices_dir, *args, **kwargs)
    return handler


def main():
    parser = argparse.ArgumentParser(description='Unified Backtest Report Server')
    parser.add_argument('--duckdb', default=os.getenv('DUCKDB_PATH', 'data/alerts.duckdb'),
                        help='Path to DuckDB file (default: data/alerts.duckdb)')
    parser.add_argument('--slices-dir', default='slices/per_token',
                        help='Directory for OHLCV slice files (default: slices/per_token)')
    parser.add_argument('--port', type=int, default=8080,
                        help='Port to serve on (default: 8080)')
    parser.add_argument('--host', default='0.0.0.0',
                        help='Host to bind to (default: 0.0.0.0)')
    args = parser.parse_args()
    
    if not os.path.exists(args.duckdb):
        print(f"Error: DuckDB file not found: {args.duckdb}", file=sys.stderr)
        sys.exit(1)
    
    handler = create_handler(args.duckdb, args.slices_dir)
    server = HTTPServer((args.host, args.port), handler)
    
    print(f"⚡ QuantBot Report Server starting...")
    print(f"   DuckDB: {args.duckdb}")
    print(f"   Slices: {args.slices_dir}")
    print(f"   Server: http://{args.host}:{args.port}")
    print(f"   Press Ctrl+C to stop")
    print()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        server.shutdown()


if __name__ == '__main__':
    main()

