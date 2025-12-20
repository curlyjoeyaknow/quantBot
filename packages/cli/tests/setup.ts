/**
 * Test setup for CLI package
 */

import { vi } from 'vitest';

// Mock @quantbot/utils logger to avoid native binding issues
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/utils')>('@quantbot/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    ValidationError: actual?.ValidationError || class ValidationError extends Error {},
  };
});

// Mock @quantbot/observability to avoid native binding issues
vi.mock('@quantbot/observability', async () => {
  return {
    checkHealth: vi.fn(),
    getQuotaUsage: vi.fn(),
    getErrorStats: vi.fn(),
  };
});
