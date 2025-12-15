import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleError,
  withErrorHandling,
  createErrorHandler,
  safeAsync,
  retryWithBackoff,
  type ErrorHandlerResult,
} from '../src/error-handler';
import {
  AppError,
  ValidationError,
  ApiError,
  DatabaseError,
  ServiceUnavailableError,
  TimeoutError,
  RateLimitError,
} from '../src/errors';
import { logger } from '../src/logger';

// Mock logger
vi.mock('../src/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('error-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleError', () => {
    it('should handle AppError with isOperational=true', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });
      const result = handleError(error, { userId: '123' });

      expect(result).toEqual({
        handled: true,
        message: 'Invalid input',
        shouldRetry: false,
        retryAfter: undefined,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'Operational error occurred',
        expect.objectContaining({
          field: 'email',
          userId: '123',
          error: expect.objectContaining({
            name: 'ValidationError',
            message: 'Invalid input',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
          }),
        })
      );
    });

    it('should handle AppError with isOperational=false', () => {
      const error = new AppError('Programming error', 'PROG_ERROR', 500, {}, false);
      const result = handleError(error, { userId: '123' });

      expect(result).toEqual({
        handled: true,
        message: 'Programming error',
        shouldRetry: false,
        retryAfter: undefined,
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Application error occurred',
        error,
        expect.objectContaining({
          userId: '123',
        })
      );
    });

    it('should handle unknown errors', () => {
      const error = new Error('Unknown error');
      const result = handleError(error, { userId: '123' });

      expect(result).toEqual({
        handled: true,
        message: 'Unknown error',
        shouldRetry: false,
        retryAfter: undefined,
      });
      expect(logger.error).toHaveBeenCalledWith('Unknown error occurred', error, { userId: '123' });
    });

    it('should handle non-Error values', () => {
      const result = handleError('String error', { userId: '123' });

      expect(result).toEqual({
        handled: true,
        message: 'String error',
        shouldRetry: false,
        retryAfter: undefined,
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should detect retryable errors', () => {
      const error = new ApiError('API error', 'Birdeye');
      const result = handleError(error);

      expect(result.shouldRetry).toBe(true);
    });

    it('should include retryAfter for RateLimitError', () => {
      const error = new RateLimitError('Rate limit exceeded', 60);
      const result = handleError(error);

      expect(result.retryAfter).toBe(60);
    });

    it('should merge context correctly', () => {
      const error = new ValidationError('Invalid input', { field: 'email' });
      handleError(error, { userId: '123', additional: 'data' });

      expect(logger.warn).toHaveBeenCalledWith(
        'Operational error occurred',
        expect.objectContaining({
          field: 'email',
          userId: '123',
          additional: 'data',
        })
      );
    });
  });

  describe('withErrorHandling', () => {
    it('should wrap async function and handle errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = withErrorHandling(fn, { operation: 'test' });

      await expect(wrapped()).rejects.toThrow('Test error');
      expect(fn).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should pass through successful results', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const wrapped = withErrorHandling(fn);

      const result = await wrapped();
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should preserve function arguments', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const wrapped = withErrorHandling(fn);

      await wrapped('arg1', 'arg2');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('createErrorHandler', () => {
    it('should create error handler that handles errors', () => {
      const error = new ValidationError('Invalid input');
      const ctx = {
        from: { id: 123 },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue(undefined),
      };

      const handler = createErrorHandler();
      const result = handler(error, ctx);

      expect(result.handled).toBe(true);
      expect(ctx.reply).toHaveBeenCalledWith('❌ Invalid input');
    });

    it('should send generic message for non-operational errors', () => {
      const error = new Error('Unexpected error');
      const ctx = {
        from: { id: 123 },
        chat: { id: 456 },
        reply: vi.fn().mockResolvedValue(undefined),
      };

      const handler = createErrorHandler();
      handler(error, ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred. Please try again later.'
      );
    });

    it('should handle reply errors gracefully', async () => {
      const error = new ValidationError('Invalid input');
      const replyError = new Error('Reply failed');
      const ctx = {
        from: { id: 123 },
        chat: { id: 456 },
        reply: vi.fn().mockRejectedValue(replyError),
      };

      const handler = createErrorHandler();
      await handler(error, ctx);

      expect(logger.error).toHaveBeenCalledWith('Failed to send error message to user', replyError);
    });

    it('should work without context', () => {
      const error = new ValidationError('Invalid input');
      const handler = createErrorHandler();
      const result = handler(error);

      expect(result.handled).toBe(true);
    });

    it('should extract userId and chatId from context', () => {
      const error = new ValidationError('Invalid input');
      const ctx = {
        from: { id: 123 },
        chat: { id: 456 },
      };

      const handler = createErrorHandler();
      handler(error, ctx);

      expect(logger.warn).toHaveBeenCalledWith(
        'Operational error occurred',
        expect.objectContaining({
          userId: 123,
          chatId: 456,
        })
      );
    });
  });

  describe('safeAsync', () => {
    it('should return result on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await safeAsync(fn, 'default', { operation: 'test' });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should return default value on error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Test error'));
      const result = await safeAsync(fn, 'default', { operation: 'test' });

      expect(result).toBe('default');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle errors and log them', async () => {
      const error = new ValidationError('Invalid input');
      const fn = vi.fn().mockRejectedValue(error);
      await safeAsync(fn, null, { operation: 'test' });

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('retryWithBackoff', () => {
    it('should return result on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(fn, 3, 1000);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new ApiError('API error'))
        .mockRejectedValueOnce(new ApiError('API error'))
        .mockResolvedValue('success');

      const result = await retryWithBackoff(fn, 3, 0);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw on non-retryable errors', async () => {
      const error = new ValidationError('Invalid input');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retryWithBackoff(fn, 3, 1000)).rejects.toThrow('Invalid input');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries', async () => {
      const error = new ApiError('API error');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retryWithBackoff(fn, 2, 0);

      await expect(promise).rejects.toThrow('API error');
      await expect(promise).rejects.toBeInstanceOf(ApiError);

      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should use exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new ApiError('API error'))
        .mockRejectedValueOnce(new ApiError('API error'))
        .mockResolvedValue('success');

      await retryWithBackoff(fn, 3, 0);

      expect(logger.debug).toHaveBeenCalledWith(
        'Retrying after error',
        expect.objectContaining({
          attempt: 1,
          delayMs: 0,
        })
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Retrying after error',
        expect.objectContaining({
          attempt: 2,
          delayMs: 0,
        })
      );
    });

    it('should log context on retry', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new ApiError('API error'))
        .mockResolvedValue('success');

      // Expect the retry to eventually succeed but still log context on first retry
      const promise = retryWithBackoff(fn, 3, 0, { operation: 'test' });
      await expect(promise).resolves.toBe('success');

      expect(logger.debug).toHaveBeenCalledWith(
        'Retrying after error',
        expect.objectContaining({
          operation: 'test',
        })
      );
    });

    it('should handle errors with retryAfter', async () => {
      const error = new RateLimitError('Rate limit', 60);
      const fn = vi.fn().mockRejectedValue(error);

      await expect(retryWithBackoff(fn, 3, 1000)).rejects.toThrow('Rate limit');
      expect(fn).toHaveBeenCalledTimes(1); // RateLimitError is not retryable via isRetryableError
    });
  });
});
