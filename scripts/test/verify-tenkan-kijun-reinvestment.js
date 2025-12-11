#!/usr/bin/env ts-node
"use strict";
/**
 * Verify the Tenkan/Kijun reinvestment calculation
 * Check if the math is correct and if there are any bugs
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
const luxon_1 = require("luxon");
const csv_parse_1 = require("csv-parse");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CSV_PATH = path.join(__dirname, '../data/exports/tenkan-kijun-filtered-optimization/tenkan_kijun_filtered_strategies.csv');
function calculateReinvestment(trades, initialPortfolio = 100, stopLossPercent, maxRiskPerTrade = 0.02) {
    const sortedTrades = trades.sort((a, b) => luxon_1.DateTime.fromISO(a.alertTime).toMillis() - luxon_1.DateTime.fromISO(b.alertTime).toMillis());
    const positionSizePercent = maxRiskPerTrade / stopLossPercent;
    let portfolio = initialPortfolio;
    const tradeDetails = [];
    for (let i = 0; i < sortedTrades.length; i++) {
        const trade = sortedTrades[i];
        const positionSize = portfolio * positionSizePercent;
        const tradeReturn = (trade.pnl - 1.0) * positionSize;
        portfolio = portfolio + tradeReturn;
        if (i < 10 || i >= sortedTrades.length - 10 || i % 200 === 0) {
            tradeDetails.push({
                tradeNum: i + 1,
                pnl: trade.pnl,
                positionSize,
                return: tradeReturn,
                portfolio,
            });
        }
    }
    return {
        finalPortfolio: portfolio,
        compoundGrowthFactor: portfolio / initialPortfolio,
        positionSizePercent,
        tradeDetails,
    };
}
async function verify() {
    console.log('🔍 Verifying Tenkan/Kijun Reinvestment Calculation\n');
    // Read the CSV to get strategy info
    const csv = fs.readFileSync(CSV_PATH, 'utf8');
    const records = await new Promise((resolve, reject) => {
        (0, csv_parse_1.parse)(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err)
                reject(err);
            else
                resolve(records);
        });
    });
    const baseStrategy = records.find(r => r.Strategy.includes('Base_0'));
    if (!baseStrategy) {
        console.log('❌ Base strategy not found');
        return;
    }
    console.log('Base Strategy Info:');
    console.log(`  Total Trades: ${baseStrategy.TotalTrades}`);
    console.log(`  Win Rate: ${baseStrategy.WinRate}%`);
    console.log(`  Avg PnL per Trade: ${baseStrategy.AvgPnlPerTrade}%`);
    console.log(`  Reported Final Portfolio: $${baseStrategy.FinalPortfolio}`);
    console.log(`  Reported Compound Factor: ${baseStrategy.CompoundFactor}x`);
    console.log('');
    // Now we need to simulate with realistic trade distribution
    // If win rate is 45.9% and avg is +6.58%, what are the actual win/loss values?
    const totalTrades = parseInt(baseStrategy.TotalTrades);
    const winRate = parseFloat(baseStrategy.WinRate) / 100;
    const avgPnlPercent = parseFloat(baseStrategy.AvgPnlPerTrade) / 100;
    const wins = Math.floor(totalTrades * winRate);
    const losses = totalTrades - wins;
    // Estimate: if losses average -20% (stop loss), what do wins average?
    // 0.459 * winAvg + 0.541 * (-0.20) = 0.0658
    // 0.459 * winAvg = 0.0658 + 0.1082 = 0.174
    // winAvg = 0.379 = +37.9%
    const estimatedWinPnl = 1.379; // +37.9%
    const estimatedLossPnl = 0.8; // -20%
    console.log('Estimated Trade Distribution:');
    console.log(`  Wins: ${wins} at ~${((estimatedWinPnl - 1) * 100).toFixed(1)}% each`);
    console.log(`  Losses: ${losses} at ~${((estimatedLossPnl - 1) * 100).toFixed(1)}% each`);
    console.log('');
    // Create mock trades
    const mockTrades = [];
    for (let i = 0; i < wins; i++) {
        mockTrades.push({
            pnl: estimatedWinPnl,
            alertTime: luxon_1.DateTime.now().plus({ days: i }).toISO() || '',
        });
    }
    for (let i = 0; i < losses; i++) {
        mockTrades.push({
            pnl: estimatedLossPnl,
            alertTime: luxon_1.DateTime.now().plus({ days: wins + i }).toISO() || '',
        });
    }
    // Shuffle to mix wins and losses
    for (let i = mockTrades.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mockTrades[i], mockTrades[j]] = [mockTrades[j], mockTrades[i]];
    }
    const stopLossPercent = 0.2; // 1 - 0.8
    const maxRiskPerTrade = 0.02;
    const result = calculateReinvestment(mockTrades, 100, stopLossPercent, maxRiskPerTrade);
    console.log('Simulated Reinvestment Results:');
    console.log(`  Final Portfolio: $${result.finalPortfolio.toFixed(2)}`);
    console.log(`  Compound Factor: ${result.compoundGrowthFactor.toFixed(2)}x`);
    console.log(`  Position Size: ${(result.positionSizePercent * 100).toFixed(2)}%`);
    console.log('');
    console.log('First 10 Trades:');
    result.tradeDetails.slice(0, 10).forEach(t => {
        console.log(`  Trade ${t.tradeNum}: PnL=${t.pnl.toFixed(3)}, Position=$${t.positionSize.toFixed(2)}, Return=$${t.return.toFixed(2)}, Portfolio=$${t.portfolio.toFixed(2)}`);
    });
    console.log('\nLast 10 Trades:');
    result.tradeDetails.slice(-10).forEach(t => {
        console.log(`  Trade ${t.tradeNum}: PnL=${t.pnl.toFixed(3)}, Position=$${t.positionSize.toFixed(2)}, Return=$${t.return.toFixed(2)}, Portfolio=$${t.portfolio.toFixed(2)}`);
    });
    console.log('\n⚠️  If the simulated result is much lower than reported, there may be:');
    console.log('   1. A bug in the reinvestment calculation');
    console.log('   2. Trades with much higher PnL than estimated');
    console.log('   3. An issue with how trades are being counted/processed');
}
verify().catch(console.error);
//# sourceMappingURL=verify-tenkan-kijun-reinvestment.js.map