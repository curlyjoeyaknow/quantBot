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

// Mock @quantbot/backtest to preserve actual classes for instantiation
// This fixes Vitest SSR module resolution issues with re-exported classes
vi.mock('@quantbot/backtest', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/backtest')>('@quantbot/backtest');
  return {
    ...actual,
    // Explicitly preserve classes to ensure they're constructors
    DuckDBStorageService: actual?.DuckDBStorageService,
    ClickHouseService: actual?.ClickHouseService,
    SimulationService: actual?.SimulationService,
  };
});
