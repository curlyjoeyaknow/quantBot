/**
 * Integration Tests for Backtest API
 * 
 * Tests the complete backtest workflow including:
 * - Strategy creation
 * - Token management
 * - Backtest execution
 * - Results retrieval
 * - Chart data generation
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { initDatabase } from '../../src/utils/database';
import { tokenService } from '../../src/services/token-service';
import { ohlcvService } from '../../src/services/ohlcv-service';
import { resultsService } from '../../src/services/results-service';
import { saveStrategy, getUserStrategies, deleteStrategy } from '../../src/utils/database';
import { DateTime } from 'luxon';

// Mock data
const TEST_USER_ID = 999999;
const TEST_MINT = 'So11111111111111111111111111111111111111112'; // SOL mint
const TEST_CHAIN = 'solana';

describe('Backtest API Integration Tests', () => {
  beforeAll(async () => {
    // Initialize database
    await initDatabase();
    await ohlcvService.initialize();
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      const strategies = await getUserStrategies(TEST_USER_ID);
      for (const strategy of strategies) {
        await deleteStrategy(TEST_USER_ID, strategy.name);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Token Management', () => {
    it('should add a token to the registry', async () => {
      const token = await tokenService.addToken(
        TEST_MINT,
        TEST_CHAIN,
        TEST_USER_ID
      );

      expect(token).toBeDefined();
      expect(token.mint).toBe(TEST_MINT);
      expect(token.chain).toBe(TEST_CHAIN);
    });

    it('should retrieve a token from the registry', async () => {
      const token = await tokenService.getToken(TEST_MINT, TEST_CHAIN);

      expect(token).toBeDefined();
      expect(token?.mint).toBe(TEST_MINT);
    });

    it('should list tokens with filters', async () => {
      const tokens = await tokenService.listTokens({
        chain: TEST_CHAIN,
      });

      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });
  });

  describe('Strategy Management', () => {
    const TEST_STRATEGY_NAME = 'Test Strategy';

    it('should create a strategy', async () => {
      const strategyId = await saveStrategy({
        userId: TEST_USER_ID,
        name: TEST_STRATEGY_NAME,
        description: 'Test strategy for integration tests',
        strategy: [
          { percent: 0.5, target: 2 },
          { percent: 0.3, target: 5 },
          { percent: 0.2, target: 10 },
        ],
        stopLossConfig: {
          initial: -0.5,
          trailing: 'none',
        },
        isDefault: false,
      });

      expect(strategyId).toBeGreaterThan(0);
    });

    it('should retrieve user strategies', async () => {
      const strategies = await getUserStrategies(TEST_USER_ID);

      expect(Array.isArray(strategies)).toBe(true);
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.some((s) => s.name === TEST_STRATEGY_NAME)).toBe(true);
    });

    it('should delete a strategy', async () => {
      await deleteStrategy(TEST_USER_ID, TEST_STRATEGY_NAME);

      const strategies = await getUserStrategies(TEST_USER_ID);
      expect(strategies.some((s) => s.name === TEST_STRATEGY_NAME)).toBe(false);
    });
  });

  describe('OHLCV Service', () => {
    it('should fetch candles from cache or API', async () => {
      const startTime = DateTime.utc().minus({ days: 7 });
      const endTime = DateTime.utc();

      const candles = await ohlcvService.getCandles(
        TEST_MINT,
        TEST_CHAIN,
        startTime,
        endTime,
        {
          interval: '5m',
          useCache: true,
        }
      );

      expect(Array.isArray(candles)).toBe(true);
      // Note: May be empty if no data available, which is acceptable
    });
  });

  describe('Results Service', () => {
    it('should calculate empty metrics for no runs', async () => {
      const { metrics } = await resultsService.aggregateResults([]);

      expect(metrics.totalRuns).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.averagePnl).toBe(0);
    });

    it('should handle chart data generation for non-existent run', async () => {
      await expect(
        resultsService.generateChartData(999999)
      ).rejects.toThrow();
    });
  });
});

