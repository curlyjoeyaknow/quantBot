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
  maxReached: number;
}

/**
 * Multi-level exit strategy for Brook calls - captures big moves
 * Takes partial profits at multiple levels, lets rest ride with trailing stop
 */
function simulateBrookStrategy(
  candles: any[],
  strategy: any[]
): { pnl: number, maxReached: number } {
  
  const entryPrice = candles[0].close;
  const stopLoss = entryPrice * 0.7; // -30% stop loss
  
  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = entryPrice;
  let maxReached = 1.0;
  const trailingStopPercent = 0.3; // 30% trailing stop after hitting 5x
  
  // Track which targets we've hit
  const targetsHit = new Set<number>();
  
  for (const candle of candles) {
    // Track max reached
    if (candle.high / entryPrice > maxReached) {
      maxReached = candle.high / entryPrice;
    }
    // Update highest price for trailing stop
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
    
    // Trailing stop logic: After hitting 5x, use 30% trailing stop from highest
    if (targetsHit.has(5) && remaining > 0) {
      const trailingStopPrice = highestPrice * (1 - trailingStopPercent);
      if (candle.low <= trailingStopPrice) {
        pnl += remaining * (trailingStopPrice / entryPrice);
        remaining = 0;
        break; // Exit position
      }
    }
    
    // Regular stop loss: Only if we haven't hit any targets yet
    if (targetsHit.size === 0 && candle.low <= stopLoss && remaining > 0) {
      pnl += remaining * (stopLoss / entryPrice);
      remaining = 0;
      break;
    }
  }
  
  // Final exit if still holding
  if (remaining > 0) {
    pnl += remaining * (candles[candles.length - 1].close / entryPrice);
  }
  
  return { pnl, maxReached };
}

/**
 * Original conditional re-entry strategy (for Brook Giga)
 */
function simulateConditionalReentry(
  candles: any[],
  strategy: any[]
): { pnl: number, maxReached: number } {
  
  const entryPrice = candles[0].close;
  const stopLoss = entryPrice * 0.7;
  
  let remaining = 1.0;
  let pnl = 0;
  let maxReached = 1.0;
  let hitFirstTarget = false;
  let reEntered = false;
  let hitStopAfterTarget = false;
  
  for (const candle of candles) {
    // Track max reached
    if (candle.high / entryPrice > maxReached) {
      maxReached = candle.high / entryPrice;
    }
    // Check first profit target
    if (!hitFirstTarget && candle.high >= entryPrice * strategy[0].target) {
      const sellPercent = strategy[0].percent;
      pnl += sellPercent * strategy[0].target;
      remaining -= sellPercent;
      hitFirstTarget = true;
    }
    
    // After hitting first target, check for stop loss
    if (hitFirstTarget && !hitStopAfterTarget && candle.low <= stopLoss) {
      pnl += remaining * (stopLoss / entryPrice);
      remaining = 0;
      hitStopAfterTarget = true;
    }
    
    // After being stopped out, check for bounce back to alert price
    if (hitStopAfterTarget && !reEntered && candle.high >= entryPrice) {
      remaining = 1.0;
      reEntered = true;
    }
    
    // If re-entered, check for second profit target
    if (reEntered && remaining > 0 && strategy[1]) {
      const targetPrice = entryPrice * strategy[1].target;
      if (candle.high >= targetPrice) {
        pnl += remaining * strategy[1].target;
        remaining = 0;
      }
    }
  }
  
  // Final exit if still holding
  if (remaining > 0) {
    pnl += remaining * (candles[candles.length - 1].close / entryPrice);
  }
  
  return { pnl, maxReached };
}

function getWeekStart(date: DateTime): DateTime {
  // Get the start of the week (Sunday)
  const dayOfWeek = date.weekday; // 1 = Monday, 7 = Sunday
  const daysFromSunday = dayOfWeek === 7 ? 0 : dayOfWeek;
  return date.minus({ days: daysFromSunday }).startOf('day');
}

async function calculatePortfolioPNL() {
  console.log('💰 Calculating Portfolio PNL with 2% per trade, weekly rebalancing...\n');

  // Read Brook calls
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Filter for Brook + Brook Giga calls (combined analysis)
  const endDateFilter = DateTime.fromISO('2025-10-31T23:59:59');
  
  const brookOnly = (records as any[]).filter((r: any) => {
    if (!r.sender || !r.tokenAddress) return false;
    if (r.tokenAddress.includes('bonk') || r.tokenAddress.length <= 20) return false;
    
    // Include both "Brook" and "Brook Giga" calls
    const isBrook = (r.sender.includes('Brook') || r.sender.includes('brook')) && 
                    !r.sender.includes('Brook Giga') && 
                    !r.sender.includes('brook giga');
    const isBrookGiga = r.sender.includes('Brook Giga') || r.sender.includes('brook giga');
    
    if (!isBrook && !isBrookGiga) return false;
    
    // Filter by date - only through October 2025
    try {
      const callDate = DateTime.fromISO(r.timestamp);
      if (!callDate.isValid) return false;
      return callDate <= endDateFilter;
    } catch {
      return false;
    }
  });

  // Process trades and get results
  const tradeResults: TradeResult[] = [];
  const totalCalls = brookOnly.length;

  console.log(`📊 Processing ${totalCalls} Brook + Brook Giga calls through October 2025...\n`);

  for (let i = 0; i < totalCalls; i++) {
    const call = brookOnly[i];
    process.stdout.write(`[${i+1}/${totalCalls}] Processing ${call.tokenAddress.substring(0, 20)}... `);
    
    try {
      const alertDate = DateTime.fromISO(call.timestamp);
      if (!alertDate.isValid) {
        console.log('❌ Invalid date');
        continue;
      }

      const endDate = alertDate.plus({ days: 60 });
      process.stdout.write('Fetching candles... ');
      const candles = await fetchHybridCandles(call.tokenAddress, alertDate, endDate, call.chain);
      if (!candles || candles.length === 0) {
        console.log('❌ No candles');
        continue;
      }
      process.stdout.write(`(${candles.length} candles) Simulating... `);

      // Determine if this is a Brook Giga call or regular Brook call
      const isBrookGiga = call.sender.includes('Brook Giga') || call.sender.includes('brook giga');
      
      let result;
      if (isBrookGiga) {
        // Brook Giga: Original conditional re-entry strategy
        const strategy = [
          { percent: 0.5, target: 2 },
          { percent: 0.5, target: 10 }
        ];
        result = simulateConditionalReentry(candles, strategy);
      } else {
        // Brook-only: Multi-level exit strategy to capture big moves
        const strategy = [
          { percent: 0.2, target: 2 },   // 20% @ 2x
          { percent: 0.2, target: 5 },   // 20% @ 5x
          { percent: 0.2, target: 10 },  // 20% @ 10x
          { percent: 0.4, target: 20 }  // 40% @ 20x (with trailing stop after 5x)
        ];
        result = simulateBrookStrategy(candles, strategy);
      }
      
      tradeResults.push({
        timestamp: alertDate,
        pnl: result.pnl,
        address: call.tokenAddress.substring(0, 20),
        maxReached: result.maxReached
      });
      
      console.log(`✅ PNL: ${result.pnl.toFixed(2)}x`);
    } catch (error: any) {
      console.log(`❌ Error: ${error.message}`);
      continue;
    }
  }

  console.log(`\n✅ Completed processing ${tradeResults.length} valid trades\n`);

  // Sort trades by timestamp
  tradeResults.sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

  // Find date range
  const firstDate = tradeResults[0]?.timestamp;
  const lastDate = tradeResults[tradeResults.length - 1]?.timestamp;
  
  console.log(`📅 Analysis Period: ${firstDate?.toFormat('yyyy-MM-dd')} to ${lastDate?.toFormat('yyyy-MM-dd')}`);
  console.log(`   Duration: ${lastDate?.diff(firstDate!, 'days').days.toFixed(0)} days\n`);

  // Portfolio simulation
  let portfolio = 10.0; // Starting with 10 SOL
  const investmentPercent = 0.02; // 2% per trade
  
  // Group trades by week
  const tradesByWeek = new Map<string, TradeResult[]>();
  let currentWeekInvestment = 0;
  let lastWeekStart: DateTime | null = null;

  console.log('💼 Portfolio Simulation:\n');
  console.log(`Starting Portfolio: ${portfolio.toFixed(4)} SOL\n`);

  for (const trade of tradeResults) {
    const weekStart = getWeekStart(trade.timestamp);
    const weekKey = weekStart.toFormat('yyyy-MM-dd');

    // Check if we're in a new week
    if (lastWeekStart === null || !weekStart.equals(lastWeekStart)) {
      // New week - recalculate investment amount based on current portfolio
      if (lastWeekStart !== null) {
        console.log(`\n📅 Week of ${weekStart.toFormat('yyyy-MM-dd')} (Sunday)`);
        console.log(`   Portfolio value: ${portfolio.toFixed(4)} SOL`);
      }
      currentWeekInvestment = portfolio * investmentPercent;
      lastWeekStart = weekStart;
    }

    // Execute trade
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

  // Sort by max multiplier
  const sortedByMax = [...tradeResults].sort((a, b) => b.maxReached - a.maxReached);
  
  // Calculate trade-by-trade history with portfolio values (reuse sorted results)
  const tradeHistory: any[] = [];
  let historyPortfolio = 10.0;
  let historyWeekInvestment = 0;
  let historyWeekStart: DateTime | null = null;
  
  for (const trade of tradeResults) {
    const weekStart = getWeekStart(trade.timestamp);
    
    // Check if we're in a new week
    if (historyWeekStart === null || !weekStart.equals(historyWeekStart)) {
      historyWeekInvestment = historyPortfolio * investmentPercent;
      historyWeekStart = weekStart;
    }
    
    const investment = historyWeekInvestment;
    const returnAmount = investment * trade.pnl;
    const profit = returnAmount - investment;
    const portfolioBefore = historyPortfolio;
    historyPortfolio = historyPortfolio - investment + returnAmount;
    
    tradeHistory.push({
      timestamp: trade.timestamp,
      address: trade.address,
      investment,
      pnl: trade.pnl,
      returnAmount,
      profit,
      portfolioBefore,
      portfolioAfter: historyPortfolio,
      maxReached: trade.maxReached
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
  console.log(`\n🏆 Top 10 Maximum Multipliers Reached:\n`);
  sortedByMax.slice(0, 10).forEach((t, i) => {
    console.log(`   ${String(i+1).padStart(2)}. Max: ${t.maxReached.toFixed(2)}x | PNL: ${t.pnl.toFixed(2)}x | ${t.address}`);
  });
  console.log(`\n   Maximum reached: ${Math.max(...tradeResults.map(t => t.maxReached)).toFixed(2)}x`);
  
  // Weekly breakdown with detailed stats
  console.log(`\n📅 WEEKLY PERFORMANCE BREAKDOWN:\n`);
  console.log(`${'Week Start'.padEnd(12)} | ${'Trades'.padStart(6)} | ${'Port Start'.padStart(12)} | ${'Invest/Trade'.padStart(12)} | ${'Week Return'.padStart(12)} | ${'Week Profit'.padStart(12)} | ${'Port End'.padStart(12)} | ${'Return %'.padStart(10)} | ${'Multiplier'.padStart(10)}`);
  console.log(`${'-'.repeat(12)}-+-${'-'.repeat(6)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(12)}-+-${'-'.repeat(10)}-+-${'-'.repeat(10)}`);
  
  let weekPortfolio = 10.0;
  const weeklyStats: any[] = [];
  
  for (const [weekKey, trades] of Array.from(tradesByWeek.entries()).sort()) {
    const weekStart = DateTime.fromFormat(weekKey, 'yyyy-MM-dd');
    const portfolioAtStart = weekPortfolio;
    const weekInvestment = weekPortfolio * investmentPercent;
    const weekReturn = trades.reduce((sum, t) => sum + (weekInvestment * t.pnl), 0);
    const weekProfit = weekReturn - (weekInvestment * trades.length);
    weekPortfolio = weekPortfolio - (weekInvestment * trades.length) + weekReturn;
    
    const weekReturnPercent = ((weekPortfolio / portfolioAtStart - 1) * 100);
    const weekMultiplier = weekPortfolio / portfolioAtStart;
    
    weeklyStats.push({
      weekStart: weekKey,
      trades: trades.length,
      portfolioStart: portfolioAtStart,
      investmentPerTrade: weekInvestment,
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
}

calculatePortfolioPNL().catch(console.error);

