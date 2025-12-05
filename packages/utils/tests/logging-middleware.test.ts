import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRequestId,
  logRequest,
  logResponse,
  logError,
  logPerformance,
  type RequestContext,
} from '../../src/utils/logging-middleware';
import { logger } from '../../src/utils/logger';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('logging-middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRequestId', () => {
    it('should create a unique request ID', () => {
      const id1 = createRequestId();
      const id2 = createRequestId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[a-f0-9]{32}$/); // 16 bytes = 32 hex chars
    });

    it('should create different IDs on each call', () => {
      const ids = Array.from({ length: 10 }, () => createRequestId());
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(10);
    });
  });

  describe('logRequest', () => {
    it('should log incoming request with all context', () => {
      const context: RequestContext = {
        method: 'GET',
        path: '/api/test',
        requestId: 'test-request-id',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      };

      logRequest(context);

      expect(logger.info).toHaveBeenCalledWith('Incoming request', {
        method: 'GET',
        path: '/api/test',
        requestId: 'test-request-id',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('should log request with minimal context', () => {
      const context: RequestContext = {
        method: 'POST',
        path: '/api/data',
      };

      logRequest(context);

      expect(logger.info).toHaveBeenCalledWith('Incoming request', {
        method: 'POST',
        path: '/api/data',
        requestId: undefined,
        ip: undefined,
        userAgent: undefined,
      });
    });
  });

  describe('logResponse', () => {
    it('should log successful response as info', () => {
      const context: RequestContext = {
        method: 'GET',
        path: '/api/test',
        statusCode: 200,
        duration: 150,
        requestId: 'test-request-id',
      };

      logResponse(context);

      expect(logger.info).toHaveBeenCalledWith('Request completed', {
        method: 'GET',
        path: '/api/test',
        statusCode: 200,
        duration: 150,
        requestId: 'test-request-id',
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should log error response (4xx) as warn', () => {
      const context: RequestContext = {
        method: 'GET',
        path: '/api/test',
        statusCode: 404,
        duration: 50,
        requestId: 'test-request-id',
      };

      logResponse(context);

      expect(logger.warn).toHaveBeenCalledWith('Request completed', {
        method: 'GET',
        path: '/api/test',
        statusCode: 404,
        duration: 50,
        requestId: 'test-request-id',
      });
    });

    it('should log server error (5xx) as warn', () => {
      const context: RequestContext = {
        method: 'POST',
        path: '/api/data',
        statusCode: 500,
        duration: 200,
        requestId: 'test-request-id',
      };

      logResponse(context);

      expect(logger.warn).toHaveBeenCalledWith('Request completed', {
        method: 'POST',
        path: '/api/data',
        statusCode: 500,
        duration: 200,
        requestId: 'test-request-id',
      });
    });

    it('should handle missing statusCode', () => {
      const context: RequestContext = {
        method: 'GET',
        path: '/api/test',
        requestId: 'test-request-id',
      };

      logResponse(context);

      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('logError', () => {
    it('should log error with request context', () => {
      const error = new Error('Test error');
      const context: RequestContext = {
        method: 'POST',
        path: '/api/data',
        requestId: 'test-request-id',
        statusCode: 500,
      };

      logError(error, context);

      expect(logger.error).toHaveBeenCalledWith('Request error', error, {
        method: 'POST',
        path: '/api/data',
        requestId: 'test-request-id',
        statusCode: 500,
      });
    });

    it('should handle unknown error types', () => {
      const error = 'String error';
      const context: RequestContext = {
        method: 'GET',
        path: '/api/test',
        requestId: 'test-request-id',
      };

      logError(error, context);

      expect(logger.error).toHaveBeenCalledWith('Request error', error, {
        method: 'GET',
        path: '/api/test',
        requestId: 'test-request-id',
        statusCode: undefined,
      });
    });
  });

  describe('logPerformance', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should log performance for successful operation', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const wrapped = logPerformance(fn, 'test-operation', { userId: '123' });

      const promise = wrapped('arg1', 'arg2');
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
      expect(logger.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          userId: '123',
          requestId: expect.any(String),
        })
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Completed test-operation',
        expect.objectContaining({
          userId: '123',
          requestId: expect.any(String),
          duration: expect.any(Number),
          success: true,
        })
      );
    });

    it('should log performance for failed operation', async () => {
      const error = new Error('Operation failed');
      const fn = vi.fn().mockRejectedValue(error);
      const wrapped = logPerformance(fn, 'test-operation', { userId: '123' });

      const promise = wrapped();
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Operation failed');

      expect(logger.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          userId: '123',
        })
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Failed test-operation',
        error,
        expect.objectContaining({
          userId: '123',
          duration: expect.any(Number),
          success: false,
        })
      );
    });

    it('should generate requestId if not provided', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const wrapped = logPerformance(fn, 'test-operation');

      const promise = wrapped();
      await vi.runAllTimersAsync();
      await promise;

      expect(logger.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          requestId: expect.any(String),
        })
      );
    });

    it('should use provided requestId from context', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const wrapped = logPerformance(fn, 'test-operation', { requestId: 'custom-id' });

      const promise = wrapped();
      await vi.runAllTimersAsync();
      await promise;

      expect(logger.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          requestId: 'custom-id',
        })
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Completed test-operation',
        expect.objectContaining({
          requestId: 'custom-id',
        })
      );
    });

    it('should preserve function arguments', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const wrapped = logPerformance(fn, 'test-operation');

      const promise = wrapped('arg1', 'arg2', 'arg3');
      await vi.runAllTimersAsync();
      await promise;

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    it('should preserve return value', async () => {
      const fn = vi.fn().mockResolvedValue({ data: 'test' });
      const wrapped = logPerformance(fn, 'test-operation');

      const promise = wrapped();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ data: 'test' });
    });
  });
});
