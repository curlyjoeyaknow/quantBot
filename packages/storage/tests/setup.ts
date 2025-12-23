/**
 * Test setup for storage package
 *
 * Mocks external dependencies to prevent import errors during testing.
 */
import { vi } from 'vitest';

// Mock @quantbot/observability to prevent loading native bindings
vi.mock('@quantbot/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
  checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
  getSystemMetrics: vi.fn().mockResolvedValue({}),
}));

// Mock @quantbot/utils logger and errors
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/utils')>('@quantbot/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ValidationError: actual.ValidationError,
    ServiceUnavailableError: actual.ServiceUnavailableError,
    AppError: actual.AppError,
  };
});
