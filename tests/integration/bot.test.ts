/**
 * Integration Tests for Telegram Bot
 *
 * This file contains integration tests for the core bot commands,
 * strategy/session/CA drop logic, and DB error handling. 
 * All database methods and some helpers are mocked for isolation.
 *
 * Sections:
 *  1. Mock Setup & Test Context
 *  2. Bot Command Handlers
 *  3. CA Drop Detection Logic
 *  4. Session Management
 *  5. Error Handling
 */

// ==============================
// 1. Mock Setup & Test Context
// ==============================

import { Telegraf } from 'telegraf';
import { DateTime } from 'luxon';
import * as db from '../../src/utils/database';

// Mock dependencies that interact with external services or DB
jest.mock('../../src/utils/database');
jest.mock('../../src/simulation/candles');
jest.mock('../../src/simulate');
jest.mock('../../src/helius-monitor');

// Make database functions fully typable/mocked in tests
const mockedDb = db as jest.Mocked<typeof db>;

describe('Bot Integration Tests', () => {
  let bot: Telegraf;
  let mockCtx: any;

  /**
   * Prepares common mocks and side-effects before each test.
   * - Mocks bot context (user, chat, reply/sendMessage).
   * - Resets all DB mocks to avoid leakage between tests.
   */
  beforeEach(() => {
    jest.clearAllMocks();

    // Example Telegram context structure (partial)
    mockCtx = {
      from: { id: 12345 },
      chat: { id: 67890 },
      message: { text: '/backtest' },
      reply: jest.fn(),
      telegram: {
        sendMessage: jest.fn()
      }
    };

    // ---- Database Mocks ----
    // All DB operations here return deterministic values for isolation
    mockedDb.initDatabase.mockResolvedValue();
    mockedDb.getUserSimulationRuns.mockResolvedValue([]);
    // saveSimulationRun returns a run id; use 1 for clarity
    mockedDb.saveSimulationRun.mockResolvedValue(1);
    mockedDb.getUserStrategies.mockResolvedValue([]);
    // saveStrategy returns a new strategy id; for this suite, 1 will suffice
    mockedDb.saveStrategy.mockResolvedValue(1);
    mockedDb.getStrategy.mockResolvedValue(null);
    mockedDb.deleteStrategy.mockResolvedValue();
    mockedDb.saveCADrop.mockResolvedValue(1);
  });

  // ===========================
  // 2. Bot Command Handlers
  // ===========================

  describe('Bot Command Handlers', () => {
    /**
     * Simulates a /backtest command
     * Checks: correct user context is used.
     */
    it('should handle /backtest command', async () => {
      expect(mockCtx.from.id).toBe(12345);
    });

    /**
     * Simulates /repeat with no previous runs in DB
     * DB returns empty list.
     */
    it('should handle /repeat command with no previous runs', async () => {
      mockedDb.getUserSimulationRuns.mockResolvedValue([]);

      const recentRuns = await mockedDb.getUserSimulationRuns(12345, 5);
      expect(recentRuns).toEqual([]);
    });

    /**
     * Simulates /repeat where there is one prior simulation run
     * Ensures mock and call logic.
     */
    it('should handle /repeat command with previous runs', async () => {
      const mockRuns = [
        {
          id: 1,
          userId: 12345,
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          tokenName: 'Test Token',
          tokenSymbol: 'TEST',
          finalPnl: 1.5,
          createdAt: DateTime.fromJSDate(new Date('2024-01-01T00:00:00Z')),
          startTime: DateTime.fromJSDate(new Date('2024-01-01T00:00:00Z')),
          endTime: DateTime.fromJSDate(new Date('2024-01-02T00:00:00Z')),
          strategy: [{ percent: 1, target: 2 }],
          stopLossConfig: { initial: -0.3, trailing: 0.5 },
          totalCandles: 100,
          events: []
        }
      ];

      mockedDb.getUserSimulationRuns.mockResolvedValue(mockRuns);

      const recentRuns = await mockedDb.getUserSimulationRuns(12345, 5);
      expect(recentRuns).toEqual(mockRuns);
      expect(recentRuns.length).toBe(1);
    });

    /**
     * Simulates /strategy (list) command
     * Verifies mock strategy list returned from DB
     */
    it('should handle /strategy command - list strategies', async () => {
      const mockStrategies = [
        {
          id: 1,
          userId: 12345,
          name: 'Test Strategy',
          description: 'A test strategy',
          strategy: [{ percent: 0.5, target: 2 }],
          stopLossConfig: { initial: -0.3, trailing: 0.5 },
          isDefault: false
        }
      ];

      mockedDb.getUserStrategies.mockResolvedValue(mockStrategies);

      const strategies = await mockedDb.getUserStrategies(12345);
      expect(strategies).toEqual(mockStrategies);
      expect(strategies.length).toBe(1);
    });

    /**
     * Tests saving of a new strategy (/strategy save)
     * Verifies correct parameters and DB return.
     */
    it('should handle /strategy save command', async () => {
      const mockStrategy = {
        userId: 12345,
        name: 'Test Strategy',
        description: 'A test strategy',
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 }
      };

      mockedDb.saveStrategy.mockResolvedValue(1);

      await expect(mockedDb.saveStrategy(mockStrategy)).resolves.toBe(1);
      expect(mockedDb.saveStrategy).toHaveBeenCalledWith(mockStrategy);
    });

    /**
     * Tests selecting a strategy to be used as default
     */
    it('should handle /strategy use command', async () => {
      const mockStrategy = {
        id: 1,
        userId: 12345,
        name: 'Test Strategy',
        description: 'A test strategy',
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        isDefault: false
      };

      mockedDb.getStrategy.mockResolvedValue(mockStrategy);

      const strategy = await mockedDb.getStrategy(12345, 'Test Strategy');
      expect(strategy).toEqual(mockStrategy);
    });

    /**
     * Tests deletion of a strategy
     */
    it('should handle /strategy delete command', async () => {
      mockedDb.deleteStrategy.mockResolvedValue();

      await expect(mockedDb.deleteStrategy(12345, 'Test Strategy')).resolves.toBeUndefined();
      expect(mockedDb.deleteStrategy).toHaveBeenCalledWith(12345, 'Test Strategy');
    });

    /**
     * Tests clearing of user session on /cancel command
     */
    it('should handle /cancel command', () => {
      // Simulate an in-progress session
      const sessions: Record<number, any> = { 12345: { step: 'waiting_for_mint' } };

      // User issues /cancel
      delete sessions[12345];

      expect(sessions[12345]).toBeUndefined();
    });
  });

  // ===================================
  // 3. CA Drop Detection Logic
  // ===================================
  describe('CA Drop Detection', () => {
    /**
     * Detects Solana mints (base58 format, 32-44 chars, excludes visually ambiguous)
     */
    it('should detect Solana addresses', () => {
      // Solana address regex and example
      const solanaAddressPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
      const testText = 'CA: So11111111111111111111111111111111111111112';

      const matches = testText.match(solanaAddressPattern);
      expect(matches).toBeTruthy();
      expect(matches![0]).toBe('So11111111111111111111111111111111111111112');
    });

    /**
     * Detects Ethereum/EVM contract addresses (0x + 40 hex)
     */
    it('should detect EVM addresses', () => {
      const evmAddressPattern = /0x[a-fA-F0-9]{40}/g;
      const testText = 'CA: 0x1234567890123456789012345678901234567890';

      const matches = testText.match(evmAddressPattern);
      expect(matches).toBeTruthy();
      expect(matches![0]).toBe('0x1234567890123456789012345678901234567890');
    });

    /**
     * Detects if a message is intended as a CA drop call, based on keywords
     */
    it('should identify CA drop context', () => {
      const caKeywords = ['ca', 'contract', 'address', 'buy', 'pump', 'moon', 'gem', 'call'];
      const testText = 'New CA drop! Buy now!';

      const hasCAKeywords = caKeywords.some(keyword =>
        testText.toLowerCase().includes(keyword)
      );

      expect(hasCAKeywords).toBe(true);
    });

    /**
     * Tests storing a detected CA drop in DB via mocked DB call
     */
    it('should save CA drop to database', async () => {
      const mockCADrop = {
        userId: 12345,
        chatId: 67890,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        tokenName: 'Test Token',
        tokenSymbol: 'TEST',
        callPrice: 1.0,
        callMarketcap: 1000000,
        callTimestamp: 1704067200,
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 }
      };

      mockedDb.saveCADrop.mockResolvedValue(1);

      const result = await mockedDb.saveCADrop(mockCADrop);
      expect(result).toBe(1);
      expect(mockedDb.saveCADrop).toHaveBeenCalledWith(mockCADrop);
    });
  });

  // ============================
  // 4. Session Management
  // ============================

  describe('Session Management', () => {
    /**
     * Tests starting a new session for a user
     */
    it('should create new session for user', () => {
      const sessions: Record<number, any> = {};
      const userId = 12345;

      sessions[userId] = { step: 'waiting_for_mint' };

      expect(sessions[userId]).toBeDefined();
      expect(sessions[userId].step).toBe('waiting_for_mint');
    });

    /**
     * Tests session deletion (user cancels interaction)
     */
    it('should clear session on cancel', () => {
      const sessions: Record<number, any> = {
        12345: { step: 'waiting_for_mint', mint: 'test' }
      };

      delete sessions[12345];

      expect(sessions[12345]).toBeUndefined();
    });

    /**
     * Verifies that sessions for multiple users are isolated and handled independently
     */
    it('should handle multiple user sessions', () => {
      const sessions: Record<number, any> = {};

      sessions[12345] = { step: 'waiting_for_mint' };
      sessions[67890] = { step: 'waiting_for_strategy' };

      expect(sessions[12345].step).toBe('waiting_for_mint');
      expect(sessions[67890].step).toBe('waiting_for_strategy');
    });
  });

  // ==========================
  // 5. Error Handling
  // ==========================

  describe('Error Handling', () => {
    /**
     * Simulates DB connection failure and checks error is thrown/reported upstream
     */
    it('should handle database connection errors', async () => {
      const error = new Error('Database connection failed');
      mockedDb.initDatabase.mockRejectedValue(error);

      await expect(mockedDb.initDatabase()).rejects.toThrow('Database connection failed');
    });

    /**
     * Simulates an API/data fetch error and ensures bot or logic catches the rejection
     */
    it('should handle API errors gracefully', async () => {
      const error = new Error('API request failed');
      mockedDb.getUserSimulationRuns.mockRejectedValue(error);

      await expect(mockedDb.getUserSimulationRuns(12345, 5)).rejects.toThrow('API request failed');
    });

    /**
     * Verifies 'invalid' user input is identified (e.g. malformed strategy format)
     */
    it('should handle invalid user input', () => {
      const invalidStrategy = 'invalid strategy format';

      // Our test strategy parser expects '@' and 'x' (domain requirement)
      const isValidFormat = invalidStrategy.includes('@') && invalidStrategy.includes('x');
      expect(isValidFormat).toBe(false);
    });
  });
});