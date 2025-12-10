#!/usr/bin/env ts-node
"use strict";
/**
 * Run All Strategies Gauntlet
 *
 * Runs all available trading strategies on all extracted tokens from September onwards.
 * Processes in batches and saves results incrementally.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const luxon_1 = require("luxon");
const simulation_1 = require("@quantbot/simulation");
const simulation_2 = require("@quantbot/simulation");
const simulation_3 = require("@quantbot/simulation");
const utils_1 = require("@quantbot/utils");
/**
 * Load extracted tokens from September onwards
 */
function loadExtractedTokens() {
    const resultsFile = path.join(process.cwd(), 'data', 'exports', 'september-onwards-extraction-results.json');
    if (!fs.existsSync(resultsFile)) {
        throw new Error(`Results file not found: ${resultsFile}`);
    }
    const data = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    // Load ALL tokens - let ClickHouse/cache determine if candles exist
    // The extraction results structure may vary, so we'll check all tokens
    const tokens = data.tokens || [];
    return tokens.map((token) => ({
        mint: token.mint,
        chain: token.chain || 'solana',
        firstSeen: token.firstSeen,
        metadata: token.metadata
    }));
}
/**
 * Generate comprehensive strategy configurations
 */
function getAllStrategies() {
    const strategies = [];
    // Get all presets
    const presets = (0, simulation_2.listPresets)();
    for (const presetName of presets) {
        const preset = (0, simulation_2.getPreset)(presetName);
        if (preset) {
            strategies.push({
                id: presetName,
                name: preset.name,
                config: preset
            });
        }
    }
    // Add additional strategy variations
    const baseStrategies = [
        // Multi-take-profit strategies
        {
            name: 'MultiTP_10pctTrail_50pctDropRebound_24h',
            profitTargets: [
                { target: 2.0, percent: 0.3 },
                { target: 3.0, percent: 0.3 },
                { target: 5.0, percent: 0.2 },
                { target: 10.0, percent: 0.2 }
            ],
            stopLoss: {
                initial: -0.2,
                trailing: 2.0,
                trailingPercent: 0.1
            },
            entry: {
                initialEntry: -0.5,
                maxWaitTime: 60
            },
            holdHours: 24
        },
        {
            name: 'MultiTP_20pctTrail_MA_24h',
            profitTargets: [
                { target: 2.0, percent: 0.4 },
                { target: 5.0, percent: 0.6 }
            ],
            stopLoss: {
                initial: -0.2,
                trailing: 2.0,
                trailingPercent: 0.2
            },
            holdHours: 24
        },
        {
            name: 'MultiTP_20pctTrail_RSI_MACD_24h',
            profitTargets: [
                { target: 2.0, percent: 0.3 },
                { target: 3.0, percent: 0.3 },
                { target: 5.0, percent: 0.4 }
            ],
            stopLoss: {
                initial: -0.2,
                trailing: 2.0,
                trailingPercent: 0.2
            },
            holdHours: 24
        },
        // Ichimoku strategies - SKIPPED until extra candles are fetched
        // {
        //   name: 'Ichimoku_5m_TenkanKijun_10pctTrail_24h',
        //   profitTargets: [
        //     { target: 2.0, percent: 0.5 },
        //     { target: 5.0, percent: 0.5 }
        //   ],
        //   stopLoss: {
        //     initial: -0.2,
        //     trailing: 2.0,
        //     trailingPercent: 0.1
        //   },
        //   holdHours: 24
        // },
        // Conservative strategies
        {
            name: 'Conservative_50pctTrail_6h',
            profitTargets: [
                { target: 2.0, percent: 0.7 },
                { target: 3.0, percent: 0.3 }
            ],
            stopLoss: {
                initial: -0.2,
                trailing: 2.0,
                trailingPercent: 0.5
            },
            holdHours: 6
        },
        // Aggressive strategies
        {
            name: 'Aggressive_10pctTrail_48h',
            profitTargets: [
                { target: 5.0, percent: 0.3 },
                { target: 10.0, percent: 0.4 },
                { target: 20.0, percent: 0.3 }
            ],
            stopLoss: {
                initial: -0.3,
                trailing: 3.0,
                trailingPercent: 0.1
            },
            holdHours: 48
        }
    ];
    for (const strategy of baseStrategies) {
        strategies.push({
            id: strategy.name.toLowerCase().replace(/[^a-z0-9]/g, '_'),
            name: strategy.name,
            config: strategy
        });
    }
    return strategies;
}
/**
 * Convert tokens to simulation targets
 */
function tokensToTargets(tokens) {
    const startTime = luxon_1.DateTime.fromISO('2025-09-01');
    const endTime = luxon_1.DateTime.utc();
    return tokens.map(token => ({
        mint: token.mint,
        chain: token.chain,
        startTime,
        endTime,
        metadata: {
            firstSeen: token.firstSeen,
            symbol: token.metadata?.symbol,
            name: token.metadata?.name
        }
    }));
}
/**
 * Calculate strategy summary statistics using 2% risk investment model
 */
function calculateStrategySummary(results, strategyConfig) {
    const initialPortfolio = 100;
    const maxRiskPerTrade = 0.02; // 2% max risk per trade
    // Calculate position size based on stop loss
    // Position size = maxRiskPerTrade / stopLossPercent
    // Example: 20% stop loss = 2% / 20% = 10% position size
    const stopLossPercent = Math.abs(strategyConfig.stopLoss?.initial || 0.2);
    const positionSizePercent = maxRiskPerTrade / stopLossPercent;
    // Calculate overall PnL using 2% risk model (with compounding)
    let portfolio = initialPortfolio;
    const trades = [];
    // Sort results by timestamp (if available in metadata)
    const sortedResults = [...results].sort((a, b) => {
        const timeA = a.target?.metadata?.firstSeen
            ? luxon_1.DateTime.fromISO(a.target.metadata.firstSeen).toSeconds()
            : a.target?.startTime?.toSeconds() || 0;
        const timeB = b.target?.metadata?.firstSeen
            ? luxon_1.DateTime.fromISO(b.target.metadata.firstSeen).toSeconds()
            : b.target?.startTime?.toSeconds() || 0;
        return timeA - timeB;
    });
    for (const result of sortedResults) {
        if (!result.result || result.result.finalPnl === 0) {
            continue; // Skip failed trades
        }
        const portfolioBefore = portfolio;
        const positionSize = portfolio * positionSizePercent;
        // finalPnl is a multiplier: 2.0 = 2x (100% gain), 0.8 = 0.8x (-20% loss)
        // tradeReturn = (finalPnl - 1.0) * positionSize
        // Example: finalPnl = 2.0, positionSize = 10, tradeReturn = (2.0 - 1.0) * 10 = 10
        const tradeReturn = (result.result.finalPnl - 1.0) * positionSize;
        portfolio = portfolio + tradeReturn;
        // Safety check: prevent unrealistic portfolio values from extreme outliers
        if (portfolio < 0) {
            portfolio = 0;
        }
        // Note: We don't cap high values as they represent actual extreme gains
        // The user wants actual PnL figures, so we report them as-is
        const entryPrice = result.result.entryPrice || 0;
        const exitPrice = result.result.finalPrice || 0;
        const pnl = result.result.finalPnl;
        const pnlPercent = (pnl - 1.0) * 100;
        // Calculate hold duration from events
        const events = result.result.events || [];
        const entryEvent = events.find((e) => e.type === 'entry');
        const exitEvent = events[events.length - 1];
        const holdDuration = entryEvent && exitEvent
            ? (exitEvent.timestamp - entryEvent.timestamp) / 60 // minutes
            : 0;
        trades.push({
            mint: result.target?.mint || '',
            chain: result.target?.chain || '',
            entryPrice,
            exitPrice,
            pnl,
            pnlPercent,
            positionSize,
            tradeReturn,
            portfolioBefore,
            portfolioAfter: portfolio,
            timestamp: entryEvent?.timestamp || result.target?.startTime?.toSeconds() || 0,
            holdDuration
        });
    }
    const totalPnl = portfolio - initialPortfolio;
    const totalPnlPercent = (totalPnl / initialPortfolio) * 100;
    const avgPnl = results.length > 0 ? totalPnlPercent / results.length : 0;
    const profitableTrades = trades.filter(t => t.pnl > 1.0).length;
    const winRate = trades.length > 0 ? profitableTrades / trades.length : 0;
    return {
        totalPnl,
        avgPnl,
        winRate,
        totalTrades: trades.length,
        profitableTrades,
        // Additional metrics
        initialPortfolio,
        finalPortfolio: portfolio,
        totalPnlPercent,
        positionSizePercent: positionSizePercent * 100,
        trades // Include trade history for auditing
    };
}
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const strategyIndex = args.find(arg => arg.startsWith('--strategy='))?.split('=')[1];
    const strategyName = args.find(arg => arg.startsWith('--name='))?.split('=')[1];
    console.log(`\n${'='.repeat(80)}`);
    console.log('🎯 RUNNING STRATEGY GAUNTLET');
    console.log(`${'='.repeat(80)}\n`);
    // Load tokens
    console.log('📥 Loading extracted tokens...');
    const tokens = loadExtractedTokens();
    console.log(`✅ Loaded ${tokens.length} tokens with candles\n`);
    // Get all strategies
    console.log('📋 Loading strategies...');
    const allStrategies = getAllStrategies();
    console.log(`✅ Found ${allStrategies.length} strategies\n`);
    // Determine which strategy to run
    let strategies;
    if (strategyIndex !== undefined) {
        const idx = parseInt(strategyIndex, 10);
        if (idx < 0 || idx >= allStrategies.length) {
            console.error(`❌ Invalid strategy index: ${idx}. Must be between 0 and ${allStrategies.length - 1}`);
            process.exit(1);
        }
        strategies = [allStrategies[idx]];
        console.log(`🎯 Running strategy ${idx + 1}/${allStrategies.length}: ${strategies[0].name}\n`);
    }
    else if (strategyName !== undefined) {
        const found = allStrategies.find(s => s.name === strategyName || s.id === strategyName);
        if (!found) {
            console.error(`❌ Strategy not found: ${strategyName}`);
            console.error(`Available strategies: ${allStrategies.map(s => s.name).join(', ')}`);
            process.exit(1);
        }
        strategies = [found];
        console.log(`🎯 Running strategy: ${strategies[0].name}\n`);
    }
    else {
        // Default: run all strategies (for backward compatibility)
        strategies = allStrategies;
        console.log(`🎯 Running all ${strategies.length} strategies\n`);
    }
    // Convert to targets
    const targets = tokensToTargets(tokens);
    console.log(`🎯 Created ${targets.length} simulation targets\n`);
    // Initialize simulation engine
    const engine = new simulation_1.SimulationEngine({
        logger: {
            debug: (msg, meta) => utils_1.logger.debug(msg, meta),
            info: (msg, meta) => utils_1.logger.info(msg, meta),
            warn: (msg, meta) => utils_1.logger.warn(msg, meta),
            error: (msg, meta) => utils_1.logger.error(msg, meta)
        },
        sinks: []
    });
    const allResults = new Map();
    const BATCH_SIZE = 50; // Process tokens in smaller batches to reduce memory usage
    console.log(`\n${'='.repeat(80)}`);
    console.log('🚀 STARTING SIMULATIONS');
    console.log(`${'='.repeat(80)}\n`);
    // Load existing results if running a single strategy
    const existingResultsFile = path.join(process.cwd(), 'data', 'exports', 'strategy-gauntlet-results.json');
    let existingResults = { results: [] };
    if (fs.existsSync(existingResultsFile)) {
        try {
            existingResults = JSON.parse(fs.readFileSync(existingResultsFile, 'utf-8'));
        }
        catch (e) {
            // Ignore parse errors
        }
    }
    // Process each strategy
    for (let strategyIdx = 0; strategyIdx < strategies.length; strategyIdx++) {
        const strategyDef = strategies[strategyIdx];
        const globalIdx = allStrategies.findIndex(s => s.id === strategyDef.id);
        console.log(`\n[${globalIdx + 1}/${allStrategies.length}] Strategy: ${strategyDef.name}`);
        try {
            // Build strategy from config
            const strategy = (0, simulation_3.buildStrategy)(strategyDef.config);
            // Create scenario config for runScenario
            // Note: We need to provide a dummy data selector since we're using targets directly
            const scenario = {
                id: strategyDef.id,
                name: strategyDef.name,
                tags: ['gauntlet', 'september-onwards'],
                data: {
                    kind: 'mint',
                    mint: targets[0]?.mint || '',
                    chain: targets[0]?.chain || 'solana',
                    start: targets[0]?.startTime.toISO() || '',
                    end: targets[0]?.endTime.toISO() || undefined
                },
                strategy,
                stopLoss: strategyDef.config.stopLoss ? {
                    initial: strategyDef.config.stopLoss.initial,
                    trailing: strategyDef.config.stopLoss.trailing ?? 'none'
                } : undefined,
                entry: strategyDef.config.entry ? {
                    initialEntry: strategyDef.config.entry.initialEntry ?? 'none',
                    trailingEntry: strategyDef.config.entry.trailingEntry ?? 'none',
                    maxWaitTime: strategyDef.config.entry.maxWaitTime ?? 60
                } : undefined,
                reEntry: strategyDef.config.reEntry ? {
                    trailingReEntry: strategyDef.config.reEntry.trailingReEntry ?? 'none',
                    maxReEntries: strategyDef.config.reEntry.maxReEntries ?? 0,
                    sizePercent: strategyDef.config.reEntry.sizePercent ?? 0.5
                } : undefined,
                costs: {
                    entrySlippageBps: 300, // 3% = 300 basis points
                    exitSlippageBps: 300,
                    takerFeeBps: 50, // 0.5% = 50 basis points
                    borrowAprBps: 0
                }
            };
            // Process targets in batches
            const batches = [];
            for (let i = 0; i < targets.length; i += BATCH_SIZE) {
                batches.push(targets.slice(i, i + BATCH_SIZE));
            }
            const strategyResults = [];
            const strategyErrors = [];
            for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
                const batch = batches[batchIdx];
                console.log(`  Batch ${batchIdx + 1}/${batches.length} (${batch.length} tokens)...`);
                const batchStartTime = Date.now();
                const runSummary = await engine.runScenario({
                    scenario,
                    targets: batch,
                    runOptions: {
                        progressInterval: 50,
                        failFast: false,
                        maxConcurrency: 10, // Process 10 tokens in parallel for faster execution
                        cachePolicy: process.env.USE_CACHE_ONLY === 'true' ? 'cache-only' : 'prefer-cache' // Use ClickHouse/cache, avoid API calls
                    }
                });
                const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
                console.log(`    ⏱️  Batch completed in ${batchDuration}s (${(batch.length / parseFloat(batchDuration)).toFixed(1)} tokens/sec)`);
                // Only keep summary data, not full results to save memory
                // Store just the essential data: target info + finalPnl
                // This prevents storing full candle arrays and event arrays in memory
                const batchResults = runSummary.results.map((r) => ({
                    target: {
                        mint: r.target?.mint,
                        chain: r.target?.chain,
                        startTime: r.target?.startTime,
                        metadata: r.target?.metadata
                    },
                    result: {
                        finalPnl: r.result?.finalPnl,
                        entryPrice: r.result?.entryPrice,
                        finalPrice: r.result?.finalPrice,
                        events: r.result?.events ? [r.result.events[0], r.result.events[r.result.events.length - 1]] : [] // Only first and last event
                    }
                }));
                strategyResults.push(...batchResults);
                strategyErrors.push(...runSummary.errors);
                console.log(`    ✅ ${runSummary.successes} succeeded, ❌ ${runSummary.failures} failed`);
                // Force garbage collection hint after each batch
                if (global.gc) {
                    global.gc();
                }
                // Save progress after each batch
                const progressFile = path.join(process.cwd(), 'data', 'exports', 'strategy-gauntlet-progress.json');
                const progressDir = path.dirname(progressFile);
                if (!fs.existsSync(progressDir)) {
                    fs.mkdirSync(progressDir, { recursive: true });
                }
                // Calculate strategy summary (this processes all trades and creates trade history)
                const strategySummary = calculateStrategySummary(strategyResults, strategyDef.config);
                const strategyResult = {
                    strategyName: strategyDef.name,
                    strategyId: strategyDef.id,
                    totalTargets: targets.length,
                    successes: strategyResults.length,
                    failures: strategyErrors.length,
                    results: [], // Don't store full results in memory - we have trade history in summary
                    errors: strategyErrors.slice(0, 100), // Only keep first 100 errors
                    summary: strategySummary
                };
                allResults.set(strategyDef.id, strategyResult);
                // Clear strategy results from memory after calculating summary
                // This prevents memory accumulation across batches
                strategyResults.length = 0;
                strategyErrors.length = 0;
                // Save progress with summary only (not full results or trade histories)
                const progressResults = Array.from(allResults.values()).map(r => ({
                    strategyName: r.strategyName,
                    strategyId: r.strategyId,
                    totalTargets: r.totalTargets,
                    successes: r.successes,
                    failures: r.failures,
                    summary: {
                        ...r.summary,
                        trades: [] // Exclude trade histories from progress file to keep it small
                    }
                }));
                fs.writeFileSync(progressFile, JSON.stringify({
                    lastUpdate: new Date().toISOString(),
                    strategiesCompleted: strategyIdx + (batchIdx + 1) / batches.length,
                    totalStrategies: strategies.length,
                    currentStrategy: strategyDef.name,
                    currentBatch: `${batchIdx + 1}/${batches.length}`,
                    results: progressResults
                }, null, 2));
            }
            const finalSummary = calculateStrategySummary(strategyResults, strategyDef.config);
            console.log(`  📊 Summary: ${finalSummary.totalTrades} trades, ${(finalSummary.winRate * 100).toFixed(1)}% win rate, ` +
                `${finalSummary.totalPnlPercent.toFixed(2)}% total PnL (${finalSummary.initialPortfolio.toFixed(2)} → ${finalSummary.finalPortfolio.toFixed(2)})`);
        }
        catch (error) {
            utils_1.logger.error('Strategy simulation failed', {
                strategy: strategyDef.name,
                error: error.message
            });
            console.log(`  ❌ Error: ${error.message}`);
        }
    }
    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 FINAL RESULTS SUMMARY');
    console.log(`${'='.repeat(80)}\n`);
    // Merge with existing results if running a single strategy
    let allMergedResults;
    if (strategies.length === 1) {
        // Remove existing result for this strategy if it exists
        existingResults.results = existingResults.results.filter((r) => r.strategyId !== strategies[0].id);
    }
    else {
        // Running all strategies - start fresh
        existingResults.results = [];
    }
    // Sort results by total PnL
    const sortedResults = Array.from(allResults.values())
        .sort((a, b) => b.summary.totalPnlPercent - a.summary.totalPnlPercent);
    // Merge with existing results
    allMergedResults = [...existingResults.results, ...sortedResults]
        .sort((a, b) => b.summary.totalPnlPercent - a.summary.totalPnlPercent);
    console.log('Top 10 Strategies by Total PnL (2% Risk Model):');
    for (let i = 0; i < Math.min(10, allMergedResults.length); i++) {
        const result = allMergedResults[i];
        console.log(`  ${i + 1}. ${result.strategyName}: ` +
            `${result.summary.totalPnlPercent.toFixed(2)}% total PnL | ` +
            `$${result.summary.initialPortfolio.toFixed(2)} → $${result.summary.finalPortfolio.toFixed(2)} | ` +
            `${(result.summary.winRate * 100).toFixed(1)}% win rate | ` +
            `${result.summary.totalTrades} trades`);
    }
    // Save final results (summary only to avoid JSON size limits)
    const outputFile = path.join(process.cwd(), 'data', 'exports', 'strategy-gauntlet-results.json');
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    // Save summary with trade histories (for auditing)
    const summaryResults = allMergedResults.map((r) => ({
        strategyName: r.strategyName,
        strategyId: r.strategyId,
        totalTargets: r.totalTargets,
        successes: r.successes,
        failures: r.failures,
        summary: {
            ...r.summary,
            trades: r.summary.trades // Include trade history for auditing
        }
        // Exclude full results array to keep file size manageable
    }));
    fs.writeFileSync(outputFile, JSON.stringify({
        runDate: new Date().toISOString(),
        totalStrategies: strategies.length,
        totalTokens: tokens.length,
        results: summaryResults,
        summary: {
            bestStrategy: allMergedResults[0]?.strategyName,
            bestTotalPnl: allMergedResults[0]?.summary.totalPnlPercent,
            bestFinalPortfolio: allMergedResults[0]?.summary.finalPortfolio,
            totalSimulations: allMergedResults.reduce((sum, r) => sum + r.summary.totalTrades, 0),
            strategiesCompleted: allMergedResults.length,
            totalStrategies: allStrategies.length
        }
    }, null, 2));
    // Save detailed results per strategy in separate files (including trade histories)
    console.log('\n💾 Saving detailed results per strategy...');
    for (const result of allMergedResults) {
        const strategyFile = path.join(process.cwd(), 'data', 'exports', `strategy-gauntlet-${result.strategyId.replace(/[^a-z0-9]/g, '_')}.json`);
        // Save trade history as CSV for easy auditing
        const tradeHistoryFile = path.join(process.cwd(), 'data', 'exports', `strategy-gauntlet-${result.strategyId.replace(/[^a-z0-9]/g, '_')}-trades.csv`);
        try {
            // Save JSON with summary and trade history
            // Note: We don't have full results array anymore (cleared to save memory)
            fs.writeFileSync(strategyFile, JSON.stringify({
                strategyName: result.strategyName,
                strategyId: result.strategyId,
                totalTargets: result.totalTargets,
                successes: result.successes,
                failures: result.failures,
                summary: result.summary,
                tradeHistory: result.summary.trades, // Full trade history for auditing
                errors: result.errors, // Already limited to 100
                note: 'Full simulation results cleared from memory to prevent OOM. Trade history available in summary.trades.'
            }, null, 2));
            // Save trade history as CSV for easy auditing
            if (result.summary.trades.length > 0) {
                const csvHeader = 'mint,chain,entryPrice,exitPrice,pnl,pnlPercent,positionSize,tradeReturn,portfolioBefore,portfolioAfter,timestamp,holdDuration\n';
                const csvRows = result.summary.trades.map((t) => `${t.mint},${t.chain},${t.entryPrice},${t.exitPrice},${t.pnl},${t.pnlPercent},${t.positionSize},${t.tradeReturn},${t.portfolioBefore},${t.portfolioAfter},${t.timestamp},${t.holdDuration}`).join('\n');
                fs.writeFileSync(tradeHistoryFile, csvHeader + csvRows);
                console.log(`  ✅ Saved ${result.summary.trades.length} trades to ${path.basename(tradeHistoryFile)}`);
            }
        }
        catch (error) {
            // If still too large, save summary only
            fs.writeFileSync(strategyFile, JSON.stringify({
                strategyName: result.strategyName,
                strategyId: result.strategyId,
                totalTargets: result.totalTargets,
                successes: result.successes,
                failures: result.failures,
                summary: result.summary,
                note: 'Full results too large, saving summary only'
            }, null, 2));
        }
    }
    console.log(`\n💾 Results saved to: ${outputFile}`);
    console.log(`\n✅ Gauntlet complete!\n`);
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=run-all-strategies-gauntlet.js.map