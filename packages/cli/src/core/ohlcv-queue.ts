/**
 * OHLCV Queue Manager
 *
 * Manages a simple JSON queue of tokens that need OHLCV data.
 * When simulation fails due to missing candles, items are added to the queue.
 * OHLCV ingestion handler prioritizes items from the queue.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Queue item: token and date that needs OHLCV data
 */
export interface OhlcvQueueItem {
  mint: string;
  alertTimestamp: string; // ISO format timestamp
  queuedAt: string; // ISO format timestamp when queued
  lookbackMinutes?: number; // Simulation lookback requirement
  lookforwardMinutes?: number; // Simulation lookforward requirement
  preWindowMinutes?: number; // OHLCV pre-window requirement
  postWindowMinutes?: number; // OHLCV post-window requirement
}

/**
 * Queue file path (in artifacts directory)
 */
function getQueuePath(): string {
  const queueDir = process.env.OHLCV_QUEUE_DIR || './artifacts/ohlcv-queue';
  return join(queueDir, 'queue.json');
}

/**
 * Read queue from disk
 */
export async function readQueue(): Promise<OhlcvQueueItem[]> {
  const queuePath = getQueuePath();

  if (!existsSync(queuePath)) {
    return [];
  }

  try {
    const content = await readFile(queuePath, 'utf-8');
    const queue = JSON.parse(content) as OhlcvQueueItem[];
    return Array.isArray(queue) ? queue : [];
  } catch (_error) {
    // If file is corrupted or doesn't exist, return empty queue
    return [];
  }
}

/**
 * Write queue to disk
 */
export async function writeQueue(queue: OhlcvQueueItem[]): Promise<void> {
  const queuePath = getQueuePath();
  const queueDir = join(queuePath, '..');

  // Ensure directory exists
  await mkdir(queueDir, { recursive: true });

  // Write queue as JSON
  await writeFile(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
}

/**
 * Add item to queue (deduplicates by mint + alertTimestamp)
 */
export async function addToQueue(
  mint: string,
  alertTimestamp: string,
  options?: {
    lookbackMinutes?: number;
    lookforwardMinutes?: number;
    preWindowMinutes?: number;
    postWindowMinutes?: number;
  }
): Promise<void> {
  const queue = await readQueue();

  // Check if already in queue
  const existingIndex = queue.findIndex(
    (item) => item.mint === mint && item.alertTimestamp === alertTimestamp
  );

  if (existingIndex >= 0) {
    // Update existing item with new timeframe requirements if provided
    if (options) {
      queue[existingIndex] = {
        ...queue[existingIndex],
        ...options,
      };
      await writeQueue(queue);
    }
  } else {
    queue.push({
      mint,
      alertTimestamp,
      queuedAt: new Date().toISOString(),
      ...options,
    });

    await writeQueue(queue);
  }
}

/**
 * Remove item from queue
 */
export async function removeFromQueue(mint: string, alertTimestamp: string): Promise<void> {
  const queue = await readQueue();

  const filtered = queue.filter(
    (item) => !(item.mint === mint && item.alertTimestamp === alertTimestamp)
  );

  if (filtered.length !== queue.length) {
    await writeQueue(filtered);
  }
}

/**
 * Clear entire queue
 */
export async function clearQueue(): Promise<void> {
  await writeQueue([]);
}

/**
 * Get queue size
 */
export async function getQueueSize(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}
