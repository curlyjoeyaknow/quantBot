import type { CommandContext } from '../../core/command-context.js';
import { statusSchema, type StatusApiClientsArgs } from '../../command-defs/api-clients.js';

export async function statusApiClientsHandler(
  args: StatusApiClientsArgs,
  _ctx: CommandContext
): Promise<Record<string, unknown>> {
  const status: Record<string, unknown> = {};
  if (args.service === 'all' || !args.service || args.service === 'birdeye') {
    status.birdeye = { status: 'operational' };
  }
  if (args.service === 'all' || !args.service || args.service === 'helius') {
    status.helius = { status: 'operational' };
  }
  return status;
}
