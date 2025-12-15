/**
 * Logging Configuration Tests
 * ===========================
 * Tests for logging configuration utilities
 */

import { getLogLevel, isLogLevelEnabled } from '../src/logging-config';
import { LogLevel } from '../src/logger';

describe('Logging Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getLogLevel', () => {
    it('should return error level when LOG_LEVEL is error', () => {
      process.env.LOG_LEVEL = 'error';
      const level = getLogLevel();
      expect(level).toBe(LogLevel.ERROR);
    });

    it('should return warn level when LOG_LEVEL is warn', () => {
      process.env.LOG_LEVEL = 'warn';
      const level = getLogLevel();
      expect(level).toBe(LogLevel.WARN);
    });

    it('should return info level when LOG_LEVEL is info', () => {
      process.env.LOG_LEVEL = 'info';
      const level = getLogLevel();
      expect(level).toBe(LogLevel.INFO);
    });

    it('should return debug level when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';
      const level = getLogLevel();
      expect(level).toBe(LogLevel.DEBUG);
    });

    it('should return trace level when LOG_LEVEL is trace', () => {
      process.env.LOG_LEVEL = 'trace';
      const level = getLogLevel();
      expect(level).toBe(LogLevel.TRACE);
    });

    it('should return info level in production when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'production';
      const level = getLogLevel();
      expect(level).toBe(LogLevel.INFO);
    });

    it('should return debug level in development when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;
      process.env.NODE_ENV = 'development';
      const level = getLogLevel();
      expect(level).toBe(LogLevel.DEBUG);
    });
  });

  describe('isLogLevelEnabled', () => {
    it('should return true when check level is same as current level', () => {
      expect(isLogLevelEnabled(LogLevel.ERROR, LogLevel.ERROR)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.WARN, LogLevel.WARN)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.INFO, LogLevel.INFO)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.DEBUG, LogLevel.DEBUG)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.TRACE, LogLevel.TRACE)).toBe(true);
    });

    it('should return true when check level is less severe than current level', () => {
      expect(isLogLevelEnabled(LogLevel.ERROR, LogLevel.WARN)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.ERROR, LogLevel.INFO)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.ERROR, LogLevel.DEBUG)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.ERROR, LogLevel.TRACE)).toBe(true);

      expect(isLogLevelEnabled(LogLevel.WARN, LogLevel.INFO)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.WARN, LogLevel.DEBUG)).toBe(true);
      expect(isLogLevelEnabled(LogLevel.WARN, LogLevel.TRACE)).toBe(true);
    });

    it('should return false when check level is more severe than current level', () => {
      expect(isLogLevelEnabled(LogLevel.WARN, LogLevel.ERROR)).toBe(false);
      expect(isLogLevelEnabled(LogLevel.INFO, LogLevel.ERROR)).toBe(false);
      expect(isLogLevelEnabled(LogLevel.DEBUG, LogLevel.ERROR)).toBe(false);
      expect(isLogLevelEnabled(LogLevel.TRACE, LogLevel.ERROR)).toBe(false);

      expect(isLogLevelEnabled(LogLevel.INFO, LogLevel.WARN)).toBe(false);
      expect(isLogLevelEnabled(LogLevel.DEBUG, LogLevel.WARN)).toBe(false);
      expect(isLogLevelEnabled(LogLevel.TRACE, LogLevel.WARN)).toBe(false);
    });
  });
});
