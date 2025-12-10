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
const LSY_CALLS_CSV = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');
const OUTPUT_JSON = path.join(__dirname, '../data/exports/lsy_backtest_results.json');
const STRATEGY = [
    { percent: 0.5, target: 2 },
    { percent: 0.3, target: 5 },
    { percent: 0.2, target: 10 },
];
const STOP_LOSS = { initial: -1.0, trailing: 'none' }; // Basically no stop loss
async function backtestAllLSYCalls() {
    console.log('🚀 Starting backtest for all LSY calls using bot infrastructure...\n');
    // Read LSY calls
    const csv = fs.readFileSync(LSY_CALLS_CSV, 'utf8');
    const records = await new Promise((resolve, reject) => {
        (0, csv_parse_1.parse)(csv, { columns: true, skip_empty_lines: true }, (err, records) => {
            if (err)
                reject(err);
            else
                resolve(records);
        });
    });
    // Filter valid records
    const validRecords = records.filter((r) => !r.tokenAddress.includes('4444'));
    console.log(`📊 Found ${validRecords.length} valid LSY calls\n`);
    const results = [];
    for (let i = 0; i < validRecords.length; i++) {
        const call = validRecords[i];
        console.log(`\n[${i + 1}/${validRecords.length}] ${call.tokenAddress.substring(0, 30)}...`);
        try {
            const alertDate = luxon_1.DateTime.fromISO(call.timestamp);
            const entryDate = alertDate.minus({ hours: 0 }); // Use alert time as entry
            const endDate = luxon_1.DateTime.utc();
            console.log(`  📅 Period: ${entryDate.toFormat('yyyy-MM-dd HH:mm')} - ${endDate.toFormat('yyyy-MM-dd HH:mm')}`);
            // Fetch candles using bot's infrastructure
            // Pass alertDate as alertTime for 1m candles around alert time
            const candles = await (0, candles_1.fetchHybridCandles)(call.tokenAddress, entryDate, endDate, call.chain, alertDate);
            if (candles.length === 0) {
                console.log('  ⚠️ No candles available');
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
                console.log(`  ✅ PNL: ${result.finalPnl.toFixed(2)}x`);
                console.log(`  📊 Entry: $${entryPrice.toFixed(8)}, Final: $${result.finalPrice.toFixed(8)}`);
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
            console.error(`  ❌ Error:`, error.message);
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
    const totalPnl = successful.reduce((sum, r) => sum + (r.pnl || 0), 0);
    const avgPnl = successful.length > 0 ? totalPnl / successful.length : 0;
    console.log(`\n\n✅ Complete!`);
    console.log(`📊 Successful: ${successful.length}/${results.length}`);
    console.log(`💰 Total PNL: ${totalPnl.toFixed(2)}x`);
    console.log(`📈 Average PNL: ${avgPnl.toFixed(2)}x`);
    console.log(`💾 Results saved to: ${OUTPUT_JSON}`);
}
backtestAllLSYCalls().catch(console.error);
//# sourceMappingURL=backtest-all-lsy.js.map