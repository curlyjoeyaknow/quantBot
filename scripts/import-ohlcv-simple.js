#!/usr/bin/env tsx
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
require("dotenv/config");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sync_1 = require("csv-parse/sync");
const client_1 = require("@clickhouse/client");
const luxon_1 = require("luxon");
const DIR = path.join(process.cwd(), 'data', 'raw', 'brook_ohlcv');
const client = (0, client_1.createClient)({
    url: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 18123}`,
    database: 'quantbot',
});
async function main() {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv'));
    console.log(`Importing ${files.length} files...\n`);
    let total = 0;
    for (const file of files) {
        const parts = path.basename(file, '.csv').split('_');
        const chain = parts[parts.length - 1];
        const address = parts[parts.length - 2];
        const csv = fs.readFileSync(path.join(DIR, file), 'utf8');
        const records = (0, sync_1.parse)(csv, { columns: true, skip_empty_lines: true });
        const rows = records.map((r) => ({
            token_address: address,
            chain,
            timestamp: luxon_1.DateTime.fromMillis(parseInt(r.Timestamp)).toFormat('yyyy-MM-dd HH:mm:ss'),
            interval: '5m',
            open: parseFloat(r.Open),
            high: parseFloat(r.High),
            low: parseFloat(r.Low),
            close: parseFloat(r.Close),
            volume: parseFloat(r.Volume) || 0,
        }));
        try {
            await client.insert({
                table: 'ohlcv_candles',
                values: rows,
                format: 'JSONEachRow',
            });
            console.log(`✅ ${file.substring(0, 30)}: ${rows.length} candles`);
            total += rows.length;
        }
        catch (error) {
            console.log(`❌ ${file}: ${error.message}`);
            throw error; // Stop on first error to see what's wrong
        }
    }
    console.log(`\n✅ Total: ${total.toLocaleString()} candles`);
    await client.close();
}
main();
//# sourceMappingURL=import-ohlcv-simple.js.map