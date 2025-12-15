/**
 * Test setup for TUI package
 */

import { vi } from 'vitest';

// Mock @quantbot/utils logger
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

// Mock @quantbot/cli
vi.mock('@quantbot/cli', () => ({
  commandRegistry: {
    getCommand: vi.fn(),
  },
}));
