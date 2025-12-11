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
const STRATEGY = [
    { percent: 0.5, target: 2 },
    { percent: 0.3, target: 5 },
    { percent: 0.2, target: 10 },
];
const STOP_LOSS = { initial: -0.3, trailing: 'none' };
async function testStrategies() {
    console.log('🚀 Testing Alternative Dip Entry Strategies...\n');
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
    const results = {
        strategy1_waitForDip: { winners: 0, losers: 0, netPnl: 0 },
        strategy2_waitForDipBigger: { winners: 0, losers: 0, netPnl: 0 },
        strategy3_bounceFromLow: { winners: 0, losers: 0, netPnl: 0 },
        strategy4_veryDeepDip: { winners: 0, losers: 0, netPnl: 0 },
    };
    let processed = 0;
    for (let i = 0; i < Math.min(brookOnly.length, 50); i++) {
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
            // Strategy 1: Wait for -30% dip then enter
            const entry1_price = alertPrice * 0.7;
            let entry1_idx = -1;
            for (let j = 1; j < candles.length; j++) {
                if (candles[j].low <= entry1_price) {
                    entry1_idx = j;
                    break;
                }
            }
            // Strategy 2: Wait for -50% dip then enter  
            const entry2_price = alertPrice * 0.5;
            let entry2_idx = -1;
            for (let j = 1; j < candles.length; j++) {
                if (candles[j].low <= entry2_price) {
                    entry2_idx = j;
                    break;
                }
            }
            // Strategy 3: Wait for -30% dip, then wait for bounce (+10% from low)
            let entry3_idx = -1;
            let entry3_price = alertPrice * 0.7;
            for (let j = 1; j < candles.length; j++) {
                if (candles[j].low <= alertPrice * 0.7) {
                    // Found dip, now look for bounce
                    for (let k = j + 1; k < candles.length && k < j + 100; k++) {
                        if (candles[k].high >= candles[j].low * 1.1) {
                            entry3_idx = k;
                            entry3_price = candles[k].close;
                            break;
                        }
                    }
                    break;
                }
            }
            // Strategy 4: Wait for -70% dip then enter
            const entry4_price = alertPrice * 0.3;
            let entry4_idx = -1;
            for (let j = 1; j < candles.length; j++) {
                if (candles[j].low <= entry4_price) {
                    entry4_idx = j;
                    break;
                }
            }
            // Simulate each strategy if entry found
            const strategies = [
                { idx: entry1_idx, price: entry1_price, name: 'Strategy 1: -30% dip' },
                { idx: entry2_idx, price: entry2_price, name: 'Strategy 2: -50% dip' },
                { idx: entry3_idx, price: entry3_price, name: 'Strategy 3: Bounce from -30%' },
                { idx: entry4_idx, price: entry4_price, name: 'Strategy 4: -70% dip' },
            ];
            for (let s = 0; s < strategies.length; s++) {
                const strat = strategies[s];
                if (strat.idx === -1)
                    continue;
                const entryCandles = candles.slice(strat.idx);
                const result = (0, engine_1.simulateStrategy)(entryCandles, STRATEGY, STOP_LOSS, undefined, { trailingReEntry: 'none', maxReEntries: 0, sizePercent: 0.5 });
                const multiplier = result.finalPrice / alertPrice;
                const pnl = result.finalPnl;
                if (pnl > 1) {
                    results[`strategy${s + 1}_waitForDip`].winners++;
                }
                else {
                    results[`strategy${s + 1}_waitForDip`].losers++;
                }
                results[`strategy${s + 1}_waitForDip`].netPnl += (pnl - 1);
            }
            processed++;
            if (processed % 10 === 0)
                console.log(`Processed ${processed}/50...`);
        }
        catch (error) {
            continue;
        }
    }
    console.log('\n\n📊 Strategy Comparison:');
    console.log('\n1. Wait for -30% dip, then enter:');
    console.log(`   Winners: ${results.strategy1_waitForDip.winners}, Losers: ${results.strategy1_waitForDip.losers}`);
    console.log(`   Net PNL: ${results.strategy1_waitForDip.netPnl.toFixed(2)}x`);
    console.log('\n2. Wait for -50% dip, then enter:');
    console.log(`   Winners: ${results.strategy2_waitForDipBigger.winners}, Losers: ${results.strategy2_waitForDipBigger.losers}`);
    console.log(`   Net PNL: ${results.strategy2_waitForDipBigger.netPnl.toFixed(2)}x`);
    console.log('\n3. Wait for -30% dip, bounce +10%, then enter:');
    console.log(`   Winners: ${results.strategy3_bounceFromLow.winners}, Losers: ${results.strategy3_bounceFromLow.losers}`);
    console.log(`   Net PNL: ${results.strategy3_bounceFromLow.netPnl.toFixed(2)}x`);
    console.log('\n4. Wait for -70% dip, then enter:');
    console.log(`   Winners: ${results.strategy4_veryDeepDip.winners}, Losers: ${results.strategy4_veryDeepDip.losers}`);
    console.log(`   Net PNL: ${results.strategy4_veryDeepDip.netPnl.toFixed(2)}x`);
}
testStrategies().catch(console.error);
//# sourceMappingURL=test-dip-strategies.js.map