import { vi } from 'vitest';
import { z } from 'zod';

// Mock @quantbot/utils logger to avoid native binding issues
// Don't use importActual to avoid module resolution errors
vi.mock('@quantbot/utils', () => {
  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  // Mock PythonManifestSchema (Zod schema) - matches actual schema structure
  const PythonManifestSchema = z.object({
    chat_id: z.string(),
    chat_name: z.string(),
    duckdb_file: z.string(),
    tg_rows: z.number().optional(),
    user_calls_rows: z.number().optional(),
    caller_links_rows: z.number().optional(),
    version: z.string().optional(),
    calls: z.array(z.any()).optional(),
    alerts: z.array(z.any()).optional(),
  });

  // Mock PythonEngine class
  class PythonEngine {
    async runScript() {
      return { success: true };
    }
    async runTelegramPipeline() {
      return { success: true, calls: [], alerts: [] };
    }
    async runDuckDBStorage() {
      return { success: true };
    }
    async runClickHouseEngine() {
      return { success: true };
    }
    async runOhlcvWorklist() {
      return { tokenGroups: [], calls: [] };
    }
  }

  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    isSolanaAddress: (s: string) => {
      if (typeof s !== 'string') return false;
      const t = s.trim();
      if (t.length < 32 || t.length > 44) return false;
      for (const ch of t) {
        if (!BASE58_ALPHABET.includes(ch)) return false;
      }
      return true;
    },
    isEvmAddress: (s: string) => {
      if (typeof s !== 'string') return false;
      const t = s.trim();
      return /^0x[a-fA-F0-9]{40}$/.test(t);
    },
    isBase58: (s: string) => {
      if (!s) return false;
      for (const ch of s) {
        if (!BASE58_ALPHABET.includes(ch)) return false;
      }
      return true;
    },
    PythonEngine,
    getPythonEngine: vi.fn(() => new PythonEngine()),
    PythonManifestSchema,
    retryWithBackoff: async <T>(
      fn: () => Promise<T>,
      _maxRetries?: number,
      _initialDelayMs?: number,
      _context?: Record<string, unknown>
    ): Promise<T> => {
      return fn();
    },
    ValidationError: class ValidationError extends Error {
      public readonly code: string;
      public readonly statusCode: number;
      public readonly context?: Record<string, unknown>;
      constructor(message: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'ValidationError';
        this.code = 'VALIDATION_ERROR';
        this.statusCode = 400;
        this.context = context;
      }
    },
    ConfigurationError: class ConfigurationError extends Error {
      public readonly configKey?: string;
      public readonly context?: Record<string, unknown>;
      constructor(message: string, configKey?: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'ConfigurationError';
        this.configKey = configKey;
        this.context = context;
      }
    },
    NotFoundError: class NotFoundError extends Error {
      constructor(resource: string, identifier: string) {
        super(`${resource} not found: ${identifier}`);
        this.name = 'NotFoundError';
      }
    },
  };
});

// Mock sqlite3 to avoid opening real databases during tests
vi.mock('sqlite3', () => ({
  Database: vi.fn(),
  verbose: () => ({ Database: vi.fn() }),
}));

// Mock @quantbot/storage to avoid loading sqlite-backed modules (caller database)
vi.mock('@quantbot/storage', async () => {
  class BaseRepo {}
  return {
    // Repositories (stub classes)
    CallsRepository: class extends BaseRepo {},
    TokensRepository: class extends BaseRepo {},
    AlertsRepository: class extends BaseRepo {},
    CallersRepository: class extends BaseRepo {},
    OhlcvRepository: class extends BaseRepo {},
    // Engine / clients
    getStorageEngine: vi.fn(),
    initClickHouse: vi.fn(),
    getClickHouseClient: vi.fn(),
    // Influx/Cache stubs used by @quantbot/ohlcv
    influxDBClient: {},
    ohlcvCache: {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
    },
  };
});
