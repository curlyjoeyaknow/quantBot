import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { insertTicks, type TickEvent } from '@quantbot/utils' /* TODO: Fix storage import */;
import { ohlcvAggregator } from '../aggregation/ohlcv-aggregator';
import { heliusRestClient } from '@quantbot/services';

const CREDIT_PER_CALL = 100;
const MONTHLY_CREDIT_LIMIT =
  Number(process.env.HELIUS_CREDIT_LIMIT ?? '5000000') || 5_000_000;
const CREDIT_WARNING_THRESHOLD = Number(process.env.HELIUS_CREDIT_MARGIN ?? '0.8');

export interface BackfillJob {
  mint: string;
  chain: string;
  startTime: DateTime;
  endTime: DateTime;
  priority: number;
}

export class HeliusBackfillService {
  private readonly queue: BackfillJob[] = [];
  private running = false;
  private creditsUsedThisMonth = 0;

  enqueue(job: BackfillJob): void {
    this.queue.push(job);
    this.queue.sort((a, b) => b.priority - a.priority);
    if (!this.running) {
      this.start();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const job = this.queue.shift();
      if (!job) {
        await this.delay(2_000);
        continue;
      }

      if (!this.canSpendCredits(1)) {
        logger.warn('Backfill paused due to credit limit');
        await this.delay(60_000);
        this.queue.unshift(job);
        continue;
      }

      try {
        await this.processJob(job);
      } catch (error) {
        logger.error('Backfill job failed', error as Error, {
          mint: job.mint.substring(0, 20),
        });
      }
    }
  }

  private async processJob(job: BackfillJob): Promise<void> {
    let cursor: string | undefined;
    let continueFetching = true;

    while (continueFetching) {
      if (!this.canSpendCredits(1)) {
        logger.warn('Backfill throttled due to credit usage');
        this.queue.unshift(job);
        return;
      }

      const transactions = await heliusRestClient.getTransactionsForAddress(job.mint, {
        before: cursor,
        limit: 100,
      });
      this.consumeCredits(1);

      if (!transactions.length) {
        break;
      }

      const ticks: TickEvent[] = transactions
        .map((tx: any) => this.transformTransaction(tx))
        .filter((tick): tick is TickEvent => !!tick);

      if (ticks.length) {
        await insertTicks(job.mint, job.chain, ticks);
        ticks.forEach((tick) => {
          ohlcvAggregator.ingestTick(job.mint, job.chain, {
            timestamp: tick.timestamp,
            price: tick.price,
            volume: tick.size ?? 0,
          });
        });
        await ohlcvAggregator.flushCompletedBuckets(Date.now());
      }

      cursor = transactions[transactions.length - 1]?.signature;
      const oldestTimestamp = transactions[transactions.length - 1]?.timestamp;
      if (!oldestTimestamp || oldestTimestamp <= job.startTime.toSeconds()) {
        continueFetching = false;
      }
    }
  }

  private transformTransaction(tx: any): TickEvent | null {
    const price = this.extractPrice(tx);
    const timestamp = tx.timestamp ? Number(tx.timestamp) : null;
    if (!price || !timestamp) {
      return null;
    }

    const size = this.extractVolume(tx);
    return {
      timestamp,
      price,
      size,
      signature: tx.signature,
      slot: tx.slot,
      source: 'rpc',
    };
  }

  private extractPrice(tx: any): number | null {
    if (typeof tx.price === 'number') {
      return tx.price;
    }
    if (tx.events?.priceUpdate?.price) {
      return Number(tx.events.priceUpdate.price);
    }
    if (tx.accountData?.price) {
      return Number(tx.accountData.price);
    }
    return null;
  }

  private extractVolume(tx: any): number | undefined {
    if (typeof tx.volume === 'number') {
      return tx.volume;
    }
    if (tx.accountData?.volume) {
      return Number(tx.accountData.volume);
    }
    return undefined;
  }

  private canSpendCredits(calls: number): boolean {
    const projected = this.creditsUsedThisMonth + calls * CREDIT_PER_CALL;
    if (projected > MONTHLY_CREDIT_LIMIT) {
      return false;
    }
    const margin = MONTHLY_CREDIT_LIMIT * CREDIT_WARNING_THRESHOLD;
    if (projected > margin) {
      logger.warn('Helius credit usage above warning threshold', {
        used: projected,
        limit: MONTHLY_CREDIT_LIMIT,
      });
    }
    return true;
  }

  private consumeCredits(calls: number): void {
    this.creditsUsedThisMonth += calls * CREDIT_PER_CALL;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const heliusBackfillService = new HeliusBackfillService();


