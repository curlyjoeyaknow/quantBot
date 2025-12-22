/**
 * Test setup for core package
 *
 * Mocks external dependencies to prevent import errors during testing.
 */
import { vi } from 'vitest';

// Mock @quantbot/utils logger (if needed in future)
vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
