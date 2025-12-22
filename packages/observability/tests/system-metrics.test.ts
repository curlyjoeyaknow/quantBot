/**
 * System Metrics Tests
 * ====================
 * Unit tests for system metrics collection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectSystemMetrics } from '../src/system-metrics';
import * as os from 'os';

// Mock os module
vi.mock('os', () => ({
  totalmem: vi.fn(),
  freemem: vi.fn(),
  loadavg: vi.fn(),
  uptime: vi.fn(),
  cpus: vi.fn(),
}));

describe('System Metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock memory
    (os.totalmem as any).mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB
    (os.freemem as any).mockReturnValue(4 * 1024 * 1024 * 1024); // 4GB

    // Mock load average
    (os.loadavg as any).mockReturnValue([0.5, 0.6, 0.7]);

    // Mock uptime
    (os.uptime as any).mockReturnValue(86400); // 1 day

    // Mock CPU (first sample)
    (os.cpus as any)
      .mockReturnValueOnce([
        {
          times: {
            user: 1000,
            nice: 0,
            sys: 500,
            idle: 8000,
            irq: 0,
          },
        },
      ])
      .mockReturnValueOnce([
        // Second sample (after 1 second)
        {
          times: {
            user: 1100,
            nice: 0,
            sys: 600,
            idle: 8300,
            irq: 0,
          },
        },
      ]);
  });

  it('should collect system metrics', async () => {
    const metrics = await collectSystemMetrics();

    expect(metrics).toBeDefined();
    expect(metrics.timestamp).toBeInstanceOf(Date);
    expect(metrics.memory.total).toBe(8 * 1024 * 1024 * 1024);
    expect(metrics.memory.free).toBe(4 * 1024 * 1024 * 1024);
    expect(metrics.memory.usage).toBe(50); // 50% used
    expect(metrics.uptime).toBe(86400);
    expect(metrics.cpu.loadAverage).toEqual([0.5, 0.6, 0.7]);
  });

  it('should calculate CPU usage', async () => {
    const metrics = await collectSystemMetrics();

    expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
    expect(metrics.cpu.usage).toBeLessThanOrEqual(100);
  });
});
