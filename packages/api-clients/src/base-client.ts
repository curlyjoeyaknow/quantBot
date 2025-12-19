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
import type { EventLogService } from '@quantbot/observability';
import type { PrometheusMetricsService } from '@quantbot/observability';

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
  /** Optional event log service for billing-grade tracking */
  eventLogService?: EventLogService;
  /** Optional Prometheus metrics service */
  prometheusMetrics?: PrometheusMetricsService;
  /** Optional run ID for tracking */
  runId?: string;
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
  getRetryAfter(headers: Record<string, string | string[] | undefined>): number | undefined {
    if (this.retryAfterHeader) {
      const header = headers[this.retryAfterHeader];
      if (!header) return undefined;
      const headerValue = Array.isArray(header) ? header[0] : header;
      if (typeof headerValue !== 'string') return undefined;
      const retryAfter = parseInt(headerValue, 10);
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
  protected eventLogService?: EventLogService;
  protected prometheusMetrics?: PrometheusMetricsService;
  protected runId?: string;

  constructor(config: BaseApiClientConfig) {
    this.apiName = config.apiName || 'API';
    this.eventLogService = config.eventLogService;
    this.prometheusMetrics = config.prometheusMetrics;
    this.runId = config.runId;

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
      (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Request interceptor error', {
          error: errorMessage,
          apiName: this.apiName,
        });
        return Promise.reject(error);
      }
    );

    // Setup response interceptor for error handling and event logging
    this.axiosInstance.interceptors.response.use(
      async (response) => {
        // Log successful API call
        await this.logApiCall(response.config, response.status, response.statusText, null);
        return response;
      },
      async (error: AxiosError) => {
        const startTime = (error.config as AxiosRequestConfig & { _startTime?: number })?._startTime;
        const latencyMs = startTime ? Date.now() - startTime : 0;

        // Handle rate limiting
        if (error.response?.status === 429) {
          const retryAfter = this.rateLimiter?.getRetryAfter(
            error.response.headers as Record<string, string | string[] | undefined>
          );
          if (retryAfter) {
            const rateLimitError = new RateLimitError(
              `Rate limit exceeded for ${this.apiName}`,
              retryAfter,
              { apiName: this.apiName }
            );
            await this.logApiCall(
              error.config,
              error.response.status,
              error.response.statusText,
              rateLimitError,
              latencyMs
            );
            throw rateLimitError;
          }
        }

        // Handle timeout
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
          const timeoutError = new TimeoutError(
            `Request to ${this.apiName} timed out`,
            this.axiosInstance.defaults.timeout as number,
            { apiName: this.apiName }
          );
          await this.logApiCall(error.config, undefined, 'timeout', timeoutError, latencyMs);
          throw timeoutError;
        }

        // Handle API errors
        if (error.response) {
          const apiError = new ApiError(
            error.response.statusText || error.message,
            this.apiName,
            error.response.status,
            error.response.data,
            {
              url: error.config?.url,
              method: error.config?.method,
            }
          );
          await this.logApiCall(
            error.config,
            error.response.status,
            error.response.statusText,
            apiError,
            latencyMs
          );
          throw apiError;
        }

        // Handle network errors
        if (error.request) {
          const networkError = new ApiError(
            `Network error: ${error.message}`,
            this.apiName,
            undefined,
            undefined,
            { url: error.config?.url }
          );
          await this.logApiCall(error.config, undefined, 'network_error', networkError, latencyMs);
          throw networkError;
        }

        await this.logApiCall(error.config, undefined, 'unknown_error', error, latencyMs);
        throw error;
      }
    );

    // Setup request interceptor to track start time
    this.axiosInstance.interceptors.request.use(
      (config) => {
        (config as AxiosRequestConfig & { _startTime?: number })._startTime = Date.now();
        return config;
      },
      (error) => Promise.reject(error)
    );
  }

  /**
   * Make a request with retry logic
   */
  protected async request<T = unknown>(
    config: AxiosRequestConfig & { _retry?: boolean }
  ): Promise<AxiosResponse<T>> {
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

            if (!isRetryable || config._retry) {
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
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'GET', url });
    return response.data;
  }

  /**
   * POST request
   */
  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'POST', url, data });
    return response.data;
  }

  /**
   * PUT request
   */
  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'PUT', url, data });
    return response.data;
  }

  /**
   * DELETE request
   */
  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.request<T>({ ...config, method: 'DELETE', url });
    return response.data;
  }

  /**
   * Get axios instance for advanced usage
   */
  getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }

  /**
   * Log API call to event log and Prometheus
   */
  private async logApiCall(
    config: AxiosRequestConfig | undefined,
    statusCode: number | undefined,
    statusText: string | undefined,
    error: Error | unknown | null,
    latencyMs?: number
  ): Promise<void> {
    if (!config) return;

    const startTime = (config as AxiosRequestConfig & { _startTime?: number })._startTime;
    const actualLatency = latencyMs ?? (startTime ? Date.now() - startTime : 0);
    const success = !error && statusCode !== undefined && statusCode >= 200 && statusCode < 300;
    const endpoint = config.url || 'unknown';
    const method = config.method?.toUpperCase() || 'GET';

    // Calculate credits (override in subclasses)
    const credits = this.calculateCredits(config, statusCode, success);

    // Log to event log
    if (this.eventLogService) {
      try {
        await this.eventLogService.logEvent({
          timestamp: new Date(),
          api_name: this.apiName,
          endpoint,
          method,
          status_code: statusCode ?? null,
          success,
          latency_ms: actualLatency,
          credits_cost: credits,
          run_id: this.runId,
          error_message: error instanceof Error ? error.message : error ? String(error) : null,
          metadata: {
            url: config.url,
            method: config.method,
            baseURL: config.baseURL,
          },
        });
      } catch (logError) {
        // Don't break API calls if logging fails
        logger.debug('Failed to log API call event', { error: logError });
      }
    }

    // Record Prometheus metrics
    if (this.prometheusMetrics) {
      try {
        this.prometheusMetrics.recordApiCall(
          this.apiName,
          endpoint,
          statusCode ?? 0,
          actualLatency,
          credits
        );

        if (error) {
          const errorType =
            error instanceof RateLimitError
              ? 'rate_limit'
              : error instanceof TimeoutError
                ? 'timeout'
                : error instanceof ApiError
                  ? `api_error_${error.apiStatusCode ?? 'unknown'}`
                  : 'unknown_error';
          this.prometheusMetrics.recordApiError(this.apiName, endpoint, errorType);
        }
      } catch (metricsError) {
        // Don't break API calls if metrics fail
        logger.debug('Failed to record Prometheus metrics', { error: metricsError });
      }
    }
  }

  /**
   * Calculate credits for API call (override in subclasses)
   */
  protected calculateCredits(
    _config: AxiosRequestConfig,
    _statusCode: number | undefined,
    _success: boolean
  ): number {
    // Default: no credits (subclasses should override)
    return 0;
  }
}
