/**
 * ClickHouse Sink
 * ===============
 * Output simulation results to ClickHouse.
 */

import { DateTime } from 'luxon';
import type { SimulationRunContext } from '@quantbot/simulation/core';
import type { ResultSink, BaseSinkOptions } from '@quantbot/simulation/sinks/base';

/**
 * ClickHouse sink options
 */
export interface ClickHouseSinkOptions extends BaseSinkOptions {
  /** Table name */
  table?: string;
  /** Schema type */
  schema?: 'aggregate' | 'expanded';
  /** Upsert mode */
  upsert?: boolean;
}

/**
 * ClickHouse result sink
 */
export class ClickHouseSink implements ResultSink {
  readonly name = 'clickhouse';
  private readonly table: string;
  private readonly schema: 'aggregate' | 'expanded';
  private readonly upsert: boolean;

  constructor(options: ClickHouseSinkOptions = {}) {
    this.table = options.table ?? 'simulation_results';
    this.schema = options.schema ?? 'aggregate';
    this.upsert = options.upsert ?? false;
  }

  async handle(context: SimulationRunContext): Promise<void> {
    const { getClickHouseClient } = await import('@quantbot/storage');
    const ch = getClickHouseClient();
    const db = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    if (this.schema === 'expanded') {
      await this.insertExpandedEvents(ch, db, context);
    } else {
      await this.insertAggregate(ch, db, context);
    }
  }

  private async insertExpandedEvents(
    ch: any,
    db: string,
    context: SimulationRunContext
  ): Promise<void> {
    const rows = context.result.events.map((event, index) => ({
      simulation_run_id: 0,
      token_address: context.target.mint,
      chain: context.target.chain,
      event_time: DateTime.fromSeconds(event.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
      seq: index,
      event_type: event.type,
      price: event.price,
      size: 1,
      remaining_position: event.remainingPosition,
      pnl_so_far: event.pnlSoFar,
      indicators_json: '{}',
      position_state_json: '{}',
      metadata_json: JSON.stringify({ scenario: context.scenario.name }),
    }));

    if (!rows.length) return;

    await ch.insert({
      table: `${db}.simulation_events`,
      values: rows,
      format: 'JSONEachRow',
    });
  }

  private async insertAggregate(ch: any, db: string, context: SimulationRunContext): Promise<void> {
    const finalEvent = context.result.events[context.result.events.length - 1];

    const row = {
      simulation_run_id: 0,
      token_address: context.target.mint,
      chain: context.target.chain,
      final_pnl: context.result.finalPnl,
      max_drawdown: null,
      volatility: null,
      sharpe_ratio: null,
      sortino_ratio: null,
      win_rate: null,
      trade_count: context.result.events.filter(
        (e) => e.type === 'entry' || e.type === 'trailing_entry_triggered' || e.type === 're_entry'
      ).length,
      reentry_count: context.result.events.filter((e) => e.type === 're_entry').length,
      ladder_entries_used: context.result.events.filter((e) => e.type === 'ladder_entry').length,
      ladder_exits_used: context.result.events.filter((e) => e.type === 'ladder_exit').length,
      created_at: finalEvent
        ? DateTime.fromSeconds(finalEvent.timestamp).toFormat('yyyy-MM-dd HH:mm:ss')
        : DateTime.utc().toFormat('yyyy-MM-dd HH:mm:ss'),
    };

    await ch.insert({
      table: `${db}.simulation_aggregates`,
      values: [row],
      format: 'JSONEachRow',
    });
  }
}
