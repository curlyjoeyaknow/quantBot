/**
 * Data Snapshot Types
 *
 * A data snapshot is a reproducible slice of data:
 * - What sources
 * - What time range
 * - What filters
 * - What version of transforms
 *
 * Generates DataSnapshotRef with content hash for reproducibility.
 */

import { z } from 'zod';
import type { DateTime } from 'luxon';
import type { Chain } from '@quantbot/core';

/**
 * Data source identifier
 */
export const DataSourceSchema = z.enum(['calls', 'trades', 'ohlcv', 'metadata', 'signals', 'all']);

export type DataSource = z.infer<typeof DataSourceSchema>;

/**
 * Snapshot filter criteria
 */
export const SnapshotFilterSchema = z.object({
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'monad', 'evm']).optional(),
  tokenAddresses: z.array(z.string()).optional(),
  callerNames: z.array(z.string()).optional(),
  venues: z.array(z.string()).optional(),
  eventTypes: z.array(z.string()).optional(),
});

export type SnapshotFilter = z.infer<typeof SnapshotFilterSchema>;

/**
 * Snapshot creation spec
 */
export const SnapshotSpecSchema = z.object({
  /**
   * Data sources to include
   */
  sources: z.array(DataSourceSchema),

  /**
   * Time range (ISO 8601 strings)
   */
  from: z.string().datetime(),
  to: z.string().datetime(),

  /**
   * Filter criteria
   */
  filters: SnapshotFilterSchema.optional(),

  /**
   * Transform version (for reproducibility)
   */
  transformVersion: z.string().optional(),

  /**
   * Snapshot name/description
   */
  name: z.string().optional(),
  description: z.string().optional(),
});

export type SnapshotSpec = z.infer<typeof SnapshotSpecSchema>;

/**
 * Data snapshot reference
 *
 * This is the immutable identifier for a snapshot.
 * Contains content hash for reproducibility.
 */
export const DataSnapshotRefSchema = z.object({
  /**
   * Unique snapshot ID
   */
  snapshotId: z.string(),

  /**
   * Content hash (SHA-256) of the snapshot manifest
   * Used to verify snapshot integrity and detect changes
   */
  contentHash: z.string(),

  /**
   * Snapshot creation timestamp
   */
  createdAt: z.string().datetime(),

  /**
   * Snapshot spec (what was requested)
   */
  spec: SnapshotSpecSchema,

  /**
   * Snapshot manifest (what was actually included)
   */
  manifest: z.object({
    /**
     * Total event count
     */
    eventCount: z.number(),

    /**
     * Event counts by type
     */
    eventCountsByType: z.record(z.string(), z.number()),

    /**
     * Token coverage (unique tokens in snapshot)
     */
    tokenCount: z.number(),

    /**
     * Time range actually covered (may differ from spec if data gaps exist)
     */
    actualFrom: z.string().datetime(),
    actualTo: z.string().datetime(),

    /**
     * Data quality metrics
     */
    quality: z.object({
      /**
       * Completeness percentage (0-100)
       */
      completeness: z.number().min(0).max(100),

      /**
       * Missing data indicators
       */
      missingData: z.array(z.string()).optional(),

      /**
       * Anomalies detected
       */
      anomalies: z.array(z.string()).optional(),
    }),
  }),
});

export type DataSnapshotRef = z.infer<typeof DataSnapshotRefSchema>;

/**
 * Snapshot query options
 */
export const SnapshotQueryOptionsSchema = z.object({
  /**
   * Event types to include
   */
  eventTypes: z.array(z.string()).optional(),

  /**
   * Token addresses to filter
   */
  tokenAddresses: z.array(z.string()).optional(),

  /**
   * Time range (optional, defaults to snapshot range)
   */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),

  /**
   * Limit results
   */
  limit: z.number().int().positive().optional(),
});

export type SnapshotQueryOptions = z.infer<typeof SnapshotQueryOptionsSchema>;
