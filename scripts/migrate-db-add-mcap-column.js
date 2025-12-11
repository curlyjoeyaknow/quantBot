#!/usr/bin/env ts-node
"use strict";
/**
 * Database Migration: Add entry_mcap Column
 *
 * Adds entry_mcap column to caller_alerts table if it doesn't exist
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
exports.addMcapColumn = addMcapColumn;
const sqlite3_1 = require("sqlite3");
const util_1 = require("util");
const path = __importStar(require("path"));
const DB_PATH = process.env.CALLER_DB_PATH || path.join(process.cwd(), 'data', 'caller_alerts.db');
async function addMcapColumn() {
    console.log('🔧 Adding entry_mcap column to database...\n');
    const db = new sqlite3_1.Database(DB_PATH);
    const run = (0, util_1.promisify)(db.run.bind(db));
    const get = (0, util_1.promisify)(db.get.bind(db));
    try {
        // Check if column already exists
        const tableInfo = await new Promise((resolve, reject) => {
            db.all('PRAGMA table_info(caller_alerts)', (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
        const hasEntryMcap = tableInfo.some((col) => col.name === 'entry_mcap');
        if (hasEntryMcap) {
            console.log('✅ entry_mcap column already exists');
        }
        else {
            console.log('📝 Adding entry_mcap column...');
            await run('ALTER TABLE caller_alerts ADD COLUMN entry_mcap REAL');
            console.log('✅ entry_mcap column added successfully');
        }
        // Check if we have the index
        const indexes = await new Promise((resolve, reject) => {
            db.all('PRAGMA index_list(caller_alerts)', (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
        const hasIndex = indexes.some((idx) => idx.name === 'idx_entry_mcap');
        if (hasIndex) {
            console.log('✅ Index on entry_mcap already exists');
        }
        else {
            console.log('📝 Creating index on entry_mcap...');
            await run('CREATE INDEX idx_entry_mcap ON caller_alerts(entry_mcap)');
            console.log('✅ Index created successfully');
        }
        // Count tokens
        const stats = await get(`
      SELECT 
        COUNT(*) as total,
        COUNT(entry_mcap) as with_mcap,
        COUNT(*) - COUNT(entry_mcap) as without_mcap
      FROM caller_alerts
    `);
        console.log('\n📊 Database Statistics:');
        console.log(`  Total calls:      ${stats.total}`);
        console.log(`  With MCAP:        ${stats.with_mcap}`);
        console.log(`  Without MCAP:     ${stats.without_mcap}`);
        if (stats.without_mcap > 0) {
            console.log(`\n💡 Run backfill script to fetch MCAP for ${stats.without_mcap} calls`);
            console.log('   npm run backfill:mcap');
        }
        db.close();
        console.log('\n✅ Migration complete!\n');
    }
    catch (error) {
        console.error('\n❌ Migration failed:', error);
        db.close();
        throw error;
    }
}
// Run if called directly
if (require.main === module) {
    addMcapColumn()
        .then(() => process.exit(0))
        .catch(error => {
        console.error(error);
        process.exit(1);
    });
}
//# sourceMappingURL=migrate-db-add-mcap-column.js.map