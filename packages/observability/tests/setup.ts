/**
 * Test Setup
 * ==========
 * Global test configuration and mocks
 */

import { vi } from 'vitest';

// Mock @quantbot/utils to avoid native binding issues
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});
