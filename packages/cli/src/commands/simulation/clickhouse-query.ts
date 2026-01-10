/**
 * Handler for simulation clickhouse-query command
 *
 * Queries ClickHouse using ClickHouseService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { type ClickHouseQueryArgs } from '../../command-defs/simulation.js';
import { ValidationError } from '@quantbot/utils';

export async function clickHouseQueryHandler(args: ClickHouseQueryArgs, ctx: CommandContext) {
  const service = ctx.services.clickHouse();

  if (args.operation === 'query_ohlcv') {
    if (!args.tokenAddress || !args.chain || !args.startTime || !args.endTime) {
      throw new ValidationError(
        'tokenAddress, chain, startTime, and endTime are required for query_ohlcv',
        {
          operation: 'query_ohlcv',
          provided: {
            tokenAddress: !!args.tokenAddress,
            chain: !!args.chain,
            startTime: !!args.startTime,
            endTime: !!args.endTime,
          },
        }
      );
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
      throw new ValidationError('runId and events are required for store_events', {
        operation: 'store_events',
        provided: {
          runId: !!args.runId,
          events: !!args.events,
        },
      });
    }
    return await service.storeEvents(args.runId, args.events);
  } else if (args.operation === 'aggregate_metrics') {
    if (!args.runId) {
      throw new ValidationError('runId is required for aggregate_metrics', {
        operation: 'aggregate_metrics',
        provided: { runId: !!args.runId },
      });
    }
    return await service.aggregateMetrics(args.runId);
  } else {
    throw new ValidationError(`Unknown operation: ${args.operation}`, {
      operation: args.operation,
      allowedOperations: ['query_ohlcv', 'store_events', 'aggregate_metrics'],
    });
  }
}
