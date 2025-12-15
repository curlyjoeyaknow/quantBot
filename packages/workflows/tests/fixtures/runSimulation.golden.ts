import { DateTime } from 'luxon';
import type { SimulationRunSpec } from '../../src/types.js';

export const baseSpec = (): SimulationRunSpec => ({
  strategyName: 'S1',
  callerName: 'Brook',
  from: DateTime.fromISO('2025-10-01T00:00:00.000Z', { zone: 'utc' }),
  to: DateTime.fromISO('2025-12-01T00:00:00.000Z', { zone: 'utc' }),
  options: {
    dryRun: true,
    preWindowMinutes: 0,
    postWindowMinutes: 0,
  },
});
