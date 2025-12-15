/**
 * Test setup for CLI package
 */

import { vi } from 'vitest';

// Mock @quantbot/utils logger to avoid native binding issues
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
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
