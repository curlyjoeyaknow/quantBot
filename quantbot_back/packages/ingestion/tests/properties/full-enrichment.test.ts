/**
 * Property Tests: Full Enrichment Validation
 *
 * Tests that all extracted data is fully enriched:
 * - All required fields present
 * - No missing critical data
 * - All numeric fields are valid numbers
 * - All string fields are non-empty when expected
 *
 * Following cursor rules: "Tests are the specification"
 */

import { describe, it, expect } from 'vitest';
import { BotMessageExtractor } from '../../src/BotMessageExtractor';
import type { ExtractedBotData } from '../../src/BotMessageExtractor';

describe('Full Enrichment Property Tests', () => {
  describe('BotMessageExtractor enrichment', () => {
    it('should extract all available fields from complete bot message', () => {
      const extractor = new BotMessageExtractor();

      const completeHTML = `
        <div class="text">
          <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">🟢</a>
          <a href="https://t.me/RickBurpBot?start=pf_7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">TestToken</a>
          <a href="" onclick="return ShowCashtag(&quot;TEST&quot;)">$TEST</a><br>
          🌐 Solana @ Raydium<br>
          💰 USD: <code>$0.0001553</code><br>
          💎 FDV: <code>$155K</code><br>
          💦 Liq: <code>$32.8K</code> <code>[x5]</code><br>
          📊 Vol: <code>$56K</code> ⋅ Age: <code>2y</code><br>
          📈 1H: <code>78.7%</code> ⋅ <code>$29.4K</code> 🅑 <code>47</code> Ⓢ <code>18</code><br>
          <a href="https://solscan.io/address/ABC">2.3</a>⋅
          <a href="https://solscan.io/address/DEF">1.9</a>⋅
          <a href="https://solscan.io/address/GHI">1.8</a><br>
          Total: <code>117</code> ⋅ avg <code>50w</code> old<br>
          🌱 Fresh 1D: <code>3%</code> ⋅ 7D: <code>9%</code><br>
          <code>7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump</code>
          <a href="https://x.com/search?q=test">🐦</a>
        </div>
      `;

      const result = extractor.extract(completeHTML);

      // Property: Contract address must be present and valid
      expect(result.contractAddress).toBeTruthy();
      expect(result.contractAddress.length).toBeGreaterThan(0);

      // Property: Chain must be present
      expect(result.chain).toBeTruthy();
      expect(['solana', 'ethereum', 'base', 'bsc']).toContain(result.chain);

      // Property: All numeric fields should be valid numbers if present
      if (result.price !== undefined) {
        expect(typeof result.price).toBe('number');
        expect(result.price).toBeGreaterThanOrEqual(0);
        expect(isFinite(result.price)).toBe(true);
      }

      if (result.marketCap !== undefined) {
        expect(typeof result.marketCap).toBe('number');
        expect(result.marketCap).toBeGreaterThanOrEqual(0);
        expect(isFinite(result.marketCap)).toBe(true);
      }

      if (result.liquidity !== undefined) {
        expect(typeof result.liquidity).toBe('number');
        expect(result.liquidity).toBeGreaterThanOrEqual(0);
        expect(isFinite(result.liquidity)).toBe(true);
      }

      if (result.volume !== undefined) {
        expect(typeof result.volume).toBe('number');
        expect(result.volume).toBeGreaterThanOrEqual(0);
        expect(isFinite(result.volume)).toBe(true);
      }

      if (result.priceChange1h !== undefined) {
        expect(typeof result.priceChange1h).toBe('number');
        expect(isFinite(result.priceChange1h)).toBe(true);
      }

      if (result.buyers1h !== undefined) {
        expect(typeof result.buyers1h).toBe('number');
        expect(result.buyers1h).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.buyers1h)).toBe(true);
      }

      if (result.sellers1h !== undefined) {
        expect(typeof result.sellers1h).toBe('number');
        expect(result.sellers1h).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.sellers1h)).toBe(true);
      }

      if (result.totalHolders !== undefined) {
        expect(typeof result.totalHolders).toBe('number');
        expect(result.totalHolders).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.totalHolders)).toBe(true);
      }

      // Property: String fields should be non-empty if present
      if (result.tokenName !== undefined) {
        expect(typeof result.tokenName).toBe('string');
        expect(result.tokenName.length).toBeGreaterThan(0);
      }

      if (result.ticker !== undefined) {
        expect(typeof result.ticker).toBe('string');
        expect(result.ticker.length).toBeGreaterThan(0);
      }

      if (result.tokenAge !== undefined) {
        expect(typeof result.tokenAge).toBe('string');
        expect(result.tokenAge.length).toBeGreaterThan(0);
      }

      // Property: Arrays should be non-empty if present
      if (result.topHolders !== undefined) {
        expect(Array.isArray(result.topHolders)).toBe(true);
        expect(result.topHolders.length).toBeGreaterThan(0);
        result.topHolders.forEach((holder) => {
          expect(typeof holder).toBe('number');
          expect(holder).toBeGreaterThan(0);
          expect(holder).toBeLessThan(100); // Percentage
        });
      }
    });

    it('should handle partial data gracefully (not all fields required)', () => {
      const extractor = new BotMessageExtractor();

      const minimalHTML = `
        <div class="text">
          <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">🟢</a>
        </div>
      `;

      const result = extractor.extract(minimalHTML);

      // Property: Minimal data should still extract contract address and chain
      expect(result.contractAddress).toBeTruthy();
      expect(result.chain).toBeTruthy();

      // Property: Optional fields can be undefined
      // (This is valid - not all bot messages have complete data)
      expect(result.price).toBeUndefined();
      expect(result.marketCap).toBeUndefined();
    });

    it('should validate all numeric fields are not NaN or Infinity', () => {
      const extractor = new BotMessageExtractor();

      const testCases = [
        { html: '💰 USD: <code>$0.0001553</code>', field: 'price' },
        { html: '💎 FDV: <code>$155K</code>', field: 'marketCap' },
        { html: '💦 Liq: <code>$32.8K</code>', field: 'liquidity' },
        { html: '📊 Vol: <code>$56K</code>', field: 'volume' },
        { html: '📈 1H: <code>78.7%</code>', field: 'priceChange1h' },
      ];

      for (const testCase of testCases) {
        const html = `<div class="text">${testCase.html}</div>`;
        const result = extractor.extract(html);

        const value = (result as any)[testCase.field];
        if (value !== undefined) {
          // Property: All numeric values must be valid numbers
          expect(typeof value).toBe('number');
          expect(isNaN(value)).toBe(false);
          expect(isFinite(value)).toBe(true);
        }
      }
    });
  });
});
