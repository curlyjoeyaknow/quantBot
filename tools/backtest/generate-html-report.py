#!/usr/bin/env python3
"""
Generate interactive HTML backtest report with charts, histograms, and sparklines.
"""

import pandas as pd
import json
from datetime import datetime
import sys

def generate_html_report(csv_path: str, output_path: str = None):
    """Generate comprehensive HTML report from backtest results."""
    
    df = pd.read_csv(csv_path)
    valid = df[df['status'] == 'ok'].copy()
    
    # Track duplicates for reporting
    total_rows = len(valid)
    unique_mints = valid['mint'].nunique()
    
    # Deduplicate by mint (keep first caller's entry)
    valid = valid.drop_duplicates(subset='mint', keep='first')
    
    # Filter out suspicious outliers (ATH > 1000x is likely bad data)
    outliers = valid[valid['ath_mult'] > 1000]
    valid = valid[valid['ath_mult'] <= 1000]
    
    if output_path is None:
        output_path = csv_path.replace('.csv', '_report.html')
    
    # Prepare data for charts
    valid['alert_date'] = pd.to_datetime(valid['alert_ts_utc']).dt.date
    
    # Daily stats for equity curve - simple daily returns (not cumulative)
    daily = valid.groupby('alert_date').agg({
        'tp_sl_ret': 'mean',
        'ath_mult': 'mean',
        'alert_id': 'count'
    }).reset_index()
    daily['daily_ret_pct'] = daily['tp_sl_ret'] * 100  # Convert to percentage
    daily['alert_date'] = daily['alert_date'].astype(str)
    
    # Caller stats
    caller_stats = valid.groupby('caller').agg({
        'alert_id': 'count',
        'ath_mult': ['mean', 'median', 'max'],
        'tp_sl_ret': 'mean',
        'time_to_2x_s': lambda x: x.notna().sum(),
        'time_to_3x_s': lambda x: x.notna().sum(),
        'time_to_5x_s': lambda x: x.notna().sum(),
        'time_to_10x_s': lambda x: x.notna().sum(),
    }).round(3)
    caller_stats.columns = ['calls', 'avg_ath', 'median_ath', 'max_ath', 'avg_ret', 'hit_2x', 'hit_3x', 'hit_5x', 'hit_10x']
    caller_stats['strike_2x'] = (caller_stats['hit_2x'] / caller_stats['calls'] * 100).round(1)
    caller_stats['strike_3x'] = (caller_stats['hit_3x'] / caller_stats['calls'] * 100).round(1)
    caller_stats['strike_5x'] = (caller_stats['hit_5x'] / caller_stats['calls'] * 100).round(1)
    caller_stats['strike_10x'] = (caller_stats['hit_10x'] / caller_stats['calls'] * 100).round(1)
    caller_stats = caller_stats.sort_values('calls', ascending=False).head(25)
    
    # ATH histogram data
    ath_bins = [0, 1, 1.5, 2, 3, 4, 5, 10, 20, 50, 100, float('inf')]
    ath_labels = ['<1x', '1-1.5x', '1.5-2x', '2-3x', '3-4x', '4-5x', '5-10x', '10-20x', '20-50x', '50-100x', '>100x']
    valid['ath_bucket'] = pd.cut(valid['ath_mult'], bins=ath_bins, labels=ath_labels)
    ath_dist = valid['ath_bucket'].value_counts().reindex(ath_labels).fillna(0).astype(int).to_dict()
    
    # Time to 2x histogram
    time_bins = [0, 60, 300, 600, 1800, 3600, 7200, 14400, float('inf')]
    time_labels = ['<1m', '1-5m', '5-10m', '10-30m', '30m-1h', '1-2h', '2-4h', '>4h']
    valid.loc[valid['time_to_2x_s'].notna(), 'time_2x_bucket'] = pd.cut(
        valid.loc[valid['time_to_2x_s'].notna(), 'time_to_2x_s'], 
        bins=time_bins, labels=time_labels
    )
    time_dist = valid['time_2x_bucket'].value_counts().reindex(time_labels).fillna(0).astype(int).to_dict()
    
    # Drawdown histogram
    dd_bins = [-1, -0.8, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0]
    dd_labels = ['-100 to -80%', '-80 to -60%', '-60 to -50%', '-50 to -40%', '-40 to -30%', '-30 to -20%', '-20 to -10%', '-10 to 0%']
    valid['dd_bucket'] = pd.cut(valid['dd_overall'], bins=dd_bins, labels=dd_labels)
    dd_dist = valid['dd_bucket'].value_counts().reindex(dd_labels).fillna(0).astype(int).to_dict()
    
    # Exit reason pie
    exit_dist = valid['tp_sl_exit_reason'].value_counts().to_dict()
    
    # Caller sparkline data (daily performance per caller)
    top_callers = caller_stats.index[:10].tolist()
    caller_sparklines = {}
    for caller in top_callers:
        caller_data = valid[valid['caller'] == caller].copy()
        caller_data['date'] = pd.to_datetime(caller_data['alert_ts_utc']).dt.date
        daily_ret = caller_data.groupby('date')['tp_sl_ret'].mean().reset_index()
        daily_ret['cumret'] = (1 + daily_ret['tp_sl_ret']).cumprod()
        caller_sparklines[caller] = daily_ret['cumret'].tolist()[-30:]  # Last 30 days
    
    # Summary stats
    stats = {
        'total_alerts': total_rows,
        'unique_mints': unique_mints,
        'valid_alerts': len(valid),
        'outliers_removed': len(outliers),
        'date_range': f"{valid['alert_ts_utc'].min()[:10]} to {valid['alert_ts_utc'].max()[:10]}",
        'avg_ath': round(valid['ath_mult'].mean(), 2),
        'median_ath': round(valid['ath_mult'].median(), 2),
        'max_ath': round(valid['ath_mult'].max(), 2),
        'strike_2x': round(100 * valid['time_to_2x_s'].notna().mean(), 1),
        'strike_3x': round(100 * valid['time_to_3x_s'].notna().mean(), 1),
        'strike_5x': round(100 * valid['time_to_5x_s'].notna().mean(), 1),
        'strike_10x': round(100 * valid['time_to_10x_s'].notna().mean(), 1),
        'avg_return': round(100 * valid['tp_sl_ret'].mean(), 1),
        'avg_dd': round(100 * valid['dd_overall'].mean(), 1),
        'unique_callers': valid['caller'].nunique(),
    }
    
    # Generate HTML
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QuantBot Backtest Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0"></script>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg-primary: #0a0e17;
            --bg-secondary: #111827;
            --bg-card: #1a2234;
            --bg-hover: #243044;
            --accent-green: #10b981;
            --accent-green-dim: rgba(16, 185, 129, 0.2);
            --accent-red: #ef4444;
            --accent-red-dim: rgba(239, 68, 68, 0.2);
            --accent-blue: #3b82f6;
            --accent-purple: #8b5cf6;
            --accent-amber: #f59e0b;
            --accent-cyan: #06b6d4;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --border-color: #2d3748;
            --glow-green: 0 0 20px rgba(16, 185, 129, 0.3);
            --glow-blue: 0 0 20px rgba(59, 130, 246, 0.3);
        }}
        
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        
        body {{
            font-family: 'Space Grotesk', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            line-height: 1.6;
        }}
        
        .container {{
            max-width: 1600px;
            margin: 0 auto;
            padding: 2rem;
        }}
        
        header {{
            text-align: center;
            margin-bottom: 3rem;
            padding: 2rem;
            background: linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-card) 100%);
            border-radius: 16px;
            border: 1px solid var(--border-color);
        }}
        
        h1 {{
            font-size: 2.5rem;
            font-weight: 700;
            background: linear-gradient(90deg, var(--accent-green), var(--accent-cyan));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }}
        
        .subtitle {{
            color: var(--text-secondary);
            font-size: 1rem;
        }}
        
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}
        
        .stat-card {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
            transition: all 0.3s ease;
        }}
        
        .stat-card:hover {{
            transform: translateY(-2px);
            box-shadow: var(--glow-blue);
            border-color: var(--accent-blue);
        }}
        
        .stat-value {{
            font-family: 'JetBrains Mono', monospace;
            font-size: 2rem;
            font-weight: 700;
            color: var(--accent-green);
        }}
        
        .stat-value.negative {{
            color: var(--accent-red);
        }}
        
        .stat-label {{
            color: var(--text-secondary);
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 0.25rem;
        }}
        
        .charts-grid {{
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1.5rem;
            margin-bottom: 2rem;
        }}
        
        @media (max-width: 1200px) {{
            .charts-grid {{ grid-template-columns: 1fr; }}
        }}
        
        .chart-card {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.5rem;
        }}
        
        .chart-card.full-width {{
            grid-column: 1 / -1;
        }}
        
        .chart-title {{
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        
        .chart-title::before {{
            content: '';
            width: 4px;
            height: 20px;
            background: var(--accent-blue);
            border-radius: 2px;
        }}
        
        .chart-container {{
            position: relative;
            height: 300px;
        }}
        
        .chart-container.small {{
            height: 200px;
        }}
        
        .table-container {{
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            overflow: hidden;
            margin-bottom: 2rem;
        }}
        
        .table-header {{
            padding: 1rem 1.5rem;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
        }}
        
        .table-header h2 {{
            font-size: 1.1rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        
        .table-header h2::before {{
            content: '';
            width: 4px;
            height: 20px;
            background: var(--accent-purple);
            border-radius: 2px;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        
        th, td {{
            padding: 0.75rem 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }}
        
        th {{
            background: var(--bg-secondary);
            color: var(--text-secondary);
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }}
        
        tr:hover {{
            background: var(--bg-hover);
        }}
        
        td {{
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.85rem;
        }}
        
        .caller-name {{
            font-family: 'Space Grotesk', sans-serif;
            font-weight: 500;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }}
        
        .strike-bar {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}
        
        .strike-fill {{
            height: 8px;
            border-radius: 4px;
            background: linear-gradient(90deg, var(--accent-green), var(--accent-cyan));
            transition: width 0.3s ease;
        }}
        
        .sparkline {{
            width: 100px;
            height: 30px;
        }}
        
        .positive {{ color: var(--accent-green); }}
        .negative {{ color: var(--accent-red); }}
        
        .badge {{
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
        }}
        
        .badge-success {{
            background: var(--accent-green-dim);
            color: var(--accent-green);
        }}
        
        .badge-warning {{
            background: rgba(245, 158, 11, 0.2);
            color: var(--accent-amber);
        }}
        
        .badge-danger {{
            background: var(--accent-red-dim);
            color: var(--accent-red);
        }}
        
        footer {{
            text-align: center;
            padding: 2rem;
            color: var(--text-muted);
            font-size: 0.85rem;
        }}
        
        .legend {{
            display: flex;
            justify-content: center;
            flex-wrap: wrap;
            gap: 1rem;
            margin-top: 1rem;
        }}
        
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-secondary);
        }}
        
        .legend-color {{
            width: 12px;
            height: 12px;
            border-radius: 3px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>⚡ QuantBot Backtest Report</h1>
            <p class="subtitle">Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} | {stats['date_range']}</p>
        </header>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">{stats['valid_alerts']:,}</div>
                <div class="stat-label">Unique Tokens</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{stats['unique_callers']}</div>
                <div class="stat-label">Unique Callers</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{stats['median_ath']}x</div>
                <div class="stat-label">Median ATH</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{stats['avg_ath']}x</div>
                <div class="stat-label">Avg ATH</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{stats['strike_2x']}%</div>
                <div class="stat-label">2x Strike Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{stats['strike_5x']}%</div>
                <div class="stat-label">5x Strike Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{stats['strike_10x']}%</div>
                <div class="stat-label">10x Strike Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value negative">{stats['avg_dd']}%</div>
                <div class="stat-label">Avg Drawdown</div>
            </div>
        </div>
        <p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; margin-bottom: 1.5rem;">
            {stats['total_alerts']:,} total alerts → {stats['unique_mints']:,} unique tokens → {stats['outliers_removed']} outliers (>1000x) removed
        </p>
        
        <div class="charts-grid">
            <div class="chart-card full-width">
                <div class="chart-title">Daily Average Returns</div>
                <div class="chart-container">
                    <canvas id="equityChart"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-title">ATH Multiple Distribution</div>
                <div class="chart-container">
                    <canvas id="athHistogram"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-title">Time to 2x Distribution</div>
                <div class="chart-container">
                    <canvas id="time2xHistogram"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-title">Strike Rates by Multiple</div>
                <div class="chart-container">
                    <canvas id="strikeChart"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-title">Exit Reasons</div>
                <div class="chart-container">
                    <canvas id="exitPie"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-title">Drawdown Distribution</div>
                <div class="chart-container">
                    <canvas id="ddHistogram"></canvas>
                </div>
            </div>
            
            <div class="chart-card">
                <div class="chart-title">Daily Alert Volume</div>
                <div class="chart-container">
                    <canvas id="volumeChart"></canvas>
                </div>
            </div>
        </div>
        
        <div class="table-container">
            <div class="table-header">
                <h2>Top Callers Performance</h2>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Caller</th>
                        <th>Calls</th>
                        <th>Avg ATH</th>
                        <th>Med ATH</th>
                        <th>Max ATH</th>
                        <th>2x Rate</th>
                        <th>5x Rate</th>
                        <th>10x Rate</th>
                        <th>Avg Return</th>
                        <th>Trend</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join([f"""
                    <tr>
                        <td class="caller-name">{caller}</td>
                        <td>{int(row['calls'])}</td>
                        <td>{row['avg_ath']:.2f}x</td>
                        <td>{row['median_ath']:.2f}x</td>
                        <td>{row['max_ath']:.2f}x</td>
                        <td>
                            <div class="strike-bar">
                                <div class="strike-fill" style="width: {min(row['strike_2x'], 100)}px"></div>
                                <span>{row['strike_2x']}%</span>
                            </div>
                        </td>
                        <td class="{'positive' if row['strike_5x'] > 20 else ''}">{row['strike_5x']}%</td>
                        <td class="{'positive' if row['strike_10x'] > 10 else ''}">{row['strike_10x']}%</td>
                        <td class="{'positive' if row['avg_ret'] > 0 else 'negative'}">{100*row['avg_ret']:.1f}%</td>
                        <td><canvas class="sparkline" id="spark-{i}"></canvas></td>
                    </tr>
                    """ for i, (caller, row) in enumerate(caller_stats.iterrows())])}
                </tbody>
            </table>
        </div>
        
        <footer>
            <p>QuantBot Backtest Report • {len(valid)} alerts analyzed • {stats['unique_callers']} callers tracked</p>
        </footer>
    </div>
    
    <script>
        // Chart.js defaults
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.borderColor = '#2d3748';
        Chart.defaults.font.family = "'JetBrains Mono', monospace";
        
        // Daily Returns (baseline, not cumulative)
        new Chart(document.getElementById('equityChart'), {{
            type: 'bar',
            data: {{
                labels: {json.dumps(daily['alert_date'].tolist())},
                datasets: [{{
                    label: 'Daily Avg Return',
                    data: {json.dumps([round(x, 1) for x in daily['daily_ret_pct'].tolist()])},
                    backgroundColor: {json.dumps(daily['daily_ret_pct'].apply(lambda x: 'rgba(16, 185, 129, 0.7)' if x >= 0 else 'rgba(239, 68, 68, 0.7)').tolist())},
                    borderRadius: 2,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    legend: {{ display: false }},
                    tooltip: {{
                        callbacks: {{
                            label: (ctx) => `${{ctx.parsed.y.toFixed(1)}}%`
                        }}
                    }}
                }},
                scales: {{
                    x: {{
                        grid: {{ display: false }},
                        ticks: {{ maxTicksLimit: 12 }}
                    }},
                    y: {{
                        grid: {{ color: '#2d3748' }},
                        ticks: {{
                            callback: (v) => v + '%'
                        }}
                    }}
                }}
            }}
        }});
        
        // ATH Histogram
        new Chart(document.getElementById('athHistogram'), {{
            type: 'bar',
            data: {{
                labels: {json.dumps(list(ath_dist.keys()))},
                datasets: [{{
                    data: {json.dumps(list(ath_dist.values()))},
                    backgroundColor: [
                        '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
                        '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#a855f7'
                    ],
                    borderRadius: 4,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{ legend: {{ display: false }} }},
                scales: {{
                    x: {{ grid: {{ display: false }} }},
                    y: {{ grid: {{ color: '#2d3748' }} }}
                }}
            }}
        }});
        
        // Time to 2x Histogram
        new Chart(document.getElementById('time2xHistogram'), {{
            type: 'bar',
            data: {{
                labels: {json.dumps(list(time_dist.keys()))},
                datasets: [{{
                    data: {json.dumps(list(time_dist.values()))},
                    backgroundColor: '#3b82f6',
                    borderRadius: 4,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{ legend: {{ display: false }} }},
                scales: {{
                    x: {{ grid: {{ display: false }} }},
                    y: {{ grid: {{ color: '#2d3748' }} }}
                }}
            }}
        }});
        
        // Strike Rates
        new Chart(document.getElementById('strikeChart'), {{
            type: 'bar',
            data: {{
                labels: ['2x', '3x', '4x', '5x', '10x'],
                datasets: [{{
                    data: [{stats['strike_2x']}, {round(100 * valid['time_to_3x_s'].notna().mean(), 1)}, {round(100 * valid['time_to_4x_s'].notna().mean(), 1)}, {stats['strike_5x']}, {stats['strike_10x']}],
                    backgroundColor: ['#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6'],
                    borderRadius: 4,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{ legend: {{ display: false }} }},
                scales: {{
                    x: {{ grid: {{ display: false }} }},
                    y: {{
                        grid: {{ color: '#2d3748' }},
                        max: 100,
                        ticks: {{ callback: (v) => v + '%' }}
                    }}
                }}
            }}
        }});
        
        // Exit Pie
        new Chart(document.getElementById('exitPie'), {{
            type: 'doughnut',
            data: {{
                labels: {json.dumps(list(exit_dist.keys()))},
                datasets: [{{
                    data: {json.dumps(list(exit_dist.values()))},
                    backgroundColor: ['#ef4444', '#10b981', '#3b82f6', '#f59e0b'],
                    borderWidth: 0,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{
                    legend: {{
                        position: 'right',
                        labels: {{ padding: 15 }}
                    }}
                }}
            }}
        }});
        
        // Drawdown Histogram
        new Chart(document.getElementById('ddHistogram'), {{
            type: 'bar',
            data: {{
                labels: {json.dumps(list(dd_dist.keys()))},
                datasets: [{{
                    data: {json.dumps(list(dd_dist.values()))},
                    backgroundColor: '#ef4444',
                    borderRadius: 4,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{ legend: {{ display: false }} }},
                scales: {{
                    x: {{ grid: {{ display: false }}, ticks: {{ maxRotation: 45 }} }},
                    y: {{ grid: {{ color: '#2d3748' }} }}
                }}
            }}
        }});
        
        // Volume Chart
        new Chart(document.getElementById('volumeChart'), {{
            type: 'bar',
            data: {{
                labels: {json.dumps(daily['alert_date'].tolist())},
                datasets: [{{
                    data: {json.dumps(daily['alert_id'].tolist())},
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderRadius: 2,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {{ legend: {{ display: false }} }},
                scales: {{
                    x: {{ grid: {{ display: false }}, ticks: {{ maxTicksLimit: 10 }} }},
                    y: {{ grid: {{ color: '#2d3748' }} }}
                }}
            }}
        }});
        
        // Sparklines for callers
        const sparklineData = {json.dumps(caller_sparklines)};
        Object.entries(sparklineData).forEach(([caller, data], i) => {{
            const canvas = document.getElementById(`spark-${{i}}`);
            if (canvas && data.length > 0) {{
                new Chart(canvas, {{
                    type: 'line',
                    data: {{
                        labels: data.map((_, i) => i),
                        datasets: [{{
                            data: data,
                            borderColor: data[data.length-1] >= 1 ? '#10b981' : '#ef4444',
                            borderWidth: 1.5,
                            pointRadius: 0,
                            tension: 0.3,
                            fill: false,
                        }}]
                    }},
                    options: {{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {{ legend: {{ display: false }}, tooltip: {{ enabled: false }} }},
                        scales: {{
                            x: {{ display: false }},
                            y: {{ display: false }}
                        }}
                    }}
                }});
            }}
        }});
    </script>
</body>
</html>
'''
    
    with open(output_path, 'w') as f:
        f.write(html)
    
    print(f"Report generated: {output_path}")
    return output_path

if __name__ == '__main__':
    csv_path = sys.argv[1] if len(sys.argv) > 1 else 'results/strategy_results.csv'
    output = sys.argv[2] if len(sys.argv) > 2 else None
    generate_html_report(csv_path, output)

