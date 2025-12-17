/**
 * Handler for simulation clickhouse-query command
 *
 * Queries ClickHouse using ClickHouseService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { clickHouseQuerySchema, type ClickHouseQueryArgs } from '../../command-defs/simulation.js';

export async function clickHouseQueryHandler(args: ClickHouseQueryArgs, ctx: CommandContext) {
  const service = ctx.services.clickHouse();

  if (args.operation === 'query_ohlcv') {
    if (!args.tokenAddress || !args.chain || !args.startTime || !args.endTime) {
      throw new Error('tokenAddress, chain, startTime, and endTime are required for query_ohlcv');
    }
    return await service.queryOHLCV(
      args.tokenAddress,
      args.chain,
      args.startTime,
      args.endTime,
      args.interval || '5m'
    );
  } else if (args.operation === 'store_events') {
    if (!args.runId || !args.events) {
      throw new Error('runId and events are required for store_events');
    }
    return await service.storeEvents(args.runId, args.events);
  } else if (args.operation === 'aggregate_metrics') {
    if (!args.runId) {
      throw new Error('runId is required for aggregate_metrics');
    }
    return await service.aggregateMetrics(args.runId);
  } else {
    throw new Error(`Unknown operation: ${args.operation}`);
  }
}

