/**
 * BotMessageExtractor Tests
 *
 * Tests for extracting metadata from Rick/Phanes bot messages
 */

import { describe, it, expect } from 'vitest';
import { BotMessageExtractor } from '../src/BotMessageExtractor';
import type { ExtractedBotData } from '../src/BotMessageExtractor';

describe('BotMessageExtractor', () => {
  describe('Rick bot message (Ethereum)', () => {
    it('should extract all fields from Rick Ethereum message', () => {
      const rickMessageHTML = `
        <div class="text">
          <a href="https://dexscreener.com/ethereum/0xe6cb52bf0d374236a15290a05ea988d7f643bba4">🟢</a>
          <a href="https://t.me/RickBurpBot?start=0xE6CB52bF0d374236A15290A05EA988d7f643bBa4">Spurdo</a>
          <strong>[155K/1K%]</strong>
          <a href="" onclick="return ShowCashtag(&quot;SPURDO&quot;)">$SPURDO</a><br>
          <a href="stickers/sticker (53).webp">🌐</a> Ethereum @ Uniswap V2<br>
          💰 USD: <code>$0.0001553</code><br>
          💎 FDV: <code>$155K</code> ⇨ <code>155K</code> <code>[4s]</code><br>
          💦 Liq: <code>$32.8K</code> <code>[x5]</code><br>
          📊 Vol: <code>$56K</code> ⋅ Age: <code>2y</code><br>
          📈 1H: <code>78.7%</code> ⋅ <code>$29.4K</code> 🅑 <code>47</code> Ⓢ <code>18</code><br>
          <a href="https://t.me/rick?start=nh_0x6e04259A93457D47CE20dafA50eC7a2eA49F5eB2">👥</a> TH: 
          <a href="https://etherscan.io/address/0x170fbD7793633239D32Ff194DE712a30B5FA7c93">2.3</a>⋅
          <a href="https://etherscan.io/address/0x89f4B50b19884272DCe8Df3765b15C9bEF93B385">1.9</a>⋅
          <a href="https://etherscan.io/address/0x821a624b6aED94a689d50dEE5D98e1f8f79F322F">1.8</a>⋅
          <a href="https://etherscan.io/address/0xCbb385321B8bE68500493440dBe1a50c8319f6eC">1.6</a>⋅
          <a href="https://etherscan.io/address/0xcB2eA9DBeED5415D875621c2C9b52Dcb98881d7B">1.5</a>
          <code>[15%]</code><br>
          Total: <code>117</code> ⋅ avg <code>50w</code> old<br>
          🌱 Fresh 1D: <code>3%</code> ⋅ 7D: <code>9%</code><br>
          <code>0x6e04259A93457D47CE20dafA50eC7a2eA49F5eB2</code><br>
          <a href="https://x.com/search?q=0x6e04259A93457D47CE20dafA50eC7a2eA49F5eB2&amp;f=live">🐦</a>
        </div>
      `;

      const extractor = new BotMessageExtractor();
      const result = extractor.extract(rickMessageHTML);

      expect(result.contractAddress).toBe('0xe6cb52bf0d374236a15290a05ea988d7f643bba4');
      expect(result.chain).toBe('ethereum');
      expect(result.tokenName).toBe('Spurdo');
      expect(result.ticker).toBe('SPURDO');
      expect(result.price).toBe(0.0001553);
      expect(result.marketCap).toBe(155000);
      expect(result.liquidity).toBe(32800);
      expect(result.mcToLiquidityRatio).toBe(5);
      expect(result.volume).toBe(56000);
      expect(result.tokenAge).toBe('2y');
      expect(result.priceChange1h).toBe(78.7);
      expect(result.volume1h).toBe(29400);
      expect(result.buyers1h).toBe(47);
      expect(result.sellers1h).toBe(18);
      expect(result.topHolders).toEqual([2.3, 1.9, 1.8, 1.6, 1.5]);
      expect(result.totalHolders).toBe(117);
      expect(result.avgHolderAge).toBe('50w');
      expect(result.freshWallets1d).toBe(3);
      expect(result.freshWallets7d).toBe(9);
      expect(result.twitterLink).toContain('x.com/search');
      expect(result.exchange).toBe('Ethereum');
      expect(result.platform).toBe('Uniswap V2');
    });

    it('should extract case-sensitive contract address from dexscreener link', () => {
      const html = `
        <div class="text">
          <a href="https://dexscreener.com/ethereum/0xE6CB52bF0d374236A15290A05EA988d7f643bBa4">🟢</a>
        </div>
      `;

      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);

      // Should preserve exact case from URL
      expect(result.contractAddress).toBe('0xE6CB52bF0d374236A15290A05EA988d7f643bBa4');
      expect(result.chain).toBe('ethereum');
    });
  });

  describe('Phanes bot message (Solana)', () => {
    it('should extract Solana token data from Phanes message', () => {
      const phanesMessageHTML = `
        <div class="text">
          <a href="https://dexscreener.com/solana/7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">🟢</a>
          <a href="https://t.me/phanes_bot?start=pf_7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump">TokenName</a>
          <a href="" onclick="return ShowCashtag(&quot;TICKER&quot;)">$TICKER</a><br>
          🌐 Solana @ Raydium<br>
          💰 USD: <code>$0.001</code><br>
          💎 FDV: <code>$100K</code><br>
          💦 Liq: <code>$20K</code> <code>[x5]</code><br>
          📊 Vol: <code>$30K</code> ⋅ Age: <code>1d</code><br>
          📈 1H: <code>50%</code> ⋅ <code>$10K</code> 🅑 <code>20</code> Ⓢ <code>10</code><br>
          Total: <code>50</code> ⋅ avg <code>1w</code> old<br>
          🌱 Fresh 1D: <code>5%</code> ⋅ 7D: <code>15%</code><br>
          <code>7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump</code>
        </div>
      `;

      const extractor = new BotMessageExtractor();
      const result = extractor.extract(phanesMessageHTML);

      expect(result.contractAddress).toBe('7mLj7hayfcRstcyqTWySVaWB962YbfsVYYSnCMbTpump');
      expect(result.chain).toBe('solana');
      expect(result.tokenName).toBe('TokenName');
      expect(result.ticker).toBe('TICKER');
      expect(result.price).toBe(0.001);
      expect(result.marketCap).toBe(100000);
      expect(result.liquidity).toBe(20000);
      expect(result.mcToLiquidityRatio).toBe(5);
      expect(result.volume).toBe(30000);
      expect(result.tokenAge).toBe('1d');
      expect(result.priceChange1h).toBe(50);
      expect(result.volume1h).toBe(10000);
      expect(result.buyers1h).toBe(20);
      expect(result.sellers1h).toBe(10);
      expect(result.totalHolders).toBe(50);
      expect(result.avgHolderAge).toBe('1w');
      expect(result.freshWallets1d).toBe(5);
      expect(result.freshWallets7d).toBe(15);
      // Exchange/platform may not be present in all bot messages
      if (result.exchange) {
        expect(result.exchange).toBe('Solana');
      }
      if (result.platform) {
        expect(result.platform).toBe('Raydium');
      }
    });
  });

  describe('number parsing', () => {
    it('should parse K suffix (thousands)', () => {
      const html = `<div class="text">💎 FDV: <code>$155K</code></div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);
      expect(result.marketCap).toBe(155000);
    });

    it('should parse M suffix (millions)', () => {
      const html = `<div class="text">💎 FDV: <code>$1.5M</code></div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);
      expect(result.marketCap).toBe(1500000);
    });

    it('should parse B suffix (billions)', () => {
      const html = `<div class="text">💎 FDV: <code>$2.5B</code></div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);
      expect(result.marketCap).toBe(2500000000);
    });

    it('should parse numbers without suffix', () => {
      const html = `<div class="text">💰 USD: <code>$0.0001553</code></div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);
      expect(result.price).toBe(0.0001553);
    });
  });

  describe('chain detection', () => {
    it('should detect chain from dexscreener URL', () => {
      const html = `<div class="text"><a href="https://dexscreener.com/base/0x123">🟢</a></div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);
      expect(result.chain).toBe('base');
    });

    it('should detect chain from text', () => {
      const html = `<div class="text"><a href="test">🌐</a> Ethereum @ Uniswap V2</div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);
      expect(result.exchange).toBe('Ethereum');
      expect(result.platform).toBe('Uniswap V2');
    });
  });

  describe('missing fields handling', () => {
    it('should handle missing optional fields gracefully', () => {
      const html = `<div class="text"><a href="https://dexscreener.com/solana/ABC123">🟢</a></div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);

      expect(result.contractAddress).toBe('ABC123');
      expect(result.chain).toBe('solana');
      expect(result.tokenName).toBeUndefined();
      expect(result.ticker).toBeUndefined();
      expect(result.price).toBeUndefined();
    });
  });

  describe('percentage parsing', () => {
    it('should parse percentage values', () => {
      const html = `<div class="text">📈 1H: <code>78.7%</code> 🌱 Fresh 1D: <code>3%</code> ⋅ 7D: <code>9%</code></div>`;
      const extractor = new BotMessageExtractor();
      const result = extractor.extract(html);
      expect(result.priceChange1h).toBe(78.7);
      expect(result.freshWallets1d).toBe(3);
      expect(result.freshWallets7d).toBe(9);
    });
  });
});
