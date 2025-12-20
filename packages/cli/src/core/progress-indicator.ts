/**
 * Progress Indicator Utilities
 *
 * Provides loading spinners and progress bars for CLI commands
 */

/**
 * Simple spinner frames
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Progress indicator class for showing loading states
 */
export class ProgressIndicator {
  private interval: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private message = '';
  private isActive = false;

  /**
   * Start showing a spinner with a message
   */
  start(message: string): void {
    if (this.isActive) {
      this.stop();
    }

    this.message = message;
    this.isActive = true;
    this.frameIndex = 0;

    // Show initial frame
    this.update();

    // Update spinner every 100ms
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.update();
    }, 100);
  }

  /**
   * Update the spinner display
   */
  private update(): void {
    if (!this.isActive) return;
    const frame = SPINNER_FRAMES[this.frameIndex];
    process.stdout.write(`\r${frame} ${this.message}`);
  }

  /**
   * Update the message while keeping spinner running
   */
  updateMessage(message: string): void {
    this.message = message;
    if (this.isActive) {
      this.update();
    }
  }

  /**
   * Stop the spinner and clear the line
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.isActive) {
      // Clear the line
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns || 80) + '\r');
      this.isActive = false;
    }
  }

  /**
   * Show a success message and stop
   */
  succeed(message?: string): void {
    this.stop();
    if (message) {
      console.log(`✓ ${message}`);
    }
  }

  /**
   * Show a failure message and stop
   */
  fail(message?: string): void {
    this.stop();
    if (message) {
      console.error(`✗ ${message}`);
    }
  }
}

/**
 * Create a progress bar string
 */
export function createProgressBar(current: number, total: number, width = 30): string {
  if (total === 0) return '[' + ' '.repeat(width) + '] 0%';

  const percent = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percent}% (${current}/${total})`;
}

/**
 * Create a simple progress indicator with label
 */
export function createProgressIndicator(current: number, total: number, label?: string): string {
  const bar = createProgressBar(current, total);
  return label ? `${label}: ${bar}` : bar;
}

/**
 * Format elapsed time
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Global progress indicator instance
 */
let globalProgress: ProgressIndicator | null = null;

/**
 * Get or create global progress indicator
 */
export function getProgressIndicator(): ProgressIndicator {
  if (!globalProgress) {
    globalProgress = new ProgressIndicator();
  }
  return globalProgress;
}

/**
 * Reset global progress indicator
 */
export function resetProgressIndicator(): void {
  if (globalProgress) {
    globalProgress.stop();
    globalProgress = null;
  }
}
