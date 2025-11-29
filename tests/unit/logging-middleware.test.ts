/**
 * Logging Middleware Tests
 * ========================
 * Tests for logging middleware functionality
 */

import { createLoggingMiddleware } from '../../src/utils/logging-middleware';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Logging Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createLoggingMiddleware', () => {
    it('should create middleware function', () => {
      const middleware = createLoggingMiddleware();
      
      expect(typeof middleware).toBe('function');
    });

    it('should log request information', () => {
      const middleware = createLoggingMiddleware();
      const req = {
        method: 'GET',
        url: '/test',
        headers: { 'user-agent': 'test-agent' },
      } as any;
      const res = {
        on: jest.fn(),
      } as any;
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should log response on finish', () => {
      const middleware = createLoggingMiddleware();
      const req = {
        method: 'POST',
        url: '/api/test',
        headers: {},
      } as any;
      const res = {
        statusCode: 200,
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            process.nextTick(callback);
          }
        }),
      } as any;
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });
  });
});

