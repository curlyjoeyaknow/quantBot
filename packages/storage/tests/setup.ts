/**
 * Test setup for storage package
 *
 * Mocks external dependencies that contain native bindings (sqlite3)
 * to prevent import errors during testing.
 */
import { vi } from 'vitest';

// Mock @quantbot/observability to prevent loading native bindings
vi.mock('@quantbot/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
  checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
  getSystemMetrics: vi.fn().mockResolvedValue({}),
}));

// Mock @quantbot/utils logger
vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
