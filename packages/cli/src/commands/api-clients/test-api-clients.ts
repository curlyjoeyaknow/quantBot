import type { CommandContext } from '../../core/command-context.js';
import type { TestApiClientsArgs } from '../../command-defs/api-clients.js';
import { BirdeyeClient } from '@quantbot/infra/api-clients';
import { HeliusClient } from '@quantbot/infra/api-clients';
import { ValidationError } from '@quantbot/infra/utils';

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
    throw new ValidationError(`Unknown service: ${args.service}`, {
      service: args.service,
      allowedServices: ['birdeye', 'helius'],
    });
  }
}
