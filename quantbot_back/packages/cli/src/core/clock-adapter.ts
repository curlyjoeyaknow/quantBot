/**
 * Clock Adapter for CLI
 *
 * Implements ClockPort using Date.now().
 * This is the composition root - it's allowed to use Date.now() here.
 */

import type { ClockPort } from '@quantbot/core';

export class SystemClockAdapter implements ClockPort {
  nowMs(): number {
    return Date.now();
  }
}
