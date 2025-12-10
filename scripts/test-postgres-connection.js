#!/usr/bin/env tsx
"use strict";
/**
 * Quick test script to verify PostgreSQL connection and data
 */
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const pool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'quantbot',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DATABASE || 'quantbot',
});
async function testConnection() {
    console.log('🔍 Testing PostgreSQL Connection...\n');
    try {
        // Test connection
        const versionResult = await pool.query('SELECT NOW(), version()');
        console.log('✅ PostgreSQL Connection Successful!');
        console.log('📅 Server Time:', versionResult.rows[0].now);
        console.log('🐘 PostgreSQL Version:', versionResult.rows[0].version.split(',')[0]);
        console.log('');
        // Get data counts
        const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM alerts) as alerts,
        (SELECT COUNT(*) FROM tokens) as tokens,
        (SELECT COUNT(*) FROM callers) as callers,
        (SELECT COUNT(*) FROM dashboard_metrics) as metrics,
        (SELECT COUNT(*) FROM strategies) as strategies
    `);
        console.log('📊 Migrated Data Summary:');
        console.log('  🔔 Alerts:            ', counts.rows[0].alerts);
        console.log('  🪙 Tokens:            ', counts.rows[0].tokens);
        console.log('  📞 Callers:           ', counts.rows[0].callers);
        console.log('  📈 Dashboard Metrics: ', counts.rows[0].metrics);
        console.log('  🎯 Strategies:        ', counts.rows[0].strategies);
        console.log('');
        // Sample some recent data
        const recentAlerts = await pool.query(`
      SELECT 
        a.id,
        t.symbol as token_symbol,
        c.handle as caller_handle,
        a.alert_timestamp
      FROM alerts a
      LEFT JOIN tokens t ON t.id = a.token_id
      LEFT JOIN callers c ON c.id = a.caller_id
      ORDER BY a.alert_timestamp DESC
      LIMIT 5
    `);
        console.log('🔔 Recent Alerts (Last 5):');
        recentAlerts.rows.forEach((row, idx) => {
            console.log(`  ${idx + 1}. ${row.caller_handle || 'Unknown'} → ${row.token_symbol || 'N/A'} at ${row.alert_timestamp}`);
        });
        console.log('');
        // Database size
        const sizeResult = await pool.query(`
      SELECT 
        pg_size_pretty(pg_database_size('quantbot')) as db_size
    `);
        console.log('💾 Database Size:', sizeResult.rows[0].db_size);
        console.log('');
        console.log('✅ All tests passed! Your PostgreSQL database is ready to use.');
        await pool.end();
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Connection Failed:', error);
        console.error('');
        console.error('Troubleshooting:');
        console.error('1. Check that PostgreSQL is running: docker-compose ps');
        console.error('2. Verify .env file has correct credentials');
        console.error('3. Check logs: docker-compose logs postgres');
        await pool.end();
        process.exit(1);
    }
}
testConnection();
//# sourceMappingURL=test-postgres-connection.js.map