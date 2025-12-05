// Background job to pre-compute strategy results for all alerts
import { dbManager } from '@/lib/db-manager';
import { queryCandles } from '@/lib/clickhouse';
import { simulateTenkanKijunRemainingPeriodOnly } from '@/lib/strategy';
import { strategyResultsDb, StrategyResult } from './strategy-results-db';
import { promisify } from 'util';
import { CONSTANTS } from '@/lib/constants';

export interface JobProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  currentAlertId?: number;
}

export class StrategyComputeJob {
  private isRunning = false;
  private progress: JobProgress = {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
  };

  async run(batchSize: number = 50, maxAlerts: number = 1000): Promise<JobProgress> {
    if (this.isRunning) {
      throw new Error('Job is already running');
    }

    this.isRunning = true;
    this.progress = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
    };

    try {
      const db = await dbManager.getDatabase();
      const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;

      // Get uncomputed alerts
      const uncomputedIds = await strategyResultsDb.getUncomputedAlerts(maxAlerts);
      this.progress.total = uncomputedIds.length;

      if (uncomputedIds.length === 0) {
        this.isRunning = false;
        return this.progress;
      }

      // Process in batches
      for (let i = 0; i < uncomputedIds.length; i += batchSize) {
        const batch = uncomputedIds.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (alertId) => {
            try {
              this.progress.currentAlertId = alertId;
              
              // Get alert details
              const alert = await all(
                'SELECT * FROM caller_alerts WHERE id = ?',
                [alertId]
              ) as any[];

              if (alert.length === 0) {
                this.progress.failed++;
                this.progress.processed++;
                return;
              }

              const alertData = alert[0];
              
              // Skip if no price
              if (!alertData.price_at_alert) {
                this.progress.failed++;
                this.progress.processed++;
                return;
              }

              // Get candles
              const alertTime = new Date(alertData.alert_timestamp);
              const endTime = new Date(alertTime.getTime() + CONSTANTS.DAYS_7_MS);
              
              const candles = await queryCandles(
                alertData.token_address,
                alertData.chain || 'solana',
                alertTime,
                endTime,
                '5m'
              );

              if (candles.length < 52) {
                this.progress.failed++;
                this.progress.processed++;
                return;
              }

              // Run strategy simulation
              const formattedCandles = candles.map((c: any) => ({
                timestamp: c.timestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
              }));

              const result = simulateTenkanKijunRemainingPeriodOnly(formattedCandles, alertTime);

              if (!result) {
                this.progress.failed++;
                this.progress.processed++;
                return;
              }

              // Save result
              const strategyResult: StrategyResult = {
                alert_id: alertId,
                token_address: alertData.token_address,
                chain: alertData.chain || 'solana',
                caller_name: alertData.caller_name,
                alert_timestamp: alertData.alert_timestamp,
                entry_price: result.entryPrice,
                exit_price: result.entryPrice * result.pnl,
                pnl: result.pnl,
                max_reached: result.maxReached,
                hold_duration_minutes: result.holdDuration,
                entry_time: result.entryTime,
                exit_time: result.exitTime,
                computed_at: new Date().toISOString(),
              };

              await strategyResultsDb.saveResult(strategyResult);
              this.progress.successful++;
              this.progress.processed++;
            } catch (error) {
              console.error(`Error processing alert ${alertId}:`, error);
              this.progress.failed++;
              this.progress.processed++;
            }
          })
        );
      }

      this.progress.currentAlertId = undefined;
      return this.progress;
    } finally {
      this.isRunning = false;
    }
  }

  getProgress(): JobProgress {
    return { ...this.progress };
  }

  isJobRunning(): boolean {
    return this.isRunning;
  }
}

