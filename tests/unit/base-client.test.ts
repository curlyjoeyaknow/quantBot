/**
 * Base API Client Tests
 * =====================
 * Tests for the base API client with rate limiting and retry logic
 */

import axios from 'axios';
import { BaseApiClient, RateLimiterConfig, RetryConfig } from '../../src/api/base-client';
import { ApiError, RateLimitError, TimeoutError } from '../../src/utils/errors';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock error handler
jest.mock('../../src/utils/error-handler', () => ({
  retryWithBackoff: jest.fn((fn) => fn()),
}));

describe('BaseApiClient', () => {
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockAxiosInstance = {
      request: jest.fn(),
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
      defaults: { timeout: 15000 },
    };

    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);
  });

  describe('Initialization', () => {
    it('should create axios instance with baseURL', () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
      });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.example.com',
          timeout: 15000,
        })
      );
    });

    it('should set custom timeout', () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
        timeout: 30000,
      });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('should set custom headers', () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
        headers: { 'X-Custom-Header': 'value' },
      });

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'value',
          }),
        })
      );
    });

    it('should set up request interceptor for rate limiting', () => {
      const rateLimiter: RateLimiterConfig = {
        maxRequests: 10,
        windowMs: 1000,
      };

      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
        rateLimiter,
      });

      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
    });

    it('should set up response interceptor for error handling', () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
      });

      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limit errors', async () => {
      const rateLimiter: RateLimiterConfig = {
        maxRequests: 10,
        windowMs: 1000,
        retryAfterHeader: 'retry-after',
      };

      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
        rateLimiter,
      });

      const error = {
        response: {
          status: 429,
          headers: { 'retry-after': '60' },
        },
        config: {},
      };

      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      
      try {
        await interceptor(error);
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle timeout errors', async () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
      });

      const error = {
        code: 'ECONNABORTED',
        message: 'timeout',
        config: {},
      };

      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      
      try {
        await interceptor(error);
      } catch (e) {
        expect(e).toBeInstanceOf(TimeoutError);
      }
    });

    it('should handle API errors', async () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
        apiName: 'TestAPI',
      });

      const error = {
        response: {
          status: 404,
          statusText: 'Not Found',
          data: { error: 'Resource not found' },
        },
        config: { url: '/test', method: 'GET' },
      };

      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      
      try {
        await interceptor(error);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
      }
    });

    it('should handle network errors', async () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
        apiName: 'TestAPI',
      });

      const error = {
        request: {},
        config: { url: '/test' },
      };

      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      
      try {
        await interceptor(error);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
      }
    });
  });

  describe('HTTP Methods', () => {
    it('should make GET requests', async () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
      });

      mockAxiosInstance.request.mockResolvedValue({ data: { result: 'success' } });

      // Access protected method via any for testing
      const result = await (client as any).get('/test');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/test',
        })
      );
    });

    it('should make POST requests', async () => {
      const client = new BaseApiClient({
        baseURL: 'https://api.example.com',
      });

      mockAxiosInstance.request.mockResolvedValue({ data: { result: 'success' } });

      const data = { key: 'value' };
      await (client as any).post('/test', data);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/test',
          data,
        })
      );
    });
  });
});

