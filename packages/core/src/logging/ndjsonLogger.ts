/**
 * NDJSON Logger - Append-only logging to a single file
 *
 * Writes one JSON object per line (NDJSON format) to avoid creating
 * thousands of files that murder file watchers.
 *
 * - Minimal overhead
 * - Crash-safe-ish (worst case: last line truncated)
 * - Streamable, greppable
 * - Avoids Vite watch issues
 */

import fs from 'node:fs';
import path from 'node:path';
import { getArtifactsDir } from '../paths/artifactsPath.js';

type JsonRecord = Record<string, unknown>;

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Append-only NDJSON logger (one JSON object per line).
 * - Minimal overhead
 * - Crash-safe-ish (worst case: last line truncated)
 * - Avoids creating thousands of files that murder file watchers
 */
export class NdjsonLogger {
  private stream: fs.WriteStream;
  private filePath: string;

  constructor(opts?: { filename?: string }) {
    const dir = getArtifactsDir();
    fs.mkdirSync(dir, { recursive: true });

    // Optional: rotate by day (keeps files manageable)
    const date = new Date().toISOString().slice(0, 10);
    const filename = opts?.filename ?? `runs-${date}.ndjson`;
    this.filePath = path.join(dir, filename);

    // 'a' = append. Keep it simple.
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });

    // Don't let stream errors become silent unhandled rejections.
    this.stream.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[NdjsonLogger] stream error:', err);
    });
  }

  /**
   * Get the file path this logger writes to
   */
  path(): string {
    return this.filePath;
  }

  /**
   * Write a record as a single NDJSON line.
   * Adds timestamp + type automatically.
   *
   * @param type - Event type (e.g., 'run_start', 'event', 'run_end')
   * @param record - Additional data to include in the log entry
   */
  log(type: string, record: JsonRecord = {}): void {
    const lineObj = { ts: isoNow(), type, ...record };
    const line = JSON.stringify(lineObj) + '\n';

    const ok = this.stream.write(line);
    // Backpressure: if buffer is full, wait for drain (optional but safe)
    if (!ok) {
      // Fire-and-forget drain handling; caller doesn't need to await.
      this.stream.once('drain', () => {});
    }
  }

  /**
   * Graceful shutdown (flush).
   */
  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.stream.end(() => resolve());
    });
  }
}
