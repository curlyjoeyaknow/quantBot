#!/usr/bin/env python3
"""
Visualize continuous event window coverage data in an interactive web page.

Reads JSON output from check_continuous_event_windows.py and creates an HTML
dashboard with progress bars, sortable tables, and aggregate statistics.

Usage:
    python tools/storage/visualize_event_windows.py results.json output.html
"""

import json
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Any, Tuple
from collections import defaultdict


TIME_WINDOWS = [12, 24, 36, 48, 72, 96]


def get_week_start(date: datetime) -> datetime:
    """Get the Monday of the week containing the date."""
    days_since_monday = date.weekday()
    monday = date - timedelta(days=days_since_monday)
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def get_month_start(date: datetime) -> datetime:
    """Get the first day of the month."""
    return date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def load_data(json_path: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Load JSON data from file.
    
    Returns:
        Tuple of (tokens_data, alerts_data)
        - tokens_data: Dictionary mapping token keys to token stats
        - alerts_data: List of per-alert coverage results (may be empty for old format)
    """
    with open(json_path, 'r') as f:
        data = json.load(f)
    # Handle both old format (flat dict) and new format (with metadata/tokens/alerts)
    if 'tokens' in data:
        tokens_data = data['tokens']
        alerts_data = data.get('alerts', [])
        return tokens_data, alerts_data
    # Old format - no per-alert data
    return data, []


def calculate_aggregates(data: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate aggregate statistics."""
    aggregates = {
        'overall': {},
        'by_chain': defaultdict(lambda: {'total_alerts': 0, 'coverage_sum': defaultdict(float), 'count': defaultdict(int)})
    }
    
    total_alerts = 0
    coverage_sums = defaultdict(float)
    coverage_counts = defaultdict(int)
    
    for token_key, token_data in data.items():
        total_alerts += token_data['total_alerts']
        chain = token_data.get('chain', 'unknown')
        
        aggregates['by_chain'][chain]['total_alerts'] += token_data['total_alerts']
        
        for window in TIME_WINDOWS:
            window_key = f'{window}hr'
            if window_key in token_data['windows']:
                coverage_pct = token_data['windows'][window_key]['coverage_pct']
                alerts_for_token = token_data['total_alerts']
                
                # Weighted average by alert count
                coverage_sums[window_key] += coverage_pct * alerts_for_token
                coverage_counts[window_key] += alerts_for_token
                
                aggregates['by_chain'][chain]['coverage_sum'][window_key] += coverage_pct * alerts_for_token
                aggregates['by_chain'][chain]['count'][window_key] += alerts_for_token
    
    # Calculate weighted averages
    for window in TIME_WINDOWS:
        window_key = f'{window}hr'
        if coverage_counts[window_key] > 0:
            aggregates['overall'][window_key] = coverage_sums[window_key] / coverage_counts[window_key]
        else:
            aggregates['overall'][window_key] = 0.0
    
    # Calculate per-chain averages
    for chain in aggregates['by_chain']:
        for window_key in aggregates['by_chain'][chain]['coverage_sum']:
            count = aggregates['by_chain'][chain]['count'][window_key]
            if count > 0:
                aggregates['by_chain'][chain][window_key] = (
                    aggregates['by_chain'][chain]['coverage_sum'][window_key] / count
                )
            else:
                aggregates['by_chain'][chain][window_key] = 0.0
    
    aggregates['total_alerts'] = total_alerts
    aggregates['total_tokens'] = len(data)
    
    return aggregates


def calculate_period_aggregates(alerts_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate weekly and monthly aggregates from per-alert data.
    
    Args:
        alerts_data: List of per-alert coverage results with alert_ts_ms and windows
        
    Returns:
        Dictionary with 'weekly' and 'monthly' keys, each containing period-keyed coverage stats
    """
    weekly_stats: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {'coverage_sum': 0.0, 'count': 0})
    )
    monthly_stats: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {'coverage_sum': 0.0, 'count': 0})
    )
    
    for alert in alerts_data:
        alert_ts_ms = alert['alert_ts_ms']
        alert_dt = datetime.fromtimestamp(alert_ts_ms / 1000, tz=None)
        
        # Calculate week start (Monday)
        week_start = get_week_start(alert_dt)
        week_key = week_start.strftime('%Y-%m-%d')
        
        # Calculate month start
        month_start = get_month_start(alert_dt)
        month_key = month_start.strftime('%Y-%m')
        
        # Process each window
        for window_hours in TIME_WINDOWS:
            window_key = f'{window_hours}hr'
            if window_key in alert['windows']:
                has_coverage = alert['windows'][window_key].get('has_coverage', False)
                coverage_value = 100.0 if has_coverage else 0.0
                
                weekly_stats[week_key][window_key]['coverage_sum'] += coverage_value
                weekly_stats[week_key][window_key]['count'] += 1
                
                monthly_stats[month_key][window_key]['coverage_sum'] += coverage_value
                monthly_stats[month_key][window_key]['count'] += 1
    
    # Calculate averages
    weekly_averages = {}
    for week_key, windows in weekly_stats.items():
        weekly_averages[week_key] = {}
        for window_key, stats in windows.items():
            if stats['count'] > 0:
                weekly_averages[week_key][window_key] = stats['coverage_sum'] / stats['count']
            else:
                weekly_averages[week_key][window_key] = 0.0
    
    monthly_averages = {}
    for month_key, windows in monthly_stats.items():
        monthly_averages[month_key] = {}
        for window_key, stats in windows.items():
            if stats['count'] > 0:
                monthly_averages[month_key][window_key] = stats['coverage_sum'] / stats['count']
            else:
                monthly_averages[month_key][window_key] = 0.0
    
    return {
        'weekly': weekly_averages,
        'monthly': monthly_averages
    }


def generate_html(tokens_data: Dict[str, Any], alerts_data: List[Dict[str, Any]], output_path: str):
    """Generate HTML dashboard."""
    aggregates = calculate_aggregates(tokens_data)
    period_aggregates = calculate_period_aggregates(alerts_data) if alerts_data else {'weekly': {}, 'monthly': {}}
    
    # Convert data to list for JavaScript
    tokens_list = []
    for token_key, token_data in tokens_data.items():
        tokens_list.append({
            'key': token_key,
            'mint': token_data['mint'],
            'chain': token_data.get('chain', 'unknown'),
            'total_alerts': token_data['total_alerts'],
            'windows': token_data['windows']
        })
    
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Event Window Coverage Dashboard</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #0a0a0a;
            color: #e0e0e0;
            padding: 20px;
            line-height: 1.6;
        }}
        
        .container {{
            max-width: 1400px;
            margin: 0 auto;
        }}
        
        h1 {{
            color: #fff;
            margin-bottom: 10px;
            font-size: 32px;
        }}
        
        .subtitle {{
            color: #888;
            margin-bottom: 30px;
            font-size: 14px;
        }}
        
        .section {{
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }}
        
        .section h2 {{
            color: #fff;
            margin-bottom: 20px;
            font-size: 20px;
            border-bottom: 1px solid #333;
            padding-bottom: 10px;
        }}
        
        .progress-container {{
            margin-bottom: 25px;
        }}
        
        .progress-label {{
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 14px;
            color: #ccc;
        }}
        
        .progress-bar {{
            width: 100%;
            height: 30px;
            background: #2a2a2a;
            border-radius: 4px;
            overflow: hidden;
            position: relative;
        }}
        
        .progress-bar-large {{
            height: 40px;
        }}
        
        .progress-fill {{
            height: 100%;
            background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #000;
            font-weight: bold;
            font-size: 14px;
        }}
        
        .progress-fill.excellent {{
            background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
        }}
        
        .progress-fill.good {{
            background: linear-gradient(90deg, #8BC34A 0%, #CDDC39 100%);
        }}
        
        .progress-fill.fair {{
            background: linear-gradient(90deg, #FFC107 0%, #FF9800 100%);
        }}
        
        .progress-fill.poor {{
            background: linear-gradient(90deg, #FF5722 0%, #F44336 100%);
        }}
        
        .controls {{
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }}
        
        .controls input, .controls select {{
            padding: 10px 15px;
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 6px;
            color: #e0e0e0;
            font-size: 14px;
        }}
        
        .controls input {{
            flex: 1;
            min-width: 200px;
        }}
        
        .controls select {{
            min-width: 150px;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }}
        
        th {{
            background: #2a2a2a;
            color: #fff;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid #444;
            cursor: pointer;
            user-select: none;
        }}
        
        th:hover {{
            background: #333;
        }}
        
        th.sorted-asc::after {{
            content: ' ▲';
            font-size: 10px;
        }}
        
        th.sorted-desc::after {{
            content: ' ▼';
            font-size: 10px;
        }}
        
        td {{
            padding: 12px;
            border-bottom: 1px solid #333;
        }}
        
        tr:hover {{
            background: #252525;
        }}
        
        .token-mint {{
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #4CAF50;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
        }}
        
        .chain-badge {{
            display: inline-block;
            padding: 4px 8px;
            background: #333;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
        }}
        
        .mini-progress {{
            width: 100%;
            height: 20px;
            background: #2a2a2a;
            border-radius: 3px;
            overflow: hidden;
            position: relative;
        }}
        
        .mini-progress-fill {{
            height: 100%;
            background: linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%);
            transition: width 0.3s ease;
        }}
        
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}
        
        .stat-card {{
            background: #252525;
            padding: 15px;
            border-radius: 6px;
            border: 1px solid #333;
        }}
        
        .stat-label {{
            color: #888;
            font-size: 12px;
            margin-bottom: 5px;
        }}
        
        .stat-value {{
            color: #fff;
            font-size: 24px;
            font-weight: bold;
        }}
        
        .aggregate-table {{
            margin-top: 20px;
        }}
        
        .aggregate-table table {{
            font-size: 14px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Event Window Coverage Dashboard</h1>
        <p class="subtitle">Continuous event window coverage analysis (2025-05-01 to 2026-01-04)</p>
        
        <!-- Overall Aggregates -->
        <div class="section">
            <h2>Overall Coverage Aggregates</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Tokens</div>
                    <div class="stat-value">{aggregates['total_tokens']:,}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Alerts</div>
                    <div class="stat-value">{aggregates['total_alerts']:,}</div>
                </div>
            </div>
            
            <div class="progress-container">
                <h3 style="margin-bottom: 20px; color: #fff;">Overall Coverage by Window</h3>
"""
    
    for window in TIME_WINDOWS:
        window_key = f'{window}hr'
        coverage = aggregates['overall'].get(window_key, 0.0)
        coverage_class = 'excellent' if coverage >= 90 else 'good' if coverage >= 75 else 'fair' if coverage >= 50 else 'poor'
        
        html += f"""
                <div class="progress-container">
                    <div class="progress-label">
                        <span>{window}h Window</span>
                        <span>{coverage:.2f}%</span>
                    </div>
                    <div class="progress-bar progress-bar-large">
                        <div class="progress-fill {coverage_class}" style="width: {coverage}%">
                            {coverage:.1f}%
                        </div>
                    </div>
                </div>
"""
    
    html += """
            </div>
        </div>
        
        <!-- Per-Token Table -->
        <div class="section">
            <h2>Per-Token Coverage</h2>
            <div class="controls">
                <input type="text" id="filter-input" placeholder="Filter by mint or chain...">
                <select id="chain-filter">
                    <option value="">All Chains</option>
                </select>
                <select id="sort-by">
                    <option value="total_alerts">Sort by Alerts</option>
                    <option value="mint">Sort by Mint</option>
                    <option value="chain">Sort by Chain</option>
                    <option value="12hr">Sort by 12h Coverage</option>
                    <option value="24hr">Sort by 24h Coverage</option>
                    <option value="36hr">Sort by 36h Coverage</option>
                    <option value="48hr">Sort by 48h Coverage</option>
                    <option value="72hr">Sort by 72h Coverage</option>
                    <option value="96hr">Sort by 96h Coverage</option>
                </select>
            </div>
            
            <table id="token-table">
                <thead>
                    <tr>
                        <th data-sort="mint">Token (Mint)</th>
                        <th data-sort="chain">Chain</th>
                        <th data-sort="total_alerts">Alerts</th>
"""
    
    for window in TIME_WINDOWS:
        html += f'                        <th data-sort="{window}hr">{window}h Coverage</th>\n'
    
    html += """                    </tr>
                </thead>
                <tbody id="token-tbody">
                </tbody>
            </table>
        </div>
        
        <!-- Weekly Coverage Table -->
        <div class="section">
            <h2>Weekly Coverage Percentages</h2>
            <table id="weekly-coverage-table">
                <thead>
                    <tr>
                        <th>Week</th>
"""
    
    for window in TIME_WINDOWS:
        html += f'                        <th>{window}h Coverage</th>\n'
    
    html += """                    </tr>
                </thead>
                <tbody id="weekly-tbody">
                </tbody>
            </table>
        </div>
        
        <!-- Monthly Coverage Table -->
        <div class="section">
            <h2>Monthly Coverage Percentages</h2>
            <table id="monthly-coverage-table">
                <thead>
                    <tr>
                        <th>Month</th>
"""
    
    for window in TIME_WINDOWS:
        html += f'                        <th>{window}h Coverage</th>\n'
    
    html += """                    </tr>
                </thead>
                <tbody id="monthly-tbody">
                </tbody>
            </table>
        </div>
    </div>
    
    <script>
        const data = """ + json.dumps(tokens_list, indent=2) + """;
        const TIME_WINDOWS = """ + json.dumps(TIME_WINDOWS) + """;
        const periodAggregates = """ + json.dumps(period_aggregates, indent=2) + """;
        
        let filteredData = [...data];
        let sortColumn = 'total_alerts';
        let sortDirection = 'desc';
        
        function getCoverageClass(coverage) {
            if (coverage >= 90) return 'excellent';
            if (coverage >= 75) return 'good';
            if (coverage >= 50) return 'fair';
            return 'poor';
        }
        
        function renderTable() {
            const tbody = document.getElementById('token-tbody');
            tbody.innerHTML = '';
            
            filteredData.forEach(token => {
                const row = document.createElement('tr');
                const mintShort = token.mint.length > 20 ? token.mint.substring(0, 17) + '...' : token.mint;
                
                let cells = `
                    <td><div class="token-mint" title="${token.mint}">${mintShort}</div></td>
                    <td><span class="chain-badge">${token.chain}</span></td>
                    <td>${token.total_alerts}</td>
                `;
                
                TIME_WINDOWS.forEach(window => {
                    const windowKey = window + 'hr';
                    const coverage = token.windows[windowKey]?.coverage_pct || 0;
                    const coverageClass = getCoverageClass(coverage);
                    cells += `
                        <td>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div class="mini-progress" style="flex: 1;">
                                    <div class="mini-progress-fill ${coverageClass}" style="width: ${coverage}%"></div>
                                </div>
                                <span style="min-width: 50px; text-align: right; font-size: 12px;">${coverage.toFixed(1)}%</span>
                            </div>
                        </td>
                    `;
                });
                
                row.innerHTML = cells;
                tbody.appendChild(row);
            });
        }
        
        function updateFilters() {
            const filterInput = document.getElementById('filter-input').value.toLowerCase();
            const chainFilter = document.getElementById('chain-filter').value;
            
            filteredData = data.filter(token => {
                const matchesFilter = !filterInput || 
                    token.mint.toLowerCase().includes(filterInput) ||
                    token.chain.toLowerCase().includes(filterInput);
                const matchesChain = !chainFilter || token.chain === chainFilter;
                return matchesFilter && matchesChain;
            });
            
            sortData();
            renderTable();
        }
        
        function sortData() {
            filteredData.sort((a, b) => {
                let aVal, bVal;
                
                if (sortColumn === 'mint') {
                    aVal = a.mint;
                    bVal = b.mint;
                } else if (sortColumn === 'chain') {
                    aVal = a.chain;
                    bVal = b.chain;
                } else if (sortColumn === 'total_alerts') {
                    aVal = a.total_alerts;
                    bVal = b.total_alerts;
                } else if (sortColumn.endsWith('hr')) {
                    aVal = a.windows[sortColumn]?.coverage_pct || 0;
                    bVal = b.windows[sortColumn]?.coverage_pct || 0;
                } else {
                    aVal = a[sortColumn];
                    bVal = b[sortColumn];
                }
                
                if (typeof aVal === 'string') {
                    return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                } else {
                    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }
            });
        }
        
        // Populate chain filter
        const chains = [...new Set(data.map(t => t.chain))].sort();
        const chainFilter = document.getElementById('chain-filter');
        chains.forEach(chain => {
            const option = document.createElement('option');
            option.value = chain;
            option.textContent = chain;
            chainFilter.appendChild(option);
        });
        
        // Event listeners
        document.getElementById('filter-input').addEventListener('input', updateFilters);
        document.getElementById('chain-filter').addEventListener('change', updateFilters);
        document.getElementById('sort-by').addEventListener('change', (e) => {
            sortColumn = e.target.value;
            sortData();
            renderTable();
        });
        
        // Table header sorting
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const newSort = th.getAttribute('data-sort');
                if (sortColumn === newSort) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = newSort;
                    sortDirection = 'desc';
                }
                
                // Update UI
                document.querySelectorAll('th').forEach(h => {
                    h.classList.remove('sorted-asc', 'sorted-desc');
                });
                th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
                
                sortData();
                renderTable();
            });
        });
        
        function renderWeeklyMonthlyTables() {
            // Render weekly table
            const weeklyTbody = document.getElementById('weekly-tbody');
            weeklyTbody.innerHTML = '';
            
            const weeklyData = Object.keys(periodAggregates.weekly || {})
                .sort()
                .reverse()
                .map(weekKey => ({
                    week: weekKey,
                    windows: periodAggregates.weekly[weekKey] || {}
                }));
            
            weeklyData.forEach(week => {
                const row = document.createElement('tr');
                let cells = `<td>${week.week}</td>`;
                
                TIME_WINDOWS.forEach(window => {
                    const windowKey = window + 'hr';
                    const coverage = week.windows[windowKey] || 0;
                    const coverageClass = getCoverageClass(coverage);
                    cells += `
                        <td>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div class="mini-progress" style="flex: 1;">
                                    <div class="mini-progress-fill ${coverageClass}" style="width: ${coverage}%"></div>
                                </div>
                                <span style="min-width: 50px; text-align: right; font-size: 12px;">${coverage.toFixed(1)}%</span>
                            </div>
                        </td>
                    `;
                });
                
                row.innerHTML = cells;
                weeklyTbody.appendChild(row);
            });
            
            // Render monthly table
            const monthlyTbody = document.getElementById('monthly-tbody');
            monthlyTbody.innerHTML = '';
            
            const monthlyData = Object.keys(periodAggregates.monthly || {})
                .sort()
                .reverse()
                .map(monthKey => ({
                    month: monthKey,
                    windows: periodAggregates.monthly[monthKey] || {}
                }));
            
            monthlyData.forEach(month => {
                const row = document.createElement('tr');
                let cells = `<td>${month.month}</td>`;
                
                TIME_WINDOWS.forEach(window => {
                    const windowKey = window + 'hr';
                    const coverage = month.windows[windowKey] || 0;
                    const coverageClass = getCoverageClass(coverage);
                    cells += `
                        <td>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div class="mini-progress" style="flex: 1;">
                                    <div class="mini-progress-fill ${coverageClass}" style="width: ${coverage}%"></div>
                                </div>
                                <span style="min-width: 50px; text-align: right; font-size: 12px;">${coverage.toFixed(1)}%</span>
                            </div>
                        </td>
                    `;
                });
                
                row.innerHTML = cells;
                monthlyTbody.appendChild(row);
            });
        }
        
        // Initial render
        sortData();
        renderTable();
        renderWeeklyMonthlyTables();
    </script>
</body>
</html>
"""
    
    with open(output_path, 'w') as f:
        f.write(html)
    
    print(f"✓ Dashboard generated: {output_path}", file=sys.stderr)


def main():
    """Main script entry point."""
    if len(sys.argv) < 3:
        print("Usage: python visualize_event_windows.py <input.json> <output.html>", file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    try:
        print(f"Loading data from {input_path}...", file=sys.stderr)
        tokens_data, alerts_data = load_data(input_path)
        print(f"✓ Loaded {len(tokens_data)} tokens, {len(alerts_data)} alerts", file=sys.stderr)
        
        print(f"Generating dashboard...", file=sys.stderr)
        generate_html(tokens_data, alerts_data, output_path)
        print(f"✓ Dashboard saved to {output_path}", file=sys.stderr)
        print(f"\nOpen {output_path} in a web browser to view the dashboard.", file=sys.stderr)
        
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

