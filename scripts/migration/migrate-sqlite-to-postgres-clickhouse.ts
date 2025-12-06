#!/usr/bin/env tsx
/**
 * SQLite to PostgreSQL and ClickHouse Migration Script
 * 
 * This script migrates data from existing SQLite database files to:
 * - PostgreSQL: OLTP data (tokens, strategies, simulation runs, alerts, callers)
 * - ClickHouse: Time-series data (simulation events, OHLCV data)
 * 
 * Usage:
 *   tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts [--dry-run] [--db <database-name>]
 * 
 * Options:
 *   --dry-run: Show what would be migrated without actually migrating
 *   --db <name>: Migrate only a specific database (e.g., caller_alerts, quantbot, strategy_results)
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { config } from 'dotenv';

// Simple logger implementation
const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, error?: Error, ...args: any[]) => {
    console.error(`[ERROR] ${msg}`, error?.message || '', ...args);
    if (error?.stack) console.error(error.stack);
  },
};

config();

// SQLite database paths
const DATA_DIR = path.join(process.cwd(), 'data');
const DATABASES_DIR = path.join(DATA_DIR, 'databases');

const SQLITE_DBS = {
  caller_alerts: path.join(DATA_DIR, 'caller_alerts.db'),
  caller_alerts_db: path.join(DATABASES_DIR, 'caller_alerts.db'),
  quantbot: path.join(DATA_DIR, 'quantbot.db'),
  simulations: path.join(DATA_DIR, 'simulations.db'),
  simulations_db: path.join(DATABASES_DIR, 'simulations.db'),
  strategy_results: path.join(DATA_DIR, 'strategy_results.db'),
  strategy_results_db: path.join(DATABASES_DIR, 'strategy_results.db'),
  dashboard_metrics: path.join(DATA_DIR, 'dashboard_metrics.db'),
  dashboard_metrics_db: path.join(DATABASES_DIR, 'dashboard_metrics.db'),
  tokens: path.join(DATABASES_DIR, 'tokens.db'),
  unified_calls: path.join(DATA_DIR, 'unified_calls.db'),
};

interface MigrationStats {
  database: string;
  table: string;
  rows: number;
  success: boolean;
  error?: string;
}

class DatabaseMigrator {
  private pgPool: Pool;
  private clickhouse: ClickHouseClient | null = null;
  private stats: MigrationStats[] = [];
  private dryRun: boolean;

  constructor(dryRun: boolean = false) {
    this.dryRun = dryRun;
    this.pgPool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'quantbot',
      password: process.env.POSTGRES_PASSWORD || '',
      database: process.env.POSTGRES_DATABASE || 'quantbot',
      max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '10'),
    });

    // Initialize ClickHouse client if enabled
    if (process.env.USE_CLICKHOUSE === 'true') {
      const chHost = process.env.CLICKHOUSE_HOST || 'localhost';
      const chPort = parseInt(process.env.CLICKHOUSE_PORT || '18123');
      const chUser = process.env.CLICKHOUSE_USER || 'default';
      const chPassword = process.env.CLICKHOUSE_PASSWORD || '';
      const chDatabase = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      const config: any = {
        url: `http://${chHost}:${chPort}`,
        username: chUser,
        database: chDatabase,
      };

      if (chPassword) {
        config.password = chPassword;
      }

      this.clickhouse = createClient(config);
    }
  }

  private getClickHouseClient(): ClickHouseClient {
    if (!this.clickhouse) {
      throw new Error('ClickHouse is not enabled. Set USE_CLICKHOUSE=true in .env');
    }
    return this.clickhouse;
  }

  /**
   * Open SQLite database connection
   */
  private async openSqliteDb(dbPath: string): Promise<Database | null> {
    const fs = await import('fs');
    if (!fs.existsSync(dbPath)) {
      logger.warn(`SQLite database not found: ${dbPath}`);
      return null;
    }

    return new Promise((resolve, reject) => {
      const db = new Database(dbPath, (err) => {
        if (err) {
          logger.error(`Failed to open SQLite database: ${dbPath}`, err);
          reject(err);
        } else {
          resolve(db);
        }
      });
    });
  }

  /**
   * Close SQLite database connection
   */
  private async closeSqliteDb(db: Database): Promise<void> {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Migrate caller_alerts.db to PostgreSQL
   */
  private async migrateCallerAlerts(dbPath: string): Promise<void> {
    const db = await this.openSqliteDb(dbPath);
    if (!db) return;

    const all = promisify(db.all.bind(db));
    const client = await this.pgPool.connect();

    try {
      // First, ensure callers table exists and migrate unique callers
      const callersResult = await all(`
        SELECT DISTINCT caller_name
        FROM caller_alerts
        ORDER BY caller_name
      `) as any[];

      logger.info(`Found ${callersResult.length} unique callers`);

      if (!this.dryRun) {
        for (const row of callersResult) {
          await client.query(`
            INSERT INTO callers (source, handle, display_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (source, handle) DO NOTHING
          `, ['legacy', row.caller_name, row.caller_name]);
        }
      }

      // Migrate tokens
      const tokensResult = await all(`
        SELECT DISTINCT token_address, token_symbol, chain
        FROM caller_alerts
        WHERE token_address IS NOT NULL
      `) as any[];

      logger.info(`Found ${tokensResult.length} unique tokens`);

      if (!this.dryRun) {
        for (const row of tokensResult) {
          await client.query(`
            INSERT INTO tokens (chain, address, symbol)
            VALUES ($1, $2, $3)
            ON CONFLICT (chain, address) DO UPDATE
            SET symbol = COALESCE(tokens.symbol, EXCLUDED.symbol)
          `, [row.chain || 'solana', row.token_address.toLowerCase(), row.token_symbol]);
        }
      }

      // Migrate alerts
      const alerts = await all(`
        SELECT *
        FROM caller_alerts
        ORDER BY alert_timestamp ASC
      `) as any[];

      logger.info(`Migrating ${alerts.length} caller alerts`);

      let migratedCount = 0;
      if (!this.dryRun) {
        await client.query('BEGIN');

        for (const alert of alerts) {
          try {
            // Get token_id - CASE SENSITIVE for Solana addresses!
            const tokenResult = await client.query(
              'SELECT id FROM tokens WHERE chain = $1 AND address = $2',
              [alert.chain || 'solana', alert.token_address]
            );

            // Get caller_id
            const callerResult = await client.query(
              'SELECT id FROM callers WHERE source = $1 AND handle = $2',
              ['legacy', alert.caller_name]
            );

            if (tokenResult.rows.length === 0 || callerResult.rows.length === 0) {
              logger.warn(`Skipping alert: token or caller not found`, { 
                tokenAddress: alert.token_address, 
                callerName: alert.caller_name 
              });
              continue;
            }

            const tokenId = tokenResult.rows[0].id;
            const callerId = callerResult.rows[0].id;

            // Insert alert
            await client.query(`
              INSERT INTO alerts (
                token_id, caller_id, side, alert_price, alert_timestamp,
                raw_payload_json
              )
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT DO NOTHING
            `, [
              tokenId,
              callerId,
              'buy', // Default to buy since old alerts don't have side
              alert.price_at_alert,
              alert.alert_timestamp,
              JSON.stringify({
                message: alert.alert_message,
                volume: alert.volume_at_alert,
                legacy_id: alert.id,
              }),
            ]);

            migratedCount++;
          } catch (error) {
            logger.error('Failed to migrate alert', error as Error, { alertId: alert.id });
          }
        }

        await client.query('COMMIT');
      } else {
        migratedCount = alerts.length;
      }

      this.stats.push({
        database: 'caller_alerts',
        table: 'alerts',
        rows: migratedCount,
        success: true,
      });

      logger.info(`Migrated ${migratedCount} alerts`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      this.stats.push({
        database: 'caller_alerts',
        table: 'alerts',
        rows: 0,
        success: false,
        error: (error as Error).message,
      });
      logger.error('Failed to migrate caller alerts', error as Error);
      throw error;
    } finally {
      client.release();
      await this.closeSqliteDb(db);
    }
  }

  /**
   * Migrate quantbot.db (main database) to PostgreSQL
   */
  private async migrateQuantbot(dbPath: string): Promise<void> {
    const db = await this.openSqliteDb(dbPath);
    if (!db) return;

    const all = promisify(db.all.bind(db));
    const client = await this.pgPool.connect();

    try {
      // Migrate tokens table
      const tokens = await all('SELECT * FROM tokens') as any[];
      logger.info(`Migrating ${tokens.length} tokens from quantbot.db`);

      if (!this.dryRun && tokens.length > 0) {
        await client.query('BEGIN');

        for (const token of tokens) {
          await client.query(`
            INSERT INTO tokens (chain, address, symbol, name, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (chain, address) DO UPDATE
            SET symbol = COALESCE(tokens.symbol, EXCLUDED.symbol),
                name = COALESCE(tokens.name, EXCLUDED.name),
                updated_at = EXCLUDED.updated_at
          `, [
            token.chain || 'solana',
            token.mint,
            token.token_symbol,
            token.token_name,
            token.created_at || new Date().toISOString(),
            token.updated_at || new Date().toISOString(),
          ]);
        }

        await client.query('COMMIT');
      }

      this.stats.push({
        database: 'quantbot',
        table: 'tokens',
        rows: tokens.length,
        success: true,
      });

      // Migrate strategies table
      const strategies = await all('SELECT * FROM strategies') as any[];
      logger.info(`Migrating ${strategies.length} strategies`);

      if (!this.dryRun && strategies.length > 0) {
        await client.query('BEGIN');

        for (const strategy of strategies) {
          try {
            await client.query(`
              INSERT INTO strategies (name, version, description, config_json, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (name, version) DO UPDATE
              SET description = EXCLUDED.description,
                  config_json = EXCLUDED.config_json,
                  updated_at = EXCLUDED.updated_at
            `, [
              strategy.name,
              '1',
              strategy.description,
              JSON.stringify({
                strategy: JSON.parse(strategy.strategy),
                stop_loss_config: JSON.parse(strategy.stop_loss_config),
                is_default: strategy.is_default,
                user_id: strategy.user_id,
              }),
              strategy.created_at || new Date().toISOString(),
              new Date().toISOString(),
            ]);
          } catch (error) {
            logger.error('Failed to migrate strategy', error as Error, { strategyId: strategy.id });
          }
        }

        await client.query('COMMIT');
      }

      this.stats.push({
        database: 'quantbot',
        table: 'strategies',
        rows: strategies.length,
        success: true,
      });

      // Migrate simulation_runs table
      const runs = await all('SELECT * FROM simulation_runs ORDER BY id ASC') as any[];
      logger.info(`Migrating ${runs.length} simulation runs`);

      if (!this.dryRun && runs.length > 0) {
        await client.query('BEGIN');

        for (const run of runs) {
          try {
            // Get or create token
            const tokenResult = await client.query(
              'SELECT id FROM tokens WHERE chain = $1 AND address = $2',
              [run.chain || 'solana', run.mint]
            );

            let tokenId: number;
            if (tokenResult.rows.length === 0) {
              const insertResult = await client.query(`
                INSERT INTO tokens (chain, address, symbol, name)
                VALUES ($1, $2, $3, $4)
                RETURNING id
              `, [run.chain || 'solana', run.mint, run.token_symbol, run.token_name]);
              tokenId = insertResult.rows[0].id;
            } else {
              tokenId = tokenResult.rows[0].id;
            }

            // Get strategy_id if exists
            let strategyId: number | null = null;
            if (run.strategy_name) {
              const strategyResult = await client.query(
                'SELECT id FROM strategies WHERE name = $1',
                [run.strategy_name]
              );
              if (strategyResult.rows.length > 0) {
                strategyId = strategyResult.rows[0].id;
              }
            }

            // Insert simulation run
            const runResult = await client.query(`
              INSERT INTO simulation_runs (
                strategy_id, token_id, run_type, engine_version, config_hash,
                config_json, data_selection_json, status, started_at, completed_at,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              RETURNING id
            `, [
              strategyId,
              tokenId,
              'backtest',
              'legacy',
              run.id.toString(), // Use old ID as hash
              JSON.stringify({
                strategy: JSON.parse(run.strategy || '{}'),
                stop_loss_config: JSON.parse(run.stop_loss_config || '{}'),
                entry_type: run.entry_type,
                entry_price: run.entry_price,
                entry_timestamp: run.entry_timestamp,
                filter_criteria: run.filter_criteria,
              }),
              JSON.stringify({
                start_time: run.start_time,
                end_time: run.end_time,
                mint: run.mint,
                chain: run.chain,
              }),
              'completed',
              run.start_time,
              run.end_time,
              run.created_at || new Date().toISOString(),
            ]);

            const newRunId = runResult.rows[0].id;

            // Insert simulation results summary
            await client.query(`
              INSERT INTO simulation_results_summary (
                simulation_run_id, final_pnl, trade_count, metadata_json, created_at
              )
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (simulation_run_id) DO NOTHING
            `, [
              newRunId,
              run.final_pnl,
              run.total_candles || 0,
              JSON.stringify({
                legacy_run_id: run.id,
                user_id: run.user_id,
              }),
              run.created_at || new Date().toISOString(),
            ]);
          } catch (error) {
            logger.error('Failed to migrate simulation run', error as Error, { runId: run.id });
          }
        }

        await client.query('COMMIT');
      }

      this.stats.push({
        database: 'quantbot',
        table: 'simulation_runs',
        rows: runs.length,
        success: true,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Failed to migrate quantbot.db', error as Error);
      throw error;
    } finally {
      client.release();
      await this.closeSqliteDb(db);
    }
  }

  /**
   * Migrate strategy_results.db to PostgreSQL
   */
  private async migrateStrategyResults(dbPath: string): Promise<void> {
    const db = await this.openSqliteDb(dbPath);
    if (!db) return;

    const all = promisify(db.all.bind(db));
    const client = await this.pgPool.connect();

    try {
      const results = await all('SELECT * FROM strategy_results') as any[];
      logger.info(`Migrating ${results.length} strategy results`);

      if (!this.dryRun && results.length > 0) {
        await client.query('BEGIN');

        for (const result of results) {
          try {
            // Get token_id
            const tokenResult = await client.query(
              'SELECT id FROM tokens WHERE chain = $1 AND address = $2',
              [result.chain || 'solana', result.token_address.toLowerCase()]
            );

            if (tokenResult.rows.length === 0) {
              logger.warn(`Token not found for strategy result`, { 
                tokenAddress: result.token_address 
              });
              continue;
            }

            const tokenId = tokenResult.rows[0].id;

            // Try to find corresponding alert to link to simulation run
            const alertResult = await client.query(`
              SELECT a.id, sr.simulation_run_id
              FROM alerts a
              LEFT JOIN (
                SELECT DISTINCT simulation_run_id, token_id
                FROM simulation_results_summary srs
                JOIN simulation_runs sr ON sr.id = srs.simulation_run_id
              ) sr ON sr.token_id = a.token_id
              WHERE a.token_id = $1
              AND a.alert_timestamp::text LIKE $2
              LIMIT 1
            `, [tokenId, result.alert_timestamp + '%']);

            let simulationRunId: number | null = null;
            if (alertResult.rows.length > 0 && alertResult.rows[0].simulation_run_id) {
              simulationRunId = alertResult.rows[0].simulation_run_id;
            }

            // If we have a simulation_run_id, update the summary
            if (simulationRunId) {
              await client.query(`
                UPDATE simulation_results_summary
                SET final_pnl = $1,
                    trade_count = COALESCE(trade_count, 1),
                    avg_trade_return = $2,
                    average_holding_minutes = $3,
                    metadata_json = jsonb_set(
                      COALESCE(metadata_json, '{}')::jsonb,
                      '{strategy_result}',
                      $4::jsonb
                    )
                WHERE simulation_run_id = $5
              `, [
                result.pnl,
                result.pnl,
                result.hold_duration_minutes,
                JSON.stringify({
                  alert_id: result.alert_id,
                  entry_price: result.entry_price,
                  exit_price: result.exit_price,
                  max_reached: result.max_reached,
                  computed_at: result.computed_at,
                }),
                simulationRunId,
              ]);
            }
          } catch (error) {
            logger.error('Failed to migrate strategy result', error as Error, { 
              resultId: result.id 
            });
          }
        }

        await client.query('COMMIT');
      }

      this.stats.push({
        database: 'strategy_results',
        table: 'simulation_results_summary',
        rows: results.length,
        success: true,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Failed to migrate strategy results', error as Error);
      throw error;
    } finally {
      client.release();
      await this.closeSqliteDb(db);
    }
  }

  /**
   * Migrate dashboard_metrics.db to PostgreSQL
   */
  private async migrateDashboardMetrics(dbPath: string): Promise<void> {
    const db = await this.openSqliteDb(dbPath);
    if (!db) return;

    const all = promisify(db.all.bind(db));
    const client = await this.pgPool.connect();

    try {
      // First, create the dashboard_metrics table if it doesn't exist
      if (!this.dryRun) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS dashboard_metrics (
            id BIGSERIAL PRIMARY KEY,
            computed_at TIMESTAMPTZ NOT NULL UNIQUE,
            total_calls INTEGER NOT NULL,
            pnl_from_alerts NUMERIC(20, 8) NOT NULL,
            max_drawdown NUMERIC(20, 8) NOT NULL,
            current_daily_profit NUMERIC(20, 8) NOT NULL,
            last_week_daily_profit NUMERIC(20, 8) NOT NULL,
            overall_profit NUMERIC(20, 8) NOT NULL,
            largest_gain NUMERIC(20, 8) NOT NULL,
            profit_since_october NUMERIC(20, 8) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_computed_at
          ON dashboard_metrics (computed_at DESC)
        `);
      }

      const metrics = await all('SELECT * FROM dashboard_metrics ORDER BY computed_at ASC') as any[];
      logger.info(`Migrating ${metrics.length} dashboard metrics`);

      if (!this.dryRun && metrics.length > 0) {
        await client.query('BEGIN');

        for (const metric of metrics) {
          await client.query(`
            INSERT INTO dashboard_metrics (
              computed_at, total_calls, pnl_from_alerts, max_drawdown,
              current_daily_profit, last_week_daily_profit, overall_profit,
              largest_gain, profit_since_october
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (computed_at) DO UPDATE
            SET total_calls = EXCLUDED.total_calls,
                pnl_from_alerts = EXCLUDED.pnl_from_alerts,
                max_drawdown = EXCLUDED.max_drawdown,
                current_daily_profit = EXCLUDED.current_daily_profit,
                last_week_daily_profit = EXCLUDED.last_week_daily_profit,
                overall_profit = EXCLUDED.overall_profit,
                largest_gain = EXCLUDED.largest_gain,
                profit_since_october = EXCLUDED.profit_since_october
          `, [
            metric.computed_at,
            metric.total_calls,
            metric.pnl_from_alerts,
            metric.max_drawdown,
            metric.current_daily_profit,
            metric.last_week_daily_profit,
            metric.overall_profit,
            metric.largest_gain,
            metric.profit_since_october,
          ]);
        }

        await client.query('COMMIT');
      }

      this.stats.push({
        database: 'dashboard_metrics',
        table: 'dashboard_metrics',
        rows: metrics.length,
        success: true,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Failed to migrate dashboard metrics', error as Error);
      throw error;
    } finally {
      client.release();
      await this.closeSqliteDb(db);
    }
  }

  /**
   * Migrate simulation_events to ClickHouse
   */
  private async migrateSimulationEvents(dbPath: string): Promise<void> {
    const db = await this.openSqliteDb(dbPath);
    if (!db) return;

    if (!this.clickhouse) {
      logger.warn('ClickHouse not enabled, skipping simulation events migration');
      await this.closeSqliteDb(db);
      return;
    }

    const all = promisify(db.all.bind(db));
    const clickhouse = this.getClickHouseClient();
    const pgClient = await this.pgPool.connect();

    try {
      const events = await all(`
        SELECT se.*, sr.mint, sr.chain
        FROM simulation_events se
        JOIN simulation_runs sr ON sr.id = se.run_id
        ORDER BY se.run_id, se.id
      `) as any[];

      logger.info(`Migrating ${events.length} simulation events to ClickHouse`);

      if (!this.dryRun && events.length > 0) {
        const batchSize = 1000;
        for (let i = 0; i < events.length; i += batchSize) {
          const batch = events.slice(i, i + batchSize);

          const rows = batch.map((event) => ({
            simulation_run_id: event.run_id,
            token_address: event.mint || '',
            chain: event.chain || 'solana',
            event_time: new Date(event.timestamp * 1000).toISOString().replace('T', ' ').replace('Z', ''),
            seq: event.id,
            event_type: event.event_type,
            price: event.price,
            size: 0,
            remaining_position: event.remaining_position,
            pnl_so_far: event.pnl_so_far,
            indicators_json: '{}',
            position_state_json: '{}',
            metadata_json: JSON.stringify({
              description: event.description,
            }),
          }));

          await clickhouse.insert({
            table: 'simulation_events',
            values: rows,
            format: 'JSONEachRow',
          });

          logger.info(`Migrated ${i + batch.length}/${events.length} simulation events`);
        }
      }

      this.stats.push({
        database: 'quantbot',
        table: 'simulation_events (ClickHouse)',
        rows: events.length,
        success: true,
      });
    } catch (error) {
      logger.error('Failed to migrate simulation events', error as Error);
      this.stats.push({
        database: 'quantbot',
        table: 'simulation_events (ClickHouse)',
        rows: 0,
        success: false,
        error: (error as Error).message,
      });
    } finally {
      pgClient.release();
      await this.closeSqliteDb(db);
    }
  }

  /**
   * Migrate unified_calls.db to PostgreSQL
   */
  private async migrateUnifiedCalls(dbPath: string): Promise<void> {
    const db = await this.openSqliteDb(dbPath);
    if (!db) return;

    const all = promisify(db.all.bind(db));
    const client = await this.pgPool.connect();

    try {
      const calls = await all('SELECT * FROM unified_calls ORDER BY alert_timestamp ASC') as any[];
      logger.info(`Migrating ${calls.length} unified calls`);

      if (!this.dryRun && calls.length > 0) {
        await client.query('BEGIN');

        for (const call of calls) {
          try {
            // Ensure caller exists
            await client.query(`
              INSERT INTO callers (source, handle, display_name)
              VALUES ($1, $2, $3)
              ON CONFLICT (source, handle) DO NOTHING
            `, [call.source || 'legacy', call.caller_name, call.caller_name]);

            // Ensure token exists
            await client.query(`
              INSERT INTO tokens (chain, address, symbol)
              VALUES ($1, $2, $3)
              ON CONFLICT (chain, address) DO UPDATE
              SET symbol = COALESCE(tokens.symbol, EXCLUDED.symbol)
            `, [call.chain || 'solana', call.token_address.toLowerCase(), call.token_symbol]);

            // Get IDs
            const tokenResult = await client.query(
              'SELECT id FROM tokens WHERE chain = $1 AND address = $2',
              [call.chain || 'solana', call.token_address.toLowerCase()]
            );

            const callerResult = await client.query(
              'SELECT id FROM callers WHERE source = $1 AND handle = $2',
              [call.source || 'legacy', call.caller_name]
            );

            if (tokenResult.rows.length === 0 || callerResult.rows.length === 0) {
              continue;
            }

            const tokenId = tokenResult.rows[0].id;
            const callerId = callerResult.rows[0].id;

            // Insert as both alert and call
            const alertResult = await client.query(`
              INSERT INTO alerts (
                token_id, caller_id, side, alert_price, alert_timestamp,
                raw_payload_json
              )
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT DO NOTHING
              RETURNING id
            `, [
              tokenId,
              callerId,
              'buy',
              call.price_at_alert,
              call.alert_timestamp,
              JSON.stringify({
                message: call.alert_message,
                volume: call.volume_at_alert,
                source: call.source,
                original_id: call.originalId,
              }),
            ]);

            if (alertResult.rows.length > 0) {
              const alertId = alertResult.rows[0].id;

              await client.query(`
                INSERT INTO calls (
                  alert_id, token_id, caller_id, side, signal_type,
                  signal_timestamp, metadata_json
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING
              `, [
                alertId,
                tokenId,
                callerId,
                'buy',
                'entry',
                call.alert_timestamp,
                JSON.stringify({
                  source: call.source,
                  original_id: call.originalId,
                }),
              ]);
            }
          } catch (error) {
            logger.error('Failed to migrate unified call', error as Error, { callId: call.id });
          }
        }

        await client.query('COMMIT');
      }

      this.stats.push({
        database: 'unified_calls',
        table: 'calls',
        rows: calls.length,
        success: true,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Failed to migrate unified calls', error as Error);
      throw error;
    } finally {
      client.release();
      await this.closeSqliteDb(db);
    }
  }

  /**
   * Run all migrations
   */
  async migrate(specificDb?: string): Promise<void> {
    logger.info(`Starting migration ${this.dryRun ? '(DRY RUN)' : ''}`);

    const migrations: Array<{ name: string; fn: () => Promise<void> }> = [];

    // Add migrations based on which databases exist
    if (!specificDb || specificDb === 'caller_alerts') {
      if (await this.dbExists(SQLITE_DBS.caller_alerts)) {
        migrations.push({
          name: 'caller_alerts',
          fn: () => this.migrateCallerAlerts(SQLITE_DBS.caller_alerts),
        });
      }
      if (await this.dbExists(SQLITE_DBS.caller_alerts_db)) {
        migrations.push({
          name: 'caller_alerts_db',
          fn: () => this.migrateCallerAlerts(SQLITE_DBS.caller_alerts_db),
        });
      }
    }

    if (!specificDb || specificDb === 'quantbot') {
      if (await this.dbExists(SQLITE_DBS.quantbot)) {
        migrations.push({
          name: 'quantbot',
          fn: () => this.migrateQuantbot(SQLITE_DBS.quantbot),
        });
      }
    }

    if (!specificDb || specificDb === 'simulations') {
      if (await this.dbExists(SQLITE_DBS.simulations)) {
        migrations.push({
          name: 'simulations',
          fn: () => this.migrateQuantbot(SQLITE_DBS.simulations),
        });
      }
      if (await this.dbExists(SQLITE_DBS.simulations_db)) {
        migrations.push({
          name: 'simulations_db',
          fn: () => this.migrateQuantbot(SQLITE_DBS.simulations_db),
        });
      }
    }

    if (!specificDb || specificDb === 'strategy_results') {
      if (await this.dbExists(SQLITE_DBS.strategy_results)) {
        migrations.push({
          name: 'strategy_results',
          fn: () => this.migrateStrategyResults(SQLITE_DBS.strategy_results),
        });
      }
      if (await this.dbExists(SQLITE_DBS.strategy_results_db)) {
        migrations.push({
          name: 'strategy_results_db',
          fn: () => this.migrateStrategyResults(SQLITE_DBS.strategy_results_db),
        });
      }
    }

    if (!specificDb || specificDb === 'dashboard_metrics') {
      if (await this.dbExists(SQLITE_DBS.dashboard_metrics)) {
        migrations.push({
          name: 'dashboard_metrics',
          fn: () => this.migrateDashboardMetrics(SQLITE_DBS.dashboard_metrics),
        });
      }
      if (await this.dbExists(SQLITE_DBS.dashboard_metrics_db)) {
        migrations.push({
          name: 'dashboard_metrics_db',
          fn: () => this.migrateDashboardMetrics(SQLITE_DBS.dashboard_metrics_db),
        });
      }
    }

    if (!specificDb || specificDb === 'unified_calls') {
      if (await this.dbExists(SQLITE_DBS.unified_calls)) {
        migrations.push({
          name: 'unified_calls',
          fn: () => this.migrateUnifiedCalls(SQLITE_DBS.unified_calls),
        });
      }
    }

    // Migrate simulation events to ClickHouse
    if (!specificDb || specificDb === 'simulation_events') {
      if (await this.dbExists(SQLITE_DBS.quantbot)) {
        migrations.push({
          name: 'simulation_events',
          fn: () => this.migrateSimulationEvents(SQLITE_DBS.quantbot),
        });
      }
    }

    // Run migrations
    for (const migration of migrations) {
      try {
        logger.info(`Running migration: ${migration.name}`);
        await migration.fn();
      } catch (error) {
        logger.error(`Migration failed: ${migration.name}`, error as Error);
      }
    }

    // Print summary
    this.printSummary();
  }

  /**
   * Check if database file exists
   */
  private async dbExists(dbPath: string): Promise<boolean> {
    const fs = await import('fs');
    return fs.existsSync(dbPath);
  }

  /**
   * Print migration summary
   */
  private printSummary(): void {
    logger.info('='.repeat(80));
    logger.info('Migration Summary');
    logger.info('='.repeat(80));

    let totalRows = 0;
    let successCount = 0;
    let failureCount = 0;

    for (const stat of this.stats) {
      const status = stat.success ? '✓' : '✗';
      logger.info(`${status} ${stat.database}.${stat.table}: ${stat.rows} rows`);

      if (stat.error) {
        logger.error(`  Error: ${stat.error}`);
      }

      if (stat.success) {
        successCount++;
        totalRows += stat.rows;
      } else {
        failureCount++;
      }
    }

    logger.info('='.repeat(80));
    logger.info(`Total: ${totalRows} rows migrated`);
    logger.info(`Success: ${successCount}, Failed: ${failureCount}`);
    logger.info('='.repeat(80));

    if (this.dryRun) {
      logger.info('DRY RUN: No data was actually migrated');
    }
  }

  /**
   * Close database connections
   */
  async close(): Promise<void> {
    await this.pgPool.end();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dbIndex = args.indexOf('--db');
  const specificDb = dbIndex >= 0 ? args[dbIndex + 1] : undefined;

  const migrator = new DatabaseMigrator(dryRun);

  try {
    await migrator.migrate(specificDb);
  } catch (error) {
    logger.error('Migration failed', error as Error);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

if (require.main === module) {
  main();
}

export { DatabaseMigrator };

