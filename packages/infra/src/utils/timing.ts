/**
 * Timing utilities for profiling multi-phase operations.
 *
 * Provides:
 * - Context managers for timing code sections
 * - Phase tracking for multi-step pipelines
 * - Formatted output for timing summaries
 *
 * Usage:
 *   const timing = new TimingContext();
 *   await timing.phase('loading', async () => { ... });
 *   await timing.phase('computing', async () => { ... });
 *   console.log(timing.summaryLine());
 *
 * Output:
 *   [timing] total=14.82s loading=2.1s computing=8.7s
 */

export interface TimingRecord {
  /** Phase label */
  label: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Start timestamp in milliseconds */
  timestampMs: number;
}

export interface TimingSummary {
  /** Total elapsed time in milliseconds */
  totalMs: number;
  /** Timing breakdown by phase */
  phases: TimingRecord[];
  /** Phases as a dict for quick lookup */
  parts: Record<string, number>;
}

/**
 * Context for tracking timing across multiple phases.
 *
 * Designed to match the Python TimingContext API for consistency.
 */
export class TimingContext {
  private readonly records: TimingRecord[] = [];
  private startMs: number | null = null;
  private endMs: number | null = null;

  /**
   * Mark the start of the overall operation.
   */
  start(): void {
    this.startMs = Date.now();
  }

  /**
   * Mark the end of the overall operation.
   */
  end(): void {
    this.endMs = Date.now();
  }

  /**
   * Time a synchronous phase.
   *
   * @param label - Name of the phase
   * @param fn - Function to execute
   * @returns Result of the function
   */
  phaseSync<T>(label: string, fn: () => T): T {
    if (this.startMs === null) {
      this.start();
    }

    const t0 = performance.now();
    const ts = Date.now();

    try {
      return fn();
    } finally {
      const dtMs = Math.round(performance.now() - t0);
      this.records.push({ label, durationMs: dtMs, timestampMs: ts });
    }
  }

  /**
   * Time an async phase.
   *
   * @param label - Name of the phase
   * @param fn - Async function to execute
   * @returns Result of the function
   */
  async phase<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (this.startMs === null) {
      this.start();
    }

    const t0 = performance.now();
    const ts = Date.now();

    try {
      return await fn();
    } finally {
      const dtMs = Math.round(performance.now() - t0);
      this.records.push({ label, durationMs: dtMs, timestampMs: ts });
    }
  }

  /**
   * Get total elapsed time in milliseconds.
   */
  get totalMs(): number {
    if (this.startMs === null) {
      return 0;
    }
    const end = this.endMs ?? Date.now();
    return end - this.startMs;
  }

  /**
   * Get timing parts as a dict.
   */
  get parts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const r of this.records) {
      result[r.label] = r.durationMs;
    }
    return result;
  }

  /**
   * Format a single-line timing summary.
   *
   * @param prefix - Line prefix (default: "[timing]")
   * @returns Formatted string like "[timing] total=14.82s slice=2.1s strat=8.7s"
   */
  summaryLine(prefix: string = '[timing]'): string {
    const parts: string[] = [];
    parts.push(`total=${formatMs(this.totalMs)}`);
    for (const r of this.records) {
      parts.push(`${r.label}=${formatMs(r.durationMs)}`);
    }
    return `${prefix} ${parts.join(' ')}`;
  }

  /**
   * Convert to a dict for JSON serialization.
   */
  toJSON(): TimingSummary {
    return {
      totalMs: this.totalMs,
      phases: this.records.map((r) => ({
        label: r.label,
        durationMs: r.durationMs,
        timestampMs: r.timestampMs,
      })),
      parts: this.parts,
    };
  }

  /**
   * Get records for inspection.
   */
  getRecords(): readonly TimingRecord[] {
    return this.records;
  }
}

/**
 * Simple async timer for a single operation.
 *
 * @param fn - Async function to time
 * @returns Tuple of [result, durationMs]
 */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const result = await fn();
  const dtMs = Math.round(performance.now() - t0);
  return [result, dtMs];
}

/**
 * Simple sync timer for a single operation.
 *
 * @param fn - Function to time
 * @returns Tuple of [result, durationMs]
 */
export function timedSync<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const result = fn();
  const dtMs = Math.round(performance.now() - t0);
  return [result, dtMs];
}

/**
 * Get current time in milliseconds.
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Format milliseconds for display.
 *
 * @param ms - Milliseconds
 * @returns Formatted string (e.g., "245ms", "3.45s", "2m14s")
 */
export function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m${seconds}s`;
  }
}

/**
 * Format timing parts as a single line.
 *
 * @param parts - Dict of label -> duration_ms
 * @param prefix - Line prefix
 * @returns Formatted line
 */
export function formatTimingParts(
  parts: Record<string, number>,
  prefix: string = '[timing]'
): string {
  const formatted = Object.entries(parts).map(([k, v]) => `${k}=${formatMs(v)}`);
  return `${prefix} ${formatted.join(' ')}`;
}

/**
 * Decorator factory to time a function call and log results.
 *
 * @param label - Label for the timing (defaults to function name)
 * @param log - Log function (defaults to console.log)
 * @returns Decorator
 */
export function timedFunction<T extends (...args: unknown[]) => Promise<unknown>>(
  label?: string,
  log: (msg: string) => void = console.log
): (fn: T) => T {
  return (fn: T): T => {
    const fnLabel = label ?? fn.name;

    const wrapper = async (...args: unknown[]): Promise<unknown> => {
      const t0 = performance.now();
      try {
        return await fn(...args);
      } finally {
        const dtMs = Math.round(performance.now() - t0);
        log(`[timing] ${fnLabel}=${formatMs(dtMs)}`);
      }
    };

    return wrapper as T;
  };
}
