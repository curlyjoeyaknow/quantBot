/**
 * DuckDB Run Event Adapter
 *
 * Implements RunEventPort using DuckDB for append-only event storage.
 */
import type {
  RunEventPort,
  RunEventQuery,
  RunEventQueryResult,
  RunEvent,
  RunEventType,
  RunState,
} from '@quantbot/core';

import { join } from 'path';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger, findWorkspaceRoot } from '@quantbot/utils';

/**
 * Event row schema (as stored in DuckDB)
 */
const EventRowSchema = z.object({
  event_id: z.string(),
  run_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string(),
  event_version: z.number(),
  payload_json: z.string(),
  metadata_json: z.string().nullable(),
});

/**
 * Run state row schema
 */
const RunStateRowSchema = z.object({
  run_id: z.string(),
  status: z.string(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  failed_at: z.string().nullable(),
  strategy_id: z.string(),
  strategy_name: z.string(),
  code_version: z.string().nullable(),
  config_hash: z.string().nullable(),
  seed: z.number().nullable(),
  last_event_type: z.string().nullable(),
  last_event_at: z.string().nullable(),
  error_message: z.string().nullable(),
  error_code: z.string().nullable(),
  calls_attempted: z.number().nullable(),
  calls_succeeded: z.number().nullable(),
  calls_failed: z.number().nullable(),
  trades_total: z.number().nullable(),
});

/**
 * DuckDB Run Event Adapter
 */
export class RunEventDuckDBAdapter implements RunEventPort {
  private client: DuckDBClient;
  private scriptPath: string;
  private dbPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.dbPath = dbPath;
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_run_events.py');
  }

  /**
   * Initialize schema
   */
  async initializeSchema(): Promise<void> {
    try {
      await this.client.execute(
        this.scriptPath,
        'init_schema',
        { 'db-path': this.dbPath },
        z.object({ success: z.boolean() })
      );
    } catch (error) {
      logger.error('Failed to initialize run_events schema', error as Error);
      throw error;
    }
  }

  async append(event: RunEvent): Promise<void> {
    try {
      await this.client.execute(
        this.scriptPath,
        'append_event',
        {
          'db-path': this.dbPath,
          event_id: event.event_id,
          run_id: event.run_id,
          event_type: event.event_type,
          occurred_at: event.occurred_at.toISO(),
          event_version: event.event_version,
          payload_json: JSON.stringify(event.payload),
          metadata_json: event.metadata ? JSON.stringify(event.metadata) : null,
        },
        z.object({ success: z.boolean() })
      );
    } catch (error) {
      logger.error('Failed to append event', error as Error, {
        run_id: event.run_id,
        event_type: event.event_type,
      });
      throw error;
    }
  }

  async appendMany(events: RunEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    try {
      await this.client.execute(
        this.scriptPath,
        'append_events',
        {
          'db-path': this.dbPath,
          events: events.map((e) => ({
            event_id: e.event_id,
            run_id: e.run_id,
            event_type: e.event_type,
            occurred_at: e.occurred_at.toISO(),
            event_version: e.event_version,
            payload_json: JSON.stringify(e.payload),
            metadata_json: e.metadata ? JSON.stringify(e.metadata) : null,
          })),
        },
        z.object({ success: z.boolean() })
      );
    } catch (error) {
      logger.error('Failed to append events', error as Error, {
        run_id: events[0]?.run_id,
        count: events.length,
      });
      throw error;
    }
  }

  async query(filter: RunEventQuery): Promise<RunEventQueryResult> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'query_events',
        {
          'db-path': this.dbPath,
          run_id: filter.run_id,
          event_type: filter.event_type
            ? Array.isArray(filter.event_type)
              ? filter.event_type
              : [filter.event_type]
            : undefined,
          from_occurred_at: filter.from_occurred_at?.toISO(),
          to_occurred_at: filter.to_occurred_at?.toISO(),
          limit: filter.limit,
          offset: filter.offset,
        },
        z.object({
          success: z.boolean(),
          events: z.array(EventRowSchema),
          total: z.number(),
        })
      );

      const events: RunEvent[] = result.events.map((row) => {
        const payload = JSON.parse(row.payload_json);
        const metadata = row.metadata_json ? JSON.parse(row.metadata_json) : undefined;

        return {
          event_id: row.event_id,
          run_id: row.run_id,
          event_type: row.event_type as RunEventType,
          occurred_at: DateTime.fromISO(row.occurred_at),
          event_version: row.event_version,
          payload,
          metadata,
        } as RunEvent;
      });

      return {
        events,
        total: result.total,
      };
    } catch (error) {
      logger.error('Failed to query events', error as Error, { filter });
      throw error;
    }
  }

  async getByRunId(runId: string): Promise<RunEvent[]> {
    const result = await this.query({ run_id: runId });
    return result.events;
  }

  async getRunState(runId: string): Promise<RunState | null> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'get_run_state',
        {
          'db-path': this.dbPath,
          run_id: runId,
        },
        z.object({
          success: z.boolean(),
          state: RunStateRowSchema.nullable(),
        })
      );

      if (!result.state) {
        return null;
      }

      const row = result.state;
      return {
        run_id: row.run_id,
        status: row.status as RunState['status'],
        created_at: DateTime.fromISO(row.created_at),
        started_at: row.started_at ? DateTime.fromISO(row.started_at) : undefined,
        completed_at: row.completed_at ? DateTime.fromISO(row.completed_at) : undefined,
        failed_at: row.failed_at ? DateTime.fromISO(row.failed_at) : undefined,
        strategy_id: row.strategy_id,
        strategy_name: row.strategy_name,
        code_version: row.code_version || undefined,
        config_hash: row.config_hash || undefined,
        seed: row.seed || undefined,
        last_event_type: (row.last_event_type as RunEventType) || undefined,
        last_event_at: row.last_event_at ? DateTime.fromISO(row.last_event_at) : undefined,
        error_message: row.error_message || undefined,
        error_code: row.error_code || undefined,
        calls_attempted: row.calls_attempted || undefined,
        calls_succeeded: row.calls_succeeded || undefined,
        calls_failed: row.calls_failed || undefined,
        trades_total: row.trades_total || undefined,
      };
    } catch (error) {
      logger.error('Failed to get run state', error as Error, { run_id: runId });
      throw error;
    }
  }

  async getLatestEvent(runId: string): Promise<RunEvent | null> {
    const result = await this.query({
      run_id: runId,
      limit: 1,
    });

    if (result.events.length === 0) {
      return null;
    }

    // Events are returned in chronological order, so last one is latest
    return result.events[result.events.length - 1];
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.execute(
        this.scriptPath,
        'check_available',
        {
          'db-path': this.dbPath,
        },
        z.object({ success: z.boolean() })
      );
      return true;
    } catch {
      return false;
    }
  }
}
