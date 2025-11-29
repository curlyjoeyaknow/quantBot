import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { config } from 'dotenv';
import { logger } from '../utils/logger';

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
}

export class BirdeyeClient {
  private apiKeys: string[];
  private keyUsage: Map<string, APIKeyUsage>;
  private currentKeyIndex: number;
  private axiosInstances: Map<string, AxiosInstance>;
  private baseURL: string = 'https://public-api.birdeye.so';
  private readonly TOTAL_CREDITS: number = 3180000; // 3.18M credits
  private readonly CREDITS_PER_REQUEST: number = 1; // Estimated credits per OHLCV request

  constructor() {
    this.apiKeys = this.loadAPIKeys();
    this.keyUsage = new Map();
    this.currentKeyIndex = 0;
    this.axiosInstances = new Map();

    this.initializeAPIKeys();
  }

  /**
   * Load API keys from environment variables
   */
  private loadAPIKeys(): string[] {
    const keys: string[] = [];
    
    // Load up to 6 keys, but be flexible with fewer keys
    for (let i = 1; i <= 6; i++) {
      const key = process.env[`BIRDEYE_API_KEY_${i}`];
      if (key && key.trim() !== '') {
        keys.push(key.trim());
      }
    }

    if (keys.length === 0) {
      throw new Error('No Birdeye API keys found in environment variables');
    }

    logger.info('Loaded Birdeye API keys', { keyCount: keys.length, totalCredits: '~3.18M' });
    return keys;
  }

  /**
   * Initialize API key usage tracking
   */
  private initializeAPIKeys(): void {
    this.apiKeys.forEach(key => {
      this.keyUsage.set(key, {
        key,
        requestsUsed: 0,
        lastUsed: new Date(),
        isActive: true,
        estimatedCreditsUsed: 0
      });

      // Create axios instance for each key
      this.axiosInstances.set(key, axios.create({
        baseURL: this.baseURL,
        timeout: 10000,
        headers: {
          'X-API-KEY': key,
          'accept': 'application/json',
          'x-chain': 'solana'
        }
      }));
    });
  }

  /**
   * Get the next available API key using round-robin
   */
  private getNextAPIKey(): string {
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
   */
  private updateKeyUsage(key: string): void {
    const usage = this.keyUsage.get(key);
    if (usage) {
      usage.requestsUsed++;
      usage.estimatedCreditsUsed += this.CREDITS_PER_REQUEST;
      usage.lastUsed = new Date();
      
      // Log credit usage every 100 requests
      if (usage.requestsUsed % 100 === 0) {
        logger.debug('API key credit usage', { keyPrefix: key.substring(0, 8), creditsUsed: usage.estimatedCreditsUsed });
      }
    }
  }

  /**
   * Handle API key deactivation on rate limit
   */
  private deactivateKey(key: string): void {
    const usage = this.keyUsage.get(key);
    if (usage) {
      usage.isActive = false;
      logger.warn('API key deactivated due to rate limit', { keyPrefix: key.substring(0, 8) });
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch OHLCV data with retry logic and exponential backoff
   */
  async fetchOHLCVData(
    tokenAddress: string, 
    startTime: Date, 
    endTime: Date, 
    interval: string = '1m'
  ): Promise<BirdeyeOHLCVResponse | null> {
    const maxRetries = 5;
    const baseDelay = 1000; // 1 second
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const apiKey = this.getNextAPIKey();
      const axiosInstance = this.axiosInstances.get(apiKey);
      
      if (!axiosInstance) {
        logger.error('No axios instance found for API key', { keyPrefix: apiKey.substring(0, 8) });
        continue;
      }

      try {
        const startUnix = Math.floor(startTime.getTime() / 1000);
        const endUnix = Math.floor(endTime.getTime() / 1000);
        
        const url = `/defi/history_price?address=${tokenAddress}&address_type=token&type=${interval}&time_from=${startUnix}&time_to=${endUnix}&ui_amount_mode=raw`;
        
        logger.debug('Fetching OHLCV attempt', { attempt: attempt + 1, maxRetries, tokenAddress, keyPrefix: apiKey.substring(0, 8) });
        
        const response: AxiosResponse<BirdeyeOHLCVResponse> = await axiosInstance.get(url);
        
        if (response.status === 200 && response.data && response.data.items) {
          this.updateKeyUsage(apiKey);
          logger.debug('Successfully fetched OHLCV records', { recordCount: response.data.items.length, tokenAddress });
          return response.data;
        }
        
        throw new Error(`Invalid response: ${response.status}`);
        
      } catch (error: any) {
        logger.warn('OHLCV fetch attempt failed', { attempt: attempt + 1, tokenAddress, error: error.message });
        
        // Handle different error types
        if (error.response) {
          const status = error.response.status;
          
          if (status === 429) {
            // Rate limit - deactivate key and try next one
            this.deactivateKey(apiKey);
            logger.warn('Rate limit hit, switching to next API key', { tokenAddress, attempt: attempt + 1 });
            
            // If this was the last attempt, don't wait
            if (attempt < maxRetries - 1) {
              await this.sleep(baseDelay);
            }
            continue;
            
          } else if (status === 400 || status === 401 || status === 403) {
            // Bad request/auth - don't retry
            logger.error('Bad request/auth error, not retrying', { status, tokenAddress });
            return null;
            
          } else if (status >= 500) {
            // Server error - retry with backoff
            logger.warn('Server error, retrying with backoff', { status, tokenAddress, attempt: attempt + 1 });
          }
        }
        
        // Calculate delay with exponential backoff
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          logger.debug('Waiting before retry', { delayMs: delay, tokenAddress });
          await this.sleep(delay);
        }
      }
    }
    
    logger.error('Failed to fetch OHLCV data after all attempts', { tokenAddress, maxRetries });
    return null;
  }

  /**
   * Get API key usage statistics
   */
  getAPIKeyUsage(): APIKeyUsage[] {
    return Array.from(this.keyUsage.values());
  }

  /**
   * Get total requests made across all keys
   */
  getTotalRequests(): number {
    return Array.from(this.keyUsage.values()).reduce((total, usage) => total + usage.requestsUsed, 0);
  }

  /**
   * Get total credits used across all keys
   */
  getTotalCreditsUsed(): number {
    return Array.from(this.keyUsage.values()).reduce((total, usage) => total + usage.estimatedCreditsUsed, 0);
  }

  /**
   * Get remaining credits estimate
   */
  getRemainingCredits(): number {
    return this.TOTAL_CREDITS - this.getTotalCreditsUsed();
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
    this.keyUsage.forEach(usage => {
      usage.requestsUsed = 0;
      usage.estimatedCreditsUsed = 0;
      usage.isActive = true;
    });
    logger.info('API key usage statistics reset');
  }

  /**
   * Log comprehensive credit usage report
   */
  logCreditUsageReport(): void {
    const totalUsed = this.getTotalCreditsUsed();
    const totalRequests = this.getTotalRequests();
    const remaining = this.getRemainingCredits();
    const percentage = this.getCreditUsagePercentage();
    
    logger.info('Birdeye API credit usage report', {
      totalCredits: this.TOTAL_CREDITS,
      creditsUsed: totalUsed,
      creditsRemaining: remaining,
      percentage: percentage.toFixed(2),
      totalRequests,
      activeKeys: Array.from(this.keyUsage.values()).filter(u => u.isActive).length,
      totalKeys: this.apiKeys.length,
      warning: this.isApproachingCreditLimit() ? 'Approaching credit limit (80%+)' : undefined,
    });
  }

  /**
   * Check if any API keys are still active
   */
  hasActiveKeys(): boolean {
    return Array.from(this.keyUsage.values()).some(usage => usage.isActive);
  }
}

// Export singleton instance
export const birdeyeClient = new BirdeyeClient();
