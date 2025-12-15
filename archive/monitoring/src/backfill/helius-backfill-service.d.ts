import { DateTime } from 'luxon';
export interface BackfillJob {
  mint: string;
  chain: string;
  startTime: DateTime;
  endTime: DateTime;
  priority: number;
}
export declare class HeliusBackfillService {
  private readonly queue;
  private running;
  private creditsUsedThisMonth;
  enqueue(job: BackfillJob): void;
  start(): void;
  stop(): void;
  private loop;
  private processJob;
  private transformTransaction;
  private extractPrice;
  private extractVolume;
  private canSpendCredits;
  private consumeCredits;
  private delay;
}
export declare const heliusBackfillService: HeliusBackfillService;
//# sourceMappingURL=helius-backfill-service.d.ts.map
