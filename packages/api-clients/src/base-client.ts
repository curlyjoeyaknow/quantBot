/**
 * Base API Client
 * ===============
 * Unified API client base with retry logic, rate limiting, and error handling.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError, AxiosResponse } from 'axios';
import {
  logger,
  ApiError,
  RateLimitError,
  TimeoutError,
  isRetryableError,
  retryWithBackoff,
} from '@quantbot/utils';

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  retryAfterHeader?: string;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs?: number;
  retryableStatusCodes?: number[];
}

/**
 * Base API client configuration
 */
export interface BaseApiClientConfig {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
  rateLimiter?: RateLimiterConfig;
  retry?: RetryConfig;
  apiName?: string;
  /** Optional axios instance for testing */
  axiosInstance?: AxiosInstance;
}

/**
 * Rate limiter implementation
 */
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly retryAfterHeader?: string;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
    this.retryAfterHeader = config.retryAfterHeader;
  }

  /**
   * Check if request can be made
   */
  canMakeRequest(): boolean {
    const now = Date.now();
    // Remove old requests outside the window
    this.requests = this.requests.filter((timestamp) => now - timestamp < this.windowMs);
    return this.requests.length < this.maxRequests;
  }

  /**
   * Record a request
   * Also cleans up expired requests to prevent memory leaks
   */
  recordRequest(): void {
    const now = Date.now();
    // Clean up expired requests before adding new one
    this.requests = this.requests.filter((timestamp) => now - timestamp < this.windowMs);
    this.requests.push(now);
  }

  /**
   * Get time until next request can be made
   */
  getTimeUntilNextRequest(): number {
    if (this.requests.length === 0) return 0;
    const oldestRequest = this.requests[0];
    const now = Date.now();
    const elapsed = now - oldestRequest;
    return Math.max(0, this.windowMs - elapsed);
  }

  /**
   * Extract retry-after from response headers
   */
  getRetryAfter(headers: Record<string, any>): number | undefined {
    if (this.retryAfterHeader && headers[this.retryAfterHeader]) {
      const retryAfter = parseInt(headers[this.retryAfterHeader], 10);
      return isNaN(retryAfter) ? undefined : retryAfter * 1000; // Convert to milliseconds
    }
    return undefined;
  }
}

/**
 * Base API client with retry logic and rate limiting
 */
export class BaseApiClient {
  protected axiosInstance: AxiosInstance;
  protected rateLimiter?: RateLimiter;
  protected retryConfig?: RetryConfig;
  protected apiName: string;

  constructor(config: BaseApiClientConfig) {
    this.apiName = config.apiName || 'API';

    // Use injected axios instance or create a new one
    this.axiosInstance =
      config.axiosInstance ??
      axios.create({
        baseURL: config.baseURL,
        timeout: config.timeout || 30000,
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
      });

    // Setup rate limiter
    if (config.rateLimiter) {
      this.rateLimiter = new RateLimiter(config.rateLimiter);
    }

    // Setup retry config
    this.retryConfig = config.retry || {
      maxRetries: 3,
      initialDelayMs: 1000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
    };

    // Setup request interceptor for rate limiting
    this.axiosInstance.interceptors.request.use(
      async (config) => {
        if (this.rateLimiter) {
          while (!this.rateLimiter.canMakeRequest()) {
            const waitTime = this.rateLimiter.getTimeUntilNextRequest();
            if (waitTime > 0) {
              logger.debug('Rate limit reached, waiting', {
                apiName: this.apiName,
                waitTimeMs: waitTime,
              });
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }
          }
          this.rateLimiter.recordRequest();
        }
        return config;
      },
      (error) => {
        logger.error('Request interceptor error', error as Error, { apiName: this.apiName });
        return Promise.reject(error);
      }
    );

    // Setup response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

        // Handle rate limiting
        if (error.response?.status === 429) {
          const retryAfter = this.rateLimiter?.getRetryAfter(
            error.response.headers as Record<string, any>
          );
          if (retryAfter) {
            throw new RateLimitError(`Rate limit exceeded for ${this.apiName}`, retryAfter, {
              apiName: this.apiName,
            });
          }
        }

        // Handle timeout
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          throw new TimeoutError(
            `Request to ${this.apiName} timed out`,
            this.axiosInstance.defaults.timeout as number,
            { apiName: this.apiName }
          );
        }

        // Handle API errors
        if (error.response) {
          throw new ApiError(
            error.response.statusText || error.message,
            this.apiName,
            error.response.status,
            error.response.data,
            {
              url: error.config?.url,
              method: error.config?.method,
            }
          );
        }

        // Handle network errors
        if (error.request) {
          throw new ApiError(
            `Network error: ${error.message}`,
            this.apiName,
            undefined,
            undefined,
            { url: error.config?.url }
          );
        }

        throw error;
      }
    );
  }

  /**
   * Make a request with retry logic
   */
  protected async request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return retryWithBackoff(
      async () => {
        try {
          return await this.axiosInstance.request<T>(config);
        } catch (error) {
          // Check if error is retryable
          if (error instanceof ApiError && this.retryConfig) {
            const statusCode = error.apiStatusCode;
            const isRetryable = statusCode
              ? this.retryConfig.retryableStatusCodes?.includes(statusCode)
              : isRetryableError(error);

            if (!isRetryable || (config as any)._retry) {
              throw error;
            }
          }
          throw error;
        }
      },
      this.retryConfig?.maxRetries ?? 3,
      this.retryConfig?.initialDelayMs ?? 1000,
      {
        apiName: this.apiName,
        method: config.method,
        url: config.url,
      }
    );
  }

  /**
   * GET request
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'GET', url });
    return response.data;
  }

  /**
   * POST request
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'POST', url, data });
    return response.data;
  }

  /**
   * PUT request
   */
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'PUT', url, data });
    return response.data;
  }

  /**
   * DELETE request
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'DELETE', url });
    return response.data;
  }

  /**
   * Get axios instance for advanced usage
   */
  getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }
}
