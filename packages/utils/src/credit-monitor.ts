/**
 * Credit Usage Monitor
 * ====================
 * Tracks API credit usage for monitoring and alerting
 */

import { logger } from './logger';

export interface CreditUsage {
  provider: string;
  creditsUsed: number;
  creditsLimit?: number;
  requestsCount: number;
  lastReset?: Date;
  resetInterval?: 'daily' | 'monthly' | 'never';
}

class CreditMonitor {
  private usage: Map<string, CreditUsage> = new Map();
  private alertThreshold: number = 0.8; // Alert at 80% usage

  /**
   * Record credit usage
   */
  recordUsage(provider: string, creditsUsed: number, requestsCount: number = 1): void {
    const current = this.usage.get(provider) || {
      provider,
      creditsUsed: 0,
      requestsCount: 0,
    };

    current.creditsUsed += creditsUsed;
    current.requestsCount += requestsCount;
    current.lastReset = current.lastReset || new Date();

    this.usage.set(provider, current);

    // Check if we need to alert
    if (current.creditsLimit) {
      const usagePercent = current.creditsUsed / current.creditsLimit;
      if (usagePercent >= this.alertThreshold) {
        logger.warn('Credit usage approaching limit', {
          provider,
          creditsUsed: current.creditsUsed,
          creditsLimit: current.creditsLimit,
          usagePercent: (usagePercent * 100).toFixed(2) + '%',
        });
      }
    }
  }

  /**
   * Set credit limit for a provider
   */
  setLimit(provider: string, limit: number, resetInterval?: 'daily' | 'monthly' | 'never'): void {
    const current = this.usage.get(provider) || {
      provider,
      creditsUsed: 0,
      requestsCount: 0,
    };

    current.creditsLimit = limit;
    current.resetInterval = resetInterval;
    this.usage.set(provider, current);
  }

  /**
   * Get credit usage for a provider
   */
  getUsage(provider: string): CreditUsage | undefined {
    return this.usage.get(provider);
  }

  /**
   * Get all credit usage
   */
  getAllUsage(): CreditUsage[] {
    return Array.from(this.usage.values());
  }

  /**
   * Reset credit usage (for daily/monthly resets)
   */
  resetUsage(provider: string): void {
    const current = this.usage.get(provider);
    if (current) {
      current.creditsUsed = 0;
      current.requestsCount = 0;
      current.lastReset = new Date();
      this.usage.set(provider, current);
      logger.info('Reset credit usage', { provider });
    }
  }

  /**
   * Check if provider has credits available
   */
  hasCredits(provider: string, required: number = 1): boolean {
    const current = this.usage.get(provider);
    if (!current || !current.creditsLimit) {
      return true; // No limit set, assume available
    }

    return current.creditsUsed + required <= current.creditsLimit;
  }

  /**
   * Get usage report
   */
  getReport(): {
    providers: CreditUsage[];
    totalCreditsUsed: number;
    totalRequests: number;
  } {
    const providers = Array.from(this.usage.values());
    const totalCreditsUsed = providers.reduce((sum, p) => sum + p.creditsUsed, 0);
    const totalRequests = providers.reduce((sum, p) => sum + p.requestsCount, 0);

    return {
      providers,
      totalCreditsUsed,
      totalRequests,
    };
  }
}

export const creditMonitor = new CreditMonitor();
