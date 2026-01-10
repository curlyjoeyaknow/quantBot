/**
 * Test setup for analytics package
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
}));
