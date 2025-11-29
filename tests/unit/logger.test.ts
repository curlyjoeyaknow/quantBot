/**
 * Logger Tests
 * ============
 * Tests for the centralized logging system
 */

import { logger, Logger, LogLevel } from '../../src/utils/logger';

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Log Levels', () => {
    it('should have all required log levels', () => {
      expect(LogLevel.ERROR).toBe('error');
      expect(LogLevel.WARN).toBe('warn');
      expect(LogLevel.INFO).toBe('info');
      expect(LogLevel.DEBUG).toBe('debug');
      expect(LogLevel.TRACE).toBe('trace');
    });
  });

  describe('Logger Instance', () => {
    it('should export a logger instance', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should log error messages', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      logger.error('Test error message');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log info messages', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.info('Test info message');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log warn messages', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      logger.warn('Test warn message');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log debug messages', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.debug('Test debug message');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log with context', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      logger.info('Test message', { userId: 123, tokenAddress: '0x123' });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log errors with Error objects', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const error = new Error('Test error');
      logger.error('Error occurred', error);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Logger Context', () => {
    it('should set and get context', () => {
      const childLogger = new Logger();
      childLogger.setContext({ userId: 123, tokenAddress: '0x123' });
      
      const context = childLogger.getContext();
      expect(context.userId).toBe(123);
      expect(context.tokenAddress).toBe('0x123');
    });

    it('should clear context', () => {
      const childLogger = new Logger();
      childLogger.setContext({ userId: 123 });
      childLogger.clearContext();
      
      const context = childLogger.getContext();
      expect(Object.keys(context)).toHaveLength(0);
    });

    it('should create child logger with context', () => {
      const childLogger = logger.child({ userId: 456 });
      const context = childLogger.getContext();
      expect(context.userId).toBe(456);
    });

    it('should merge context on log calls', () => {
      const childLogger = logger.child({ userId: 123 });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      childLogger.info('Test', { tokenAddress: '0x456' });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

