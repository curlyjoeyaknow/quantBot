import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');

interface TradeResult {
  timestamp: DateTime;
  pnl: number;
  address: string;
  fullAddress?: string; // Full address for CSV
  tokenSymbol?: string; // Token symbol from metadata
  tokenName?: string; // Token name from metadata
  chain?: string; // Chain (solana, ethereum, bsc, etc.)
  maxReached: number;
  holdDuration?: number; // Duration in minutes
  timeToAth?: number; // Time to ATH in minutes
}

/**
 * Improved strategy: Profit targets for moonshots, 30% trailing stop AFTER 3x
 * Caps losses at 40% maximum (0.6x minimum PNL) - applies to all exits including re-entries
 */
function simulateStrategy(
  candles: any[],
  strategy: any[]
): { pnl: number, maxReached: number, holdDuration: number, timeToAth: number } {
  
  const entryPrice = candles[0].close;
  // Get entry time - handle both timestamp formats
  const firstCandle = candles[0];
  const entryTime = firstCandle.timestamp 
    ? (typeof firstCandle.timestamp === 'number' ? firstCandle.timestamp : new Date(firstCandle.timestamp).getTime())
    : (firstCandle.time ? (typeof firstCandle.time === 'number' ? firstCandle.time : new Date(firstCandle.time).getTime()) : Date.now());
  
  const trailingStopPercent = 0.30; // 30% trailing stop (looser for bigger runs) AFTER 3x
  const trailingStopActivation = 3; // Activate trailing stop after 3x (not 2x)
  const minExitPrice = entryPrice * 0.6; // Cap losses at 40% maximum (minimum 60% of entry)
  
  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = entryPrice;
  let maxReached = 1.0;
  let athTime = entryTime; // Time when ATH was reached
  let exitTime = entryTime; // Time when we exited
  let exited = false;
  let exitedViaTrailingStop = false; // Track if we exited via trailing stop (not final exit)
  
  // Track which targets we've hit
  const targetsHit = new Set<number>();
  
  for (const candle of candles) {
    // Get candle time - handle both timestamp formats
    const candleTime = candle.timestamp 
      ? (typeof candle.timestamp === 'number' ? candle.timestamp : new Date(candle.timestamp).getTime())
      : (candle.time ? (typeof candle.time === 'number' ? candle.time : new Date(candle.time).getTime()) : entryTime);
    
    // Track max reached and ATH time
    const currentMultiplier = candle.high / entryPrice;
    if (currentMultiplier > maxReached) {
      maxReached = currentMultiplier;
      athTime = candleTime;
    }
    
    // Update highest price for trailing stop - track highest EVER (like maxReached)
    // This ensures trailing stop uses the peak price, not just current position's high
    if (candle.high > highestPrice) {
      highestPrice = candle.high;
    }
    
    // Check each profit target in order
    for (const target of strategy) {
      const targetPrice = entryPrice * target.target;
      
      // Only check if we haven't hit this target yet and we have remaining position
      if (!targetsHit.has(target.target) && remaining > 0 && candle.high >= targetPrice) {
        const sellPercent = Math.min(target.percent, remaining);
        pnl += sellPercent * target.target;
        remaining -= sellPercent;
        targetsHit.add(target.target);
      }
    }
    
    // Trailing stop logic: ONLY AFTER reaching activation level (3x)
    // Activate when 3x target is hit OR when price reaches 3x (whichever comes first)
    // This works with profit targets (targetsHit.has(3)) or without (maxReached >= 3)
    if (remaining > 0 && (targetsHit.has(trailingStopActivation) || maxReached >= trailingStopActivation)) {
      // After activation: use 30% trailing stop from highest price (looser for bigger runs)
      const trailingStopPrice = highestPrice * (1 - trailingStopPercent);
      
      // Ensure we never exit below minimum (prevent -98% losses)
      const actualStopPrice = Math.max(trailingStopPrice, minExitPrice);
      
      if (candle.low <= actualStopPrice) {
        pnl += remaining * (actualStopPrice / entryPrice);
        remaining = 0;
        exitTime = candleTime;
        exited = true;
        exitedViaTrailingStop = true; // Mark that we exited via trailing stop
        break;
      }
    }
  }
  
  // Final exit if still holding
  if (remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    const lastCandle = candles[candles.length - 1];
    const finalCandleTime = lastCandle.timestamp 
      ? (typeof lastCandle.timestamp === 'number' ? lastCandle.timestamp : new Date(lastCandle.timestamp).getTime())
      : (lastCandle.time ? (typeof lastCandle.time === 'number' ? lastCandle.time : new Date(lastCandle.time).getTime()) : entryTime);
    
    // Cap losses at 40% maximum (minimum 60% of entry)
    const exitPrice = Math.max(finalPrice, minExitPrice);
    
    pnl += remaining * (exitPrice / entryPrice);
    exitTime = finalCandleTime;
    exited = true;
  }
  
  // Final safety check: cap losses at 40% maximum (minimum 60% of entry, so 0.6x PNL)
  // BUT: Don't override trailing stop exits - if we exited via trailing stop, trust that price
  const totalPnlMultiplier = pnl;
  if (totalPnlMultiplier < 0.6 && !exitedViaTrailingStop) {
    // Only cap if we didn't exit via trailing stop
    // If trailing stop triggered, it already calculated the correct exit price
    pnl = 0.6;
  }
  
  // Calculate duration and time to ATH in minutes
  // Timestamps are in Unix SECONDS (not milliseconds), so divide by 60 to get minutes
  const holdDurationMinutes = exited ? Math.max(0, Math.floor((exitTime - entryTime) / 60)) : 0;
  const timeToAthMinutes = Math.max(0, Math.floor((athTime - entryTime) / 60));
  
  return { pnl, maxReached, holdDuration: holdDurationMinutes, timeToAth: timeToAthMinutes };
}

function getWeekStart(date: DateTime): DateTime {
  const dayOfWeek = date.weekday; // 1 = Monday, 7 = Sunday
  const daysFromSunday = dayOfWeek === 7 ? 0 : dayOfWeek;
  return date.minus({ days: daysFromSunday }).startOf('day');
}

interface CallerResults {
  callerName: string;
  tradeHistory: any[];
  weeklyBreakdown: any[];
  finalPortfolio: number;
  totalTrades: number;
}

async function calculatePortfolioPNLForCaller(callerName: string, callerFilter: (r: any) => boolean): Promise<CallerResults> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`💰 PORTFOLIO ANALYSIS: ${callerName.toUpperCase()}`);
  console.log(`${'='.repeat(80)}\n`);

  // Read calls
  console.log(`📂 Reading CSV file: ${BROOK_CALLS_CSV}`);
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  console.log(`✅ CSV file read, size: ${(csv.length / 1024).toFixed(2)} KB`);
  
  console.log(`📊 Parsing CSV records...`);
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) {
        console.error(`❌ Error parsing CSV:`, err);
        reject(err);
      } else {
        console.log(`✅ Parsed ${records.length} total records from CSV`);
        resolve(records);
      }
    });
  });
  
  // Build metadata map - first from database, then CSV, then Birdeye
  console.log(`🔍 Building metadata map...`);
  const metadataFromCSV = new Map<string, { symbol?: string; name?: string }>();
  
  // Try database first (has more complete metadata from Rick/Phanes)
  console.log(`📋 Attempting to load metadata from database...`);
  try {
    const { Database } = require('sqlite3');
    const { promisify } = require('util');
    const dbPath = process.env.CALLER_DB_PATH || path.join(__dirname, '../caller_alerts.db');
    console.log(`   Database path: ${dbPath}`);
    const db = new Database(dbPath);
    const all = promisify(db.all.bind(db));
    
    console.log(`   Querying database for token metadata...`);
    const dbRecords: any[] = await all(
      'SELECT DISTINCT token_address, token_symbol, token_name FROM caller_alerts WHERE token_symbol IS NOT NULL AND token_symbol != "UNKNOWN" AND token_symbol != ""'
    );
    console.log(`   Found ${dbRecords.length} records in database`);
    
    dbRecords.forEach((r: any) => {
      if (r.token_address && r.token_symbol) {
        metadataFromCSV.set(r.token_address.toLowerCase(), {
          symbol: r.token_symbol,
          name: r.token_name || undefined
        });
      }
    });
    
    db.close();
    console.log(`✅ Loaded ${metadataFromCSV.size} tokens with metadata from database`);
  } catch (error: any) {
    console.warn(`⚠️ Could not load metadata from database: ${error.message}`);
    console.warn(`   Continuing with CSV metadata only...`);
  }
  
  // Also add from CSV (for any missing)
  console.log(`📋 Adding metadata from CSV records...`);
  let csvMetadataAdded = 0;
  (records as any[]).forEach((r: any) => {
    if (r.tokenAddress && r.tokenSymbol && r.tokenSymbol !== 'UNKNOWN' && !metadataFromCSV.has(r.tokenAddress.toLowerCase())) {
      metadataFromCSV.set(r.tokenAddress.toLowerCase(), {
        symbol: r.tokenSymbol,
        name: r.tokenName || undefined
      });
      csvMetadataAdded++;
    }
  });
  console.log(`✅ Added ${csvMetadataAdded} additional tokens from CSV metadata`);
  
  // Collect unique token addresses that need Birdeye metadata
  console.log(`🔍 Collecting tokens that need Birdeye metadata...`);
  const tokensNeedingMetadata = new Set<string>();
  (records as any[]).forEach((r: any) => {
    if (r.tokenAddress && callerFilter(r)) {
      const key = r.tokenAddress.toLowerCase();
      if (!metadataFromCSV.has(key) || !metadataFromCSV.get(key)?.name) {
        tokensNeedingMetadata.add(r.tokenAddress);
      }
    }
  });
  console.log(`   Found ${tokensNeedingMetadata.size} tokens needing metadata`);
  
  // Fetch metadata from Birdeye for missing tokens
  if (tokensNeedingMetadata.size > 0) {
    // Skip Birdeye metadata fetch if USE_CACHE_ONLY is set
    if (process.env.USE_CACHE_ONLY === 'true') {
      console.log(`\n⏭️  Skipping Birdeye metadata fetch (USE_CACHE_ONLY=true)`);
      console.log(`   Using default metadata for ${tokensNeedingMetadata.size} tokens`);
      // Set default metadata for all tokens
      tokensNeedingMetadata.forEach(tokenAddress => {
        const key = tokenAddress.toLowerCase();
        if (!metadataFromCSV.has(key)) {
          // Use full address for lookups, but create readable fallback for display
          const shortAddr = tokenAddress.length > 8 ? tokenAddress.substring(0, 8) : tokenAddress;
          metadataFromCSV.set(key, {
            symbol: tokenAddress.substring(0, 4).toUpperCase(), // Display only
            name: `Token ${shortAddr}`, // Display only
          });
        }
      });
    } else {
      console.log(`\n🔍 Fetching metadata from Birdeye for ${tokensNeedingMetadata.size} tokens...`);
      const axios = require('axios');
      const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY_1 || process.env.BIRDEYE_API_KEY;
      
      if (BIRDEYE_API_KEY) {
      console.log(`   ✅ API key found: ${BIRDEYE_API_KEY.substring(0, 8)}...`);
      let fetched = 0;
      let failed = 0;
      let skipped = 0;
      const tokenArray = Array.from(tokensNeedingMetadata);
      
      for (let i = 0; i < tokenArray.length; i++) {
        const tokenAddress = tokenArray[i];
        const startTime = Date.now();
        const displayAddr = tokenAddress.length > 30 ? tokenAddress.substring(0, 30) + '...' : tokenAddress;
      console.log(`   [${i+1}/${tokenArray.length}] Fetching metadata for ${displayAddr}...`);
        
        try {
          // Determine chain from the call record
          const callRecord = (records as any[]).find(r => r.tokenAddress === tokenAddress);
          const chain = callRecord?.chain || 'solana';
          console.log(`      Chain: ${chain}`);
          console.log(`      Making API request...`);
          
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
              timeout: 10000, // Increased timeout to 10s
            }
          );
          
          const requestTime = Date.now() - startTime;
          console.log(`      ✅ Response received (${requestTime}ms), status: ${response.status}`);
          
          if (response.data?.success && response.data?.data) {
            const key = tokenAddress.toLowerCase();
            const existing = metadataFromCSV.get(key) || {};
            // Use full address for storage, but create readable fallback for display
            const shortAddr = tokenAddress.length > 8 ? tokenAddress.substring(0, 8) : tokenAddress;
            const symbol = response.data.data.symbol || existing.symbol || tokenAddress.substring(0, 4).toUpperCase();
            const name = response.data.data.name || existing.name || `Token ${shortAddr}`;
            
            metadataFromCSV.set(key, {
              symbol: symbol,
              name: name,
            });
            fetched++;
            console.log(`      ✅ Metadata: ${symbol} - ${name}`);
          } else {
            console.log(`      ⚠️ Response success=false or no data`);
            skipped++;
            const key = tokenAddress.toLowerCase();
            if (!metadataFromCSV.has(key)) {
              const shortAddr = tokenAddress.length > 8 ? tokenAddress.substring(0, 8) : tokenAddress;
              metadataFromCSV.set(key, {
                symbol: tokenAddress.substring(0, 4).toUpperCase(), // Display only
                name: `Token ${shortAddr}`, // Display only
              });
            }
          }
          
          // Rate limiting - 100ms delay between requests
          if (i < tokenArray.length - 1) {
            console.log(`      ⏳ Rate limiting: waiting 100ms...`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error: any) {
          const errorTime = Date.now() - startTime;
          failed++;
          console.log(`      ❌ Error after ${errorTime}ms: ${error.message}`);
          if (error.response) {
            console.log(`         Status: ${error.response.status}`);
            console.log(`         Data: ${JSON.stringify(error.response.data).substring(0, 100)}`);
          } else if (error.request) {
            console.log(`         No response received (timeout or network error)`);
          }
          
          // Silently continue - we'll use defaults
          const key = tokenAddress.toLowerCase();
          if (!metadataFromCSV.has(key)) {
            const shortAddr = tokenAddress.length > 8 ? tokenAddress.substring(0, 8) : tokenAddress;
            metadataFromCSV.set(key, {
              symbol: tokenAddress.substring(0, 4).toUpperCase(), // Display only
              name: `Token ${shortAddr}`, // Display only
            });
          }
        }
      }
      console.log(`\n✅ Birdeye metadata fetch complete:`);
      console.log(`   ✅ Fetched: ${fetched}`);
      console.log(`   ⚠️ Skipped: ${skipped}`);
      console.log(`   ❌ Failed: ${failed}`);
      } else {
        console.warn('⚠️ No Birdeye API key found, skipping metadata fetch');
        console.warn(`   Checked: BIRDEYE_API_KEY_1=${!!process.env.BIRDEYE_API_KEY_1}, BIRDEYE_API_KEY=${!!process.env.BIRDEYE_API_KEY}`);
      }
    }
  } else {
    console.log(`✅ All tokens already have metadata, skipping Birdeye fetch`);
  }

  const endDateFilter = DateTime.fromISO('2025-10-31T23:59:59');
  console.log(`🔍 Filtering calls for ${callerName}...`);
  console.log(`   Date filter: through ${endDateFilter.toFormat('yyyy-MM-dd')}`);
  
  const allFilteredCalls = (records as any[]).filter((r: any) => {
    if (!r.sender || !r.tokenAddress) return false;
    if (r.tokenAddress.includes('bonk') || r.tokenAddress.length <= 20) return false;
    
    if (!callerFilter(r)) return false;
    
    // Filter by date - only through October 2025
    try {
      const callDate = DateTime.fromISO(r.timestamp);
      if (!callDate.isValid) return false;
      return callDate <= endDateFilter;
    } catch {
      return false;
    }
  });
  console.log(`✅ Found ${allFilteredCalls.length} calls matching filter criteria`);

  // Deduplicate: Keep only the first call per token address
  console.log(`🔍 Deduplicating calls (keeping first call per token)...`);
  const seenTokens = new Map<string, any>();
  for (const call of allFilteredCalls) {
    const tokenKey = call.tokenAddress.toLowerCase();
    if (!seenTokens.has(tokenKey)) {
      seenTokens.set(tokenKey, call);
    } else {
      // Keep the earliest one
      const existing = seenTokens.get(tokenKey)!;
      const existingDate = DateTime.fromISO(existing.timestamp);
      const newDate = DateTime.fromISO(call.timestamp);
      if (newDate.isValid && existingDate.isValid && newDate < existingDate) {
        seenTokens.set(tokenKey, call);
      }
    }
  }
  console.log(`✅ After deduplication: ${seenTokens.size} unique tokens`);

  // Sort by timestamp
  console.log(`📅 Sorting calls by timestamp...`);
  const filteredCalls = Array.from(seenTokens.values()).sort((a, b) => {
    const dateA = DateTime.fromISO(a.timestamp);
    const dateB = DateTime.fromISO(b.timestamp);
    if (!dateA.isValid || !dateB.isValid) return 0;
    return dateA.toMillis() - dateB.toMillis();
  });
  if (filteredCalls.length > 0) {
    const firstCall = DateTime.fromISO(filteredCalls[0].timestamp);
    const lastCall = DateTime.fromISO(filteredCalls[filteredCalls.length - 1].timestamp);
    console.log(`✅ Sorted ${filteredCalls.length} calls from ${firstCall.toFormat('yyyy-MM-dd')} to ${lastCall.toFormat('yyyy-MM-dd')}`);
  }

  const tradeResults: TradeResult[] = [];
  const totalCalls = filteredCalls.length;
  const originalCount = allFilteredCalls.length;
  const duplicatesRemoved = originalCount - totalCalls;

  console.log(`📊 Processing ${totalCalls} ${callerName} calls through October 2025...`);
  if (duplicatesRemoved > 0) {
    console.log(`   (Removed ${duplicatesRemoved} duplicate calls, kept first call per token)\n`);
  } else {
    console.log(`\n`);
  }

  console.log(`🚀 Starting simulation loop for ${totalCalls} calls...\n`);

  for (let i = 0; i < totalCalls; i++) {
    const call = filteredCalls[i];
    const startTime = Date.now();
    const displayAddr = call.tokenAddress.length > 30 ? call.tokenAddress.substring(0, 30) + '...' : call.tokenAddress;
    console.log(`\n[${i+1}/${totalCalls}] Processing ${displayAddr}`);
    console.log(`   Caller: ${call.sender || 'unknown'}`);
    console.log(`   Timestamp: ${call.timestamp}`);
    console.log(`   Chain: ${call.chain || 'solana'}`);
    
    try {
      const alertDate = DateTime.fromISO(call.timestamp);
      if (!alertDate.isValid) {
        console.log('   ❌ Invalid date');
        continue;
      }
      console.log(`   ✅ Valid date: ${alertDate.toFormat('yyyy-MM-dd HH:mm:ss')}`);

      const endDate = alertDate.plus({ days: 60 });
      console.log(`   📊 Fetching candles from ${alertDate.toFormat('yyyy-MM-dd')} to ${endDate.toFormat('yyyy-MM-dd')}...`);
      const candles = await fetchHybridCandles(call.tokenAddress, alertDate, endDate, call.chain);
      const fetchTime = Date.now() - startTime;
      if (!candles || candles.length === 0) {
        console.log(`   ❌ No candles (took ${fetchTime}ms)`);
        continue;
      }
      console.log(`   ✅ Got ${candles.length} candles (took ${fetchTime}ms)`);
      console.log(`   🎯 Simulating strategy...`);

      // Strategy: 20% @ 2x, 20% @ 3x, remainder (60%) trailing stop -30% after 3x
      // -40% max loss cap (minExitPrice = 0.6)
      // 30% trailing stop activated after 3x
      const strategy: Array<{ percent: number; target: number }> = [
        { percent: 0.20, target: 2 },   // 20% @ 2x (early profit)
        { percent: 0.20, target: 3 },   // 20% @ 3x (more profit)
        // Remaining 60% runs with 30% trailing stop after 3x
      ];
      
      const result = simulateStrategy(candles, strategy);
      const simTime = Date.now() - startTime - fetchTime;
      console.log(`   ✅ Simulation complete (took ${simTime}ms)`);
      console.log(`   📈 Results: PNL=${result.pnl.toFixed(4)}x, Max=${result.maxReached.toFixed(4)}x, Duration=${result.holdDuration}m, TimeToATH=${result.timeToAth}m`);
      
      const metadata = metadataFromCSV.get(call.tokenAddress.toLowerCase()) || {};
      tradeResults.push({
        timestamp: alertDate,
        pnl: result.pnl,
        address: call.tokenAddress, // Full address always
        fullAddress: call.tokenAddress, // Full address for CSV
        tokenSymbol: metadata.symbol || call.tokenAddress.substring(0, 4).toUpperCase(),
        tokenName: metadata.name || `Token ${call.tokenAddress.substring(0, 8)}`,
        chain: call.chain || 'solana', // Store chain info
        maxReached: result.maxReached,
        holdDuration: result.holdDuration,
        timeToAth: result.timeToAth
      });
      
      const totalTime = Date.now() - startTime;
      console.log(`   ✅ Trade ${i+1} complete (total: ${totalTime}ms)`);
    } catch (error: any) {
      const errorTime = Date.now() - startTime;
      console.log(`   ❌ Error after ${errorTime}ms: ${error.message}`);
      if (error.stack) {
        console.log(`   Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
      }
      continue;
    }
  }

  console.log(`\n✅ Completed processing ${tradeResults.length} valid trades\n`);

  if (tradeResults.length === 0) {
    console.log('No valid trades to analyze.\n');
    return {
      callerName,
      tradeHistory: [],
      weeklyBreakdown: [],
      finalPortfolio: 10.0,
      totalTrades: 0
    };
  }

  // Sort trades by timestamp
  tradeResults.sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

  const firstDate = tradeResults[0]?.timestamp;
  const lastDate = tradeResults[tradeResults.length - 1]?.timestamp;
  
  console.log(`📅 Analysis Period: ${firstDate?.toFormat('yyyy-MM-dd')} to ${lastDate?.toFormat('yyyy-MM-dd')}`);
  console.log(`   Duration: ${lastDate?.diff(firstDate!, 'days').days.toFixed(0)} days\n`);

  // Portfolio simulation
  let portfolio = 10.0;
  const investmentPercent = 0.02;
  
  const tradesByWeek = new Map<string, TradeResult[]>();
  let currentWeekInvestment = 0;
  let lastWeekStart: DateTime | null = null;

  console.log('💼 Portfolio Simulation:\n');
  console.log(`Starting Portfolio: ${portfolio.toFixed(4)} SOL\n`);

  for (const trade of tradeResults) {
    const weekStart = getWeekStart(trade.timestamp);
    const weekKey = weekStart.toFormat('yyyy-MM-dd');

    if (lastWeekStart === null || !weekStart.equals(lastWeekStart)) {
      if (lastWeekStart !== null) {
        console.log(`\n📅 Week of ${weekStart.toFormat('yyyy-MM-dd')} (Sunday)`);
        console.log(`   Portfolio value: ${portfolio.toFixed(4)} SOL`);
      }
      currentWeekInvestment = portfolio * investmentPercent;
      lastWeekStart = weekStart;
    }

    const investment = currentWeekInvestment;
    const returnAmount = investment * trade.pnl;
    const profit = returnAmount - investment;
    
    portfolio = portfolio - investment + returnAmount;

    if (!tradesByWeek.has(weekKey)) {
      tradesByWeek.set(weekKey, []);
    }
    tradesByWeek.get(weekKey)!.push(trade);

    process.stdout.write(`  ${trade.timestamp.toFormat('MM-dd HH:mm')} | Invest: ${investment.toFixed(4)} SOL | PNL: ${trade.pnl.toFixed(2)}x | Return: ${returnAmount.toFixed(4)} SOL | Portfolio: ${portfolio.toFixed(4)} SOL\n`);
  }

  // Calculate trade-by-trade history
  const tradeHistory: any[] = [];
  let historyPortfolio = 10.0;
  let historyWeekInvestment = 0;
  let historyWeekStart: DateTime | null = null;
  
  for (const trade of tradeResults) {
    const weekStart = getWeekStart(trade.timestamp);
    
    if (historyWeekStart === null || !weekStart.equals(historyWeekStart)) {
      historyWeekInvestment = historyPortfolio * investmentPercent;
      historyWeekStart = weekStart;
    }
    
    const investment = historyWeekInvestment;
    const returnAmount = investment * trade.pnl;
    const profit = returnAmount - investment;
    const portfolioBefore = historyPortfolio;
    historyPortfolio = historyPortfolio - investment + returnAmount;
    
    // Get original trade data for chain, holdDuration, timeToAth
    const originalTrade = tradeResults.find(tr => tr.timestamp.equals(trade.timestamp) && (tr.address === trade.address || (tr as any).fullAddress === (trade as any).fullAddress));
    tradeHistory.push({
      timestamp: trade.timestamp,
      address: trade.address,
      fullAddress: (trade as any).fullAddress || trade.address, // Use full address from source
      tokenSymbol: (trade as any).tokenSymbol || ((trade as any).fullAddress || trade.address).substring(0, 4).toUpperCase(),
      tokenName: (trade as any).tokenName || `Token ${((trade as any).fullAddress || trade.address).substring(0, 8)}`,
      chain: (originalTrade as any)?.chain || (trade as any).chain || 'solana',
      investment,
      pnl: trade.pnl,
      returnAmount,
      profit,
      portfolioBefore,
      portfolioAfter: historyPortfolio,
      maxReached: trade.maxReached,
      holdDuration: (originalTrade as any)?.holdDuration || (trade as any).holdDuration,
      timeToAth: (originalTrade as any)?.timeToAth || (trade as any).timeToAth
    });
  }
  
  console.log(`\n📊 COMPLETE TRADE-BY-TRADE HISTORY:\n`);
  console.log(`${'#'.padStart(4)} | ${'Date/Time'.padEnd(19)} | ${'Token'.padEnd(25)} | ${'Invest'.padStart(10)} | ${'PNL'.padStart(8)} | ${'Return'.padStart(10)} | ${'Profit'.padStart(10)} | ${'Portfolio'.padStart(10)} | ${'Max'.padStart(8)}`);
  console.log(`${'-'.repeat(4)}-+-${'-'.repeat(19)}-+-${'-'.repeat(25)}-+-${'-'.repeat(10)}-+-${'-'.repeat(8)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}-+-${'-'.repeat(8)}`);
  
  tradeHistory.forEach((t, i) => {
    const dateStr = t.timestamp.toFormat('MM-dd HH:mm');
    console.log(
      `${String(i+1).padStart(4)} | ${dateStr.padEnd(19)} | ${t.address.padEnd(25)} | ${t.investment.toFixed(4).padStart(10)} | ${t.pnl.toFixed(2).padStart(8)}x | ${t.returnAmount.toFixed(4).padStart(10)} | ${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(4).padStart(10)} | ${t.portfolioAfter.toFixed(4).padStart(10)} | ${t.maxReached.toFixed(2).padStart(8)}x`
    );
  });
  
  console.log(`\n📊 Final Results:\n`);
  console.log(`   Starting Portfolio: 10.0000 SOL`);
  console.log(`   Final Portfolio: ${portfolio.toFixed(4)} SOL`);
  console.log(`   Total Return: ${(portfolio - 10).toFixed(4)} SOL`);
  console.log(`   Total Return %: ${((portfolio / 10 - 1) * 100).toFixed(2)}%`);
  console.log(`   Total Multiplier: ${(portfolio / 10).toFixed(4)}x`);
  console.log(`   Number of Trades: ${tradeResults.length}`);
  console.log(`   Average PNL per trade: ${(tradeResults.reduce((sum, t) => sum + t.pnl, 0) / tradeResults.length).toFixed(2)}x`);
  
  const sortedByMax = [...tradeResults].sort((a, b) => b.maxReached - a.maxReached);
  console.log(`\n🏆 Top 10 Maximum Multipliers Reached:\n`);
  sortedByMax.slice(0, 10).forEach((t, i) => {
    console.log(`   ${String(i+1).padStart(2)}. Max: ${t.maxReached.toFixed(2)}x | PNL: ${t.pnl.toFixed(2)}x | ${t.address}`);
  });
  console.log(`\n   Maximum reached: ${Math.max(...tradeResults.map(t => t.maxReached)).toFixed(2)}x`);
  
  // Weekly breakdown
  console.log(`\n📅 WEEKLY PERFORMANCE BREAKDOWN:\n`);
  console.log(`${'Week Start'.padEnd(12)} | ${'Trades'.padStart(6)} | ${'Port Start'.padStart(12)} | ${'Invest/Trade'.padStart(12)} | ${'Week Return'.padStart(12)} | ${'Week Profit'.padStart(12)} | ${'Port End'.padStart(12)} | ${'Return %'.padStart(10)} | ${'Multiplier'.padStart(10)}`);
  console.log(`${'-'.repeat(12)}-+-${'-'.repeat(6)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}`);
  
  let weekPortfolio = 10.0;
  const weeklyBreakdown: any[] = [];
  
  for (const [weekKey, trades] of Array.from(tradesByWeek.entries()).sort()) {
    const portfolioAtStart = weekPortfolio;
    const weekInvestment = weekPortfolio * investmentPercent;
    const weekReturn = trades.reduce((sum, t) => sum + (weekInvestment * t.pnl), 0);
    const weekProfit = weekReturn - (weekInvestment * trades.length);
    weekPortfolio = weekPortfolio - (weekInvestment * trades.length) + weekReturn;
    
    const weekReturnPercent = ((weekPortfolio / portfolioAtStart - 1) * 100);
    const weekMultiplier = weekPortfolio / portfolioAtStart;
    
    weeklyBreakdown.push({
      weekStart: weekKey,
      trades: trades.length,
      portfolioStart: portfolioAtStart,
      investPerTrade: weekInvestment,
      weekReturn,
      weekProfit,
      portfolioEnd: weekPortfolio,
      returnPercent: weekReturnPercent,
      multiplier: weekMultiplier
    });
    
    console.log(
      `${weekKey.padEnd(12)} | ${String(trades.length).padStart(6)} | ${portfolioAtStart.toFixed(4).padStart(12)} | ${weekInvestment.toFixed(4).padStart(12)} | ${weekReturn.toFixed(4).padStart(12)} | ${weekProfit >= 0 ? '+' : ''}${weekProfit.toFixed(4).padStart(12)} | ${weekPortfolio.toFixed(4).padStart(12)} | ${weekReturnPercent >= 0 ? '+' : ''}${weekReturnPercent.toFixed(2).padStart(9)}% | ${weekMultiplier.toFixed(4).padStart(10)}x`
    );
  }
  
  console.log(`\n${'-'.repeat(12)}-+-${'-'.repeat(6)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}`);
  console.log(`TOTALS: ${String(tradeResults.length).padStart(6)} trades | ${'10.0000'.padStart(12)} → ${portfolio.toFixed(4).padStart(12)} | ${((portfolio / 10 - 1) * 100).toFixed(2).padStart(9)}% | ${(portfolio / 10).toFixed(4).padStart(10)}x`);
  
  return {
    callerName,
    tradeHistory,
    weeklyBreakdown,
    finalPortfolio: portfolio,
    totalTrades: tradeResults.length
  };
}

function writeCSV(data: any[], headers: string[], filePath: string) {
  const lines = [headers.join(',')];
  for (const row of data) {
    const values = headers.map(h => {
      const value = row[h];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && value.includes(',')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    });
    lines.push(values.join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

async function main() {
  const callers = [
    {
      name: 'Brook Giga',
      filter: (r: any) => r.sender && (r.sender.includes('Brook Giga') || r.sender.includes('brook giga'))
    },
    {
      name: 'Brook 💀🧲',
      filter: (r: any) => r.sender && r.sender.includes('Brook 💀🧲')
    },
    {
      name: 'Brook',
      filter: (r: any) => r.sender && (r.sender.includes('Brook') || r.sender.includes('brook')) && !r.sender.includes('Brook Giga') && !r.sender.includes('Brook 💀🧲') && !r.sender.includes('brook giga')
    },
    {
      name: 'meta maxist',
      filter: (r: any) => r.sender && (r.sender.toLowerCase().includes('meta maxist') || r.sender.toLowerCase().includes('meta mxist'))
    },
    {
      name: 'exy',
      filter: (r: any) => r.sender && r.sender.toLowerCase().includes('exy') && !r.sender.toLowerCase().includes('anna')
    },
    {
      name: 'davinch',
      filter: (r: any) => r.sender && r.sender.toLowerCase().includes('davinch')
    },
    {
      name: 'croz',
      filter: (r: any) => r.sender && r.sender.toLowerCase().includes('croz')
    },
    {
      name: 'Austic',
      filter: (r: any) => r.sender && r.sender.toLowerCase().includes('austic')
    },
    {
      name: 'Mistor',
      filter: (r: any) => r.sender && r.sender.toLowerCase().includes('mistor')
    },
    {
      name: 'Mac',
      filter: (r: any) => r.sender && (r.sender.toLowerCase().includes('mac (rari') || r.sender.toLowerCase().includes('mac rari'))
    },
    {
      name: 'JK -Whale',
      filter: (r: any) => r.sender && (r.sender.includes('JK -Whale') || r.sender.includes('JK-Whale'))
    },
    {
      name: 'Whale 🐳 x',
      filter: (r: any) => r.sender && r.sender.includes('Whale 🐳 x')
    },
    {
      name: 'Prometheus',
      filter: (r: any) => r.sender && r.sender.toLowerCase().includes('prometheus')
    }
  ];

  // Process only first caller
  const singleCaller = callers.slice(0, 1);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 STARTING PORTFOLIO ANALYSIS FOR 1 CALLER: ${singleCaller[0].name}`);
  console.log(`${'='.repeat(80)}\n`);
  
  const results: CallerResults[] = [];
  
  for (let i = 0; i < singleCaller.length; i++) {
    const caller = singleCaller[i];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 Processing caller ${i+1}/${singleCaller.length}: ${caller.name}`);
    console.log(`${'='.repeat(80)}`);
    const callerStartTime = Date.now();
    const result = await calculatePortfolioPNLForCaller(caller.name, caller.filter);
    const callerTime = Date.now() - callerStartTime;
    console.log(`\n✅ Completed ${caller.name} in ${(callerTime / 1000).toFixed(2)}s`);
    results.push(result);
  }

  // Sort by final portfolio to get top 3
  const sortedResults = [...results].sort((a, b) => b.finalPortfolio - a.finalPortfolio);
  const top3 = sortedResults.slice(0, 3);

  // Write CSV files for top 3
  const outputDir = path.join(__dirname, '../data/exports/csv');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const result of top3) {
    const safeName = result.callerName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    
    // Trade-by-trade CSV
    const tradeHeaders = ['Trade#', 'Date', 'Time', 'TokenAddress', 'TokenSymbol', 'TokenName', 'Chain', 'Investment_SOL', 'PNL_Multiplier', 'Return_SOL', 'Profit_SOL', 'Portfolio_Before_SOL', 'Portfolio_After_SOL', 'Max_Multiplier_Reached', 'HoldDuration_Minutes', 'TimeToAth_Minutes'];
    const tradeData = result.tradeHistory.map((t, i) => ({
      'Trade#': i + 1,
      'Date': t.timestamp.toFormat('yyyy-MM-dd'),
      'Time': t.timestamp.toFormat('HH:mm:ss'),
      'TokenAddress': t.fullAddress || t.address,
      'TokenSymbol': t.tokenSymbol || t.address.substring(0, 4).toUpperCase(),
      'TokenName': t.tokenName || `Token ${(t.fullAddress || t.address).substring(0, 8)}`,
      'Chain': (t as any).chain || 'SOL',
      'Investment_SOL': t.investment.toFixed(8),
      'PNL_Multiplier': t.pnl.toFixed(4),
      'Return_SOL': t.returnAmount.toFixed(8),
      'Profit_SOL': t.profit.toFixed(8),
      'Portfolio_Before_SOL': t.portfolioBefore.toFixed(8),
      'Portfolio_After_SOL': t.portfolioAfter.toFixed(8),
      'Max_Multiplier_Reached': t.maxReached.toFixed(4),
      'HoldDuration_Minutes': ((t as any).holdDuration || 0).toString(),
      'TimeToAth_Minutes': ((t as any).timeToAth || 0).toString()
    }));
    writeCSV(tradeData, tradeHeaders, path.join(outputDir, `${safeName}_trade_by_trade.csv`));
    
    // Weekly summary CSV
    const weeklyHeaders = ['Week_Start', 'Trades', 'Portfolio_Start_SOL', 'Investment_Per_Trade_SOL', 'Week_Return_SOL', 'Week_Profit_SOL', 'Portfolio_End_SOL', 'Return_Percent', 'Multiplier'];
    const weeklyData = result.weeklyBreakdown.map(w => ({
      'Week_Start': w.weekStart,
      'Trades': w.trades,
      'Portfolio_Start_SOL': w.portfolioStart.toFixed(8),
      'Investment_Per_Trade_SOL': w.investPerTrade.toFixed(8),
      'Week_Return_SOL': w.weekReturn.toFixed(8),
      'Week_Profit_SOL': w.weekProfit.toFixed(8),
      'Portfolio_End_SOL': w.portfolioEnd.toFixed(8),
      'Return_Percent': w.returnPercent.toFixed(2),
      'Multiplier': w.multiplier.toFixed(4)
    }));
    writeCSV(weeklyData, weeklyHeaders, path.join(outputDir, `${safeName}_weekly_summary.csv`));
    
    console.log(`\n✅ Exported CSV files for ${result.callerName}:`);
    console.log(`   - ${safeName}_trade_by_trade.csv`);
    console.log(`   - ${safeName}_weekly_summary.csv`);
  }
}

main().catch(console.error);

