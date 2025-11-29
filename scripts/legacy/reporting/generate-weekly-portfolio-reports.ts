#!/usr/bin/env ts-node
/**
 * Generate Weekly Portfolio Reports
 * 
 * Creates weekly HTML email reports from weighted portfolio history CSV,
 * showing performance metrics and active calls for each week from September to November 2025.
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { queryCandles, hasCandles } from '../src/storage/clickhouse-client';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1 || 'dec8084b90724ffe949b68d0a18359d6';

const PORTFOLIO_CSV = path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller/weighted_portfolio_history_solana_only.csv');
const CALLER_DIR = path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller');
const TEMPLATE_PATH = path.join(__dirname, '../data/exports/emails/weekly-report-2025-11-06.html');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/emails/weekly-reports');
const CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

interface WeeklyPortfolioData {
  week: string;
  date: DateTime;
  portfolioValue: number;
  tradesThisWeek: number;
  weeklyReturn: number;
}

interface Trade {
  caller: string;
  tokenAddress: string;
  alertTime: DateTime;
  entryTime: DateTime | null;
  exitTime: DateTime | null;
  pnl: number;
  pnlPercent: number;
  maxReached: number;
  chain: string;
  sourceFile?: string;
  channel?: string;
}

interface TradeStatus {
  status: 'active' | 'tp-hit' | 'stopped' | 'closed';
  entryPrice: number;
  exitPrice?: number;
  currentPrice?: number;
  pnlPercent: number;
}

// Trading parameters from weighted portfolio
const STOP_LOSS_PERCENT = 0.2; // 20%
const PROFIT_TARGETS = [1.5, 2.0, 3.0]; // Typical profit targets
const MAX_HOLD_DAYS = 7;

/**
 * Fix template to be fully responsive based on window size
 * Removes @media queries and uses CSS Grid auto-fit for true responsiveness
 */
function fixTemplateMobileStyles(template: string): string {
  let html = template;
  
  // Remove all @media queries completely
  let mediaQueryMatch;
  while ((mediaQueryMatch = html.match(/@media\s*\([^)]+\)\s*\{[\s\S]*?\}/)) !== null) {
    html = html.replace(mediaQueryMatch[0], '');
  }
  
  // Make stats-grid responsive (1 col mobile, 2 col tablet, 3 col desktop)
  html = html.replace(/\.stats-grid\s*\{[^}]*\}/g, 
    `.stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 16px;
        }`);
  
  // Make outcome-grid responsive (1 col mobile, 2-3 col larger screens)
  html = html.replace(/\.outcome-grid\s*\{[^}]*\}/g,
    `.outcome-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        }`);
  
  // Make bot-stats responsive (1 col mobile, 2 col tablet, 4 col desktop)
  html = html.replace(/\.bot-stats\s*\{[^}]*\}/g,
    `.bot-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 16px;
            padding: 20px 0;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            margin-bottom: 16px;
        }`);
  
  // Make price-grid responsive (1 col mobile, 3 col desktop)
  html = html.replace(/\.price-grid\s*\{[^}]*\}/g,
    `.price-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 16px;
            padding-top: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }`);
  
  // Make signal-header responsive (stack on mobile, row on larger screens)
  html = html.replace(/\.signal-header\s*\{[^}]*\}/g,
    `.signal-header {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 20px;
        }`);
  
  // Make bot-header responsive
  html = html.replace(/\.bot-header\s*\{[^}]*\}/g,
    `.bot-header {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-left: 12px;
        }`);
  
  // Make signal-meta responsive
  html = html.replace(/\.signal-meta\s*\{[^}]*\}/g,
    `.signal-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 16px;
            font-size: 13px;
        }`);
  
  // Make token-info responsive
  html = html.replace(/\.token-info\s*\{[^}]*\}/g,
    `.token-info {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 12px;
        }`);
  
  // Make hero-value responsive with clamp
  html = html.replace(/\.hero-value\s*\{[^}]*font-size:[^}]*\}/g,
    `.hero-value {
            font-size: clamp(32px, 8vw, 56px);
            font-weight: 800;
            font-family: 'SF Mono', 'Courier New', monospace;
            letter-spacing: -2px;
            text-shadow: 0 0 40px rgba(16, 185, 129, 0.4);
        }`);
  
  // Make header padding responsive
  html = html.replace(/\.header\s*\{[^}]*padding:[^}]*\}/g,
    `.header {
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%);
            backdrop-filter: blur(40px);
            padding: clamp(24px, 6vw, 48px) clamp(20px, 4vw, 32px);
            text-align: center;
            border-bottom: 1px solid rgba(139, 92, 246, 0.2);
            position: relative;
            overflow: hidden;
        }`);
  
  // Make content padding responsive
  html = html.replace(/\.content\s*\{[^}]*padding:[^}]*\}/g,
    `.content {
            padding: clamp(24px, 5vw, 40px) clamp(20px, 4vw, 32px);
        }`);
  
  // Make email-container fully responsive
  html = html.replace(/\.email-container\s*\{[^}]*\}/g,
    `.email-container {
            max-width: 100%;
            width: 100%;
            margin: 0 auto;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.05);
        }`);
  
  return html;
}

/**
 * Fetch token metadata from Birdeye
 */
/**
 * Fetch token metadata for multiple tokens in batch (up to 50)
 */
/**
 * Fetch token metadata in batch from free sources
 * Uses Jupiter token list (free) and falls back to individual calls
 */
async function fetchTokenMetadataBatch(tokenAddresses: string[], chain: string = 'solana'): Promise<Map<string, { name: string; symbol: string }>> {
  const metadataMap = new Map<string, { name: string; symbol: string }>();
  
  if (tokenAddresses.length === 0) {
    return metadataMap;
  }
  
  if (chain !== 'solana') {
    // For non-Solana, return defaults
    tokenAddresses.forEach(addr => {
      metadataMap.set(addr, {
        name: `Token ${addr.substring(0, 8)}`,
        symbol: addr.substring(0, 4).toUpperCase(),
      });
    });
    return metadataMap;
  }
  
  // Step 1: Try local database for all tokens (fastest, most reliable)
  try {
    const sqlite3 = require('sqlite3');
    const { promisify } = require('util');
    const dbPath = process.env.CALLER_DB_PATH || path.join(__dirname, '../caller_alerts.db');
    
    if (fs.existsSync(dbPath)) {
      const db = new sqlite3.Database(dbPath);
      const all = promisify(db.all.bind(db));
      
      // Query all tokens at once
      const placeholders = tokenAddresses.map(() => '?').join(',');
      const rows: any[] = await all(
        `SELECT DISTINCT token_address, token_symbol 
         FROM caller_alerts 
         WHERE token_address IN (${placeholders}) 
         AND token_symbol IS NOT NULL 
         AND token_symbol != "UNKNOWN" 
         AND token_symbol != ""`,
        tokenAddresses.map(addr => addr.toLowerCase())
      );
      
      db.close();
      
      // Map results - only use if symbol is valid
      rows.forEach((row: any) => {
        const dbAddr = row.token_address.toLowerCase();
        const symbol = row.token_symbol;
        // Only use if symbol exists and is not UNKNOWN/empty
        if (symbol && symbol !== 'UNKNOWN' && symbol !== '') {
          // Match against all token addresses (handle partial matches like "pump" suffix)
          tokenAddresses.forEach(tokenAddr => {
            const tokenAddrLower = tokenAddr.toLowerCase();
            // Exact match or one contains the other (for pump.fun addresses)
            if (dbAddr === tokenAddrLower || 
                dbAddr.includes(tokenAddrLower) || 
                tokenAddrLower.includes(dbAddr)) {
              metadataMap.set(tokenAddr, {
                name: symbol, // Use symbol as name since DB doesn't have name
                symbol: symbol,
              });
            }
          });
        }
      });
    }
  } catch (error) {
    // Database lookup failed, continue
  }
  
  // Step 2: Try CSV file for remaining tokens
  const missingFromDb = tokenAddresses.filter(addr => !metadataMap.has(addr));
  if (missingFromDb.length > 0) {
    try {
      const csvPath = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
      if (fs.existsSync(csvPath)) {
        const csv = fs.readFileSync(csvPath, 'utf8');
        const records: any[] = await new Promise((resolve, reject) => {
          parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err) reject(err);
            else resolve(records);
          });
        });
        
        missingFromDb.forEach(addr => {
          const match = records.find((r: any) => {
            const rAddr = r.tokenAddress || r.token_address || '';
            const symbol = r.tokenSymbol || r.token_symbol || '';
            return rAddr.toLowerCase() === addr.toLowerCase() &&
                   symbol && symbol !== 'UNKNOWN' && symbol !== '';
          });
          
          if (match) {
            const symbol = match.tokenSymbol || match.token_symbol || '';
            const name = match.tokenName || match.token_name || symbol;
            metadataMap.set(addr, {
              name: name || `Token ${addr.substring(0, 8)}`,
              symbol: symbol,
            });
          }
        });
      }
    } catch (error) {
      // CSV lookup failed, continue
    }
  }
  
  // Step 3: Try Birdeye batch API if available for remaining tokens
  if (BIRDEYE_API_KEY) {
    const missingTokens = tokenAddresses.filter(addr => !metadataMap.has(addr));
    if (missingTokens.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < missingTokens.length; i += batchSize) {
        const batch = missingTokens.slice(i, i + batchSize);
        try {
          const addressesParam = batch.join(',');
          const response = await axios.get(
            'https://public-api.birdeye.so/defi/v3/token/meta-data/multiple',
            {
              headers: {
                'X-API-KEY': BIRDEYE_API_KEY,
                'accept': 'application/json',
                'x-chain': chain,
              },
              params: {
                addresses: addressesParam,
              },
              timeout: 5000,
            }
          );
          
          if (response.data?.success && response.data?.data) {
            const data = response.data.data;
            batch.forEach(addr => {
              if (data[addr] && !metadataMap.has(addr)) {
                metadataMap.set(addr, {
                  name: data[addr].name || `Token ${addr.substring(0, 8)}`,
                  symbol: data[addr].symbol || addr.substring(0, 4).toUpperCase(),
                });
              }
            });
          }
        } catch (error) {
          // Birdeye batch failed, continue
        }
      }
    }
  }
  
  // Step 4: Fetch remaining tokens individually (with rate limiting) - only if needed
  const remainingTokens = tokenAddresses.filter(addr => !metadataMap.has(addr));
  // Only fetch individually if we have very few remaining (to avoid slow API calls)
  if (remainingTokens.length > 0 && remainingTokens.length <= 10) {
    for (let i = 0; i < remainingTokens.length; i++) {
      const addr = remainingTokens[i];
      try {
        const metadata = await fetchTokenMetadata(addr, chain);
        metadataMap.set(addr, metadata);
        // Small delay to avoid rate limiting (50ms between calls)
        if (i < remainingTokens.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        // Fallback to default
        metadataMap.set(addr, {
          name: `Token ${addr.substring(0, 8)}`,
          symbol: addr.substring(0, 4).toUpperCase(),
        });
      }
    }
  }
  
  // Ensure all tokens have metadata (fill defaults for any still missing)
  tokenAddresses.forEach(addr => {
    if (!metadataMap.has(addr)) {
      metadataMap.set(addr, {
        name: `Token ${addr.substring(0, 8)}`,
        symbol: addr.substring(0, 4).toUpperCase(),
      });
    }
  });
  
  return metadataMap;
}

/**
 * Fetch token metadata from free sources (local DB, CSV, Solscan, Birdeye)
 */
async function fetchTokenMetadata(tokenAddress: string, chain: string = 'solana'): Promise<{ name: string; symbol: string }> {
  if (chain !== 'solana') {
    return {
      name: `Token ${tokenAddress.substring(0, 8)}`,
      symbol: tokenAddress.substring(0, 4).toUpperCase(),
    };
  }
  
  // Step 1: Try local database (caller_alerts.db)
  try {
    const sqlite3 = require('sqlite3');
    const { promisify } = require('util');
    const dbPath = process.env.CALLER_DB_PATH || path.join(__dirname, '../caller_alerts.db');
    
    if (fs.existsSync(dbPath)) {
      const db = new sqlite3.Database(dbPath);
      const get = promisify(db.get.bind(db));
      
      const row: any = await get(
        'SELECT token_symbol FROM caller_alerts WHERE token_address = ? AND token_symbol IS NOT NULL AND token_symbol != "UNKNOWN" AND token_symbol != "" LIMIT 1',
        [tokenAddress.toLowerCase()]
      );
      
      db.close();
      
      if (row && row.token_symbol) {
        return {
          name: row.token_symbol, // Use symbol as name since DB doesn't have name
          symbol: row.token_symbol,
        };
      }
    }
  } catch (error) {
    // Database lookup failed, continue
  }
  
  // Step 2: Try CSV file (all_brook_channels_calls.csv)
  try {
    const csvPath = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
    if (fs.existsSync(csvPath)) {
      const csv = fs.readFileSync(csvPath, 'utf8');
      const records: any[] = await new Promise((resolve, reject) => {
        parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
          if (err) reject(err);
          else resolve(records);
        });
      });
      
      const match = records.find((r: any) => {
        const addr = r.tokenAddress || r.token_address || '';
        const symbol = r.tokenSymbol || r.token_symbol || '';
        return addr.toLowerCase() === tokenAddress.toLowerCase() &&
               symbol && symbol !== 'UNKNOWN' && symbol !== '';
      });
      
      if (match) {
        const symbol = match.tokenSymbol || match.token_symbol || '';
        const name = match.tokenName || match.token_name || symbol;
        return {
          name: name || `Token ${tokenAddress.substring(0, 8)}`,
          symbol: symbol,
        };
      }
    }
  } catch (error) {
    // CSV lookup failed, continue
  }
  
  // Step 3: Try Solscan API (free, no auth)
  try {
    const solscanResponse = await axios.get(
      `https://api.solscan.io/token/meta?token=${tokenAddress}`,
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        validateStatus: (status) => status < 500, // Don't throw on 4xx
      }
    );
    
    // Check if response is JSON (not HTML)
    if (solscanResponse.data && typeof solscanResponse.data === 'object' && !solscanResponse.data.toString().startsWith('<!')) {
      const data = solscanResponse.data.data || solscanResponse.data;
      if (data && (data.name || data.symbol)) {
        return {
          name: data.name || `Token ${tokenAddress.substring(0, 8)}`,
          symbol: data.symbol || tokenAddress.substring(0, 4).toUpperCase(),
        };
      }
    }
  } catch (error) {
    // Solscan failed, continue to other sources
  }
  
  // Try Birdeye if API key is available
  if (BIRDEYE_API_KEY) {
    try {
      const response = await axios.get(
        'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
        {
          headers: {
            'X-API-KEY': BIRDEYE_API_KEY,
            'accept': 'application/json',
            'x-chain': chain,
          },
          params: {
            address: tokenAddress,
          },
          timeout: 5000,
        }
      );
      
      if (response.data?.success && response.data?.data) {
        const data = response.data.data;
        return {
          name: data.name || `Token ${tokenAddress.substring(0, 8)}`,
          symbol: data.symbol || tokenAddress.substring(0, 4).toUpperCase(),
        };
      }
    } catch (error) {
      // Birdeye failed, continue
    }
  }
  
  // Fallback to default
  return {
    name: `Token ${tokenAddress.substring(0, 8)}`,
    symbol: tokenAddress.substring(0, 4).toUpperCase(),
  };
}

/**
 * Fetch historical price at a specific timestamp from ClickHouse
 */
async function fetchHistoricalPrice(tokenAddress: string, timestamp: DateTime, chain: string = 'solana'): Promise<number | null> {
  try {
    // Query ClickHouse for candles around the timestamp
    const timeWindow = 3600; // 1 hour window
    const startTime = timestamp.minus({ seconds: timeWindow });
    const endTime = timestamp.plus({ seconds: timeWindow });
    
    const candles = await queryCandles(tokenAddress, chain, startTime, endTime);
    
    if (candles.length === 0) {
      return null;
    }
    
    // Find closest candle to the timestamp
    const targetTimestamp = Math.floor(timestamp.toSeconds());
    let closestCandle = candles[0];
    let minDiff = Math.abs(closestCandle.timestamp - targetTimestamp);
    
    for (const candle of candles) {
      const diff = Math.abs(candle.timestamp - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestCandle = candle;
      }
    }
    
    // Return the close price (or open if close is not available)
    // Use close price as it represents the price at the end of the candle period
    // For entry prices, we want the price at the time of entry, which is typically the close of the previous candle
    // or the open of the current candle. Since we're finding the closest candle, use close as it's more representative.
    return closestCandle.close || closestCandle.open || null;
  } catch (error) {
    // Silently fail
    return null;
  }
}


/**
 * Load weighted portfolio history CSV
 */
async function loadWeightedPortfolioHistory(): Promise<WeeklyPortfolioData[]> {
  if (!fs.existsSync(PORTFOLIO_CSV)) {
    throw new Error(`Portfolio CSV not found: ${PORTFOLIO_CSV}`);
  }
  
  const csv = fs.readFileSync(PORTFOLIO_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  const portfolioData: WeeklyPortfolioData[] = [];
  
  for (const record of records) {
    if (record.Week === 'start') continue; // Skip start row
    
    // Use Week column as the week start date (already calculated)
    const weekStart = DateTime.fromISO(record.Week);
    const date = DateTime.fromISO(record.Date);
    
    if (!weekStart.isValid || !date.isValid) continue;
    
    portfolioData.push({
      week: record.Week,
      date: weekStart, // Use week start, not the date column
      portfolioValue: parseFloat(record.PortfolioValue || '100'),
      tradesThisWeek: parseInt(record.TradesThisWeek || '0'),
      weeklyReturn: parseFloat(record.WeeklyReturn || '0'),
    });
  }
  
  return portfolioData.sort((a, b) => a.date.toMillis() - b.date.toMillis());
}

/**
 * Load chain mapping from calls CSV
 */
async function loadChainMapping(): Promise<Map<string, string>> {
  const chainMap = new Map<string, string>();
  
  if (!fs.existsSync(CALLS_CSV)) {
    console.warn(`⚠️  Calls CSV not found: ${CALLS_CSV}`);
    return chainMap;
  }
  
  const csv = fs.readFileSync(CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  for (const record of records) {
    const tokenAddress = (record.token_address || record.TokenAddress || record.mint || '').toLowerCase();
    const chain = (record.chain || record.Chain || 'solana').toLowerCase();
    
    if (tokenAddress) {
      chainMap.set(tokenAddress, chain);
    }
  }
  
  return chainMap;
}

/**
 * Load source file mapping from calls CSV
 * Maps tokenAddress+timestamp to sourceFile and channel
 */
async function loadSourceFileMapping(): Promise<Map<string, { sourceFile: string; channel: string }>> {
  const sourceMap = new Map<string, { sourceFile: string; channel: string }>();
  
  if (!fs.existsSync(CALLS_CSV)) {
    console.warn(`⚠️  Calls CSV not found: ${CALLS_CSV}`);
    return sourceMap;
  }
  
  const csv = fs.readFileSync(CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  for (const record of records) {
    const tokenAddress = (record.tokenAddress || record.token_address || '').toLowerCase();
    const timestamp = record.timestamp || record.Timestamp || '';
    const sourceFile = record.sourceFile || record.source_file || '';
    const channel = record.channel || record.Channel || '';
    
    if (tokenAddress && timestamp) {
      // Create a key from token address and timestamp (within 1 minute window)
      const timestampDate = DateTime.fromISO(timestamp);
      if (timestampDate.isValid) {
        const key = `${tokenAddress}-${timestampDate.toFormat('yyyy-MM-dd-HH-mm')}`;
        sourceMap.set(key, { sourceFile, channel });
      }
    }
  }
  
  return sourceMap;
}

// Top 5 callers for weighted portfolio
const TOP_CALLERS = [
  'Brook',
  'Brook_Giga_I_verify__BrookCalls',
  'Mistor',
  'exy',
  'meta_maxist'
];

/**
 * Load all caller trades from complete_trade_history.csv files
 * Only loads from top 5 callers and filters to Solana-only
 */
async function loadAllCallerTrades(): Promise<Trade[]> {
  const chainMap = await loadChainMapping();
  const sourceFileMap = await loadSourceFileMapping();
  const allTrades: Trade[] = [];
  
  if (!fs.existsSync(CALLER_DIR)) {
    throw new Error(`Caller directory not found: ${CALLER_DIR}`);
  }
  
  // Only process top 5 callers
  for (const callerDir of TOP_CALLERS) {
    const tradeHistoryPath = path.join(CALLER_DIR, callerDir, 'complete_trade_history.csv');
    
    if (!fs.existsSync(tradeHistoryPath)) {
      continue;
    }
    
    const csv = fs.readFileSync(tradeHistoryPath, 'utf8');
    const records: any[] = await new Promise((resolve, reject) => {
      parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
        if (err) reject(err);
        else resolve(records);
      });
    });
    
    for (const record of records) {
      const tokenAddress = (record.TokenAddress || record.tokenAddress || '').toLowerCase();
      const chain = chainMap.get(tokenAddress) || 'solana';
      
      // Filter to Solana-only
      if (chain !== 'solana') continue;
      
      const alertTime = DateTime.fromISO(record.AlertTime);
      if (!alertTime.isValid) continue;
      
      const entryTime = record.EntryTime ? DateTime.fromISO(record.EntryTime) : null;
      const exitTime = record.ExitTime ? DateTime.fromISO(record.ExitTime) : null;
      
      // Try to find source file from mapping
      const key = `${tokenAddress}-${alertTime.toFormat('yyyy-MM-dd-HH-mm')}`;
      const sourceInfo = sourceFileMap.get(key);
      
      allTrades.push({
        caller: callerDir,
        tokenAddress,
        alertTime,
        entryTime: entryTime?.isValid ? entryTime : null,
        exitTime: exitTime?.isValid ? exitTime : null,
        pnl: parseFloat(record.PnL || '1.0'),
        pnlPercent: parseFloat(record.PnLPercent || '0'),
        maxReached: parseFloat(record.MaxReached || '1.0'),
        chain,
        sourceFile: sourceInfo?.sourceFile,
        channel: sourceInfo?.channel,
      });
    }
  }
  
  // Sort by alert time
  return allTrades.sort((a, b) => a.alertTime.toMillis() - b.alertTime.toMillis());
}

/**
 * Group trades by week start date (Sunday)
 */
function groupTradesByWeek(trades: Trade[]): Map<string, Trade[]> {
  const tradesByWeek = new Map<string, Trade[]>();
  
  for (const trade of trades) {
    const weekStart = trade.alertTime.startOf('week');
    const weekKey = weekStart.toISODate() || '';
    
    if (!tradesByWeek.has(weekKey)) {
      tradesByWeek.set(weekKey, []);
    }
    tradesByWeek.get(weekKey)!.push(trade);
  }
  
  return tradesByWeek;
}

/**
 * Check if trade hit stop loss or profit targets using candles
 */
async function checkTradeStatus(
  trade: Trade,
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number }>,
  weekEnd: DateTime
): Promise<TradeStatus | null> {
  if (candles.length === 0) {
    return null; // No candles available
  }
  
  // Get entry price - use the candle closest to entry time, not just first candle
  const entryDate = trade.entryTime || trade.alertTime;
  const entryTimestamp = Math.floor(entryDate.toSeconds());
  
  // Find candle closest to entry time
  let entryCandle = candles[0];
  let minEntryDiff = Math.abs(entryCandle.timestamp - entryTimestamp);
  for (const candle of candles) {
    const diff = Math.abs(candle.timestamp - entryTimestamp);
    if (diff < minEntryDiff) {
      minEntryDiff = diff;
      entryCandle = candle;
    }
  }
  
  // Use close price of entry candle (matches fetchHistoricalPrice logic)
  // This represents the price at the end of the candle period when trade was entered
  const entryPrice = entryCandle.close || entryCandle.open;
  if (!entryPrice || entryPrice <= 0) return null;
  
  // Check if trade already exited
  if (trade.exitTime && trade.exitTime <= weekEnd) {
    // Use CSV PnL to calculate exit price: exitPrice = entryPrice * pnl
    // Entry price comes from ClickHouse, exit price is calculated from CSV PnL multiplier
    
    let exitPrice: number;
    let pnlPercent: number;
    
    // Validate entry price - if it's suspiciously low, ClickHouse data might be wrong
    if (entryPrice < 0.0001) {
      return null; // Entry price too low, likely bad data
    }
    
    // Always use CSV PnL multiplier to calculate exit price
    if (trade.pnl && trade.pnl > 0) {
      exitPrice = entryPrice * trade.pnl;
      pnlPercent = ((exitPrice / entryPrice) - 1) * 100;
    } else if (trade.pnlPercent !== undefined && trade.pnlPercent !== null) {
      // Fallback: use CSV PnLPercent
      pnlPercent = trade.pnlPercent;
      exitPrice = entryPrice * (1 + pnlPercent / 100);
    } else {
      // No PnL data, can't calculate exit price
      return null;
    }
    
    return {
      status: trade.pnl < 0.8 ? 'stopped' : trade.pnl >= 1.5 ? 'tp-hit' : 'closed',
      entryPrice,
      exitPrice,
      pnlPercent,
    };
  }
  
  // Check price movements up to week end
  const weekEndTimestamp = Math.floor(weekEnd.toSeconds());
  const relevantCandles = candles.filter(c => c.timestamp <= weekEndTimestamp);
  
  if (relevantCandles.length === 0) {
    return null;
  }
  
  // Check for stop loss (20% down)
  const stopLossPrice = entryPrice * (1 - STOP_LOSS_PERCENT);
  const hitStopLoss = relevantCandles.some(c => c.low <= stopLossPrice);
  
  if (hitStopLoss) {
    const stopCandle = relevantCandles.find(c => c.low <= stopLossPrice) || relevantCandles[relevantCandles.length - 1];
    return {
      status: 'stopped',
      entryPrice,
      exitPrice: stopLossPrice,
      pnlPercent: -STOP_LOSS_PERCENT * 100,
    };
  }
  
  // Check for profit targets
  const highestPT = Math.max(...PROFIT_TARGETS);
  const hitAllPTs = relevantCandles.some(c => c.high >= entryPrice * highestPT);
  
  if (hitAllPTs) {
    const ptCandle = relevantCandles.find(c => c.high >= entryPrice * highestPT) || relevantCandles[relevantCandles.length - 1];
    return {
      status: 'tp-hit',
      entryPrice,
      exitPrice: entryPrice * highestPT,
      pnlPercent: (highestPT - 1) * 100,
    };
  }
  
  // Check if active for full 7 days
  const tradeEntryDate = trade.entryTime || trade.alertTime;
  const daysActive = weekEnd.diff(tradeEntryDate, 'days').days;
  
  if (daysActive >= MAX_HOLD_DAYS) {
    const lastCandle = relevantCandles[relevantCandles.length - 1];
    const currentPrice = lastCandle.close;
    return {
      status: 'closed',
      entryPrice,
      exitPrice: currentPrice,
      currentPrice,
      pnlPercent: ((currentPrice / entryPrice) - 1) * 100,
    };
  }
  
  // Still active
  const lastCandle = relevantCandles[relevantCandles.length - 1];
  const currentPrice = lastCandle.close;
  
  return {
    status: 'active',
    entryPrice,
    currentPrice,
    pnlPercent: ((currentPrice / entryPrice) - 1) * 100,
  };
}

/**
 * Determine active calls for a week period
 */
async function determineActiveCalls(
  weekStart: DateTime,
  weekEnd: DateTime,
  trades: Trade[],
  previousActiveCalls: Trade[] = []
): Promise<{
  activeCalls: Array<Trade & { status: TradeStatus }>;
  closedCalls: Array<Trade & { status: TradeStatus }>;
}> {
  const activeCalls: Array<Trade & { status: TradeStatus }> = [];
  const closedCalls: Array<Trade & { status: TradeStatus }> = [];
  
  // Process trades from this week
  const weekTrades = trades.filter(t => {
    const tradeDate = t.alertTime;
    return tradeDate >= weekStart && tradeDate < weekEnd;
  });
  
  // Process previous active calls
  const allTradesToCheck = [...previousActiveCalls, ...weekTrades];
  
  for (const trade of allTradesToCheck) {
    const entryDate = trade.entryTime || trade.alertTime;
    const endDate = weekEnd;
    
    // Check if candles exist in ClickHouse
    const candlesExist = await hasCandles(trade.tokenAddress, trade.chain, entryDate, endDate);
    
    if (!candlesExist) {
      // Skip trades without ClickHouse candles
      continue;
    }
    
    // Query candles
    const candles = await queryCandles(trade.tokenAddress, trade.chain, entryDate, endDate);
    
    if (candles.length === 0) {
      continue;
    }
    
    // Check trade status
    const status = await checkTradeStatus(trade, candles, weekEnd);
    
    if (!status) {
      continue;
    }
    
    const tradeWithStatus = { ...trade, status };
    
    if (status.status === 'active') {
      // Check if it should roll over (not hit 7 day limit yet)
      const daysActive = weekEnd.diff(entryDate, 'days').days;
      if (daysActive < MAX_HOLD_DAYS) {
        activeCalls.push(tradeWithStatus);
      } else {
        closedCalls.push(tradeWithStatus);
      }
    } else {
      closedCalls.push(tradeWithStatus);
    }
  }
  
  return { activeCalls, closedCalls };
}

/**
 * Calculate weekly stats
 * Uses CSV PnL data for closed trades, ClickHouse status for active trades
 */
function calculateWeekStats(
  weekTrades: Trade[],
  closedCalls: Array<Trade & { status: TradeStatus }>,
  activeCalls: Array<Trade & { status: TradeStatus }> = [],
  csvTradesCount: number = 0
): {
  totalSignals: number;
  winRate: number;
  bigWins: number;
  active: number;
  tpHit: number;
  stopped: number;
} {
  // Use CSV count if available and higher (CSV is the source of truth)
  const totalSignals = csvTradesCount > 0 ? csvTradesCount : weekTrades.length;
  
  // Active calls (from ClickHouse check)
  const active = activeCalls.filter(t => t.status.status === 'active').length;
  
  // Count TP hits and stopped from ClickHouse status (for active/closed calls)
  // This matches what's shown in the top signals
  let tpHit = 0;
  let stopped = 0;
  
  // Count from active calls
  activeCalls.forEach(t => {
    if (t.status.status === 'tp-hit') tpHit++;
    if (t.status.status === 'stopped') stopped++;
  });
  
  // Count from closed calls
  closedCalls.forEach(t => {
    if (t.status.status === 'tp-hit') tpHit++;
    if (t.status.status === 'stopped') stopped++;
  });
  
  // For trades without ClickHouse status, use CSV PnL data
  const tradesWithStatus = new Set([
    ...activeCalls.map(t => `${t.tokenAddress}-${t.alertTime.toISO()}`),
    ...closedCalls.map(t => `${t.tokenAddress}-${t.alertTime.toISO()}`)
  ]);
  
  weekTrades.forEach(t => {
    const key = `${t.tokenAddress}-${t.alertTime.toISO()}`;
    if (!tradesWithStatus.has(key)) {
      // No ClickHouse status, use CSV PnL
      if (t.pnl >= 1.5) tpHit++;
      if (t.pnl < 0.8) stopped++;
    }
  });
  
  // Calculate stats from CSV PnL data for ALL trades
  const winners = weekTrades.filter(t => t.pnl > 1.0).length;
  const bigWins = weekTrades.filter(t => t.pnl >= 2.0).length; // 2x or more
  const winRate = totalSignals > 0 ? (winners / totalSignals) * 100 : 0;
  
  return {
    totalSignals,
    winRate: Math.round(winRate),
    bigWins,
    active,
    tpHit,
    stopped,
  };
}

/**
 * Generate HTML report for a week
 */
async function generateReport(
  template: string,
  weekData: WeeklyPortfolioData,
  weekTrades: Array<Trade & { status?: TradeStatus; metadata?: { name: string; symbol: string }; entryPrice?: number }>,
  activeCalls: Array<Trade & { status: TradeStatus }>,
  closedCalls: Array<Trade & { status: TradeStatus }>,
  stats: ReturnType<typeof calculateWeekStats>,
  allPortfolioData: WeeklyPortfolioData[]
): Promise<string> {
  let html = template;
  
  // Week range - use the date from CSV directly
  const weekStart = weekData.date.startOf('day');
  const weekEnd = weekStart.plus({ days: 6 }).endOf('day');
  const weekRange = `${weekStart.toFormat('MMM dd')} - ${weekEnd.toFormat('MMM dd')}, ${weekEnd.toFormat('yyyy')}`;
  
  // Replace header
  html = html.replace(
    /Weekly Performance Summary • [^<]+/,
    `Weekly Performance Summary • ${weekRange}`
  );
  
  // Replace hero P&L
  const pnlClass = weekData.weeklyReturn >= 0 ? 'positive' : 'negative';
  const pnlSign = weekData.weeklyReturn >= 0 ? '+' : '';
  html = html.replace(
    /<div class="hero-value[^"]*">[^<]+<\/div>/,
    `<div class="hero-value ${pnlClass}">${pnlSign}${weekData.weeklyReturn.toFixed(2)}%</div>`
  );
  
  // Replace stats
  html = html.replace(
    /<div class="stat-value" style="color: #8b5cf6;">\d+<\/div>\s*<div class="stat-label">Total Signals<\/div>/,
    `<div class="stat-value" style="color: #8b5cf6;">${stats.totalSignals}</div>
                    <div class="stat-label">Total Signals</div>`
  );
  
  html = html.replace(
    /<div class="stat-value" style="color: #10b981;">\d+%<\/div>\s*<div class="stat-label">Win Rate<\/div>/,
    `<div class="stat-value" style="color: #10b981;">${stats.winRate}%</div>
                    <div class="stat-label">Win Rate</div>`
  );
  
  html = html.replace(
    /<div class="stat-value" style="color: #06b6d4;">\d+<\/div>\s*<div class="stat-label">Big Wins<\/div>/,
    `<div class="stat-value" style="color: #06b6d4;">${stats.bigWins}</div>
                    <div class="stat-label">Big Wins</div>`
  );
  
  // Replace status breakdown
  html = html.replace(
    /<div class="outcome-count">\d+<\/div>\s*<div class="outcome-label">Active<\/div>/,
    `<div class="outcome-count">${stats.active}</div>
                        <div class="outcome-label">Active</div>`
  );
  
  html = html.replace(
    /<div class="outcome-count">\d+<\/div>\s*<div class="outcome-label">TP Hit<\/div>/,
    `<div class="outcome-count">${stats.tpHit}</div>
                        <div class="outcome-label">TP Hit</div>`
  );
  
  html = html.replace(
    /<div class="outcome-count">\d+<\/div>\s*<div class="outcome-label">Stopped Out<\/div>/,
    `<div class="outcome-count">${stats.stopped}</div>
                        <div class="outcome-label">Stopped Out</div>`
  );
  
  // Get top signals (sorted by PnL) - use CSV PnL data
  const allSignals = weekTrades
    .map(t => {
      // Use ClickHouse status if available, otherwise use CSV data
      const active = activeCalls.find(a => 
        a.tokenAddress === t.tokenAddress && a.alertTime.equals(t.alertTime)
      );
      const closed = closedCalls.find(c => 
        c.tokenAddress === t.tokenAddress && c.alertTime.equals(t.alertTime)
      );
      
      if (active) {
        return {
          ...t,
          status: active.status,
          pnlPercent: active.status.pnlPercent,
          entryPrice: active.status.entryPrice,
          exitPrice: active.status.exitPrice,
          currentPrice: active.status.currentPrice,
        };
      }
      
      if (closed) {
        return {
          ...t,
          status: closed.status,
          pnlPercent: closed.status.pnlPercent,
          entryPrice: closed.status.entryPrice,
          exitPrice: closed.status.exitPrice,
        };
      }
      
      // Use CSV data
      return {
        ...t,
        status: t.exitTime ? {
          status: t.pnl < 0.8 ? 'stopped' : t.pnl >= 1.5 ? 'tp-hit' : 'closed',
          entryPrice: 0,
          exitPrice: 0,
          pnlPercent: t.pnlPercent,
        } : undefined,
        pnlPercent: t.pnlPercent,
        entryPrice: 0,
        exitPrice: 0,
      };
    })
    .filter(t => t.status); // Only include trades with status
  
  // Get top 3 signals (sorted by PnL)
  const topSignals = allSignals
    .sort((a, b) => (b.pnlPercent || 0) - (a.pnlPercent || 0))
    .slice(0, 3);
  
  // Batch fetch metadata for all top signals
  const uniqueTokenAddresses = [...new Set(topSignals.map(s => s.tokenAddress))];
  const metadataMap = await fetchTokenMetadataBatch(uniqueTokenAddresses, 'solana');
  
  // Fetch entry prices and calculate exit prices for top signals
  for (const signal of topSignals) {
    // Use batch metadata
    signal.metadata = metadataMap.get(signal.tokenAddress) || {
      name: `Token ${signal.tokenAddress.substring(0, 8)}`,
      symbol: signal.tokenAddress.substring(0, 4).toUpperCase(),
    };
    
    // Fetch entry price from ClickHouse if not already set
    // Prioritize ClickHouse entry price from status (most accurate)
    if (signal.status && signal.status.entryPrice > 0) {
      signal.entryPrice = signal.status.entryPrice;
    } else if (!signal.entryPrice || signal.entryPrice === 0) {
      const entryTime = signal.entryTime || signal.alertTime;
      signal.entryPrice = await fetchHistoricalPrice(signal.tokenAddress, entryTime, signal.chain) || 0;
      // Update status entry price if we fetched it
      if (signal.entryPrice > 0 && signal.status) {
        signal.status.entryPrice = signal.entryPrice;
      }
    }
    
    // Always calculate exit price from CSV PnL: exitPrice = entryPrice * pnl
    // Entry price comes from ClickHouse, exit price is always calculated from CSV PnL
    if (signal.entryPrice > 0 && signal.status) {
      // For active trades, we still calculate from CSV PnL, but also keep currentPrice for reference
      if (signal.status.status === 'active' && (signal.status as any).currentPrice) {
        // Keep currentPrice for active trades, but also calculate exit price from CSV PnL
        if ((signal as any).pnl && (signal as any).pnl > 0) {
          signal.status.exitPrice = signal.entryPrice * (signal as any).pnl;
        }
      } else {
        // For closed trades, always calculate from CSV PnL
        if ((signal as any).pnl && (signal as any).pnl > 0) {
          signal.status.exitPrice = signal.entryPrice * (signal as any).pnl;
        } else if (signal.pnlPercent !== undefined) {
          signal.status.exitPrice = signal.entryPrice * (1 + signal.pnlPercent / 100);
        }
      }
    }
  }
  
  // Replace top signals section (only 3)
  const signalCards = html.match(/<!-- Signal \d+[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) || [];
  
  for (let i = 0; i < Math.min(topSignals.length, signalCards.length); i++) {
    const signal = topSignals[i];
    if (!signal.status) continue;
    
    const pnlPercent = signal.pnlPercent || 0;
    const isWin = pnlPercent > 0;
    const isBigWin = pnlPercent >= 100; // 2x or more
    
    // Format PnL display
    let displayPnl: string;
    if (isBigWin) {
      const multiplier = (pnlPercent / 100) + 1;
      displayPnl = `+${multiplier.toFixed(1)}x 🏆`;
    } else {
      displayPnl = `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%${isWin ? ' 🏆' : ''}`;
    }
    
    const tokenAddress = signal.tokenAddress;
    const tokenSymbol = signal.metadata?.symbol || tokenAddress.substring(0, 4).toUpperCase();
    const tokenName = signal.metadata?.name || `Token ${tokenAddress.substring(0, 8)}`;
    const shortAddress = `${tokenAddress.substring(0, 8)}...${tokenAddress.substring(tokenAddress.length - 6)}`;
    
    // Determine status badge
    let statusBadge: string;
    if (signal.status.status === 'active') {
      statusBadge = '<span class="status-badge active">ACTIVE</span>';
    } else if (signal.status.status === 'tp-hit') {
      statusBadge = '<span class="status-badge tp-hit">✓ TP HIT</span>';
    } else if (signal.status.status === 'stopped') {
      statusBadge = '<span class="status-badge stopped">✕ STOPPED</span>';
    } else {
      statusBadge = isWin 
        ? '<span class="status-badge tp-hit">✓ TP HIT</span>'
        : '<span class="status-badge stopped">✕ STOPPED</span>';
    }
    
    const signalCard = signalCards[i];
    const tokenInfoHtml = `
                        <div class="token-name">${tokenSymbol}</div>
                        <div style="font-size: 14px; color: #cbd5e1; font-weight: 500; margin-top: 4px;">${tokenName}</div>
                        <div style="font-size: 11px; color: #64748b; font-family: 'SF Mono', monospace; margin-top: 2px;">${shortAddress}</div>
    `.trim();
    
    const performanceBadgeClass = isBigWin ? 'big-win' : isWin ? 'win' : 'loss';
    
    // Format prices - entry price from ClickHouse, exit price from CSV PnL
    // Always calculate exit price as: exitPrice = entryPrice * pnl
    let entryPrice = signal.entryPrice || signal.status?.entryPrice || 0;
    let exitPrice = 0;
    
    // Always calculate exit price from CSV PnL
    if (entryPrice > 0) {
      if ((signal as any).pnl && (signal as any).pnl > 0) {
        exitPrice = entryPrice * (signal as any).pnl;
      } else if (signal.pnlPercent !== undefined) {
        exitPrice = entryPrice * (1 + signal.pnlPercent / 100);
      } else {
        // No PnL data, can't calculate exit price
        exitPrice = 0;
      }
    }
    
    // For active trades, also show current price if available (but exit price is still from CSV PnL)
    const currentPrice = signal.status?.status === 'active' ? (signal.status as any)?.currentPrice : undefined;
    
    // Format prices for display
    const entryPriceFormatted = entryPrice > 0 ? `$${entryPrice.toFixed(6)}` : 'N/A';
    const exitPriceFormatted = exitPrice > 0 ? `$${exitPrice.toFixed(6)}` : 'N/A';
    
    // Use CSV PnL for display (it's the source of truth)
    const displayPnlPercent = signal.pnlPercent || 0;
    
    // Fix token-info replacement - need to match nested divs properly
    // First, remove any duplicate token-info divs that might exist
    let cleanedCard = signalCard.replace(/<div class="token-info">[\s\S]*?<\/div>\s*(<div class="token-info">[\s\S]*?<\/div>)/g, '<div class="token-info">PLACEHOLDER</div>');
    
    // Now replace the token-info div
    const newSignalCard = cleanedCard
      .replace(/<div class="token-info">[\s\S]*?<\/div>/m, `<div class="token-info">${tokenInfoHtml}</div>`)
      .replace(/PLACEHOLDER/g, '') // Remove placeholder
      .replace(/<span class="chain-badge">[^<]+<\/span>/, '<span class="chain-badge">SOL</span>')
      .replace(/<div class="performance-badge[^"]*">[^<]+<\/div>/, 
        `<div class="performance-badge ${performanceBadgeClass}">${displayPnl}</div>`)
      .replace(/🤖 <strong>[^<]+<\/strong>/, `🤖 <strong>${signal.caller}</strong>`)
      .replace(/<span class="status-badge[^"]*">[^<]+<\/span>/, statusBadge)
      .replace(/📅 [^<]+/, `📅 ${signal.alertTime.toFormat('yyyy-MM-dd')}`)
      .replace(/⏱ <strong>[^<]+<\/strong>/, `⏱ <strong>${signal.maxReached.toFixed(1)}x</strong> max ${signal.status.status === 'active' ? 'active' : 'hold'}`)
      .replace(/max hold max hold/g, 'max hold') // Fix duplicate
      .replace(/<div class="price-label">Entry Price<\/div>\s*<div class="price-value">[^<]+<\/div>/, 
        `<div class="price-label">Entry Price</div>
                            <div class="price-value">${entryPriceFormatted}</div>`)
      .replace(/<div class="price-label">Exit Price<\/div>\s*<div class="price-value[^"]*">[^<]+<\/div>/, 
        `<div class="price-label">${signal.status.status === 'active' ? 'Current Price' : 'Exit Price'}</div>
                            <div class="price-value" style="color: ${displayPnlPercent >= 0 ? '#10b981' : '#ef4444'};">${exitPriceFormatted}</div>`)
      .replace(/<div class="price-label">(Realized|Unrealized) P&L<\/div>\s*<div class="price-value[^"]*">[^<]+<\/div>/, 
        `<div class="price-label">${signal.status.status === 'active' ? 'Unrealized' : 'Realized'} P&L</div>
                            <div class="price-value" style="color: ${displayPnlPercent >= 0 ? '#10b981' : '#ef4444'};">${displayPnl}</div>`);
    
    html = html.replace(signalCards[i], newSignalCard);
  }
  
  // Remove unused signal cards (keep only 3)
  if (topSignals.length < signalCards.length) {
    for (let i = topSignals.length; i < signalCards.length; i++) {
      html = html.replace(signalCards[i], '');
    }
  }
  
  // Add weekly P&L datatable before Top Signals section
  const currentWeekIndex = allPortfolioData.findIndex(w => w.week === weekData.week);
  const weeksUpToNow = allPortfolioData.slice(0, currentWeekIndex + 1);
  
  let cumulativePnl = 0;
  const weeklyPnlTableRows = weeksUpToNow.map(w => {
    cumulativePnl += w.weeklyReturn;
    return `
            <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <td style="padding: 12px; text-align: left; color: #cbd5e1;">${w.date.toFormat('MMM dd, yyyy')}</td>
                <td style="padding: 12px; text-align: right; color: ${w.weeklyReturn >= 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">${w.weeklyReturn >= 0 ? '+' : ''}${w.weeklyReturn.toFixed(2)}%</td>
                <td style="padding: 12px; text-align: right; color: ${cumulativePnl >= 0 ? '#10b981' : '#ef4444'}; font-weight: 700;">${cumulativePnl >= 0 ? '+' : ''}${cumulativePnl.toFixed(2)}%</td>
            </tr>
        `;
  }).join('');
  
  const weeklyPnlTable = `
        <div class="section">
            <div class="section-header">
                <span class="section-icon">📈</span>
                <h2 class="section-title">Weekly P&L History</h2>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; background: rgba(30, 41, 59, 0.5); border-radius: 12px; overflow: hidden;">
                    <thead>
                        <tr style="background: rgba(51, 65, 85, 0.6);">
                            <th style="padding: 16px; text-align: left; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Week</th>
                            <th style="padding: 16px; text-align: right; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Weekly P&L</th>
                            <th style="padding: 16px; text-align: right; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Cumulative P&L</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${weeklyPnlTableRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
  
  // Insert weekly P&L table before Top Signals section
  // Find the section div that contains "Top Signals This Week"
  const topSignalsSectionMatch = html.match(/(<div class="section">[\s\S]*?<h2 class="section-title">Top Signals This Week<\/h2>)/);
  if (topSignalsSectionMatch) {
    html = html.replace(topSignalsSectionMatch[0], `${weeklyPnlTable}\n            ${topSignalsSectionMatch[0]}`);
  } else {
    // Fallback: insert before <!-- Top Signals --> comment
    html = html.replace(/<!-- Top Signals -->/, `${weeklyPnlTable}\n            <!-- Top Signals -->`);
  }
  
  // Add all trades list after Top Signals section
  // Batch fetch metadata for all trades
  const allTradeAddresses = [...new Set(weekTrades.map(t => t.tokenAddress))];
  const allTradesMetadataMap = await fetchTokenMetadataBatch(allTradeAddresses, 'solana');
  
  // Fetch metadata and entry prices for all trades
  const allTradesWithMetadata = await Promise.all(weekTrades.map(async (trade) => {
    const metadata = allTradesMetadataMap.get(trade.tokenAddress) || {
      name: `Token ${trade.tokenAddress.substring(0, 8)}`,
      symbol: trade.tokenAddress.substring(0, 4).toUpperCase(),
    };
    const entryTime = trade.entryTime || trade.alertTime;
    const entryPrice = await fetchHistoricalPrice(trade.tokenAddress, entryTime, trade.chain) || 0;
    
    // Determine status
    let tradeStatus: string;
    let daysActive: number | null = null;
    
    if (trade.exitTime) {
      tradeStatus = trade.pnl < 0.8 ? 'SL Hit' : trade.pnl >= 1.5 ? 'TP Hit' : 'Closed';
    } else {
      const active = activeCalls.find(a => 
        a.tokenAddress === trade.tokenAddress && a.alertTime.equals(trade.alertTime)
      );
      if (active) {
        daysActive = Math.floor(weekEnd.diff(entryTime, 'days').days);
        tradeStatus = `Active ${daysActive}d`;
      } else {
        tradeStatus = 'Closed';
      }
    }
    
    return {
      ...trade,
      metadata,
      entryPrice,
      tradeStatus,
      daysActive,
    };
  }));
  
  const allTradesRows = allTradesWithMetadata.map(trade => {
    const pnlPercent = trade.pnlPercent;
    const pnlColor = pnlPercent >= 0 ? '#10b981' : '#ef4444';
    const statusColor = trade.tradeStatus === 'TP Hit' ? '#10b981' : 
                       trade.tradeStatus === 'SL Hit' ? '#ef4444' : 
                       trade.tradeStatus.startsWith('Active') ? '#3b82f6' : '#94a3b8';
    
    return `
            <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                <td style="padding: 12px; text-align: left;">
                    <div style="font-weight: 700; color: #f8fafc;">${trade.metadata.symbol}</div>
                    <div style="font-size: 11px; color: #64748b; font-family: 'SF Mono', monospace;">${trade.tokenAddress.substring(0, 8)}...${trade.tokenAddress.substring(trade.tokenAddress.length - 6)}</div>
                </td>
                <td style="padding: 12px; text-align: left; color: #cbd5e1; font-size: 12px;">${trade.alertTime.toFormat('MMM dd, HH:mm')}</td>
                <td style="padding: 12px; text-align: center;">
                    <span style="padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; background: rgba(71, 85, 105, 0.4); color: ${statusColor}; border: 1px solid ${statusColor}40;">${trade.tradeStatus}</span>
                </td>
                <td style="padding: 12px; text-align: right; color: ${pnlColor}; font-weight: 700; font-family: 'SF Mono', monospace;">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%</td>
            </tr>
        `;
  }).join('');
  
  const allTradesTable = `
        <div class="section">
            <div class="section-header">
                <span class="section-icon">📋</span>
                <h2 class="section-title">All Trades This Week</h2>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; background: rgba(30, 41, 59, 0.5); border-radius: 12px; overflow: hidden;">
                    <thead>
                        <tr style="background: rgba(51, 65, 85, 0.6);">
                            <th style="padding: 16px; text-align: left; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Token</th>
                            <th style="padding: 16px; text-align: left; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Alert Time</th>
                            <th style="padding: 16px; text-align: center; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Status</th>
                            <th style="padding: 16px; text-align: right; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">P&L %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allTradesRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
  
  // Insert all trades table after Top Signals section
  const topSignalsEnd = html.indexOf('<!-- Insights -->');
  if (topSignalsEnd > 0) {
    html = html.slice(0, topSignalsEnd) + allTradesTable + html.slice(topSignalsEnd);
  }
  
  // Remove bot performance section (not relevant for weighted portfolio)
  const botPerformanceSection = html.match(/<!-- Bot Performance -->[\s\S]*?<!-- Top Signals -->/);
  if (botPerformanceSection) {
    html = html.replace(botPerformanceSection[0], '<!-- Top Signals -->');
  }
  
  // Update footer date
  html = html.replace(
    /Data current as of [^<]+<br>/,
    `Data current as of ${weekEnd.toFormat('MMMM dd, yyyy')} at 11:59 PM UTC<br>`
  );
  
  return html;
}

/**
 * Main function
 */
async function main() {
  console.log('📊 Generating Weekly Portfolio Reports\n');
  
  // Load template
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template not found: ${TEMPLATE_PATH}`);
  }
  
  let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  template = fixTemplateMobileStyles(template);
  
  // Load portfolio data
  console.log('📂 Loading portfolio history...');
  const portfolioData = await loadWeightedPortfolioHistory();
  console.log(`   Loaded ${portfolioData.length} weeks\n`);
  
  // Load all trades
  console.log('📂 Loading caller trades...');
  const allTrades = await loadAllCallerTrades();
  console.log(`   Loaded ${allTrades.length} Solana trades\n`);
  
  // Group trades by week
  const tradesByWeek = groupTradesByWeek(allTrades);
  
  // Filter to September - November 2025
  const startDate = DateTime.fromISO('2025-09-01');
  const endDate = DateTime.fromISO('2025-11-30');
  
  const filteredWeeks = portfolioData.filter(w => {
    const weekStart = w.date.startOf('week');
    return weekStart >= startDate && weekStart <= endDate;
  });
  
  console.log(`📅 Generating reports for ${filteredWeeks.length} weeks (Sep - Nov 2025)\n`);
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Track active calls across weeks
  let previousActiveCalls: Trade[] = [];
  
  // Generate report for each week
  for (const weekData of filteredWeeks) {
    // Use the week start date directly from CSV (already calculated)
    const weekStart = weekData.date.startOf('day');
    const weekEnd = weekStart.plus({ days: 6 }).endOf('day'); // End of week (7 days)
    const weekKey = weekStart.toISODate() || '';
    
    const weekTrades = tradesByWeek.get(weekKey) || [];
    
    console.log(`📝 Processing week ${weekStart.toFormat('yyyy-MM-dd')}...`);
    
    // Determine active calls
    const { activeCalls, closedCalls } = await determineActiveCalls(
      weekStart,
      weekEnd,
      weekTrades,
      previousActiveCalls
    );
    
    // Update previous active calls for next week (only truly active ones)
    previousActiveCalls = activeCalls
      .filter(t => t.status.status === 'active')
      .map(t => ({
        caller: t.caller,
        tokenAddress: t.tokenAddress,
        alertTime: t.alertTime,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        pnl: t.pnl,
        pnlPercent: t.pnlPercent,
        maxReached: t.maxReached,
        chain: t.chain,
      }));
    
    // Calculate stats using CSV data (not just ClickHouse status)
    // Use CSV TradesThisWeek count as source of truth
    const stats = calculateWeekStats(weekTrades, closedCalls, activeCalls, weekData.tradesThisWeek);
    
    // Add status to week trades for display - use CSV PnL for closed trades, ClickHouse for active
    const weekTradesWithStatus = weekTrades.map(trade => {
      // Check if trade is active (from ClickHouse)
      const active = activeCalls.find(a => 
        a.tokenAddress === trade.tokenAddress && 
        a.alertTime.equals(trade.alertTime)
      );
      
      if (active) {
        return { ...trade, status: active.status };
      }
      
      // Check if trade is closed (from ClickHouse)
      const closed = closedCalls.find(c => 
        c.tokenAddress === trade.tokenAddress && 
        c.alertTime.equals(trade.alertTime)
      );
      
      if (closed) {
        return { ...trade, status: closed.status };
      }
      
      // Use CSV PnL data to determine status for closed trades
      if (trade.exitTime !== null) {
        const status: TradeStatus = {
          status: trade.pnl < 0.8 ? 'stopped' : trade.pnl >= 1.5 ? 'tp-hit' : 'closed',
          entryPrice: 0, // We don't have entry price from CSV
          exitPrice: 0,
          pnlPercent: trade.pnlPercent,
        };
        return { ...trade, status };
      }
      
      return { ...trade };
    });
    
    // Generate report (async - fetches metadata and prices)
    const reportHtml = await generateReport(
      template,
      weekData,
      weekTradesWithStatus,
      activeCalls,
      closedCalls,
      stats,
      portfolioData
    );
    
    // Save report
    const outputPath = path.join(OUTPUT_DIR, `weekly-report-${weekStart.toFormat('yyyy-MM-dd')}.html`);
    fs.writeFileSync(outputPath, reportHtml, 'utf8');
    
    console.log(`   ✅ Generated: ${outputPath}`);
    console.log(`   📊 Stats: ${stats.totalSignals} signals, ${stats.winRate}% win rate, ${stats.active} active\n`);
  }
  
  console.log(`\n✨ Generated ${filteredWeeks.length} weekly reports in ${OUTPUT_DIR}`);
}

if (require.main === module) {
  main().catch(console.error);
}

