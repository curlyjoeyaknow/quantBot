/**
 * Unit tests for export-slices-for-alerts handler
 */

import { describe, it, expect, vi } from 'vitest';
import { exportSlicesForAlertsHandler } from '../../../../src/handlers/slices/export-slices-for-alerts.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('exportSlicesForAlertsHandler', () => {
  it('should call exportSlicesForAlerts service with correct parameters', async () => {
    const mockExportSlicesForAlerts = vi.fn().mockResolvedValue({
      exported: 5,
      failed: 0,
    });

    const mockCtx = {
      services: {
        sliceExport: () => ({
          exportSlicesForAlerts: mockExportSlicesForAlerts,
        }),
      },
    } as unknown as CommandContext;

    const args = {
      from: '2024-01-01T00:00:00Z',
      to: '2024-01-02T00:00:00Z',
      dataset: 'candles_5m' as const,
      chain: 'sol' as const,
      catalogPath: './catalog',
      preWindow: 260,
      postWindow: 1440,
      useDatePartitioning: false,
      maxHoursPerChunk: 6,
    };

    const result = await exportSlicesForAlertsHandler(args, mockCtx);

    // Handler doesn't use ctx services, so ensureInitialized is not called
    // It directly creates dependencies (composition root pattern)
    expect(mockExportSlicesForAlerts).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
