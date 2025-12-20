/**
 * API Quota Monitoring
 * ====================
 * Tracks API usage and quotas for external services (Birdeye, Helius, etc.)
 */

import { logger } from '@quantbot/utils';
// TODO: ApiQuotaRepository needs to be implemented in storage package
// import { ApiQuotaRepository } from '@quantbot/storage';

export interface QuotaStatus {
  service: string;
  limit: number;
  used: number;
  remaining: number;
  resetAt: Date;
  warningThreshold: number; // Percentage at which to warn (e.g., 0.2 = 20%)
}

export interface ApiQuotas {
  birdeye: QuotaStatus;
  helius: QuotaStatus;
}

// TODO: ApiQuotaRepository needs to be implemented in storage package
// Singleton repository instance
// let quotaRepository: ApiQuotaRepository | null = null;

// function getQuotaRepository(): ApiQuotaRepository {
//   if (!quotaRepository) {
//     quotaRepository = new ApiQuotaRepository();
//   }
//   return quotaRepository;
// }

/**
 * Check API quotas
 */
export async function checkApiQuotas(): Promise<ApiQuotas> {
  // TODO: Implement ApiQuotaRepository in storage package
  // const repo = getQuotaRepository();

  // Get limits from environment variables
  const birdeyeLimit = parseInt(process.env.BIRDEYE_QUOTA_LIMIT || '100000', 10);
  const heliusLimit = parseInt(process.env.HELIUS_QUOTA_LIMIT || '5000000', 10);

  // Return default statuses until repository is implemented
  const now = new Date();
  const resetAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

  return {
    birdeye: {
      service: 'birdeye',
      limit: birdeyeLimit,
      used: 0,
      remaining: birdeyeLimit,
      resetAt,
      warningThreshold: 0.2,
    },
    helius: {
      service: 'helius',
      limit: heliusLimit,
      used: 0,
      remaining: heliusLimit,
      resetAt,
      warningThreshold: 0.2,
    },
  };
}

/**
 * Record API usage (call this after each API request)
 */
export async function recordApiUsage(
  service: string,
  credits: number,
  _metadata?: Record<string, unknown>
): Promise<void> {
  // TODO: Implement ApiQuotaRepository in storage package
  // const repo = getQuotaRepository();
  // await repo.recordUsage(service, credits, metadata);
  logger.debug('API usage recorded', { service, credits });
}

/**
 * Check if API quota is available
 */
export async function hasQuotaAvailable(service: string, required: number): Promise<boolean> {
  const quotas = await checkApiQuotas();
  const quota = service === 'birdeye' ? quotas.birdeye : quotas.helius;
  return quota.remaining >= required;
}
