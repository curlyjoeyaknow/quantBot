/**
 * Risk Framework Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createCircuitBreakerState,
  checkCircuitBreaker,
  createAnomalyState,
  checkAnomalies,
  createDefaultRiskFramework,
} from '../../src/execution-models/risk.js';

describe('Risk Framework', () => {
  describe('Circuit Breakers', () => {
    it('should initialize state', () => {
      const state = createCircuitBreakerState();
      expect(state.currentDrawdown).toBe(0);
      expect(state.dailyLoss).toBe(0);
      expect(state.consecutiveLosses).toBe(0);
      expect(state.totalExposure).toBe(0);
    });

    it('should trigger on max drawdown', () => {
      const config = {
        maxDrawdown: 0.2,
      };
      const state = createCircuitBreakerState();
      const result = checkCircuitBreaker(
        config,
        state,
        -100, // Current PnL
        500, // Peak PnL (drawdown = 600/500 = 1.2 > 0.20)
        'strategy1',
        100
      );

      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('drawdown');
    });

    it('should trigger on max daily loss', () => {
      const config = {
        maxDailyLoss: 500,
      };
      const state = createCircuitBreakerState();
      state.dailyLoss = 400;

      const result = checkCircuitBreaker(
        config,
        state,
        -200, // Adds 200 to daily loss = 600 > 500
        1000,
        'strategy1',
        100
      );

      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('daily loss');
    });

    it('should trigger on max consecutive losses', () => {
      const config = {
        maxConsecutiveLosses: 3,
      };
      const state = createCircuitBreakerState();
      state.consecutiveLosses = 2;

      const result = checkCircuitBreaker(
        config,
        state,
        -50, // Another loss = 3 consecutive
        1000,
        'strategy1',
        100
      );

      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('consecutive losses');
    });

    it('should reset consecutive losses on profit', () => {
      const config = {
        maxConsecutiveLosses: 3,
      };
      const state = createCircuitBreakerState();
      state.consecutiveLosses = 2;

      const result = checkCircuitBreaker(
        config,
        state,
        50, // Profit resets counter
        1000,
        'strategy1',
        100
      );

      expect(result.triggered).toBe(false);
      expect(state.consecutiveLosses).toBe(0);
    });

    it('should enforce trade throttle', () => {
      const config = {
        minTradeIntervalSeconds: 5,
      };
      const state = createCircuitBreakerState();
      state.lastTradeTime = Date.now() - 2000; // 2 seconds ago

      const result = checkCircuitBreaker(config, state, 0, 1000, 'strategy1', 100);

      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('throttle');
    });
  });

  describe('Anomaly Detection', () => {
    it('should detect latency spikes', () => {
      const config = {
        enabled: true,
        latencySpikeThreshold: 3,
        slippageSpikeThreshold: 3,
        failureRateSpikeThreshold: 3,
        windowSizeSeconds: 300,
      };
      const state = createAnomalyState();
      const expectedP99 = 500;

      const result = checkAnomalies(
        config,
        state,
        2000, // 4x expected P99
        0,
        false,
        expectedP99,
        0,
        0
      );

      expect(result.detected).toBe(true);
      expect(result.anomalies.some((a) => a.includes('Latency spike'))).toBe(true);
    });

    it('should detect slippage spikes', () => {
      const config = {
        enabled: true,
        latencySpikeThreshold: 3,
        slippageSpikeThreshold: 3,
        failureRateSpikeThreshold: 3,
        windowSizeSeconds: 300,
      };
      const state = createAnomalyState();
      const expectedSlippage = 50;

      const result = checkAnomalies(
        config,
        state,
        0,
        200, // 4x expected slippage
        false,
        0,
        expectedSlippage,
        0
      );

      expect(result.detected).toBe(true);
      expect(result.anomalies.some((a) => a.includes('Slippage spike'))).toBe(true);
    });
  });

  describe('createDefaultRiskFramework', () => {
    it('should create valid framework', () => {
      const framework = createDefaultRiskFramework();
      expect(framework.circuitBreakers.maxDrawdown).toBe(0.2);
      expect(framework.anomalyDetection?.enabled).toBe(true);
    });
  });
});
