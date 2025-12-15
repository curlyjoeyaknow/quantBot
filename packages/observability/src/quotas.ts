/**
 * API Quota Monitoring
 * ====================
 * Tracks API usage and quotas for external services (Birdeye, Helius, etc.)
 */

import { logger } from '@quantbot/utils';
import { DateTime } from 'luxon';
import { ApiQuotaRepository } from '@quantbot/storage';

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

// Singleton repository instance
let quotaRepository: ApiQuotaRepository | null = null;

function getQuotaRepository(): ApiQuotaRepository {
  if (!quotaRepository) {
    quotaRepository = new ApiQuotaRepository();
  }
  return quotaRepository;
}

/**
 * Check API quotas
 */
export async function checkApiQuotas(): Promise<ApiQuotas> {
  const repo = getQuotaRepository();

  // Get limits from environment variables
  const birdeyeLimit = parseInt(process.env.BIRDEYE_QUOTA_LIMIT || '100000', 10);
  const heliusLimit = parseInt(process.env.HELIUS_QUOTA_LIMIT || '5000000', 10);

  const [birdeyeStatus, heliusStatus] = await Promise.all([
    repo.getQuotaStatus('birdeye', birdeyeLimit, 0.2),
    repo.getQuotaStatus('helius', heliusLimit, 0.2),
  ]);

  return {
    birdeye: birdeyeStatus,
    helius: heliusStatus,
  };
}

/**
 * Record API usage (call this after each API request)
 */
export async function recordApiUsage(
  service: string,
  credits: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  const repo = getQuotaRepository();
  await repo.recordUsage(service, credits, metadata);
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
