/**
 * @file engine.test.ts
 * @description
 * Unit tests for the simulation engine core logic.
 * 
 * Tests the simulateStrategy function with basic scenarios and validates
 * the result structure matches the expected types.
 */

import { simulateStrategy, Strategy, StopLossConfig, EntryConfig, ReEntryConfig } from '../../src/simulation/engine';
import { Candle } from '../../src/simulation/candles';

describe('Simulation Engine', () => {
  // Mock candle data for testing
  const mockCandles: Candle[] = [
    { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
    { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
    { timestamp: 3000, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500 },
    { timestamp: 4000, open: 1.25, high: 1.4, low: 1.2, close: 1.35, volume: 1800 },
    { timestamp: 5000, open: 1.35, high: 1.5, low: 1.3, close: 1.45, volume: 2000 },
    { timestamp: 6000, open: 1.45, high: 1.6, low: 1.4, close: 1.55, volume: 2200 },
    { timestamp: 7000, open: 1.55, high: 1.7, low: 1.5, close: 1.65, volume: 2500 },
    { timestamp: 8000, open: 1.65, high: 1.8, low: 1.6, close: 1.75, volume: 2800 },
    { timestamp: 9000, open: 1.75, high: 1.9, low: 1.7, close: 1.85, volume: 3000 },
    { timestamp: 10000, open: 1.85, high: 2.0, low: 1.8, close: 1.95, volume: 3200 }
  ];

  const defaultStrategy: Strategy[] = [
    { percent: 0.5, target: 2.0 }, // 50% at 2x
    { percent: 0.5, target: 3.0 }  // 50% at 3x
  ];

  const defaultStopLoss: StopLossConfig = {
    initial: -0.3, // -30% stop loss
    trailing: 0.5  // 50% trailing to break-even
  };

  const defaultEntry: EntryConfig = {
    initialEntry: 'none',
    trailingEntry: 'none',
    maxWaitTime: 60
  };

  const defaultReEntry: ReEntryConfig = {
    trailingReEntry: 'none',
    maxReEntries: 0
  };

  describe('Basic Strategy Execution', () => {
    it('should execute basic strategy with profitable outcome', () => {
      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(result.finalPnl).toBeGreaterThan(0);
      expect(result.totalCandles).toBe(mockCandles.length);
      expect(result.events).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
    });

    it('should handle single candle data', () => {
      const singleCandle = [mockCandles[0]];
      
      const result = simulateStrategy(
        singleCandle,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(result.totalCandles).toBe(1);
    });

    it('should handle empty candle array', () => {
      const result = simulateStrategy(
        [],
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(result.finalPnl).toBe(0);
      expect(result.totalCandles).toBe(0);
      expect(result.events).toEqual([]);
    });
  });

  describe('Result Structure Validation', () => {
    it('should return complete simulation result', () => {
      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      // Validate all required fields are present
      expect(result).toHaveProperty('finalPnl');
      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('entryPrice');
      expect(result).toHaveProperty('finalPrice');
      expect(result).toHaveProperty('totalCandles');
      expect(result).toHaveProperty('entryOptimization');

      // Validate entry optimization structure
      expect(result.entryOptimization).toHaveProperty('lowestPrice');
      expect(result.entryOptimization).toHaveProperty('lowestPriceTimestamp');
      expect(result.entryOptimization).toHaveProperty('lowestPricePercent');
      expect(result.entryOptimization).toHaveProperty('lowestPriceTimeFromEntry');
      expect(result.entryOptimization).toHaveProperty('trailingEntryUsed');
      expect(result.entryOptimization).toHaveProperty('actualEntryPrice');
      expect(result.entryOptimization).toHaveProperty('entryDelay');

      // Validate data types
      expect(typeof result.finalPnl).toBe('number');
      expect(typeof result.entryPrice).toBe('number');
      expect(typeof result.finalPrice).toBe('number');
      expect(typeof result.totalCandles).toBe('number');
      expect(Array.isArray(result.events)).toBe(true);
    });

    it('should have valid event structure', () => {
      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      result.events.forEach((event) => {
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('price');
        expect(event).toHaveProperty('description');
        expect(event).toHaveProperty('remainingPosition');
        expect(event).toHaveProperty('pnlSoFar');
        
        expect(typeof event.type).toBe('string');
        expect(typeof event.timestamp).toBe('number');
        expect(typeof event.price).toBe('number');
        expect(typeof event.description).toBe('string');
        expect(typeof event.remainingPosition).toBe('number');
        expect(typeof event.pnlSoFar).toBe('number');
        
        // Validate event type is one of the allowed values
        const validTypes = ['entry', 'stop_moved', 'target_hit', 'stop_loss', 'final_exit', 'trailing_entry_triggered', 're_entry'];
        expect(validTypes).toContain(event.type);
      });
    });
  });

  describe('Strategy Variations', () => {
    it('should handle strategy with zero percent', () => {
      const zeroPercentStrategy: Strategy[] = [
        { percent: 0, target: 2.0 }, // 0% at 2x (tracking only)
        { percent: 1.0, target: 3.0 } // 100% at 3x
      ];

      const result = simulateStrategy(
        mockCandles,
        zeroPercentStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(result.finalPnl).toBeGreaterThanOrEqual(0);
    });

    it('should handle strategy with high targets', () => {
      const highTargetStrategy: Strategy[] = [
        { percent: 0.5, target: 10.0 }, // 50% at 10x
        { percent: 0.5, target: 20.0 }   // 50% at 20x
      ];

      const result = simulateStrategy(
        mockCandles,
        highTargetStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      // With high targets, likely won't hit them with normal price movement
      expect(typeof result.finalPnl).toBe('number');
    });
  });

  describe('Stop Loss Configurations', () => {
    it('should handle no trailing stop', () => {
      const noTrailingStopLoss: StopLossConfig = {
        initial: -0.3,
        trailing: 'none'
      };

      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        noTrailingStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(typeof result.finalPnl).toBe('number');
    });

    it('should handle negative stop loss values', () => {
      const negativeStopLoss: StopLossConfig = {
        initial: -0.5, // -50% stop loss
        trailing: 'none'
      };

      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        negativeStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(typeof result.finalPnl).toBe('number');
    });
  });

  describe('Entry Configurations', () => {
    it('should handle trailing entry when configured', () => {
      const trailingEntryConfig: EntryConfig = {
        initialEntry: 'none',
        trailingEntry: 0.1, // 10% trailing entry
        maxWaitTime: 60
      };

      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        defaultStopLoss,
        trailingEntryConfig,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(typeof result.entryOptimization.trailingEntryUsed).toBe('boolean');
    });

    it('should handle no trailing entry', () => {
      const noTrailingEntry: EntryConfig = {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60
      };

      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        defaultStopLoss,
        noTrailingEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(result.entryOptimization.trailingEntryUsed).toBe(false);
    });
  });

  describe('Re-entry Configurations', () => {
    it('should handle re-entry when configured', () => {
      const reEntryConfig: ReEntryConfig = {
        trailingReEntry: 0.2, // 20% retrace for re-entry
        maxReEntries: 2
      };

      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        reEntryConfig
      );

      expect(result).toBeDefined();
      expect(typeof result.finalPnl).toBe('number');
    });

    it('should handle no re-entry', () => {
      const noReEntry: ReEntryConfig = {
        trailingReEntry: 'none',
        maxReEntries: 0
      };

      const result = simulateStrategy(
        mockCandles,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        noReEntry
      );

      expect(result).toBeDefined();
      expect(typeof result.finalPnl).toBe('number');
    });
  });

  describe('Edge Cases', () => {
    it('should handle candles with zero volume', () => {
      const zeroVolumeCandles: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 0 },
        { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 0 }
      ];

      const result = simulateStrategy(
        zeroVolumeCandles,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(result.totalCandles).toBe(2);
    });

    it('should handle candles with extreme price movements', () => {
      const extremeCandles: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.05, low: 0.95, close: 1.0, volume: 1000 },
        { timestamp: 2000, open: 1.0, high: 100.0, low: 0.01, close: 50.0, volume: 10000 }, // Extreme movement
        { timestamp: 3000, open: 50.0, high: 50.5, low: 49.5, close: 50.0, volume: 2000 }
      ];

      const result = simulateStrategy(
        extremeCandles,
        defaultStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry
      );

      expect(result).toBeDefined();
      expect(typeof result.finalPnl).toBe('number');
    });
  });
});