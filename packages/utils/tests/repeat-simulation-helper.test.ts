import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepeatSimulationHelper } from '../../src/utils/RepeatSimulationHelper';
import { SessionService } from '../../src/services/SessionService';
import { DateTime } from 'luxon';
import type { Context } from 'telegraf';

// Mock SessionService
const mockSessionService = {
  setSession: vi.fn(),
  getSession: vi.fn(),
  clearSession: vi.fn(),
} as unknown as SessionService;

// Mock Telegraf Context
const createMockContext = (overrides?: Partial<Context>): Context => {
  return {
    from: { id: 12345, username: 'testuser' },
    chat: { id: 67890, type: 'private' },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Context;
};

describe('RepeatSimulationHelper', () => {
  let helper: RepeatSimulationHelper;
  let mockCtx: Context;

  beforeEach(() => {
    vi.clearAllMocks();
    helper = new RepeatSimulationHelper(mockSessionService);
    mockCtx = createMockContext();
  });

  describe('repeatSimulation', () => {
    it('should create session from previous run', async () => {
      const run = {
        mint: 'test-mint-address',
        chain: 'solana',
        startTime: DateTime.fromISO('2024-01-01T00:00:00Z'),
        endTime: DateTime.fromISO('2024-01-01T01:00:00Z'),
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
      };

      await helper.repeatSimulation(mockCtx, run);

      expect(mockSessionService.setSession).toHaveBeenCalledWith(12345, {
        step: 'waiting_for_strategy',
        type: 'repeat',
        data: {
          mint: 'test-mint-address',
          chain: 'solana',
          datetime: run.startTime,
          metadata: {
            name: 'Test Token',
            symbol: 'TEST',
          },
          strategy: undefined,
          stopLossConfig: undefined,
          lastSimulation: {
            mint: 'test-mint-address',
            chain: 'solana',
            datetime: run.startTime,
            metadata: {
              name: 'Test Token',
              symbol: 'TEST',
            },
            candles: [],
          },
        },
      });
    });

    it('should handle missing userId', async () => {
      const ctxWithoutUser = createMockContext({ from: undefined });
      const run = {
        mint: 'test-mint',
        chain: 'solana',
        startTime: DateTime.now(),
        endTime: DateTime.now(),
        tokenName: 'Test',
        tokenSymbol: 'TEST',
      };

      await helper.repeatSimulation(ctxWithoutUser, run);

      expect(mockCtx.reply).toHaveBeenCalledWith('❌ Unable to identify user.');
      expect(mockSessionService.setSession).not.toHaveBeenCalled();
    });

    it('should handle alternative token name/symbol fields', async () => {
      const run = {
        mint: 'test-mint',
        chain: 'solana',
        startTime: DateTime.now(),
        endTime: DateTime.now(),
        token_name: 'Alt Token Name',
        token_symbol: 'ALT',
      };

      await helper.repeatSimulation(mockCtx, run);

      expect(mockSessionService.setSession).toHaveBeenCalledWith(
        12345,
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: {
              name: 'Alt Token Name',
              symbol: 'ALT',
            },
          }),
        })
      );
    });

    it('should use correct chain emoji for solana', async () => {
      const run = {
        mint: 'test-mint',
        chain: 'solana',
        startTime: DateTime.now(),
        endTime: DateTime.now(),
        tokenName: 'Test',
        tokenSymbol: 'TEST',
      };

      await helper.repeatSimulation(mockCtx, run);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('◎ Chain: SOLANA'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should use correct chain emoji for ethereum', async () => {
      const run = {
        mint: 'test-mint',
        chain: 'ethereum',
        startTime: DateTime.now(),
        endTime: DateTime.now(),
        tokenName: 'Test',
        tokenSymbol: 'TEST',
      };

      await helper.repeatSimulation(mockCtx, run);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('⟠ Chain: ETHEREUM'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should use correct chain emoji for bsc', async () => {
      const run = {
        mint: 'test-mint',
        chain: 'bsc',
        startTime: DateTime.now(),
        endTime: DateTime.now(),
        tokenName: 'Test',
        tokenSymbol: 'TEST',
      };

      await helper.repeatSimulation(mockCtx, run);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('🟡 Chain: BSC'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should use correct chain emoji for base', async () => {
      const run = {
        mint: 'test-mint',
        chain: 'base',
        startTime: DateTime.now(),
        endTime: DateTime.now(),
        tokenName: 'Test',
        tokenSymbol: 'TEST',
      };

      await helper.repeatSimulation(mockCtx, run);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('🔵 Chain: BASE'),
        { parse_mode: 'Markdown' }
      );
    });

    it('should format reply message correctly', async () => {
      const run = {
        mint: 'test-mint',
        chain: 'solana',
        startTime: DateTime.fromISO('2024-01-01T10:00:00Z'),
        endTime: DateTime.fromISO('2024-01-01T11:00:00Z'),
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
      };

      await helper.repeatSimulation(mockCtx, run);

      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('🔄 **Repeating Simulation**'),
        { parse_mode: 'Markdown' }
      );
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('🪙 Token: Test Token (TEST)'),
        { parse_mode: 'Markdown' }
      );
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('📅 Period: 2024-01-01 10:00 - 2024-01-01 11:00'),
        { parse_mode: 'Markdown' }
      );
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('**Take Profit Strategy:**'),
        { parse_mode: 'Markdown' }
      );
    });
  });
});

