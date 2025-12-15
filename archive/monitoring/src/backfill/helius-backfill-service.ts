import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { insertTicks, type TickEvent } from '@quantbot/storage';
import { ohlcvAggregator } from '../aggregation/ohlcv-aggregator';
import { heliusRestClient } from '@quantbot/api-clients';

const CREDIT_PER_CALL = 100;
const MONTHLY_CREDIT_LIMIT = Number(process.env.HELIUS_CREDIT_LIMIT ?? '5000000') || 5_000_000;
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
      } catch (error: unknown) {
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
        .map((tx: unknown) => this.transformTransaction(tx))
        .filter((tick): tick is TickEvent => !!tick);

      if (ticks.length) {
        await insertTicks(job.mint, job.chain, ticks);
        ticks.forEach((tick: TickEvent) => {
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

  private transformTransaction(tx: unknown): TickEvent | null {
    if (!tx || typeof tx !== 'object') {
      return null;
    }
    const txObj = tx as Record<string, unknown>;
    const price = this.extractPrice(txObj);
    const timestamp = txObj.timestamp ? Number(txObj.timestamp) : null;
    if (!price || !timestamp) {
      return null;
    }

    const size = this.extractVolume(txObj);
    return {
      timestamp,
      price,
      size,
      signature: typeof txObj.signature === 'string' ? txObj.signature : undefined,
      slot: typeof txObj.slot === 'number' ? txObj.slot : undefined,
      source: 'rpc',
    };
  }

  private extractPrice(tx: Record<string, unknown>): number | null {
    if (typeof tx.price === 'number') {
      return tx.price;
    }
    const events = tx.events as Record<string, unknown> | undefined;
    if (events?.priceUpdate && typeof events.priceUpdate === 'object') {
      const priceUpdate = events.priceUpdate as Record<string, unknown>;
      if (priceUpdate.price) {
        return Number(priceUpdate.price);
      }
    }
    const accountData = tx.accountData as Record<string, unknown> | undefined;
    if (accountData?.price) {
      return Number(accountData.price);
    }
    return null;
  }

  private extractVolume(tx: Record<string, unknown>): number | undefined {
    if (typeof tx.volume === 'number') {
      return tx.volume;
    }
    const accountData = tx.accountData as Record<string, unknown> | undefined;
    if (accountData?.volume) {
      return Number(accountData.volume);
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
