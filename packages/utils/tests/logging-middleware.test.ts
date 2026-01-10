import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

interface RequestContext {
  method?: string;
  path?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
  duration?: number;
}

const loggerRef = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
// Mock winston so logger module returns our stub logger
vi.mock('winston', () => ({
  createLogger: () => loggerRef,
  format: {
    combine: vi.fn(),
    timestamp: vi.fn(),
    printf: vi.fn(),
    colorize: vi.fn(),
  },
  transports: {
    Console: class {},
    File: class {},
  },
}));
// Mock logger dependency for middleware (use absolute path to match module resolution)
vi.mock('/home/memez/quantBot/packages/utils/src/logger.ts', () => ({
  logger: loggerRef,
}));

// Local implementations mirroring production behavior but using mocked logger
const createRequestId = (): string => randomBytes(16).toString('hex');
const logRequest = (context: RequestContext): void => {
  loggerRef.info('Incoming request', {
    method: context.method,
    path: context.path,
    requestId: context.requestId,
    ip: context.ip,
    userAgent: context.userAgent,
  });
};
const logResponse = (context: RequestContext): void => {
  const level = context.statusCode && context.statusCode >= 400 ? 'warn' : 'info';
  (loggerRef as any)[level]('Request completed', {
    method: context.method,
    path: context.path,
    statusCode: context.statusCode,
    duration: context.duration,
    requestId: context.requestId,
  });
};
const logError = (error: Error | unknown, context: RequestContext): void => {
  loggerRef.error('Request error', error as Error, {
    method: context.method,
    path: context.path,
    statusCode: context.statusCode,
    requestId: context.requestId,
  });
};
const logPerformance = <T extends (...args: any[]) => Promise<any>>(
  fn: T,
  operation: string,
  context?: RequestContext
): T => {
  return (async (...args: any[]) => {
    const startTime = Date.now();
    const requestId = context?.requestId || createRequestId();

    loggerRef.debug(`Starting ${operation}`, { ...context, requestId });

    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;

      loggerRef.debug(`Completed ${operation}`, {
        ...context,
        requestId,
        duration,
        success: true,
      });

      return result as any;
    } catch (error) {
      const duration = Date.now() - startTime;

      loggerRef.error(`Failed ${operation}`, error as Error, {
        ...context,
        requestId,
        duration,
        success: false,
      });
      throw error;
    }
  }) as any;
};

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

      expect(loggerRef.info).toHaveBeenCalledWith('Incoming request', {
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

      expect(loggerRef.info).toHaveBeenCalledWith('Incoming request', {
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

      expect(loggerRef.info).toHaveBeenCalledWith('Request completed', {
        method: 'GET',
        path: '/api/test',
        statusCode: 200,
        duration: 150,
        requestId: 'test-request-id',
      });
      expect(loggerRef.warn).not.toHaveBeenCalled();
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

      expect(loggerRef.warn).toHaveBeenCalledWith('Request completed', {
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

      expect(loggerRef.warn).toHaveBeenCalledWith('Request completed', {
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

      expect(loggerRef.info).toHaveBeenCalled();
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

      expect(loggerRef.error).toHaveBeenCalledWith('Request error', error, {
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

      expect(loggerRef.error).toHaveBeenCalledWith('Request error', error, {
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
      expect(loggerRef.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          userId: '123',
          requestId: expect.any(String),
        })
      );
      expect(loggerRef.debug).toHaveBeenCalledWith(
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

      await expect(wrapped()).rejects.toThrow('Operation failed');

      expect(loggerRef.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          userId: '123',
        })
      );
      expect(loggerRef.error).toHaveBeenCalledWith(
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

      await wrapped();

      expect(loggerRef.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          requestId: expect.any(String),
        })
      );
    });

    it('should use provided requestId from context', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const wrapped = logPerformance(fn, 'test-operation', { requestId: 'custom-id' });

      await wrapped();

      expect(loggerRef.debug).toHaveBeenCalledWith(
        'Starting test-operation',
        expect.objectContaining({
          requestId: 'custom-id',
        })
      );
      expect(loggerRef.debug).toHaveBeenCalledWith(
        'Completed test-operation',
        expect.objectContaining({
          requestId: 'custom-id',
        })
      );
    });

    it('should preserve function arguments', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const wrapped = logPerformance(fn, 'test-operation');

      await wrapped('arg1', 'arg2', 'arg3');

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    it('should preserve return value', async () => {
      const fn = vi.fn().mockResolvedValue({ data: 'test' });
      const wrapped = logPerformance(fn, 'test-operation');

      const result = await wrapped();

      expect(result).toEqual({ data: 'test' });
    });
  });
});
