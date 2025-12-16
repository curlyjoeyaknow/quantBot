import type { CommandContext } from '../../core/command-context.js';
import { type QuotasObservabilityArgs } from '../../command-defs/observability.js';
import { checkApiQuotas, type ApiQuotas } from '@quantbot/observability';

export async function quotasObservabilityHandler(
  args: QuotasObservabilityArgs,
  _ctx: CommandContext
): Promise<ApiQuotas | Record<string, unknown>> {
  const quotas = await checkApiQuotas();

  if (args.service && args.service !== 'all') {
    return { [args.service]: quotas[args.service as keyof typeof quotas] };
  }
  return quotas;
}
