import { calculateIchimoku, formatIchimokuData } from '../src/ichimoku';
import { Candle } from '../src/candles';

/**
 * Test Suite for Ichimoku Indicator-related computations and formatting.
 *
 * Organization of sections:
 * 1. Mock Candle Data
 * 2. Tests for calculateIchimoku
 * 3. Tests for formatIchimokuData (with full IchimokuData sample)
 * 4. Tests for signal detection (trend/crossover logic)
 */

// -----------------------------------------------------------------------------
// SECTION 1: Mock Candle Data Setup
// -----------------------------------------------------------------------------

/**
 * Array of mock candles for basic tests.
 * Need 52+ candles for full Ichimoku calculation.
 */
const mockCandles: Candle[] = Array.from({ length: 60 }, (_, i) => ({
  timestamp: i * 1000,
  open: 1.0 + i * 0.01,
  high: 1.1 + i * 0.01,
  low: 0.9 + i * 0.01,
  close: 1.05 + i * 0.01,
  volume: 1000 + i * 10,
}));

describe('Ichimoku Calculations', () => {
  // -------------------------------------------------------------------------
  // SECTION 2: calculateIchimoku Calculation Tests
  // -------------------------------------------------------------------------

  describe('calculateIchimoku', () => {
    /**
     * Test: Standard calculation of all Ichimoku components.
     */
    it('should calculate Ichimoku components for valid candles', () => {
      const result = calculateIchimoku(mockCandles, mockCandles.length - 1);
      expect(result).toBeDefined();
      expect(result?.tenkan).toBeDefined();
      expect(result?.kijun).toBeDefined();
      expect(result?.senkouA).toBeDefined();
      expect(result?.senkouB).toBeDefined();
      expect(result?.chikou).toBeDefined();
    });

    /**
     * Test: Edge case, failure with less than required candles.
     */
    it('should return null for insufficient candles', () => {
      const shortCandles = mockCandles.slice(0, 5);
      const result = calculateIchimoku(shortCandles, shortCandles.length - 1);
      expect(result).toBeNull();
    });

    /**
     * Test: Calculation with exactly 52 candles, the minimum needed for Senkou Span B.
     */
    it('should handle edge case with exactly 52 candles', () => {
      const exactly52Candles = Array.from({ length: 52 }, (_, i) => ({
        timestamp: i * 1000,
        open: 1.0 + i * 0.01,
        high: 1.1 + i * 0.01,
        low: 0.9 + i * 0.01,
        close: 1.05 + i * 0.01,
        volume: 1000 + i * 10,
      }));
      const result = calculateIchimoku(exactly52Candles, exactly52Candles.length - 1);
      expect(result).toBeDefined();
      expect(result?.tenkan).toBeDefined();
      expect(result?.kijun).toBeDefined();

      // Test: Tenkan-sen value should be reasonable for sane input. (Type and > 0)
      expect(typeof result?.tenkan).toBe('number');
      expect(result?.tenkan).toBeGreaterThan(0);
      expect(typeof result?.tenkan).toBe('number');
      expect(result?.tenkan).toBeGreaterThan(0);
    });

    /**
     * Test: Kijun-sen value should be reasonable for sane input. (Type and > 0)
     */
    it('should calculate correct Kijun-sen (26-period)', () => {
      const result = calculateIchimoku(mockCandles, mockCandles.length - 1);
      expect(result).toBeDefined();
      expect(typeof result?.kijun).toBe('number');
      expect(result?.kijun).toBeGreaterThan(0);
    });

    /**
     * Test: Senkou Span A existence and type validation.
     */
    it('should calculate correct Senkou Span A', () => {
      const result = calculateIchimoku(mockCandles, mockCandles.length - 1);
      expect(result).toBeDefined();
      expect(typeof result?.senkouA).toBe('number');
    });

    /**
     * Test: Senkou Span B existence and type validation.
     */
    it('should calculate correct Senkou Span B (52-period)', () => {
      const result = calculateIchimoku(mockCandles, mockCandles.length - 1);
      expect(result).toBeDefined();
      expect(typeof result?.senkouB).toBe('number');
    });

    /**
     * Test: Chikou Span existence and type validation.
     */
    it('should calculate correct Chikou Span', () => {
      const result = calculateIchimoku(mockCandles, mockCandles.length - 1);
      expect(result).toBeDefined();
      expect(typeof result?.chikou).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // SECTION 3: formatIchimokuData Output Formatting
  // -------------------------------------------------------------------------

  /**
   * A full IchimokuData mock object as required by the interface.
   * Add all commonly expected properties for more robust and type-safe tests.
   */
  const fullMockIchimokuData = {
    tenkan: 1.5,
    kijun: 1.4,
    senkouA: 1.45,
    senkouB: 1.35,
    chikou: 1.6,
    // Cloud/topology and signal state properties (extend as interface expands)
    cloudTop: 1.45,
    cloudBottom: 1.35,
    cloudThickness: 0.1,
    isBullish: true,
    isBearish: false,
    inCloud: false, // legacy/deprecated? (match to type if needed)
    isPriceAboveCloud: true,
    isPriceBelowCloud: false,
    isPriceInCloud: false,
  };

  describe('formatIchimokuData', () => {
    /**
     * Test: Output string contains all major Ichimoku component labels and values.
     */
    it('should format Ichimoku data correctly', () => {
      const formatted = formatIchimokuData(fullMockIchimokuData, 1.55);

      expect(formatted).toContain('Tenkan');
      expect(formatted).toContain('Kijun');
      expect(formatted).toContain('Cloud');
      expect(formatted).toContain('1.50');
      expect(formatted).toContain('1.40');
    });

    /**
     * Test: Output includes cloud/price position section and label.
     */
    it('should include price position analysis', () => {
      const formatted = formatIchimokuData(fullMockIchimokuData, 1.55);

      expect(formatted).toContain('above cloud');
    });

    /**
     * Test: Price is below the cloud. 'Below Cloud' label expected.
     */
    it('should handle price below cloud', () => {
      const belowCloudData = {
        ...fullMockIchimokuData,
        isPriceAboveCloud: false,
        isPriceBelowCloud: true,
        isPriceInCloud: false,
      };
      const formatted = formatIchimokuData(belowCloudData, 1.3);

      expect(formatted).toContain('below cloud');
    });

    /**
     * Test: Price is inside the cloud. 'Inside Cloud' label expected.
     */
    it('should handle price inside cloud', () => {
      const inCloudData = {
        ...fullMockIchimokuData,
        isPriceAboveCloud: false,
        isPriceBelowCloud: false,
        isPriceInCloud: true,
      };
      const formatted = formatIchimokuData(inCloudData, 1.4);

      expect(formatted).toContain('inside cloud');
    });
  });

  // -------------------------------------------------------------------------
  // SECTION 4: Ichimoku Trend/Crossover Signal Detection
  // -------------------------------------------------------------------------

  describe('Ichimoku signal detection', () => {
    /**
     * Test: Uptrend/bullish case with rising close prices; Tenkan-sen > Kijun-sen.
     */
    it('should detect bullish Tenkan-sen/Kijun-sen crossover', () => {
      const bullishCandles = Array.from({ length: 60 }, (_, i) => ({
        timestamp: i * 1000,
        open: 1.0,
        high: 1.0 + i * 0.02, // Strong upward trend
        low: 0.9,
        close: 1.0 + i * 0.02,
        volume: 1000,
      }));

      const result = calculateIchimoku(bullishCandles, bullishCandles.length - 1);

      expect(result).toBeDefined();
      // In a strong bullish trend, Tenkan-sen should be above or equal to Kijun-sen
      expect(result!.tenkan).toBeGreaterThanOrEqual(result!.kijun);
    });

    /**
     * Test: Downtrend/bearish case with falling close prices; Tenkan-sen < Kijun-sen.
     */
    it('should detect bearish Tenkan-sen/Kijun-sen crossover', () => {
      const bearishCandles = Array.from({ length: 60 }, (_, i) => ({
        timestamp: i * 1000,
        open: 2.0,
        high: 2.0,
        low: 2.0 - i * 0.02, // Strong downward trend
        close: 2.0 - i * 0.02,
        volume: 1000,
      }));

      const result = calculateIchimoku(bearishCandles, bearishCandles.length - 1);

      expect(result).toBeDefined();
      // In a strong bearish trend, Tenkan-sen should be below or equal to Kijun-sen
      expect(result!.tenkan).toBeLessThanOrEqual(result!.kijun);
    });
  });
});
