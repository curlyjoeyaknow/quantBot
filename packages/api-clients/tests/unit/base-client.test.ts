/**
 * Tests for base-client.ts
 *
 * Tests cover:
 * - Initialization with dependency injection
 * - Rate limiting setup
 * - Retry config
 * - HTTP methods (GET, POST, PUT, DELETE)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BaseApiClient,
  type BaseApiClientConfig,
  type RateLimiterConfig,
  type RetryConfig,
} from '@quantbot/api-clients/base-client';

// Mock utils
vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public apiName: string,
      public apiStatusCode?: number
    ) {
      super(message);
    }
  },
  RateLimitError: class RateLimitError extends Error {
    constructor(
      message: string,
      public retryAfter: number
    ) {
      super(message);
    }
  },
  TimeoutError: class TimeoutError extends Error {
    constructor(
      message: string,
      public timeout: number
    ) {
      super(message);
    }
  },
  isRetryableError: vi.fn(() => false),
  retryWithBackoff: vi.fn(async (fn) => await fn()),
}));

describe('BaseApiClient', () => {
  let mockAxiosInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create mock axios instance
    mockAxiosInstance = {
      request: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { timeout: 30000 },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should use injected axios instance', () => {
      const config: BaseApiClientConfig = {
        baseURL: 'https://api.example.com',
        axiosInstance: mockAxiosInstance,
      };

      const client = new BaseApiClient(config);

      expect(client).toBeDefined();
      expect(client.getAxiosInstance()).toBe(mockAxiosInstance);
    });

    it('should setup rate limiter when configured', () => {
      const rateLimiterConfig: RateLimiterConfig = {
        maxRequests: 10,
        windowMs: 1000,
      };

      const config: BaseApiClientConfig = {
        baseURL: 'https://api.example.com',
        rateLimiter: rateLimiterConfig,
        axiosInstance: mockAxiosInstance,
      };

      const client = new BaseApiClient(config);

      expect(client).toBeDefined();
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
    });

    it('should setup retry config with defaults', () => {
      const config: BaseApiClientConfig = {
        baseURL: 'https://api.example.com',
        axiosInstance: mockAxiosInstance,
      };

      const client = new BaseApiClient(config);

      expect(client).toBeDefined();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it('should use custom retry config', () => {
      const retryConfig: RetryConfig = {
        maxRetries: 5,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
        retryableStatusCodes: [500, 502, 503],
      };

      const config: BaseApiClientConfig = {
        baseURL: 'https://api.example.com',
        retry: retryConfig,
        axiosInstance: mockAxiosInstance,
      };

      const client = new BaseApiClient(config);

      expect(client).toBeDefined();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('HTTP Methods', () => {
    let client: BaseApiClient;
    let mockResponse: any;

    beforeEach(() => {
      mockResponse = {
        data: { result: 'success' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockAxiosInstance.request.mockResolvedValue(mockResponse);

      const config: BaseApiClientConfig = {
        baseURL: 'https://api.example.com',
        axiosInstance: mockAxiosInstance,
      };

      client = new BaseApiClient(config);
    });

    it('should make GET request', async () => {
      const result = await client.get('/test');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/test',
        })
      );
      expect(result).toEqual({ result: 'success' });
    });

    it('should make POST request', async () => {
      const data = { key: 'value' };
      const result = await client.post('/test', data);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/test',
          data,
        })
      );
      expect(result).toEqual({ result: 'success' });
    });

    it('should make PUT request', async () => {
      const data = { key: 'value' };
      const result = await client.put('/test', data);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: '/test',
          data,
        })
      );
      expect(result).toEqual({ result: 'success' });
    });

    it('should make DELETE request', async () => {
      const result = await client.delete('/test');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          url: '/test',
        })
      );
      expect(result).toEqual({ result: 'success' });
    });

    it('should pass additional config to requests', async () => {
      const additionalConfig = { params: { foo: 'bar' } };
      await client.get('/test', additionalConfig);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/test',
          params: { foo: 'bar' },
        })
      );
    });
  });

  describe('getAxiosInstance', () => {
    it('should return the axios instance', () => {
      const config: BaseApiClientConfig = {
        baseURL: 'https://api.example.com',
        axiosInstance: mockAxiosInstance,
      };

      const client = new BaseApiClient(config);
      const instance = client.getAxiosInstance();

      expect(instance).toBe(mockAxiosInstance);
    });
  });
});
