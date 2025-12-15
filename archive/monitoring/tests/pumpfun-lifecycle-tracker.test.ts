import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PumpfunLifecycleTracker } from '../src/pumpfun/pumpfun-lifecycle-tracker';
import { derivePumpfunBondingCurve, PUMP_FUN_PROGRAM_ID } from '@quantbot/utils/pumpfun';
import * as databaseModule from '@quantbot/utils/database';
import { heliusBackfillService } from '../src/backfill/helius-backfill-service';
import { heliusStreamRecorder } from '../src/stream/helius-recorder';

describe('PumpfunLifecycleTracker helpers', () => {
  const tracker = new PumpfunLifecycleTracker();
  const extractPrimaryMint = (tracker as any).extractPrimaryMint.bind(tracker) as (
    tx: any
  ) => string | null;
  const extractMetadata = (tracker as any).extractMetadata.bind(tracker) as (
    tx: any
  ) => Record<string, unknown> | null;

  it('extractPrimaryMint returns mint from token transfers when present', () => {
    const expectedMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const tx = {
      tokenTransfers: [
        {
          mint: expectedMint,
        },
      ],
    };

    const mint = extractPrimaryMint(tx);
    expect(mint).toBe(expectedMint);
  });

  it('extractPrimaryMint falls back to meta postTokenBalances', () => {
    const tx = {
      meta: {
        postTokenBalances: [
          {
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            owner: 'Creator1111111111111111111111111111111111111',
          },
        ],
      },
    };

    const mint = extractPrimaryMint(tx);
    expect(mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('extractPrimaryMint inspects instruction account lists as a final fallback', () => {
    const tx = {
      instructions: [
        {
          accounts: ['not-a-mint', '4Nd1mSRqqw9RnBbTK1Z4VHKs3P6KyMfFDs46HoPazGf3'],
        },
      ],
    };

    const mint = extractPrimaryMint(tx);
    expect(mint).toBe('4Nd1mSRqqw9RnBbTK1Z4VHKs3P6KyMfFDs46HoPazGf3');
  });

  it('extractMetadata collects name/symbol from transfer and infers creator from balances', () => {
    const tx = {
      tokenTransfers: [
        {
          tokenName: 'Example Token',
          tokenSymbol: 'EXMPL',
        },
      ],
      meta: {
        postTokenBalances: [
          {
            mint: 'Mint111111111111111111111111111111111111111',
            owner: 'Creator1111111111111111111111111111111111111',
          },
        ],
      },
    };

    const metadata = extractMetadata(tx);
    expect(metadata).toEqual({
      name: 'Example Token',
      symbol: 'EXMPL',
      creator: 'Creator1111111111111111111111111111111111111',
    });
  });

  it('extractMetadata falls back to fee payer when creator is missing elsewhere', () => {
    const tx = {
      feePayer: 'FeePayer111111111111111111111111111111111111',
    };

    const metadata = extractMetadata(tx);
    expect(metadata).toEqual({
      creator: 'FeePayer111111111111111111111111111111111111',
    });
  });
});

describe('PumpfunLifecycleTracker lifecycle flows', () => {
  let tracker: PumpfunLifecycleTracker;

  beforeEach(() => {
    tracker = new PumpfunLifecycleTracker();
    vi.restoreAllMocks();
    vi.spyOn(databaseModule, 'upsertPumpfunToken').mockResolvedValue(undefined);
    vi.spyOn(databaseModule, 'markPumpfunGraduated').mockResolvedValue(undefined);
    vi.spyOn(heliusStreamRecorder, 'trackToken').mockImplementation(() => {});
    vi.spyOn(heliusBackfillService, 'enqueue').mockImplementation(() => {});
  });

  it('processLaunch persisting metadata and schedules recorder/backfill', async () => {
    const tx = {
      tokenTransfers: [
        {
          mint: 'MintLaunch111',
          tokenName: 'Launch Token',
          tokenSymbol: 'LAUNCH',
        },
      ],
      feePayer: 'Creator1111111111111111111111111111111111111',
    };

    await (tracker as any).processLaunch('sig-launch', 1_700_000_000, tx);

    expect(databaseModule.upsertPumpfunToken).toHaveBeenCalledWith(
      expect.objectContaining({
        mint: 'MintLaunch111',
        launchSignature: 'sig-launch',
        metadata: expect.objectContaining({ name: 'Launch Token', symbol: 'LAUNCH' }),
      })
    );
    expect(heliusStreamRecorder.trackToken).toHaveBeenCalledWith(
      expect.objectContaining({ mint: 'MintLaunch111', source: 'pumpfun_launch' })
    );
    expect(heliusBackfillService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ mint: 'MintLaunch111', priority: 3 })
    );
  });

  it('processGraduation marks token as graduated and tracks it', async () => {
    const tx = {
      tokenTransfers: [
        {
          mint: 'MintGrad111',
        },
      ],
    };

    await (tracker as any).processGraduation('sig-grad', 1_700_000_100, tx);

    expect(databaseModule.markPumpfunGraduated).toHaveBeenCalledWith(
      'MintGrad111',
      expect.objectContaining({ graduationSignature: 'sig-grad' })
    );
    expect(heliusStreamRecorder.trackToken).toHaveBeenCalledWith(
      expect.objectContaining({ mint: 'MintGrad111', source: 'pumpfun_graduated' })
    );
  });

  it('handleLogsNotification delegates to launch handler when log matches create instruction', async () => {
    const launchSpy = vi.spyOn(tracker as any, 'processLaunch').mockResolvedValue(undefined);

    (tracker as any).handleLogsNotification({
      signature: 'sig-handle',
      logs: ['Program log: Instruction: Create'],
      timestamp: 1,
    });

    expect(launchSpy).toHaveBeenCalledWith('sig-handle', 1);
  });

  it('handleGrpcMessage delegates to graduation handler with parsed transaction payload', async () => {
    const gradSpy = vi.spyOn(tracker as any, 'processGraduation').mockResolvedValue(undefined);

    (tracker as any).handleGrpcMessage({
      transaction: {
        signature: 'sig-grpc',
        blockTime: 2,
        meta: { logMessages: ['Instruction: Migrate'] },
      },
    });

    expect(gradSpy).toHaveBeenCalledWith(
      'sig-grpc',
      2,
      expect.objectContaining({ meta: expect.any(Object) })
    );
  });

  it('buildGrpcSubscription targets Pump.fun program accounts', () => {
    const subscription = (tracker as any).buildGrpcSubscription();
    expect(subscription.transactions.pumpfun.accountInclude[0]).toBe(
      PUMP_FUN_PROGRAM_ID.toBase58()
    );
    expect(subscription.commitment).not.toBeUndefined();
  });
});

describe('derivePumpfunBondingCurve', () => {
  it('derives bonding curve address for valid mint', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    const result = derivePumpfunBondingCurve(mint);
    expect(result).toBeTruthy();
  });

  it('returns null for invalid mint values', () => {
    expect(derivePumpfunBondingCurve('invalid-address')).toBeNull();
    expect(derivePumpfunBondingCurve('')).toBeNull();
  });

  it('derives consistent addresses for the same mint and different ones for different mints', () => {
    const mint1 = 'So11111111111111111111111111111111111111112';
    const mint2 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(derivePumpfunBondingCurve(mint1)).toBe(derivePumpfunBondingCurve(mint1));
    expect(derivePumpfunBondingCurve(mint1)).not.toBe(derivePumpfunBondingCurve(mint2));
  });
});
