/**
 * SimulationEventsRepository - ClickHouse repository for simulation events and aggregates
 *
 * Handles all database operations for simulation_events and simulation_aggregates tables.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client.js';
import { getClickHouseDatabaseName, logger } from '@quantbot/utils';
import type { SimulationEvent, SimulationAggregate } from '@quantbot/core';

export class SimulationEventsRepository {
  /**
   * Insert simulation events for a run
   * CRITICAL: Preserves full token address and exact case
   */
  async insertEvents(
    runId: number,
    tokenAddress: string,
    chain: string,
    events: SimulationEvent[]
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const ch = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    const rows = events.map((event, index) => ({
      simulation_run_id: runId,
      token_address: tokenAddress, // Full address, case-preserved
      chain: chain,
      event_time: DateTime.fromSeconds(event.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
      seq: index + 1,
      event_type: event.type,
      price: event.price,
      size: 0, // Size not in event, may need to add
      remaining_position: event.remainingPosition,
      pnl_so_far: event.pnlSoFar,
      indicators_json: event.indicators ? JSON.stringify(event.indicators) : '',
      position_state_json: event.positionState ? JSON.stringify(event.positionState) : '',
      metadata_json: event.metadata ? JSON.stringify(event.metadata) : '',
    }));

    try {
      await ch.insert({
        table: `${database}.simulation_events`,
        values: rows,
        format: 'JSONEachRow',
      });

      logger.debug('Inserted simulation events', { runId, count: events.length });
    } catch (error: unknown) {
      logger.error('Error inserting simulation events', error as Error, { runId });
      throw error;
    }
  }

  /**
   * Insert simulation aggregates for a run
   */
  async insertAggregates(runId: number, aggregates: SimulationAggregate): Promise<void> {
    const ch = getClickHouseClient();
    const database = getClickHouseDatabaseName();

    const row = {
      simulation_run_id: runId,
      token_address: aggregates.tokenAddress,
      chain: aggregates.chain,
      final_pnl: aggregates.finalPnl,
      max_drawdown: aggregates.maxDrawdown,
      volatility: aggregates.volatility,
      sharpe_ratio: aggregates.sharpeRatio,
      sortino_ratio: aggregates.sortinoRatio,
      win_rate: aggregates.winRate,
      trade_count: aggregates.tradeCount,
      reentry_count: aggregates.reentryCount,
      ladder_entries_used: aggregates.ladderEntriesUsed,
      ladder_exits_used: aggregates.ladderExitsUsed,
      created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
    };

    try {
      await ch.insert({
        table: `${database}.simulation_aggregates`,
        values: [row],
        format: 'JSONEachRow',
      });

      logger.debug('Inserted simulation aggregates', { runId });
    } catch (error: unknown) {
      logger.error('Error inserting simulation aggregates', error as Error, { runId });
      throw error;
    }
  }
}
