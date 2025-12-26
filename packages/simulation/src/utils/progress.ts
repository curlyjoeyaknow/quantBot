/**
 * Progress Indicator Utilities
 * =============================
 * Provides verbose console output and progress indicators for long-running operations
 */

/**
 * Clock interface for deterministic time access
 */
export interface ProgressClock {
  /** Get current time in milliseconds */
  nowMs(): number;
}

/**
 * Create default clock using system time (for backward compatibility)
 * This is extracted to avoid ESLint restrictions on Date.now()
 */
function createDefaultClock(): ProgressClock {
  // eslint-disable-next-line no-restricted-properties
  return { nowMs: () => Date.now() };
}

export interface ProgressOptions {
  /** Total number of items to process */
  total: number;
  /** Label for the operation */
  label?: string;
  /** Whether to show percentage */
  showPercentage?: boolean;
  /** Whether to show estimated time remaining */
  showETA?: boolean;
  /** Update interval in milliseconds (default: 100) */
  updateInterval?: number;
  /** Whether to show a progress bar */
  showBar?: boolean;
  /** Clock for deterministic time access (defaults to Date.now() for backward compatibility) */
  clock?: ProgressClock;
}

export class ProgressIndicator {
  private startTime: number;
  private lastUpdate: number;
  private current: number;
  private readonly total: number;
  private readonly label: string;
  private readonly showPercentage: boolean;
  private readonly showETA: boolean;
  private readonly updateInterval: number;
  private readonly showBar: boolean;
  private readonly clock: ProgressClock;

  constructor(options: ProgressOptions) {
    this.total = options.total;
    this.current = 0;
    // Use injected clock or default to system time for backward compatibility
    this.clock = options.clock ?? createDefaultClock();
    this.startTime = this.clock.nowMs();
    this.lastUpdate = this.startTime;
    this.label = options.label || 'Progress';
    this.showPercentage = options.showPercentage !== false;
    this.showETA = options.showETA !== false;
    this.updateInterval = options.updateInterval || 100;
    this.showBar = options.showBar !== false;
  }

  /**
   * Update progress
   */
  update(increment: number = 1): void {
    this.current = Math.min(this.current + increment, this.total);
    this.render();
  }

  /**
   * Set current progress
   */
  setCurrent(value: number): void {
    this.current = Math.min(Math.max(0, value), this.total);
    this.render();
  }

  /**
   * Complete the progress indicator
   */
  complete(message?: string): void {
    this.current = this.total;
    this.render(true);
    if (message) {
      console.log(`\n✅ ${message}`);
    }
  }

  /**
   * Render progress to console
   */
  private render(final: boolean = false): void {
    const now = this.clock.nowMs();
    const timeSinceLastUpdate = now - this.lastUpdate;

    // Throttle updates
    if (!final && timeSinceLastUpdate < this.updateInterval) {
      return;
    }

    this.lastUpdate = now;

    const percentage = this.total > 0 ? (this.current / this.total) * 100 : 0;
    const elapsed = (now - this.startTime) / 1000; // seconds
    const rate = this.current > 0 ? elapsed / this.current : 0;
    const remaining = this.total - this.current;
    const eta = remaining * rate;

    // Build progress bar
    let bar = '';
    if (this.showBar) {
      const barWidth = 30;
      const filled = Math.floor((this.current / this.total) * barWidth);
      const empty = barWidth - filled;
      bar = `[${'='.repeat(filled)}${' '.repeat(empty)}]`;
    }

    // Build status line
    const parts: string[] = [];

    if (this.label) {
      parts.push(`\r${this.label}:`);
    }

    if (this.showBar) {
      parts.push(bar);
    }

    parts.push(`${this.current}/${this.total}`);

    if (this.showPercentage) {
      parts.push(`(${percentage.toFixed(1)}%)`);
    }

    if (this.showETA && remaining > 0 && eta > 0) {
      const etaMinutes = Math.floor(eta / 60);
      const etaSeconds = Math.floor(eta % 60);
      parts.push(`ETA: ${etaMinutes}m ${etaSeconds}s`);
    }

    if (final) {
      const totalSeconds = Math.floor(elapsed);
      const totalMinutes = Math.floor(totalSeconds / 60);
      const totalSecs = totalSeconds % 60;
      parts.push(`(completed in ${totalMinutes}m ${totalSecs}s)`);
    }

    process.stdout.write(parts.join(' '));

    if (final) {
      process.stdout.write('\n');
    }
  }
}

/**
 * Create a simple progress indicator
 */
export function createProgress(options: ProgressOptions): ProgressIndicator {
  return new ProgressIndicator(options);
}

/**
 * Log verbose operation start
 */
export function logOperationStart(operation: string, details?: Record<string, unknown>): void {
  const detailsStr = details
    ? ' ' +
      Object.entries(details)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
    : '';
  console.log(`\n🚀 Starting: ${operation}${detailsStr}`);
}

/**
 * Log verbose operation step
 */
export function logStep(step: string, details?: Record<string, unknown>): void {
  const detailsStr = details
    ? ' ' +
      Object.entries(details)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
    : '';
  console.log(`  → ${step}${detailsStr}`);
}

/**
 * Log verbose operation completion
 */
export function logOperationComplete(operation: string, duration?: number): void {
  const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : '';
  console.log(`✅ Completed: ${operation}${durationStr}\n`);
}

/**
 * Log verbose error
 */
export function logError(operation: string, error: Error, details?: Record<string, unknown>): void {
  const detailsStr = details
    ? ' ' +
      Object.entries(details)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ')
    : '';
  console.error(`\n❌ Error in ${operation}: ${error.message}${detailsStr}`);
  if (error.stack) {
    console.error(error.stack);
  }
}
