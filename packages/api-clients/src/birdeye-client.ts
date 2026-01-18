import axios, { AxiosInstance, AxiosResponse, AxiosRequestConfig, AxiosError } from 'axios';
import { config } from 'dotenv';
import { logger, ConfigurationError, ValidationError } from '@quantbot/infra/utils';
import { recordApiUsage } from '@quantbot/infra/observability';
import { BaseApiClient } from './base-client.js';

config();

export interface BirdeyeOHLCVResponse {
  items: Array<{
    unixTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export interface APIKeyUsage {
  key: string;
  requestsUsed: number;
  lastUsed: Date;
  isActive: boolean;
  estimatedCreditsUsed: number;
  consecutiveFailures: number; // Track consecutive failures for rate limiting
  isValidated: boolean; // Whether key has been validated
  lastValidationTime?: Date; // When key was last validated
}

/** Factory function type for creating axios instances */
export type AxiosFactory = (config: {
  baseURL: string;
  timeout: number;
  headers: Record<string, string>;
  validateStatus: (status: number) => boolean;
}) => AxiosInstance;

export interface BirdeyeClientConfig {
  /** Optional custom API keys (defaults to environment variables) */
  apiKeys?: string[];
  /** Optional custom base URL */
  baseURL?: string;
  /** Optional factory for creating axios instances (for testing) */
  axiosFactory?: AxiosFactory;
}

export class BirdeyeClient extends BaseApiClient {
  private apiKeys: string[];
  private keyUsage: Map<string, APIKeyUsage>;
  private currentKeyIndex: number;
  private baseApiClients: Map<string, BaseApiClient>;
  private readonly TOTAL_CREDITS: number = 20000000; // 20M credits (upgraded account)
  // Credit costs: 120 credits for 5000 candles, 60 credits for <1000 candles
  private readonly CREDITS_FOR_5000_CANDLES: number = 120;
  private readonly CREDITS_FOR_LESS_THAN_1000: number = 60;
  private totalCreditsUsed: number = 0; // Running total across all keys
  private axiosFactory: AxiosFactory;
  private consecutiveFailures: number = 0; // Account-level consecutive failures (all keys share same account)
  private readonly RATE_LIMIT_THRESHOLD = 10; // Account-level: pause after 10 consecutive failures
  private readonly CIRCUIT_BREAKER_THRESHOLD = 20; // Account-level: stop all processing after 20 consecutive failures
  private circuitBreakerOpen: boolean = false;
  private rateLimitPaused: boolean = false; // Account-level rate limit pause
  private circuitBreakerOpenedAt: number | null = null; // Timestamp when circuit breaker opened
  private readonly CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 5 * 60 * 1000; // Auto-reset after 5 minutes

  constructor(config: BirdeyeClientConfig = {}) {
    const baseURL = config.baseURL ?? 'https://public-api.birdeye.so';

    // Create axios instance before super() call (for dependency injection in tests)
    let axiosInstance: AxiosInstance | undefined;
    if (config.axiosFactory) {
      axiosInstance = config.axiosFactory({
        baseURL,
        timeout: 10000,
        headers: { accept: 'application/json' },
        validateStatus: (status: number) => status < 500,
      });
    }

    // Initialize BaseApiClient with default config
    // We'll override request() to handle API key rotation
    super({
      baseURL,
      apiName: 'Birdeye',
      rateLimiter: {
        maxRequests: 3000, // 3000 req/min TOTAL for entire account (all 7 keys share this limit)
        windowMs: 60000, // 1 minute
      },
      retry: {
        maxRetries: 5,
        initialDelayMs: 1000,
        retryableStatusCodes: [429, 500, 502, 503, 504],
      },
      axiosInstance,
    });

    this.apiKeys = config.apiKeys ?? this.loadAPIKeys();
    this.keyUsage = new Map();
    this.currentKeyIndex = 0;
    this.baseApiClients = new Map();
    this.axiosFactory = config.axiosFactory ?? ((cfg) => axios.create(cfg));

    this.initializeAPIKeys();
  }

  /**
   * Load API keys from environment variables
   */
  private loadAPIKeys(): string[] {
    const keys: string[] = [];

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
      throw new ConfigurationError(
        'No Birdeye API keys found in environment variables',
        'BIRDEYE_API_KEY'
      );
    }

    // All keys share the same account, so total credits = 20M (shared pool)
    const totalCreditsFormatted =
      this.TOTAL_CREDITS >= 1_000_000
        ? `~${(this.TOTAL_CREDITS / 1_000_000).toFixed(2)}M`
        : `~${(this.TOTAL_CREDITS / 1_000).toFixed(2)}K`;

    logger.info('Loaded Birdeye API keys', {
      keyCount: keys.length,
      totalCredits: totalCreditsFormatted,
      keysFound: keys.length > 0 ? `${keys.length} key(s)` : 'none',
    });
    if (keys.length > 0) {
      logger.debug('Birdeye API keys loaded', {
        baseKey: process.env.BIRDEYE_API_KEY ? 'present' : 'missing',
        numberedKeys: Array.from({ length: 6 }, (_, i) => i + 1)
          .map((i) => (process.env[`BIRDEYE_API_KEY_${i}`] ? `_${i}` : null))
          .filter(Boolean),
      });
    }
    return keys;
  }

  /**
   * Initialize API key usage tracking
   */
  private initializeAPIKeys(): void {
    this.apiKeys.forEach((key) => {
      this.keyUsage.set(key, {
        key,
        requestsUsed: 0,
        lastUsed: new Date(),
        isActive: true,
        estimatedCreditsUsed: 0,
        consecutiveFailures: 0,
        isValidated: false,
      });

      // Create BaseApiClient instance for each API key
      const axiosInstance: AxiosInstance = this.axiosFactory({
        baseURL: this.axiosInstance.defaults.baseURL || 'https://public-api.birdeye.so',
        timeout: 10000,
        headers: {
          'X-API-KEY': key,
          accept: 'application/json',
        },
        validateStatus: (status: number) => status < 500, // Don't throw on 4xx errors
      });

      // Create BaseApiClient without rate limiter - all keys share same account limit
      // Rate limiting is handled at account level in the main client
      const baseClient = new BaseApiClient({
        baseURL: this.axiosInstance.defaults.baseURL || 'https://public-api.birdeye.so',
        apiName: 'Birdeye',
        // No rate limiter here - all keys share same account (3000 rpm total)
        // Account-level rate limiting is handled by the main client's rate limiter
        retry: {
          maxRetries: 5,
          initialDelayMs: 1000,
          retryableStatusCodes: [429, 500, 502, 503, 504],
        },
        axiosInstance,
      });

      // Store the BaseApiClient instance in the map
      this.baseApiClients.set(key, baseClient);
    });
  }

  /**
   * Get the next available API key using round-robin
   */
  private getNextAPIKey(): string {
    const activeKeys = Array.from(this.keyUsage.values()).filter((usage) => usage.isActive);

    if (activeKeys.length === 0) {
      throw new ConfigurationError('No active API keys available', 'BIRDEYE_API_KEY', {
        totalKeys: this.apiKeys.length,
        activeKeys: Array.from(this.keyUsage.values()).filter((k) => k.isActive).length,
      });
    }

    const key = activeKeys[this.currentKeyIndex % activeKeys.length];
    this.currentKeyIndex = (this.currentKeyIndex + 1) % activeKeys.length;

    return key.key;
  }

  /**
   * Update API key usage statistics
   * @param candleCount Number of candles returned in the response (for credit calculation)
   */
  private updateKeyUsage(key: string, candleCount: number = 0): void {
    const usage = this.keyUsage.get(key);
    if (usage) {
      usage.requestsUsed++;

      // Calculate credit cost based on candle count
      // 120 credits for 5000 candles, 60 credits for <1000 candles
      let creditsForThisRequest = 0;
      if (candleCount >= 1000) {
        // For >= 1000 candles, use 5000-candle pricing (120 credits)
        creditsForThisRequest = this.CREDITS_FOR_5000_CANDLES;
      } else if (candleCount > 0) {
        // For <1000 candles, use 60 credits
        creditsForThisRequest = this.CREDITS_FOR_LESS_THAN_1000;
      } else {
        // Fallback for unknown candle count (assume small request)
        creditsForThisRequest = this.CREDITS_FOR_LESS_THAN_1000;
      }

      usage.estimatedCreditsUsed += creditsForThisRequest;
      this.totalCreditsUsed += creditsForThisRequest; // Update running total

      usage.lastUsed = new Date();

      // Log credit usage every 100 requests or every 1000 credits
      if (usage.requestsUsed % 100 === 0 || this.totalCreditsUsed % 1000 === 0) {
        logger.info('Birdeye API credit usage', {
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
   * Validate API key by making a lightweight test request
   */
  private async validateAPIKey(key: string): Promise<boolean> {
    const usage = this.keyUsage.get(key);
    if (!usage) return false;

    // Skip validation if recently validated (within last 5 minutes)
    if (usage.isValidated && usage.lastValidationTime) {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      if (usage.lastValidationTime.getTime() > fiveMinutesAgo) {
        return usage.isActive;
      }
    }

    try {
      // Make a lightweight test request to validate key
      // Using price endpoint with a well-known token (SOL) - very lightweight
      const axiosInstance = this.axiosFactory({
        baseURL: this.axiosInstance.defaults.baseURL || 'https://public-api.birdeye.so',
        timeout: 5000, // Short timeout for validation
        headers: {
          'X-API-KEY': key,
          accept: 'application/json',
        },
        validateStatus: (status: number) => status < 500,
      });

      // Test with price endpoint for SOL (well-known token, minimal cost)
      const testResponse = await axiosInstance.get('/defi/price', {
        params: { address: 'So11111111111111111111111111111111111111112' }, // SOL mint
        timeout: 5000,
      });

      const isValid = testResponse.status === 200;
      usage.isValidated = true;
      usage.lastValidationTime = new Date();
      usage.isActive = isValid;

      if (!isValid) {
        logger.warn('API key validation failed', {
          keyPrefix: key.substring(0, 8),
          status: testResponse.status,
        });
      } else {
        logger.debug('API key validated successfully', { keyPrefix: key.substring(0, 8) });
      }

      return isValid;
    } catch (error) {
      // Validation failed - mark key as inactive
      usage.isValidated = true;
      usage.lastValidationTime = new Date();
      usage.isActive = false;

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('API key validation error', {
        keyPrefix: key.substring(0, 8),
        error: errorMessage,
      });

      return false;
    }
  }

  /**
   * Handle API key deactivation on rate limit or validation failure
   */
  private deactivateKey(key: string, reason: string = 'rate limit'): void {
    const usage = this.keyUsage.get(key);
    if (usage) {
      usage.isActive = false;
      logger.warn('API key deactivated', {
        keyPrefix: key.substring(0, 8),
        reason,
        consecutiveFailures: usage.consecutiveFailures,
      });
    }
  }

  /**
   * Record a failure at account level (all keys share same account/rate limit)
   */
  private recordFailure(key: string): void {
    const usage = this.keyUsage.get(key);
    if (usage) {
      usage.consecutiveFailures++;
    }

    // Account-level failure tracking (all keys share same account)
    this.consecutiveFailures++;

    // Rate limit pause: After 10 consecutive failures, pause for 1 minute
    if (this.consecutiveFailures >= this.RATE_LIMIT_THRESHOLD && !this.rateLimitPaused) {
      this.rateLimitPaused = true;
      logger.warn('Account rate limit PAUSED - too many consecutive failures', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.RATE_LIMIT_THRESHOLD,
        pauseDuration: '1 minute',
        note: 'All keys share the same account rate limit',
      });

      // Auto-resume after 1 minute
      setTimeout(() => {
        if (this.rateLimitPaused && this.consecutiveFailures >= this.RATE_LIMIT_THRESHOLD) {
          this.rateLimitPaused = false;
          this.consecutiveFailures = 0; // Reset counter on resume
          logger.info('Account rate limit resumed after pause', {
            pauseDuration: '1 minute',
          });
        }
      }, 60 * 1000); // 1 minute
    }

    // Circuit breaker: Stop all processing after 20 consecutive failures
    if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_THRESHOLD && !this.circuitBreakerOpen) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenedAt = Date.now();
      logger.error('Circuit breaker OPEN - too many consecutive failures', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.CIRCUIT_BREAKER_THRESHOLD,
        note: 'All keys share the same account - circuit breaker applies to entire account',
        autoResetAfterMs: this.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
      });
    }
  }

  /**
   * Record a success (reset account-level failure counters)
   */
  private recordSuccess(key: string): void {
    const usage = this.keyUsage.get(key);
    if (usage) {
      usage.consecutiveFailures = 0;
    }
    // Reset account-level counters on any success (all keys share same account)
    this.consecutiveFailures = 0;
    this.circuitBreakerOpen = false;
    this.circuitBreakerOpenedAt = null;
    this.rateLimitPaused = false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Make a request with API key rotation
   * Overrides BaseApiClient's request to handle multiple API keys
   * Returns both the response and the API key used
   */
  protected async requestWithKeyRotation<T = unknown>(
    config: AxiosRequestConfig,
    maxAttempts: number = 5
  ): Promise<{ response: AxiosResponse<T>; apiKey: string } | null> {
    // Circuit breaker check (account-level - all keys share same account)
    // Auto-reset if enough time has passed
    if (this.circuitBreakerOpen && this.circuitBreakerOpenedAt) {
      const timeSinceOpen = Date.now() - this.circuitBreakerOpenedAt;
      if (timeSinceOpen >= this.CIRCUIT_BREAKER_RESET_TIMEOUT_MS) {
        logger.info('Circuit breaker auto-reset after timeout', {
          timeSinceOpenMs: timeSinceOpen,
          timeoutMs: this.CIRCUIT_BREAKER_RESET_TIMEOUT_MS,
        });
        this.circuitBreakerOpen = false;
        this.circuitBreakerOpenedAt = null;
        this.consecutiveFailures = 0; // Reset counter on auto-reset
        this.rateLimitPaused = false;
      }
    }

    if (this.circuitBreakerOpen) {
      const timeSinceOpen = this.circuitBreakerOpenedAt
        ? Date.now() - this.circuitBreakerOpenedAt
        : 0;
      const timeUntilReset = Math.max(0, this.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - timeSinceOpen);
      logger.error('Circuit breaker is OPEN - refusing all requests', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.CIRCUIT_BREAKER_THRESHOLD,
        timeSinceOpenMs: timeSinceOpen,
        timeUntilResetMs: timeUntilReset,
        note: 'All keys share the same account rate limit',
      });
      throw new Error(
        `Circuit breaker is OPEN: ${this.consecutiveFailures} consecutive failures (threshold: ${this.CIRCUIT_BREAKER_THRESHOLD}). Auto-reset in ${Math.ceil(timeUntilReset / 1000)}s. All keys share the same account.`
      );
    }

    // Rate limit pause check (account-level)
    if (this.rateLimitPaused) {
      logger.warn('Account rate limit is PAUSED - waiting before retry', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.RATE_LIMIT_THRESHOLD,
        note: 'All keys share the same account rate limit',
      });
      // Wait 1 minute before retrying
      await this.sleep(60 * 1000);
      // Reset pause if we've waited
      if (this.consecutiveFailures < this.RATE_LIMIT_THRESHOLD) {
        this.rateLimitPaused = false;
      }
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const apiKey = this.getNextAPIKey();
      const baseClient = this.baseApiClients.get(apiKey);

      if (!baseClient) {
        logger.error('No BaseApiClient found for API key', { keyPrefix: apiKey.substring(0, 8) });
        continue;
      }

      // Validate key before use if not recently validated
      const usage = this.keyUsage.get(apiKey);
      if (usage && (!usage.isValidated || !usage.isActive)) {
        const isValid = await this.validateAPIKey(apiKey);
        if (!isValid) {
          this.recordFailure(apiKey);
          continue; // Try next key
        }
      }

      try {
        // Use explicit HTTP method calls for better testability
        const axiosInstance = baseClient.getAxiosInstance();
        // CRITICAL: Verify address is not truncated in params before axios call
        if (config.params?.address && typeof config.params.address === 'string') {
          const addressLength = config.params.address.length;
          if (addressLength < 32) {
            logger.error('Address is truncated in params before axios call', {
              address: config.params.address,
              length: addressLength,
              expectedMin: 32,
              url: config.url,
            });
            throw new ValidationError(
              `Address is truncated in params: ${addressLength} chars (expected >= 32)`,
              {
                addressLength,
                expectedMin: 32,
                url: config.url,
              }
            );
          }
        }

        let response: AxiosResponse<T>;

        if (config.method?.toUpperCase() === 'POST') {
          response = await axiosInstance.post<T>(config.url || '', config.data, {
            headers: config.headers,
            params: config.params,
          });
        } else {
          // Default to GET
          response = await axiosInstance.get<T>(config.url || '', {
            headers: config.headers,
            params: config.params,
          });
        }

        // CRITICAL: Verify address was not truncated in the actual HTTP request
        // Check the request URL to ensure full address was sent
        if (config.params?.address && typeof config.params.address === 'string') {
          const requestUrl = response.config.url || '';
          if (requestUrl.includes('address=')) {
            const addressParam = requestUrl.match(/address=([^&]+)/)?.[1];
            if (addressParam && decodeURIComponent(addressParam).length < 32) {
              logger.error('Address was truncated in HTTP request URL', {
                originalAddress: config.params.address,
                originalLength: config.params.address.length,
                urlAddress: decodeURIComponent(addressParam),
                urlAddressLength: decodeURIComponent(addressParam).length,
                fullUrl: requestUrl,
              });
            }
          }
        }

        // Check if response is successful before recording success
        if (response.status >= 200 && response.status < 300) {
          this.recordSuccess(apiKey);
          return { response, apiKey };
        } else {
          // Non-2xx response - record as failure
          this.recordFailure(apiKey);
          // Continue to try next key
        }
      } catch (error: unknown) {
        // Record failure for this key
        this.recordFailure(apiKey);

        logger.warn('Request attempt failed', {
          attempt: attempt + 1,
          keyPrefix: apiKey.substring(0, 8),
          consecutiveFailures: this.keyUsage.get(apiKey)?.consecutiveFailures || 0,
          globalConsecutiveFailures: this.consecutiveFailures,
        });

        // Type guard for AxiosError
        const isAxiosError = (e: unknown): e is AxiosError => {
          return (
            typeof e === 'object' &&
            e !== null &&
            'response' in e &&
            'request' in e &&
            'config' in e
          );
        };

        if (!isAxiosError(error)) {
          throw error;
        }

        // Handle rate limiting - deactivate key and try next one
        if (error.response?.status === 429) {
          this.recordFailure(apiKey); // Record failure for rate limit
          this.deactivateKey(apiKey, 'rate limit (429)');
          if (attempt < maxAttempts - 1) {
            await this.sleep(1000);
          }
          continue;
        }

        // Handle 403 (Forbidden) - might be rate limiting or access denied
        // Try next key instead of failing immediately
        if (error.response?.status === 403) {
          this.recordFailure(apiKey); // Record failure for 403
          logger.warn('403 Forbidden - deactivating key and trying next', {
            keyPrefix: apiKey.substring(0, 8),
            attempt: attempt + 1,
            maxAttempts,
            url: config.url,
            consecutiveFailures: this.keyUsage.get(apiKey)?.consecutiveFailures || 0,
          });
          this.deactivateKey(apiKey, 'forbidden (403)');
          if (attempt < maxAttempts - 1) {
            await this.sleep(1000);
          }
          continue;
        }

        // For other errors, let BaseApiClient's retry logic handle it
        // But if it's a 400/401, don't retry (these are permanent failures)
        if (error.response?.status === 400 || error.response?.status === 401) {
          this.recordFailure(apiKey); // Record failure for permanent errors
          logger.warn('Permanent error - not retrying', {
            status: error.response.status,
            url: config.url,
            consecutiveFailures: this.keyUsage.get(apiKey)?.consecutiveFailures || 0,
          });
          return null;
        }

        // Re-throw to let BaseApiClient handle retry
        throw error;
      }
    }

    return null;
  }

  /**
   * Fetch OHLCV data with retry logic and exponential backoff
   */
  async fetchOHLCVData(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m',
    chain: string = 'solana'
  ): Promise<BirdeyeOHLCVResponse | null> {
    const startUnix = Math.floor(startTime.getTime() / 1000);
    const endUnix = Math.floor(endTime.getTime() / 1000);

    // Normalize chain to lowercase (Birdeye API expects lowercase)
    const normalizedChain = chain.toLowerCase();

    // Determine chain from address format (0x = ethereum/evm, otherwise use normalized chain)
    // Also handle common chain name variations
    let detectedChain: string;
    if (tokenAddress.startsWith('0x')) {
      detectedChain = 'ethereum';
    } else if (normalizedChain === 'sol' || normalizedChain === 'solana') {
      detectedChain = 'solana';
    } else if (normalizedChain === 'eth' || normalizedChain === 'ethereum') {
      detectedChain = 'ethereum';
    } else if (normalizedChain === 'bsc' || normalizedChain === 'binance') {
      detectedChain = 'bsc';
    } else if (normalizedChain === 'base') {
      detectedChain = 'base';
    } else {
      // Default to solana for unknown chains (most tokens are Solana)
      detectedChain = 'solana';
      logger.debug('Invalid chain input', {
        status: 422,
        tokenAddress: tokenAddress,
        originalChain: chain,
        normalizedChain,
        usingDefault: 'solana',
      });
    }

    logger.debug('Fetching OHLCV', {
      tokenAddress: tokenAddress,
      tokenAddressLength: tokenAddress.length,
      chain: detectedChain,
    });

    // CRITICAL: Verify address is not truncated before API call
    if (tokenAddress.length < 32) {
      logger.error('Address is too short before API call', {
        tokenAddress,
        length: tokenAddress.length,
        expectedMin: 32,
      });
      throw new ValidationError(
        `Address is too short: ${tokenAddress.length} chars (expected >= 32)`,
        {
          addressLength: tokenAddress.length,
          expectedMin: 32,
          address: tokenAddress,
        }
      );
    }

    try {
      const result = await this.requestWithKeyRotation<BirdeyeOHLCVResponse>({
        method: 'GET',
        url: '/defi/v3/ohlcv',
        headers: {
          'x-chain': detectedChain,
        },
        params: {
          address: tokenAddress, // Full address - DO NOT TRUNCATE
          type: interval,
          currency: 'usd',
          time_from: startUnix,
          time_to: endUnix,
          ui_amount_mode: 'raw',
          mode: 'range',
          padding: true,
        },
      });

      if (!result) {
        return null;
      }

      const { response, apiKey } = result;

      // Handle error status codes (invalid token addresses, validation errors, etc.)
      if (response.status === 400 || response.status === 404 || response.status === 422) {
        // 422 = Unprocessable Entity (validation error, invalid parameters, etc.)
        const responseData = response.data as unknown as Record<string, unknown> | undefined;
        const errorMessage = responseData?.message || responseData?.error || 'Unknown error';
        logger.debug('Birdeye API error response', {
          status: response.status,
          message: typeof errorMessage === 'string' ? errorMessage : String(errorMessage),
          tokenAddress: tokenAddress,
        });
        return null;
      }

      // Check for error responses even with 200 status (some APIs return 200 with success: false)
      if (response.data) {
        const responseData = response.data as unknown as Record<string, unknown>;
        if (responseData.success === false || (responseData.message && !responseData.data)) {
          // Error response structure: { success: false, message: "..." }
          const errorMessage = responseData.message || responseData.error || 'Unknown error';
          logger.debug('Birdeye API error response (success: false)', {
            status: response.status,
            message: typeof errorMessage === 'string' ? errorMessage : String(errorMessage),
            tokenAddress: tokenAddress,
          });
          return null;
        }
      }

      if (response.status === 200 && response.data) {
        // v3/ohlcv returns { data: { items: [...] } } or { success: true, data: { items: [...] } }
        const responseData = response.data as unknown as Record<string, unknown>;

        // Check if response indicates failure (even with 200 status)
        if (responseData.success === false) {
          // API returned success: false (some APIs return 200 with success: false)
          const errorMessage =
            responseData.message || responseData.error || 'API returned success: false';
          logger.debug('Birdeye API error response (success: false)', {
            status: response.status,
            message: typeof errorMessage === 'string' ? errorMessage : String(errorMessage),
            tokenAddress: tokenAddress,
          });
          return null;
        }

        // Check for error message without data field (error response structure)
        if (responseData.message && !responseData.data && responseData.success !== true) {
          const errorMessage = responseData.message || 'Unknown error';
          logger.debug('Birdeye API error response (message without data)', {
            status: response.status,
            message: typeof errorMessage === 'string' ? errorMessage : String(errorMessage),
            tokenAddress: tokenAddress,
          });
          return null;
        }

        // v3/ohlcv format: { data: { items: [...] } }
        const dataObj = responseData.data as Record<string, unknown> | undefined;
        const items = dataObj?.items;

        if (!items) {
          // No items field - might be different response structure
          logger.debug('No items in response', {
            tokenAddress: tokenAddress,
            responseKeys: Object.keys(responseData),
          });
          return null;
        }

        if (Array.isArray(items) && items.length > 0) {
          // Convert v3 format to history_price format
          const formattedItems = items.map((item) => {
            const itemObj = item as Record<string, unknown>;
            return {
              unixTime: Number(itemObj.unix_time ?? itemObj.unixTime) || 0,
              open: parseFloat(String(itemObj.o)) || 0,
              high: parseFloat(String(itemObj.h)) || 0,
              low: parseFloat(String(itemObj.l)) || 0,
              close: parseFloat(String(itemObj.c)) || 0,
              volume: parseFloat(String(itemObj.v)) || 0,
            };
          });

          const candleCount = formattedItems.length;
          this.updateKeyUsage(apiKey, candleCount);

          // Calculate credits used (120 for 5000 candles, 60 for <1000)
          const creditsUsed =
            candleCount >= 5000 ? this.CREDITS_FOR_5000_CANDLES : this.CREDITS_FOR_LESS_THAN_1000;

          // Record API usage (non-blocking)
          recordApiUsage('birdeye', creditsUsed, {
            endpoint: '/defi/v3/ohlcv',
            candleCount,
            chain: detectedChain,
          }).catch((error: unknown) => {
            logger.warn('Failed to record API usage', {
              error: error instanceof Error ? error.message : String(error),
            });
          });

          logger.debug('Successfully fetched OHLCV records from API', {
            recordCount: candleCount,
            tokenAddress: tokenAddress,
            chain: detectedChain,
          });
          return { items: formattedItems } as BirdeyeOHLCVResponse;
        } else if (Array.isArray(items) && items.length === 0) {
          // Empty array - token exists but no data
          logger.debug('No candle data available', { tokenAddress: tokenAddress });
          return null;
        } else {
          logger.debug('Items is not an array', {
            tokenAddress: tokenAddress,
            itemsType: typeof items,
            itemsValue: items,
          });
          return null;
        }
      }

      // If we get here, response structure is unexpected
      logger.warn('Unexpected response structure', {
        status: response.status,
        hasData: !!response.data,
        dataKeys: response.data ? Object.keys(response.data) : [],
        tokenAddress: tokenAddress,
      });
      return null;
    } catch (error: unknown) {
      logger.error('Failed to fetch OHLCV data', {
        error: error instanceof Error ? error.message : String(error),
        tokenAddress: tokenAddress,
      });
      return null;
    }
  }

  /**
   * Get API key usage statistics
   */
  getAPIKeyUsage(): APIKeyUsage[] {
    return Array.from(this.keyUsage.values());
  }

  /**
   * Get count of active API keys (for testing)
   */
  getActiveKeysCount(): number {
    return Array.from(this.keyUsage.values()).filter((usage) => usage.isActive).length;
  }

  /**
   * Check if a specific API key is active (for testing)
   */
  isKeyActive(key: string): boolean {
    const usage = this.keyUsage.get(key);
    return usage?.isActive ?? false;
  }

  /**
   * Get total requests made across all keys
   */
  getTotalRequests(): number {
    return Array.from(this.keyUsage.values()).reduce(
      (total, usage) => total + usage.requestsUsed,
      0
    );
  }

  /**
   * Get total credits used across all keys (from running counter)
   */
  getTotalCreditsUsed(): number {
    return this.totalCreditsUsed;
  }

  /**
   * Get remaining credits estimate
   */
  getRemainingCredits(): number {
    return this.TOTAL_CREDITS - this.totalCreditsUsed;
  }

  /**
   * Get running credit usage statistics
   */
  getCreditUsageStats(): {
    totalCredits: number;
    creditsUsed: number;
    creditsRemaining: number;
    percentage: number;
  } {
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
  getCreditUsagePercentage(): number {
    return (this.getTotalCreditsUsed() / this.TOTAL_CREDITS) * 100;
  }

  /**
   * Check if we're approaching credit limit (80% threshold)
   */
  isApproachingCreditLimit(): boolean {
    return this.getCreditUsagePercentage() >= 80;
  }

  /**
   * Reset API key usage statistics
   */
  resetUsageStats(): void {
    this.keyUsage.forEach((usage) => {
      usage.requestsUsed = 0;
      usage.estimatedCreditsUsed = 0;
      usage.isActive = true;
    });
    this.totalCreditsUsed = 0; // Reset running total
    logger.info('API key usage statistics reset');
  }

  /**
   * Log comprehensive credit usage report
   */
  logCreditUsageReport(): void {
    const stats = this.getCreditUsageStats();
    const totalRequests = this.getTotalRequests();

    logger.info('Birdeye API credit usage report', {
      totalCredits: stats.totalCredits,
      creditsUsed: stats.creditsUsed,
      creditsRemaining: stats.creditsRemaining,
      percentage: stats.percentage.toFixed(2),
      totalRequests,
      activeKeys: Array.from(this.keyUsage.values()).filter((u) => u.isActive).length,
      totalKeys: this.apiKeys.length,
      warning: this.isApproachingCreditLimit() ? 'Approaching credit limit (80%+)' : undefined,
    });
  }

  /**
   * Check if any API keys are still active
   */
  hasActiveKeys(): boolean {
    return Array.from(this.keyUsage.values()).some((usage) => usage.isActive);
  }

  /**
   * Fetch historical price at a specific unix timestamp
   * Uses the historical_price_unix endpoint: https://public-api.birdeye.so/defi/historical_price_unix
   *
   * @param tokenAddress Token address
   * @param unixTime Unix timestamp (seconds) - exact time to fetch price
   * @param chain Chain identifier (default: 'solana')
   * @returns Historical price at the specified time or null if not found
   */
  async fetchHistoricalPriceAtUnixTime(
    tokenAddress: string,
    unixTime: number,
    chain: string = 'solana'
  ): Promise<{ unixTime: number; value: number; price?: number } | null> {
    try {
      const result = await this.requestWithKeyRotation<{
        success: boolean;
        data?: {
          updateUnixTime?: number;
          value?: number;
          priceChange24h?: number;
          isScaledUiToken?: boolean;
          address?: string;
        };
      }>(
        {
          method: 'GET',
          url: '/defi/historical_price_unix',
          params: {
            address: tokenAddress,
            unixtime: unixTime, // Note: parameter is 'unixtime' not 'unix_time'
            ui_amount_mode: 'raw',
          },
          headers: {
            'x-chain': chain,
          },
        },
        3
      );

      if (!result) {
        return null;
      }

      const { response, apiKey } = result;

      if (response.status === 200 && response.data?.success && response.data?.data) {
        this.updateKeyUsage(apiKey, 1);

        // Record API usage (estimate: 1 credit per request)
        recordApiUsage('birdeye', 1, {
          endpoint: '/defi/historical_price_unix',
          chain,
        }).catch((error: unknown) => {
          logger.warn('Failed to record API usage', {
            error: error instanceof Error ? error.message : String(error),
          });
        });

        const data = response.data.data;
        if (data.value !== undefined) {
          return {
            unixTime: data.updateUnixTime ?? unixTime,
            value: data.value,
            price: data.value, // value is the price
          };
        }
      }

      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to fetch historical price at unix time', {
        token: tokenAddress,
        error: errorMessage,
      });
      return null;
    }
  }

  /**
   * Fetch historical price data in a time range
   * Uses the history_price endpoint: https://public-api.birdeye.so/defi/history_price
   *
   * @param tokenAddress Token address
   * @param timeFrom Unix timestamp (seconds) - start time
   * @param timeTo Unix timestamp (seconds) - end time
   * @param interval Price interval ('1m', '5m', '15m', '1H', '4H', '1D')
   * @param chain Chain identifier (default: 'solana')
   * @returns Historical price data items or null if not found
   */
  async fetchHistoricalPrice(
    tokenAddress: string,
    timeFrom: number,
    timeTo: number,
    interval: string = '1m',
    chain: string = 'solana'
  ): Promise<Array<{ unixTime: number; value: number; price?: number }> | null> {
    try {
      const result = await this.requestWithKeyRotation<{
        success: boolean;
        data?: {
          items?: Array<{
            unixTime: number;
            value: number;
            address?: string;
          }>;
          isScaledUiToken?: boolean;
          multiplier?: number | null;
        };
      }>(
        {
          method: 'GET',
          url: '/defi/history_price',
          params: {
            address: tokenAddress,
            address_type: 'token',
            type: interval,
            time_from: timeFrom,
            time_to: timeTo,
            ui_amount_mode: 'raw',
          },
          headers: {
            'x-chain': chain,
          },
        },
        3
      );

      if (!result) {
        return null;
      }

      const { response, apiKey } = result;

      if (response.status === 200 && response.data?.success && response.data?.data?.items) {
        this.updateKeyUsage(apiKey, response.data.data.items.length);

        // Record API usage (estimate: 1 credit per request for history_price)
        recordApiUsage('birdeye', 1, {
          endpoint: '/defi/history_price',
          chain,
          itemCount: response.data.data.items.length,
        }).catch((error: unknown) => {
          logger.warn('Failed to record API usage', {
            error: error instanceof Error ? error.message : String(error),
          });
        });

        // Map items to include price field (value is the price)
        return response.data.data.items.map((item) => ({
          unixTime: item.unixTime,
          value: item.value,
          price: item.value, // value is the price
        }));
      }

      return null;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to fetch historical price', {
        token: tokenAddress,
        error: errorMessage,
      });
      return null;
    }
  }

  /**
   * Search for token info including creation_time and last_trade_unix_time
   * Uses the /defi/v3/search endpoint
   *
   * @param tokenAddress Token address to search for
   * @param chain Chain identifier (default: 'solana')
   * @returns Token info including creation and last trade times, or null if not found
   */
  async searchToken(
    tokenAddress: string,
    chain: string = 'solana'
  ): Promise<{
    address: string;
    name: string;
    symbol: string;
    creationTime: string | null; // ISO string
    lastTradeUnixTime: number | null;
    lastTradeHumanTime: string | null;
    liquidity: number | null;
    price: number | null;
  } | null> {
    try {
      const result = await this.requestWithKeyRotation<{
        success: boolean;
        data?: {
          items?: Array<{
            type: string;
            result: Array<{
              name?: string;
              symbol?: string;
              address?: string;
              network?: string;
              creation_time?: string;
              last_trade_unix_time?: number;
              last_trade_human_time?: string;
              liquidity?: number;
              price?: number;
            }>;
          }>;
        };
      }>(
        {
          method: 'GET',
          url: '/defi/v3/search',
          params: {
            keyword: tokenAddress,
            target: 'token',
            sort_by: 'liquidity',
            sort_type: 'desc',
            offset: 0,
            limit: 1,
          },
          headers: {
            'x-chain': chain,
          },
        },
        3
      );

      if (!result) {
        return null;
      }

      const { response, apiKey } = result;

      if (response.status === 200 && response.data?.success && response.data?.data?.items) {
        this.updateKeyUsage(apiKey);
        recordApiUsage('birdeye', 1);

        // Find the token result
        const tokenItem = response.data.data.items.find((item) => item.type === 'token');
        if (!tokenItem || !tokenItem.result || tokenItem.result.length === 0) {
          return null;
        }

        const token = tokenItem.result[0];
        return {
          address: token.address || tokenAddress,
          name: token.name || '',
          symbol: token.symbol || '',
          creationTime: token.creation_time || null,
          lastTradeUnixTime: token.last_trade_unix_time || null,
          lastTradeHumanTime: token.last_trade_human_time || null,
          liquidity: token.liquidity || null,
          price: token.price || null,
        };
      }

      return null;
    } catch (error: unknown) {
      logger.warn('Failed to search token', {
        token: tokenAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch token metadata (name, symbol, etc.)
   */
  async getTokenMetadata(
    tokenAddress: string,
    chain: string = 'solana'
  ): Promise<{ name: string; symbol: string } | null> {
    try {
      const result = await this.requestWithKeyRotation<{
        success: boolean;
        data?: {
          name?: string;
          symbol?: string;
        };
      }>(
        {
          method: 'GET',
          url: '/defi/v3/token/meta-data/single',
          params: {
            address: tokenAddress,
          },
          headers: {
            'x-chain': chain,
          },
        },
        3
      );

      if (!result) {
        return null;
      }

      const { response, apiKey } = result;

      if (response.status === 200 && response.data?.success && response.data?.data) {
        this.updateKeyUsage(apiKey);

        // Record API usage (1 credit per metadata call)
        recordApiUsage('birdeye', 1);

        const data = response.data.data;
        return {
          name: data.name || `Token ${tokenAddress}`,
          symbol: data.symbol || tokenAddress.substring(0, 4).toUpperCase(),
        };
      }

      if (response.status === 404) {
        logger.debug('Token not found in Birdeye', { tokenAddress: tokenAddress });
        return null;
      }

      return null;
    } catch (error: unknown) {
      logger.error('Failed to fetch token metadata', {
        error: error instanceof Error ? error.message : String(error),
        tokenAddress: tokenAddress,
      });
      return null;
    }
  }

  /**
   * Search for markets for a given token address
   * Returns all markets (pairs) where this token is traded
   */
  async searchMarkets(
    tokenAddress: string,
    chain: string = 'all'
  ): Promise<Array<{
    name: string;
    address: string;
    network: string;
    liquidity: number;
    unique_wallet_24h: number;
    trade_24h: number;
    trade_24h_change_percent: number | null;
    volume_24h_usd: number;
    last_trade_unix_time: number;
    last_trade_human_time: string;
    amount_base: number;
    amount_quote: number;
    base_mint: string;
    quote_mint: string;
    source: string;
    creation_time: string;
    is_scaled_ui_token_base: boolean;
    multiplier_base: number | null;
    is_scaled_ui_token_quote: boolean;
    multiplier_quote: number | null;
  }> | null> {
    try {
      const result = await this.requestWithKeyRotation<{
        success: boolean;
        data?: {
          items?: Array<{
            type: string;
            result: Array<{
              name: string;
              address: string;
              network: string;
              liquidity: number;
              unique_wallet_24h: number;
              trade_24h: number;
              trade_24h_change_percent: number | null;
              volume_24h_usd: number;
              last_trade_unix_time: number;
              last_trade_human_time: string;
              amount_base: number;
              amount_quote: number;
              base_mint: string;
              quote_mint: string;
              source: string;
              creation_time: string;
              is_scaled_ui_token_base: boolean;
              multiplier_base: number | null;
              is_scaled_ui_token_quote: boolean;
              multiplier_quote: number | null;
            }>;
          }>;
        };
      }>(
        {
          method: 'GET',
          url: '/defi/v3/search',
          params: {
            chain: chain,
            keyword: tokenAddress,
            target: 'market',
            search_mode: 'exact',
            search_by: 'address',
            sort_by: 'volume_24h_usd',
            sort_type: 'desc',
            offset: 0,
            limit: 20,
            ui_amount_mode: 'scaled',
          },
          headers: {
            accept: 'application/json',
          },
        },
        3
      );

      if (!result) {
        return null;
      }

      const { response, apiKey } = result;

      if (response.status === 200 && response.data?.success && response.data?.data?.items) {
        this.updateKeyUsage(apiKey);

        // Record API usage (minimal credit cost for search endpoints)
        recordApiUsage('birdeye', 1, {
          endpoint: '/defi/v3/search',
          chain,
          itemCount: response.data.data.items.length,
        }).catch((error: unknown) => {
          logger.warn('Failed to record API usage', {
            error: error instanceof Error ? error.message : String(error),
          });
        });

        // Find the market result
        const marketItem = response.data.data.items.find((item) => item.type === 'market');
        if (!marketItem || !marketItem.result || marketItem.result.length === 0) {
          return [];
        }

        return marketItem.result;
      }

      if (response.status === 404) {
        logger.debug('No markets found for token', { tokenAddress: tokenAddress });
        return [];
      }

      return null;
    } catch (error: unknown) {
      logger.warn('Failed to search markets', {
        token: tokenAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Fetch token creation info (txHash, slot, decimals, owner, creation time)
   * Only available for Solana tokens
   */
  async fetchTokenCreationInfo(
    tokenAddress: string,
    chain: string = 'solana'
  ): Promise<{
    txHash: string;
    slot: number;
    tokenAddress: string;
    decimals: number;
    owner: string;
    blockUnixTime: number;
    blockHumanTime: string;
    creator?: string;
  } | null> {
    if (chain !== 'solana') {
      logger.warn('Token creation info is only available for Solana tokens', {
        tokenAddress,
        chain,
      });
      return null;
    }

    try {
      const result = await this.requestWithKeyRotation<{
        success: boolean;
        data?: {
          txHash: string;
          slot: number;
          tokenAddress: string;
          decimals: number;
          owner: string;
          blockUnixTime: number;
          blockHumanTime: string;
          creator?: string;
        };
      }>(
        {
          method: 'GET',
          url: '/defi/token_creation_info',
          params: {
            address: tokenAddress,
          },
          headers: {
            'x-chain': 'solana',
          },
        },
        3
      );

      if (!result) {
        return null;
      }

      const { response, apiKey } = result;

      if (response.status === 200 && response.data?.success && response.data?.data) {
        this.updateKeyUsage(apiKey);

        // Record API usage (minimal credit cost for non-OHLCV endpoints)
        recordApiUsage('birdeye', 1);

        const data = response.data.data;
        return {
          txHash: data.txHash,
          slot: data.slot,
          tokenAddress: data.tokenAddress,
          decimals: data.decimals,
          owner: data.owner,
          blockUnixTime: data.blockUnixTime,
          blockHumanTime: data.blockHumanTime,
          creator: data.creator,
        };
      }

      if (response.status === 404) {
        logger.debug('Token creation info not found in Birdeye', {
          tokenAddress: tokenAddress,
        });
        return null;
      }

      return null;
    } catch (error: unknown) {
      logger.error('Failed to fetch token creation info', {
        error: error instanceof Error ? error.message : String(error),
        tokenAddress: tokenAddress,
      });
      return null;
    }
  }

  /**
   * Calculate credits for Birdeye API call
   * Overrides base class method to use Birdeye-specific credit calculation
   */
  protected calculateCredits(
    config: AxiosRequestConfig,
    statusCode: number | undefined,
    success: boolean
  ): number {
    if (!success || !statusCode || statusCode < 200 || statusCode >= 300) {
      return 0;
    }

    // Try to extract candle count from response if available
    // This is a best-effort calculation - actual credits depend on response size
    // For OHLCV endpoints, we estimate based on typical response sizes
    const url = config.url || '';
    if (url.includes('/defi/ohlcv')) {
      // Default to 5000-candle pricing (120 credits) for OHLCV endpoints
      // Actual calculation would require response data, which we don't have here
      // The event log will record the estimated cost, and we can refine this later
      return this.CREDITS_FOR_5000_CANDLES;
    }

    // For other endpoints, use minimal credit cost
    return this.CREDITS_FOR_LESS_THAN_1000;
  }
}

// Lazy singleton - only created when accessed
let _birdeyeClient: BirdeyeClient | null = null;

/**
 * Get the singleton BirdeyeClient instance.
 * Uses lazy initialization to allow mocking during tests.
 */
export function getBirdeyeClient(): BirdeyeClient {
  if (!_birdeyeClient) {
    _birdeyeClient = new BirdeyeClient();
  }
  return _birdeyeClient;
}

/**
 * Reset the singleton instance (for testing purposes).
 */
export function resetBirdeyeClient(): void {
  _birdeyeClient = null;
}

// For backward compatibility - lazy getter
export const birdeyeClient = new Proxy({} as BirdeyeClient, {
  get(_target, prop) {
    const client = getBirdeyeClient();
    return (client as unknown as Record<string, unknown>)[prop as string];
  },
});
