/**
 * Test setup for api-clients package
 *
 * Mocks external dependencies that contain native bindings (sqlite3)
 * to prevent import errors during testing.
 */
import { vi } from 'vitest';

// Mock @quantbot/observability to prevent loading @quantbot/storage (sqlite3)
vi.mock('@quantbot/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
  checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
  getSystemMetrics: vi.fn().mockResolvedValue({}),
}));

// Mock @quantbot/utils logger to prevent any transitive sqlite3 imports
vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code?: string,
      public statusCode?: number
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
  RateLimitError: class RateLimitError extends Error {
    constructor(
      message: string,
      public retryAfter?: number
    ) {
      super(message);
      this.name = 'RateLimitError';
    }
  },
  TimeoutError: class TimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TimeoutError';
    }
  },
  ConfigurationError: class ConfigurationError extends Error {
    constructor(
      message: string,
      public configKey?: string
    ) {
      super(message);
      this.name = 'ConfigurationError';
    }
  },
  isRetryableError: vi.fn().mockReturnValue(false),
  retryWithBackoff: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
}));
