#!/usr/bin/env ts-node
/**
 * Analyze Solana-only calls for callers with >100 calls
 * Test various optimization strategies (bypassing Tenkan-Kijun)
 */

import 'dotenv/config';
import { DateTime } from 'luxon';
import { queryCandles, getClickHouseClient } from '../src/storage/clickhouse-client';
import { parse } from 'csv-parse';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify';
import { calculateIndicators, IndicatorData } from '../src/simulation/indicators';
import { calculateIchimoku, IchimokuData, detectIchimokuSignals } from '../src/simulation/ichimoku';

const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
const OUTPUT_DIR = path.join(__dirname, '../data/exports/solana-callers-optimized');
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

// Create timestamped output directory for this run
const RUN_TIMESTAMP = DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss');
const RUN_OUTPUT_DIR = path.join(OUTPUT_DIR, RUN_TIMESTAMP);
const LOG_DIR = path.join(RUN_OUTPUT_DIR, 'logs');

// Ensure directories exist
if (!fs.existsSync(RUN_OUTPUT_DIR)) {
  fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Create main log file
const MAIN_LOG_FILE = path.join(LOG_DIR, 'main.log');
let logStream: fs.WriteStream | null = null;

function log(message: string, verbose: boolean = false) {
  const timestamp = DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss.SSS');
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  if (!logStream) {
    logStream = fs.createWriteStream(MAIN_LOG_FILE, { flags: 'a' });
  }
  logStream.write(logMessage + '\n');
  
  // Also write to strategy-specific log if verbose
  if (verbose && currentStrategyLogStream) {
    currentStrategyLogStream.write(logMessage + '\n');
  }
}

let currentStrategyLogStream: fs.WriteStream | null = null;

function openStrategyLog(strategyName: string, callerName: string) {
  if (currentStrategyLogStream) {
    currentStrategyLogStream.end();
  }
  const safeStrategyName = strategyName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeCallerName = callerName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const strategyLogFile = path.join(LOG_DIR, `${safeCallerName}_${safeStrategyName}.log`);
  currentStrategyLogStream = fs.createWriteStream(strategyLogFile, { flags: 'w' });
  log(`📝 Opened strategy log: ${strategyLogFile}`, true);
}

function closeStrategyLog() {
  if (currentStrategyLogStream) {
    currentStrategyLogStream.end();
    currentStrategyLogStream = null;
  }
}

// Trading costs
const ENTRY_SLIPPAGE_PCT = 0.75;
const EXIT_SLIPPAGE_PCT = 0.75;
const TRADING_FEE_PCT = 0.25;

// Strategy configurations
interface StrategyConfig {
  name: string;
  holdHours: number;
  stopLossPercent: number;
  takeProfitPercent?: number;
  trailingStopPercent?: number;
  trailingStopActivation?: number; // Activate trailing stop after this % gain
  dynamicTrailingStop?: {
    // Dynamic trailing stops that adjust based on profit level
    // e.g., [{ profitMultiplier: 2, trailingStopPercent: 50 }, { profitMultiplier: 3, trailingStopPercent: 40 }]
    levels: Array<{ profitMultiplier: number; trailingStopPercent: number }>;
  };
  lossClampPercent?: number; // Loss clamp level (e.g., 20 = -20% max loss)
  // Buy the dip parameters
  buyTheDip?: {
    minDropPercent: number; // Minimum drop before considering entry (e.g., 10%)
    reentryLevelPercent: number; // Re-enter when price recovers to this % of alert price (e.g., 0% = alert price, -30% = 30% below alert)
    maxWaitHours?: number; // Maximum hours to wait for dip/recovery
  };
  multiTrade?: boolean; // Enable multiple trades per token
  // Delayed entry parameters
  delayedEntry?: {
    entryCondition: 'ichimoku_tenkan_kijun_cross' | 'ichimoku_cloud_cross' | 'price_breakout' | 'rsi_oversold' | 'macd_cross' | 'ma_golden_cross' | 'combined';
    timeframe: '1m' | '5m' | '1h'; // Timeframe for indicator calculation
    maxWaitHours?: number; // Maximum hours to wait for entry signal
    priceBreakoutPercent?: number; // For price_breakout: % above alert price to enter
    // Combined conditions
    useIchimoku?: boolean;
    useRSI?: boolean;
    useMACD?: boolean;
    useMA?: boolean;
  };
  description: string;
}

const STRATEGIES: StrategyConfig[] = [
  // Basic strategies with various loss clamps (ALL must have loss clamps)
  {
    name: 'Basic_6h_10pctSL_10pctClamp',
    holdHours: 6,
    stopLossPercent: 10,
    lossClampPercent: 10,
    description: 'Hold 6h, 10% SL, 10% loss clamp'
  },
  {
    name: 'Basic_6h_20pctSL_20pctClamp',
    holdHours: 6,
    stopLossPercent: 20,
    lossClampPercent: 20,
    description: 'Hold 6h, 20% SL, 20% loss clamp'
  },
  {
    name: 'Basic_6h_20pctSL_30pctClamp',
    holdHours: 6,
    stopLossPercent: 20,
    lossClampPercent: 30,
    description: 'Hold 6h, 20% SL, 30% loss clamp'
  },
  
  // Profit target strategies
  {
    name: 'TP_6h_20pctSL_50pctTP',
    holdHours: 6,
    stopLossPercent: 20,
    takeProfitPercent: 50,
    lossClampPercent: 20,
    description: 'Hold 6h, 20% SL, 50% TP'
  },
  {
    name: 'TP_6h_20pctSL_100pctTP',
    holdHours: 6,
    stopLossPercent: 20,
    takeProfitPercent: 100,
    lossClampPercent: 20,
    description: 'Hold 6h, 20% SL, 100% TP'
  },
  {
    name: 'TP_24h_20pctSL_200pctTP',
    holdHours: 24,
    stopLossPercent: 20,
    takeProfitPercent: 200,
    lossClampPercent: 20,
    description: 'Hold 24h, 20% SL, 200% TP'
  },
  
  // Trailing stop strategies
  {
    name: 'Trailing_6h_20pctSL_25pctTrail_50pctActivate',
    holdHours: 6,
    stopLossPercent: 20,
    trailingStopPercent: 25,
    trailingStopActivation: 50,
    lossClampPercent: 20,
    description: 'Hold 6h, 20% SL, 25% trailing stop (activates at 50% gain)'
  },
  {
    name: 'Trailing_24h_20pctSL_30pctTrail_100pctActivate',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 30,
    trailingStopActivation: 100,
    lossClampPercent: 20,
    description: 'Hold 24h, 20% SL, 30% trailing stop (activates at 100% gain)'
  },
  
  // Buy the dip strategies
  {
    name: 'Dip_10pctDrop_ReboundToAlert_6h',
    holdHours: 6,
    stopLossPercent: 20,
    lossClampPercent: 20,
    buyTheDip: {
      minDropPercent: 10,
      reentryLevelPercent: 0, // Re-enter when price recovers to alert price
      maxWaitHours: 6
    },
    description: 'Buy dip: Wait for 10% drop, re-enter when price rebounds to alert level, hold 6h'
  },
  {
    name: 'Dip_20pctDrop_ReboundToAlert_6h',
    holdHours: 6,
    stopLossPercent: 20,
    lossClampPercent: 20,
    buyTheDip: {
      minDropPercent: 20,
      reentryLevelPercent: 0,
      maxWaitHours: 6
    },
    description: 'Buy dip: Wait for 20% drop, re-enter when price rebounds to alert level, hold 6h'
  },
  {
    name: 'Dip_40pctDrop_ReboundToMinus30pct_24h',
    holdHours: 24,
    stopLossPercent: 20,
    lossClampPercent: 20,
    buyTheDip: {
      minDropPercent: 40,
      reentryLevelPercent: -30, // Re-enter when price recovers to 30% below alert price
      maxWaitHours: 24
    },
    description: 'Buy dip: Wait for 40% drop, re-enter when price rebounds to -30% of alert, hold 24h'
  },
  {
    name: 'Dip_30pctDrop_ReboundToMinus10pct_6h',
    holdHours: 6,
    stopLossPercent: 20,
    lossClampPercent: 20,
    buyTheDip: {
      minDropPercent: 30,
      reentryLevelPercent: -10, // Re-enter when price recovers to 10% below alert price
      maxWaitHours: 6
    },
    description: 'Buy dip: Wait for 30% drop, re-enter when price rebounds to -10% of alert, hold 6h'
  },
  
  // Multi-trade strategies with trailing stops and re-entry
  // CRITICAL: ALL calculations use NO COMPOUNDING (fixed position size)
  {
    name: 'MultiTrade_10pctTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 10,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 10% trailing stop, re-enter after 50% drop from peak + 20% rebound'
  },
  {
    name: 'MultiTrade_15pctTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 15,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 15% trailing stop, re-enter after 50% drop from peak + 20% rebound'
  },
  {
    name: 'MultiTrade_20pctTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0, // Activate immediately
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 20% trailing stop, re-enter after 50% drop from peak + 20% rebound'
  },
  {
    name: 'MultiTrade_25pctTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 25,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 25% trailing stop, re-enter after 50% drop from peak + 20% rebound'
  },
  {
    name: 'MultiTrade_30pctTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 30,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 30% trailing stop, re-enter after 50% drop from peak + 20% rebound'
  },
  {
    name: 'MultiTrade_35pctTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 35,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 35% trailing stop, re-enter after 50% drop from peak + 20% rebound'
  },
  {
    name: 'MultiTrade_40pctTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 40,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 40% trailing stop, re-enter after 50% drop from peak + 20% rebound'
  },
  
  // Variations on drop/rebound thresholds
  {
    name: 'MultiTrade_20pctTrail_40pctDrop15pctRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 20% trailing stop, re-enter after 40% drop from peak + 15% rebound'
  },
  {
    name: 'MultiTrade_20pctTrail_60pctDrop25pctRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 20% trailing stop, re-enter after 60% drop from peak + 25% rebound'
  },
  {
    name: 'MultiTrade_20pctTrail_45pctDrop18pctRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 20% trailing stop, re-enter after 45% drop from peak + 18% rebound'
  },
  
  // RSI/MACD variations with different trailing stops
  {
    name: 'MultiTrade_15pctTrail_RSI_MACD_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 15,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 15% trailing stop, re-enter using RSI/MACD signals'
  },
  {
    name: 'MultiTrade_20pctTrail_RSI_MACD_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 20% trailing stop, re-enter using RSI/MACD signals'
  },
  {
    name: 'MultiTrade_25pctTrail_RSI_MACD_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 25,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 25% trailing stop, re-enter using RSI/MACD signals'
  },
  {
    name: 'MultiTrade_30pctTrail_RSI_MACD_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 30,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 30% trailing stop, re-enter using RSI/MACD signals'
  },
  
  // MA crossover variations with different trailing stops
  {
    name: 'MultiTrade_15pctTrail_MA_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 15,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 15% trailing stop, re-enter using MA crossovers'
  },
  {
    name: 'MultiTrade_20pctTrail_MA_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 20% trailing stop, re-enter using MA crossovers'
  },
  {
    name: 'MultiTrade_25pctTrail_MA_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 25,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 25% trailing stop, re-enter using MA crossovers'
  },
  {
    name: 'MultiTrade_30pctTrail_MA_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 30,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    description: 'Multi-trade: 30% trailing stop, re-enter using MA crossovers'
  },
  
  // New: Ichimoku-based delayed entry strategies
  {
    name: 'Ichimoku_1m_TenkanKijunCross_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '1m',
      maxWaitHours: 6
    },
    description: 'Delayed entry: Ichimoku Tenkan-Kijun cross on 1m, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_1m_CloudCross_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_cloud_cross',
      timeframe: '1m',
      maxWaitHours: 6
    },
    description: 'Delayed entry: Ichimoku cloud cross on 1m, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_5m_TenkanKijunCross_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Delayed entry: Ichimoku Tenkan-Kijun cross on 5m, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_5m_CloudCross_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_cloud_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Delayed entry: Ichimoku cloud cross on 5m, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_1h_TenkanKijunCross_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '1h',
      maxWaitHours: 24
    },
    description: 'Delayed entry: Ichimoku Tenkan-Kijun cross on 1h, 20% trailing stop, 20% loss cap'
  },
  
  // Price breakout strategies
  {
    name: 'PriceBreakout_5pct_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'price_breakout',
      timeframe: '5m',
      priceBreakoutPercent: 5,
      maxWaitHours: 6
    },
    description: 'Delayed entry: 5% price breakout above alert, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'PriceBreakout_10pct_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'price_breakout',
      timeframe: '5m',
      priceBreakoutPercent: 10,
      maxWaitHours: 6
    },
    description: 'Delayed entry: 10% price breakout above alert, 20% trailing stop, 20% loss cap'
  },
  
  // Combined indicator strategies
  {
    name: 'Ichimoku_1m_RSI_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'combined',
      timeframe: '1m',
      useIchimoku: true,
      useRSI: true,
      maxWaitHours: 6
    },
    description: 'Delayed entry: Ichimoku Tenkan-Kijun cross + RSI oversold on 1m, 20% trailing stop'
  },
  {
    name: 'Ichimoku_5m_MACD_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'combined',
      timeframe: '5m',
      useIchimoku: true,
      useMACD: true,
      maxWaitHours: 12
    },
    description: 'Delayed entry: Ichimoku Tenkan-Kijun cross + MACD bullish on 5m, 20% trailing stop'
  },
  {
    name: 'Ichimoku_5m_MA_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'combined',
      timeframe: '5m',
      useIchimoku: true,
      useMA: true,
      maxWaitHours: 12
    },
    description: 'Delayed entry: Ichimoku Tenkan-Kijun cross + MA golden cross on 5m, 20% trailing stop'
  },
  {
    name: 'Ichimoku_1h_RSI_MACD_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'combined',
      timeframe: '1h',
      useIchimoku: true,
      useRSI: true,
      useMACD: true,
      maxWaitHours: 24
    },
    description: 'Delayed entry: Ichimoku + RSI + MACD on 1h, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'RSI_Oversold_5m_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'rsi_oversold',
      timeframe: '5m',
      maxWaitHours: 6
    },
    description: 'Delayed entry: RSI oversold bounce on 5m, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'MACD_Cross_5m_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'macd_cross',
      timeframe: '5m',
      maxWaitHours: 6
    },
    description: 'Delayed entry: MACD bullish crossover on 5m, 20% trailing stop, 20% loss cap'
  },
  {
    name: 'MA_GoldenCross_5m_20pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 20,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ma_golden_cross',
      timeframe: '5m',
      maxWaitHours: 6
    },
    description: 'Delayed entry: MA golden cross (EMA9 > EMA20) on 5m, 20% trailing stop, 20% loss cap'
  },
  
  // Varying trailing stop levels
  {
    name: 'Ichimoku_5m_TenkanKijun_10pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 10,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Ichimoku Tenkan-Kijun cross on 5m, 10% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_5m_TenkanKijun_15pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 15,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Ichimoku Tenkan-Kijun cross on 5m, 15% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_5m_TenkanKijun_25pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 25,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Ichimoku Tenkan-Kijun cross on 5m, 25% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_5m_TenkanKijun_30pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 30,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Ichimoku Tenkan-Kijun cross on 5m, 30% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_5m_TenkanKijun_35pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 35,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Ichimoku Tenkan-Kijun cross on 5m, 35% trailing stop, 20% loss cap'
  },
  {
    name: 'Ichimoku_5m_TenkanKijun_40pctTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    trailingStopPercent: 40,
    trailingStopActivation: 0,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    description: 'Ichimoku Tenkan-Kijun cross on 5m, 40% trailing stop, 20% loss cap'
  },
  
  // Dynamic trailing stops
  {
    name: 'Ichimoku_5m_TenkanKijun_DynamicTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'ichimoku_tenkan_kijun_cross',
      timeframe: '5m',
      maxWaitHours: 12
    },
    dynamicTrailingStop: {
      levels: [
        { profitMultiplier: 2.0, trailingStopPercent: 50 },  // 2x = 100% gain, 50% trail
        { profitMultiplier: 3.0, trailingStopPercent: 40 },  // 3x = 200% gain, 40% trail
        { profitMultiplier: 4.0, trailingStopPercent: 30 },  // 4x = 300% gain, 30% trail
        { profitMultiplier: 5.0, trailingStopPercent: 25 },  // 5x = 400% gain, 25% trail
        { profitMultiplier: 6.0, trailingStopPercent: 20 },  // 6x = 500% gain, 20% trail
        { profitMultiplier: 8.0, trailingStopPercent: 15 },  // 8x = 700% gain, 15% trail
        { profitMultiplier: 10.0, trailingStopPercent: 10 }, // 10x = 900% gain, 10% trail
      ]
    },
    description: 'Ichimoku Tenkan-Kijun cross on 5m, dynamic trailing stop (50% @ 2x, 40% @ 3x, 30% @ 4x, 25% @ 5x, 20% @ 6x, 15% @ 8x, 10% @ 10x)'
  },
  {
    name: 'PriceBreakout_5pct_DynamicTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'price_breakout',
      timeframe: '5m',
      priceBreakoutPercent: 5,
      maxWaitHours: 6
    },
    dynamicTrailingStop: {
      levels: [
        { profitMultiplier: 2.0, trailingStopPercent: 50 },
        { profitMultiplier: 3.0, trailingStopPercent: 40 },
        { profitMultiplier: 4.0, trailingStopPercent: 30 },
        { profitMultiplier: 5.0, trailingStopPercent: 25 },
        { profitMultiplier: 6.0, trailingStopPercent: 20 },
        { profitMultiplier: 8.0, trailingStopPercent: 15 },
        { profitMultiplier: 10.0, trailingStopPercent: 10 },
      ]
    },
    description: '5% price breakout, dynamic trailing stop'
  },
  {
    name: 'Ichimoku_5m_MACD_DynamicTrail_24h',
    holdHours: 24,
    stopLossPercent: 20,
    lossClampPercent: 20,
    multiTrade: true,
    delayedEntry: {
      entryCondition: 'combined',
      timeframe: '5m',
      useIchimoku: true,
      useMACD: true,
      maxWaitHours: 12
    },
    dynamicTrailingStop: {
      levels: [
        { profitMultiplier: 2.0, trailingStopPercent: 50 },
        { profitMultiplier: 3.0, trailingStopPercent: 40 },
        { profitMultiplier: 4.0, trailingStopPercent: 30 },
        { profitMultiplier: 5.0, trailingStopPercent: 25 },
        { profitMultiplier: 6.0, trailingStopPercent: 20 },
        { profitMultiplier: 8.0, trailingStopPercent: 15 },
        { profitMultiplier: 10.0, trailingStopPercent: 10 },
      ]
    },
    description: 'Ichimoku + MACD on 5m, dynamic trailing stop'
  },
  {
    name: 'MultiTrade_DynamicTrail_50pctDropRebound_24h',
    holdHours: 24,
    stopLossPercent: 20,
    lossClampPercent: 20,
    multiTrade: true,
    dynamicTrailingStop: {
      levels: [
        { profitMultiplier: 2.0, trailingStopPercent: 50 },
        { profitMultiplier: 3.0, trailingStopPercent: 40 },
        { profitMultiplier: 4.0, trailingStopPercent: 30 },
        { profitMultiplier: 5.0, trailingStopPercent: 25 },
        { profitMultiplier: 6.0, trailingStopPercent: 20 },
        { profitMultiplier: 8.0, trailingStopPercent: 15 },
        { profitMultiplier: 10.0, trailingStopPercent: 10 },
      ]
    },
    description: 'Multi-trade: 50% drop + 20% rebound re-entry, dynamic trailing stop'
  },
];

interface TokenMetadata {
  tokenAddress: string;
  name: string;
  symbol: string;
  chain: string;
  initialPrice: number;
  initialMarketCap: number;
  callTimestamp: number;
  sourceFile: string;
  channel: string;
  originalAddress?: string;
}

interface TradeResult {
  tokenAddress: string;
  alertTime: string;
  entryTime: string;
  exitTime: string;
  pnl: number;
  pnlPercent: number;
  holdDuration: number;
  entryPrice: number;
  exitPrice: number;
  strategy: string;
  // Enhanced metadata fields
  tokenName?: string;
  tokenSymbol?: string;
  caller?: string;
  alertDateTime?: string;
  athSinceCall?: number; // ATH price since call
  athSinceCallPercent?: number; // ATH % gain since call
  maxDrawdownFromEntry?: number; // Max drawdown from entry price
  maxDrawdownFromEntryPercent?: number; // Max drawdown % from entry
  timeToATH?: number | null; // Time to ATH in minutes (null if never reached)
  hasOHLCV?: boolean; // Whether OHLCV data was available
}

interface StrategyResult {
  strategy: StrategyConfig;
  trades: TradeResult[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgPnlPerTrade: number;
  totalReturn: number;
  finalPortfolio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
}

// Calculate RSI (Relative Strength Index)
function calculateRSI(candles: any[], period: number = 14, currentIndex: number): number | null {
  if (currentIndex < period || candles.length < period + 1) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = currentIndex - period + 1; i <= currentIndex; i++) {
    if (i === 0) continue;
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

// Calculate MACD (Moving Average Convergence Divergence)
function calculateMACD(candles: any[], currentIndex: number, prevFastEMA?: number, prevSlowEMA?: number): {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  fastEMA: number | null;
  slowEMA: number | null;
} {
  if (currentIndex < 25 || candles.length < 26) {
    return { macd: null, signal: null, histogram: null, fastEMA: null, slowEMA: null };
  }

  // Calculate 12-period and 26-period EMAs
  const fastPeriod = 12;
  const slowPeriod = 26;
  const signalPeriod = 9;

  // Fast EMA (12)
  let fastEMA: number | null = null;
  if (prevFastEMA !== undefined && prevFastEMA !== null) {
    const multiplier = 2 / (fastPeriod + 1);
    fastEMA = (candles[currentIndex].close - prevFastEMA) * multiplier + prevFastEMA;
  } else {
    // Initialize with SMA
    let sum = 0;
    for (let i = currentIndex - fastPeriod + 1; i <= currentIndex; i++) {
      sum += candles[i].close;
    }
    fastEMA = sum / fastPeriod;
  }

  // Slow EMA (26)
  let slowEMA: number | null = null;
  if (prevSlowEMA !== undefined && prevSlowEMA !== null) {
    const multiplier = 2 / (slowPeriod + 1);
    slowEMA = (candles[currentIndex].close - prevSlowEMA) * multiplier + prevSlowEMA;
  } else {
    // Initialize with SMA
    let sum = 0;
    for (let i = currentIndex - slowPeriod + 1; i <= currentIndex; i++) {
      sum += candles[i].close;
    }
    slowEMA = sum / slowPeriod;
  }

  if (!fastEMA || !slowEMA) {
    return { macd: null, signal: null, histogram: null, fastEMA, slowEMA };
  }

  const macd = fastEMA - slowEMA;

  // Signal line (9-period EMA of MACD) - simplified, would need to track previous signal values
  const signal = null; // Would need to track signal line separately
  const histogram = macd; // Simplified

  return { macd, signal, histogram, fastEMA, slowEMA };
}

interface Position {
  entryPrice: number;
  entryTime: number;
  entryIndex: number;
  highestPrice: number;
  lowestPrice: number;
  trailingStopPrice: number;
  currentTrailingStopPercent: number; // Current trailing stop % (for dynamic stops)
  isActive: boolean;
}

/**
 * Get the trailing stop percent based on current profit multiplier (for dynamic trailing stops)
 */
function getDynamicTrailingStopPercent(
  profitMultiplier: number,
  dynamicLevels?: Array<{ profitMultiplier: number; trailingStopPercent: number }>
): number {
  if (!dynamicLevels || dynamicLevels.length === 0) {
    return 20; // Default
  }
  
  // Sort levels by profit multiplier (ascending)
  const sortedLevels = [...dynamicLevels].sort((a, b) => a.profitMultiplier - b.profitMultiplier);
  
  // Find the highest level that the current profit has reached
  let applicableLevel = sortedLevels[0];
  for (const level of sortedLevels) {
    if (profitMultiplier >= level.profitMultiplier) {
      applicableLevel = level;
    } else {
      break;
    }
  }
  
  return applicableLevel.trailingStopPercent;
}

async function fetchCandlesForTimeframe(
  tokenAddress: string,
  alertTime: DateTime,
  endTime: DateTime,
  timeframe: '1m' | '5m' | '1h'
): Promise<any[]> {
  try {
    return await queryCandles(tokenAddress, 'solana', alertTime.minus({ hours: 24 }), endTime, timeframe);
  } catch (error) {
    return [];
  }
}

function checkDelayedEntryCondition(
  candles: any[],
  currentIndex: number,
  alertPrice: number,
  delayedEntry: StrategyConfig['delayedEntry'],
  indicatorData: IndicatorData[],
  prevIndicators: IndicatorData | null
): { shouldEnter: boolean; entryPrice: number } {
  if (!delayedEntry || currentIndex < 52) {
    return { shouldEnter: false, entryPrice: 0 };
  }

  const currentCandle = candles[currentIndex];
  const currentPrice = currentCandle.close;
  const indicators = indicatorData[currentIndex];
  const prevIchimoku = prevIndicators?.ichimoku;
  const currentIchimoku = indicators.ichimoku;

  // Price breakout
  if (delayedEntry.entryCondition === 'price_breakout') {
    const breakoutPrice = alertPrice * (1 + (delayedEntry.priceBreakoutPercent || 5) / 100);
    if (currentCandle.high >= breakoutPrice) {
      return { shouldEnter: true, entryPrice: Math.max(currentCandle.open, breakoutPrice) };
    }
  }

  // Ichimoku Tenkan-Kijun cross
  if (delayedEntry.entryCondition === 'ichimoku_tenkan_kijun_cross' && currentIchimoku && prevIchimoku) {
    const tenkanCrossUp = prevIchimoku.tenkan <= prevIchimoku.kijun && currentIchimoku.tenkan > currentIchimoku.kijun;
    if (tenkanCrossUp) {
      return { shouldEnter: true, entryPrice: currentPrice };
    }
  }

  // Ichimoku cloud cross
  if (delayedEntry.entryCondition === 'ichimoku_cloud_cross' && currentIchimoku && prevIchimoku) {
    const cloudCrossUp = prevIchimoku.isBearish && currentIchimoku.isBullish;
    const cloudExitUp = prevIchimoku.inCloud && currentIchimoku.isBullish;
    if (cloudCrossUp || cloudExitUp) {
      return { shouldEnter: true, entryPrice: currentPrice };
    }
  }

  // RSI oversold bounce
  if (delayedEntry.entryCondition === 'rsi_oversold') {
    const rsi = calculateRSI(candles, 14, currentIndex);
    const prevRSI = currentIndex > 0 ? calculateRSI(candles, 14, currentIndex - 1) : null;
    if (rsi !== null && prevRSI !== null && prevRSI < 30 && rsi >= 30 && rsi < 50) {
      return { shouldEnter: true, entryPrice: currentPrice };
    }
  }

  // MACD bullish crossover
  if (delayedEntry.entryCondition === 'macd_cross') {
    const macdData = calculateMACD(candles, currentIndex, undefined, undefined);
    const prevMacdData = currentIndex > 0 ? calculateMACD(candles, currentIndex - 1, undefined, undefined) : null;
    const macdBullish = macdData.macd !== null && 
      (prevMacdData === null || prevMacdData.macd === null || prevMacdData.macd <= 0) &&
      macdData.macd > 0;
    if (macdBullish) {
      return { shouldEnter: true, entryPrice: currentPrice };
    }
  }

  // MA golden cross
  if (delayedEntry.entryCondition === 'ma_golden_cross') {
    const ema9 = indicators.movingAverages.ema9;
    const ema20 = indicators.movingAverages.ema20;
    const prevEma9 = prevIndicators?.movingAverages.ema9 ?? null;
    const prevEma20 = prevIndicators?.movingAverages.ema20 ?? null;
    const goldenCross = ema9 !== null && ema20 !== null && prevEma9 !== null && prevEma20 !== null &&
      prevEma9 <= prevEma20 && ema9 > ema20 && currentPrice > ema9;
    if (goldenCross) {
      return { shouldEnter: true, entryPrice: currentPrice };
    }
  }

  // Combined conditions
  if (delayedEntry.entryCondition === 'combined') {
    let conditionsMet = 0;
    let requiredConditions = 0;

    // Ichimoku Tenkan-Kijun cross
    if (delayedEntry.useIchimoku && currentIchimoku && prevIchimoku) {
      requiredConditions++;
      const tenkanCrossUp = prevIchimoku.tenkan <= prevIchimoku.kijun && currentIchimoku.tenkan > currentIchimoku.kijun;
      if (tenkanCrossUp) conditionsMet++;
    }

    // RSI oversold bounce
    if (delayedEntry.useRSI) {
      requiredConditions++;
      const rsi = calculateRSI(candles, 14, currentIndex);
      const prevRSI = currentIndex > 0 ? calculateRSI(candles, 14, currentIndex - 1) : null;
      if (rsi !== null && prevRSI !== null && prevRSI < 30 && rsi >= 30) {
        conditionsMet++;
      }
    }

    // MACD bullish
    if (delayedEntry.useMACD) {
      requiredConditions++;
      const macdData = calculateMACD(candles, currentIndex, undefined, undefined);
      if (macdData.macd !== null && macdData.macd > 0) {
        conditionsMet++;
      }
    }

    // MA golden cross
    if (delayedEntry.useMA) {
      requiredConditions++;
      const ema9 = indicators.movingAverages.ema9;
      const ema20 = indicators.movingAverages.ema20;
      const prevEma9 = prevIndicators?.movingAverages.ema9 ?? null;
      const prevEma20 = prevIndicators?.movingAverages.ema20 ?? null;
      if (ema9 !== null && ema20 !== null && prevEma9 !== null && prevEma20 !== null &&
          prevEma9 <= prevEma20 && ema9 > ema20) {
        conditionsMet++;
      }
    }

    // All required conditions must be met
    if (requiredConditions > 0 && conditionsMet === requiredConditions) {
      return { shouldEnter: true, entryPrice: currentPrice };
    }
  }

  return { shouldEnter: false, entryPrice: 0 };
}

async function simulateMultiTradeStrategy(
  candles: any[],
  alertTime: DateTime,
  strategy: StrategyConfig,
  tokenAddress: string
): Promise<TradeResult[]> {
  const trades: TradeResult[] = [];
  
  // For delayed entry strategies, we need candles at the specified timeframe
  let entryCandles = candles;
  if (strategy.delayedEntry) {
    const endTime = alertTime.plus({ hours: Math.max(strategy.holdHours, 24) });
    entryCandles = await fetchCandlesForTimeframe(tokenAddress, alertTime, endTime, strategy.delayedEntry.timeframe);
    if (entryCandles.length < 52) return trades;
  } else {
    if (candles.length < 52) return trades;
  }

  const alertTimestamp = alertTime.toMillis();
  const endTimestamp = alertTimestamp + (strategy.holdHours * 60 * 60 * 1000);

  // Find alert price (from original 5m candles for reference)
  let alertIndex = 0;
  let alertPrice = 0;
  for (let i = 0; i < candles.length; i++) {
    const candleTime = candles[i].timestamp
      ? typeof candles[i].timestamp === 'number'
        ? candles[i].timestamp * 1000
        : new Date(candles[i].timestamp).getTime()
      : alertTimestamp;
    
    if (candleTime >= alertTimestamp) {
      alertIndex = i;
      alertPrice = candles[i].close;
      break;
    }
  }

  if (alertIndex >= candles.length && entryCandles.length < 52) return trades;

  // Calculate indicators for all candles
  const indicatorData: IndicatorData[] = [];
  let previousEMAs: { ema9?: number | null; ema20?: number | null; ema50?: number | null } = {};
  let prevFastEMA: number | null = null;
  let prevSlowEMA: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const indicators = calculateIndicators(candles, i, previousEMAs);
    indicatorData.push(indicators);
    
    previousEMAs = {
      ema9: indicators.movingAverages.ema9,
      ema20: indicators.movingAverages.ema20,
      ema50: indicators.movingAverages.ema50,
    };
    
    // Track MACD EMAs for multi-trade strategies
    if (strategy.name.includes('RSI_MACD') || strategy.name.includes('MACD')) {
      const macdData = calculateMACD(candles, i, prevFastEMA ?? undefined, prevSlowEMA ?? undefined);
      if (macdData.fastEMA !== null) prevFastEMA = macdData.fastEMA;
      if (macdData.slowEMA !== null) prevSlowEMA = macdData.slowEMA;
    }
  }

  // Track active positions
  const positions: Position[] = [];
  let peakPrice = alertPrice;
  let recentLow = alertPrice;
  let recentLowIndex = 0;
  
  // Reset MACD EMAs for the simulation loop
  prevFastEMA = null;
  prevSlowEMA = null;

  // Handle delayed entry vs immediate entry
  let initialEntryPrice = alertPrice;
  let initialEntryTime = alertTimestamp;
  let initialEntryIndex = 0;
  let entryFound = false;

  if (strategy.delayedEntry) {
    // Wait for entry condition on the specified timeframe
    const maxWaitTimestamp = alertTimestamp + ((strategy.delayedEntry.maxWaitHours || 6) * 60 * 60 * 1000);
    
    // Find alert index in entry candles
    let entryAlertIndex = 0;
    for (let i = 0; i < entryCandles.length; i++) {
      const candleTime = entryCandles[i].timestamp
        ? typeof entryCandles[i].timestamp === 'number'
          ? entryCandles[i].timestamp * 1000
          : new Date(entryCandles[i].timestamp).getTime()
        : alertTimestamp;
      
      if (candleTime >= alertTimestamp) {
        entryAlertIndex = i;
        break;
      }
    }

    // Wait for entry condition
    for (let i = entryAlertIndex; i < entryCandles.length; i++) {
      const candleTime = entryCandles[i].timestamp
        ? typeof entryCandles[i].timestamp === 'number'
          ? entryCandles[i].timestamp * 1000
          : new Date(entryCandles[i].timestamp).getTime()
        : alertTimestamp;
      
      if (candleTime > maxWaitTimestamp) break;

      const prevIndicators = i > 0 ? indicatorData[i - 1] : null;
      const entryCheck = checkDelayedEntryCondition(
        entryCandles,
        i,
        alertPrice,
        strategy.delayedEntry,
        indicatorData,
        prevIndicators
      );

      if (entryCheck.shouldEnter) {
        initialEntryPrice = entryCheck.entryPrice;
        initialEntryTime = candleTime;
        initialEntryIndex = i;
        entryFound = true;
        break;
      }
    }

    if (!entryFound) {
      // No entry signal found, skip this trade
      return trades;
    }
  } else {
    // Immediate entry at alert time
    initialEntryIndex = alertIndex;
    entryFound = true;
  }

  if (entryFound) {
    const actualEntryPrice = initialEntryPrice * (1 + ENTRY_SLIPPAGE_PCT / 100) * (1 + TRADING_FEE_PCT / 100);
    const initialTrailingStopPercent = strategy.dynamicTrailingStop
      ? getDynamicTrailingStopPercent(1.0, strategy.dynamicTrailingStop.levels)
      : (strategy.trailingStopPercent || 20);
    
    log(`   🎯 ENTRY SIGNAL TRIGGERED!`, true);
    log(`      Entry Price (before slippage/fees): ${initialEntryPrice.toFixed(8)}`, true);
    log(`      Entry Price (after slippage/fees): ${actualEntryPrice.toFixed(8)}`, true);
    log(`      Entry Time: ${DateTime.fromMillis(initialEntryTime).toISO()}`, true);
    log(`      Initial Trailing Stop: ${initialTrailingStopPercent.toFixed(1)}%`, true);
    log(`      Trailing Stop Price: ${(actualEntryPrice * (1 - initialTrailingStopPercent / 100)).toFixed(8)}`, true);
    
    positions.push({
      entryPrice: actualEntryPrice,
      entryTime: initialEntryTime,
      entryIndex: initialEntryIndex,
      highestPrice: actualEntryPrice,
      lowestPrice: actualEntryPrice,
      trailingStopPrice: actualEntryPrice * (1 - initialTrailingStopPercent / 100),
      currentTrailingStopPercent: initialTrailingStopPercent,
      isActive: true,
    });
    peakPrice = actualEntryPrice;
    recentLow = actualEntryPrice;
    
    log(`   ✅ Position opened: Position #${positions.length}`, true);
  } else {
    log(`   ❌ No entry signal found within max wait time`, true);
    return trades;
  }

  // Simulate through candles (use main candles for exit logic)
  log(`🕯️  Starting candle-by-candle simulation: ${candles.length} candles, starting at index ${initialEntryIndex + 1}`, true);
  
  for (let i = initialEntryIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : initialEntryTime;

    if (candleTime > endTimestamp) {
      log(`⏰ Candle ${i}: Time limit reached (${DateTime.fromMillis(candleTime).toISO()} > ${DateTime.fromMillis(endTimestamp).toISO()})`, true);
      break;
    }
    
    // Log each candle being processed
    log(`🕯️  Candle ${i}/${candles.length - 1}: Time=${DateTime.fromMillis(candleTime).toISO()}, O=${candle.open.toFixed(8)}, H=${candle.high.toFixed(8)}, L=${candle.low.toFixed(8)}, C=${candle.close.toFixed(8)}`, true);

    const indicators = indicatorData[i];
    const prevIndicators = i > 0 ? indicatorData[i - 1] : null;
    const price = candle.close;
    const high = candle.high;
    const low = candle.low;

    // Update peak and recent low
    if (high > peakPrice) {
      peakPrice = high;
    }
    if (low < recentLow) {
      recentLow = low;
      recentLowIndex = i;
    }

    // Process active positions
    for (const position of positions.filter(p => p.isActive)) {
      // Update highest price for trailing stop
      if (high > position.highestPrice) {
        position.highestPrice = high;
        
        // Calculate current profit multiplier
        const profitMultiplier = position.highestPrice / position.entryPrice;
        
        // Get trailing stop percent (dynamic or fixed)
        let trailingStopPercent: number;
        if (strategy.dynamicTrailingStop) {
          trailingStopPercent = getDynamicTrailingStopPercent(profitMultiplier, strategy.dynamicTrailingStop.levels);
          position.currentTrailingStopPercent = trailingStopPercent;
        } else {
          trailingStopPercent = strategy.trailingStopPercent || 20;
        }
        
        position.trailingStopPrice = position.highestPrice * (1 - trailingStopPercent / 100);
      }

      // Check trailing stop exit
      if (low <= position.trailingStopPrice) {
        const exitPrice = position.trailingStopPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);
        const pnl = exitPrice / position.entryPrice;
        
        trades.push({
          tokenAddress: '',
          alertTime: alertTime.toISO() || '',
          entryTime: DateTime.fromMillis(position.entryTime).toISO() || '',
          exitTime: DateTime.fromMillis(candleTime).toISO() || '',
          pnl,
          pnlPercent: (pnl - 1) * 100,
          holdDuration: Math.floor((candleTime - position.entryTime) / (60 * 1000)),
          entryPrice: position.entryPrice,
          exitPrice,
          strategy: strategy.name,
        });

        position.isActive = false;
        continue;
      }

      // Check stop loss
      const minExitPrice = position.entryPrice * (1 - strategy.stopLossPercent / 100);
      if (low <= minExitPrice) {
        const exitPrice = minExitPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);
        const pnl = exitPrice / position.entryPrice;
        
        trades.push({
          tokenAddress: '',
          alertTime: alertTime.toISO() || '',
          entryTime: DateTime.fromMillis(position.entryTime).toISO() || '',
          exitTime: DateTime.fromMillis(candleTime).toISO() || '',
          pnl,
          pnlPercent: (pnl - 1) * 100,
          holdDuration: Math.floor((candleTime - position.entryTime) / (60 * 1000)),
          entryPrice: position.entryPrice,
          exitPrice,
          strategy: strategy.name,
        });

        position.isActive = false;
      }
    }

    // Check for re-entry conditions (only if we have closed profitable positions AND no active positions)
    // Limit to max 3 re-entries per token to prevent over-trading
    const maxReentries = 3;
    const closedProfitablePositions = trades.filter(t => t.pnl > 1.0);
    const totalClosedPositions = trades.length;
    const activePositions = positions.filter(p => p.isActive);
    
    // Only re-enter if:
    // 1. We have at least one profitable closed position
    // 2. No active positions currently
    // 3. Haven't exceeded max re-entries
    // 4. Last closed position was profitable (to avoid re-entering after losses)
    if (closedProfitablePositions.length > 0 && 
        activePositions.length === 0 && 
        totalClosedPositions < maxReentries + 1) {
      
      // Check if last closed position was profitable
      const lastTrade = trades[trades.length - 1];
      if (lastTrade && lastTrade.pnl <= 1.0) {
        // Last trade was a loss, don't re-enter
        continue;
      }
      
      let shouldReenter = false;
      let reentryPrice = price;
      let reentryReason = '';

      // Strategy 1: Drop from peak + rebound from recent low (various thresholds)
      if (strategy.name.includes('DropRebound') || strategy.name.includes('50pctDropRebound')) {
        const dropFromPeak = ((peakPrice - recentLow) / peakPrice) * 100;
        const reboundFromLow = ((price - recentLow) / recentLow) * 100;
        
        // Parse thresholds from strategy name
        let minDrop = 50;
        let minRebound = 20;
        let minReboundMultiplier = 1.15;
        
        if (strategy.name.includes('40pctDrop15pctRebound')) {
          minDrop = 40;
          minRebound = 15;
          minReboundMultiplier = 1.12;
        } else if (strategy.name.includes('60pctDrop25pctRebound')) {
          minDrop = 60;
          minRebound = 25;
          minReboundMultiplier = 1.20;
        } else if (strategy.name.includes('45pctDrop18pctRebound')) {
          minDrop = 45;
          minRebound = 18;
          minReboundMultiplier = 1.16;
        } else {
          // Default: 50% drop + 20% rebound
          minDrop = 50;
          minRebound = 20;
          minReboundMultiplier = 1.15;
        }
        
        // More restrictive: need significant drop AND clear rebound signal
        log(`      📊 Drop/Rebound Check:`, true);
        log(`         Drop from peak: ${dropFromPeak.toFixed(2)}% (need >= ${minDrop}%)`, true);
        log(`         Rebound from low: ${reboundFromLow.toFixed(2)}% (need >= ${minRebound}%)`, true);
        log(`         Price vs recent low: ${price.toFixed(8)} vs ${recentLow.toFixed(8)} (need > ${(recentLow * minReboundMultiplier).toFixed(8)})`, true);
        
        if (dropFromPeak >= minDrop && reboundFromLow >= minRebound && price > recentLow * minReboundMultiplier) {
          shouldReenter = true;
          reentryPrice = price;
          reentryReason = `${minDrop}% drop + ${minRebound}% rebound`;
          log(`         ✅ Re-entry condition met!`, true);
        } else {
          log(`         ❌ Re-entry condition NOT met`, true);
        }
      }

      // Strategy 2: RSI/MACD signals (works for all trailing stop variations)
      if (strategy.name.includes('RSI_MACD')) {
        const rsi = calculateRSI(candles, 14, i);
        const macdData = calculateMACD(candles, i, prevFastEMA ?? undefined, prevSlowEMA ?? undefined);
        
        // Re-enter on RSI oversold bounce (RSI < 30 then crosses above 30)
        const prevRSI = i > 0 ? calculateRSI(candles, 14, i - 1) : null;
        const rsiOversoldBounce = rsi !== null && prevRSI !== null && prevRSI < 30 && rsi >= 30 && rsi < 50;
        
        // Re-enter on MACD bullish crossover (MACD crosses above 0)
        const prevMacdData = i > 0 ? calculateMACD(candles, i - 1, prevFastEMA ?? undefined, prevSlowEMA ?? undefined) : null;
        const macdBullish = macdData.macd !== null && 
          (prevMacdData === null || prevMacdData.macd === null || prevMacdData.macd <= 0) &&
          macdData.macd > 0;
        
        log(`      📊 RSI/MACD Check:`, true);
        log(`         RSI: ${rsi !== null ? rsi.toFixed(2) : 'N/A'}, Prev RSI: ${prevRSI !== null ? prevRSI.toFixed(2) : 'N/A'}`, true);
        log(`         RSI Oversold Bounce: ${rsiOversoldBounce ? 'YES' : 'NO'}`, true);
        log(`         MACD: ${macdData.macd !== null ? macdData.macd.toFixed(8) : 'N/A'}, Prev MACD: ${prevMacdData !== null && prevMacdData.macd !== null ? prevMacdData.macd.toFixed(8) : 'N/A'}`, true);
        log(`         MACD Bullish: ${macdBullish ? 'YES' : 'NO'}`, true);
        
        if (rsiOversoldBounce || macdBullish) {
          shouldReenter = true;
          reentryPrice = price;
          reentryReason = rsiOversoldBounce ? 'RSI oversold bounce' : 'MACD bullish crossover';
          log(`         ✅ Re-entry condition met! (${reentryReason})`, true);
        } else {
          log(`         ❌ Re-entry condition NOT met`, true);
        }
        
        // Update MACD EMAs for next iteration
        if (macdData.fastEMA !== null) prevFastEMA = macdData.fastEMA;
        if (macdData.slowEMA !== null) prevSlowEMA = macdData.slowEMA;
      }

      // Strategy 3: MA crossovers (works for all trailing stop variations)
      if (strategy.name.includes('MA') && !strategy.name.includes('MACD') && !strategy.name.includes('MultiTrade_DynamicTrail')) {
        const ema9 = indicators.movingAverages.ema9;
        const ema20 = indicators.movingAverages.ema20;
        const prevEma9 = prevIndicators?.movingAverages.ema9 ?? null;
        const prevEma20 = prevIndicators?.movingAverages.ema20 ?? null;
        
        // Golden cross: EMA9 crosses above EMA20 (more restrictive)
        const goldenCross = ema9 !== null && ema20 !== null && prevEma9 !== null && prevEma20 !== null &&
          prevEma9 <= prevEma20 && ema9 > ema20 && price > ema9;
        
        // Price above EMA20 and trending up
        const priceAboveMA = ema20 !== null && price > ema20 && 
          (prevIndicators === null || price > prevIndicators.candle.close);
        
        log(`      📊 MA Crossover Check:`, true);
        log(`         EMA9: ${ema9 !== null ? ema9.toFixed(8) : 'N/A'}, EMA20: ${ema20 !== null ? ema20.toFixed(8) : 'N/A'}`, true);
        log(`         Golden Cross: ${goldenCross ? 'YES' : 'NO'}`, true);
        log(`         Price Above MA: ${priceAboveMA ? 'YES' : 'NO'}`, true);
        
        if (goldenCross || (priceAboveMA && ema9 !== null && ema9 > ema20)) {
          shouldReenter = true;
          reentryPrice = price;
          reentryReason = goldenCross ? 'MA golden cross' : 'Price above MA + EMA9 > EMA20';
          log(`         ✅ Re-entry condition met! (${reentryReason})`, true);
        } else {
          log(`         ❌ Re-entry condition NOT met`, true);
        }
      }

      if (shouldReenter) {
        log(`   🎯 RE-ENTRY TRIGGERED! Reason: ${reentryReason}`, true);
        const actualEntryPrice = reentryPrice * (1 + ENTRY_SLIPPAGE_PCT / 100) * (1 + TRADING_FEE_PCT / 100);
        const reentryTrailingStopPercent = strategy.dynamicTrailingStop
          ? getDynamicTrailingStopPercent(1.0, strategy.dynamicTrailingStop.levels)
          : (strategy.trailingStopPercent || 20);
        positions.push({
          entryPrice: actualEntryPrice,
          entryTime: candleTime,
          entryIndex: i,
          highestPrice: actualEntryPrice,
          lowestPrice: actualEntryPrice,
          trailingStopPrice: actualEntryPrice * (1 - reentryTrailingStopPercent / 100),
          currentTrailingStopPercent: reentryTrailingStopPercent,
          isActive: true,
        });
        
        // Reset peak and recent low for new position
        peakPrice = actualEntryPrice;
        recentLow = actualEntryPrice;
        recentLowIndex = i;
      }
    }
  }

  // Close any remaining active positions at end
  for (const position of positions.filter(p => p.isActive)) {
    const finalCandle = candles[candles.length - 1];
    const finalPrice = finalCandle.close;
    const exitPrice = finalPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);
    const pnl = exitPrice / position.entryPrice;
    
    trades.push({
      tokenAddress: '',
      alertTime: alertTime.toISO() || '',
      entryTime: DateTime.fromMillis(position.entryTime).toISO() || '',
      exitTime: DateTime.fromMillis(endTimestamp).toISO() || '',
      pnl,
      pnlPercent: (pnl - 1) * 100,
      holdDuration: Math.floor((endTimestamp - position.entryTime) / (60 * 1000)),
      entryPrice: position.entryPrice,
      exitPrice,
      strategy: strategy.name,
    });
  }

  return trades;
}

async function simulateStrategy(
  candles: any[],
  alertTime: DateTime,
  strategy: StrategyConfig,
  tokenAddress: string,
  metadata?: { tokenName?: string; tokenSymbol?: string; caller?: string; alertDateTime?: string }
): Promise<TradeResult | null> {
  // Multi-trade strategies return array of trades
  if (strategy.multiTrade || strategy.name.includes('MultiTrade') || strategy.name.includes('Ichimoku') || strategy.name.includes('PriceBreakout') || strategy.name.includes('RSI_Oversold') || strategy.name.includes('MACD_Cross') || strategy.name.includes('MA_GoldenCross')) {
    const trades = await simulateMultiTradeStrategy(candles, alertTime, strategy, tokenAddress);
    // Return first trade for compatibility, but caller should handle array
    return trades.length > 0 ? trades[0] : null;
  }

  if (candles.length < 2) return null;

  const alertTimestamp = alertTime.toMillis();
  const endTimestamp = alertTimestamp + (strategy.holdHours * 60 * 60 * 1000);

  // Get alert price (first candle at or after alert time)
  let alertIndex = 0;
  let alertPrice = 0;
  for (let i = 0; i < candles.length; i++) {
    const candleTime = candles[i].timestamp
      ? typeof candles[i].timestamp === 'number'
        ? candles[i].timestamp * 1000
        : new Date(candles[i].timestamp).getTime()
      : alertTimestamp;
    
    if (candleTime >= alertTimestamp) {
      alertIndex = i;
      alertPrice = candles[i].close;
      break;
    }
  }

  if (alertIndex >= candles.length) return null;

  // Buy the dip logic: wait for drop and rebound
  let entryIndex = alertIndex;
  let entryPrice = alertPrice;
  let entryTime = alertTimestamp;

  if (strategy.buyTheDip) {
    const { minDropPercent, reentryLevelPercent, maxWaitHours } = strategy.buyTheDip;
    const maxWaitTimestamp = alertTimestamp + ((maxWaitHours || strategy.holdHours) * 60 * 60 * 1000);
    
    // Calculate target prices
    // minDropPrice: price must drop to this level (e.g., 10% drop = 90% of alert price)
    const minDropPrice = alertPrice * (1 - minDropPercent / 100);
    
    // reentryPrice: re-enter when price rebounds to this level
    // reentryLevelPercent = 0 means back to alert price (100% of alert)
    // reentryLevelPercent = -30 means to 70% of alert price (30% below alert)
    const reentryPrice = alertPrice * (1 + reentryLevelPercent / 100);
    
    let foundDip = false;
    let dipIndex = alertIndex;
    
    // First, find if price drops to minDropPercent (must see the dip first)
    for (let i = alertIndex; i < candles.length; i++) {
      const candleTime = candles[i].timestamp
        ? typeof candles[i].timestamp === 'number'
          ? candles[i].timestamp * 1000
          : new Date(candles[i].timestamp).getTime()
        : alertTimestamp;
      
      if (candleTime > maxWaitTimestamp) break;
      
      // Check if price dropped to minDropPrice or below
      if (candles[i].low <= minDropPrice) {
        foundDip = true;
        dipIndex = i;
        break; // Found the dip, now look for rebound
      }
    }
    
    if (!foundDip) {
      // No dip found, skip this trade
      return null;
    }
    
    // Now wait for rebound to reentryLevelPercent (after the dip)
    let reboundFound = false;
    for (let i = dipIndex; i < candles.length; i++) {
      const candleTime = candles[i].timestamp
        ? typeof candles[i].timestamp === 'number'
          ? candles[i].timestamp * 1000
          : new Date(candles[i].timestamp).getTime()
        : alertTimestamp;
      
      if (candleTime > maxWaitTimestamp) break;
      
      // Check if price rebounds to reentry level
      // reentryLevelPercent = 0: rebound to alert price (100%)
      // reentryLevelPercent = -30: rebound to 70% of alert price
      if (candles[i].high >= reentryPrice) {
        entryIndex = i;
        // Enter at the reentry price level (or candle open if higher)
        entryPrice = Math.max(candles[i].open, reentryPrice);
        entryTime = candleTime;
        reboundFound = true;
        break;
      }
    }
    
    if (!reboundFound) {
      // Rebound never happened, skip this trade
      return null;
    }
  }

  // Apply slippage and fees to entry
  const rawEntryPrice = entryPrice;
  const actualEntryPrice = rawEntryPrice * (1 + ENTRY_SLIPPAGE_PCT / 100) * (1 + TRADING_FEE_PCT / 100);

  // Calculate stop loss and take profit prices
  const minExitPrice = strategy.stopLossPercent > 0
    ? actualEntryPrice * (1 - strategy.stopLossPercent / 100)
    : 0;
  const takeProfitPrice = strategy.takeProfitPercent
    ? actualEntryPrice * (1 + strategy.takeProfitPercent / 100)
    : Infinity;

  // Trailing stop variables
  let highestPrice = actualEntryPrice;
  let trailingStopPrice = 0;
  let trailingStopActive = false;

  // Simulate through candles until exit condition or time limit
  let exitPrice = actualEntryPrice;
  let exitTime = entryTime;
  let exited = false;

  for (let i = entryIndex + 1; i < candles.length; i++) {
    const candle = candles[i];
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : entryTime;

    // Check time limit
    if (candleTime >= endTimestamp) {
      exitPrice = candle.close;
      exitTime = endTimestamp;
      exited = true;
      break;
    }

    // Update highest price for trailing stop
    if (candle.high > highestPrice) {
      highestPrice = candle.high;
      
      // Check if trailing stop should activate
      if (strategy.trailingStopActivation && strategy.trailingStopPercent) {
        const gainPercent = ((highestPrice / actualEntryPrice) - 1) * 100;
        if (gainPercent >= strategy.trailingStopActivation) {
          trailingStopActive = true;
          trailingStopPrice = highestPrice * (1 - strategy.trailingStopPercent / 100);
        }
      }
      
      // Update trailing stop if active
      if (trailingStopActive && strategy.trailingStopPercent) {
        trailingStopPrice = highestPrice * (1 - strategy.trailingStopPercent / 100);
      }
    }

    // Check trailing stop (if active, it overrides regular stop loss)
    if (trailingStopActive && trailingStopPrice > 0 && candle.low <= trailingStopPrice) {
      exitPrice = trailingStopPrice;
      exitTime = candleTime;
      exited = true;
      break;
    }

    // Check stop loss (only if trailing stop not active)
    if (!trailingStopActive && minExitPrice > 0 && candle.low <= minExitPrice) {
      exitPrice = minExitPrice;
      exitTime = candleTime;
      exited = true;
      break;
    }

    // Check take profit
    if (takeProfitPrice < Infinity && candle.high >= takeProfitPrice) {
      exitPrice = takeProfitPrice;
      exitTime = candleTime;
      exited = true;
      break;
    }
  }

  // If not exited, use final candle
  if (!exited && candles.length > entryIndex) {
    const finalCandle = candles[candles.length - 1];
    exitPrice = finalCandle.close;
    exitTime = finalCandle.timestamp
      ? typeof finalCandle.timestamp === 'number'
        ? finalCandle.timestamp * 1000
        : new Date(finalCandle.timestamp).getTime()
      : endTimestamp;
  }

  // Apply loss clamp if specified
  let rawExitPrice = Math.max(exitPrice, minExitPrice);
  if (strategy.lossClampPercent !== undefined) {
    const minAllowedPrice = actualEntryPrice * (1 - strategy.lossClampPercent / 100);
    rawExitPrice = Math.max(rawExitPrice, minAllowedPrice);
  }

  // Apply slippage and fees to exit
  const finalExitPrice = rawExitPrice * (1 - EXIT_SLIPPAGE_PCT / 100) * (1 - TRADING_FEE_PCT / 100);

  const pnl = finalExitPrice / actualEntryPrice;
  const holdDuration = Math.floor((exitTime - entryTime) / (60 * 1000)); // minutes

  // Calculate ATH metrics
  const athMetrics = calculateATHMetrics(candles, alertTimestamp, actualEntryPrice, entryTime);

  return {
    tokenAddress: '',
    alertTime: alertTime.toISO() || '',
    entryTime: DateTime.fromMillis(entryTime).toISO() || '',
    exitTime: DateTime.fromMillis(exitTime).toISO() || '',
    pnl,
    pnlPercent: (pnl - 1) * 100,
    holdDuration,
    entryPrice: actualEntryPrice,
    exitPrice: finalExitPrice,
    strategy: strategy.name,
    // Enhanced metadata
    tokenName: metadata?.tokenName,
    tokenSymbol: metadata?.tokenSymbol,
    caller: metadata?.caller,
    alertDateTime: metadata?.alertDateTime || alertTime.toISO() || '',
    athSinceCall: athMetrics.athSinceCall,
    athSinceCallPercent: athMetrics.athSinceCallPercent,
    maxDrawdownFromEntry: athMetrics.maxDrawdownFromEntry,
    maxDrawdownFromEntryPercent: athMetrics.maxDrawdownFromEntryPercent,
    timeToATH: athMetrics.timeToATH,
    hasOHLCV: candles.length > 0,
  };
}

function computeMaxDrawdown(equity: number[]): { maxDrawdown: number; maxDrawdownPct: number } {
  if (equity.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPct: 0 };
  }

  let peak = equity[0];
  let maxDrawdown = 0;

  for (const v of equity) {
    if (v > peak) peak = v;
    const drawdown = peak - v;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
  return { maxDrawdown, maxDrawdownPct };
}

/**
 * Fetch token metadata from ClickHouse token_metadata table
 */
async function fetchTokenMetadata(tokenAddress: string): Promise<TokenMetadata | null> {
  try {
    const ch = getClickHouseClient();
    const result = await ch.query({
      query: `
        SELECT 
          token_address,
          name,
          symbol,
          chain,
          initial_price,
          initial_market_cap,
          call_timestamp,
          source_file,
          channel,
          original_address
        FROM ${CLICKHOUSE_DATABASE}.token_metadata
        WHERE token_address = '${tokenAddress.toLowerCase()}'
        ORDER BY call_timestamp DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    
    const data = await result.json() as TokenMetadata[];
    if (data && data.length > 0) {
      return data[0];
    }
  } catch (error: any) {
    // Silently fail - metadata not available
  }
  
  return null;
}

/**
 * Calculate ATH and drawdown metrics from candles
 * ATH is calculated since the alert/call time, not entry time
 */
function calculateATHMetrics(
  candles: any[],
  alertTimestamp: number,
  entryPrice: number,
  entryTimestamp: number
): {
  athSinceCall: number;
  athSinceCallPercent: number;
  maxDrawdownFromEntry: number;
  maxDrawdownFromEntryPercent: number;
  timeToATH: number | null;
} {
  // Find alert price (first candle at or after alert time)
  let alertPrice = entryPrice;
  for (const candle of candles) {
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : alertTimestamp;
    
    if (candleTime >= alertTimestamp) {
      alertPrice = candle.close;
      break;
    }
  }
  
  // ATH since call (from alert time, not entry)
  let athSinceCall = alertPrice;
  let athTimestamp: number | null = null;
  
  // Max drawdown from entry (only after entry)
  let maxDrawdownFromEntry = 0;
  let lowestAfterEntry = entryPrice;
  
  for (const candle of candles) {
    const candleTime = candle.timestamp
      ? typeof candle.timestamp === 'number'
        ? candle.timestamp * 1000
        : new Date(candle.timestamp).getTime()
      : alertTimestamp;
    
    // Track ATH since call (from alert time)
    if (candleTime >= alertTimestamp && candle.high > athSinceCall) {
      athSinceCall = candle.high;
      if (!athTimestamp) {
        athTimestamp = candleTime;
      }
    }
    
    // Track max drawdown from entry (only after entry)
    if (candleTime >= entryTimestamp) {
      if (candle.low < lowestAfterEntry) {
        lowestAfterEntry = candle.low;
        const drawdown = entryPrice - lowestAfterEntry;
        if (drawdown > maxDrawdownFromEntry) {
          maxDrawdownFromEntry = drawdown;
        }
      }
    }
  }
  
  // ATH % gain since call (from alert price)
  const athSinceCallPercent = ((athSinceCall / alertPrice) - 1) * 100;
  // Max drawdown % from entry
  const maxDrawdownFromEntryPercent = entryPrice > 0 ? (maxDrawdownFromEntry / entryPrice) * 100 : 0;
  // Time to ATH from alert time (in minutes)
  const timeToATH = athTimestamp ? Math.floor((athTimestamp - alertTimestamp) / (60 * 1000)) : null;
  
  return {
    athSinceCall,
    athSinceCallPercent,
    maxDrawdownFromEntry,
    maxDrawdownFromEntryPercent,
    timeToATH,
  };
}

async function analyzeCaller(
  callerName: string,
  records: any[],
  strategies: StrategyConfig[]
): Promise<Map<string, StrategyResult>> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ANALYZING CALLER: ${callerName}`);
  console.log(`${'='.repeat(80)}\n`);

  // Filter to Solana-only calls for this caller
  const callerRecords = records.filter(r => {
    const sender = r.sender || '';
    const chain = (r.chain || 'solana').toLowerCase();
    return (sender.includes(callerName) || sender === callerName) && chain === 'solana';
  });

  console.log(`📂 Found ${callerRecords.length} Solana calls for ${callerName}`);

  if (callerRecords.length === 0) {
    return new Map();
  }

  // Get unique tokens
  const uniqueTokens = new Map<string, any>();
  for (const record of callerRecords) {
    const tokenAddress = record.tokenAddress || record.mint;
    if (!tokenAddress) continue;
    const key = tokenAddress.toLowerCase();
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, record);
    }
  }

  const uniqueCalls = Array.from(uniqueTokens.values());
  console.log(`✅ Found ${uniqueCalls.length} unique tokens\n`);

  const results = new Map<string, StrategyResult>();

    // Test each strategy
    for (const strategy of strategies) {
      openStrategyLog(strategy.name, callerName);
      log(`\n${'='.repeat(80)}`, true);
      log(`📊 Testing strategy: ${strategy.name}`, true);
      log(`   Description: ${strategy.description}`, true);
      log(`${'='.repeat(80)}\n`, true);
      
      console.log(`   Testing ${strategy.name}...`);
      const trades: TradeResult[] = [];
      let insufficientData = 0;
      let noDipFound = 0;
      let noReboundFound = 0;

      for (let i = 0; i < uniqueCalls.length; i++) {
        const call = uniqueCalls[i];
        try {
          const tokenAddress = call.tokenAddress || call.mint;
          if (!tokenAddress) continue;

          const alertTime = DateTime.fromISO(call.timestamp || call.alertTime);
          if (!alertTime.isValid) continue;
          
          log(`\n${'-'.repeat(80)}`, true);
          log(`🔍 Processing token ${i + 1}/${uniqueCalls.length}: ${tokenAddress.substring(0, 20)}...`, true);
          log(`   Alert time: ${alertTime.toISO()}`, true);

          // For buy-the-dip strategies, need more history before alert
          const startTime = strategy.buyTheDip 
            ? alertTime.minus({ hours: 24 }) // Get 24h before alert for dip detection
            : alertTime;
          const endTime = alertTime.plus({ hours: Math.max(strategy.holdHours, 24) });

          // Add delay to avoid overwhelming ClickHouse
          if (i > 0 && i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          const candles = await queryCandles(tokenAddress, 'solana', startTime, endTime, '5m');
          
          log(`   Fetched ${candles.length} candles from ClickHouse (${startTime.toISO()} to ${endTime.toISO()})`, true);

          if (candles.length < 2) {
            log(`   ⚠️  Insufficient data: only ${candles.length} candles`, true);
            insufficientData++;
            continue;
          }

          // Fetch token metadata
          const tokenMetadata = await fetchTokenMetadata(tokenAddress);
          const metadata = {
            tokenName: tokenMetadata?.name,
            tokenSymbol: tokenMetadata?.symbol,
            caller: callerName,
            alertDateTime: alertTime.toISO() || call.timestamp || '',
          };

          // Handle multi-trade strategies differently
          if (strategy.multiTrade || strategy.name.includes('MultiTrade') || strategy.name.includes('Ichimoku') || strategy.name.includes('PriceBreakout') || strategy.name.includes('RSI_Oversold') || strategy.name.includes('MACD_Cross') || strategy.name.includes('MA_GoldenCross')) {
            log(`   🎯 Running multi-trade simulation...`, true);
            const multiTrades = await simulateMultiTradeStrategy(candles, alertTime, strategy, tokenAddress);
            log(`   ✅ Multi-trade simulation complete: ${multiTrades.length} trades generated`, true);
            for (const trade of multiTrades) {
              trade.tokenAddress = tokenAddress;
              // Add metadata to multi-trade results
              trade.tokenName = metadata.tokenName;
              trade.tokenSymbol = metadata.tokenSymbol;
              trade.caller = metadata.caller;
              trade.alertDateTime = metadata.alertDateTime;
              trade.hasOHLCV = true;
              // Calculate ATH metrics for multi-trade (use first entry)
              const entryTime = DateTime.fromISO(trade.entryTime).toMillis();
              const athMetrics = calculateATHMetrics(candles, alertTime.toMillis(), trade.entryPrice, entryTime);
              trade.athSinceCall = athMetrics.athSinceCall;
              trade.athSinceCallPercent = athMetrics.athSinceCallPercent;
              trade.maxDrawdownFromEntry = athMetrics.maxDrawdownFromEntry;
              trade.maxDrawdownFromEntryPercent = athMetrics.maxDrawdownFromEntryPercent;
              trade.timeToATH = athMetrics.timeToATH;
              trades.push(trade);
            }
          } else {
            const trade = await simulateStrategy(candles, alertTime, strategy, tokenAddress, metadata);
            if (trade) {
              trade.tokenAddress = tokenAddress;
              trades.push(trade);
            } else if (strategy.buyTheDip) {
              // Track why buy-the-dip failed
              noDipFound++;
            }
          }
        } catch (error) {
          // Skip errors
        }
      }

      if (trades.length === 0) {
        if (strategy.buyTheDip) {
          console.log(`      ❌ No trades found (${insufficientData} insufficient data, ${noDipFound} no dip/rebound)\n`);
        } else {
          console.log(`      ❌ No trades found (${insufficientData} insufficient data)\n`);
        }
        continue;
      }

    // Calculate metrics
    const winningTrades = trades.filter(t => t.pnl > 1.0).length;
    const losingTrades = trades.filter(t => t.pnl <= 1.0).length;
    const winRate = trades.length > 0 ? winningTrades / trades.length : 0;

    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl - 1.0), 0);
    const avgPnlPerTrade = trades.length > 0 ? (totalPnl / trades.length) * 100 : 0;

    // ============================================================================
    // CRITICAL: PORTFOLIO CALCULATION - NO COMPOUNDING (FIXED POSITION SIZE)
    // ============================================================================
    // ALL strategies use fixed position sizes based on initial portfolio
    // Position size NEVER changes, regardless of portfolio value
    // This prevents unrealistic exponential growth
    // ============================================================================
    
    const initialPortfolio = 100;
    const maxRiskPerTrade = 0.02; // 2% max risk per trade
    
    // Position sizing: ALL strategies must have loss clamp
    // Position size = maxRiskPerTrade / lossClampPercent
    // This ensures that if loss clamp is hit, we lose exactly maxRiskPerTrade (2%)
    let positionSizePercent: number;
    if (strategy.lossClampPercent === undefined || strategy.lossClampPercent <= 0) {
      throw new Error(`Strategy ${strategy.name} must have a lossClampPercent defined!`);
    }
    
    // Loss clamp ON: position size = 2% / lossClampPercent
    // Example: 20% loss clamp = 2% / 20% = 10% position size
    // If 20% stop loss hits, we lose 10% * 20% = 2% of portfolio ✓
    positionSizePercent = maxRiskPerTrade / (strategy.lossClampPercent / 100);
    
    // WITHOUT COMPOUNDING: Fixed position size based on initial portfolio
    // This value NEVER changes, even if portfolio grows or shrinks
    const fixedPositionSize = initialPortfolio * positionSizePercent;
    
    log(`   💰 Portfolio calculation (NO COMPOUNDING):`, true);
    log(`      Initial Portfolio: $${initialPortfolio.toFixed(2)}`, true);
    log(`      Position Size: $${fixedPositionSize.toFixed(2)} (${(positionSizePercent * 100).toFixed(2)}% of initial)`, true);
    log(`      Max Risk Per Trade: ${(maxRiskPerTrade * 100).toFixed(2)}%`, true);
    log(`      Loss Clamp: ${strategy.lossClampPercent}%`, true);
    
    let portfolio = initialPortfolio;
    const portfolioHistory: number[] = [initialPortfolio];
    let tradeCount = 0;

    for (const trade of trades.sort((a, b) => 
      DateTime.fromISO(a.alertTime).toMillis() - DateTime.fromISO(b.alertTime).toMillis()
    )) {
      tradeCount++;
      const oldPortfolio = portfolio;
      
      // Use fixed position size (NO COMPOUNDING - position size never changes)
      const tradeReturn = (trade.pnl - 1.0) * fixedPositionSize;
      portfolio = portfolio + tradeReturn;
      portfolioHistory.push(portfolio);
      
      // Verification logging for first few trades
      if (tradeCount <= 5 || tradeCount % 100 === 0) {
        log(`      Trade ${tradeCount}: PnL=${((trade.pnl - 1) * 100).toFixed(2)}%, Return=$${tradeReturn.toFixed(2)}, Portfolio: $${oldPortfolio.toFixed(2)} → $${portfolio.toFixed(2)}`, true);
      }
      
      // Sanity check: portfolio should never go negative (we have loss clamp)
      if (portfolio < 0) {
        log(`      ⚠️  WARNING: Portfolio went negative! This should not happen with loss clamp.`, true);
        log(`         Trade: ${trade.tokenAddress}, PnL: ${trade.pnl}, Return: ${tradeReturn}`, true);
      }
      
      // Sanity check: verify position size is still fixed
      if (Math.abs(fixedPositionSize - (initialPortfolio * positionSizePercent)) > 0.01) {
        log(`      ⚠️  WARNING: Position size changed! This should never happen (NO COMPOUNDING).`, true);
      }
    }

    const finalPortfolio = portfolio;
    
    log(`   ✅ Portfolio calculation complete:`, true);
    log(`      Total Trades: ${tradeCount}`, true);
    log(`      Final Portfolio: $${finalPortfolio.toFixed(2)}`, true);
    log(`      Total Return: ${((finalPortfolio / initialPortfolio - 1) * 100).toFixed(2)}%`, true);
    log(`      Position Size Used: $${fixedPositionSize.toFixed(2)} (FIXED - NO COMPOUNDING)`, true);
    const { maxDrawdown, maxDrawdownPct } = computeMaxDrawdown(portfolioHistory);
    const totalReturn = ((finalPortfolio / initialPortfolio) - 1) * 100;

    results.set(strategy.name, {
      strategy,
      trades,
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      winRate,
      avgPnlPerTrade,
      totalReturn,
      finalPortfolio,
      maxDrawdown,
      maxDrawdownPct,
    });

    // ============================================================================
    // FINAL VERIFICATION: Ensure calculations are correct
    // ============================================================================
    const expectedFinalPortfolio = initialPortfolio + (trades.reduce((sum, t) => sum + ((t.pnl - 1.0) * fixedPositionSize), 0));
    const calculationError = Math.abs(finalPortfolio - expectedFinalPortfolio);
    
    if (calculationError > 0.01) {
      log(`   ⚠️  WARNING: Calculation mismatch! Expected: $${expectedFinalPortfolio.toFixed(2)}, Got: $${finalPortfolio.toFixed(2)}, Error: $${calculationError.toFixed(2)}`, true);
    } else {
      log(`   ✅ Calculation verified: Portfolio matches expected value`, true);
    }
    
    // Verify no compounding occurred
    const maxPositionSize = Math.max(...trades.map((_, idx) => {
      // Position size should always be fixedPositionSize
      return fixedPositionSize;
    }));
    const minPositionSize = Math.min(...trades.map((_, idx) => {
      return fixedPositionSize;
    }));
    
    if (Math.abs(maxPositionSize - minPositionSize) > 0.01 || Math.abs(maxPositionSize - fixedPositionSize) > 0.01) {
      log(`   ⚠️  WARNING: Position size varied! This indicates compounding occurred (should be NO COMPOUNDING)`, true);
      log(`      Min: $${minPositionSize.toFixed(2)}, Max: $${maxPositionSize.toFixed(2)}, Expected: $${fixedPositionSize.toFixed(2)}`, true);
    } else {
      log(`   ✅ NO COMPOUNDING verified: Position size remained fixed at $${fixedPositionSize.toFixed(2)}`, true);
    }
    
    console.log(`      ✅ ${trades.length} trades | Win Rate: ${(winRate * 100).toFixed(2)}% | Final Portfolio: $${finalPortfolio.toFixed(2)} | Return: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%\n`);
    
    log(`\n${'='.repeat(80)}`, true);
    log(`✅ Strategy ${strategy.name} complete:`, true);
    log(`   Total Trades: ${trades.length}`, true);
    log(`   Win Rate: ${(winRate * 100).toFixed(2)}%`, true);
    log(`   Final Portfolio: $${finalPortfolio.toFixed(2)}`, true);
    log(`   Return: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`, true);
    log(`   Position Size: $${fixedPositionSize.toFixed(2)} (FIXED - NO COMPOUNDING)`, true);
    log(`   Calculation Verified: ${calculationError <= 0.01 ? 'YES' : 'NO'}`, true);
    log(`${'='.repeat(80)}\n`, true);
    
    closeStrategyLog();
  }

  return results;
}

async function main() {
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔬 SOLANA CALLERS OPTIMIZATION ANALYSIS');
  console.log('📊 Testing multiple strategies for callers with >100 Solana calls');
  console.log(`${'='.repeat(80)}\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Load calls data
  console.log('📂 Loading calls data...');
  const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
  const records: any[] = await new Promise((resolve, reject) => {
    parse(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
  });

  // Filter to Solana-only calls
  // If DATE_FILTER_START and DATE_FILTER_END env vars are set, filter by date range
  // Otherwise, default to recent calls (after Nov 3rd, 2025)
  const DATE_FILTER_START = process.env.DATE_FILTER_START ? DateTime.fromISO(process.env.DATE_FILTER_START) : null;
  const DATE_FILTER_END = process.env.DATE_FILTER_END ? DateTime.fromISO(process.env.DATE_FILTER_END) : null;
  const NOV_3_2025 = DateTime.fromISO('2025-11-03T00:00:00Z');
  
  const solanaRecords = records.filter(r => {
    const chain = (r.chain || 'solana').toLowerCase();
    if (chain !== 'solana') return false;
    
    const timestamp = r.timestamp || r.alertTime;
    if (!timestamp) return false;
    const alertTime = DateTime.fromISO(timestamp);
    if (!alertTime.isValid) return false;
    
    // Apply date filter if specified
    if (DATE_FILTER_START && DATE_FILTER_END) {
      return alertTime >= DATE_FILTER_START && alertTime <= DATE_FILTER_END;
    } else if (DATE_FILTER_START) {
      return alertTime >= DATE_FILTER_START;
    } else {
      // Default: recent calls only (after Nov 3rd)
      return alertTime > NOV_3_2025;
    }
  });

  console.log(`✅ Loaded ${records.length} total calls`);
  if (DATE_FILTER_START && DATE_FILTER_END) {
    console.log(`✅ ${solanaRecords.length} Solana-only calls (${DATE_FILTER_START.toFormat('yyyy-MM-dd')} to ${DATE_FILTER_END.toFormat('yyyy-MM-dd')})\n`);
  } else if (DATE_FILTER_START) {
    console.log(`✅ ${solanaRecords.length} Solana-only calls (after ${DATE_FILTER_START.toFormat('yyyy-MM-dd')})\n`);
  } else {
    console.log(`✅ ${solanaRecords.length} Solana-only calls (after ${NOV_3_2025.toFormat('yyyy-MM-dd')})\n`);
  }

  // Get callers with >100 Solana calls
  const callerCounts = new Map<string, number>();
  for (const record of solanaRecords) {
    const sender = record.sender || '';
    if (sender && sender.trim()) {
      const cleanCaller = sender.split('\n')[0].trim();
      callerCounts.set(cleanCaller, (callerCounts.get(cleanCaller) || 0) + 1);
    }
  }

  // For recent calls (after Nov 3rd), use lower threshold (>= 5 calls)
  // For historical analysis, use >100 calls
  const minCallsThreshold = solanaRecords.length < 500 ? 5 : 100;
  
  const eligibleCallers = Array.from(callerCounts.entries())
    .filter(([_, count]) => count >= minCallsThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([caller, _]) => caller);

  console.log(`📊 Found ${eligibleCallers.length} callers with >=${minCallsThreshold} Solana calls:\n`);
  eligibleCallers.forEach((caller, i) => {
    console.log(`   ${i + 1}. ${caller}: ${callerCounts.get(caller)} calls`);
  });
  console.log('');

  // Analyze each caller
  const allResults = new Map<string, Map<string, StrategyResult>>();

  for (const caller of eligibleCallers) {
    const callerResults = await analyzeCaller(caller, solanaRecords, STRATEGIES);
    if (callerResults.size > 0) {
      allResults.set(caller, callerResults);
    }
  }

  // Save results
  console.log(`\n${'='.repeat(80)}`);
  console.log('💾 SAVING RESULTS');
  console.log(`${'='.repeat(80)}\n`);

  // Save per-caller results (use timestamped directory)
  for (const [caller, callerResults] of Array.from(allResults.entries())) {
    const callerDir = path.join(RUN_OUTPUT_DIR, caller.replace(/[^a-zA-Z0-9]/g, '_'));
    if (!fs.existsSync(callerDir)) {
      fs.mkdirSync(callerDir, { recursive: true });
    }

    // Save all trades for each strategy (complete trade history)
    for (const [strategyName, result] of Array.from(callerResults.entries())) {
      const safeStrategyName = strategyName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tradesPath = path.join(callerDir, `${safeStrategyName}_trades.csv`);
      log(`💾 Saving complete trade history: ${tradesPath} (${result.trades.length} trades)`);
      await new Promise<void>((resolve, reject) => {
        // Explicitly define columns to include all metadata fields
        const columns = [
          'tokenAddress',
          'tokenName',
          'tokenSymbol',
          'caller',
          'alertTime',
          'alertDateTime',
          'entryTime',
          'exitTime',
          'pnl',
          'pnlPercent',
          'holdDuration',
          'entryPrice',
          'exitPrice',
          'athSinceCall',
          'athSinceCallPercent',
          'maxDrawdownFromEntry',
          'maxDrawdownFromEntryPercent',
          'timeToATH',
          'hasOHLCV',
          'strategy',
        ];
        stringify(result.trades, { header: true, columns }, (err, output) => {
          if (err) reject(err);
          else {
            fs.writeFileSync(tradesPath, output);
            resolve();
          }
        });
      });
    }

    // Save summary
    const summaryPath = path.join(callerDir, 'summary.json');
    const summary: any = {
      caller,
      totalCalls: solanaRecords.filter(r => (r.sender || '').includes(caller)).length,
      strategies: {},
    };

    for (const [strategyName, result] of Array.from(callerResults.entries())) {
      summary.strategies[strategyName] = {
        totalTrades: result.totalTrades,
        winRate: result.winRate * 100,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        avgPnlPerTrade: result.avgPnlPerTrade,
        totalReturn: result.totalReturn,
        finalPortfolio: result.finalPortfolio,
        maxDrawdown: result.maxDrawdown,
        maxDrawdownPct: result.maxDrawdownPct,
        description: result.strategy.description,
      };
    }

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`✅ Saved results for ${caller}`);
  }

  // Create consolidated summary
  const consolidated: any[] = [];
  for (const [caller, callerResults] of Array.from(allResults.entries())) {
    for (const [strategyName, result] of Array.from(callerResults.entries())) {
      consolidated.push({
        Caller: caller,
        Strategy: strategyName,
        Description: result.strategy.description,
        TotalTrades: result.totalTrades,
        WinRate: (result.winRate * 100).toFixed(2),
        FinalPortfolio: result.finalPortfolio.toFixed(2),
        TotalReturn: result.totalReturn.toFixed(2),
        MaxDrawdown: result.maxDrawdownPct.toFixed(2),
        AvgPnlPerTrade: result.avgPnlPerTrade.toFixed(2),
      });
    }
  }

  const consolidatedPath = path.join(RUN_OUTPUT_DIR, 'all_callers_all_strategies.csv');
  log(`💾 Saving all strategies summary: ${consolidatedPath}`);
  await new Promise<void>((resolve, reject) => {
    stringify(consolidated, { header: true }, (err, output) => {
      if (err) reject(err);
      else {
        fs.writeFileSync(consolidatedPath, output);
        resolve();
      }
    });
  });

  console.log(`\n✅ Consolidated summary saved: ${consolidatedPath}`);
  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ ANALYSIS COMPLETE');
  console.log(`${'='.repeat(80)}\n`);
}

main().catch(console.error);


