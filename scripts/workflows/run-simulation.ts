#!/usr/bin/env ts-node
/**
 * CLI Script: Run Simulation Workflow
 * ====================================
 *
 * Executes a simulation run using the workflows package.
 *
 * Usage:
 *   ./scripts/workflows/run-simulation.ts \
 *     --strategy IchimokuV1 \
 *     --caller Brook \
 *     --from 2025-10-01 \
 *     --to 2025-12-01 \
 *     [--dry-run] \
 *     [--pre-window 60] \
 *     [--post-window 120]
 */

import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import { initClickHouse, closeClickHouse, closePostgresPool } from '@quantbot/storage';

interface CliArgs {
  strategy: string;
  caller?: string;
  from: string;
  to: string;
  dryRun: boolean;
  preWindow: number;
  postWindow: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: Partial<CliArgs> = {
    dryRun: false,
    preWindow: 0,
    postWindow: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--strategy':
        parsed.strategy = next;
        i++;
        break;
      case '--caller':
        parsed.caller = next;
        i++;
        break;
      case '--from':
        parsed.from = next;
        i++;
        break;
      case '--to':
        parsed.to = next;
        i++;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--pre-window':
        parsed.preWindow = parseInt(next, 10);
        i++;
        break;
      case '--post-window':
        parsed.postWindow = parseInt(next, 10);
        i++;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  // Validate required args
  if (!parsed.strategy || !parsed.from || !parsed.to) {
    console.error('Missing required arguments');
    printHelp();
    process.exit(1);
  }

  return parsed as CliArgs;
}

function printHelp() {
  console.log(`
Usage: run-simulation.ts [OPTIONS]

Required:
  --strategy <name>      Strategy name (must exist in database)
  --from <date>          Start date (ISO format: YYYY-MM-DD)
  --to <date>            End date (ISO format: YYYY-MM-DD)

Optional:
  --caller <name>        Filter calls by caller name (e.g., "Brook")
  --dry-run              Don't persist results to database
  --pre-window <mins>    Minutes before call timestamp to fetch candles (default: 0)
  --post-window <mins>   Minutes after call timestamp to fetch candles (default: 0)
  --help, -h             Show this help message

Examples:
  # Run simulation for IchimokuV1 strategy
  ./scripts/workflows/run-simulation.ts \\
    --strategy IchimokuV1 \\
    --from 2025-10-01 \\
    --to 2025-12-01 \\
    --dry-run

  # Run with caller filter and time windows
  ./scripts/workflows/run-simulation.ts \\
    --strategy IchimokuV1 \\
    --caller Brook \\
    --from 2025-10-01 \\
    --to 2025-12-01 \\
    --pre-window 60 \\
    --post-window 120
`);
}

async function main() {
  const args = parseArgs();

  console.log('🚀 Starting simulation workflow...');
  console.log('Configuration:', {
    strategy: args.strategy,
    caller: args.caller ?? '(all)',
    from: args.from,
    to: args.to,
    dryRun: args.dryRun,
    preWindow: args.preWindow,
    postWindow: args.postWindow,
  });

  // Initialize database connections
  console.log('\n📊 Initializing database connections...');
  await initClickHouse();

  try {
    // Create production context
    const ctx = createProductionContext();

    // Parse dates
    const from = DateTime.fromISO(args.from, { zone: 'utc' });
    const to = DateTime.fromISO(args.to, { zone: 'utc' });

    if (!from.isValid || !to.isValid) {
      throw new Error(`Invalid date format. Use ISO format (YYYY-MM-DD)`);
    }

    // Run simulation
    console.log('\n⚙️  Running simulation...');
    const result = await runSimulation(
      {
        strategyName: args.strategy,
        callerName: args.caller,
        from,
        to,
        options: {
          dryRun: args.dryRun,
          preWindowMinutes: args.preWindow,
          postWindowMinutes: args.postWindow,
        },
      },
      ctx
    );

    // Display results
    console.log('\n✅ Simulation complete!');
    console.log('\n📈 Summary:');
    console.log(`  Run ID:          ${result.runId}`);
    console.log(`  Strategy:        ${result.strategyName}`);
    console.log(`  Caller:          ${result.callerName ?? '(all)'}`);
    console.log(`  Date Range:      ${result.fromISO} to ${result.toISO}`);
    console.log(`  Dry Run:         ${result.dryRun ? 'Yes' : 'No'}`);
    console.log();
    console.log('📊 Totals:');
    console.log(`  Calls Found:     ${result.totals.callsFound}`);
    console.log(`  Calls Attempted: ${result.totals.callsAttempted}`);
    console.log(`  Calls Succeeded: ${result.totals.callsSucceeded}`);
    console.log(`  Calls Failed:    ${result.totals.callsFailed}`);
    console.log(`  Total Trades:    ${result.totals.tradesTotal}`);
    console.log();
    console.log('💰 PnL Statistics:');
    console.log(`  Min:             ${result.pnl.min?.toFixed(4) ?? 'N/A'}`);
    console.log(`  Max:             ${result.pnl.max?.toFixed(4) ?? 'N/A'}`);
    console.log(`  Mean:            ${result.pnl.mean?.toFixed(4) ?? 'N/A'}`);
    console.log(`  Median:          ${result.pnl.median?.toFixed(4) ?? 'N/A'}`);

    if (result.results.length > 0 && result.results.length <= 10) {
      console.log('\n📋 Individual Results:');
      for (const r of result.results) {
        const status = r.ok ? '✓' : '✗';
        const pnl = r.pnlMultiplier ? `${r.pnlMultiplier.toFixed(4)}x` : 'N/A';
        const trades = r.trades ?? 0;
        const error = r.errorCode ? ` (${r.errorCode})` : '';
        console.log(
          `  ${status} ${r.callId.slice(0, 8)}... ${r.mint.slice(0, 8)}... PnL: ${pnl} Trades: ${trades}${error}`
        );
      }
    } else if (result.results.length > 10) {
      console.log(`\n📋 ${result.results.length} results (showing first 5):`);
      for (const r of result.results.slice(0, 5)) {
        const status = r.ok ? '✓' : '✗';
        const pnl = r.pnlMultiplier ? `${r.pnlMultiplier.toFixed(4)}x` : 'N/A';
        const trades = r.trades ?? 0;
        console.log(
          `  ${status} ${r.callId.slice(0, 8)}... ${r.mint.slice(0, 8)}... PnL: ${pnl} Trades: ${trades}`
        );
      }
    }

    console.log();
    if (result.dryRun) {
      console.log('ℹ️  Dry run mode: Results were not persisted to database');
    } else {
      console.log('✅ Results persisted to database');
    }
  } catch (error: any) {
    console.error('\n❌ Simulation failed:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Clean up connections
    console.log('\n🔌 Closing database connections...');
    await closeClickHouse();
    await closePostgresPool();
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
