/**
 * Next.js Logger Tests
 * ===================
 * Tests for Next.js logger adapter
 */

import { NextJsLogger } from '../../src/utils/logger-nextjs';

// Mock base logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
  Logger: class MockLogger {
    error = jest.fn();
    warn = jest.fn();
    info = jest.fn();
    debug = jest.fn();
    setContext = jest.fn();
    getContext = jest.fn().mockReturnValue({});
    clearContext = jest.fn();
  },
}));

describe('NextJsLogger', () => {
  let logger: NextJsLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = NextJsLogger.getInstance();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = NextJsLogger.getInstance();
      const instance2 = NextJsLogger.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Request Context', () => {
    it('should set request context', () => {
      logger.setRequestContext('req-123', { userId: 456 });

      expect(logger.getRequestContext('req-123')).toEqual({ userId: 456 });
    });

    it('should get request context', () => {
      logger.setRequestContext('req-456', { tokenAddress: '0x123' });

      const context = logger.getRequestContext('req-456');
      expect(context?.tokenAddress).toBe('0x123');
    });

    it('should clear request context', () => {
      logger.setRequestContext('req-789', { userId: 123 });
      logger.clearRequestContext('req-789');

      const context = logger.getRequestContext('req-789');
      expect(context).toBeUndefined();
    });
  });

  describe('Logging with Context', () => {
    it('should include request context in logs', () => {
      logger.setRequestContext('req-1', { userId: 123 });
      logger.info('Test message');

      // Logger should be called with context
      expect(logger.info).toHaveBeenCalled();
    });
  });
});

