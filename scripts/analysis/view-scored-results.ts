/**
 * Viewer for scored token results
 * Displays results in a readable format with filtering and sorting
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { logger } from '../../src/utils/logger';

config();

interface ScoredToken {
  tokenAddress: string;
  tokenSymbol: string;
  chain: string;
  callerName: string;
  callTimestamp: number;
  score: number;
  maxReturn7d: number;
  maxReturn30d: number;
  priceAtCall: number;
  marketCapAtCall: number;
  volumeAtCall: number;
  features?: any;
}

/**
 * Load the most recent scored results file
 */
export function getLatestResultsFile(): string | null {
  const exportDir = path.join(process.cwd(), 'data', 'exports', 'brook-analysis');

  if (!fs.existsSync(exportDir)) {
    logger.error('Export directory does not exist', { exportDir });
    return null;
  }

  const files = fs
    .readdirSync(exportDir)
    .filter((f) => f.startsWith('unified-calls-scored-') && f.endsWith('.json'))
    .map((f) => ({
      name: f,
      path: path.join(exportDir, f),
      mtime: fs.statSync(path.join(exportDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    logger.error('No scored results files found');
    return null;
  }

  return files[0].path;
}

/**
 * Load results from JSON file
 */
function loadResults(filePath: string): ScoredToken[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const results = JSON.parse(content);

    if (!Array.isArray(results)) {
      logger.error('Results file is not an array');
      return [];
    }

    return results.filter((r: any) => r !== null && r.score !== null && r.score !== undefined);
  } catch (error: any) {
    logger.error('Error loading results', { error: error.message });
    return [];
  }
}

/**
 * Format number for display
 */
function formatNumber(num: number | null | undefined, decimals: number = 2): string {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }
  return num.toFixed(decimals);
}

/**
 * Format percentage
 */
function formatPercent(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Format timestamp
 */
function formatTimestamp(timestamp: number): string {
  if (!timestamp || timestamp === 1) {
    return 'Invalid';
  }
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

/**
 * Format score with color coding
 */
function formatScore(score: number): string {
  if (score >= 80) return `\x1b[32m${score.toFixed(2)}\x1b[0m`; // Green
  if (score >= 60) return `\x1b[33m${score.toFixed(2)}\x1b[0m`; // Yellow
  return `\x1b[31m${score.toFixed(2)}\x1b[0m`; // Red
}

/**
 * Display results in table format
 */
function displayTable(results: ScoredToken[], limit: number = 50): void {
  // Sort by score descending
  const sorted = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
  const topResults = sorted.slice(0, limit);

  console.log('\n' + '='.repeat(150));
  console.log(`TOP ${topResults.length} SCORED TOKENS (out of ${results.length} total)`);
  console.log('='.repeat(150));
  console.log();

  // Header
  console.log(
    'Rank'.padEnd(6) +
      'Score'.padEnd(8) +
      'Symbol'.padEnd(12) +
      'Chain'.padEnd(10) +
      'Caller'.padEnd(15) +
      'Return 7d'.padEnd(12) +
      'Return 30d'.padEnd(12) +
      'Price'.padEnd(12) +
      'Market Cap'.padEnd(15) +
      'Call Time'.padEnd(20)
  );
  console.log('-'.repeat(150));

  // Rows
  topResults.forEach((result, index) => {
    const rank = (index + 1).toString().padEnd(6);
    const score = formatScore(result.score || 0).padEnd(20); // Extra padding for color codes
    const symbol = (result.tokenSymbol || 'N/A').substring(0, 11).padEnd(12);
    const chain = (result.chain || 'N/A').substring(0, 9).padEnd(10);
    const caller = (result.callerName || 'N/A').substring(0, 14).padEnd(15);
    const return7d = formatPercent(result.maxReturn7d).padEnd(12);
    const return30d = formatPercent(result.maxReturn30d).padEnd(12);
    const price = `$${formatNumber(result.priceAtCall, 6)}`.padEnd(12);
    const marketCap = result.marketCapAtCall
      ? `$${(result.marketCapAtCall / 1e6).toFixed(2)}M`.padEnd(15)
      : 'N/A'.padEnd(15);
    const callTime = formatTimestamp(result.callTimestamp).padEnd(20);

    console.log(
      rank + score + symbol + chain + caller + return7d + return30d + price + marketCap + callTime
    );
  });

  console.log('-'.repeat(150));
  console.log();
}

/**
 * Display statistics
 */
function displayStats(results: ScoredToken[]): void {
  const validResults = results.filter((r) => r.score !== null && r.score !== undefined);

  if (validResults.length === 0) {
    console.log('No valid results to analyze');
    return;
  }

  const scores = validResults.map((r) => r.score || 0);
  const returns7d = validResults.map((r) => r.maxReturn7d || 0).filter((r) => !isNaN(r));
  const returns30d = validResults.map((r) => r.maxReturn30d || 0).filter((r) => !isNaN(r));

  console.log('\n' + '='.repeat(150));
  console.log('STATISTICS');
  console.log('='.repeat(150));
  console.log();

  console.log(`Total Tokens Scored: ${validResults.length}`);
  console.log();

  // Score statistics
  console.log('Score Distribution:');
  console.log(`  Min:    ${Math.min(...scores).toFixed(2)}`);
  console.log(`  Max:    ${Math.max(...scores).toFixed(2)}`);
  console.log(`  Mean:   ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)}`);
  console.log(
    `  Median: ${scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)].toFixed(2)}`
  );
  console.log();

  // Return statistics
  if (returns7d.length > 0) {
    console.log('7-Day Returns:');
    console.log(`  Min:    ${formatPercent(Math.min(...returns7d))}`);
    console.log(`  Max:    ${formatPercent(Math.max(...returns7d))}`);
    console.log(
      `  Mean:   ${formatPercent(returns7d.reduce((a, b) => a + b, 0) / returns7d.length)}`
    );
    console.log();
  }

  if (returns30d.length > 0) {
    console.log('30-Day Returns:');
    console.log(`  Min:    ${formatPercent(Math.min(...returns30d))}`);
    console.log(`  Max:    ${formatPercent(Math.max(...returns30d))}`);
    console.log(
      `  Mean:   ${formatPercent(returns30d.reduce((a, b) => a + b, 0) / returns30d.length)}`
    );
    console.log();
  }

  // Top performers
  const top10 = [...validResults].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
  const avgReturn30d =
    top10
      .map((r) => r.maxReturn30d || 0)
      .filter((r) => !isNaN(r))
      .reduce((a, b) => a + b, 0) /
    Math.max(1, top10.filter((r) => !isNaN(r.maxReturn30d || 0)).length);

  console.log('Top 10 Tokens Average 30-Day Return:', formatPercent(avgReturn30d));
  console.log();
}

/**
 * Filter results by criteria
 */
function filterResults(
  results: ScoredToken[],
  options: {
    minScore?: number;
    maxScore?: number;
    minReturn7d?: number;
    minReturn30d?: number;
    chain?: string;
    caller?: string;
  }
): ScoredToken[] {
  let filtered = [...results];

  if (options.minScore !== undefined) {
    filtered = filtered.filter((r) => (r.score || 0) >= options.minScore!);
  }

  if (options.maxScore !== undefined) {
    filtered = filtered.filter((r) => (r.score || 0) <= options.maxScore!);
  }

  if (options.minReturn7d !== undefined) {
    filtered = filtered.filter((r) => (r.maxReturn7d || 0) >= options.minReturn7d!);
  }

  if (options.minReturn30d !== undefined) {
    filtered = filtered.filter((r) => (r.maxReturn30d || 0) >= options.minReturn30d!);
  }

  if (options.chain) {
    filtered = filtered.filter((r) => r.chain?.toLowerCase() === options.chain!.toLowerCase());
  }

  if (options.caller) {
    filtered = filtered.filter((r) =>
      r.callerName?.toLowerCase().includes(options.caller!.toLowerCase())
    );
  }

  return filtered;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  const limit = args.find((a) => a.startsWith('--limit='))?.split('=')[1]
    ? parseInt(args.find((a) => a.startsWith('--limit='))!.split('=')[1])
    : 50;

  const minScore = args.find((a) => a.startsWith('--min-score='))?.split('=')[1]
    ? parseFloat(args.find((a) => a.startsWith('--min-score='))!.split('=')[1])
    : undefined;

  const minReturn30d = args.find((a) => a.startsWith('--min-return='))?.split('=')[1]
    ? parseFloat(args.find((a) => a.startsWith('--min-return='))!.split('=')[1])
    : undefined;

  const chain = args.find((a) => a.startsWith('--chain='))?.split('=')[1];
  const caller = args.find((a) => a.startsWith('--caller='))?.split('=')[1];
  const filePath = args.find((a) => !a.startsWith('--'));

  // Load results
  const resultsFile = filePath || getLatestResultsFile();
  if (!resultsFile) {
    console.error('❌ No results file found');
    console.error('   Run: npm run score:unified-calls first');
    process.exit(1);
  }

  logger.info('Loading results', { file: resultsFile });
  const allResults = loadResults(resultsFile);

  if (allResults.length === 0) {
    console.error('❌ No results found in file');
    console.error('   The scoring may not have completed successfully');
    console.error(`   File: ${resultsFile}`);
    process.exit(1);
  }

  // Filter results
  const filtered = filterResults(allResults, {
    minScore,
    minReturn30d,
    chain,
    caller,
  });

  logger.info('Displaying results', {
    total: allResults.length,
    filtered: filtered.length,
  });

  // Display
  displayStats(filtered);
  displayTable(filtered, limit);

  // Export option
  if (args.includes('--export')) {
    const exportPath = path.join(
      process.cwd(),
      'data',
      'exports',
      'brook-analysis',
      `filtered-results-${Date.now()}.json`
    );
    fs.writeFileSync(exportPath, JSON.stringify(filtered, null, 2));
    console.log(`\n✅ Filtered results exported to: ${exportPath}`);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Error viewing results', error as Error);
    process.exit(1);
  });
}

export { loadResults, displayTable, displayStats, filterResults };
