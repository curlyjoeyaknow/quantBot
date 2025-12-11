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
const STOP_LOSS = { initial: -0.3, trailing: 'none' };
async function testProfitTargets() {
    console.log('🧪 Testing Different Profit Targets on Brook Calls...\n');
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
        { name: '2x target', target: 2, reentry: false },
        { name: '3x target', target: 3, reentry: false },
        { name: '4x target', target: 4, reentry: false },
        { name: '5x target', target: 5, reentry: false },
        { name: '7x target', target: 7, reentry: false },
        { name: '3x target + re-entry', target: 3, reentry: true },
    ];
    const results = {};
    for (const strat of strategies) {
        results[strat.name] = { winners: 0, losers: 0, netPnl: 0, total: 0 };
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
                // Configure re-entry
                const reEntryConfig = strat.reentry ? {
                    trailingReEntry: 'none',
                    maxReEntries: 1,
                    sizePercent: 0.5
                } : {
                    trailingReEntry: 'none',
                    maxReEntries: 0,
                    sizePercent: 0.5
                };
                const result = (0, engine_1.simulateStrategy)(candles, STRATEGY, STOP_LOSS, undefined, reEntryConfig);
                // Calculate PNL
                const pnl = result.finalPnl;
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
    console.log('\n📊 RESULTS:\n');
    console.log('Strategy | Winners | Losers | Net PNL');
    console.log('--------|---------|--------|---------');
    for (const strat of strategies) {
        const r = results[strat.name];
        const netPnl = r.netPnl.toFixed(2);
        console.log(`${strat.name.padEnd(20)} | ${String(r.winners).padStart(7)} | ${String(r.losers).padStart(6)} | ${netPnl.padStart(7)}x`);
    }
}
testProfitTargets().catch(console.error);
//# sourceMappingURL=test-profit-targets.js.map