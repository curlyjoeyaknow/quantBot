#!/usr/bin/env ts-node
/**
 * Simulation Engine Runner
 *
 * Runs simulations from a configuration file using the workflows package.
 * This replaces the old orchestrator-based approach.
 *
 * Usage:
 *   ts-node scripts/simulation/run-engine.ts --config path/to/config.json [options]
 */
import { config } from 'dotenv';
// Override existing env vars to ensure .env file takes precedence
config({ override: true });

import path from 'path';
import { promises as fs } from 'fs';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import type { SimulationRunSpec } from '@quantbot/workflows';
import { parseSimulationConfig } from '@quantbot/backtest';
import type { SimulationEngineConfig } from '@quantbot/backtest';
import { logger } from '@quantbot/utils';

interface CliOptions {
  configPath: string;
  maxConcurrency?: number;
  dryRun?: boolean;
  failFast?: boolean;
  preWindowMinutes?: number;
  postWindowMinutes?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {};

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];

    // Handle --key=value format
    if (arg.includes('=')) {
      const [key, value] = arg.split('=', 2);
      arg = key;

      switch (key) {
        case '--config':
        case '-c':
          options.configPath = value;
          continue;
        case '--max-concurrency':
        case '-j':
          options.maxConcurrency = Number(value);
          continue;
        case '--pre-window':
          options.preWindowMinutes = Number(value);
          continue;
        case '--post-window':
          options.postWindowMinutes = Number(value);
          continue;
        default:
          throw new Error(`Unknown flag ${key}`);
      }
    }

    // Handle --key value format
    if (!arg.startsWith('--') && !arg.startsWith('-')) continue;
    const next = argv[i + 1];

    switch (arg) {
      case '--config':
      case '-c':
        if (!next) throw new Error('--config requires a file path');
        options.configPath = next;
        i++;
        break;
      case '--max-concurrency':
      case '-j':
        if (!next) throw new Error('--max-concurrency requires a number');
        options.maxConcurrency = Number(next);
        i++;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--fail-fast':
        options.failFast = true;
        break;
      case '--no-fail-fast':
        options.failFast = false;
        break;
      case '--pre-window':
        if (!next) throw new Error('--pre-window requires a number');
        options.preWindowMinutes = Number(next);
        i++;
        break;
      case '--post-window':
        if (!next) throw new Error('--post-window requires a number');
        options.postWindowMinutes = Number(next);
        i++;
        break;
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }

  if (!options.configPath) {
    throw new Error('Missing required --config path');
  }

  return options as CliOptions;
}

async function loadConfigFromFile(configPath: string): Promise<SimulationEngineConfig> {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);
  const content = await fs.readFile(absolutePath, 'utf-8');
  try {
    const raw = JSON.parse(content);
    return parseSimulationConfig(raw);
  } catch (error) {
    throw new Error(`Failed to parse config ${configPath}: ${(error as Error).message}`);
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const config = await loadConfigFromFile(cli.configPath);

  // Create production context
  const ctx = createProductionContext();

  // Extract scenarios from config and run each one
  const scenarios = config.scenarios || [];
  if (scenarios.length === 0) {
    throw new Error('No scenarios found in config file');
  }

  logger.info(`Running ${scenarios.length} scenario(s) from config`);

  const results = [];

  for (const scenario of scenarios) {
    // Extract strategy name from scenario
    const strategyName = scenario.name || scenario.id || 'Unknown';

    // Extract date range from scenario targets or use defaults
    let fromDate: DateTime;
    let toDate: DateTime;

    if (scenario.targets && scenario.targets.length > 0) {
      // Use first target's dates as reference
      const firstTarget = scenario.targets[0];
      fromDate = firstTarget.startTime;
      toDate = firstTarget.endTime;
    } else {
      // Use defaults (last 30 days)
      toDate = DateTime.utc();
      fromDate = toDate.minus({ days: 30 });
    }

    // Build simulation spec
    const spec: SimulationRunSpec = {
      strategyName,
      callerName: scenario.callerName,
      from: fromDate,
      to: toDate,
      options: {
        dryRun: cli.dryRun ?? false,
        preWindowMinutes: cli.preWindowMinutes ?? scenario.preWindowMinutes ?? 60,
        postWindowMinutes: cli.postWindowMinutes ?? scenario.postWindowMinutes ?? 1440,
      },
    };

    try {
      logger.info(`Running simulation: ${strategyName}`, {
        from: fromDate.toISO(),
        to: toDate.toISO(),
        callerName: spec.callerName,
      });

      const result = await runSimulation(spec, ctx);
      results.push({ scenario: strategyName, result });

      console.log(`\n✅ ${strategyName}:`);
      console.log(`   Calls found: ${result.totals.callsFound}`);
      console.log(`   Calls succeeded: ${result.totals.callsSucceeded}`);
      console.log(`   Calls failed: ${result.totals.callsFailed}`);
      if (result.pnl.mean !== undefined) {
        console.log(`   Mean PnL: ${(result.pnl.mean * 100).toFixed(2)}%`);
        if (result.pnl.median !== undefined) {
          console.log(`   Median PnL: ${(result.pnl.median * 100).toFixed(2)}%`);
        }
      }
    } catch (error) {
      logger.error(`Simulation failed for ${strategyName}`, error as Error);
      console.error(`\n❌ ${strategyName} failed:`, (error as Error).message);
      results.push({ scenario: strategyName, error: (error as Error).message });
    }
  }

  console.log('\n=== Simulation Summary ===');
  for (const { scenario, result, error } of results) {
    if (error) {
      console.log(`❌ ${scenario}: ${error}`);
    } else if (result) {
      const successRate =
        result.totals.callsFound > 0
          ? ((result.totals.callsSucceeded / result.totals.callsFound) * 100).toFixed(1)
          : '0.0';
      console.log(
        `✅ ${scenario}: ${result.totals.callsSucceeded}/${result.totals.callsFound} succeeded (${successRate}%)`
      );
    }
  }
}

main().catch((error) => {
  console.error('Simulation engine failed:', error);
  process.exitCode = 1;
});
