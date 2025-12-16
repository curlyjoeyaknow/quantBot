import type { CommandContext } from '../../core/command-context.js';
import { creditsSchema, type CreditsApiClientsArgs } from '../../command-defs/api-clients.js';
import { checkApiQuotas, type ApiQuotas } from '@quantbot/observability';

export async function creditsApiClientsHandler(
  args: CreditsApiClientsArgs,
  _ctx: CommandContext
): Promise<ApiQuotas | Record<string, unknown>> {
  const quotas = await checkApiQuotas();

  if (args.service === 'all' || !args.service) {
    return quotas;
  } else {
    return { [args.service]: quotas[args.service as keyof typeof quotas] };
  }
}
