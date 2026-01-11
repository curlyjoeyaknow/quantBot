/**
 * Simulation Clock Interface
 *
 * Abstract time resolution for simulations.
 * Allows simulations to work with different time resolutions:
 * - Milliseconds (for sniper logic)
 * - Seconds (for early post-mint)
 * - Minutes (default, for post-graduation)
 * - Hours (for longer-term strategies)
 */

import { ValidationError } from '@quantbot/utils';

/**
 * Time resolution type
 */
export type ClockResolution = 'ms' | 's' | 'm' | 'h';

/**
 * Simulation clock interface
 *
 * Provides deterministic time advancement for simulations.
 * Ensures time operations are resolution-aware.
 */
export interface SimulationClock {
  /**
   * Get the current time (timestamp)
   */
  now(): number;

  /**
   * Advance the clock by one tick
   * Returns the new timestamp
   */
  tick(): number;

  /**
   * Get the resolution in milliseconds
   */
  getResolutionMs(): number;

  /**
   * Get the resolution type
   */
  getResolution(): ClockResolution;

  /**
   * Convert a duration in resolution units to milliseconds
   *
   * @param duration - Duration in clock resolution units
   * @returns Duration in milliseconds
   */
  toMilliseconds(duration: number): number;

  /**
   * Convert milliseconds to resolution units
   *
   * @param ms - Duration in milliseconds
   * @returns Duration in clock resolution units
   */
  fromMilliseconds(ms: number): number;

  /**
   * Reset clock to a specific timestamp
   *
   * @param timestamp - Starting timestamp
   */
  reset(timestamp: number): void;
}

/**
 * Base clock implementation
 */
abstract class BaseClock implements SimulationClock {
  protected currentTime: number;

  constructor(startTime: number = 0) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  abstract tick(): number;
  abstract getResolutionMs(): number;
  abstract getResolution(): ClockResolution;

  toMilliseconds(duration: number): number {
    return duration * this.getResolutionMs();
  }

  fromMilliseconds(ms: number): number {
    return ms / this.getResolutionMs();
  }

  reset(timestamp: number): void {
    this.currentTime = timestamp;
  }
}

/**
 * Millisecond clock
 *
 * For high-frequency trading and sniper logic.
 */
export class MillisecondClock extends BaseClock {
  tick(): number {
    this.currentTime += 1;
    return this.currentTime;
  }

  getResolutionMs(): number {
    return 1;
  }

  getResolution(): ClockResolution {
    return 'ms';
  }
}

/**
 * Second clock
 *
 * For early post-mint trading (seconds-level precision).
 */
export class SecondClock extends BaseClock {
  tick(): number {
    this.currentTime += 1000; // Add 1 second = 1000ms
    return this.currentTime;
  }

  getResolutionMs(): number {
    return 1000;
  }

  getResolution(): ClockResolution {
    return 's';
  }
}

/**
 * Minute clock (default)
 *
 * For standard post-graduation trading (minute-level precision).
 */
export class MinuteClock extends BaseClock {
  tick(): number {
    this.currentTime += 60 * 1000; // Add 1 minute = 60000ms
    return this.currentTime;
  }

  getResolutionMs(): number {
    return 60 * 1000;
  }

  getResolution(): ClockResolution {
    return 'm';
  }
}

/**
 * Hour clock
 *
 * For longer-term strategies (hour-level precision).
 */
export class HourClock extends BaseClock {
  tick(): number {
    this.currentTime += 60 * 60 * 1000; // Add 1 hour = 3600000ms
    return this.currentTime;
  }

  getResolutionMs(): number {
    return 60 * 60 * 1000;
  }

  getResolution(): ClockResolution {
    return 'h';
  }
}

/**
 * Create a clock from resolution type
 *
 * @param resolution - Clock resolution type
 * @param startTime - Starting timestamp (milliseconds)
 * @returns Simulation clock instance
 */
export function createClock(resolution: ClockResolution, startTime: number = 0): SimulationClock {
  switch (resolution) {
    case 'ms':
      return new MillisecondClock(startTime);
    case 's':
      return new SecondClock(startTime);
    case 'm':
      return new MinuteClock(startTime);
    case 'h':
      return new HourClock(startTime);
    default:
      throw new ValidationError(`Unsupported clock resolution: ${resolution}`, { resolution });
  }
}
