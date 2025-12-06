import { describe, it, expect } from 'vitest';
import { calculateTradeMetrics, type TradeMetrics } from '../../src/analysis/metrics/trade-metrics';
import type { SimulationResult } from '../../src/simulation/engine';

describe('trade-metrics', () => {
  const createMockResult = (overrides: Partial<SimulationResult>): SimulationResult => ({
    mint: 'test-mint',
    chain: 'solana',
    entryPrice: 1.0,
    exitPrice: 1.0,
    finalPnl: 1.0,
    entryTime: 1000,
    exitTime: 2000,
    events: [
      { timestamp: 1000, price: 1.0, action: 'buy' },
      { timestamp: 2000, price: 1.0, action: 'sell' },
    ],
    trades: [],
    ...overrides,
  });

  describe('calculateTradeMetrics', () => {
    it('should return zero metrics for empty results', () => {
      const metrics = calculateTradeMetrics([]);

      expect(metrics).toEqual({
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakEvenTrades: 0,
        winRate: 0,
        lossRate: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        profitFactor: 0,
        expectancy: 0,
        avgHoldDuration: 0,
        avgTimeToAth: 0,
      });
    });

    it('should calculate metrics for winning trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0, entryPrice: 1.0 }), // 100% gain
        createMockResult({ finalPnl: 1.5, entryPrice: 1.0 }), // 50% gain
        createMockResult({ finalPnl: 3.0, entryPrice: 1.0 }), // 200% gain
      ];

      const metrics = calculateTradeMetrics(results);

      expect(metrics.totalTrades).toBe(3);
      expect(metrics.winningTrades).toBe(3);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.breakEvenTrades).toBe(0);
      expect(metrics.winRate).toBe(100);
      expect(metrics.lossRate).toBe(0);
      expect(metrics.avgWin).toBeCloseTo((1.0 + 0.5 + 2.0) / 3, 2);
      expect(metrics.largestWin).toBe(2.0);
      expect(metrics.largestLoss).toBe(0);
    });

    it('should calculate metrics for losing trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5, entryPrice: 1.0 }), // 50% loss
        createMockResult({ finalPnl: 0.8, entryPrice: 1.0 }), // 20% loss
        createMockResult({ finalPnl: 0.2, entryPrice: 1.0 }), // 80% loss
      ];

      const metrics = calculateTradeMetrics(results);

      expect(metrics.totalTrades).toBe(3);
      expect(metrics.winningTrades).toBe(0);
      expect(metrics.losingTrades).toBe(3);
      expect(metrics.breakEvenTrades).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.lossRate).toBe(100);
      expect(metrics.avgLoss).toBeCloseTo((0.5 + 0.2 + 0.8) / 3, 2);
      expect(metrics.largestWin).toBe(0);
      expect(metrics.largestLoss).toBe(0.8);
    });

    it('should calculate metrics for mixed trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0, entryPrice: 1.0 }), // Win: +1.0
        createMockResult({ finalPnl: 0.5, entryPrice: 1.0 }), // Loss: -0.5
        createMockResult({ finalPnl: 1.0, entryPrice: 1.0 }), // Break even
        createMockResult({ finalPnl: 1.5, entryPrice: 1.0 }), // Win: +0.5
      ];

      const metrics = calculateTradeMetrics(results);

      expect(metrics.totalTrades).toBe(4);
      expect(metrics.winningTrades).toBe(2);
      expect(metrics.losingTrades).toBe(1);
      expect(metrics.breakEvenTrades).toBe(1);
      expect(metrics.winRate).toBe(50);
      expect(metrics.lossRate).toBe(25);
      expect(metrics.avgWin).toBeCloseTo((1.0 + 0.5) / 2, 2);
      expect(metrics.avgLoss).toBeCloseTo(0.5, 2);
    });

    it('should calculate profit factor correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0, entryPrice: 1.0 }), // Win: +1.0
        createMockResult({ finalPnl: 0.5, entryPrice: 1.0 }), // Loss: -0.5
      ];

      const metrics = calculateTradeMetrics(results);

      // Total wins: 1.0, Total losses: 0.5, Profit factor: 1.0 / 0.5 = 2.0
      expect(metrics.profitFactor).toBeCloseTo(2.0, 2);
    });

    it('should handle profit factor with no losses', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0, entryPrice: 1.0 }),
        createMockResult({ finalPnl: 1.5, entryPrice: 1.0 }),
      ];

      const metrics = calculateTradeMetrics(results);

      // When totalLoss is 0 and totalWin > 0, profit factor should be Infinity
      expect(metrics.profitFactor).toBe(Infinity);
    });

    it('should handle profit factor with no wins', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5, entryPrice: 1.0 }),
        createMockResult({ finalPnl: 0.8, entryPrice: 1.0 }),
      ];

      const metrics = calculateTradeMetrics(results);

      // When totalWin is 0 and totalLoss > 0, profit factor should be 0
      expect(metrics.profitFactor).toBe(0);
    });

    it('should calculate expectancy correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0, entryPrice: 1.0 }), // Win: +1.0
        createMockResult({ finalPnl: 0.5, entryPrice: 1.0 }), // Loss: -0.5
      ];

      const metrics = calculateTradeMetrics(results);

      // Win rate: 50%, Avg win: 1.0, Loss rate: 50%, Avg loss: 0.5
      // Expectancy = (0.5 * 1.0) - (0.5 * 0.5) = 0.5 - 0.25 = 0.25
      expect(metrics.expectancy).toBeCloseTo(0.25, 2);
    });

    it('should calculate average hold duration', () => {
      const results: SimulationResult[] = [
        createMockResult({
          events: [
            { timestamp: 1000, price: 1.0, action: 'buy' },
            { timestamp: 61000, price: 1.0, action: 'sell' }, // 1000 minutes = 60000 seconds
          ],
        }), // 1000 minutes
        createMockResult({
          events: [
            { timestamp: 1000, price: 1.0, action: 'buy' },
            { timestamp: 181000, price: 1.0, action: 'sell' }, // 3000 minutes = 180000 seconds
          ],
        }), // 3000 minutes
      ];

      const metrics = calculateTradeMetrics(results);

      // Average: (1000 + 3000) / 2 = 2000 minutes
      expect(metrics.avgHoldDuration).toBeCloseTo(2000, 2);
    });

    it('should calculate average time to ATH', () => {
      const results: SimulationResult[] = [
        createMockResult({
          entryPrice: 1.0,
          events: [
            { timestamp: 1000, price: 1.0, action: 'buy' },
            { timestamp: 31000, price: 2.0, action: 'price_update' }, // ATH at 500 minutes = 30000 seconds
            { timestamp: 61000, price: 1.5, action: 'sell' },
          ],
        }), // Time to ATH: 500 minutes
        createMockResult({
          entryPrice: 1.0,
          events: [
            { timestamp: 1000, price: 1.0, action: 'buy' },
            { timestamp: 121000, price: 3.0, action: 'price_update' }, // ATH at 2000 minutes = 120000 seconds
            { timestamp: 181000, price: 2.0, action: 'sell' },
          ],
        }), // Time to ATH: 2000 minutes
      ];

      const metrics = calculateTradeMetrics(results);

      // Average: (500 + 2000) / 2 = 1250 minutes
      expect(metrics.avgTimeToAth).toBeCloseTo(1250, 2);
    });

    it('should handle results with no events', () => {
      const results: SimulationResult[] = [
        createMockResult({ events: [] }),
        createMockResult({ events: [] }),
      ];

      const metrics = calculateTradeMetrics(results);

      expect(metrics.avgHoldDuration).toBe(0);
      expect(metrics.avgTimeToAth).toBe(0);
    });

    it('should handle single event trades', () => {
      const results: SimulationResult[] = [
        createMockResult({
          events: [{ timestamp: 1000, price: 1.0, action: 'buy' }],
        }),
      ];

      const metrics = calculateTradeMetrics(results);

      // With single event, hold duration and time to ATH should be 0
      expect(metrics.avgHoldDuration).toBe(0);
      expect(metrics.avgTimeToAth).toBe(0);
    });

    it('should identify ATH correctly when entry is highest', () => {
      const results: SimulationResult[] = [
        createMockResult({
          entryPrice: 2.0,
          events: [
            { timestamp: 1000, price: 2.0, action: 'buy' }, // Entry is ATH
            { timestamp: 2000, price: 1.5, action: 'price_update' },
            { timestamp: 3000, price: 1.0, action: 'sell' },
          ],
        }),
      ];

      const metrics = calculateTradeMetrics(results);

      // Time to ATH should be 0 (entry is ATH)
      expect(metrics.avgTimeToAth).toBe(0);
    });

    it('should handle large number of trades', () => {
      const results: SimulationResult[] = Array.from({ length: 100 }, (_, i) =>
        createMockResult({
          finalPnl: i % 2 === 0 ? 1.5 : 0.8, // Alternating wins and losses
          entryPrice: 1.0,
        })
      );

      const metrics = calculateTradeMetrics(results);

      expect(metrics.totalTrades).toBe(100);
      expect(metrics.winningTrades).toBe(50);
      expect(metrics.losingTrades).toBe(50);
      expect(metrics.winRate).toBe(50);
      expect(metrics.lossRate).toBe(50);
    });
  });
});

