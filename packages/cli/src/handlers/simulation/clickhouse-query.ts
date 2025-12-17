/**
 * Handler for simulation clickhouse-query command
 *
 * Queries ClickHouse using Python service.
 */

import type { CommandContext } from '../../core/command-context.js';
import { clickHouseQuerySchema, type ClickHouseQueryArgs } from '../../command-defs/simulation.js';

export async function clickHouseQueryHandler(
  args: ClickHouseQueryArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const engine = ctx.services.pythonEngine();

  const data: Record<string, unknown> = {};

  if (args.operation === 'query_ohlcv') {
    if (!args.tokenAddress || !args.chain || !args.startTime || !args.endTime) {
      throw new Error('tokenAddress, chain, startTime, and endTime are required for query_ohlcv');
    }
    data.token_address = args.tokenAddress;
    data.chain = args.chain;
    data.start_time = args.startTime;
    data.end_time = args.endTime;
    data.interval = args.interval || '5m';
  } else if (args.operation === 'store_events') {
    if (!args.runId || !args.events) {
      throw new Error('runId and events are required for store_events');
    }
    data.run_id = args.runId;
    data.events = args.events;
  } else if (args.operation === 'aggregate_metrics') {
    if (!args.runId) {
      throw new Error('runId is required for aggregate_metrics');
    }
    data.run_id = args.runId;
  }

  return await engine.runClickHouseEngine(
    {
      operation: args.operation,
      data,
      host: args.host,
      port: args.port,
      database: args.database,
      username: args.username,
      password: args.password,
    },
    {
      env: {
        CLICKHOUSE_HOST: args.host || process.env.CLICKHOUSE_HOST || 'localhost',
        CLICKHOUSE_PORT: args.port?.toString() || process.env.CLICKHOUSE_PORT || '8123',
        CLICKHOUSE_DATABASE: args.database || process.env.CLICKHOUSE_DATABASE || 'quantbot',
        CLICKHOUSE_USERNAME: args.username || process.env.CLICKHOUSE_USERNAME || '',
        CLICKHOUSE_PASSWORD: args.password || process.env.CLICKHOUSE_PASSWORD || '',
      },
    }
  );
}

