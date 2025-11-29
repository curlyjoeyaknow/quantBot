import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';

const TEMPLATE_PATH = path.join(__dirname, '../templates/email/token_alert_email_template.html');
const CSV_DIR = path.join(__dirname, '../data/exports/csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/emails');

interface WeeklyData {
  weekStart: string;
  trades: number;
  portfolioStart: number;
  investPerTrade: number;
  weekReturn: number;
  weekProfit: number;
  portfolioEnd: number;
  returnPercent: number;
  multiplier: number;
}

interface TradeData {
  tradeNumber: number;
  date: string;
  time: string;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  investment: number;
  pnl: number;
  returnAmount: number;
  profit: number;
  portfolioBefore: number;
  portfolioAfter: number;
  maxReached: number;
}

interface CallerData {
  name: string;
  weeklyData: WeeklyData[];
  tradeData: TradeData[];
  totalTrades: number;
  finalPortfolio: number;
  startingPortfolio: number;
}

async function loadCSV<T>(filePath: string): Promise<T[]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const csv = fs.readFileSync(filePath, 'utf8');
  return new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records as T[]);
    });
  });
}

function getWeekRange(weeklyData: WeeklyData[]): string {
  if (weeklyData.length === 0) return 'N/A';
  
  // Get only the most recent week
  const mostRecentWeek = weeklyData[weeklyData.length - 1];
  const weekStartDate = DateTime.fromISO(mostRecentWeek.weekStart);
  const weekEndDate = weekStartDate.plus({ days: 6 });
  
  return `${weekStartDate.toFormat('MMM dd')} - ${weekEndDate.toFormat('MMM dd, yyyy')}`;
}

function calculateStats(callers: CallerData[]) {
  // Get most recent week for each caller
  const mostRecentWeekStart = callers
    .flatMap(c => c.weeklyData)
    .map(w => w.weekStart)
    .sort()
    .pop();
  
  if (!mostRecentWeekStart) {
    return {
      totalSignals: 0,
      winRate: '0',
      bigWins: 0,
      winners: 0,
      losers: 0,
      active: 0,
      combinedPnl: '0.0'
    };
  }
  
  // Filter trades to only this week
  const thisWeekTrades: TradeData[] = [];
  const weekStartDate = DateTime.fromISO(mostRecentWeekStart);
  const weekEndDate = weekStartDate.plus({ days: 7 });
  
  for (const caller of callers) {
    for (const trade of caller.tradeData) {
      const tradeDate = DateTime.fromISO(trade.date);
      if (tradeDate >= weekStartDate && tradeDate < weekEndDate) {
        thisWeekTrades.push(trade);
      }
    }
  }
  
  const totalSignals = thisWeekTrades.length;
  
  // Calculate wins (PNL > 1.0), losses (PNL < 1.0), and active
  let winners = 0;
  let losers = 0;
  let active = 0;
  let bigWins = 0; // PNL > 2.0
  
  for (const trade of thisWeekTrades) {
    if (trade.pnl > 1.0) {
      winners++;
      if (trade.pnl >= 2.0) bigWins++;
    } else if (trade.pnl < 1.0) {
      losers++;
    }
    // Active if maxReached > 1.0 but PNL hasn't hit targets yet
    if (trade.maxReached > 1.0 && trade.pnl < 1.5) {
      active++;
    }
  }
  
  const winRate = totalSignals > 0 ? ((winners / totalSignals) * 100).toFixed(0) : '0';
  
  // Calculate combined P&L from this week's portfolio performance
  // Calculate weighted average return based on portfolio size
  let totalStartPortfolio = 0;
  let totalEndPortfolio = 0;
  
  for (const caller of callers) {
    const callerWeek = caller.weeklyData.find(w => w.weekStart === mostRecentWeekStart);
    if (callerWeek) {
      totalStartPortfolio += callerWeek.portfolioStart;
      totalEndPortfolio += callerWeek.portfolioEnd;
    }
  }
  
  const combinedReturn = totalStartPortfolio > 0 
    ? ((totalEndPortfolio - totalStartPortfolio) / totalStartPortfolio) * 100
    : 0;
  
  const displayPnl = combinedReturn.toFixed(1);
  
  return {
    totalSignals,
    winRate,
    bigWins,
    winners,
    losers,
    active,
    combinedPnl: displayPnl
  };
}

async function getTokenMetadata(tokenAddress: string): Promise<{ symbol?: string; name?: string }> {
  // First try database (has metadata from Rick/Phanes bots)
  try {
    const { Database } = require('sqlite3');
    const { promisify } = require('util');
    const dbPath = process.env.CALLER_DB_PATH || path.join(__dirname, '../caller_alerts.db');
    const db = new Database(dbPath);
    const get = promisify(db.get.bind(db));
    
    const row: any = await get(
      'SELECT token_symbol FROM caller_alerts WHERE token_address = ? AND token_symbol IS NOT NULL AND token_symbol != "UNKNOWN" AND token_symbol != "" LIMIT 1',
      [tokenAddress]
    );
    
    if (row && row.token_symbol) {
      db.close();
      return {
        symbol: row.token_symbol,
        name: undefined // Try Birdeye for name if needed
      };
    }
    db.close();
  } catch (error) {
    // Database lookup failed, continue
  }
  
  // Try CSV
  try {
    const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
    if (fs.existsSync(BROOK_CALLS_CSV)) {
      const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
      const records = await new Promise((resolve, reject) => {
        parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
          if (err) reject(err);
          else resolve(records);
        });
      });
      
      const match = (records as any[]).find((r: any) => 
        r.tokenAddress && r.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
      );
      
      if (match && match.tokenSymbol && match.tokenSymbol !== 'UNKNOWN') {
        return {
          symbol: match.tokenSymbol,
          name: undefined
        };
      }
    }
  } catch (error) {
    // CSV lookup failed
  }
  
  // Last resort: Birdeye API (only if we have no metadata)
  try {
    const axios = require('axios');
    const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY_1 || process.env.BIRDEYE_API_KEY;
    
    if (BIRDEYE_API_KEY) {
      const response = await axios.get(
        'https://public-api.birdeye.so/defi/v3/token/meta-data/single',
        {
          headers: {
            'X-API-KEY': BIRDEYE_API_KEY,
            'accept': 'application/json',
            'x-chain': 'solana'
          },
          params: { address: tokenAddress },
          timeout: 5000
        }
      );
      
      if (response.data?.success && response.data?.data) {
        return {
          symbol: response.data.data.symbol,
          name: response.data.data.name
        };
      }
    }
  } catch (error: any) {
    // Birdeye failed, return empty
  }
  
  return {};
}

function getTopSignals(callers: CallerData[], mostRecentWeekStart: string, limit: number = 5) {
  // Get most recent week date range
  const weekStartDate = DateTime.fromISO(mostRecentWeekStart);
  const weekEndDate = weekStartDate.plus({ days: 7 });
  
  // Filter to only this week's trades
  const thisWeekTrades = callers.flatMap(caller => 
    caller.tradeData
      .filter(trade => {
        const tradeDate = DateTime.fromISO(trade.date);
        return tradeDate >= weekStartDate && tradeDate < weekEndDate;
      })
      .map(trade => ({
        ...trade,
        callerName: caller.name,
        // Use metadata from CSV if available
        tokenSymbol: (trade as any).tokenSymbol || trade.tokenAddress.substring(0, 4).toUpperCase(),
        tokenName: (trade as any).tokenName || `Token ${trade.tokenAddress.substring(0, 8)}`
      }))
  );
  
  // Sort by PNL (descending)
  return thisWeekTrades
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, limit);
}

async function loadCallerData(callerName: string): Promise<CallerData | null> {
  // Load metadata from CSV if available
  const metadataMap = new Map<string, { symbol: string; name: string }>();
  
  try {
    const csvDir = path.join(__dirname, '../data/exports/csv');
    const safeName = callerName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const csvPath = path.join(csvDir, `${safeName}_trade_by_trade.csv`);
    
    if (fs.existsSync(csvPath)) {
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      const records = await new Promise((resolve, reject) => {
        parse(csvContent, { columns: true, skip_empty_lines: true }, (err, records) => {
          if (err) reject(err);
          else resolve(records);
        });
      });
      
      (records as any[]).forEach((r: any) => {
        if (r.TokenAddress && (r.TokenSymbol || r.TokenName)) {
          metadataMap.set(r.TokenAddress, {
            symbol: r.TokenSymbol || r.TokenAddress.substring(0, 4).toUpperCase(),
            name: r.TokenName || `Token ${r.TokenAddress.substring(0, 8)}`
          });
        }
      });
    }
  } catch (error) {
    // CSV not found or error reading, continue without metadata
  }
  const safeName = callerName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
  const weeklyPath = path.join(CSV_DIR, `${safeName}_weekly_summary.csv`);
  const tradePath = path.join(CSV_DIR, `${safeName}_trade_by_trade.csv`);
  
  const weeklyData = await loadCSV<WeeklyData>(weeklyPath);
  const tradeData = await loadCSV<TradeData>(tradePath);
  
  if (weeklyData.length === 0 && tradeData.length === 0) {
    return null;
  }
  
  // Convert CSV string numbers to numbers
  const processedWeekly: WeeklyData[] = weeklyData.map((w: any) => {
    const weekStart = w.Week_Start || w.weekStart || '';
    const trades = w.Trades || w.trades || '0';
    const portfolioStart = w.Portfolio_Start_SOL || w.portfolioStart || '10.0';
    const investPerTrade = w.Investment_Per_Trade_SOL || w.investPerTrade || '0.2';
    const weekReturn = w.Week_Return_SOL || w.weekReturn || '0';
    const weekProfit = w.Week_Profit_SOL || w.weekProfit || '0';
    const portfolioEnd = w.Portfolio_End_SOL || w.portfolioEnd || '10.0';
    const returnPercent = w.Return_Percent || w.returnPercent || '0';
    const multiplier = w.Multiplier || w.multiplier || '1.0';
    
    return {
      weekStart: weekStart.toString(),
      trades: parseInt(trades.toString()),
      portfolioStart: parseFloat(portfolioStart.toString()),
      investPerTrade: parseFloat(investPerTrade.toString()),
      weekReturn: parseFloat(weekReturn.toString()),
      weekProfit: parseFloat(weekProfit.toString()),
      portfolioEnd: parseFloat(portfolioEnd.toString()),
      returnPercent: parseFloat(returnPercent.toString()),
      multiplier: parseFloat(multiplier.toString())
    };
  });
  
  const processedTrades: TradeData[] = tradeData.map((t: any) => {
    const tradeNumber = t['Trade#'] || t.tradeNumber || '0';
    const date = t.Date || t.date || '';
    const time = t.Time || t.time || '';
    const tokenAddress = t.TokenAddress || t.tokenAddress || '';
    const tokenSymbol = t.TokenSymbol || t.tokenSymbol;
    const tokenName = t.TokenName || t.tokenName;
    const investment = t.Investment_SOL || t.investment || '0';
    const pnl = t.PNL_Multiplier || t.pnl || '1.0';
    const returnAmount = t.Return_SOL || t.returnAmount || '0';
    const profit = t.Profit_SOL || t.profit || '0';
    const portfolioBefore = t.Portfolio_Before_SOL || t.portfolioBefore || '10.0';
    const portfolioAfter = t.Portfolio_After_SOL || t.portfolioAfter || '10.0';
    const maxReached = t.Max_Multiplier_Reached || t.maxReached || '1.0';
    
    return {
      tradeNumber: parseInt(tradeNumber.toString()),
      date: date.toString(),
      time: time.toString(),
      tokenAddress: tokenAddress.toString(),
      tokenSymbol: tokenSymbol ? tokenSymbol.toString() : undefined,
      tokenName: tokenName ? tokenName.toString() : undefined,
      investment: parseFloat(investment.toString()),
      pnl: parseFloat(pnl.toString()),
      returnAmount: parseFloat(returnAmount.toString()),
      profit: parseFloat(profit.toString()),
      portfolioBefore: parseFloat(portfolioBefore.toString()),
      portfolioAfter: parseFloat(portfolioAfter.toString()),
      maxReached: parseFloat(maxReached.toString())
    };
  });
  
  // Calculate totals after processing
  const finalPortfolio = processedWeekly.length > 0 
    ? processedWeekly[processedWeekly.length - 1].portfolioEnd
    : 10.0;
  const startingPortfolio = processedWeekly.length > 0
    ? processedWeekly[0].portfolioStart
    : 10.0;
  
  return {
    name: callerName,
    weeklyData: processedWeekly,
    tradeData: processedTrades,
    totalTrades: processedTrades.length,
    finalPortfolio,
    startingPortfolio
  };
}

function populateTemplate(template: string, data: {
  weekRange: string;
  stats: ReturnType<typeof calculateStats>;
  callers: CallerData[];
  topSignals: ReturnType<typeof getTopSignals>;
}): string {
  let html = template;
  
  // Replace header for weekly report
  html = html.replace(
    /Performance Summary • [^<]+/,
    `Weekly Performance Summary • ${data.weekRange}`
  );
  
  // Replace hero stats - show this week's P&L
  html = html.replace(
    /<div class="hero-label">Combined P&L This Week<\/div>/,
    `<div class="hero-label">This Week's P&L</div>`
  );
  html = html.replace(
    /<div class="hero-value positive">[^<]+<\/div>/,
    `<div class="hero-value ${parseFloat(data.stats.combinedPnl) >= 0 ? 'positive' : 'negative'}">${parseFloat(data.stats.combinedPnl) >= 0 ? '+' : ''}${data.stats.combinedPnl}%</div>`
  );
  
  html = html.replace(
    /<div class="stat-value" style="color: #8b5cf6;">\d+<\/div>\s*<div class="stat-label">Total Signals<\/div>/,
    `<div class="stat-value" style="color: #8b5cf6;">${data.stats.totalSignals}</div>
                    <div class="stat-label">Total Signals</div>`
  );
  
  html = html.replace(
    /<div class="stat-value" style="color: #10b981;">\d+%<\/div>\s*<div class="stat-label">Win Rate<\/div>/,
    `<div class="stat-value" style="color: #10b981;">${data.stats.winRate}%</div>
                    <div class="stat-label">Win Rate</div>`
  );
  
  html = html.replace(
    /<div class="stat-value" style="color: #06b6d4;">\d+<\/div>\s*<div class="stat-label">Big Wins<\/div>/,
    `<div class="stat-value" style="color: #06b6d4;">${data.stats.bigWins}</div>
                    <div class="stat-label">Big Wins</div>`
  );
  
  // Replace status breakdown
  html = html.replace(
    /<div class="outcome-count">\d+<\/div>\s*<div class="outcome-label">Active<\/div>/,
    `<div class="outcome-count">${data.stats.active}</div>
                        <div class="outcome-label">Active</div>`
  );
  
  html = html.replace(
    /<div class="outcome-count">\d+<\/div>\s*<div class="outcome-label">TP Hit<\/div>/,
    `<div class="outcome-count">${data.stats.winners}</div>
                        <div class="outcome-label">TP Hit</div>`
  );
  
  html = html.replace(
    /<div class="outcome-count">\d+<\/div>\s*<div class="outcome-label">Stopped Out<\/div>/,
    `<div class="outcome-count">${data.stats.losers}</div>
                        <div class="outcome-label">Stopped Out</div>`
  );
  
  // Replace bot performance (top 3 callers) - filter to this week only
  const weekStartDate = DateTime.fromISO(data.weekRange.split(' - ')[0]);
  const weekEndDate = weekStartDate.plus({ days: 7 });
  
  const topCallers = data.callers.slice(0, 3);
  const botCards = html.match(/<!-- Bot \d+ -->[\s\S]*?<\/div>\s*<\/div>/g) || [];
  
  for (let i = 0; i < Math.min(topCallers.length, botCards.length); i++) {
    const caller = topCallers[i];
    
    // Filter to this week's trades
    const thisWeekTrades = caller.tradeData.filter(t => {
      const tradeDate = DateTime.fromISO(t.date);
      return tradeDate >= weekStartDate && tradeDate < weekEndDate;
    });
    
    const callerWins = thisWeekTrades.filter(t => t.pnl > 1.0).length;
    const callerWinRate = thisWeekTrades.length > 0 
      ? Math.round((callerWins / thisWeekTrades.length) * 100)
      : 0;
    const avgPnl = thisWeekTrades.length > 0
      ? (thisWeekTrades.reduce((sum, t) => sum + ((t.pnl - 1) * 100), 0) / thisWeekTrades.length)
      : 0;
    const bigWins = thisWeekTrades.filter(t => t.pnl >= 2.0).length;
    const bestSignal = thisWeekTrades.length > 0
      ? thisWeekTrades.reduce((best, t) => t.pnl > best.pnl ? t : best, thisWeekTrades[0])
      : null;
    
    const botName = caller.name === 'Brook Giga' ? '🎯 Brook Giga' :
                   caller.name === 'Mistor' ? '🐋 Mistor' :
                   caller.name === 'Brook' ? '📈 Brook' :
                   `🤖 ${caller.name}`;
    
    const botCard = botCards[i];
    const newBotCard = botCard
      .replace(/<div class="bot-name">[^<]+<\/div>/, `<div class="bot-name">${botName}</div>`)
      .replace(/#\d+ This Week/, `#${i + 1} This Week`)
      .replace(/<div class="bot-stat-value" style="color: #8b5cf6;">\d+<\/div>\s*<div class="bot-stat-label">Signals<\/div>/, 
        `<div class="bot-stat-value" style="color: #8b5cf6;">${thisWeekTrades.length}</div>
                            <div class="bot-stat-label">Signals</div>`)
      .replace(/<div class="bot-stat-value" style="color: #10b981;">\d+%<\/div>\s*<div class="bot-stat-label">Win Rate<\/div>/, 
        `<div class="bot-stat-value" style="color: #10b981;">${callerWinRate}%</div>
                            <div class="bot-stat-label">Win Rate</div>`)
      .replace(/<div class="bot-stat-value" style="color: #10b981;">[^<]+<\/div>\s*<div class="bot-stat-label">Avg P&L<\/div>/, 
        `<div class="bot-stat-value" style="color: #10b981;">+${avgPnl.toFixed(1)}%</div>
                            <div class="bot-stat-label">Avg P&L</div>`)
      .replace(/<div class="bot-stat-value" style="color: #06b6d4;">\d+<\/div>\s*<div class="bot-stat-label">Big Wins<\/div>/, 
        `<div class="bot-stat-value" style="color: #06b6d4;">${bigWins}</div>
                            <div class="bot-stat-label">Big Wins</div>`);
    
    // Cap best signal at reasonable display value
    if (bestSignal) {
      const bestSignalPnl = Math.min(bestSignal.pnl, 100);
      const bestSignalPercent = ((bestSignalPnl - 1) * 100).toFixed(1);
      const newBotCard2 = newBotCard
        .replace(/Best Signal: <strong[^>]+>[^<]+<\/strong>/, 
          `Best Signal: <strong style="color: #10b981;">${caller.name} +${bestSignalPercent}%</strong>`);
      html = html.replace(botCards[i], newBotCard2);
    } else {
      html = html.replace(botCards[i], newBotCard.replace(/Best Signal: <strong[^>]+>[^<]+<\/strong>/, 
        `Best Signal: <strong style="color: #94a3b8;">No signals this week</strong>`));
    }
    
  }
  
  // Replace top signals (first 5)
  const signalCards = html.match(/<!-- Signal \d+[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) || [];
  
  for (let i = 0; i < Math.min(data.topSignals.length, signalCards.length); i++) {
    const signal = data.topSignals[i];
    // PNL is a multiplier (e.g., 2.5x = 150% gain), so convert properly
    // Cap at reasonable values to avoid display issues - show as "XXXx" if too high
    let displayPnl: string;
    let pnlMultiplier = signal.pnl;
    
    if (pnlMultiplier > 100) {
      // For very high multipliers, show as "XXXx" instead of percentage
      displayPnl = `${pnlMultiplier.toFixed(1)}x`;
    } else {
      const pnlPercent = ((pnlMultiplier - 1) * 100);
      displayPnl = `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%`;
    }
    
    const isWin = signal.pnl > 1.0;
    const isBigWin = signal.pnl >= 2.0;
    
    const signalCard = signalCards[i];
    const tokenSymbol = (signal as any).tokenSymbol || 'N/A';
    const tokenName = (signal as any).tokenName || 'Unknown Token';
    const tokenAddress = signal.tokenAddress;
    
    // Create token info display: ticker (large), name (medium), address (small)
    const tokenInfoHtml = `
                        <div class="token-name">${tokenSymbol}</div>
                        <div style="font-size: 14px; color: #cbd5e1; font-weight: 500; margin-top: 4px;">${tokenName}</div>
                        <div style="font-size: 11px; color: #64748b; font-family: 'SF Mono', monospace; margin-top: 2px;">${tokenAddress.substring(0, 8)}...${tokenAddress.substring(tokenAddress.length - 6)}</div>
    `.trim();
    
    const newSignalCard = signalCard
      .replace(/<div class="token-info">[\s\S]*?<\/div>/m, `<div class="token-info">${tokenInfoHtml}</div>`)
      .replace(/<div class="performance-badge[^"]*">[^<]+<\/div>/, 
        `<div class="performance-badge ${isBigWin ? 'big-win' : isWin ? 'win' : 'loss'}">${displayPnl} ${isBigWin ? '🏆' : isWin ? '✓' : '✕'}</div>`)
      .replace(/🤖 <strong>[^<]+<\/strong>/, `🤖 <strong>${signal.callerName}</strong>`)
      .replace(/<span class="status-badge[^"]*">[^<]+<\/span>/, 
        `<span class="status-badge ${isWin ? 'tp-hit' : 'stopped'}">${isWin ? '✓ TP HIT' : '✕ STOPPED'}</span>`)
      .replace(/📅 [^<]+/, `📅 ${signal.date}`)
      .replace(/⏱ <strong>[^<]+<\/strong>/, `⏱ <strong>${signal.maxReached.toFixed(1)}x</strong> max`);
    
    html = html.replace(signalCards[i], newSignalCard);
  }
  
  return html;
}

async function main() {
  console.log('📧 Generating email report from portfolio analysis...\n');
  
  // Load template
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`❌ Template not found: ${TEMPLATE_PATH}`);
    process.exit(1);
  }
  
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  
  // Load data for top 3 callers
  const callerNames = ['Brook Giga', 'Mistor', 'Brook'];
  const callers: CallerData[] = [];
  
  for (const name of callerNames) {
    const data = await loadCallerData(name);
    if (data) {
      callers.push(data);
      console.log(`✅ Loaded data for ${name}: ${data.totalTrades} trades`);
    }
  }
  
  if (callers.length === 0) {
    console.error('❌ No caller data found. Run portfolio analysis first.');
    process.exit(1);
  }
  
  // Get most recent week
  const allWeekly = callers.flatMap(c => c.weeklyData);
  const sortedWeekly = allWeekly.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const mostRecentWeekStart = sortedWeekly.length > 0 ? sortedWeekly[sortedWeekly.length - 1].weekStart : null;
  
  if (!mostRecentWeekStart) {
    console.error('❌ No weekly data found');
    process.exit(1);
  }
  
  // Calculate stats for this week only
  const stats = calculateStats(callers);
  const topSignals = getTopSignals(callers, mostRecentWeekStart, 5);
  
  // Get week range for most recent week
  const weekRange = getWeekRange(sortedWeekly.filter(w => w.weekStart === mostRecentWeekStart));
  
  // Fetch token metadata for top signals first
  for (const signal of topSignals) {
    const metadata = await getTokenMetadata(signal.tokenAddress);
    (signal as any).tokenSymbol = metadata.symbol;
    (signal as any).tokenName = metadata.name;
  }
  
  // Populate template (async due to token metadata lookup)
  const populatedHtml = await populateTemplate(template, {
    weekRange,
    stats,
    callers,
    topSignals
  });
  
  // Save output
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const outputPath = path.join(OUTPUT_DIR, `weekly-report-${DateTime.now().toFormat('yyyy-MM-dd')}.html`);
  fs.writeFileSync(outputPath, populatedHtml, 'utf8');
  
  // Generate JSON file for the template dashboard - include ALL this week's signals
  const weekStartDate = DateTime.fromISO(mostRecentWeekStart);
  const weekEndDate = weekStartDate.plus({ days: 7 });
  
  // Get all this week's trades (not just top 5)
  const allThisWeekSignals = getTopSignals(callers, mostRecentWeekStart, 1000); // Get all
  
  // Read metadata from CSV files (no need to fetch from API)
  // Metadata is already in the CSV files
  
  const alertsJson = allThisWeekSignals.map((signal, index) => {
    const tokenSymbol = (signal as any).tokenSymbol || signal.tokenAddress.substring(0, 4).toUpperCase();
    const tokenName = (signal as any).tokenName || 'Unknown Token';
    
    // Determine status based on PNL
    let status: string;
    let exitReason: string;
    if (signal.pnl > 1.0) {
      status = 'closed';
      exitReason = signal.pnl >= 2.0 ? 'take_profit_2x' : 'timeout';
    } else if (signal.pnl < 1.0) {
      status = signal.pnl < 0.7 ? 'stopped' : 'closed';
      exitReason = signal.pnl < 0.7 ? 'stop_loss' : 'timeout';
    } else {
      status = 'active';
      exitReason = 'active';
    }
    
    // Calculate entry price (approximate - we don't have exact entry price in CSV)
    // Use a placeholder, or calculate from investment and return
    const entryPrice = signal.investment > 0 ? signal.investment / 2.5 : 0.0001;
    const exitPrice = entryPrice * signal.pnl;
    
    return {
      id: `alert-${signal.date.replace(/-/g, '')}-${index.toString().padStart(3, '0')}`,
      timestamp: `${signal.date}T${signal.time}Z`,
      creator: signal.callerName,
      token: tokenName,
      tokenSymbol: tokenSymbol,
      tokenAddress: signal.tokenAddress,
      action: 'buy',
      confidence: 0.85, // Default confidence
      entryPrice: entryPrice,
      currentPrice: exitPrice,
      exitPrice: exitPrice,
      status: status,
      pnl: ((signal.pnl - 1) * 100),
      pnlPercent: ((signal.pnl - 1) * 100),
      exitReason: exitReason,
      isReentry: false,
      volumeSOL: signal.investment
    };
  });
  
  // Get all trades for this week (not just signals, but all trades from CSV)
  const allThisWeekTrades: any[] = [];
  for (const caller of callers) {
    for (const trade of caller.tradeData) {
      const tradeDate = DateTime.fromISO(trade.date);
      if (tradeDate >= weekStartDate && tradeDate < weekEndDate) {
        allThisWeekTrades.push({
          ...trade,
          callerName: caller.name
        });
      }
    }
  }
  
  // Sort by date/time
  allThisWeekTrades.sort((a, b) => {
    const dateA = DateTime.fromISO(`${a.date}T${a.time}`);
    const dateB = DateTime.fromISO(`${b.date}T${b.time}`);
    return dateA.toMillis() - dateB.toMillis();
  });
  
  // Generate complete trade listing HTML
  const allTradesHtml = allThisWeekTrades.map((trade, index) => {
    const tokenSymbol = trade.tokenSymbol || trade.tokenAddress.substring(0, 4).toUpperCase();
    const tokenName = trade.tokenName || `Token ${trade.tokenAddress.substring(0, 8)}`;
    const pnlPercent = ((trade.pnl - 1) * 100).toFixed(2);
    const pnlClass = trade.pnl >= 1.0 ? 'positive' : 'negative';
    const pnlSign = trade.pnl >= 1.0 ? '+' : '';
    
    return `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${trade.date} ${trade.time}</td>
                                <td>${tokenName}</td>
                                <td>${tokenSymbol}</td>
                                <td>${trade.callerName}</td>
                                <td>${trade.investment.toFixed(4)} SOL</td>
                                <td class="${pnlClass}">${pnlSign}${pnlPercent}%</td>
                                <td>${trade.returnAmount.toFixed(4)} SOL</td>
                                <td class="${pnlClass}">${trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(4)} SOL</td>
                                <td>${trade.maxReached.toFixed(2)}x</td>
                            </tr>`;
  }).join('\n');
  
  // Replace trade listing placeholder
  html = html.replace(
    /<!-- TRADE_LISTING_PLACEHOLDER -->[\s\S]*?<!-- TRADE_LISTING_PLACEHOLDER -->/,
    allTradesHtml
  );
  
  // If placeholder doesn't exist, insert after Insights section
  if (!html.includes('TRADE_LISTING_PLACEHOLDER')) {
    const insightsEnd = html.indexOf('<!-- Risk Disclaimer -->');
    if (insightsEnd > 0) {
      const tradeListingSection = `
            <!-- Complete Trade Listing -->
            <div class="section">
                <div class="section-header">
                    <span class="section-icon">📋</span>
                    <h2 class="section-title">Complete Trade Listing</h2>
                </div>
                
                <div class="trade-table">
                    <table>
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Date</th>
                                <th>Token</th>
                                <th>Symbol</th>
                                <th>Caller</th>
                                <th>Investment</th>
                                <th>PNL</th>
                                <th>Return</th>
                                <th>Profit</th>
                                <th>Max Reached</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${allTradesHtml}
                        </tbody>
                    </table>
                </div>
            </div>
`;
      html = html.slice(0, insightsEnd) + tradeListingSection + html.slice(insightsEnd);
    }
  }
  
  // Write to templates/data/alerts.json
  const alertsJsonPath = path.join(__dirname, '../templates/data/alerts.json');
  fs.writeFileSync(alertsJsonPath, JSON.stringify(alertsJson, null, 2), 'utf8');
  
  console.log(`\n✅ Email report generated: ${outputPath}`);
  console.log(`✅ Alerts JSON generated: ${alertsJsonPath}`);
  console.log(`\n📊 Summary:`);
  console.log(`   Week Range: ${weekRange}`);
  console.log(`   Total Signals: ${stats.totalSignals}`);
  console.log(`   Win Rate: ${stats.winRate}%`);
  console.log(`   Combined P&L: ${stats.combinedPnl}%`);
  console.log(`   Top Callers: ${callers.map(c => c.name).join(', ')}`);
  console.log(`   Alerts in JSON: ${alertsJson.length}`);
}

main().catch(console.error);

