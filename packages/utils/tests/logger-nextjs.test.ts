/**
 * Next.js Logger Tests
 * ===================
 * Tests for Next.js logger adapter
 */

import { NextJSLogger, logger } from '../src/logger-nextjs';
import { logger as baseLogger } from '../src/logger';

// Mock base logger
vi.mock('../src/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe('NextJSLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('withRequest', () => {
    it('should create logger with request context', () => {
      const contextLogger = NextJSLogger.withRequest('req-123', { userId: 456 });

      expect(contextLogger).toBeDefined();
      expect(baseLogger.child).toHaveBeenCalledWith({
        requestId: 'req-123',
        userId: 456,
      });
    });

    it('should create logger with only request ID', () => {
      const contextLogger = NextJSLogger.withRequest('req-456');

      expect(contextLogger).toBeDefined();
      expect(baseLogger.child).toHaveBeenCalledWith({
        requestId: 'req-456',
      });
    });
  });

  describe('Static logging methods', () => {
    it('should log error', () => {
      const error = new Error('Test error');
      NextJSLogger.error('Error message', error, { userId: 123 });

      expect(baseLogger.error).toHaveBeenCalledWith('Error message', error, { userId: 123 });
    });

    it('should log warning', () => {
      NextJSLogger.warn('Warning message', { userId: 123 });

      expect(baseLogger.warn).toHaveBeenCalledWith('Warning message', { userId: 123 });
    });

    it('should log info', () => {
      NextJSLogger.info('Info message', { userId: 123 });

      expect(baseLogger.info).toHaveBeenCalledWith('Info message', { userId: 123 });
    });

    it('should log debug', () => {
      NextJSLogger.debug('Debug message', { userId: 123 });

      expect(baseLogger.debug).toHaveBeenCalledWith('Debug message', { userId: 123 });
    });
  });

  describe('logger singleton', () => {
    it('should export logger as NextJSLogger', () => {
      expect(logger).toBe(NextJSLogger);
    });
  });
});
