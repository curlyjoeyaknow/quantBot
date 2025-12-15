/**
 * System Metrics
 * ==============
 * Collects system-level metrics (CPU, memory, disk, etc.)
 */

import { logger } from '@quantbot/utils';
import * as os from 'os';

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number; // Percentage
    loadAverage: number[];
  };
  memory: {
    total: number; // Bytes
    free: number; // Bytes
    used: number; // Bytes
    usage: number; // Percentage
  };
  uptime: number; // Seconds
}

/**
 * Calculate CPU usage by sampling twice with a delay
 */
async function calculateCpuUsage(): Promise<number> {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  // First sample
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  // Wait 1 second
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Second sample
  const cpus2 = os.cpus();
  let totalIdle2 = 0;
  let totalTick2 = 0;

  for (const cpu of cpus2) {
    for (const type in cpu.times) {
      totalTick2 += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle2 += cpu.times.idle;
  }

  const idle = totalIdle2 - totalIdle;
  const total = totalTick2 - totalTick;

  if (total === 0) {
    return 0;
  }

  return (1 - idle / total) * 100;
}

/**
 * Collect current system metrics
 */
export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  // Calculate CPU usage (async)
  const cpuUsage = await calculateCpuUsage();

  return {
    timestamp: new Date(),
    cpu: {
      usage: cpuUsage,
      loadAverage: os.loadavg(),
    },
    memory: {
      total: totalMemory,
      free: freeMemory,
      used: usedMemory,
      usage: (usedMemory / totalMemory) * 100,
    },
    uptime: os.uptime(),
  };
}
