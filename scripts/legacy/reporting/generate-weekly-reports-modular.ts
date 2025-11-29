#!/usr/bin/env ts-node
/**
 * Modular Weekly Report Generator
 * 
 * Can be called with command-line arguments to generate reports
 * for different strategies, date ranges, and configurations.
 * 
 * Usage:
 *   npx ts-node scripts/generate-weekly-reports-modular.ts \
 *     --strategy-type tenkan-kijun \
 *     --start-date 2025-09-01 \
 *     --end-date 2025-11-30 \
 *     --chain solana
 * 
 *   npx ts-node scripts/generate-weekly-reports-modular.ts \
 *     --strategy-type optimized \
 *     --strategy-name MultiTrade_20pctTrail_50pctDropRebound_24h \
 *     --simulation-timestamp 2025-11-24_17-32-21 \
 *     --start-date 2025-09-01 \
 *     --end-date 2025-11-30 \
 *     --chain solana \
 *     --run-simulations-if-missing
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import * as fs from 'fs';
import * as path from 'path';
// Import the function from generate-strategy-weekly-reports.ts
// We'll need to export it from that file

interface CliOptions {
  strategyType: 'tenkan-kijun' | 'optimized';
  strategyName?: string;
  simulationTimestamp?: string;
  startDate: string;
  endDate: string;
  callers?: string[];
  outputDir?: string;
  runSimulationsIfMissing?: boolean;
  chain?: 'solana' | 'all';
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Partial<CliOptions> = {
    chain: 'solana',
    runSimulationsIfMissing: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--strategy-type':
        if (nextArg === 'tenkan-kijun' || nextArg === 'optimized') {
          options.strategyType = nextArg;
        } else {
          throw new Error(`Invalid strategy type: ${nextArg}. Must be 'tenkan-kijun' or 'optimized'`);
        }
        i++;
        break;
      case '--strategy-name':
        options.strategyName = nextArg;
        i++;
        break;
      case '--simulation-timestamp':
        options.simulationTimestamp = nextArg;
        i++;
        break;
      case '--start-date':
        options.startDate = nextArg;
        i++;
        break;
      case '--end-date':
        options.endDate = nextArg;
        i++;
        break;
      case '--callers':
        options.callers = nextArg.split(',').map(c => c.trim());
        i++;
        break;
      case '--output-dir':
        options.outputDir = nextArg;
        i++;
        break;
      case '--run-simulations-if-missing':
        options.runSimulationsIfMissing = true;
        break;
      case '--chain':
        if (nextArg === 'solana' || nextArg === 'all') {
          options.chain = nextArg;
        } else {
          throw new Error(`Invalid chain: ${nextArg}. Must be 'solana' or 'all'`);
        }
        i++;
        break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  // Validate required options
  if (!options.strategyType) {
    throw new Error('--strategy-type is required');
  }
  if (!options.startDate) {
    throw new Error('--start-date is required');
  }
  if (!options.endDate) {
    throw new Error('--end-date is required');
  }
  if (options.strategyType === 'optimized') {
    if (!options.strategyName) {
      throw new Error('--strategy-name is required for optimized strategies');
    }
    if (!options.simulationTimestamp) {
      throw new Error('--simulation-timestamp is required for optimized strategies');
    }
  }

  return options as CliOptions;
}

async function main() {
  try {
    const options = parseArgs();
    
    console.log('📊 Modular Weekly Report Generator\n');
    console.log('Options:');
    console.log(`  Strategy Type: ${options.strategyType}`);
    if (options.strategyName) {
      console.log(`  Strategy Name: ${options.strategyName}`);
    }
    if (options.simulationTimestamp) {
      console.log(`  Simulation Timestamp: ${options.simulationTimestamp}`);
    }
    console.log(`  Start Date: ${options.startDate}`);
    console.log(`  End Date: ${options.endDate}`);
    console.log(`  Chain: ${options.chain}`);
    if (options.callers) {
      console.log(`  Callers: ${options.callers.join(', ')}`);
    }
    if (options.outputDir) {
      console.log(`  Output Directory: ${options.outputDir}`);
    }
    console.log(`  Run Simulations If Missing: ${options.runSimulationsIfMissing}\n`);

    // Import and call the main function from generate-strategy-weekly-reports.ts
    // We'll need to refactor that script to export a function that accepts options
    // For now, we'll call it directly with environment variables
    
    process.env.REPORT_STRATEGY_TYPE = options.strategyType;
    if (options.strategyName) {
      process.env.REPORT_STRATEGY_NAME = options.strategyName;
    }
    if (options.simulationTimestamp) {
      process.env.REPORT_SIMULATION_TIMESTAMP = options.simulationTimestamp;
    }
    process.env.REPORT_START_DATE = options.startDate;
    process.env.REPORT_END_DATE = options.endDate;
    process.env.REPORT_CHAIN = options.chain || 'solana';
    if (options.callers) {
      process.env.REPORT_CALLERS = options.callers.join(',');
    }
    if (options.outputDir) {
      process.env.REPORT_OUTPUT_DIR = options.outputDir;
    }
    if (options.runSimulationsIfMissing) {
      process.env.REPORT_RUN_SIMULATIONS_IF_MISSING = 'true';
    }

    // Import and call the function dynamically
    const { generateStrategyWeeklyReports } = await import('./generate-strategy-weekly-reports');
    await generateStrategyWeeklyReports(options);
    
    console.log('\n✨ Report generation completed successfully!');
  } catch (error: any) {
    console.error('\n❌ Error generating reports:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

