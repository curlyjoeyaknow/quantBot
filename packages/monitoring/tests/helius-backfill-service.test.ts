import { describe, it, expect, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { HeliusBackfillService } from '../../src/services/backfill/helius-backfill-service';

describe('HeliusBackfillService helpers', () => {
  let service: HeliusBackfillService;

  beforeEach(() => {
    service = new HeliusBackfillService();
  });

  it('transformTransaction returns tick when price and timestamp are present', () => {
    const transform = (service as any).transformTransaction.bind(service) as (tx: any) => any;
    const tick = transform({
      price: 1.23,
      timestamp: 1_700_000_000,
      signature: 'sig',
      slot: 123,
    });

    expect(tick).toEqual({
      timestamp: 1_700_000_000,
      price: 1.23,
      size: undefined,
      signature: 'sig',
      slot: 123,
      source: 'rpc',
    });
  });

  it('extractPrice prefers explicit price but falls back to nested structures', () => {
    const extractPrice = (service as any).extractPrice.bind(service) as (tx: any) => number | null;

    expect(extractPrice({ price: 2.5 })).toBe(2.5);
    expect(extractPrice({ events: { priceUpdate: { price: '3.1' } } })).toBe(3.1);
    expect(extractPrice({ accountData: { price: '4.2' } })).toBe(4.2);
    expect(extractPrice({})).toBeNull();
  });

  it('canSpendCredits enforces the monthly credit ceiling', () => {
    const canSpendCredits = (service as any).canSpendCredits.bind(service) as (calls: number) => boolean;
    (service as any).creditsUsedThisMonth = 4_999_800;

    expect(canSpendCredits(1)).toBe(true);

    (service as any).creditsUsedThisMonth = 4_999_950;
    expect(canSpendCredits(1)).toBe(false);
  });

  it('consumeCredits increases the running credit tally', () => {
    const consumeCredits = (service as any).consumeCredits.bind(service) as (calls: number) => void;
    (service as any).creditsUsedThisMonth = 0;

    consumeCredits(2);
    expect((service as any).creditsUsedThisMonth).toBe(200);
  });

  it('enqueue sorts jobs based on priority', () => {
    const enqueue = service.enqueue.bind(service);
    (service as any).queue = [];

    enqueue({
      mint: 'MintA',
      chain: 'solana',
      startTime: DateTime.fromSeconds(0),
      endTime: DateTime.fromSeconds(10),
      priority: 1,
    });

    enqueue({
      mint: 'MintB',
      chain: 'solana',
      startTime: DateTime.fromSeconds(0),
      endTime: DateTime.fromSeconds(10),
      priority: 5,
    });

    expect((service as any).queue[0].mint).toBe('MintB');
  });
});

