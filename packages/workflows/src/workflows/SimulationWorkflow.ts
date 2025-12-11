/**
 * Simulation Workflow
 * ===================
 * Reusable workflow for running simulations with various strategies and parameters
 */

import { ScriptExecutor, createQueryMiddleware, createProcessMiddleware, createStoreMiddleware } from '../middleware';
import { Pool } from 'pg';
import { simulateStrategy } from '@quantbot/simulation';
import { fetchHybridCandles } from '@quantbot/simulation';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Strategy, StopLossConfig, EntryConfig, ReEntryConfig, Costs } from '@quantbot/core';

export interface SimulationWorkflowConfig {
  // Query parameters
  queryType: 'alerts' | 'calls' | 'custom';
  customQuery?: string;
  queryParams?: any[];
  
  // Strategy configuration
  strategy: Strategy;
  stopLoss?: StopLossConfig;
  entry?: EntryConfig;
  reEntry?: ReEntryConfig;
  costs?: Costs;
  
  // Filtering
  callerNames?: string[];
  chains?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
  
  // OHLCV parameters
  preWindowMinutes?: number;
  postWindowMinutes?: number;
  
  // Rate limiting
  rateLimitMs?: number;
  
  // Database
  pgPool: Pool;
  resultsTable?: string; // Table to store results
}

/**
 * Create simulation workflow executor
 */
export function createSimulationWorkflow(config: SimulationWorkflowConfig): ScriptExecutor {
  const executor = new ScriptExecutor({
    name: 'simulation',
    description: 'Run simulations on alerts/calls',
    rateLimitMs: config.rateLimitMs || 100,
    continueOnError: true,
    progressInterval: 10,
  });

  // Build query
  let query = '';
  let queryParams: any[] = [];

  if (config.queryType === 'alerts') {
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
      WHERE a.alert_price IS NOT NULL
      AND a.alert_price > 0
      ${config.chains ? `AND t.chain = ANY($1)` : ''}
      ${config.from ? `AND a.alert_timestamp >= $${config.chains ? 2 : 1}` : ''}
      ${config.callerNames ? `AND c.handle = ANY($${config.chains ? (config.from ? 3 : 2) : (config.from ? 2 : 1)})` : ''}
      ORDER BY a.alert_timestamp DESC
      ${config.limit ? `LIMIT ${config.limit}` : ''}
    `;
    const params: any[] = [];
    if (config.chains) params.push(config.chains);
    if (config.from) params.push(config.from);
    if (config.callerNames) params.push(config.callerNames);
    queryParams = params;
  } else if (config.queryType === 'custom' && config.customQuery) {
    query = config.customQuery;
    queryParams = config.queryParams || [];
  } else {
    throw new Error(`Invalid queryType: ${config.queryType}`);
  }

  // Query middleware
  executor.use(
    createQueryMiddleware({
      type: 'postgres',
      query,
      params: queryParams,
      pool: config.pgPool,
    })
  );

  // Process middleware - Run simulation for each alert
  executor.use(
    createProcessMiddleware({
      processor: async (alert: any, index: number, total: number) => {
        const alertTime = DateTime.fromJSDate(new Date(alert.alert_timestamp));
        const preWindow = config.preWindowMinutes || 260; // 52 * 5m periods
        const postWindow = config.postWindowMinutes || 10080; // 7 days
        
        const startTime = alertTime.minus({ minutes: preWindow });
        const endTime = alertTime.plus({ minutes: postWindow });

        logger.debug(`Running simulation for alert ${alert.id}`, {
          index: index + 1,
          total,
          token: alert.token_address.substring(0, 8),
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

        // Run simulation
        const result = simulateStrategy(
          candles,
          config.strategy,
          config.stopLoss || { initial: -0.2, trailing: 'none' },
          config.entry || { initialEntry: 0.0, trailingEntry: 'none', maxWaitTime: 0 },
          config.reEntry,
          config.costs || {
            entrySlippageBps: 300,
            exitSlippageBps: 300,
            takerFeeBps: 50,
            borrowAprBps: 0,
          }
        );

        const finalPrice = result.finalPrice;
        const maxPrice = Math.max(...candles.map(c => c.high));
        const pnl = (finalPrice / alert.alert_price) - 1;
        const holdDurationMinutes = result.events.length > 0
          ? Math.floor((result.events[result.events.length - 1].timestamp - result.events[0].timestamp) / 60)
          : 0;

        return {
          alert_id: alert.id,
          token_address: alert.token_address,
          chain: alert.chain,
          caller_name: alert.caller_name,
          alert_timestamp: alertTime.toJSDate(),
          entry_price: alert.alert_price,
          exit_price: finalPrice,
          pnl,
          max_reached: maxPrice,
          hold_duration_minutes: holdDurationMinutes,
          simulation_result: result,
        };
      },
      rateLimitMs: config.rateLimitMs || 100,
      continueOnError: true,
      progressInterval: 10,
    })
  );

  // Store middleware - Store simulation results
  if (config.resultsTable) {
    executor.use(
      createStoreMiddleware({
        storer: async (result: any) => {
          await config.pgPool.query(
            `
            INSERT INTO ${config.resultsTable} (
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
              result.alert_id,
              result.token_address,
              result.chain,
              result.caller_name,
              result.alert_timestamp,
              result.entry_price,
              result.exit_price,
              result.pnl,
              result.max_reached,
              result.hold_duration_minutes,
            ]
          );
        },
        continueOnError: true,
      })
    );
  }

  return executor;
}

