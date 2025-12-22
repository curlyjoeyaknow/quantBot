/**
 * Unit tests for Error Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatError,
  handleSolanaError,
  logError,
  handleError,
} from '../../src/core/error-handler';
import { logger } from '@quantbot/utils';

vi.mock('@quantbot/utils', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatError', () => {
    it('should format Error objects', () => {
      const error = new Error('Test error message');
      const result = formatError(error);
      expect(result).toBe('Test error message');
    });

    it('should format string errors', () => {
      const result = formatError('String error');
      expect(result).toBe('String error');
    });

    it('should handle unknown error types', () => {
      const result = formatError({ unexpected: 'object' });
      expect(result).toBe('An unexpected error occurred');
    });

    it('should sanitize sensitive information in error messages', () => {
      const error = new Error('api-key is invalid: abc123');
      const result = formatError(error);
      expect(result).toBe('An error occurred. Please check your configuration and try again.');
    });

    it('should sanitize token information', () => {
      const error = new Error('Bearer token expired');
      const result = formatError(error);
      expect(result).toBe('An error occurred. Please check your configuration and try again.');
    });

    it('should sanitize password information', () => {
      const error = new Error('Invalid password');
      const result = formatError(error);
      expect(result).toBe('An error occurred. Please check your configuration and try again.');
    });

    it('should preserve non-sensitive error messages', () => {
      const error = new Error('File not found');
      const result = formatError(error);
      expect(result).toBe('File not found');
    });
  });

  describe('handleSolanaError', () => {
    it('should handle mint address errors', () => {
      const error = new Error('Invalid mint address');
      const result = handleSolanaError(error);
      expect(result).toContain('Invalid mint address');
      expect(result).toContain('32-44 characters');
    });

    it('should handle rate limit errors', () => {
      const error = new Error('Rate limit exceeded (429)');
      const result = handleSolanaError(error);
      expect(result).toContain('rate limit');
    });

    it('should handle network errors', () => {
      const error = new Error('Network connection failed');
      const result = handleSolanaError(error);
      expect(result).toContain('Network error');
    });

    it('should handle RPC errors', () => {
      const error = new Error('Solana RPC timeout');
      const result = handleSolanaError(error);
      expect(result).toContain('Solana RPC error');
    });

    it('should fall back to formatError for unknown errors', () => {
      const error = new Error('Generic error');
      const result = handleSolanaError(error);
      expect(result).toBe('Generic error');
    });
  });

  describe('logError', () => {
    it('should log Error objects with stack traces', () => {
      const error = new Error('Test error');
      logError(error, { context: 'test' });

      expect(logger.error).toHaveBeenCalledWith('CLI error', {
        message: 'Test error',
        stack: expect.any(String),
        context: { context: 'test' },
      });
    });

    it('should log non-Error objects', () => {
      logError('String error', { key: 'value' });

      expect(logger.error).toHaveBeenCalledWith('CLI error', {
        error: 'String error',
        context: { key: 'value' },
      });
    });

    it('should redact sensitive information from context', () => {
      const error = new Error('Error');
      logError(error, { apiKey: 'secret123', normalField: 'value' });

      expect(logger.error).toHaveBeenCalledWith('CLI error', {
        message: 'Error',
        stack: expect.any(String),
        context: {
          apiKey: '[REDACTED]',
          normalField: 'value',
        },
      });
    });

    it('should handle errors without context', () => {
      const error = new Error('Error');
      logError(error);

      expect(logger.error).toHaveBeenCalledWith('CLI error', {
        message: 'Error',
        stack: expect.any(String),
        context: undefined,
      });
    });
  });

  describe('handleError', () => {
    it('should log and format errors', () => {
      const error = new Error('Test error');
      const result = handleError(error, { test: 'context' });

      expect(logger.error).toHaveBeenCalled();
      expect(result).toBe('Test error');
    });

    it('should handle Solana-specific errors', () => {
      const error = new Error('Invalid mint address');
      const result = handleError(error);

      expect(result).toContain('Invalid mint address');
      expect(result).toContain('32-44 characters');
    });

    it('should sanitize sensitive information', () => {
      const error = new Error('api-key invalid');
      const result = handleError(error);

      expect(result).toBe('An error occurred. Please check your configuration and try again.');
    });
  });
});
