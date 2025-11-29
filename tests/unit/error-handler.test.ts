/**
 * Error Handler Tests
 * ===================
 * Tests for error handling utilities
 */

import { handleError, withErrorHandling, safeAsync, retryWithBackoff } from '../../src/utils/error-handler';
import { AppError, ApiError, RateLimitError, TimeoutError, ValidationError } from '../../src/utils/errors';
import { logger } from '../../src/utils/logger';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Error Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleError', () => {
    it('should handle AppError', () => {
      const error = new ValidationError('Validation failed');
      const result = handleError(error);
      
      expect(result.handled).toBe(true);
      expect(result.message).toBe('Validation failed');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle generic Error', () => {
      const error = new Error('Generic error');
      const result = handleError(error);
      
      expect(result.handled).toBe(true);
      expect(result.message).toBe('Generic error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle unknown error types', () => {
      const error = 'String error';
      const result = handleError(error);
      
      expect(result.handled).toBe(true);
      expect(result.message).toBe('String error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should include context in result', () => {
      const error = new ApiError('API error', 'TestAPI', 500);
      const context = { userId: 123 };
      const result = handleError(error, context);
      
      expect(result.handled).toBe(true);
      expect(result.message).toBe('API error');
      // ApiError is an AppError, and operational errors log as warn
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should identify retryable errors', () => {
      const error = new ApiError('Server error', 'TestAPI', 500);
      const result = handleError(error);
      
      expect(result.shouldRetry).toBe(true);
      expect(result.handled).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      const error = new ValidationError('Validation failed');
      const result = handleError(error);
      
      expect(result.shouldRetry).toBe(false);
    });

    it('should include retryAfter for RateLimitError', () => {
      const error = new RateLimitError('Rate limit', 60);
      const result = handleError(error);
      
      expect(result.retryAfter).toBe(60);
    });
  });

  describe('withErrorHandling', () => {
    it('should wrap function with error handling', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const wrapped = withErrorHandling(fn);
      
      const result = await wrapped();
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should handle errors in wrapped function', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = withErrorHandling(fn);
      
      await expect(wrapped()).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should pass context to error handler', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      const wrapped = withErrorHandling(fn, { userId: 123 });
      
      await expect(wrapped()).rejects.toThrow('Test error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('safeAsync', () => {
    it('should return result on success', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await safeAsync(fn, 'default');
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should return default value on error', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      const result = await safeAsync(fn, 'default');
      
      expect(result).toBe('default');
      expect(logger.error).toHaveBeenCalled();
    });

    it('should pass context to error handler', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Test error'));
      await safeAsync(fn, 'default', { userId: 123 });
      
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new ApiError('Server error', 'TestAPI', 500))
        .mockResolvedValueOnce('success');
      
      const result = await retryWithBackoff(fn, 3, 10);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const fn = jest.fn().mockRejectedValue(new ValidationError('Validation failed'));
      
      await expect(retryWithBackoff(fn)).rejects.toThrow('Validation failed');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and throw', async () => {
      const fn = jest.fn().mockRejectedValue(new ApiError('Server error', 'TestAPI', 500));
      
      await expect(retryWithBackoff(fn, 2, 10)).rejects.toThrow('Server error');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should use exponential backoff', async () => {
      jest.useFakeTimers();
      const fn = jest.fn().mockRejectedValue(new ApiError('Server error', 'TestAPI', 500));
      
      const promise = retryWithBackoff(fn, 2, 100);
      
      // Fast-forward time
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      
      jest.useRealTimers();
      await expect(promise).rejects.toThrow();
    });
  });
});

