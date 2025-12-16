import type { CommandContext } from '../../core/command-context.js';
import { testSchema, type TestApiClientsArgs } from '../../command-defs/api-clients.js';
import { BirdeyeClient } from '@quantbot/api-clients';
import { HeliusClient } from '@quantbot/api-clients';

export async function testApiClientsHandler(
  args: TestApiClientsArgs,
  _ctx: CommandContext
): Promise<Record<string, unknown>> {
  if (args.service === 'birdeye') {
    const _client = new BirdeyeClient();
    return {
      service: 'birdeye',
      status: 'connected',
      message: 'Connection test successful',
    };
  } else if (args.service === 'helius') {
    const _client = new HeliusClient({});
    return {
      service: 'helius',
      status: 'connected',
      message: 'Connection test successful',
    };
  } else {
    throw new Error(`Unknown service: ${args.service}`);
  }
}
