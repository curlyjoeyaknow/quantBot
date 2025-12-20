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
import { execSync, spawn } from 'child_process';
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
    '--duckdb',
    duckdbPath,
    '--interval',
    interval,
    '--format',
    'json',
    '--generate-fetch-plan',
    '--min-coverage',
    minCoverage.toString(),
    '--verbose', // Show progress to stderr
  ];

  if (startMonth) args.push('--start-month', startMonth);
  if (endMonth) args.push('--end-month', endMonth);
  if (caller) args.push('--caller', caller);

  console.log('   Querying DuckDB and ClickHouse...');
  console.log('   (Progress will be shown below)\n');

  try {
    const startTime = Date.now();

    // Use spawn to show stderr (verbose output) in real-time
    const result = await new Promise<string>((resolve, reject) => {
      const { spawn } = require('child_process');
      const child = spawn('python3', args, {
        cwd: process.cwd(),
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        // Show verbose progress in real-time
        process.stderr.write(data.toString());
        stderr += data.toString();
      });

      child.on('close', (code: number) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Python script exited with code ${code}\nstderr: ${stderr}`));
        }
      });

      child.on('error', (err: Error) => {
        reject(err);
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        child.kill();
        reject(new Error('Timeout: Analysis took longer than 2 minutes'));
      }, 120000);
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n   ✓ Analysis complete (${elapsed}s)\n`);

    // Check if output contains error
    if (result.includes('ERROR:') || result.includes('Traceback')) {
      console.error('❌ Python script error:');
      console.error(result);
      throw new Error('Coverage analysis failed');
    }

    return JSON.parse(result);
  } catch (error: any) {
    console.error('\n   ✗ Analysis failed\n');
    console.error('❌ Failed to get coverage data:', error.message);
    throw error;
  }
}

async function fetchOhlcvForTask(
  task: FetchTask,
  duckdbPath: string,
  dryRun: boolean = false
): Promise<void> {
  // Calculate date range for the month
  const monthStart = DateTime.fromISO(`${task.month}-01`);
  const monthEnd = monthStart.endOf('month');

  const from = monthStart.toISODate();
  const to = monthEnd.toISODate();

  // Check if month is within last 3 months (fetch 15s interval too)
  const now = DateTime.now();
  const monthAge = now.diff(monthStart, 'months').months;
  const isRecent = monthAge < 3;

  // Intervals to fetch: always 1m and 5m, add 15s for recent months
  const intervals = ['1m', '5m'];
  if (isRecent) {
    intervals.push('15s');
  }

  console.log(`\n📊 Fetching OHLCV for ${task.caller} - ${task.month}`);
  console.log(`   Current coverage: ${(task.current_coverage * 100).toFixed(1)}%`);
  console.log(`   Missing mints: ${task.missing_mints.length}`);
  console.log(`   Date range: ${from} to ${to}`);
  console.log(`   Intervals: ${intervals.join(', ')}${isRecent ? ' (recent - includes 15s)' : ''}`);
  console.log(`   Window: -52 candles before, +4948 candles after each call`);

  if (dryRun) {
    for (const interval of intervals) {
      console.log(
        `   [DRY RUN] Would run: quantbot ingestion ohlcv --duckdb ${duckdbPath} --from ${from} --to ${to} --interval ${interval} --candles 5000 --start-offset-minutes -52`
      );
    }
    return;
  }

  try {
    // Run OHLCV ingestion for each interval
    for (const interval of intervals) {
      const args = [
        'quantbot',
        'ingestion',
        'ohlcv',
        '--duckdb',
        duckdbPath,
        '--from',
        from!,
        '--to',
        to!,
        '--interval',
        interval,
        '--candles',
        '5000', // Total candles: 52 before + 4948 after = 5000
        '--start-offset-minutes',
        '-52', // Start 52 candles before alert
      ];

      console.log(`   🔄 [${interval}] Starting ingestion (live output below)...`);
      console.log(`   ${'─'.repeat(70)}`);
      const startTime = Date.now();

      // Use spawn to show live output
      await new Promise<void>((resolve, reject) => {
        const child = spawn('pnpm', args, {
          env: {
            ...process.env,
            DUCKDB_PATH: duckdbPath,
          },
          stdio: 'inherit', // Show all output in real-time
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });

        child.on('error', (err) => {
          reject(err);
        });
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ${'─'.repeat(70)}`);
      console.log(`   ✅ [${interval}] Completed in ${duration}s`);

      // Small delay between intervals
      if (intervals.indexOf(interval) < intervals.length - 1) {
        console.log(`   ⏳ Waiting 2s before next interval...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
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
        (t) => t.caller === options.caller && t.month === options.month
      );

      if (!task) {
        console.log(`❌ No gaps found for ${options.caller} in ${options.month}`);
        console.log(`   Coverage is already good or no calls exist for this period.`);
        return;
      }

      tasksToFetch = [task];
    } else if (options.caller) {
      // All months for specific caller
      tasksToFetch = coverageData.fetch_plan.filter((t) => t.caller === options.caller);
      console.log(`🎯 Fetching all gaps for caller: ${options.caller}\n`);
    } else if (options.month) {
      // All callers for specific month
      tasksToFetch = coverageData.fetch_plan.filter((t) => t.month === options.month);
      console.log(`🎯 Fetching all gaps for month: ${options.month}\n`);
    } else {
      // Show top 10 by default
      tasksToFetch = coverageData.fetch_plan.slice(0, 10);
      console.log(`🎯 Showing top 10 priority tasks (use --auto to fetch)\n`);

      for (const [i, task] of tasksToFetch.entries()) {
        console.log(`${i + 1}. ${task.caller} - ${task.month}`);
        console.log(
          `   Coverage: ${(task.current_coverage * 100).toFixed(1)}% (${task.calls_with_coverage}/${task.total_calls} calls)`
        );
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
    const overallStartTime = Date.now();

    for (const [i, task] of tasksToFetch.entries()) {
      const progress = `[${i + 1}/${tasksToFetch.length}]`;
      const progressPct = (((i + 1) / tasksToFetch.length) * 100).toFixed(0);

      console.log(`\n${progress} (${progressPct}% complete)`);

      try {
        await fetchOhlcvForTask(task, options.duckdb, options.dryRun);
        successCount++;

        // Show running stats
        const elapsed = ((Date.now() - overallStartTime) / 1000).toFixed(0);
        const avgTime = (Date.now() - overallStartTime) / (i + 1) / 1000;
        const remaining = tasksToFetch.length - (i + 1);
        const eta = (avgTime * remaining).toFixed(0);

        if (!options.dryRun && remaining > 0) {
          console.log(
            `   📊 Progress: ${successCount} succeeded, ${failCount} failed | Elapsed: ${elapsed}s | ETA: ${eta}s`
          );
        }
      } catch (error) {
        failCount++;
        console.error(`   ❌ Failed to fetch for ${task.caller} - ${task.month}`);
      }

      // Add delay between fetches to avoid rate limiting
      if (i < tasksToFetch.length - 1 && !options.dryRun) {
        console.log('   ⏳ Waiting 5s before next task...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    const totalTime = ((Date.now() - overallStartTime) / 1000).toFixed(1);

    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 Surgical Fetch Summary');
    console.log(`${'='.repeat(80)}`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📈 Total: ${tasksToFetch.length}`);
    console.log(`⏱️  Total Time: ${totalTime}s`);
    console.log(`${'='.repeat(80)}\n`);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stderr) {
      console.error('stderr:', error.stderr);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
