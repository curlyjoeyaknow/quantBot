/**
 * Repeat Simulation Helper Tests
 * ==============================
 * Tests for RepeatSimulationHelper utility
 */

import { Context } from 'telegraf';
import { RepeatSimulationHelper } from '../src/utils/RepeatSimulationHelper';
import { SessionService } from '../src/services/SessionService';

// Mock SessionService
vi.mock('../src/services/SessionService');

describe('RepeatSimulationHelper', () => {
  let helper: RepeatSimulationHelper;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockContext: Partial<Context>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSessionService = {
      setSession: vi.fn(),
      getSession: vi.fn(),
      clearSession: vi.fn(),
    } as any;

    helper = new RepeatSimulationHelper(mockSessionService);

    mockContext = {
      from: { id: 12345, is_bot: false },
      reply: vi.fn().mockResolvedValue({}),
    };
  });

  describe('repeatSimulation', () => {
    const mockRun = {
      mint: 'test-mint-123',
      chain: 'solana',
      token_name: 'Test Token',
      token_symbol: 'TEST',
      startTime: new Date('2024-01-01'),
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 },
    };

    it('should create session from previous run', async () => {
      await helper.repeatSimulation(mockContext as Context, mockRun);

      expect(mockSessionService.setSession).toHaveBeenCalledWith(
        12345,
        expect.objectContaining({
          step: 'waiting_for_strategy',
          type: 'repeat',
          data: expect.objectContaining({
            mint: 'test-mint-123',
            chain: 'solana',
          }),
        })
      );
    });

    it('should handle missing user ID', async () => {
      const contextWithoutUser = {
        ...mockContext,
        from: undefined,
      };

      await helper.repeatSimulation(contextWithoutUser as Context, mockRun);

      expect(mockContext.reply).toHaveBeenCalledWith('❌ Unable to identify user.');
      expect(mockSessionService.setSession).not.toHaveBeenCalled();
    });

    it('should map token name and symbol correctly', async () => {
      await helper.repeatSimulation(mockContext as Context, mockRun);

      const sessionCall = mockSessionService.setSession.mock.calls[0];
      const session = sessionCall[1];

      expect(session.data?.metadata?.name).toBe('Test Token');
      expect(session.data?.metadata?.symbol).toBe('TEST');
    });

    it('should handle tokenName/tokenSymbol fallback', async () => {
      const runWithTokenName = {
        ...mockRun,
        tokenName: 'Fallback Name',
        tokenSymbol: 'FALLBACK',
        token_name: undefined,
        token_symbol: undefined,
      };

      await helper.repeatSimulation(mockContext as Context, runWithTokenName);

      const sessionCall = mockSessionService.setSession.mock.calls[0];
      const session = sessionCall[1];

      expect(session.data?.metadata?.name).toBe('Fallback Name');
      expect(session.data?.metadata?.symbol).toBe('FALLBACK');
    });

    it('should set lastSimulation in session data', async () => {
      await helper.repeatSimulation(mockContext as Context, mockRun);

      const sessionCall = mockSessionService.setSession.mock.calls[0];
      const session = sessionCall[1];

      expect(session.data?.lastSimulation).toBeDefined();
      expect(session.data?.lastSimulation?.mint).toBe('test-mint-123');
      expect(session.data?.lastSimulation?.chain).toBe('solana');
    });

    it('should set datetime from startTime', async () => {
      await helper.repeatSimulation(mockContext as Context, mockRun);

      const sessionCall = mockSessionService.setSession.mock.calls[0];
      const session = sessionCall[1];

      expect(session.data?.datetime).toBe(mockRun.startTime);
    });
  });
});
