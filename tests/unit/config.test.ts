/**
 * Configuration Tests
 * ===================
 * Tests for configuration loading and validation
 */

import { getConfig, resetConfig } from '../../src/config';
import { ConfigurationError } from '../../src/utils/errors';

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    resetConfig();
    process.env = originalEnv;
  });

  describe('getConfig', () => {
    it('should load valid configuration', () => {
      process.env.BOT_TOKEN = 'test-token';
      process.env.NODE_ENV = 'test';
      
      const config = getConfig();
      
      expect(config.BOT_TOKEN).toBe('test-token');
      expect(config.NODE_ENV).toBe('test');
    });

    it('should use default values for optional fields', () => {
      process.env.BOT_TOKEN = 'test-token';
      process.env.NODE_ENV = 'test';
      
      const config = getConfig();
      
      expect(config.CALLER_DB_PATH).toBeDefined();
      expect(config.CLICKHOUSE_HOST).toBeDefined();
      expect(config.CLICKHOUSE_DATABASE).toBeDefined();
    });

    it('should throw ConfigurationError for missing required fields', () => {
      delete process.env.BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;
      
      expect(() => getConfig()).toThrow(ConfigurationError);
    });

    it('should validate LOG_LEVEL enum', () => {
      process.env.BOT_TOKEN = 'test-token';
      process.env.LOG_LEVEL = 'invalid';
      
      expect(() => getConfig()).toThrow();
    });

    it('should accept valid LOG_LEVEL values', () => {
      process.env.BOT_TOKEN = 'test-token';
      
      const levels = ['error', 'warn', 'info', 'debug', 'trace'];
      levels.forEach(level => {
        process.env.LOG_LEVEL = level;
        expect(() => getConfig()).not.toThrow();
      });
    });

    it('should validate NODE_ENV enum', () => {
      process.env.BOT_TOKEN = 'test-token';
      process.env.NODE_ENV = 'invalid';
      
      expect(() => getConfig()).toThrow();
    });

    it('should accept valid NODE_ENV values', () => {
      process.env.BOT_TOKEN = 'test-token';
      
      const envs = ['development', 'production', 'test'];
      envs.forEach(env => {
        process.env.NODE_ENV = env;
        expect(() => getConfig()).not.toThrow();
      });
    });

    it('should parse boolean values correctly', () => {
      process.env.BOT_TOKEN = 'test-token';
      process.env.LOG_CONSOLE = 'true';
      process.env.LOG_FILE = 'false';
      process.env.ENABLE_MONITORING = 'true';
      
      const config = getConfig();
      
      // LOG_CONSOLE and LOG_FILE default to true if not 'false'
      expect(config.LOG_CONSOLE).toBe(true);
      expect(config.LOG_FILE).toBe(false);
      expect(config.ENABLE_MONITORING).toBe(true);
    });

    it('should parse PORT as number', () => {
      process.env.BOT_TOKEN = 'test-token';
      process.env.PORT = '3000';
      
      const config = getConfig();
      
      expect(config.PORT).toBe(3000);
    });

    it('should handle optional API keys', () => {
      process.env.BOT_TOKEN = 'test-token';
      process.env.BIRDEYE_API_KEY = 'test-key';
      process.env.HELIUS_API_KEY = 'helius-key';
      
      const config = getConfig();
      
      expect(config.BIRDEYE_API_KEY).toBe('test-key');
      expect(config.HELIUS_API_KEY).toBe('helius-key');
    });
  });
});

