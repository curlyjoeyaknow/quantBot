import { describe, it, expect, vi } from 'vitest';
import {
  checkStopLoss,
  checkProfitTarget,
  checkTrailingStopActivation,
  calculateTrailingStopPrice,
  initStopLossState,
  updateStopLossState,
  initTrailingStopState,
  updateRollingTrailingStop,
} from '../../../src/execution/exit';
import type { Candle } from '../../../src/types/candle';
import type { StopLossConfig, StrategyLeg } from '../../../src/types';

describe('Exit Detection', () => {
  const mockCandle: Candle = {
    timestamp: 1000,
    open: 1.0,
    high: 1.2,
    low: 0.8,
    close: 1.1,
    volume: 1000,
  };

  describe('checkStopLoss', () => {
    it('should detect stop loss hit', () => {
      const result = checkStopLoss(mockCandle, 1.0, 0.85);
      expect(result).not.toBeNull();
      expect(result?.shouldExit).toBe(true);
      expect(result?.type).toBe('stop_loss');
      expect(result?.price).toBe(0.85);
    });

    it('should return null if stop loss not hit', () => {
      const result = checkStopLoss(mockCandle, 1.0, 0.75);
      expect(result).toBeNull();
    });
  });

  describe('checkProfitTarget', () => {
    it('should detect profit target hit', () => {
      const target: StrategyLeg = { target: 2.0, percent: 0.5 };
      const result = checkProfitTarget(mockCandle, 1.0, target, 0);
      expect(result).not.toBeNull();
      expect(result?.shouldExit).toBe(true);
      expect(result?.type).toBe('target');
      expect(result?.price).toBe(2.0);
    });

    it('should return null if target not hit', () => {
      const target: StrategyLeg = { target: 3.0, percent: 0.5 };
      const result = checkProfitTarget(mockCandle, 1.0, target, 0);
      expect(result).toBeNull();
    });
  });

  describe('checkTrailingStopActivation', () => {
    it('should activate trailing stop when threshold reached', () => {
      const activated = checkTrailingStopActivation(mockCandle, 1.0, 0.15);
      expect(activated).toBe(true);
    });

    it('should not activate if threshold not reached', () => {
      const activated = checkTrailingStopActivation(mockCandle, 1.0, 0.25);
      expect(activated).toBe(false);
    });

    it('should return false for none', () => {
      const activated = checkTrailingStopActivation(mockCandle, 1.0, 'none');
      expect(activated).toBe(false);
    });
  });

  describe('calculateTrailingStopPrice', () => {
    it('should calculate trailing stop at entry price', () => {
      const stopPrice = calculateTrailingStopPrice(2.0, 1.0, 0.5);
      expect(stopPrice).toBe(1.0); // Break-even
    });
  });

  describe('Stop Loss State Management', () => {
    it('should initialize stop loss state', () => {
      const config: StopLossConfig = { initial: -0.3, trailing: 0.5 };
      const state = initStopLossState(1.0, config);
      expect(state.stopLossPrice).toBe(0.7);
      expect(state.trailingActive).toBe(false);
      expect(state.peakPrice).toBe(1.0);
    });

    it('should update stop loss state', () => {
      const config: StopLossConfig = { initial: -0.3, trailing: 0.5 };
      const state = initStopLossState(1.0, config);
      const newCandle: Candle = {
        timestamp: 2000,
        open: 1.5,
        high: 1.6,
        low: 1.4,
        close: 1.55,
        volume: 1000,
      };
      const { state: updatedState, activated } = updateStopLossState(state, newCandle, 1.0, config);
      expect(updatedState.peakPrice).toBe(1.6);
      expect(activated).toBe(true); // Should activate trailing
      expect(updatedState.stopLossPrice).toBe(1.0); // Move to break-even
    });
  });

  describe('Rolling Trailing Stop', () => {
    it('should initialize trailing stop state', () => {
      const config: StopLossConfig = { initial: -0.3, trailing: 0.5, trailingWindowSize: 20 };
      const state = initTrailingStopState(1.0, config);
      expect(state.windowSize).toBe(20);
      expect(state.currentStop).toBe(0.7);
      expect(state.peakPrice).toBe(1.0);
    });

    it('should update rolling trailing stop', () => {
      const config: StopLossConfig = { initial: -0.3, trailing: 0.25, trailingWindowSize: 5 };
      const state = initTrailingStopState(1.0, config);
      const candle: Candle = {
        timestamp: 2000,
        open: 1.2,
        high: 1.3,
        low: 1.1,
        close: 1.25,
        volume: 1000,
      };
      const updated = updateRollingTrailingStop(state, candle, 0, 0.25);
      expect(updated.windowLows.length).toBe(1);
      expect(updated.windowLows[0]).toBe(1.1);
      expect(updated.currentStop).toBe(1.1 * 0.75); // 25% below window low
    });
  });
});
