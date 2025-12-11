"use strict";
/**
 * Generate HTML viewer for scored token results
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateHTML = generateHTML;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
const logger_1 = require("../../src/utils/logger");
const view_scored_results_1 = require("./view-scored-results");
(0, dotenv_1.config)();
/**
 * Generate HTML viewer
 */
function generateHTML(results, outputPath) {
    const sorted = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scored Token Results</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 20px;
      line-height: 1.6;
    }

    .container {
      max-width: 1600px;
      margin: 0 auto;
    }

    h1 {
      color: #fff;
      margin-bottom: 10px;
      font-size: 2em;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 15px;
    }

    .stat-label {
      color: #888;
      font-size: 0.9em;
      margin-bottom: 5px;
    }

    .stat-value {
      color: #fff;
      font-size: 1.5em;
      font-weight: bold;
    }

    .stat-value.positive {
      color: #4ade80;
    }

    .stat-value.negative {
      color: #f87171;
    }

    .controls {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 20px;
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      align-items: center;
    }

    .controls input, .controls select {
      background: #0a0a0a;
      border: 1px solid #333;
      color: #e0e0e0;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 0.9em;
    }

    .controls input:focus, .controls select:focus {
      outline: none;
      border-color: #4ade80;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      overflow: hidden;
    }

    thead {
      background: #2a2a2a;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th {
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #fff;
      border-bottom: 2px solid #333;
      cursor: pointer;
      user-select: none;
    }

    th:hover {
      background: #333;
    }

    th.sorted-asc::after {
      content: ' ▲';
      color: #4ade80;
    }

    th.sorted-desc::after {
      content: ' ▼';
      color: #4ade80;
    }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid #2a2a2a;
    }

    tr:hover {
      background: #252525;
    }

    .score {
      font-weight: bold;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-block;
    }

    .score.high {
      background: #065f46;
      color: #4ade80;
    }

    .score.medium {
      background: #78350f;
      color: #fbbf24;
    }

    .score.low {
      background: #7f1d1d;
      color: #f87171;
    }

    .return {
      font-weight: bold;
    }

    .return.positive {
      color: #4ade80;
    }

    .return.negative {
      color: #f87171;
    }

    .token-address {
      font-family: 'Courier New', monospace;
      font-size: 0.85em;
      color: #888;
    }

    .chain-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8em;
      font-weight: 600;
    }

    .chain-badge.solana {
      background: #14f195;
      color: #000;
    }

    .chain-badge.ethereum {
      background: #627eea;
      color: #fff;
    }

    .chain-badge.base {
      background: #0052ff;
      color: #fff;
    }

    .pagination {
      margin-top: 20px;
      display: flex;
      justify-content: center;
      gap: 10px;
      align-items: center;
    }

    .pagination button {
      background: #1a1a1a;
      border: 1px solid #333;
      color: #e0e0e0;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
    }

    .pagination button:hover:not(:disabled) {
      background: #2a2a2a;
      border-color: #4ade80;
    }

    .pagination button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pagination span {
      color: #888;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Scored Token Results</h1>
    
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Tokens</div>
        <div class="stat-value">${results.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Average Score</div>
        <div class="stat-value">${(results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length).toFixed(2)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg 30d Return</div>
        <div class="stat-value ${results.filter(r => r.maxReturn30d > 0).length > 0 ? 'positive' : ''}">
          ${(results.reduce((sum, r) => sum + (r.maxReturn30d || 0), 0) / results.length).toFixed(2)}%
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Top 10 Avg Return</div>
        <div class="stat-value ${sorted.slice(0, 10).reduce((sum, r) => sum + (r.maxReturn30d || 0), 0) / 10 > 0 ? 'positive' : ''}">
          ${(sorted.slice(0, 10).reduce((sum, r) => sum + (r.maxReturn30d || 0), 0) / 10).toFixed(2)}%
        </div>
      </div>
    </div>

    <div class="controls">
      <input type="text" id="search" placeholder="Search token or caller..." style="flex: 1; min-width: 200px;">
      <input type="number" id="minScore" placeholder="Min Score" style="width: 120px;">
      <input type="number" id="minReturn" placeholder="Min Return %" style="width: 120px;">
      <select id="chainFilter" style="width: 120px;">
        <option value="">All Chains</option>
        <option value="solana">Solana</option>
        <option value="ethereum">Ethereum</option>
        <option value="base">Base</option>
      </select>
      <select id="sortBy" style="width: 150px;">
        <option value="score">Sort by Score</option>
        <option value="return30d">Sort by 30d Return</option>
        <option value="return7d">Sort by 7d Return</option>
      </select>
    </div>

    <table id="resultsTable">
      <thead>
        <tr>
          <th data-sort="rank">Rank</th>
          <th data-sort="score">Score</th>
          <th data-sort="symbol">Symbol</th>
          <th data-sort="chain">Chain</th>
          <th data-sort="caller">Caller</th>
          <th data-sort="return7d">7d Return</th>
          <th data-sort="return30d">30d Return</th>
          <th data-sort="price">Price</th>
          <th data-sort="marketCap">Market Cap</th>
          <th data-sort="timestamp">Call Time</th>
        </tr>
      </thead>
      <tbody id="tableBody">
        ${sorted.map((result, index) => {
        const scoreClass = (result.score || 0) >= 80 ? 'high' : (result.score || 0) >= 60 ? 'medium' : 'low';
        const return7dClass = (result.maxReturn7d || 0) >= 0 ? 'positive' : 'negative';
        const return30dClass = (result.maxReturn30d || 0) >= 0 ? 'positive' : 'negative';
        const chainClass = (result.chain || '').toLowerCase();
        const date = new Date((result.callTimestamp || 0) * 1000);
        return `
          <tr>
            <td>${index + 1}</td>
            <td><span class="score ${scoreClass}">${(result.score || 0).toFixed(2)}</span></td>
            <td>${result.tokenSymbol || 'N/A'}</td>
            <td><span class="chain-badge ${chainClass}">${result.chain || 'N/A'}</span></td>
            <td>${result.callerName || 'N/A'}</td>
            <td class="return ${return7dClass}">${(result.maxReturn7d || 0).toFixed(2)}%</td>
            <td class="return ${return30dClass}">${(result.maxReturn30d || 0).toFixed(2)}%</td>
            <td>$${(result.priceAtCall || 0).toFixed(6)}</td>
            <td>${result.marketCapAtCall ? '$' + (result.marketCapAtCall / 1e6).toFixed(2) + 'M' : 'N/A'}</td>
            <td>${date.toLocaleString()}</td>
          </tr>
          `;
    }).join('')}
      </tbody>
    </table>
  </div>

  <script>
    const allResults = ${JSON.stringify(sorted)};
    let filteredResults = [...allResults];
    let sortColumn = 'score';
    let sortDirection = 'desc';

    function renderTable() {
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = filteredResults.map((result, index) => {
        const scoreClass = (result.score || 0) >= 80 ? 'high' : (result.score || 0) >= 60 ? 'medium' : 'low';
        const return7dClass = (result.maxReturn7d || 0) >= 0 ? 'positive' : 'negative';
        const return30dClass = (result.maxReturn30d || 0) >= 0 ? 'positive' : 'negative';
        const chainClass = (result.chain || '').toLowerCase();
        const date = new Date((result.callTimestamp || 0) * 1000);
        
        return \`
        <tr>
          <td>\${index + 1}</td>
          <td><span class="score \${scoreClass}">\${(result.score || 0).toFixed(2)}</span></td>
          <td>\${result.tokenSymbol || 'N/A'}</td>
          <td><span class="chain-badge \${chainClass}">\${result.chain || 'N/A'}</span></td>
          <td>\${result.callerName || 'N/A'}</td>
          <td class="return \${return7dClass}">\${(result.maxReturn7d || 0).toFixed(2)}%</td>
          <td class="return \${return30dClass}">\${(result.maxReturn30d || 0).toFixed(2)}%</td>
          <td>$\${(result.priceAtCall || 0).toFixed(6)}</td>
          <td>\${result.marketCapAtCall ? '$' + (result.marketCapAtCall / 1e6).toFixed(2) + 'M' : 'N/A'}</td>
          <td>\${date.toLocaleString()}</td>
        </tr>
        \`;
      }).join('');
    }

    function filterResults() {
      const search = document.getElementById('search').value.toLowerCase();
      const minScore = parseFloat(document.getElementById('minScore').value) || 0;
      const minReturn = parseFloat(document.getElementById('minReturn').value) || -Infinity;
      const chainFilter = document.getElementById('chainFilter').value.toLowerCase();

      filteredResults = allResults.filter(result => {
        const matchesSearch = !search || 
          (result.tokenSymbol || '').toLowerCase().includes(search) ||
          (result.tokenAddress || '').toLowerCase().includes(search) ||
          (result.callerName || '').toLowerCase().includes(search);
        
        const matchesScore = (result.score || 0) >= minScore;
        const matchesReturn = (result.maxReturn30d || 0) >= minReturn;
        const matchesChain = !chainFilter || (result.chain || '').toLowerCase() === chainFilter;

        return matchesSearch && matchesScore && matchesReturn && matchesChain;
      });

      sortTable();
      renderTable();
    }

    function sortTable() {
      filteredResults.sort((a, b) => {
        let aVal, bVal;
        
        switch(sortColumn) {
          case 'score':
            aVal = a.score || 0;
            bVal = b.score || 0;
            break;
          case 'return7d':
            aVal = a.maxReturn7d || 0;
            bVal = b.maxReturn7d || 0;
            break;
          case 'return30d':
            aVal = a.maxReturn30d || 0;
            bVal = b.maxReturn30d || 0;
            break;
          default:
            return 0;
        }

        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    // Event listeners
    document.getElementById('search').addEventListener('input', filterResults);
    document.getElementById('minScore').addEventListener('input', filterResults);
    document.getElementById('minReturn').addEventListener('input', filterResults);
    document.getElementById('chainFilter').addEventListener('change', filterResults);
    document.getElementById('sortBy').addEventListener('change', (e) => {
      sortColumn = e.target.value;
      sortTable();
      renderTable();
    });

    // Table header sorting
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const column = th.getAttribute('data-sort');
        if (column === sortColumn) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = column;
          sortDirection = 'desc';
        }
        
        document.querySelectorAll('th').forEach(h => {
          h.classList.remove('sorted-asc', 'sorted-desc');
        });
        th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        
        sortTable();
        renderTable();
      });
    });
  </script>
</body>
</html>`;
    fs.writeFileSync(outputPath, html);
    logger_1.logger.info('HTML viewer generated', { outputPath, tokenCount: results.length });
}
/**
 * Main function
 */
async function main() {
    const args = process.argv.slice(2);
    const filePath = args.find(a => !a.startsWith('--'));
    const outputPath = args.find(a => a.startsWith('--output='))?.split('=')[1] ||
        path.join(process.cwd(), 'data', 'exports', 'brook-analysis', `results-viewer-${Date.now()}.html`);
    // Load results
    const resultsFile = filePath || require('./view-scored-results').getLatestResultsFile();
    if (!resultsFile) {
        logger_1.logger.error('No results file found');
        process.exit(1);
    }
    logger_1.logger.info('Loading results', { file: resultsFile });
    const results = (0, view_scored_results_1.loadResults)(resultsFile);
    if (results.length === 0) {
        logger_1.logger.error('No results found in file');
        process.exit(1);
    }
    generateHTML(results, outputPath);
    console.log(`\n✅ HTML viewer generated: ${outputPath}`);
    console.log(`   Open in your browser to view results`);
}
if (require.main === module) {
    main().catch(error => {
        logger_1.logger.error('Error generating HTML viewer', error);
        process.exit(1);
    });
}
//# sourceMappingURL=view-results-html.js.map