/**
 * Base API Client
 * ===============
 * Unified API client base with retry logic, rate limiting, and error handling.
 */
import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
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
}
/**
 * Rate limiter implementation
 */
declare class RateLimiter {
    private requests;
    private readonly maxRequests;
    private readonly windowMs;
    private readonly retryAfterHeader?;
    constructor(config: RateLimiterConfig);
    /**
     * Check if request can be made
     */
    canMakeRequest(): boolean;
    /**
     * Record a request
     */
    recordRequest(): void;
    /**
     * Get time until next request can be made
     */
    getTimeUntilNextRequest(): number;
    /**
     * Extract retry-after from response headers
     */
    getRetryAfter(headers: Record<string, any>): number | undefined;
}
/**
 * Base API client with retry logic and rate limiting
 */
export declare class BaseApiClient {
    protected axiosInstance: AxiosInstance;
    protected rateLimiter?: RateLimiter;
    protected retryConfig?: RetryConfig;
    protected apiName: string;
    constructor(config: BaseApiClientConfig);
    /**
     * Make a request with retry logic
     */
    protected request<T = any>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    /**
     * GET request
     */
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
    /**
     * POST request
     */
    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
    /**
     * PUT request
     */
    put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>;
    /**
     * DELETE request
     */
    delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>;
    /**
     * Get axios instance for advanced usage
     */
    getAxiosInstance(): AxiosInstance;
}
export {};
//# sourceMappingURL=base-client.d.ts.map