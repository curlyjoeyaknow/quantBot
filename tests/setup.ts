/**
 * Root test setup file
 * 
 * This file is run before all tests to set up the test environment.
 * It mocks native bindings and sets up global test utilities.
 * 
 * For integration tests requiring ClickHouse, the test suite will
 * automatically spin up ClickHouse via the setup script.
 */

import { vi } from 'vitest';

// Mock native bindings that cause issues in test environments
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    // Add any specific mocks here if needed
  };
});

vi.mock('@quantbot/observability', async () => {
  const actual = await vi.importActual('@quantbot/observability');
  return {
    ...actual,
    // Add any specific mocks here if needed
  };
});

// Set up global test environment
global.console = {
  ...console,
  // Suppress console output in tests unless needed
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Note: ClickHouse setup is handled via a pre-test script
// Run `pnpm test:setup` before tests, or use `RUN_DB_STRESS=1 pnpm test:coverage`
// which will automatically run the setup script

