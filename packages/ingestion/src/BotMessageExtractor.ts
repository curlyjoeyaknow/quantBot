/**
 * BotMessageExtractor - Extract metadata from Rick/Phanes bot messages
 *
 * Parses HTML from bot responses to extract:
 * - Contract address (case-sensitive)
 * - Chain
 * - Token name, ticker
 * - Price, market cap, liquidity, volume
 * - Token metrics (age, holders, etc.)
 */

import * as cheerio from 'cheerio';
import type { Chain } from '@quantbot/core';

export interface ExtractedBotData {
  contractAddress: string; // Case-sensitive, full address
  chain: Chain;
  tokenName?: string;
  ticker?: string;
  price?: number;
  marketCap?: number;
  liquidity?: number;
  mcToLiquidityRatio?: number;
  volume?: number;
  tokenAge?: string;
  priceChange1h?: number;
  volume1h?: number;
  buyers1h?: number;
  sellers1h?: number;
  topHolders?: number[]; // Array of percentages
  totalHolders?: number;
  avgHolderAge?: string;
  freshWallets1d?: number;
  freshWallets7d?: number;
  twitterLink?: string;
  exchange?: string;
  platform?: string;
}

export class BotMessageExtractor {
  /**
   * Extract all metadata from bot message HTML
   */
  extract(html: string): ExtractedBotData {
    const $ = cheerio.load(html);
    const result: ExtractedBotData = {
      contractAddress: '',
      chain: 'solana', // Default
    };

    // Extract contract address and chain from dexscreener link
    const dexscreenerLink = $('a[href*="dexscreener.com"]').first().attr('href');
    if (dexscreenerLink) {
      const match = dexscreenerLink.match(/dexscreener\.com\/([^\/]+)\/([^\/\?]+)/);
      if (match) {
        const chainFromUrl = match[1].toLowerCase();
        result.chain = this.normalizeChain(chainFromUrl);
        result.contractAddress = match[2]; // Preserve exact case
      }
    }

    // Also check for address in code blocks (backup)
    if (!result.contractAddress) {
      const codeBlock = $('code').first().text().trim();
      if (codeBlock && (codeBlock.startsWith('0x') || codeBlock.length >= 32)) {
        result.contractAddress = codeBlock;
        // Try to detect chain from address format
        if (codeBlock.startsWith('0x')) {
          result.chain = 'ethereum'; // Default EVM, will be refined by other clues
        }
      }
    }

    // Extract token name from link text (Rick/Phanes format)
    const nameLink = $('a[href*="t.me"]').first();
    const nameText = nameLink.text().trim();
    if (nameText && nameText.length > 0 && nameText.length < 100) {
      result.tokenName = nameText;
    }

    // Extract ticker from cashtag
    const cashtagMatch = html.match(/\$([A-Z0-9]{2,15})\b/);
    if (cashtagMatch) {
      result.ticker = cashtagMatch[1];
    } else {
      // Try ShowCashtag format
      const showCashtagMatch = html.match(/ShowCashtag\(&quot;([^&]+)&quot;\)/);
      if (showCashtagMatch) {
        result.ticker = showCashtagMatch[1];
      }
    }

    // Extract price: 💰 USD: <code>$0.0001553</code>
    const priceMatch = html.match(/💰\s*USD[:\s]*<code>\$?([0-9,]+\.?[0-9]*)<\/code>/i);
    if (priceMatch) {
      result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }

    // Extract market cap/FDV: 💎 FDV: <code>$155K</code>
    const mcapMatch = html.match(/💎\s*FDV[:\s]*<code>\$?([0-9,]+\.?[0-9]*)([KMB]?)/i);
    if (mcapMatch) {
      result.marketCap = this.parseNumberWithSuffix(mcapMatch[1], mcapMatch[2]);
    }

    // Extract liquidity: 💦 Liq: <code>$32.8K</code> <code>[x5]</code>
    const liqMatch = html.match(/💦\s*Liq[:\s]*<code>\$?([0-9,]+\.?[0-9]*)([KMB]?)<\/code>/i);
    if (liqMatch) {
      result.liquidity = this.parseNumberWithSuffix(liqMatch[1], liqMatch[2]);

      // Extract MC/Liq ratio: [x5]
      const ratioMatch = html.match(/\[x([0-9]+)\]/);
      if (ratioMatch) {
        result.mcToLiquidityRatio = parseFloat(ratioMatch[1]);
      }
    }

    // Extract volume: 📊 Vol: <code>$56K</code>
    const volMatch = html.match(/📊\s*Vol[:\s]*<code>\$?([0-9,]+\.?[0-9]*)([KMB]?)<\/code>/i);
    if (volMatch) {
      result.volume = this.parseNumberWithSuffix(volMatch[1], volMatch[2]);
    }

    // Extract token age: Age: <code>2y</code>
    const ageMatch = html.match(/Age[:\s]*<code>([^<]+)<\/code>/i);
    if (ageMatch) {
      result.tokenAge = ageMatch[1].trim();
    }

    // Extract 1H metrics: 📈 1H: <code>78.7%</code> ⋅ <code>$29.4K</code> 🅑 <code>47</code> Ⓢ <code>18</code>
    const oneHourMatch = html.match(/📈\s*1H[:\s]*<code>([0-9,]+\.?[0-9]*)%<\/code>/);
    if (oneHourMatch) {
      result.priceChange1h = parseFloat(oneHourMatch[1].replace(/,/g, ''));
    }

    // Extract 1H volume: 📈 1H: <code>78.7%</code> ⋅ <code>$29.4K</code>
    // Look for the second <code> after 📈 1H
    const vol1hMatch = html.match(
      /📈\s*1H[:\s]*<code>[^<]*<\/code>\s*⋅\s*<code>\$?([0-9,]+\.?[0-9]*)([KMB]?)<\/code>/
    );
    if (vol1hMatch) {
      result.volume1h = this.parseNumberWithSuffix(vol1hMatch[1], vol1hMatch[2]);
    }

    const buyersMatch = html.match(/🅑\s*<code>([0-9]+)<\/code>/);
    if (buyersMatch) {
      result.buyers1h = parseInt(buyersMatch[1], 10);
    }

    const sellersMatch = html.match(/Ⓢ\s*<code>([0-9]+)<\/code>/);
    if (sellersMatch) {
      result.sellers1h = parseInt(sellersMatch[1], 10);
    }

    // Extract top holders: TH: <a>2.3</a>⋅<a>1.9</a>...
    const topHolders: number[] = [];
    $('a[href*="etherscan.io"], a[href*="solscan.io"]').each((_, el) => {
      const text = $(el).text().trim();
      const num = parseFloat(text);
      if (!isNaN(num) && num > 0 && num < 100) {
        topHolders.push(num);
      }
    });
    if (topHolders.length > 0) {
      result.topHolders = topHolders;
    }

    // Extract total holders: Total: <code>117</code>
    const totalHoldersMatch = html.match(/Total[:\s]*<code>([0-9,]+)<\/code>/i);
    if (totalHoldersMatch) {
      result.totalHolders = parseInt(totalHoldersMatch[1].replace(/,/g, ''), 10);
    }

    // Extract avg holder age: avg <code>50w</code> old
    const avgAgeMatch = html.match(/avg\s*<code>([^<]+)<\/code>\s*old/i);
    if (avgAgeMatch) {
      result.avgHolderAge = avgAgeMatch[1].trim();
    }

    // Extract fresh wallets: 🌱 Fresh 1D: <code>3%</code> ⋅ 7D: <code>9%</code>
    const fresh1dMatch = html.match(/🌱\s*Fresh\s*1D[:\s]*<code>([0-9,]+\.?[0-9]*)%<\/code>/i);
    if (fresh1dMatch) {
      result.freshWallets1d = parseFloat(fresh1dMatch[1].replace(/,/g, ''));
    }

    const fresh7dMatch = html.match(/7D[:\s]*<code>([0-9,]+\.?[0-9]*)%<\/code>/i);
    if (fresh7dMatch) {
      result.freshWallets7d = parseFloat(fresh7dMatch[1].replace(/,/g, ''));
    }

    // Extract Twitter link: 🐦 button or https://x.com/search?q=...
    const twitterLink = $('a[href*="x.com"], a[href*="twitter.com"]').first().attr('href');
    if (twitterLink) {
      result.twitterLink = twitterLink;
    }

    // Extract exchange/platform: 🌐 Ethereum @ Uniswap V2
    // Handle both: <a>🌐</a> Ethereum @ Uniswap V2 and 🌐 Solana @ Raydium<br>
    // Try pattern 1: 🌐 in HTML tag followed by text
    let exchangeMatch = html.match(/🌐[^>]*>\s*([A-Za-z0-9\s]+?)\s*@\s*([A-Za-z0-9\sV]+?)(?:<|$)/);
    // Try pattern 2: 🌐 directly followed by text (no HTML tag)
    if (!exchangeMatch) {
      exchangeMatch = html.match(/🌐\s+([A-Za-z0-9\s]+?)\s*@\s*([A-Za-z0-9\sV]+?)(?:<br|<|$)/);
    }
    if (exchangeMatch) {
      result.exchange = exchangeMatch[1].trim();
      result.platform = exchangeMatch[2].trim();
    }

    return result;
  }

  /**
   * Parse number with K/M/B suffix
   */
  private parseNumberWithSuffix(valueStr: string, suffix: string): number {
    const value = parseFloat(valueStr.replace(/,/g, ''));
    if (isNaN(value)) return 0;

    const upperSuffix = suffix.toUpperCase();
    if (upperSuffix === 'K') return value * 1000;
    if (upperSuffix === 'M') return value * 1000000;
    if (upperSuffix === 'B') return value * 1000000000;
    return value;
  }

  /**
   * Normalize chain name from URL or text
   */
  private normalizeChain(chain: string): Chain {
    const normalized = chain.toLowerCase();
    if (normalized === 'ethereum' || normalized === 'eth') return 'ethereum';
    if (normalized === 'base') return 'base';
    if (normalized === 'bsc' || normalized === 'binance') return 'bsc';
    if (normalized === 'solana' || normalized === 'sol') return 'solana';
    return 'solana'; // Default
  }
}
