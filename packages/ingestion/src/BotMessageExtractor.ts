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
import { PublicKey } from '@solana/web3.js';
import type { Chain } from '@quantbot/core';
import { logger } from '@quantbot/utils';
import { extractAddresses } from './addressValidation.js';

export interface ExtractedBotData {
  contractAddress: string; // Case-sensitive, full address
  chain: Chain;
  tokenName?: string;
  ticker?: string;
  price?: number;
  marketCap?: number; // FDV/Market Cap
  liquidity?: number;
  mcToLiquidityRatio?: number; // MC/Liq ratio (x5, x10, etc.)
  volume?: number;
  tokenAge?: string;
  priceChange1h?: number;
  volume1h?: number;
  buyers1h?: number;
  sellers1h?: number;
  topHolders?: number[]; // Array of percentages (TH: 2.3⋅1.9⋅1.5...)
  totalHolders?: number;
  avgHolderAge?: string;
  freshWallets1d?: number;
  freshWallets7d?: number;
  twitterLink?: string;
  telegramLink?: string;
  websiteLink?: string;
  exchange?: string;
  platform?: string;
  // Additional fields
  athMcap?: number; // All-time high market cap (if mentioned)
  supply?: number; // Calculated: mcap / price (if SOL, use $130 as SOL price)
  thPercent?: number; // Sum of all top holder percentages
  messageTimestamp?: Date; // When the bot message was sent
  originalMessageId?: string; // Original user message ID that triggered the bot
}

export class BotMessageExtractor {
  /**
   * Extract all metadata from bot message (HTML or plain text)
   */
  extract(textOrHtml: string): ExtractedBotData {
    // Detect if input is HTML or plain text
    const isHtml = textOrHtml.includes('<') && textOrHtml.includes('>');
    const $ = isHtml ? cheerio.load(textOrHtml) : null;
    const plainText = isHtml && $ ? $.text() : textOrHtml;

    const result: ExtractedBotData = {
      contractAddress: '',
      chain: 'solana', // Default
    };

    // Extract contract address and chain from dexscreener link (HTML)
    let dexscreenerLink: string | undefined;
    if ($) {
      dexscreenerLink = $('a[href*="dexscreener.com"]').first().attr('href');
    } else {
      // Plain text: extract from URL pattern
      const dexMatch = plainText.match(/dexscreener\.com\/[^/\s]+\/([A-Za-z0-9]{32,44})/);
      if (dexMatch) {
        dexscreenerLink = `https://dexscreener.com/${dexMatch[0]}`;
      }
    }

    if (dexscreenerLink) {
      const match = dexscreenerLink.match(/dexscreener\.com\/([^/]+)\/([^/?]+)/);
      if (match) {
        const chainFromUrl = match[1].toLowerCase();
        result.chain = this.normalizeChain(chainFromUrl);
        const extractedAddress = match[2]; // Preserve exact case

        // Validate Solana addresses are base58
        if (result.chain === 'solana') {
          try {
            const pubkey = new PublicKey(extractedAddress);
            // Verify it's valid base58 and preserve case
            result.contractAddress = pubkey.toBase58();
            // If case differs, log warning but use validated address
            if (result.contractAddress !== extractedAddress) {
              logger.warn('Solana address case mismatch', {
                extracted: extractedAddress + '...',
                validated: result.contractAddress + '...',
              });
            }
          } catch (error) {
            logger.warn('Invalid Solana address extracted', {
              address: extractedAddress + '...',
              error: error instanceof Error ? error.message : String(error),
            });
            // Still set it, but it will fail validation later
            result.contractAddress = extractedAddress;
          }
        } else {
          // EVM addresses: preserve exact case
          result.contractAddress = extractedAddress;
        }
      }
    }

    // Also check for address in code blocks (HTML) or plain text patterns (backup)
    if (!result.contractAddress) {
      if ($) {
        // Extract from code blocks first (more reliable)
        const codeBlock = $('code').first().text().trim();
        if (codeBlock) {
          const extracted = extractAddresses(codeBlock);
          if (extracted.solana.length > 0) {
            result.contractAddress = extracted.solana[0];
            result.chain = 'solana';
          } else if (extracted.evm.length > 0) {
            result.contractAddress = extracted.evm[0];
            // Default to ethereum, but chain will be detected from context
            result.chain = this.detectChainFromText(plainText, extracted.evm[0]);
          }
        }
      }

      // If still no address, extract from full plain text using centralized function
      if (!result.contractAddress) {
        const extracted = extractAddresses(plainText);
        // Prefer Solana addresses first (most common in our use case)
        if (extracted.solana.length > 0) {
          result.contractAddress = extracted.solana[0];
          result.chain = 'solana';
        } else if (extracted.evm.length > 0) {
          result.contractAddress = extracted.evm[0];
          result.chain = this.detectChainFromText(plainText, extracted.evm[0]);
        }
      }
    }

    // Extract token name from link text (HTML) or plain text patterns
    if ($) {
      const nameLink = $('a[href*="t.me"]').first();
      const nameText = nameLink.text().trim();
      if (nameText && nameText.length > 0 && nameText.length < 100) {
        result.tokenName = nameText;
      }
    } else {
      // Plain text: extract name patterns like "💊 Token Name ($TICKER)" or "Token Name"
      const namePatterns = [
        /(?:💊|🟣|🐶|🟢|🔷|🪙)\s*([A-Z][a-zA-Z0-9\s\-.'\]]+?)(?:\s*\(|\s*\[|\s*\$|$)/,
        /^([A-Z][a-zA-Z0-9\s\-.'\]]+?)\s*\(/,
        /([A-Z][a-zA-Z][a-zA-Z0-9\s\-.'\]]{2,30}?)(?:\s*\(|\s*\$)/,
      ];
      for (const pattern of namePatterns) {
        const match = plainText.match(pattern);
        if (match && match[1]) {
          const name = match[1].trim();
          if (name.length >= 2 && name.length < 100 && !name.match(/^\$[A-Z0-9]+$/)) {
            result.tokenName = name;
            break;
          }
        }
      }
    }

    // Extract ticker from cashtag (works for both HTML and plain text)
    const cashtagMatch = textOrHtml.match(/\$([A-Z0-9]{2,15})\b/);
    if (cashtagMatch) {
      result.ticker = cashtagMatch[1];
    } else if ($) {
      // Try ShowCashtag format (HTML only)
      const showCashtagMatch = textOrHtml.match(/ShowCashtag\(&quot;([^&]+)&quot;\)/);
      if (showCashtagMatch) {
        result.ticker = showCashtagMatch[1];
      }
    }

    // Extract price: 💰 USD: <code>$0.0001553</code> (HTML) or 💰 USD: $0.0001553 (plain text)
    let priceMatch = textOrHtml.match(
      /💰\s*USD[:\s]*(?:<code>)?\$?([0-9,]+\.?[0-9]*)(?:<\/code>)?/i
    );
    if (!priceMatch) {
      // Try plain text pattern: 💰 USD: $0.0001553
      priceMatch = plainText.match(/💰\s*USD[:\s]*\$?([0-9,]+\.?[0-9]*)/i);
    }
    if (priceMatch) {
      result.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    }

    // Extract market cap/FDV: 💎 FDV: <code>$155K</code> (HTML) or 💎 FDV: $155K (plain text)
    let mcapMatch = textOrHtml.match(
      /💎\s*FDV[:\s]*(?:<code>)?\$?([0-9,]+\.?[0-9]*)([KMB]?)(?:<\/code>)?/i
    );
    if (!mcapMatch) {
      // Try plain text pattern
      mcapMatch = plainText.match(/💎\s*FDV[:\s]*\$?([0-9,]+\.?[0-9]*)([KMB]?)/i);
    }
    if (mcapMatch) {
      result.marketCap = this.parseNumberWithSuffix(mcapMatch[1], mcapMatch[2]);
    }

    // Extract liquidity: 💦 Liq: <code>$32.8K</code> <code>[x5]</code> (HTML) or 💦 Liq: $32.8K [x5] (plain text)
    let liqMatch = textOrHtml.match(
      /💦\s*Liq[:\s]*(?:<code>)?\$?([0-9,]+\.?[0-9]*)([KMB]?)(?:<\/code>)?/i
    );
    if (!liqMatch) {
      liqMatch = plainText.match(/💦\s*Liq[:\s]*\$?([0-9,]+\.?[0-9]*)([KMB]?)/i);
    }
    if (liqMatch) {
      result.liquidity = this.parseNumberWithSuffix(liqMatch[1], liqMatch[2]);

      // Extract MC/Liq ratio: [x5]
      const ratioMatch = textOrHtml.match(/\[x([0-9]+)\]/);
      if (ratioMatch) {
        result.mcToLiquidityRatio = parseFloat(ratioMatch[1]);
      }
    }

    // Extract volume: 📊 Vol: <code>$56K</code> (HTML) or 📊 Vol: $56K (plain text)
    let volMatch = textOrHtml.match(
      /📊\s*Vol[:\s]*(?:<code>)?\$?([0-9,]+\.?[0-9]*)([KMB]?)(?:<\/code>)?/i
    );
    if (!volMatch) {
      volMatch = plainText.match(/📊\s*Vol[:\s]*\$?([0-9,]+\.?[0-9]*)([KMB]?)/i);
    }
    if (volMatch) {
      result.volume = this.parseNumberWithSuffix(volMatch[1], volMatch[2]);
    }

    // Extract token age: Age: <code>2y</code> (HTML) or Age: 2y (plain text)
    let ageMatch = textOrHtml.match(/Age[:\s]*(?:<code>)?([^<\n]+?)(?:<\/code>|$)/i);
    if (!ageMatch) {
      ageMatch = plainText.match(/Age[:\s]*([0-9]+[ymdh]?)/i);
    }
    if (ageMatch) {
      result.tokenAge = ageMatch[1].trim();
    }

    // Extract 1H metrics: 📈 1H: <code>78.7%</code> ⋅ <code>$29.4K</code> 🅑 <code>47</code> Ⓢ <code>18</code>
    let oneHourMatch = textOrHtml.match(/📈\s*1H[:\s]*(?:<code>)?([0-9,]+\.?[0-9]*)%(?:<\/code>)?/);
    if (!oneHourMatch) {
      oneHourMatch = plainText.match(/📈\s*1H[:\s]*([0-9,]+\.?[0-9]*)%/);
    }
    if (oneHourMatch) {
      result.priceChange1h = parseFloat(oneHourMatch[1].replace(/,/g, ''));
    }

    // Extract 1H volume: 📈 1H: <code>78.7%</code> ⋅ <code>$29.4K</code>
    let vol1hMatch = textOrHtml.match(
      /📈\s*1H[:\s]*(?:<code>)?[^<]*?(?:<\/code>)?\s*⋅\s*(?:<code>)?\$?([0-9,]+\.?[0-9]*)([KMB]?)(?:<\/code>)?/
    );
    if (!vol1hMatch) {
      vol1hMatch = plainText.match(/📈\s*1H[:\s]*[0-9.%]+\s*⋅\s*\$?([0-9,]+\.?[0-9]*)([KMB]?)/);
    }
    if (vol1hMatch) {
      result.volume1h = this.parseNumberWithSuffix(vol1hMatch[1], vol1hMatch[2]);
    }

    let buyersMatch = textOrHtml.match(/🅑\s*(?:<code>)?([0-9]+)(?:<\/code>)?/);
    if (!buyersMatch) {
      buyersMatch = plainText.match(/🅑\s*([0-9]+)/);
    }
    if (buyersMatch) {
      result.buyers1h = parseInt(buyersMatch[1], 10);
    }

    let sellersMatch = textOrHtml.match(/Ⓢ\s*(?:<code>)?([0-9]+)(?:<\/code>)?/);
    if (!sellersMatch) {
      sellersMatch = plainText.match(/Ⓢ\s*([0-9]+)/);
    }
    if (sellersMatch) {
      result.sellers1h = parseInt(sellersMatch[1], 10);
    }

    // Extract top holders: TH: <a>2.3</a>⋅<a>1.9</a>... (HTML) or TH: 2.3⋅1.9... (plain text)
    const topHolders: number[] = [];
    if ($) {
      $('a[href*="etherscan.io"], a[href*="solscan.io"]').each((_, el) => {
        const text = $(el).text().trim();
        const num = parseFloat(text);
        if (!isNaN(num) && num > 0 && num < 100) {
          topHolders.push(num);
        }
      });
    }

    // Also try to extract TH from text pattern: TH: 2.2⋅1.9⋅1.5...
    const thTextMatch = textOrHtml.match(/TH[:\s]*([0-9.]+(?:⋅[0-9.]+)*)/i);
    if (thTextMatch) {
      const thValues = thTextMatch[1]
        .split('⋅')
        .map((v) => parseFloat(v.trim()))
        .filter((v) => !isNaN(v));
      if (thValues.length > 0) {
        result.topHolders = thValues;
        result.thPercent = thValues.reduce((sum, val) => sum + val, 0);
      }
    } else if (topHolders.length > 0) {
      result.topHolders = topHolders;
      result.thPercent = topHolders.reduce((sum, val) => sum + val, 0);
    }

    // Extract total holders: Total: <code>117</code> (HTML) or Total: 117 (plain text)
    let totalHoldersMatch = textOrHtml.match(/Total[:\s]*(?:<code>)?([0-9,]+)(?:<\/code>)?/i);
    if (!totalHoldersMatch) {
      totalHoldersMatch = plainText.match(/Total[:\s]*([0-9,]+)/i);
    }
    if (totalHoldersMatch) {
      result.totalHolders = parseInt(totalHoldersMatch[1].replace(/,/g, ''), 10);
    }

    // Extract avg holder age: avg <code>50w</code> old (HTML) or avg 50w old (plain text)
    let avgAgeMatch = textOrHtml.match(/avg\s*(?:<code>)?([^<\n]+?)(?:<\/code>)?\s*old/i);
    if (!avgAgeMatch) {
      avgAgeMatch = plainText.match(/avg\s*([0-9]+[ymwdh]?)\s*old/i);
    }
    if (avgAgeMatch) {
      result.avgHolderAge = avgAgeMatch[1].trim();
    }

    // Extract fresh wallets: 🌱 Fresh 1D: <code>3%</code> ⋅ 7D: <code>9%</code>
    let fresh1dMatch = textOrHtml.match(
      /🌱\s*Fresh\s*1D[:\s]*(?:<code>)?([0-9,]+\.?[0-9]*)%(?:<\/code>)?/i
    );
    if (!fresh1dMatch) {
      fresh1dMatch = plainText.match(/🌱\s*Fresh\s*1D[:\s]*([0-9,]+\.?[0-9]*)%/i);
    }
    if (fresh1dMatch) {
      result.freshWallets1d = parseFloat(fresh1dMatch[1].replace(/,/g, ''));
    }

    let fresh7dMatch = textOrHtml.match(/7D[:\s]*(?:<code>)?([0-9,]+\.?[0-9]*)%(?:<\/code>)?/i);
    if (!fresh7dMatch) {
      fresh7dMatch = plainText.match(/7D[:\s]*([0-9,]+\.?[0-9]*)%/i);
    }
    if (fresh7dMatch) {
      result.freshWallets7d = parseFloat(fresh7dMatch[1].replace(/,/g, ''));
    }

    // Extract social links (HTML or plain text)
    if ($) {
      const twitterLink = $('a[href*="x.com"], a[href*="twitter.com"]').first().attr('href');
      if (twitterLink) {
        result.twitterLink = twitterLink;
      }

      const telegramLink = $('a[href*="t.me"]')
        .not('a[href*="t.me/phanes"], a[href*="t.me/RickBurpBot"], a[href*="t.me/maestro"]')
        .first()
        .attr('href');
      if (telegramLink && !telegramLink.includes('bot')) {
        result.telegramLink = telegramLink;
      }

      const websiteLink = $('a[href^="http"]')
        .not(
          'a[href*="t.me"], a[href*="x.com"], a[href*="twitter.com"], a[href*="dexscreener"], a[href*="solscan"], a[href*="etherscan"], a[href*="pump.fun"]'
        )
        .first()
        .attr('href');
      if (websiteLink) {
        result.websiteLink = websiteLink;
      }
    } else {
      // Plain text: extract URLs
      const urlPattern = /(https?:\/\/[^\s<>"']+)/g;
      const urls = plainText.match(urlPattern) || [];
      for (const url of urls) {
        if ((url.includes('x.com') || url.includes('twitter.com')) && !result.twitterLink) {
          result.twitterLink = url;
        } else if (
          url.includes('t.me') &&
          !url.includes('bot') &&
          !url.includes('phanes') &&
          !url.includes('RickBurpBot') &&
          !url.includes('maestro') &&
          !result.telegramLink
        ) {
          result.telegramLink = url;
        } else if (
          !url.includes('t.me') &&
          !url.includes('x.com') &&
          !url.includes('twitter.com') &&
          !url.includes('dexscreener') &&
          !url.includes('solscan') &&
          !url.includes('etherscan') &&
          !url.includes('pump.fun') &&
          !result.websiteLink
        ) {
          result.websiteLink = url;
        }
      }
    }

    // Extract ATH mcap if mentioned: ATH: <code>$500K</code> or similar
    let athMatch = textOrHtml.match(
      /ATH[:\s]*(?:<code>)?\$?([0-9,]+\.?[0-9]*)([KMB]?)(?:<\/code>)?/i
    );
    if (!athMatch) {
      athMatch = plainText.match(/ATH[:\s]*\$?([0-9,]+\.?[0-9]*)([KMB]?)/i);
    }
    if (athMatch) {
      result.athMcap = this.parseNumberWithSuffix(athMatch[1], athMatch[2]);
    }

    // Calculate supply: mcap / price (for Solana tokens, use SOL price of $130)
    if (result.marketCap && result.price) {
      if (result.chain === 'solana') {
        // For Solana tokens, supply = mcap / (price * SOL_price)
        // If price is in USD, we need to know if it's per token or per SOL
        // Assuming price is per token in USD, and we want supply in tokens
        // For now, just calculate: supply = mcap / price (tokens)
        result.supply = result.marketCap / result.price;
      } else {
        // For EVM tokens, supply = mcap / price
        result.supply = result.marketCap / result.price;
      }
    }

    // Extract exchange/platform: 🌐 Ethereum @ Uniswap V2
    let exchangeMatch = textOrHtml.match(
      /🌐[^>]*>\s*([A-Za-z0-9\s]+?)\s*@\s*([A-Za-z0-9\sV]+?)(?:<|$)/
    );
    if (!exchangeMatch) {
      exchangeMatch = textOrHtml.match(
        /🌐\s+([A-Za-z0-9\s]+?)\s*@\s*([A-Za-z0-9\sV]+?)(?:<br|<|$)/
      );
    }
    if (!exchangeMatch) {
      exchangeMatch = plainText.match(/🌐\s+([A-Za-z0-9\s]+?)\s*@\s*([A-Za-z0-9\sV]+?)(?:\n|$)/);
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

  /**
   * Detect chain from text context (for EVM addresses that can't be distinguished by format)
   * Enhanced with exchange/platform hints and message patterns
   */
  private detectChainFromText(text: string, address: string, callerHistory?: string[]): Chain {
    const lowerText = text.toLowerCase();

    // Explicit chain mentions (highest priority)
    if (
      lowerText.includes('base') ||
      lowerText.includes('base chain') ||
      lowerText.includes('base network')
    ) {
      return 'base';
    }
    if (
      lowerText.includes('bsc') ||
      lowerText.includes('binance smart chain') ||
      lowerText.includes('binance chain')
    ) {
      return 'bsc';
    }
    if (
      lowerText.includes('ethereum') ||
      lowerText.includes('eth mainnet') ||
      lowerText.includes('ethereum mainnet')
    ) {
      return 'ethereum';
    }

    // Exchange/platform hints
    if (lowerText.includes('uniswap') || lowerText.includes('ethereum')) {
      return 'ethereum';
    }
    if (
      lowerText.includes('baseswap') ||
      lowerText.includes('aerodrome') ||
      lowerText.includes('base dex')
    ) {
      return 'base';
    }
    if (lowerText.includes('pancakeswap') || lowerText.includes('pancake swap')) {
      return 'bsc';
    }

    // Token name patterns (e.g., "BASE token", "Base Token")
    if (lowerText.match(/\bbase\s+token\b/i)) {
      return 'base';
    }

    // Caller history analysis (if available)
    // Note: callerHistory would need to be passed from the caller
    // For now, this is a placeholder for future enhancement
    if (callerHistory && callerHistory.length > 0) {
      const baseCount = callerHistory.filter((c) => c === 'base').length;
      const ethCount = callerHistory.filter((c) => c === 'ethereum').length;
      const bscCount = callerHistory.filter((c) => c === 'bsc').length;

      if (baseCount > ethCount * 2 && baseCount > bscCount * 2) {
        return 'base';
      }
      if (bscCount > ethCount * 2 && bscCount > baseCount * 2) {
        return 'bsc';
      }
      if (ethCount > baseCount * 2 && ethCount > bscCount * 2) {
        return 'ethereum';
      }
    }

    // Default to ethereum for EVM addresses if no context
    return 'ethereum';
  }
}
