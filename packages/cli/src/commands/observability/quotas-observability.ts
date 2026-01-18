import type { CommandContext } from '../../core/command-context.js';
import { type QuotasObservabilityArgs } from '../../command-defs/observability.js';
import { checkApiQuotas, type ApiQuotas } from '@quantbot/infra/observability';

interface QuotaRow {
  service: string;
  used: number;
  limit: number;
  remaining: number;
  percentage: string;
  resetAt: string;
}

export async function quotasObservabilityHandler(
  args: QuotasObservabilityArgs,
  _ctx: CommandContext
): Promise<QuotaRow[] | ApiQuotas | Record<string, unknown>> {
  const quotas = await checkApiQuotas();

  // If format is JSON, return raw object structure
  if (args.format === 'json') {
    if (args.service && args.service !== 'all') {
      return { [args.service]: quotas[args.service as keyof typeof quotas] };
    }
    return quotas;
  }

  // For table/CSV format, transform to array of rows
  const rows: QuotaRow[] = [];

  if (args.service && args.service !== 'all') {
    const service = args.service as keyof ApiQuotas;
    const quota = quotas[service];
    if (quota) {
      const percentage = quota.limit > 0 ? ((quota.used / quota.limit) * 100).toFixed(2) : '0.00';
      rows.push({
        service: quota.service,
        used: quota.used,
        limit: quota.limit,
        remaining: quota.remaining,
        percentage: `${percentage}%`,
        resetAt:
          quota.resetAt instanceof Date ? quota.resetAt.toISOString() : String(quota.resetAt),
      });
    }
  } else {
    // Add all services
    Object.values(quotas).forEach((quota) => {
      const percentage = quota.limit > 0 ? ((quota.used / quota.limit) * 100).toFixed(2) : '0.00';
      rows.push({
        service: quota.service,
        used: quota.used,
        limit: quota.limit,
        remaining: quota.remaining,
        percentage: `${percentage}%`,
        resetAt:
          quota.resetAt instanceof Date ? quota.resetAt.toISOString() : String(quota.resetAt),
      });
    });
  }

  return rows;
}
