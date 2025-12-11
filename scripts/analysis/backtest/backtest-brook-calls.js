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
const OUTPUT_JSON = path.join(__dirname, '../data/exports/brook_backtest_results.json');
const STRATEGY = [
    { percent: 0.5, target: 2 },
    { percent: 0.3, target: 5 },
    { percent: 0.2, target: 10 },
];
const STOP_LOSS = { initial: -0.3, trailing: 'none' };
async function backtestBrookCalls() {
    console.log('🚀 Starting backtest for Brook/Whale calls...\n');
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
    // Filter for Brook calls only
    const brookOnly = records.filter((r) => r.sender && (r.sender.includes('Brook') ||
        r.sender.includes('brook') ||
        r.sender.includes('Brook Giga')) && !r.tokenAddress.includes('bonk') && r.tokenAddress.length > 20);
    console.log(`📊 Found ${brookOnly.length} Brook calls\n`);
    const results = [];
    let successCount = 0;
    for (let i = 0; i < brookOnly.length && i < 100; i++) {
        const call = brookOnly[i];
        if (i % 10 === 0)
            console.log(`\n[${i}/${Math.min(brookOnly.length, 100)}] Processing...`);
        try {
            const alertDate = luxon_1.DateTime.fromISO(call.timestamp);
            const endDate = luxon_1.DateTime.utc();
            if (i % 10 === 0)
                console.log(`  📅 ${alertDate.toFormat('yyyy-MM-dd HH:mm')} - ${endDate.toFormat('yyyy-MM-dd HH:mm')}`);
            // Fetch candles using bot's infrastructure
            const candles = await (0, candles_1.fetchHybridCandles)(call.tokenAddress, alertDate, endDate, call.chain);
            if (i % 10 === 0)
                console.log(`  📊 ${candles.length} candles`);
            if (candles.length === 0) {
                results.push({
                    address: call.tokenAddress,
                    timestamp: call.timestamp,
                    chain: call.chain,
                    success: false,
                    error: 'No candles available'
                });
                continue;
            }
            // Use alert price as entry
            const entryPrice = candles[0].close;
            // Run simulation
            const result = (0, engine_1.simulateStrategy)(candles, STRATEGY, STOP_LOSS);
            if (result) {
                successCount++;
                if (i % 10 === 0) {
                    console.log(`  ✅ PNL: ${result.finalPnl.toFixed(2)}x`);
                }
                results.push({
                    address: call.tokenAddress,
                    timestamp: call.timestamp,
                    chain: call.chain,
                    entryPrice: entryPrice.toFixed(8),
                    finalPrice: result.finalPrice.toFixed(8),
                    pnl: parseFloat(result.finalPnl.toFixed(2)),
                    multiplier: parseFloat((result.finalPrice / entryPrice).toFixed(2)),
                    events: result.events.length,
                    candles: candles.length,
                    success: true
                });
            }
        }
        catch (error) {
            if (i % 10 === 0) {
                console.error(`  ❌ Error:`, error.message);
            }
            results.push({
                address: call.tokenAddress,
                timestamp: call.timestamp,
                chain: call.chain,
                success: false,
                error: error.message
            });
        }
    }
    // Save results
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
    // Summary
    const successful = results.filter(r => r.success);
    const winners = successful.filter(r => (r.pnl || 0) > 1);
    const losers = successful.filter(r => (r.pnl || 0) <= 1);
    const totalGain = winners.reduce((s, r) => s + ((r.pnl || 0) - 1), 0);
    const totalLoss = losers.reduce((s, r) => s + ((r.pnl || 0) - 1), 0);
    const netPnl = totalGain + totalLoss;
    const avgPnl = successful.length > 0 ?
        successful.reduce((s, r) => s + (r.pnl || 0), 0) / successful.length : 0;
    console.log(`\n\n✅ Complete!`);
    console.log(`📊 Successful: ${successful.length}/${results.length}`);
    console.log(`🎯 Winners (>1x): ${winners.length}`);
    console.log(`❌ Losers (<=1x): ${losers.length}`);
    console.log(`💰 Net PNL: ${netPnl.toFixed(2)}x (${(netPnl * 100).toFixed(1)}%)`);
    console.log(`📈 Average: ${avgPnl.toFixed(2)}x`);
    console.log(`💾 Results saved to: ${OUTPUT_JSON}`);
}
backtestBrookCalls().catch(console.error);
//# sourceMappingURL=backtest-brook-calls.js.map