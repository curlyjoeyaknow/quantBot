#!/usr/bin/env ts-node
"use strict";
/**
 * Import Brook OHLCV CSV files to ClickHouse
 * Format: Symbol_Address_Chain.csv
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
const storage_1 = require("@quantbot/storage");
const client_1 = require("@clickhouse/client");
const luxon_1 = require("luxon");
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';
const CLICKHOUSE_PORT = process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 18123;
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';
const client = (0, client_1.createClient)({
    url: `http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}`,
    database: CLICKHOUSE_DATABASE,
});
const OHLCV_DIR = path.join(process.cwd(), 'data', 'raw', 'brook_ohlcv');
function parseFilename(filename) {
    // Format: Symbol_Address_Chain.csv
    // Example: DTV_CPLTbYbt_solana.csv
    const basename = path.basename(filename, '.csv');
    const parts = basename.split('_');
    if (parts.length < 3)
        return null;
    const chain = parts[parts.length - 1];
    const address = parts[parts.length - 2];
    const symbol = parts.slice(0, -2).join('_');
    return { symbol, address, chain };
}
function loadCandlesFromCSV(filePath) {
    const csvContent = fs.readFileSync(filePath, 'utf8');
    const records = (0, sync_1.parse)(csvContent, {
        columns: true,
        skip_empty_lines: true,
    });
    return records.map((record) => ({
        timestamp: Math.floor(parseInt(record.Timestamp) / 1000), // Convert ms to seconds
        open: parseFloat(record.Open) || 0,
        high: parseFloat(record.High) || 0,
        low: parseFloat(record.Low) || 0,
        close: parseFloat(record.Close) || 0,
        volume: parseFloat(record.Volume) || 0,
    })).filter((c) => !isNaN(c.timestamp) && c.timestamp > 0);
}
async function main() {
    console.log('🔄 Importing Brook OHLCV data to ClickHouse...\n');
    // DO NOT call initClickHouse() - it recreates tables and wipes data!
    // Table should already exist from initial setup
    if (!fs.existsSync(OHLCV_DIR)) {
        console.error(`❌ Directory not found: ${OHLCV_DIR}`);
        await (0, storage_1.closeClickHouse)();
        process.exit(1);
    }
    const files = fs.readdirSync(OHLCV_DIR).filter(f => f.endsWith('.csv'));
    console.log(`📂 Found ${files.length} CSV files\n`);
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    let totalCandles = 0;
    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const fileInfo = parseFilename(filename);
        if (!fileInfo) {
            console.log(`[${i + 1}/${files.length}] ⚠️  Skipping invalid filename: ${filename}`);
            skipped++;
            continue;
        }
        process.stdout.write(`[${i + 1}/${files.length}] ${fileInfo.symbol} (${fileInfo.chain})... `);
        try {
            const filePath = path.join(OHLCV_DIR, filename);
            const candles = loadCandlesFromCSV(filePath);
            if (candles.length === 0) {
                console.log('⚠️  Empty file');
                skipped++;
                continue;
            }
            // Insert directly to avoid is_backfill issue
            const rows = candles.map(c => ({
                token_address: fileInfo.address,
                chain: fileInfo.chain,
                timestamp: luxon_1.DateTime.fromSeconds(c.timestamp).toFormat('yyyy-MM-dd HH:mm:ss'),
                interval: '5m',
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
            }));
            await client.insert({
                table: `${CLICKHOUSE_DATABASE}.ohlcv_candles`,
                values: rows,
                format: 'JSONEachRow',
            });
            console.log(`✅ Imported ${candles.length.toLocaleString()} candles`);
            migrated++;
            totalCandles += candles.length;
        }
        catch (error) {
            console.log(`❌ Error: ${error.message}`);
            failed++;
        }
    }
    console.log(`\n📊 Import Summary:`);
    console.log(`   ✅ Imported: ${migrated} files`);
    console.log(`   ⏭️  Skipped: ${skipped} files`);
    console.log(`   ❌ Failed: ${failed} files`);
    console.log(`   📈 Total candles: ${totalCandles.toLocaleString()}`);
    await (0, storage_1.closeClickHouse)();
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=import-brook-ohlcv-to-clickhouse.js.map