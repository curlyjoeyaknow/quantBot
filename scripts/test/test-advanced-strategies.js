"use strict";
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
const luxon_1 = require("luxon");
const candles_1 = require("../src/simulation/candles");
const engine_1 = require("../src/simulation/engine");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const csv_parse_1 = require("csv-parse");
const BROOK_CALLS_CSV = path.join(__dirname, '../data/exports/csv/all_brook_channels_calls.csv');
async function testAdvancedStrategies() {
    console.log('🧪 Testing Advanced Strategies...\n');
    // Read Brook calls
    const csv = fs.readFileSync(BROOK_CALLS_CSV, 'utf8');
    const records = await new Promise((resolve, reject) => {
        (0, csv_parse_1.parse)(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err)
                reject(err);
            else
                resolve(records);
        });
    });
    const brookOnly = records.filter((r) => r.sender && (r.sender.includes('Brook') ||
        r.sender.includes('brook') ||
        r.sender.includes('Brook Giga')) && !r.tokenAddress.includes('bonk') && r.tokenAddress.length > 20);
    console.log(`📊 Testing ${brookOnly.length} Brook calls\n`);
    const strategies = [
        { name: '2x + re-entry alert bounce', target: 2, reentry: true, trailingStop: 'none' },
        { name: '2x + 10% trailing', target: 2, reentry: false, trailingStop: 0.1 },
        { name: '2x + 20% trailing', target: 2, reentry: false, trailingStop: 0.2 },
        { name: '2x + 30% trailing', target: 2, reentry: false, trailingStop: 0.3 },
        { name: '2x + 50% trailing', target: 2, reentry: false, trailingStop: 0.5 },
        { name: '5x + 10% trailing', target: 5, reentry: false, trailingStop: 0.1 },
        { name: '5x + 20% trailing', target: 5, reentry: false, trailingStop: 0.2 },
        { name: '5x + 30% trailing', target: 5, reentry: false, trailingStop: 0.3 },
    ];
    const results = {};
    for (const strat of strategies) {
        results[strat.name] = {
            winners: 0,
            losers: 0,
            netPnl: 0,
            total: 0,
            avgMaxDrawdown: 0,
            drawdowns: []
        };
    }
    let processed = 0;
    const maxCalls = 100;
    for (let i = 0; i < Math.min(brookOnly.length, maxCalls); i++) {
        const call = brookOnly[i];
        try {
            const alertDate = luxon_1.DateTime.fromISO(call.timestamp);
            if (!alertDate.isValid)
                continue;
            const endDate = alertDate.plus({ days: 60 });
            const candles = await (0, candles_1.fetchHybridCandles)(call.tokenAddress, alertDate, endDate, call.chain);
            if (!candles || candles.length === 0)
                continue;
            const alertPrice = candles[0].close;
            for (const strat of strategies) {
                // Set strategy: 100% at target
                const STRATEGY = [{ percent: 1.0, target: strat.target }];
                // Configure stop loss
                const stopLossConfig = {
                    initial: -0.3,
                    trailing: (strat.trailingStop === 'none' ? 'none' : strat.trailingStop)
                };
                // Configure re-entry (if specified)
                const reEntryConfig = strat.reentry ? {
                    trailingReEntry: 0.7, // 70% retrace = bounce back to alert price
                    maxReEntries: 1,
                    sizePercent: 0.5
                } : {
                    trailingReEntry: 'none',
                    maxReEntries: 0,
                    sizePercent: 0.5
                };
                const result = (0, engine_1.simulateStrategy)(candles, STRATEGY, stopLossConfig, undefined, reEntryConfig);
                // Calculate PNL
                const pnl = result.finalPnl;
                // Calculate max drawdown for winners that hit target
                let maxDrawdown = 0;
                if (pnl > 1 && result.events && result.events.length > 0) {
                    // Find the first profit target event
                    const profitEvent = result.events.find((e) => e.type === 'take_profit');
                    if (profitEvent && result.entryOptimization) {
                        const lowestPrice = result.entryOptimization.lowestPrice;
                        const entryPrice = result.entryOptimization.actualEntryPrice;
                        if (lowestPrice && entryPrice) {
                            maxDrawdown = ((lowestPrice / entryPrice - 1) * 100);
                        }
                    }
                    results[strat.name].drawdowns.push(Math.abs(maxDrawdown));
                }
                if (pnl > 1) {
                    results[strat.name].winners++;
                    results[strat.name].netPnl += (pnl - 1);
                }
                else {
                    results[strat.name].losers++;
                    results[strat.name].netPnl += (pnl - 1);
                }
                results[strat.name].total++;
            }
            processed++;
            if (processed % 10 === 0) {
                console.log(`Processed ${processed}/${Math.min(brookOnly.length, maxCalls)}...`);
            }
        }
        catch (error) {
            continue;
        }
    }
    // Calculate average drawdown for each strategy
    for (const strat of strategies) {
        const r = results[strat.name];
        if (r.drawdowns.length > 0) {
            r.avgMaxDrawdown = r.drawdowns.reduce((a, b) => a + b, 0) / r.drawdowns.length;
        }
    }
    console.log('\n📊 RESULTS:\n');
    console.log('Strategy                    | Win | Loss | Net PNL  | Avg Drawdown');
    console.log('----------------------------|-----|------|----------|------------');
    for (const strat of strategies) {
        const r = results[strat.name];
        const netPnl = r.netPnl.toFixed(2);
        const avgDD = r.avgMaxDrawdown.toFixed(1);
        const label = strat.name.padEnd(27);
        console.log(`${label} | ${String(r.winners).padStart(3)} | ${String(r.losers).padStart(4)} | ${netPnl.padStart(7)}x | ${avgDD.padStart(8)}%`);
    }
}
testAdvancedStrategies().catch(console.error);
//# sourceMappingURL=test-advanced-strategies.js.map