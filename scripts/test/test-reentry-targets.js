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
async function testReentryTargets() {
    console.log('🧪 Testing Re-entry with Different Profit Targets...\n');
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
    const targets = [2, 3, 4, 5, 7, 10];
    const results = {};
    for (const target of targets) {
        results[`reentry-${target}x`] = { winners: 0, losers: 0, netPnl: 0 };
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
            for (const target of targets) {
                // Set strategy: 100% at target
                const STRATEGY = [{ percent: 1.0, target }];
                // Configure stop loss: -30%
                const stopLossConfig = {
                    initial: -0.3,
                    trailing: 'none'
                };
                // Configure re-entry at alert bounce (70% retrace = back to alert price)
                const reEntryConfig = {
                    trailingReEntry: 0.7,
                    maxReEntries: 1,
                    sizePercent: 0.5
                };
                const result = (0, engine_1.simulateStrategy)(candles, STRATEGY, stopLossConfig, undefined, reEntryConfig);
                const pnl = result.finalPnl;
                if (pnl > 1) {
                    results[`reentry-${target}x`].winners++;
                    results[`reentry-${target}x`].netPnl += (pnl - 1);
                }
                else {
                    results[`reentry-${target}x`].losers++;
                    results[`reentry-${target}x`].netPnl += (pnl - 1);
                }
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
    console.log('\n📊 RESULTS:\n');
    console.log('Re-entry Strategy | Winners | Losers | Net PNL');
    console.log('------------------|---------|--------|---------');
    for (const target of targets) {
        const r = results[`reentry-${target}x`];
        const netPnl = r.netPnl.toFixed(2);
        const label = `TP @ ${target}x`.padEnd(17);
        console.log(`${label} | ${String(r.winners).padStart(7)} | ${String(r.losers).padStart(6)} | ${netPnl.padStart(7)}x`);
    }
}
testReentryTargets().catch(console.error);
//# sourceMappingURL=test-reentry-targets.js.map