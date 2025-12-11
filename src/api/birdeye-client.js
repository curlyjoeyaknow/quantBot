"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.birdeyeClient = exports.BirdeyeClient = void 0;
const dotenv_1 = require("dotenv");
const logger_1 = require("../utils/logger");
(0, dotenv_1.config)();
class BirdeyeClient {
    constructor() {
        this.baseURL = 'https://public-api.birdeye.so';
        this.TOTAL_CREDITS = 3180000; // 3.18M credits
        // Credit costs: 120 credits for 5000 candles, 60 credits for <1000 candles
        this.CREDITS_FOR_5000_CANDLES = 120;
        this.CREDITS_FOR_LESS_THAN_1000 = 60;
        this.totalCreditsUsed = 0; // Running total across all keys
        this.apiKeys = this.loadAPIKeys();
        this.keyUsage = new Map();
        this.currentKeyIndex = 0;
        this.axiosInstances = new Map();
        this.initializeAPIKeys();
    }
    /**
     * Load API keys from environment variables
     */
    loadAPIKeys() {
        const keys = [];
        // First, check for BIRDEYE_API_KEY (without number) as fallback for backward compatibility
        const baseKey = process.env.BIRDEYE_API_KEY;
        if (baseKey && baseKey.trim() !== '') {
            keys.push(baseKey.trim());
        }
        // Load up to 6 keys with numbered suffixes
        for (let i = 1; i <= 6; i++) {
            const key = process.env[`BIRDEYE_API_KEY_${i}`];
            if (key && key.trim() !== '') {
                keys.push(key.trim());
            }
        }
        if (keys.length === 0) {
            throw new Error('No Birdeye API keys found in environment variables');
        }
        logger_1.logger.info('Loaded Birdeye API keys', { keyCount: keys.length, totalCredits: '~3.18M' });
        return keys;
    }
    /**
     * Initialize API key usage tracking
     */
    initializeAPIKeys() {
        this.apiKeys.forEach(key => {
            this.keyUsage.set(key, {
                key,
                requestsUsed: 0,
                lastUsed: new Date(),
                isActive: true,
                estimatedCreditsUsed: 0
            });
            // Create axios instance for each API key (chain will be set per request)
            // Use dynamic import to resolve commonjs interop issues with axios in TypeScript projects
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const axiosInstance = require('axios').create({
                baseURL: this.baseURL,
                timeout: 10000,
                headers: {
                    'X-API-KEY': key,
                    'accept': 'application/json',
                },
                validateStatus: (status) => status < 500, // Don't throw on 4xx errors
            });
            // Store the axios instance in the map
            this.axiosInstances.set(key, axiosInstance);
        });
    }
    /**
     * Get the next available API key using round-robin
     */
    getNextAPIKey() {
        const activeKeys = Array.from(this.keyUsage.values()).filter(usage => usage.isActive);
        if (activeKeys.length === 0) {
            throw new Error('No active API keys available');
        }
        const key = activeKeys[this.currentKeyIndex % activeKeys.length];
        this.currentKeyIndex = (this.currentKeyIndex + 1) % activeKeys.length;
        return key.key;
    }
    /**
     * Update API key usage statistics
     * @param candleCount Number of candles returned in the response (for credit calculation)
     */
    updateKeyUsage(key, candleCount = 0) {
        const usage = this.keyUsage.get(key);
        if (usage) {
            usage.requestsUsed++;
            // Calculate credit cost based on candle count
            // 120 credits for 5000 candles, 60 credits for <1000 candles
            let creditsForThisRequest = 0;
            if (candleCount >= 1000) {
                // For >= 1000 candles, use 5000-candle pricing (120 credits)
                creditsForThisRequest = this.CREDITS_FOR_5000_CANDLES;
            }
            else if (candleCount > 0) {
                // For <1000 candles, use 60 credits
                creditsForThisRequest = this.CREDITS_FOR_LESS_THAN_1000;
            }
            else {
                // Fallback for unknown candle count (assume small request)
                creditsForThisRequest = this.CREDITS_FOR_LESS_THAN_1000;
            }
            usage.estimatedCreditsUsed += creditsForThisRequest;
            this.totalCreditsUsed += creditsForThisRequest; // Update running total
            usage.lastUsed = new Date();
            // Log credit usage every 100 requests or every 1000 credits
            if (usage.requestsUsed % 100 === 0 || this.totalCreditsUsed % 1000 === 0) {
                logger_1.logger.info('Birdeye API credit usage', {
                    keyPrefix: key.substring(0, 8),
                    keyCredits: usage.estimatedCreditsUsed,
                    totalCredits: this.totalCreditsUsed,
                    remainingCredits: this.TOTAL_CREDITS - this.totalCreditsUsed,
                    percentUsed: ((this.totalCreditsUsed / this.TOTAL_CREDITS) * 100).toFixed(2),
                });
            }
        }
    }
    /**
     * Handle API key deactivation on rate limit
     */
    deactivateKey(key) {
        const usage = this.keyUsage.get(key);
        if (usage) {
            usage.isActive = false;
            logger_1.logger.warn('API key deactivated due to rate limit', { keyPrefix: key.substring(0, 8) });
        }
    }
    /**
     * Sleep for specified milliseconds
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Fetch OHLCV data with retry logic and exponential backoff
     */
    async fetchOHLCVData(tokenAddress, startTime, endTime, interval = '1m', chain = 'solana') {
        const maxRetries = 5;
        const baseDelay = 1000; // 1 second
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const apiKey = this.getNextAPIKey();
            const axiosInstance = this.axiosInstances.get(apiKey);
            if (!axiosInstance) {
                logger_1.logger.error('No axios instance found for API key', { keyPrefix: apiKey.substring(0, 8) });
                continue;
            }
            try {
                const startUnix = Math.floor(startTime.getTime() / 1000);
                const endUnix = Math.floor(endTime.getTime() / 1000);
                // Use v3/ohlcv endpoint for better interval support
                // Use params object so axios handles URL encoding properly (important for case-sensitive addresses)
                // Determine chain from address format (0x = ethereum/evm, otherwise solana)
                const detectedChain = tokenAddress.startsWith('0x') ? 'ethereum' : chain;
                logger_1.logger.debug('Fetching OHLCV attempt', { attempt: attempt + 1, maxRetries, tokenAddress: tokenAddress.substring(0, 20), chain: detectedChain, keyPrefix: apiKey.substring(0, 8) });
                const response = await axiosInstance.get('/defi/v3/ohlcv', {
                    headers: {
                        'x-chain': detectedChain,
                    },
                    params: {
                        address: tokenAddress,
                        type: interval,
                        currency: 'usd',
                        time_from: startUnix,
                        time_to: endUnix,
                        ui_amount_mode: 'raw',
                        mode: 'range',
                        padding: true,
                    }
                });
                // Handle 400/404 errors (invalid token addresses)
                if (response.status === 400 || response.status === 404) {
                    throw { response: { status: response.status, data: response.data } };
                }
                if (response.status === 200 && response.data) {
                    // v3/ohlcv returns { data: { items: [...] } } or { success: true, data: { items: [...] } }
                    const responseData = response.data;
                    // Check if response indicates failure
                    if (responseData.success === false) {
                        // API returned success: false
                        return null;
                    }
                    // v3/ohlcv format: { data: { items: [...] } }
                    const items = responseData.data?.items;
                    if (!items) {
                        // No items field - might be different response structure
                        logger_1.logger.debug('No items in response', {
                            tokenAddress: tokenAddress.substring(0, 20),
                            responseKeys: Object.keys(responseData)
                        });
                        return null;
                    }
                    if (Array.isArray(items) && items.length > 0) {
                        // Convert v3 format to history_price format
                        const formattedItems = items.map((item) => ({
                            unixTime: item.unix_time || item.unixTime,
                            open: parseFloat(String(item.o)) || 0,
                            high: parseFloat(String(item.h)) || 0,
                            low: parseFloat(String(item.l)) || 0,
                            close: parseFloat(String(item.c)) || 0,
                            volume: parseFloat(String(item.v)) || 0,
                        }));
                        const candleCount = formattedItems.length;
                        this.updateKeyUsage(apiKey, candleCount);
                        logger_1.logger.debug('Successfully fetched OHLCV records from API', {
                            recordCount: candleCount,
                            tokenAddress: tokenAddress.substring(0, 20),
                            chain: detectedChain
                        });
                        return { items: formattedItems };
                    }
                    else if (Array.isArray(items) && items.length === 0) {
                        // Empty array - token exists but no data
                        logger_1.logger.debug('No candle data available', { tokenAddress: tokenAddress.substring(0, 20) });
                        return null;
                    }
                    else {
                        logger_1.logger.debug('Items is not an array', {
                            tokenAddress: tokenAddress.substring(0, 20),
                            itemsType: typeof items,
                            itemsValue: items
                        });
                        return null;
                    }
                }
                // If we get here, response structure is unexpected
                logger_1.logger.warn('Unexpected response structure', {
                    status: response.status,
                    hasData: !!response.data,
                    dataKeys: response.data ? Object.keys(response.data) : [],
                    tokenAddress: tokenAddress.substring(0, 20)
                });
                throw new Error(`Invalid response: ${response.status}`);
            }
            catch (error) {
                logger_1.logger.warn('OHLCV fetch attempt failed', { attempt: attempt + 1, tokenAddress, error: error.message });
                // Handle different error types
                if (error.response) {
                    const status = error.response.status;
                    if (status === 429) {
                        // Rate limit - deactivate key and try next one
                        this.deactivateKey(apiKey);
                        logger_1.logger.warn('Rate limit hit, switching to next API key', { tokenAddress, attempt: attempt + 1 });
                        // If this was the last attempt, don't wait
                        if (attempt < maxRetries - 1) {
                            await this.sleep(baseDelay);
                        }
                        continue;
                    }
                    else if (status === 400 || status === 401 || status === 403) {
                        // Bad request/auth - don't retry
                        logger_1.logger.error('Bad request/auth error, not retrying', { status, tokenAddress });
                        return null;
                    }
                    else if (status >= 500) {
                        // Server error - retry with backoff
                        logger_1.logger.warn('Server error, retrying with backoff', { status, tokenAddress, attempt: attempt + 1 });
                    }
                }
                // Calculate delay with exponential backoff
                if (attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    logger_1.logger.debug('Waiting before retry', { delayMs: delay, tokenAddress });
                    await this.sleep(delay);
                }
            }
        }
        logger_1.logger.error('Failed to fetch OHLCV data after all attempts', { tokenAddress, maxRetries });
        return null;
    }
    /**
     * Get API key usage statistics
     */
    getAPIKeyUsage() {
        return Array.from(this.keyUsage.values());
    }
    /**
     * Get total requests made across all keys
     */
    getTotalRequests() {
        return Array.from(this.keyUsage.values()).reduce((total, usage) => total + usage.requestsUsed, 0);
    }
    /**
     * Get total credits used across all keys (from running counter)
     */
    getTotalCreditsUsed() {
        return this.totalCreditsUsed;
    }
    /**
     * Get remaining credits estimate
     */
    getRemainingCredits() {
        return this.TOTAL_CREDITS - this.totalCreditsUsed;
    }
    /**
     * Get running credit usage statistics
     */
    getCreditUsageStats() {
        return {
            totalCredits: this.TOTAL_CREDITS,
            creditsUsed: this.totalCreditsUsed,
            creditsRemaining: this.TOTAL_CREDITS - this.totalCreditsUsed,
            percentage: (this.totalCreditsUsed / this.TOTAL_CREDITS) * 100,
        };
    }
    /**
     * Get credit usage percentage
     */
    getCreditUsagePercentage() {
        return (this.getTotalCreditsUsed() / this.TOTAL_CREDITS) * 100;
    }
    /**
     * Check if we're approaching credit limit (80% threshold)
     */
    isApproachingCreditLimit() {
        return this.getCreditUsagePercentage() >= 80;
    }
    /**
     * Reset API key usage statistics
     */
    resetUsageStats() {
        this.keyUsage.forEach(usage => {
            usage.requestsUsed = 0;
            usage.estimatedCreditsUsed = 0;
            usage.isActive = true;
        });
        this.totalCreditsUsed = 0; // Reset running total
        logger_1.logger.info('API key usage statistics reset');
    }
    /**
     * Log comprehensive credit usage report
     */
    logCreditUsageReport() {
        const stats = this.getCreditUsageStats();
        const totalRequests = this.getTotalRequests();
        logger_1.logger.info('Birdeye API credit usage report', {
            totalCredits: stats.totalCredits,
            creditsUsed: stats.creditsUsed,
            creditsRemaining: stats.creditsRemaining,
            percentage: stats.percentage.toFixed(2),
            totalRequests,
            activeKeys: Array.from(this.keyUsage.values()).filter(u => u.isActive).length,
            totalKeys: this.apiKeys.length,
            warning: this.isApproachingCreditLimit() ? 'Approaching credit limit (80%+)' : undefined,
        });
    }
    /**
     * Check if any API keys are still active
     */
    hasActiveKeys() {
        return Array.from(this.keyUsage.values()).some(usage => usage.isActive);
    }
    /**
     * Fetch token metadata (name, symbol, etc.)
     */
    async getTokenMetadata(tokenAddress, chain = 'solana') {
        const maxRetries = 3;
        const baseDelay = 1000;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const apiKey = this.getNextAPIKey();
            const axiosInstance = this.axiosInstances.get(apiKey);
            if (!axiosInstance) {
                logger_1.logger.error('No axios instance found for API key', { keyPrefix: apiKey.substring(0, 8) });
                continue;
            }
            try {
                const response = await axiosInstance.get('/defi/v3/token/meta-data/single', {
                    params: {
                        address: tokenAddress,
                    },
                    headers: {
                        'x-chain': chain,
                    },
                });
                if (response.status === 200 && response.data?.success && response.data?.data) {
                    this.updateKeyUsage(apiKey);
                    const data = response.data.data;
                    return {
                        name: data.name || `Token ${tokenAddress.substring(0, 8)}`,
                        symbol: data.symbol || tokenAddress.substring(0, 4).toUpperCase(),
                    };
                }
                if (response.status === 404) {
                    logger_1.logger.debug('Token not found in Birdeye', { tokenAddress: tokenAddress.substring(0, 20) });
                    return null;
                }
                throw new Error(`Invalid response: ${response.status}`);
            }
            catch (error) {
                logger_1.logger.warn('Token metadata fetch attempt failed', {
                    attempt: attempt + 1,
                    tokenAddress: tokenAddress.substring(0, 20),
                    error: error.message,
                });
                if (error.response?.status === 429) {
                    this.deactivateKey(apiKey);
                    if (attempt < maxRetries - 1) {
                        await this.sleep(baseDelay);
                    }
                    continue;
                }
                if (error.response?.status === 400 || error.response?.status === 404) {
                    return null;
                }
                if (attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    await this.sleep(delay);
                }
            }
        }
        logger_1.logger.error('Failed to fetch token metadata after all attempts', {
            tokenAddress: tokenAddress.substring(0, 20),
        });
        return null;
    }
}
exports.BirdeyeClient = BirdeyeClient;
// Export singleton instance
exports.birdeyeClient = new BirdeyeClient();
//# sourceMappingURL=birdeye-client.js.map