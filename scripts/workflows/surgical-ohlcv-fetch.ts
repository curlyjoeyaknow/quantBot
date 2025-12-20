#!/usr/bin/env tsx
/**
 * Surgical OHLCV Fetch - Caller-based targeted fetching
 * 
 * Uses caller coverage matrix to identify and fetch missing OHLCV data
 * for specific callers and time periods with poor coverage.
 * 
 * Usage:
 *   pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --caller Brook --month 2025-07
 *   pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto --min-coverage 0.8 --limit 10
 */

import { program } from 'commander';
import { execSync } from 'child_process';
import { DateTime } from 'luxon';

interface FetchTask {
  caller: string;
  month: string;
  missing_mints: string[];
  total_calls: number;
  calls_with_coverage: number;
  current_coverage: number;
  priority: number;
}

interface CoverageData {
  callers: string[];
  months: string[];
  matrix: Record<string, Record<string, any>>;
  fetch_plan: FetchTask[];
}

async function getCoverageData(
  duckdbPath: string,
  interval: string,
  startMonth?: string,
  endMonth?: string,
  caller?: string,
  minCoverage: number = 0.8
): Promise<CoverageData> {
  const args = [
    'tools/analysis/ohlcv_caller_coverage.py',
    '--duckdb', duckdbPath,
    '--interval', interval,
    '--format', 'json',
    '--generate-fetch-plan',
    '--min-coverage', minCoverage.toString()
  ];

  if (startMonth) args.push('--start-month', startMonth);
  if (endMonth) args.push('--end-month', endMonth);
  if (caller) args.push('--caller', caller);

  const stdout = execSync(`python3 ${args.join(' ')}`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function fetchOhlcvForTask(
  task: FetchTask,
  duckdbPath: string,
  interval: string,
  dryRun: boolean = false
): Promise<void> {
  // Calculate date range for the month
  const monthStart = DateTime.fromISO(`${task.month}-01`);
  const monthEnd = monthStart.endOf('month');

  const from = monthStart.toISODate();
  const to = monthEnd.toISODate();

  console.log(`\n📊 Fetching OHLCV for ${task.caller} - ${task.month}`);
  console.log(`   Current coverage: ${(task.current_coverage * 100).toFixed(1)}%`);
  console.log(`   Missing mints: ${task.missing_mints.length}`);
  console.log(`   Date range: ${from} to ${to}`);

  if (dryRun) {
    console.log(`   [DRY RUN] Would run: quantbot ingestion ohlcv --duckdb ${duckdbPath} --from ${from} --to ${to} --interval ${interval}`);
    return;
  }

  try {
    // Run OHLCV ingestion for this caller's time period
    const args = [
      'quantbot',
      'ingestion',
      'ohlcv',
      '--duckdb', duckdbPath,
      '--from', from!,
      '--to', to!,
      '--interval', interval
    ];

    console.log(`   Running: pnpm ${args.join(' ')}`);

    const stdout = execSync(`pnpm ${args.join(' ')}`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        DUCKDB_PATH: duckdbPath
      }
    });

    // Parse output for success metrics
    const lines = stdout.split('\n');
    const summaryLine = lines.find(line => line.includes('workItemsSucceeded'));
    
    if (summaryLine) {
      console.log(`   ✅ Completed: ${summaryLine}`);
    } else {
      console.log(`   ✅ Fetch completed`);
    }
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    if (error.stderr) {
      console.error(`   stderr: ${error.stderr}`);
    }
    throw error;
  }
}

async function main() {
  program
    .name('surgical-ohlcv-fetch')
    .description('Surgical OHLCV fetching based on caller coverage analysis')
    .option('--duckdb <path>', 'Path to DuckDB database', 'data/tele.duckdb')
    .option('--interval <interval>', 'OHLCV interval', '5m')
    .option('--caller <name>', 'Specific caller to fetch for')
    .option('--month <YYYY-MM>', 'Specific month to fetch for')
    .option('--start-month <YYYY-MM>', 'Start month for analysis')
    .option('--end-month <YYYY-MM>', 'End month for analysis')
    .option('--auto', 'Automatically fetch for top priority gaps')
    .option('--limit <number>', 'Limit number of tasks in auto mode', '10')
    .option('--min-coverage <ratio>', 'Minimum coverage threshold (0-1)', '0.8')
    .option('--dry-run', 'Show what would be fetched without actually fetching')
    .parse();

  const options = program.opts();

  console.log('🔍 Analyzing caller coverage...\n');

  try {
    // Get coverage data and fetch plan
    const coverageData = await getCoverageData(
      options.duckdb,
      options.interval,
      options.startMonth,
      options.endMonth,
      options.caller,
      parseFloat(options.minCoverage)
    );

    if (!coverageData.fetch_plan || coverageData.fetch_plan.length === 0) {
      console.log('✅ No gaps found! All callers have good coverage.');
      return;
    }

    console.log(`Found ${coverageData.fetch_plan.length} caller-month combinations with gaps\n`);

    let tasksToFetch: FetchTask[] = [];

    if (options.auto) {
      // Auto mode: fetch top priority tasks
      const limit = parseInt(options.limit);
      tasksToFetch = coverageData.fetch_plan.slice(0, limit);
      console.log(`🎯 Auto mode: Fetching top ${tasksToFetch.length} priority tasks\n`);
    } else if (options.caller && options.month) {
      // Specific caller-month
      const task = coverageData.fetch_plan.find(
        t => t.caller === options.caller && t.month === options.month
      );
      
      if (!task) {
        console.log(`❌ No gaps found for ${options.caller} in ${options.month}`);
        console.log(`   Coverage is already good or no calls exist for this period.`);
        return;
      }
      
      tasksToFetch = [task];
    } else if (options.caller) {
      // All months for specific caller
      tasksToFetch = coverageData.fetch_plan.filter(t => t.caller === options.caller);
      console.log(`🎯 Fetching all gaps for caller: ${options.caller}\n`);
    } else if (options.month) {
      // All callers for specific month
      tasksToFetch = coverageData.fetch_plan.filter(t => t.month === options.month);
      console.log(`🎯 Fetching all gaps for month: ${options.month}\n`);
    } else {
      // Show top 10 by default
      tasksToFetch = coverageData.fetch_plan.slice(0, 10);
      console.log(`🎯 Showing top 10 priority tasks (use --auto to fetch)\n`);
      
      for (const [i, task] of tasksToFetch.entries()) {
        console.log(`${i + 1}. ${task.caller} - ${task.month}`);
        console.log(`   Coverage: ${(task.current_coverage * 100).toFixed(1)}% (${task.calls_with_coverage}/${task.total_calls} calls)`);
        console.log(`   Missing mints: ${task.missing_mints.length}`);
        console.log(`   Priority: ${task.priority.toFixed(1)}\n`);
      }
      
      console.log('\nTo fetch, use:');
      console.log('  --auto                    # Fetch top 10');
      console.log('  --caller <name>           # Fetch all gaps for caller');
      console.log('  --month <YYYY-MM>         # Fetch all gaps for month');
      console.log('  --caller <name> --month <YYYY-MM>  # Fetch specific gap');
      return;
    }

    // Execute fetch tasks
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Starting surgical OHLCV fetch for ${tasksToFetch.length} tasks`);
    console.log(`${'='.repeat(80)}\n`);

    let successCount = 0;
    let failCount = 0;

    for (const [i, task] of tasksToFetch.entries()) {
      console.log(`\n[${i + 1}/${tasksToFetch.length}]`);
      
      try {
        await fetchOhlcvForTask(task, options.duckdb, options.interval, options.dryRun);
        successCount++;
      } catch (error) {
        failCount++;
        console.error(`Failed to fetch for ${task.caller} - ${task.month}`);
      }

      // Add delay between fetches to avoid rate limiting
      if (i < tasksToFetch.length - 1 && !options.dryRun) {
        console.log('\n   ⏳ Waiting 5 seconds before next fetch...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 Surgical Fetch Summary');
    console.log(`${'='.repeat(80)}`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📈 Total: ${tasksToFetch.length}`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stderr) {
      console.error('stderr:', error.stderr);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

