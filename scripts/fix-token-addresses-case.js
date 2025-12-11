#!/usr/bin/env tsx
"use strict";
/**
 * Fix token addresses in PostgreSQL to use correct case from SQLite
 * Solana addresses are CASE SENSITIVE - lowercase breaks API calls
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
const pg_1 = require("pg");
const fs = __importStar(require("fs"));
const readline = __importStar(require("readline"));
const pgPool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'quantbot',
    password: process.env.POSTGRES_PASSWORD || 'quantbot',
    database: process.env.POSTGRES_DB || 'quantbot',
});
async function main() {
    console.log('🔄 Fixing token address case in PostgreSQL...\n');
    // Read mapping file
    const mappingFile = '/tmp/address_mapping.csv';
    const fileStream = fs.createReadStream(mappingFile);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });
    const mappings = new Map();
    for await (const line of rl) {
        const [lower, correct] = line.split('|');
        if (lower && correct) {
            mappings.set(lower.trim(), correct.trim());
        }
    }
    console.log(`📊 Loaded ${mappings.size} address mappings\n`);
    const client = await pgPool.connect();
    let updated = 0;
    let notFound = 0;
    try {
        await client.query('BEGIN');
        for (const [lower, correct] of mappings) {
            const result = await client.query(`UPDATE tokens SET address = $1, updated_at = NOW() WHERE LOWER(address) = $2 AND address != $1`, [correct, lower]);
            if (result.rowCount && result.rowCount > 0) {
                updated++;
                if (updated % 100 === 0) {
                    console.log(`Updated ${updated} tokens...`);
                }
            }
            else {
                notFound++;
            }
        }
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`   ✅ Updated: ${updated} token addresses`);
    console.log(`   ⏭️ Not found/already correct: ${notFound}`);
    // Verify
    const sample = await pgPool.query(`
    SELECT address, symbol 
    FROM tokens 
    WHERE chain = 'solana' 
    AND address != LOWER(address)
    LIMIT 10
  `);
    console.log('\n📋 Sample of corrected addresses:');
    for (const row of sample.rows) {
        console.log(`   ${row.address} (${row.symbol})`);
    }
    await pgPool.end();
}
main().catch(console.error);
//# sourceMappingURL=fix-token-addresses-case.js.map