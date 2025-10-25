const fs = require('fs');
const path = require('path');

const INPUT_JSON_PATH = path.join(__dirname, 'realistic_1_month_simulation.json');
const OUTPUT_CSV_PATH = path.join(__dirname, 'realistic_1_month_detailed_results.csv');
const OUTPUT_HTML_PATH = path.join(__dirname, 'trading_dashboard.html');

// Strategy definitions for better labeling
const STRATEGY_DEFINITIONS = {
    original: {
        name: "Original Strategy",
        description: "50%@2x, 30%@3x, 20%@5x",
        riskLevel: "Medium"
    },
    higher: {
        name: "Higher Targets",
        description: "50%@3x, 30%@5x, 20%@10x",
        riskLevel: "High"
    },
    conservative: {
        name: "Conservative",
        description: "70%@2x, 20%@3x, 10%@5x",
        riskLevel: "Low"
    },
    aggressive: {
        name: "Aggressive",
        description: "30%@2x, 30%@5x, 40%@10x",
        riskLevel: "Very High"
    },
    balanced: {
        name: "Balanced",
        description: "40%@2x, 40%@3x, 20%@5x",
        riskLevel: "Medium"
    },
    ultraAggressive: {
        name: "Ultra Aggressive",
        description: "20%@3x, 30%@5x, 50%@10x",
        riskLevel: "Extreme"
    }
};

function formatLargeNumber(num) {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
}

function generateCSVExport() {
    console.log('Generating detailed CSV export...');
    
    const data = JSON.parse(fs.readFileSync(INPUT_JSON_PATH, 'utf8'));
    
    const csvHeaders = [
        'Strategy Name',
        'Strategy Description', 
        'Risk Level',
        'Total Return (%)',
        'Final Portfolio Value ($)',
        'Total Trades',
        'Re-entry Rate (%)',
        'Best Performer',
        '2x Trades',
        '3x Trades', 
        '5x Trades',
        '10x Trades',
        'Total Take Profit Trades',
        'Win Rate (%)',
        'Avg Return Per Trade (%)',
        'Risk-Adjusted Return'
    ];
    
    const csvRows = data.map(strategy => {
        const strategyInfo = STRATEGY_DEFINITIONS[strategy.strategy];
        const totalTakeProfitTrades = strategy.takeProfits['2x'] + strategy.takeProfits['3x'] + strategy.takeProfits['5x'] + strategy.takeProfits['10x'];
        const winRate = (totalTakeProfitTrades / strategy.totalTrades) * 100;
        const avgReturnPerTrade = strategy.avgReturn / strategy.totalTrades;
        const riskAdjustedReturn = strategy.avgReturn / (strategy.reentryRate / 100);
        
        return [
            strategyInfo.name,
            strategyInfo.description,
            strategyInfo.riskLevel,
            strategy.avgReturn.toFixed(2),
            strategy.totalFinalValue.toFixed(2),
            strategy.totalTrades,
            strategy.reentryRate.toFixed(2),
            strategy.bestPerformer,
            strategy.takeProfits['2x'],
            strategy.takeProfits['3x'],
            strategy.takeProfits['5x'],
            strategy.takeProfits['10x'],
            totalTakeProfitTrades,
            winRate.toFixed(2),
            avgReturnPerTrade.toFixed(2),
            riskAdjustedReturn.toFixed(2)
        ];
    });
    
    const csvContent = [csvHeaders.join(','), ...csvRows.map(row => 
        row.map(cell => `"${cell}"`).join(',')
    )].join('\n');
    
    fs.writeFileSync(OUTPUT_CSV_PATH, csvContent);
    console.log(`Detailed CSV exported to: ${OUTPUT_CSV_PATH}`);
}

function generateHTMLDashboard() {
    console.log('Generating HTML dashboard...');
    
    const data = JSON.parse(fs.readFileSync(INPUT_JSON_PATH, 'utf8'));
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trading Strategy Analytics Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 300;
        }
        
        .header p {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
            text-align: center;
            transition: transform 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .stat-label {
            color: #7f8c8d;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .controls {
            padding: 20px 30px;
            background: white;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .filter-group {
            display: flex;
            gap: 20px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .filter-group label {
            font-weight: 600;
            color: #2c3e50;
        }
        
        select, input {
            padding: 8px 12px;
            border: 2px solid #ecf0f1;
            border-radius: 5px;
            font-size: 14px;
        }
        
        select:focus, input:focus {
            outline: none;
            border-color: #3498db;
        }
        
        .charts-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            padding: 30px;
        }
        
        .chart-container {
            background: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
        }
        
        .chart-title {
            font-size: 1.3em;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 20px;
            text-align: center;
        }
        
        .table-container {
            padding: 30px;
            background: white;
        }
        
        .table-title {
            font-size: 1.5em;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 20px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
        }
        
        th {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
        }
        
        td {
            padding: 12px 15px;
            border-bottom: 1px solid #ecf0f1;
        }
        
        tr:hover {
            background: #f8f9fa;
        }
        
        .risk-low { color: #27ae60; font-weight: bold; }
        .risk-medium { color: #f39c12; font-weight: bold; }
        .risk-high { color: #e74c3c; font-weight: bold; }
        .risk-extreme { color: #8e44ad; font-weight: bold; }
        
        .return-positive { color: #27ae60; font-weight: bold; }
        .return-negative { color: #e74c3c; font-weight: bold; }
        
        @media (max-width: 768px) {
            .charts-grid {
                grid-template-columns: 1fr;
            }
            
            .filter-group {
                flex-direction: column;
                align-items: stretch;
            }
            
            .header h1 {
                font-size: 2em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Trading Strategy Analytics Dashboard</h1>
            <p>Realistic 1-Month Simulation Results (July 31 - August 31, 2025)</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${data.length}</div>
                <div class="stat-label">Strategies Tested</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data[0].totalTrades}</div>
                <div class="stat-label">Total Trades</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${formatLargeNumber(data[0].totalFinalValue)}</div>
                <div class="stat-label">Best Final Value</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data[0].avgReturn.toFixed(0)}%</div>
                <div class="stat-label">Best Return</div>
            </div>
        </div>
        
        <div class="controls">
            <div class="filter-group">
                <label for="riskFilter">Risk Level:</label>
                <select id="riskFilter">
                    <option value="">All Risk Levels</option>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Very High">Very High</option>
                    <option value="Extreme">Extreme</option>
                </select>
                
                <label for="minReturn">Min Return (%):</label>
                <input type="number" id="minReturn" placeholder="0" min="0">
                
                <label for="sortBy">Sort By:</label>
                <select id="sortBy">
                    <option value="return">Total Return</option>
                    <option value="value">Final Value</option>
                    <option value="trades">Total Trades</option>
                    <option value="reentry">Re-entry Rate</option>
                </select>
            </div>
        </div>
        
        <div class="charts-grid">
            <div class="chart-container">
                <div class="chart-title">📈 Strategy Performance Comparison</div>
                <canvas id="performanceChart"></canvas>
            </div>
            
            <div class="chart-container">
                <div class="chart-title">🎯 Take Profit Distribution</div>
                <canvas id="takeProfitChart"></canvas>
            </div>
            
            <div class="chart-container">
                <div class="chart-title">⚡ Risk vs Return Analysis</div>
                <canvas id="riskReturnChart"></canvas>
            </div>
            
            <div class="chart-container">
                <div class="chart-title">🔄 Re-entry Rate by Strategy</div>
                <canvas id="reentryChart"></canvas>
            </div>
        </div>
        
        <div class="table-container">
            <div class="table-title">📋 Detailed Strategy Analysis</div>
            <table id="strategyTable">
                <thead>
                    <tr>
                        <th>Strategy</th>
                        <th>Description</th>
                        <th>Risk Level</th>
                        <th>Total Return</th>
                        <th>Final Value</th>
                        <th>Trades</th>
                        <th>Re-entry Rate</th>
                        <th>Best Performer</th>
                        <th>2x</th>
                        <th>3x</th>
                        <th>5x</th>
                        <th>10x</th>
                        <th>Win Rate</th>
                    </tr>
                </thead>
                <tbody id="strategyTableBody">
                </tbody>
            </table>
        </div>
    </div>

    <script>
        const data = ${JSON.stringify(data)};
        const strategyDefinitions = ${JSON.stringify(STRATEGY_DEFINITIONS)};
        
        function formatLargeNumber(num) {
            if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
            return num.toFixed(2);
        }
        
        function getRiskClass(riskLevel) {
            return riskLevel.toLowerCase().replace(' ', '-');
        }
        
        function renderTable(filteredData) {
            const tbody = document.getElementById('strategyTableBody');
            tbody.innerHTML = '';
            
            filteredData.forEach(strategy => {
                const strategyInfo = strategyDefinitions[strategy.strategy];
                const totalTakeProfitTrades = strategy.takeProfits['2x'] + strategy.takeProfits['3x'] + strategy.takeProfits['5x'] + strategy.takeProfits['10x'];
                const winRate = (totalTakeProfitTrades / strategy.totalTrades) * 100;
                
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td>\${strategyInfo.name}</td>
                    <td>\${strategyInfo.description}</td>
                    <td class="risk-\${getRiskClass(strategyInfo.riskLevel)}">\${strategyInfo.riskLevel}</td>
                    <td class="return-positive">\${strategy.avgReturn.toFixed(2)}%</td>
                    <td>\$\${formatLargeNumber(strategy.totalFinalValue)}</td>
                    <td>\${strategy.totalTrades}</td>
                    <td>\${strategy.reentryRate.toFixed(1)}%</td>
                    <td>\${strategy.bestPerformer}</td>
                    <td>\${strategy.takeProfits['2x']}</td>
                    <td>\${strategy.takeProfits['3x']}</td>
                    <td>\${strategy.takeProfits['5x']}</td>
                    <td>\${strategy.takeProfits['10x']}</td>
                    <td>\${winRate.toFixed(1)}%</td>
                \`;
                tbody.appendChild(row);
            });
        }
        
        function createCharts(filteredData) {
            // Performance Chart
            const performanceCtx = document.getElementById('performanceChart').getContext('2d');
            new Chart(performanceCtx, {
                type: 'bar',
                data: {
                    labels: filteredData.map(s => strategyDefinitions[s.strategy].name),
                    datasets: [{
                        label: 'Total Return (%)',
                        data: filteredData.map(s => s.avgReturn),
                        backgroundColor: 'rgba(52, 152, 219, 0.8)',
                        borderColor: 'rgba(52, 152, 219, 1)',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return value.toLocaleString() + '%';
                                }
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        }
                    }
                }
            });
            
            // Take Profit Chart
            const takeProfitCtx = document.getElementById('takeProfitChart').getContext('2d');
            new Chart(takeProfitCtx, {
                type: 'doughnut',
                data: {
                    labels: ['2x', '3x', '5x', '10x'],
                    datasets: [{
                        data: [
                            filteredData.reduce((sum, s) => sum + s.takeProfits['2x'], 0),
                            filteredData.reduce((sum, s) => sum + s.takeProfits['3x'], 0),
                            filteredData.reduce((sum, s) => sum + s.takeProfits['5x'], 0),
                            filteredData.reduce((sum, s) => sum + s.takeProfits['10x'], 0)
                        ],
                        backgroundColor: [
                            'rgba(46, 204, 113, 0.8)',
                            'rgba(52, 152, 219, 0.8)',
                            'rgba(155, 89, 182, 0.8)',
                            'rgba(231, 76, 60, 0.8)'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        }
                    }
                }
            });
            
            // Risk vs Return Chart
            const riskReturnCtx = document.getElementById('riskReturnChart').getContext('2d');
            new Chart(riskReturnCtx, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Strategies',
                        data: filteredData.map(s => ({
                            x: s.reentryRate,
                            y: s.avgReturn,
                            label: strategyDefinitions[s.strategy].name
                        })),
                        backgroundColor: filteredData.map(s => {
                            const risk = strategyDefinitions[s.strategy].riskLevel;
                            const colors = {
                                'Low': 'rgba(46, 204, 113, 0.8)',
                                'Medium': 'rgba(52, 152, 219, 0.8)',
                                'High': 'rgba(241, 196, 15, 0.8)',
                                'Very High': 'rgba(230, 126, 34, 0.8)',
                                'Extreme': 'rgba(231, 76, 60, 0.8)'
                            };
                            return colors[risk];
                        }),
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Re-entry Rate (%)'
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Total Return (%)'
                            },
                            ticks: {
                                callback: function(value) {
                                    return value.toLocaleString() + '%';
                                }
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return context.raw.label + ': ' + context.raw.y.toLocaleString() + '% return';
                                }
                            }
                        }
                    }
                }
            });
            
            // Re-entry Chart
            const reentryCtx = document.getElementById('reentryChart').getContext('2d');
            new Chart(reentryCtx, {
                type: 'line',
                data: {
                    labels: filteredData.map(s => strategyDefinitions[s.strategy].name),
                    datasets: [{
                        label: 'Re-entry Rate (%)',
                        data: filteredData.map(s => s.reentryRate),
                        borderColor: 'rgba(155, 89, 182, 1)',
                        backgroundColor: 'rgba(155, 89, 182, 0.2)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 60
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        }
                    }
                }
            });
        }
        
        function filterAndSort() {
            const riskFilter = document.getElementById('riskFilter').value;
            const minReturn = parseFloat(document.getElementById('minReturn').value) || 0;
            const sortBy = document.getElementById('sortBy').value;
            
            let filtered = data.filter(strategy => {
                const strategyInfo = strategyDefinitions[strategy.strategy];
                return (!riskFilter || strategyInfo.riskLevel === riskFilter) &&
                       strategy.avgReturn >= minReturn;
            });
            
            filtered.sort((a, b) => {
                switch(sortBy) {
                    case 'return': return b.avgReturn - a.avgReturn;
                    case 'value': return b.totalFinalValue - a.totalFinalValue;
                    case 'trades': return b.totalTrades - a.totalTrades;
                    case 'reentry': return b.reentryRate - a.reentryRate;
                    default: return 0;
                }
            });
            
            renderTable(filtered);
            createCharts(filtered);
        }
        
        // Event listeners
        document.getElementById('riskFilter').addEventListener('change', filterAndSort);
        document.getElementById('minReturn').addEventListener('input', filterAndSort);
        document.getElementById('sortBy').addEventListener('change', filterAndSort);
        
        // Initial render
        filterAndSort();
    </script>
</body>
</html>`;
    
    fs.writeFileSync(OUTPUT_HTML_PATH, html);
    console.log(`HTML dashboard exported to: ${OUTPUT_HTML_PATH}`);
}

// Run exports
generateCSVExport();
generateHTMLDashboard();

console.log('\n=== EXPORT COMPLETE ===');
console.log('✅ Detailed CSV exported with comprehensive analytics');
console.log('✅ Interactive HTML dashboard created with:');
console.log('   📊 Multiple chart types (bar, doughnut, scatter, line)');
console.log('   🔍 Advanced filtering by risk level and minimum return');
console.log('   📈 Sorting capabilities by various metrics');
console.log('   📱 Responsive design for mobile and desktop');
console.log('   🎨 Modern UI with hover effects and animations');
console.log('\nOpen the HTML file in your browser to view the interactive dashboard!');
