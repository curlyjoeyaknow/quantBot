#!/usr/bin/env ts-node
/**
 * Simulation Script
 *
 * Runs trading simulations on alerts or calls using specified strategies.
 *
 * Usage:
 *   ts-node scripts/workflows/run-simulation.ts --strategy PT2_SL25 --caller Brook --from 2024-01-01
 */

import 'dotenv/config';
import { program } from 'commander';
import { Pool } from 'pg';
import {
  simulateStrategy,
  fetchHybridCandles,
  enrichSimulationResultWithPeriodMetrics,
} from '@quantbot/simulation';
import { logger } from '@quantbot/utils';
import { DateTime } from 'luxon';
import type {
  Strategy,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '@quantbot/core';
import type { PeriodMetricsConfig } from '@quantbot/simulation';

// Utility to safely parse ints with fallback
function safeParseInt(value: any, fallback: number) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
// Utility to safely parse floats with fallback
function safeParseFloat(value: any, fallback: number) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: safeParseInt(process.env.POSTGRES_PORT, 5432),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

// Strategy presets
const STRATEGY_PRESETS: Record<string, Strategy[]> = {
  PT2_SL25: [
    { percent: 0.5, target: 2.0 },
    { percent: 0.3, target: 3.0 },
    { percent: 0.2, target: 5.0 },
  ],
  PT3_SL20: [
    { percent: 0.4, target: 3.0 },
    { percent: 0.3, target: 5.0 },
    { percent: 0.3, target: 10.0 },
  ],
  SIMPLE_2X: [{ percent: 1.0, target: 2.0 }],
};

async function ensureResultsTable(pgPool: Pool, table: string) {
  const schema = `
    CREATE TABLE IF NOT EXISTS ${table} (
      alert_id INTEGER PRIMARY KEY,
      token_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      caller_name TEXT,
      alert_timestamp TIMESTAMP NOT NULL,
      entry_price NUMERIC NOT NULL,
      exit_price NUMERIC NOT NULL,
      pnl NUMERIC NOT NULL,
      max_reached NUMERIC NOT NULL,
      hold_duration_minutes INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await pgPool.query(schema);
}

program
  .name('run-simulation')
  .description('Run trading simulations on alerts or calls')
  .requiredOption('--strategy <name>', 'Strategy name (PT2_SL25, PT3_SL20, SIMPLE_2X, or JSON)')
  .option('--query-type <type>', 'Query type: alerts, calls', 'alerts')
  .option('--caller <names...>', 'Caller names (space-separated)')
  .option('--chain <chains...>', 'Chains (space-separated)', ['solana'])
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--limit <n>', 'Limit number of alerts', '1000')
  .option('--pre-window-minutes <n>', 'Minutes before alert to fetch', '260')
  .option('--post-window-minutes <n>', 'Minutes after alert to fetch', '10080')
  .option('--stop-loss <percent>', 'Stop loss percentage (e.g., 0.2 for 20%)', '0.2')
  .option('--results-table <name>', 'Table to store results', 'simulation_results')
  .option('--rate-limit-ms <n>', 'Rate limit in milliseconds', '100')
  .option('--dry-run', 'Do not write results to DB (for testing)', false)
  .option('--period-metrics', 'Enable period metrics calculation', false)
  .option('--period-days <n>', 'Period analysis days for period metrics', '7')
  .option('--min-drawdown <n>', 'Minimum drawdown percent for re-entry detection', '20')
  .option('--min-recovery <n>', 'Minimum recovery percent for re-entry detection', '10')
  .action(async (options) => {
    try {
      // Parse strategy
      let strategy: Strategy[];
      if (STRATEGY_PRESETS[options.strategy]) {
        strategy = STRATEGY_PRESETS[options.strategy];
      } else if (/^\s*\[/.test(options.strategy)) {
        try {
          strategy = JSON.parse(options.strategy);
        } catch (e) {
          throw new Error(
            `Invalid JSON for strategy: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      } else {
        throw new Error(`Unknown strategy: ${options.strategy}. Use preset name or JSON array.`);
      }

      logger.info('Starting simulation', {
        strategy: options.strategy,
        queryType: options.queryType,
        caller: options.caller,
        dryRun: !!options.dryRun,
        periodMetrics: !!options.periodMetrics,
        periodDays: options.periodMetrics ? safeParseInt(options.periodDays, 7) : undefined,
      });

      // Build query
      let query = '';
      const queryParams: any[] = [];
      let paramIndex = 1;
      if (options.queryType === 'alerts') {
        const conditions: string[] = [];
        conditions.push('a.alert_price IS NOT NULL');
        conditions.push('a.alert_price > 0');

        if (options.chain) {
          conditions.push(`t.chain = ANY($${paramIndex})`);
          queryParams.push(options.chain);
          paramIndex++;
        }
        if (options.from) {
          conditions.push(`a.alert_timestamp >= $${paramIndex}`);
          queryParams.push(options.from);
          paramIndex++;
        }
        if (options.to) {
          conditions.push(`a.alert_timestamp < $${paramIndex}`);
          queryParams.push(options.to);
          paramIndex++;
        }
        if (options.caller) {
          conditions.push(`c.handle = ANY($${paramIndex})`);
          queryParams.push(options.caller);
          paramIndex++;
        }

        query = `
          SELECT 
            a.id,
            a.token_id,
            a.alert_timestamp,
            a.alert_price,
            COALESCE(c.handle, 'unknown') as caller_name,
            t.address as token_address,
            t.chain
          FROM alerts a
          JOIN tokens t ON t.id = a.token_id
          LEFT JOIN callers c ON c.id = a.caller_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY a.alert_timestamp DESC
          ${options.limit ? `LIMIT ${safeParseInt(options.limit, 1000)}` : ''}
        `;
      } else {
        throw new Error(`Invalid queryType: ${options.queryType}. Use 'alerts' or 'calls'`);
      }

      // Query alerts
      const result = await pgPool.query(query, queryParams);
      const alerts = result.rows;
      logger.info(`Found ${alerts.length} alerts to simulate`, { sample: alerts.slice(0, 2) });

      if (!alerts.length) {
        logger.warn('No alerts found for query. Exiting.');
        await pgPool.end();
        process.exit(0);
      }

      // Configuration
      const stopLoss: StopLossConfig = {
        initial: safeParseFloat(options.stopLoss, 0.2),
        trailing: 'none',
      };
      const entry: EntryConfig = {
        initialEntry: 0.0,
        trailingEntry: 'none',
        maxWaitTime: 0,
      };
      const costs: CostConfig = {
        entrySlippageBps: 300,
        exitSlippageBps: 300,
        takerFeeBps: 50,
        borrowAprBps: 0,
      };
      const preWindow = safeParseInt(options.preWindowMinutes, 260);
      const postWindow = safeParseInt(options.postWindowMinutes, 10080);
      const rateLimitMs = safeParseInt(options.rateLimitMs, 100);
      const resultsTable = options.resultsTable || 'simulation_results';
      const dryRun = !!options.dryRun;

      // Period metrics configuration
      const periodMetricsConfig: PeriodMetricsConfig | undefined = options.periodMetrics
        ? {
            enabled: true,
            periodDays: safeParseInt(options.periodDays, 7),
            minDrawdownPercent: safeParseFloat(options.minDrawdown, 20),
            minRecoveryPercent: safeParseFloat(options.minRecovery, 10),
          }
        : undefined;

      // Ensure results table exists
      if (!dryRun) {
        await ensureResultsTable(pgPool, resultsTable);
      } else {
        logger.info('Dry run: skipping table creation');
      }

      let processed = 0,
        success = 0,
        failed = 0;
      const errors: Array<{ alert: number; error: string }> = [];

      for (let i = 0; i < alerts.length; i++) {
        const alert = alerts[i];
        processed++;
        try {
          const alertTime = DateTime.fromISO(
            typeof alert.alert_timestamp === 'string'
              ? alert.alert_timestamp
              : new Date(alert.alert_timestamp).toISOString()
          );
          const startTime = alertTime.minus({ minutes: preWindow });
          const endTime = alertTime.plus({ minutes: postWindow });

          logger.debug(`Simulating alert ${alert.id} (${i + 1}/${alerts.length})`, {
            token: alert.token_address.substring(0, 8),
            chain: alert.chain,
            caller: alert.caller_name,
            alertTime: alertTime.toISO(),
          });

          // Fetch candles
          const candles = await fetchHybridCandles(
            alert.token_address,
            startTime,
            endTime,
            alert.chain || 'solana',
            alertTime
          );

          if (candles.length < 52) {
            throw new Error(`Insufficient candles: ${candles.length}`);
          }

          const simulationCosts = {
            entrySlippageBps: costs.entrySlippageBps ?? 0,
            exitSlippageBps: costs.exitSlippageBps ?? 0,
            takerFeeBps: costs.takerFeeBps ?? 0,
            borrowAprBps: costs.borrowAprBps ?? 0,
          };

          const simResult = await simulateStrategy(
            candles,
            strategy,
            stopLoss,
            entry,
            undefined,
            simulationCosts
          );

          // Calculate period metrics if enabled
          let extendedResult = simResult;
          if (periodMetricsConfig?.enabled) {
            const periodMetrics = enrichSimulationResultWithPeriodMetrics(
              simResult,
              candles,
              periodMetricsConfig
            );
            if (periodMetrics) {
              extendedResult = {
                ...simResult,
                periodMetrics,
              } as typeof simResult & { periodMetrics: typeof periodMetrics };
            }
          }

          const finalPrice = simResult.finalPrice;
          const maxPrice = Math.max(...candles.map((c: any) => c.high));
          const pnl = finalPrice / alert.alert_price - 1;
          const holdDurationMinutes =
            simResult.events.length > 0
              ? Math.floor(
                  (simResult.events[simResult.events.length - 1].timestamp -
                    simResult.events[0].timestamp) /
                    60
                )
              : 0;

          // Log period metrics if available
          if (periodMetricsConfig?.enabled && 'periodMetrics' in extendedResult) {
            const pm = (extendedResult as any).periodMetrics;
            if (pm) {
              logger.debug('Period metrics calculated', {
                alert_id: alert.id,
                periodAthMultiple: pm.periodAthMultiple?.toFixed(2),
                postAthDrawdownPercent: pm.postAthDrawdownPercent?.toFixed(1),
                reEntryOpportunities: pm.reEntryOpportunities?.length || 0,
              });
            }
          }

          if (!dryRun) {
            await pgPool.query(
              `
              INSERT INTO ${resultsTable} (
                alert_id, token_address, chain, caller_name,
                alert_timestamp, entry_price, exit_price, pnl,
                max_reached, hold_duration_minutes
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (alert_id) DO UPDATE SET
                exit_price = EXCLUDED.exit_price,
                pnl = EXCLUDED.pnl,
                max_reached = EXCLUDED.max_reached,
                hold_duration_minutes = EXCLUDED.hold_duration_minutes,
                updated_at = NOW()
              `,
              [
                alert.id,
                alert.token_address,
                alert.chain,
                alert.caller_name,
                alertTime.toJSDate(),
                alert.alert_price,
                finalPrice,
                pnl,
                maxPrice,
                holdDurationMinutes,
              ]
            );
          } else {
            logger.info('Dry run: would save result', {
              alert_id: alert.id,
              pnl,
              finalPrice,
              maxPrice,
              holdDurationMinutes,
            });
          }

          success++;

          // Rate limit but allow ctrl+c to immediately exit
          if (i < alerts.length - 1 && rateLimitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
          }
        } catch (error) {
          failed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({
            alert: alert.id,
            error: errorMsg,
          });
          logger.error(`Failed to simulate alert ${alert.id}: ${errorMsg}`, error as Error);
        }

        // Progress update every 10 items or final
        if ((i + 1) % 10 === 0 || i === alerts.length - 1) {
          logger.info(`Progress: ${i + 1}/${alerts.length} alerts processed`);
        }
      }

      logger.info('Simulation summary', {
        processed,
        success,
        failed,
        completion: `${(((success + failed) / (alerts.length || 1)) * 100).toFixed(1)}%`,
      });

      console.log('\n✅ Simulation complete!');
      console.log(`   Processed: ${processed}`);
      console.log(`   Success: ${success}`);
      console.log(`   Failed: ${failed}`);

      if (errors.length > 0) {
        console.log(`\n⚠️  Errors (showing first 10):`);
        errors.slice(0, 10).forEach((err, i) => {
          console.log(`   ${i + 1}. Alert ${err.alert}: ${err.error.substring(0, 80)}`);
        });
      }

      await pgPool.end();
      process.exit(0);
    } catch (error) {
      logger.error('Simulation failed', error as Error);
      console.error('\n❌ Simulation failed:', (error as Error).message);
      try {
        await pgPool.end();
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
  });

program.parse();
