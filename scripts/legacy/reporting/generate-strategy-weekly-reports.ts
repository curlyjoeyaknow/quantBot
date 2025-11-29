#!/usr/bin/env ts-node
/**
 * Generate Weekly Reports for Top Performing Strategies
 * 
 * Creates weekly HTML email reports for the best performing strategies,
 * including the original Tenkan-Kijun simulation and top optimization strategies.
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { queryCandles } from '../src/storage/clickhouse-client';

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1 || 'dec8084b90724ffe949b68d0a18359d6';

// Strategy definitions - Top strategy from each category
const TOP_STRATEGIES = [
  {
    name: 'Tenkan-Kijun Weighted Portfolio',
    displayName: 'Tenkan-Kijun (Weighted Portfolio)',
    category: 'Original',
    type: 'tenkan-kijun',
    tradeHistoryPath: path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller'),
    portfolioHistoryPath: path.join(__dirname, '../data/exports/tenkan-kijun-remaining-period-by-caller/weighted_portfolio_history_solana_only.csv'),
  },
  {
    name: 'MultiTrade_10pctTrail_50pctDropRebound_24h',
    displayName: 'Multi-Trade: 10% Trailing Stop, 50% Drop + Rebound',
    category: 'Multi-Trade (Drop/Rebound)',
    type: 'optimized',
    tradeHistoryPath: path.join(__dirname, '../data/exports/solana-callers-optimized/2025-11-24_17-32-21'),
  },
  {
    name: 'MultiTrade_20pctTrail_50pctDropRebound_24h',
    displayName: 'Multi-Trade: 20% Trailing Stop, 50% Drop + Rebound',
    category: 'Multi-Trade (Drop/Rebound)',
    type: 'optimized',
    tradeHistoryPath: path.join(__dirname, '../data/exports/solana-callers-optimized/2025-11-24_17-32-21'),
  },
  {
    name: 'MultiTrade_DynamicTrail_50pctDropRebound_24h',
    displayName: 'Multi-Trade: Dynamic Trailing Stop, 50% Drop + Rebound',
    category: 'Multi-Trade (Drop/Rebound)',
    type: 'optimized',
    tradeHistoryPath: path.join(__dirname, '../data/exports/solana-callers-optimized/2025-11-24_17-32-21'),
  },
  {
    name: 'MultiTrade_20pctTrail_RSI_MACD_24h',
    displayName: 'Multi-Trade: 20% Trailing Stop, RSI/MACD Re-entry',
    category: 'Multi-Trade (RSI/MACD)',
    type: 'optimized',
    tradeHistoryPath: path.join(__dirname, '../data/exports/solana-callers-optimized/2025-11-24_17-32-21'),
  },
  {
    name: 'MultiTrade_20pctTrail_MA_24h',
    displayName: 'Multi-Trade: 20% Trailing Stop, MA Crossover Re-entry',
    category: 'Multi-Trade (MA)',
    type: 'optimized',
    tradeHistoryPath: path.join(__dirname, '../data/exports/solana-callers-optimized/2025-11-24_17-32-21'),
  },
  {
    name: 'Ichimoku_5m_TenkanKijun_10pctTrail_24h',
    displayName: 'Ichimoku: Tenkan-Kijun Cross, 10% Trailing Stop',
    category: 'Ichimoku',
    type: 'optimized',
    tradeHistoryPath: path.join(__dirname, '../data/exports/solana-callers-optimized/2025-11-24_17-32-21'),
  },
];

const TEMPLATE_PATH = path.join(__dirname, '../data/exports/reports/comprehensive_trading_dashboard.html');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/emails/strategy-weekly-reports');
const CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const DB_PATH = path.join(__dirname, '../data/caller_alerts.db');

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
  entryPrice?: number;
  exitPrice?: number;
  strategy?: string;
}

interface TradeStatus {
  status: 'active' | 'tp-hit' | 'stopped' | 'closed';
  entryPrice: number;
  exitPrice?: number;
  currentPrice?: number;
  pnlPercent: number;
}

// Trading parameters
const STOP_LOSS_PERCENT = 0.2; // 20%
const PROFIT_TARGETS = [1.5, 2.0, 3.0];
const MAX_HOLD_DAYS = 7;

/**
 * Fix template to be fully responsive based on window size
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
  
  // Make signal-header responsive (stack on mobile)
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
  
  // Ensure email-container stays responsive
  html = html.replace(/\.email-container\s*\{[^}]*\}/g,
    `.email-container {
            max-width: 100%;
            width: 100%;
            margin: 0 auto;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.05);
        }`);
  
  // Make hero-value responsive
  html = html.replace(/\.hero-value\s*\{[^}]*\}/g,
    `.hero-value {
            font-size: clamp(32px, 8vw, 56px);
            font-weight: 800;
            font-family: 'SF Mono', 'Courier New', monospace;
            letter-spacing: -2px;
            text-shadow: 0 0 40px rgba(16, 185, 129, 0.4);
        }`);
  
  // Make header and content padding responsive
  html = html.replace(/\.header\s*\{[^}]*\}/g,
    `.header {
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%);
            backdrop-filter: blur(40px);
            padding: clamp(24px, 6vw, 48px) clamp(20px, 4vw, 32px);
            text-align: center;
            border-bottom: 1px solid rgba(139, 92, 246, 0.2);
            position: relative;
            overflow: hidden;
        }`);
  
  html = html.replace(/\.content\s*\{[^}]*\}/g,
    `.content {
            padding: clamp(24px, 5vw, 40px) clamp(20px, 4vw, 32px);
        }`);
  
  return html;
}

/**
 * Load portfolio history for Tenkan-Kijun strategy
 */
async function loadTenkanKijunPortfolioHistory(): Promise<WeeklyPortfolioData[]> {
  const portfolioPath = TOP_STRATEGIES[0].portfolioHistoryPath;
  if (!portfolioPath || !fs.existsSync(portfolioPath)) {
    throw new Error(`Portfolio history path not found: ${portfolioPath}`);
  }
  const csvContent = fs.readFileSync(portfolioPath, 'utf-8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csvContent, { columns: true, skip_empty_lines: true }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });

  return records.map(row => ({
    week: row.Week || row.week || 'start',
    date: DateTime.fromISO(row.Date || row.date || row.Week || row.week),
    portfolioValue: parseFloat(row.PortfolioValue || row.portfolioValue || '100'),
    tradesThisWeek: parseInt(row.TradesThisWeek || row.tradesThisWeek || '0', 10),
    weeklyReturn: parseFloat(row.WeeklyReturn || row.weeklyReturn || '0'),
  }));
}

/**
 * Load trades for Tenkan-Kijun strategy
 */
async function loadTenkanKijunTrades(): Promise<Trade[]> {
  const callerDir = TOP_STRATEGIES[0].tradeHistoryPath;
  const topCallers = ['Brook', 'Brook_Giga_I_verify__BrookCalls', 'meta_maxist', 'exy', 'Mistor'];
  const trades: Trade[] = [];

  for (const caller of topCallers) {
    const tradeFile = path.join(callerDir, caller, 'complete_trade_history.csv');
    if (!fs.existsSync(tradeFile)) continue;

    const csvContent = fs.readFileSync(tradeFile, 'utf-8');
    const records: any[] = await new Promise((resolve, reject) => {
      parse(csvContent, { columns: true, skip_empty_lines: true }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    for (const row of records) {
      // Tenkan-Kijun files don't have chain column, assume all are Solana
      if (row.chain && row.chain !== 'solana') continue;
      
      const tokenAddr = row.TokenAddress || row.tokenAddress || row.token_address;
      if (!tokenAddr) continue;
      
      trades.push({
        caller: caller,
        tokenAddress: tokenAddr,
        alertTime: DateTime.fromISO(row.AlertTime || row.alertTime || row.alert_time),
        entryTime: (row.EntryTime || row.entryTime || row.entry_time) ? DateTime.fromISO(row.EntryTime || row.entryTime || row.entry_time) : null,
        exitTime: (row.ExitTime || row.exitTime || row.exit_time) ? DateTime.fromISO(row.ExitTime || row.exitTime || row.exit_time) : null,
        pnl: parseFloat(row.PnL || row.pnl || '1'),
        pnlPercent: parseFloat(row.PnLPercent || row.pnlPercent || row.pnl_percent || ((parseFloat(row.PnL || row.pnl || '1') - 1) * 100).toFixed(2)),
        maxReached: parseFloat(row.MaxReached || row.maxReached || row.max_reached || '1'),
        chain: row.chain || 'solana',
        entryPrice: (row.EntryPrice || row.entryPrice) ? parseFloat(row.EntryPrice || row.entryPrice) : undefined,
        exitPrice: (row.ExitPrice || row.exitPrice) ? parseFloat(row.ExitPrice || row.exitPrice) : undefined,
        strategy: 'Tenkan-Kijun',
      });
    }
  }

  return trades;
}

/**
 * Load trades for optimized strategies
 */
async function loadOptimizedStrategyTrades(strategyName: string): Promise<Trade[]> {
  const baseDir = path.join(__dirname, '../data/exports/solana-callers-optimized/2025-11-24_17-32-21');
  const callers = ['Brook', 'Brook_Giga_I_verify__BrookCalls', 'meta_maxist', 'exy', 'Mistor', 'Croz', 'davinch'];
  const trades: Trade[] = [];

  for (const caller of callers) {
    const tradeFile = path.join(baseDir, caller, `${strategyName}_trades.csv`);
    if (!fs.existsSync(tradeFile)) continue;

    const csvContent = fs.readFileSync(tradeFile, 'utf-8');
    const records: any[] = await new Promise((resolve, reject) => {
      parse(csvContent, { columns: true, skip_empty_lines: true }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    for (const row of records) {
      // Filter by chain if present
      if (row.chain && row.chain !== 'solana') continue;
      
      const tokenAddr = row.tokenAddress || row.token_address;
      if (!tokenAddr) continue;
      
      const alertTimeStr = row.alertDateTime || row.alertTime || row.alert_time;
      if (!alertTimeStr) continue;
      
      trades.push({
        caller: caller,
        tokenAddress: tokenAddr,
        alertTime: DateTime.fromISO(alertTimeStr),
        entryTime: (row.entryTime || row.entry_time) ? DateTime.fromISO(row.entryTime || row.entry_time) : null,
        exitTime: (row.exitTime || row.exit_time) ? DateTime.fromISO(row.exitTime || row.exit_time) : null,
        pnl: parseFloat(row.pnl || '1'),
        pnlPercent: parseFloat(row.pnlPercent || row.pnl_percent || ((parseFloat(row.pnl || '1') - 1) * 100).toFixed(2)),
        maxReached: parseFloat(row.athSinceCallPercent || row.maxReached || row.max_reached || '1'),
        chain: row.chain || 'solana',
        entryPrice: (row.entryPrice || row.EntryPrice) ? parseFloat(row.entryPrice || row.EntryPrice) : undefined,
        exitPrice: (row.exitPrice || row.ExitPrice) ? parseFloat(row.exitPrice || row.ExitPrice) : undefined,
        strategy: strategyName,
      });
    }
  }

  return trades;
}

/**
 * Load or generate trades for a specific week
 * Checks if simulation data exists, if not runs simulation for that week
 */
async function loadOrGenerateWeekTrades(
  strategy: typeof TOP_STRATEGIES[0],
  weekCalls: any[],
  weekStart: DateTime,
  weekEnd: DateTime
): Promise<Trade[]> {
  // Check if simulation data exists for this week
  const baseDir = path.join(__dirname, '../data/exports/solana-callers-optimized');
  const latestRun = fs.readdirSync(baseDir)
    .filter(f => fs.statSync(path.join(baseDir, f)).isDirectory())
    .sort()
    .reverse()[0];
  
  if (!latestRun) {
    console.log(`      ⚠️  No simulation data found, need to run simulation for week ${weekStart.toFormat('yyyy-MM-dd')}`);
    return [];
  }
  
  const runDir = path.join(baseDir, latestRun);
  const callers = ['Brook', 'Brook_Giga_I_verify__BrookCalls', 'meta_maxist', 'exy', 'Mistor', 'Croz', 'davinch'];
  const trades: Trade[] = [];
  
  for (const caller of callers) {
    const tradeFile = path.join(runDir, caller, `${strategy.name}_trades.csv`);
    if (!fs.existsSync(tradeFile)) continue;
    
    const csvContent = fs.readFileSync(tradeFile, 'utf-8');
    const records: any[] = await new Promise((resolve, reject) => {
      parse(csvContent, { columns: true, skip_empty_lines: true }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
    
    for (const row of records) {
      if (row.chain && row.chain !== 'solana') continue;
      
      const tokenAddr = row.tokenAddress || row.token_address;
      if (!tokenAddr) continue;
      
      const alertTimeStr = row.alertDateTime || row.alertTime || row.alert_time;
      if (!alertTimeStr) continue;
      
      const alertTime = DateTime.fromISO(alertTimeStr);
      if (!alertTime.isValid) continue;
      
      // Filter to only this week
      const alertWeek = alertTime.startOf('week');
      if (!alertWeek.hasSame(weekStart, 'week')) continue;
      
      trades.push({
        caller: caller,
        tokenAddress: tokenAddr,
        alertTime: alertTime,
        entryTime: (row.entryTime || row.entry_time) ? DateTime.fromISO(row.entryTime || row.entry_time) : null,
        exitTime: (row.exitTime || row.exit_time) ? DateTime.fromISO(row.exitTime || row.exit_time) : null,
        pnl: parseFloat(row.pnl || '1'),
        pnlPercent: parseFloat(row.pnlPercent || row.pnl_percent || ((parseFloat(row.pnl || '1') - 1) * 100).toFixed(2)),
        maxReached: parseFloat(row.athSinceCallPercent || row.maxReached || row.max_reached || '1'),
        chain: row.chain || 'solana',
        entryPrice: (row.entryPrice || row.EntryPrice) ? parseFloat(row.entryPrice || row.EntryPrice) : undefined,
        exitPrice: (row.exitPrice || row.ExitPrice) ? parseFloat(row.exitPrice || row.ExitPrice) : undefined,
        strategy: strategy.name,
      });
    }
  }
  
  // If no trades found and we have calls for this week, run simulation
  if (trades.length === 0 && weekCalls.length > 0) {
    console.log(`      ⚠️  No trades found for week ${weekStart.toFormat('yyyy-MM-dd')}, but ${weekCalls.length} calls exist`);
    console.log(`      🚀 Running simulation for this week...`);
    
    try {
      // Run simulation script with date filter for this week
      const weekStartISO = weekStart.toISO();
      const weekEndISO = weekEnd.toISO();
      
      console.log(`      📅 Filtering: ${weekStartISO} to ${weekEndISO}`);
      
      // Spawn simulation script with date filters
      const { spawn } = require('child_process');
      const simScript = path.join(__dirname, 'analyze-solana-callers-optimized.ts');
      
      const proc = spawn('npx', ['ts-node', simScript], {
        env: {
          ...process.env,
          DATE_FILTER_START: weekStartISO,
          DATE_FILTER_END: weekEndISO,
        },
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
      });
      
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code: number | null) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Simulation exited with code ${code}`));
          }
        });
        proc.on('error', reject);
      });
      
      // Reload trades from the latest simulation run
      const simBaseDir = path.join(__dirname, '../data/exports/solana-callers-optimized');
      const latestRun = fs.readdirSync(simBaseDir)
        .filter(f => fs.statSync(path.join(simBaseDir, f)).isDirectory())
        .sort()
        .reverse()[0];
      
      if (latestRun) {
        const runDir = path.join(simBaseDir, latestRun);
        const simCallers = ['Brook', 'Brook_Giga_I_verify__BrookCalls', 'meta_maxist', 'exy', 'Mistor', 'Croz', 'davinch'];
        for (const caller of simCallers) {
          const tradeFile = path.join(runDir, caller, `${strategy.name}_trades.csv`);
          if (!fs.existsSync(tradeFile)) continue;
          
          const csvContent = fs.readFileSync(tradeFile, 'utf-8');
          const records: any[] = await new Promise((resolve, reject) => {
            parse(csvContent, { columns: true, skip_empty_lines: true }, (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          });
          
          for (const row of records) {
            if (row.chain && row.chain !== 'solana') continue;
            
            const tokenAddr = row.tokenAddress || row.token_address;
            if (!tokenAddr) continue;
            
            const alertTimeStr = row.alertDateTime || row.alertTime || row.alert_time;
            if (!alertTimeStr) continue;
            
            const alertTime = DateTime.fromISO(alertTimeStr);
            if (!alertTime.isValid) continue;
            
            // Filter to only this week
            const alertWeek = alertTime.startOf('week');
            if (!alertWeek.hasSame(weekStart, 'week')) continue;
            
            trades.push({
              caller: caller,
              tokenAddress: tokenAddr,
              alertTime: alertTime,
              entryTime: (row.entryTime || row.entry_time) ? DateTime.fromISO(row.entryTime || row.entry_time) : null,
              exitTime: (row.exitTime || row.exit_time) ? DateTime.fromISO(row.exitTime || row.exit_time) : null,
              pnl: parseFloat(row.pnl || '1'),
              pnlPercent: parseFloat(row.pnlPercent || row.pnl_percent || ((parseFloat(row.pnl || '1') - 1) * 100).toFixed(2)),
              maxReached: parseFloat(row.athSinceCallPercent || row.maxReached || row.max_reached || '1'),
              chain: row.chain || 'solana',
              entryPrice: (row.entryPrice || row.EntryPrice) ? parseFloat(row.entryPrice || row.EntryPrice) : undefined,
              exitPrice: (row.exitPrice || row.ExitPrice) ? parseFloat(row.exitPrice || row.ExitPrice) : undefined,
              strategy: strategy.name,
            });
          }
        }
        
        console.log(`      ✅ Generated ${trades.length} trades for this week`);
      }
    } catch (err) {
      console.log(`      ❌ Failed to run simulation: ${err}`);
    }
  }
  
  return trades;
}

/**
 * Generate weekly portfolio history from trades
 * Properly calculates portfolio value based on when trades actually closed
 * Each strategy's portfolio is calculated independently based on its own trades
 */
function generateWeeklyPortfolioHistory(trades: Trade[], initialValue: number = 100): WeeklyPortfolioData[] {
  if (trades.length === 0) {
    return [];
  }

  const positionSizePercent = 0.02;
  
  // Group trades by weeks for alerts and exits
  const weeklyAlerts = new Map<string, Trade[]>();
  const weeklyExits = new Map<string, Trade[]>();
  
  for (const trade of trades) {
    // Group by alert week for counting signals
    const alertWeekStart = trade.alertTime.startOf('week');
    const alertWeekKey = alertWeekStart.toISODate() || alertWeekStart.toFormat('yyyy-MM-dd');
    
    if (!weeklyAlerts.has(alertWeekKey)) {
      weeklyAlerts.set(alertWeekKey, []);
    }
    weeklyAlerts.get(alertWeekKey)!.push(trade);
    
    // Group by exit week for calculating returns
    if (trade.exitTime) {
      const exitWeekStart = trade.exitTime.startOf('week');
      const exitWeekKey = exitWeekStart.toISODate() || exitWeekStart.toFormat('yyyy-MM-dd');
      
      if (!weeklyExits.has(exitWeekKey)) {
        weeklyExits.set(exitWeekKey, []);
      }
      weeklyExits.get(exitWeekKey)!.push(trade);
    }
  }

  // Get all unique weeks (both alerts and exits)
  const allWeeks = new Set<string>();
  for (const week of Array.from(weeklyAlerts.keys())) allWeeks.add(week);
  for (const week of Array.from(weeklyExits.keys())) allWeeks.add(week);
  
  const weeks = Array.from(allWeeks).sort();
  
  // Sort all trades by entry time (or alert time) to track portfolio chronologically
  const sortedTrades = [...trades].filter(t => t.exitTime).sort((a, b) => {
    const aEntry = a.entryTime || a.alertTime;
    const bEntry = b.entryTime || b.alertTime;
    return aEntry.toMillis() - bEntry.toMillis();
  });
  
  // Track portfolio value at entry time for each trade
  const tradePortfolioAtEntry = new Map<Trade, number>();
  let currentPortfolio = initialValue;
  
  // First pass: determine portfolio value at entry time for each trade
  for (const trade of sortedTrades) {
    const entryTime = trade.entryTime || trade.alertTime;
    
    // Store portfolio value at entry
    tradePortfolioAtEntry.set(trade, currentPortfolio);
    
    // If trade has closed, update portfolio for next trades
    if (trade.exitTime && trade.pnl) {
      const portfolioAtEntry = currentPortfolio;
      const positionSize = portfolioAtEntry * positionSizePercent;
      const tradeReturn = positionSize * (trade.pnl - 1.0);
      currentPortfolio = currentPortfolio + tradeReturn;
      
      if (currentPortfolio < 0) currentPortfolio = 0;
    }
  }
  
  // Now calculate weekly returns
  const history: WeeklyPortfolioData[] = [];
  let runningPortfolio = initialValue;
  
  for (const week of weeks) {
    const weekStart = DateTime.fromISO(week);
    const weekAlerts = weeklyAlerts.get(week) || [];
    const weekExits = weeklyExits.get(week) || [];
    
    // Calculate returns from trades that closed this week
    const portfolioAtWeekStart = runningPortfolio;
    let weeklyReturn = 0;
    
    // Sort exits by exit time to process in order
    const sortedExits = [...weekExits].sort((a, b) => {
      if (!a.exitTime || !b.exitTime) return 0;
      return a.exitTime.toMillis() - b.exitTime.toMillis();
    });
    
    for (const trade of sortedExits) {
      if (trade.pnl && trade.exitTime) {
        const portfolioAtEntry = tradePortfolioAtEntry.get(trade);
        if (portfolioAtEntry !== undefined) {
          const positionSize = portfolioAtEntry * positionSizePercent;
          const tradeReturn = positionSize * (trade.pnl - 1.0);
          weeklyReturn += tradeReturn;
        }
      }
    }
    
    // Update running portfolio
    runningPortfolio = runningPortfolio + weeklyReturn;
    if (runningPortfolio < 0) runningPortfolio = 0;
    
    const weeklyReturnPercent = portfolioAtWeekStart > 0 
      ? (weeklyReturn / portfolioAtWeekStart) * 100 
      : 0;
    
    history.push({
      week: week,
      date: weekStart,
      portfolioValue: runningPortfolio,
      tradesThisWeek: weekAlerts.length,
      weeklyReturn: weeklyReturnPercent,
    });
  }

  return history;
}

/**
 * Fetch token metadata from local DB, CSV, or API
 */
async function fetchTokenMetadata(tokenAddress: string): Promise<{ name: string; symbol: string }> {
  // Try local DB first (use correct path)
  try {
    const sqlite3 = require('sqlite3');
    const { promisify } = require('util');
    const dbPath = process.env.CALLER_DB_PATH || path.join(__dirname, '../data/caller_alerts.db');
    
    if (fs.existsSync(dbPath)) {
      const db = new sqlite3.Database(dbPath);
      const get = promisify(db.get.bind(db));
      
      const result: any = await get(
        'SELECT token_symbol FROM caller_alerts WHERE token_address = ? AND token_symbol IS NOT NULL AND token_symbol != "UNKNOWN" AND token_symbol != "" LIMIT 1',
        [tokenAddress.toLowerCase()]
      );
      db.close();
      
      if (result && result.token_symbol) {
        return { name: result.token_symbol, symbol: result.token_symbol };
      }
    }
  } catch (err) {
    // Continue to next source
  }

  // Try local CSV
  try {
    const csvContent = fs.readFileSync(CALLS_CSV, 'utf-8');
    const records: any[] = await new Promise((resolve, reject) => {
      parse(csvContent, { columns: true, skip_empty_lines: true }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    const match = records.find(r => {
      const addr = (r.tokenAddress || r.token_address || '').toLowerCase();
      const symbol = r.tokenSymbol || r.token_symbol || '';
      return addr === tokenAddress.toLowerCase() && symbol && symbol !== 'UNKNOWN' && symbol !== '';
    });
    
    if (match) {
      const symbol = match.tokenSymbol || match.token_symbol || '';
      const name = match.tokenName || match.token_name || symbol;
      return {
        name: name || `Token ${tokenAddress.slice(0, 8)}`,
        symbol: symbol,
      };
    }
  } catch (err) {
    // Continue to next source
  }

  // Try Solscan (free)
  try {
    const response = await axios.get(`https://public-api.solscan.io/token/meta?tokenAddress=${tokenAddress}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
      timeout: 5000,
    });
    
    if (response.data && typeof response.data === 'object' && !response.data.error) {
      return {
        name: response.data.name || response.data.symbol || `Token ${tokenAddress.slice(0, 8)}`,
        symbol: response.data.symbol || tokenAddress.slice(0, 8),
      };
    }
  } catch (err) {
    // Continue to Birdeye
  }

  // Try Birdeye as last resort
  try {
    const response = await axios.get(`https://public-api.birdeye.so/defi/v3/token/meta-data/single`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': 'solana',
      },
      params: { address: tokenAddress },
      timeout: 5000,
    });
    
    if (response.data?.data) {
      return {
        name: response.data.data.name || response.data.data.symbol || `Token ${tokenAddress.slice(0, 8)}`,
        symbol: response.data.data.symbol || tokenAddress.slice(0, 8),
      };
    }
  } catch (err) {
    // Fall through
  }

  return { name: `Token ${tokenAddress.slice(0, 8)}`, symbol: tokenAddress.slice(0, 8) };
}

/**
 * Generate weekly report HTML
 */
async function generateReport(
  strategy: typeof TOP_STRATEGIES[0],
  portfolioHistory: WeeklyPortfolioData[],
  trades: Trade[],
  weekStart: DateTime,
  weekEnd: DateTime
): Promise<string> {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  let html = template;

  // Get trades that closed this week (for this week's report)
  const weekTrades = trades.filter(t => {
    if (!t.exitTime) return false;
    const exitWeek = t.exitTime.startOf('week');
    return exitWeek.hasSame(weekStart, 'week');
  });

  // Find week data from portfolio history
  let weekData = portfolioHistory.find(w => 
    w.date.hasSame(weekStart, 'week')
  );
  
  // If week not found, calculate from closed trades
  if (!weekData) {
    const positionSizePercent = 0.02;
    let weeklyReturn = 0;
    for (const trade of weekTrades) {
      if (trade.pnl) {
        weeklyReturn += (trade.pnl - 1.0) * positionSizePercent;
      }
    }
    
    const prevWeeks = portfolioHistory.filter(w => w.date < weekStart).sort((a, b) => a.date.toMillis() - b.date.toMillis());
    const portfolioBefore = prevWeeks.length > 0 
      ? prevWeeks[prevWeeks.length - 1].portfolioValue 
      : 100;
    
    weekData = {
      week: weekStart.toFormat('yyyy-MM-dd'),
      date: weekStart,
      portfolioValue: portfolioBefore * (1 + weeklyReturn),
      tradesThisWeek: weekTrades.length,
      weeklyReturn: weeklyReturn * 100,
    };
  }

  // Calculate initial balance (portfolio value at start of week)
  const prevWeeks = portfolioHistory.filter(w => w.date < weekStart).sort((a, b) => a.date.toMillis() - b.date.toMillis());
  const initialBalance = prevWeeks.length > 0 
    ? prevWeeks[prevWeeks.length - 1].portfolioValue 
    : 100;
  const finalBalance = weekData.portfolioValue;
  const totalReturn = ((finalBalance / initialBalance) - 1) * 100;

  // Calculate stats
  const totalTrades = weekTrades.length;
  const winners = weekTrades.filter(t => t.pnl > 1.0).length;
  const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0;
  
  // Count re-entries (trades with same token address appearing multiple times)
  const tokenCounts = new Map<string, number>();
  for (const trade of weekTrades) {
    tokenCounts.set(trade.tokenAddress, (tokenCounts.get(trade.tokenAddress) || 0) + 1);
  }
  const reentries = Array.from(tokenCounts.values()).filter(count => count > 1).length;
  const reentryRate = totalTrades > 0 ? (reentries / totalTrades) * 100 : 0;

  // Calculate trade outcomes
  const takeProfits = weekTrades.filter(t => t.pnl >= 1.5).length;
  const stopLosses = weekTrades.filter(t => t.pnl < 0.8).length;
  const timeouts = weekTrades.filter(t => t.pnl >= 0.8 && t.pnl < 1.5).length;

  // Calculate take profit distribution
  const tp2x = weekTrades.filter(t => t.pnl >= 2.0 && t.pnl < 3.0).length;
  const tp3x = weekTrades.filter(t => t.pnl >= 3.0 && t.pnl < 5.0).length;
  const tp5x = weekTrades.filter(t => t.pnl >= 5.0).length;

  // Replace title
  html = html.replace(
    /<title>.*?<\/title>/,
    `<title>${strategy.displayName} - Weekly Report (${weekStart.toFormat('MMM dd')} - ${weekEnd.toFormat('MMM dd, yyyy')})</title>`
  );

  // Replace header
  html = html.replace(
    /<h1>.*?<\/h1>/,
    `<h1>📈 ${strategy.displayName} - Weekly Report</h1>`
  );

  // Replace description
  html = html.replace(
    /<p style="text-align: center;.*?<\/p>/,
    `<p style="text-align: center; font-size: 1.1em; color: #666; margin-bottom: 30px;">
      Week of ${weekStart.toFormat('MMM dd')} - ${weekEnd.toFormat('MMM dd, yyyy')}
    </p>`
  );

  // Replace stats grid
  html = html.replace(
    /<div class="stat-card">\s*<h3>Initial Balance<\/h3>\s*<p>.*?<\/p>\s*<\/div>/,
    `<div class="stat-card">
                <h3>Initial Balance</h3>
                <p>${initialBalance.toFixed(4)} SOL</p>
            </div>`
  );

  html = html.replace(
    /<div class="stat-card">\s*<h3>Final Balance<\/h3>\s*<p class="positive">.*?<\/p>\s*<\/div>/,
    `<div class="stat-card">
                <h3>Final Balance</h3>
                <p class="${totalReturn >= 0 ? 'positive' : 'negative'}">${finalBalance.toFixed(4)} SOL</p>
            </div>`
  );

  html = html.replace(
    /<div class="stat-card">\s*<h3>Total Return<\/h3>\s*<p class="positive">.*?<\/p>\s*<\/div>/,
    `<div class="stat-card">
                <h3>Total Return</h3>
                <p class="${totalReturn >= 0 ? 'positive' : 'negative'}">${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%</p>
            </div>`
  );

  html = html.replace(
    /<div class="stat-card">\s*<h3>Total Trades<\/h3>\s*<p>.*?<\/p>\s*<\/div>/,
    `<div class="stat-card">
                <h3>Total Trades</h3>
                <p>${totalTrades}</p>
            </div>`
  );

  html = html.replace(
    /<div class="stat-card">\s*<h3>Win Rate<\/h3>\s*<p class="negative">.*?<\/p>\s*<\/div>/,
    `<div class="stat-card">
                <h3>Win Rate</h3>
                <p class="${winRate >= 50 ? 'positive' : winRate >= 30 ? 'neutral' : 'negative'}">${winRate.toFixed(2)}%</p>
            </div>`
  );

  html = html.replace(
    /<div class="stat-card">\s*<h3>Re-entry Rate<\/h3>\s*<p class="neutral">.*?<\/p>\s*<\/div>/,
    `<div class="stat-card">
                <h3>Re-entry Rate</h3>
                <p class="neutral">${reentryRate.toFixed(2)}%</p>
            </div>`
  );

  // Replace chart data
  html = html.replace(
    /data: \[3, 9, 8\]/,
    `data: [${takeProfits}, ${stopLosses}, ${timeouts}]`
  );

  html = html.replace(
    /data: \[0, 0, 0\]/,
    `data: [${tp2x}, ${tp3x}, ${tp5x}]`
  );

  // Generate trades table
  let tradesTableRows = '';
  for (const trade of weekTrades.sort((a, b) => b.alertTime.toMillis() - a.alertTime.toMillis())) {
    const metadata = await fetchTokenMetadata(trade.tokenAddress);
    const entryPrice = trade.entryPrice || 0;
    const exitPrice = trade.exitPrice || (entryPrice * trade.pnl);
    const pnlSol = (trade.pnl - 1.0) * (initialBalance * 0.02); // Approximate PnL in SOL
    
    // Determine exit reason
    let exitReason = 'timeout';
    if (trade.pnl >= 1.5) {
      if (trade.pnl >= 5.0) exitReason = 'take_profit_5x';
      else if (trade.pnl >= 3.0) exitReason = 'take_profit_3x';
      else if (trade.pnl >= 2.0) exitReason = 'take_profit_2x';
      else exitReason = 'take_profit';
    } else if (trade.pnl < 0.8) {
      exitReason = 'stop_loss';
    }

    // Check if re-entry
    const tokenCount = tokenCounts.get(trade.tokenAddress) || 1;
    const isReentry = tokenCount > 1;

    tradesTableRows += `
                    <tr>
                        <td>${trade.tokenAddress.substring(0, 13)}...</td>
                        <td>$${entryPrice.toFixed(8)}</td>
                        <td>$${exitPrice.toFixed(8)}</td>
                        <td class="${pnlSol >= 0 ? 'positive' : 'negative'}">${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)}</td>
                        <td>${exitReason}</td>
                        <td>${isReentry ? 'Yes' : 'No'}</td>
                        <td>${tokenCount}</td>
                    </tr>
                `;
  }

  // Replace trades table body
  html = html.replace(
    /<tbody>[\s\S]*?<\/tbody>/,
    `<tbody>${tradesTableRows}
            </tbody>`
  );

  return html;
}

/**
 * Generate weekly reports for a specific strategy with options
 */
export async function generateStrategyWeeklyReports(options: {
  strategyType: 'tenkan-kijun' | 'optimized';
  strategyName?: string;
  simulationTimestamp?: string;
  startDate: string;
  endDate: string;
  callers?: string[];
  outputDir?: string;
  runSimulationsIfMissing?: boolean;
  chain?: 'solana' | 'all';
}) {
  const startDate = DateTime.fromISO(options.startDate);
  const endDate = DateTime.fromISO(options.endDate);
  
  // Build strategy config
  let strategyConfig: typeof TOP_STRATEGIES[0];
  
  if (options.strategyType === 'tenkan-kijun') {
    strategyConfig = TOP_STRATEGIES[0]; // First one is Tenkan-Kijun
  } else {
    if (!options.strategyName || !options.simulationTimestamp) {
      throw new Error('strategyName and simulationTimestamp required for optimized strategies');
    }
    
    // Find or create strategy config
    strategyConfig = {
      name: options.strategyName,
      displayName: options.strategyName.replace(/_/g, ' '),
      category: 'Custom',
      type: 'optimized',
      tradeHistoryPath: path.join(__dirname, `../data/exports/solana-callers-optimized/${options.simulationTimestamp}`),
    };
  }
  
  const outputDir = options.outputDir || OUTPUT_DIR;
  const chain = options.chain || 'solana';
  
  // Generate weeks
  const weeks: DateTime[] = [];
  let currentWeek = startDate.startOf('week');
  const endWeek = endDate.startOf('week');
  
  while (currentWeek <= endWeek) {
    weeks.push(currentWeek);
    currentWeek = currentWeek.plus({ weeks: 1 });
  }
  
  // Load calls data
  console.log('📂 Loading all calls data...');
  const csv = fs.readFileSync(CALLS_CSV, 'utf8');
  const allCalls: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  // Filter to chain
  const filteredCalls = allCalls.filter(r => {
    if (chain === 'all') return true;
    const callChain = (r.chain || 'solana').toLowerCase();
    return callChain === chain;
  });
  console.log(`✅ Loaded ${filteredCalls.length} ${chain} calls\n`);
  
  // Process strategy
  console.log(`\n📊 Processing strategy: ${strategyConfig.displayName}`);
  
  const allTrades: Trade[] = [];
  
  // Process each week independently
  for (const weekStart of weeks) {
    const weekEnd = weekStart.plus({ days: 6, hours: 23, minutes: 59 });
    const weekKey = weekStart.toFormat('yyyy-MM-dd');
    
    console.log(`   Processing week ${weekKey}...`);
    
    // Get calls for this week
    const weekCalls = filteredCalls.filter(call => {
      const timestamp = call.timestamp || call.alertTime;
      if (!timestamp) return false;
      const alertTime = DateTime.fromISO(timestamp);
      if (!alertTime.isValid) return false;
      const alertWeek = alertTime.startOf('week');
      return alertWeek.hasSame(weekStart, 'week');
    });
    
    console.log(`      Found ${weekCalls.length} calls for this week`);
    
    // Load or generate trades for this week
    let weekTrades: Trade[] = [];
    
    if (strategyConfig.type === 'tenkan-kijun') {
      const allTenkanTrades = await loadTenkanKijunTrades();
      weekTrades = allTenkanTrades.filter(t => {
        const alertWeek = t.alertTime.startOf('week');
        return alertWeek.hasSame(weekStart, 'week');
      });
    } else {
      weekTrades = await loadOrGenerateWeekTrades(strategyConfig, weekCalls, weekStart, weekEnd);
    }
    
    if (weekTrades.length > 0) {
      allTrades.push(...weekTrades);
      console.log(`      Loaded ${weekTrades.length} trades for this week`);
    } else {
      console.log(`      No trades found for this week`);
    }
  }
  
  // Generate portfolio history from all trades
  const portfolioHistory = generateWeeklyPortfolioHistory(allTrades);
  console.log(`   Total: ${allTrades.length} trades across ${portfolioHistory.length} weeks`);
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Generate reports for each week
  for (const weekStart of weeks) {
    const weekEnd = weekStart.plus({ days: 6, hours: 23, minutes: 59 });
    const weekKey = weekStart.toFormat('yyyy-MM-dd');
    
    console.log(`   Generating report for week ${weekKey}...`);
    
    // Filter trades to only this week
    const weekTrades = allTrades.filter(t => {
      const alertWeek = t.alertTime.startOf('week');
      return alertWeek.hasSame(weekStart, 'week');
    });
    
    const html = await generateReport(strategyConfig, portfolioHistory, weekTrades, weekStart, weekEnd);
    
    const strategySlug = strategyConfig.name.replace(/[^a-zA-Z0-9]/g, '_');
    const outputPath = path.join(outputDir, `${strategySlug}_${weekKey}.html`);
    fs.writeFileSync(outputPath, html);
  }
  
  console.log(`   ✅ Completed ${strategyConfig.displayName}`);
  console.log(`   Generated ${weeks.length} weekly reports`);
  console.log(`   Output directory: ${outputDir}`);
}

/**
 * Main function (for CLI usage)
 */
async function main() {
  console.log('🚀 Generating weekly reports for top strategies...\n');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Define weeks (September to November 2025, including recent weeks up to today)
  const weeks: DateTime[] = [];
  let currentWeek = DateTime.fromISO('2025-09-01').startOf('week');
  // Include weeks up to the current week (Nov 24, 2025)
  const endWeek = DateTime.now().startOf('week');
  
  while (currentWeek <= endWeek) {
    weeks.push(currentWeek);
    currentWeek = currentWeek.plus({ weeks: 1 });
  }

  // Load all calls data once
  console.log('📂 Loading all calls data...');
  const csv = fs.readFileSync(CALLS_CSV, 'utf8');
  const allCalls: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });
  
  // Filter to Solana-only
  const solanaCalls = allCalls.filter(r => {
    const chain = (r.chain || 'solana').toLowerCase();
    return chain === 'solana';
  });
  console.log(`✅ Loaded ${solanaCalls.length} Solana calls\n`);

  for (const strategy of TOP_STRATEGIES) {
    console.log(`\n📊 Processing strategy: ${strategy.displayName}`);
    
    // For each week, get trades for that specific week
    const allTrades: Trade[] = [];
    const allPortfolioHistory: WeeklyPortfolioData[] = [];

    // Process each week independently
    for (const weekStart of weeks) {
      const weekEnd = weekStart.plus({ days: 6, hours: 23, minutes: 59 });
      const weekKey = weekStart.toFormat('yyyy-MM-dd');
      
      console.log(`   Processing week ${weekKey}...`);
      
      // Get calls for this week
      const weekCalls = solanaCalls.filter(call => {
        const timestamp = call.timestamp || call.alertTime;
        if (!timestamp) return false;
        const alertTime = DateTime.fromISO(timestamp);
        if (!alertTime.isValid) return false;
        const alertWeek = alertTime.startOf('week');
        return alertWeek.hasSame(weekStart, 'week');
      });
      
      console.log(`      Found ${weekCalls.length} calls for this week`);
      
      // Load or generate trades for this week
      let weekTrades: Trade[] = [];
      
      if (strategy.type === 'tenkan-kijun') {
        // For Tenkan-Kijun, load from existing files
        const allTenkanTrades = await loadTenkanKijunTrades();
        weekTrades = allTenkanTrades.filter(t => {
          const alertWeek = t.alertTime.startOf('week');
          return alertWeek.hasSame(weekStart, 'week');
        });
      } else {
        // For optimized strategies, check if simulation exists, if not run it
        weekTrades = await loadOrGenerateWeekTrades(strategy, weekCalls, weekStart, weekEnd);
      }
      
      if (weekTrades.length > 0) {
        allTrades.push(...weekTrades);
        console.log(`      Loaded ${weekTrades.length} trades for this week`);
      } else {
        console.log(`      No trades found for this week`);
      }
    }
    
    // Generate portfolio history from all trades
    const portfolioHistory = generateWeeklyPortfolioHistory(allTrades);
    console.log(`   Total: ${allTrades.length} trades across ${portfolioHistory.length} weeks`);

    // Generate reports for each week using only that week's trades
    for (const weekStart of weeks) {
      const weekEnd = weekStart.plus({ days: 6, hours: 23, minutes: 59 });
      const weekKey = weekStart.toFormat('yyyy-MM-dd');
      
      console.log(`   Generating report for week ${weekKey}...`);
      
      // Filter trades to only this week
      const weekTrades = allTrades.filter(t => {
        const alertWeek = t.alertTime.startOf('week');
        return alertWeek.hasSame(weekStart, 'week');
      });
      
      const html = await generateReport(strategy, portfolioHistory, weekTrades, weekStart, weekEnd);
      
      const strategySlug = strategy.name.replace(/[^a-zA-Z0-9]/g, '_');
      const outputPath = path.join(OUTPUT_DIR, `${strategySlug}_${weekKey}.html`);
      fs.writeFileSync(outputPath, html);
    }

    console.log(`   ✅ Completed ${strategy.displayName}`);
  }

  console.log('\n🎉 All weekly reports generated!');
  console.log(`   Output directory: ${OUTPUT_DIR}`);
}

if (require.main === module) {
  main().catch(console.error);
}

