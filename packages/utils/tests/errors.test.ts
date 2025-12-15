/**
 * Error Classes Tests
 * ===================
 * Tests for custom error classes
 */

import {
  AppError,
  ApiError,
  RateLimitError,
  TimeoutError,
  ConfigurationError,
  DatabaseError,
  ValidationError,
  NotFoundError,
  AuthorizationError,
  AuthenticationError,
  isRetryableError,
} from '../src/errors';

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create AppError with default values', () => {
      const error = new AppError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('APP_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
    });

    it('should create AppError with custom values', () => {
      const context = { userId: 123 };
      const error = new AppError('Test error', 'CUSTOM_CODE', 400, context, false);
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.context).toEqual(context);
      expect(error.isOperational).toBe(false);
    });

    it('should convert to JSON', () => {
      const error = new AppError('Test error', 'TEST_CODE', 400, { userId: 123 });
      const json = error.toJSON();
      expect(json.name).toBe('AppError');
      expect(json.message).toBe('Test error');
      expect(json.code).toBe('TEST_CODE');
      expect(json.statusCode).toBe(400);
      expect(json.context).toEqual({ userId: 123 });
    });
  });

  describe('ApiError', () => {
    it('should create ApiError with default values', () => {
      const error = new ApiError('API error');
      expect(error.message).toContain('API error');
      expect(error.statusCode).toBe(502);
      expect(error.isOperational).toBe(true);
    });

    it('should create ApiError with custom API name', () => {
      const error = new ApiError('API error', 'CustomAPI', 404);
      expect(error.apiName).toBe('CustomAPI');
      expect(error.statusCode).toBe(502); // ApiError always uses 502 statusCode
    });

    it('should include response data on the error', () => {
      const data = { error: 'Not found' };
      const error = new ApiError('API error', 'TestAPI', 404, data);
      expect(error.apiResponse).toEqual(data);
      expect(error.context?.apiStatusCode).toBe(404);
    });
  });

  describe('RateLimitError', () => {
    it('should create RateLimitError', () => {
      const error = new RateLimitError('Rate limit exceeded', 60);
      expect(error.message).toContain('Rate limit exceeded');
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe('TimeoutError', () => {
    it('should create TimeoutError', () => {
      const error = new TimeoutError('Request timed out', 5000);
      expect(error.message).toContain('Request timed out');
      expect(error.statusCode).toBe(504);
      expect(error.context?.timeoutMs).toBe(5000);
    });
  });

  describe('ConfigurationError', () => {
    it('should create ConfigurationError', () => {
      const error = new ConfigurationError('Config error');
      expect(error.message).toBe('Config error');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error.code).toBe('CONFIGURATION_ERROR');
    });
  });

  describe('DatabaseError', () => {
    it('should create DatabaseError', () => {
      const error = new DatabaseError('Database error');
      expect(error.message).toBe('Database error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('DATABASE_ERROR');
    });
  });

  describe('ValidationError', () => {
    it('should create ValidationError', () => {
      const error = new ValidationError('Validation failed');
      expect(error.message).toBe('Validation failed');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('NotFoundError', () => {
    it('should create NotFoundError', () => {
      const error = new NotFoundError('Resource');
      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
    });
  });

  describe('AuthenticationError', () => {
    it('should create AuthenticationError', () => {
      const error = new AuthenticationError('Unauthorized');
      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  describe('AuthorizationError', () => {
    it('should create AuthorizationError', () => {
      const error = new AuthorizationError('Forbidden');
      expect(error.message).toBe('Forbidden');
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('AUTHORIZATION_ERROR');
    });
  });

  describe('isRetryableError', () => {
    it('should return true for 5xx ApiErrors', () => {
      const error = new ApiError('Server error', 'TestAPI', 500);
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for RateLimitError (not treated as retryable)', () => {
      const error = new RateLimitError('Rate limit', 60);
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return true for TimeoutError', () => {
      const error = new TimeoutError('Timeout', 5000);
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 4xx ApiErrors (treat all API errors as retryable)', () => {
      const error = new ApiError('Client error', 'TestAPI', 400);
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const error = new ValidationError('Validation failed');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should return false for generic Error', () => {
      const error = new Error('Generic error');
      expect(isRetryableError(error)).toBe(false);
    });
  });
});
