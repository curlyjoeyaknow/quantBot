export interface ClockPort {
  nowMs(): number;
}

/**
 * Create a system clock adapter that uses Date.now()
 *
 * This is ONLY allowed in composition roots (e.g., createProductionContext).
 * Simulation code must use injected clocks for determinism.
 *
 * @returns ClockPort that delegates to Date.now()
 */
export function createSystemClock(): ClockPort {
  return { nowMs: () => Date.now() };
}
