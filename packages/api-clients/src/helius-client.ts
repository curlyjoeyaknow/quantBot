import { AxiosInstance } from 'axios';
import { logger, ConfigurationError } from '@quantbot/utils';
import { recordApiUsage } from '@quantbot/observability';
import { BaseApiClient } from './base-client';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_REST_URL = process.env.HELIUS_REST_URL || 'https://api.helius.xyz';

export interface AddressTransactionsOptions {
  before?: string;
  limit?: number;
}

export interface HeliusRestClientConfig {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  /** Optional axios instance for testing */
  axiosInstance?: AxiosInstance;
}

export interface HeliusTransaction {
  // Define proper type structure based on Helius API response
  [key: string]: unknown;
}

export class HeliusRestClient extends BaseApiClient {
  private readonly apiKey: string;

  constructor(config: HeliusRestClientConfig = {}) {
    const apiKey = config.apiKey ?? HELIUS_API_KEY;
    const baseURL = config.baseURL ?? HELIUS_REST_URL;

    // Initialize BaseApiClient
    super({
      baseURL,
      apiName: 'Helius',
      timeout: config.timeout ?? 10_000,
      rateLimiter: {
        maxRequests: 100,
        windowMs: 60000, // 1 minute
      },
      retry: {
        maxRetries: 3,
        initialDelayMs: 1000,
        retryableStatusCodes: [429, 500, 502, 503, 504],
      },
      axiosInstance: config.axiosInstance,
    });

    this.apiKey = apiKey;

    // Set API key in default headers if provided
    if (this.apiKey) {
      this.axiosInstance.defaults.headers.common['api-key'] = this.apiKey;
    }
  }

  async getTransactionsForAddress(
    address: string,
    options: AddressTransactionsOptions = {}
  ): Promise<HeliusTransaction[]> {
    if (!this.apiKey) {
      throw new ConfigurationError('HELIUS_API_KEY missing', 'HELIUS_API_KEY');
    }

    const params: Record<string, unknown> = {
      'api-key': this.apiKey,
      limit: options.limit ?? 100,
    };
    if (options.before) {
      params.before = options.before;
    }

    try {
      const url = `/v0/addresses/${address}/transactions`;
      const data = await this.get<HeliusTransaction[]>(url, { params });

      if (!Array.isArray(data)) {
        return [];
      }

      // Record API usage (100 credits per call as per helius-backfill-service)
      recordApiUsage('helius', 100, {
        endpoint: '/v0/addresses/:address/transactions',
        transactionCount: data.length,
      }).catch((error: unknown) => {
        logger.warn('Failed to record API usage', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return data;
    } catch (error: unknown) {
      logger.error('Helius REST call failed', {
        error: error instanceof Error ? error.message : String(error),
        address: address.substring(0, 20),
      });
      throw error;
    }
  }

  async getTransactions(signatures: string[]): Promise<HeliusTransaction[]> {
    if (!this.apiKey) {
      throw new ConfigurationError('HELIUS_API_KEY missing', 'HELIUS_API_KEY');
    }
    if (!Array.isArray(signatures) || signatures.length === 0) {
      return [];
    }
    try {
      const url = `/v0/transactions/?api-key=${this.apiKey}`;
      const data = await this.post<HeliusTransaction[]>(url, signatures);

      if (!Array.isArray(data)) {
        return [];
      }

      // Record API usage (100 credits per call)
      recordApiUsage('helius', 100, {
        endpoint: '/v0/transactions',
        signatureCount: signatures.length,
        transactionCount: data.length,
      }).catch((error: unknown) => {
        logger.warn('Failed to record API usage', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return data;
    } catch (error: unknown) {
      logger.error('Helius transaction fetch failed', {
        error: error instanceof Error ? error.message : String(error),
        count: signatures.length,
      });
      throw error;
    }
  }
}

export const heliusRestClient = new HeliusRestClient();
