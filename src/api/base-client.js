"use strict";
/**
 * Base API Client
 * ===============
 * Unified API client base with retry logic, rate limiting, and error handling.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseApiClient = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const error_handler_1 = require("../utils/error-handler");
/**
 * Rate limiter implementation
 */
class RateLimiter {
    constructor(config) {
        this.requests = [];
        this.maxRequests = config.maxRequests;
        this.windowMs = config.windowMs;
        this.retryAfterHeader = config.retryAfterHeader;
    }
    /**
     * Check if request can be made
     */
    canMakeRequest() {
        const now = Date.now();
        // Remove old requests outside the window
        this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);
        return this.requests.length < this.maxRequests;
    }
    /**
     * Record a request
     */
    recordRequest() {
        this.requests.push(Date.now());
    }
    /**
     * Get time until next request can be made
     */
    getTimeUntilNextRequest() {
        if (this.requests.length === 0)
            return 0;
        const oldestRequest = this.requests[0];
        const now = Date.now();
        const elapsed = now - oldestRequest;
        return Math.max(0, this.windowMs - elapsed);
    }
    /**
     * Extract retry-after from response headers
     */
    getRetryAfter(headers) {
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
class BaseApiClient {
    constructor(config) {
        this.apiName = config.apiName || 'API';
        // Create axios instance
        this.axiosInstance = axios_1.default.create({
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
        this.axiosInstance.interceptors.request.use(async (config) => {
            if (this.rateLimiter) {
                while (!this.rateLimiter.canMakeRequest()) {
                    const waitTime = this.rateLimiter.getTimeUntilNextRequest();
                    if (waitTime > 0) {
                        logger_1.logger.debug('Rate limit reached, waiting', {
                            apiName: this.apiName,
                            waitTimeMs: waitTime,
                        });
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                this.rateLimiter.recordRequest();
            }
            return config;
        }, (error) => {
            logger_1.logger.error('Request interceptor error', error, { apiName: this.apiName });
            return Promise.reject(error);
        });
        // Setup response interceptor for error handling
        this.axiosInstance.interceptors.response.use((response) => response, async (error) => {
            const originalRequest = error.config;
            // Handle rate limiting
            if (error.response?.status === 429) {
                const retryAfter = this.rateLimiter?.getRetryAfter(error.response.headers);
                if (retryAfter) {
                    throw new errors_1.RateLimitError(`Rate limit exceeded for ${this.apiName}`, retryAfter, { apiName: this.apiName });
                }
            }
            // Handle timeout
            if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                throw new errors_1.TimeoutError(`Request to ${this.apiName} timed out`, this.axiosInstance.defaults.timeout, { apiName: this.apiName });
            }
            // Handle API errors
            if (error.response) {
                throw new errors_1.ApiError(error.response.statusText || error.message, this.apiName, error.response.status, error.response.data, {
                    url: error.config?.url,
                    method: error.config?.method,
                });
            }
            // Handle network errors
            if (error.request) {
                throw new errors_1.ApiError(`Network error: ${error.message}`, this.apiName, undefined, undefined, { url: error.config?.url });
            }
            throw error;
        });
    }
    /**
     * Make a request with retry logic
     */
    async request(config) {
        return (0, error_handler_1.retryWithBackoff)(async () => {
            try {
                return await this.axiosInstance.request(config);
            }
            catch (error) {
                // Check if error is retryable
                if (error instanceof errors_1.ApiError && this.retryConfig) {
                    const statusCode = error.apiStatusCode;
                    const isRetryable = statusCode
                        ? this.retryConfig.retryableStatusCodes?.includes(statusCode)
                        : (0, errors_1.isRetryableError)(error);
                    if (!isRetryable || config._retry) {
                        throw error;
                    }
                }
                throw error;
            }
        }, this.retryConfig?.maxRetries ?? 3, this.retryConfig?.initialDelayMs ?? 1000, {
            apiName: this.apiName,
            method: config.method,
            url: config.url,
        });
    }
    /**
     * GET request
     */
    async get(url, config) {
        const response = await this.request({ ...config, method: 'GET', url });
        return response.data;
    }
    /**
     * POST request
     */
    async post(url, data, config) {
        const response = await this.request({ ...config, method: 'POST', url, data });
        return response.data;
    }
    /**
     * PUT request
     */
    async put(url, data, config) {
        const response = await this.request({ ...config, method: 'PUT', url, data });
        return response.data;
    }
    /**
     * DELETE request
     */
    async delete(url, config) {
        const response = await this.request({ ...config, method: 'DELETE', url });
        return response.data;
    }
    /**
     * Get axios instance for advanced usage
     */
    getAxiosInstance() {
        return this.axiosInstance;
    }
}
exports.BaseApiClient = BaseApiClient;
//# sourceMappingURL=base-client.js.map