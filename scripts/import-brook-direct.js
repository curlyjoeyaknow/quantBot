#!/usr/bin/env ts-node
"use strict";
/**
 * Direct Import without init (to avoid table recreation)
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
const sync_1 = require("csv-parse/sync");
const client_1 = require("@clickhouse/client");
const luxon_1 = require("luxon");
const OHLCV_DIR = path.join(process.cwd(), 'data', 'raw', 'brook_ohlcv');
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 18123;
const client = (0, client_1.createClient)({
    url: `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`,
    database: 'quantbot',
});
function parseFilename(filename) {
    const basename = path.basename(filename, '.csv');
    const parts = basename.split('_');
    if (parts.length < 3)
        return null;
    return {
        chain: parts[parts.length - 1],
        address: parts[parts.length - 2],
        symbol: parts.slice(0, -2).join('_'),
    };
}
function loadCandlesFromCSV(filePath) {
    const csvContent = fs.readFileSync(filePath, 'utf8');
    const records = (0, sync_1.parse)(csvContent, { columns: true, skip_empty_lines: true });
    return records.map((r) => ({
        timestamp: Math.floor(parseInt(r.Timestamp) / 1000),
        open: parseFloat(r.Open) || 0,
        high: parseFloat(r.High) || 0,
        low: parseFloat(r.Low) || 0,
        close: parseFloat(r.Close) || 0,
        volume: parseFloat(r.Volume) || 0,
    })).filter((c) => !isNaN(c.timestamp) && c.timestamp > 0);
}
async function main() {
    console.log('🔄 Direct import to ClickHouse...\n');
    const files = fs.readdirSync(OHLCV_DIR).filter(f => f.endsWith('.csv'));
    console.log(`📂 Found ${files.length} CSV files\n`);
    let migrated = 0;
    let totalCandles = 0;
    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const info = parseFilename(filename);
        if (!info)
            continue;
        process.stdout.write(`[${i + 1}/${files.length}] ${info.symbol}... `);
        try {
            const candles = loadCandlesFromCSV(path.join(OHLCV_DIR, filename));
            if (candles.length === 0) {
                console.log('⚠️  Empty');
                continue;
            }
            const rows = candles.map(c => ({
                token_address: info.address,
                chain: info.chain,
                timestamp: luxon_1.DateTime.fromSeconds(c.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
                interval: '5m',
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
            }));
            await client.insert({
                table: 'quantbot.ohlcv_candles',
                values: rows,
                format: 'JSONEachRow',
            });
            console.log(`✅ ${candles.length.toLocaleString()} candles`);
            migrated++;
            totalCandles += candles.length;
        }
        catch (error) {
            console.log(`❌ ${error.message.substring(0, 50)}`);
        }
    }
    console.log(`\n📊 Summary: ${migrated}/${files.length} files, ${totalCandles.toLocaleString()} total candles`);
    await client.close();
}
main();
//# sourceMappingURL=import-brook-direct.js.map