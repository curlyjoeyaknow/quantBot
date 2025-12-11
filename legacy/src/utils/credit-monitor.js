"use strict";
/**
 * Credit Usage Monitor
 * ====================
 * Tracks API credit usage for monitoring and alerting
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditMonitor = void 0;
const logger_1 = require("./logger");
class CreditMonitor {
    constructor() {
        this.usage = new Map();
        this.alertThreshold = 0.8; // Alert at 80% usage
    }
    /**
     * Record credit usage
     */
    recordUsage(provider, creditsUsed, requestsCount = 1) {
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
                logger_1.logger.warn('Credit usage approaching limit', {
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
    setLimit(provider, limit, resetInterval) {
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
    getUsage(provider) {
        return this.usage.get(provider);
    }
    /**
     * Get all credit usage
     */
    getAllUsage() {
        return Array.from(this.usage.values());
    }
    /**
     * Reset credit usage (for daily/monthly resets)
     */
    resetUsage(provider) {
        const current = this.usage.get(provider);
        if (current) {
            current.creditsUsed = 0;
            current.requestsCount = 0;
            current.lastReset = new Date();
            this.usage.set(provider, current);
            logger_1.logger.info('Reset credit usage', { provider });
        }
    }
    /**
     * Check if provider has credits available
     */
    hasCredits(provider, required = 1) {
        const current = this.usage.get(provider);
        if (!current || !current.creditsLimit) {
            return true; // No limit set, assume available
        }
        return current.creditsUsed + required <= current.creditsLimit;
    }
    /**
     * Get usage report
     */
    getReport() {
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
exports.creditMonitor = new CreditMonitor();
//# sourceMappingURL=credit-monitor.js.map