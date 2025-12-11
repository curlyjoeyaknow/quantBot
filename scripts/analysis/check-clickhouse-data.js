"use strict";
/**
 * Check if ClickHouse has data for tokens in unified_calls
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkClickHouseData = checkClickHouseData;
const sqlite3_1 = require("sqlite3");
const util_1 = require("util");
const luxon_1 = require("luxon");
const dotenv_1 = require("dotenv");
const clickhouse_client_1 = require("../../src/storage/clickhouse-client");
const logger_1 = require("../../src/utils/logger");
const create_unified_calls_table_1 = require("./create-unified-calls-table");
(0, dotenv_1.config)();
async function checkClickHouseData() {
    const db = new sqlite3_1.Database(create_unified_calls_table_1.UNIFIED_DB_PATH);
    const all = (0, util_1.promisify)(db.all.bind(db));
    const close = (0, util_1.promisify)(db.close.bind(db));
    try {
        // Get sample of valid tokens
        const rows = await all(`
      SELECT DISTINCT token_address, chain, MIN(call_timestamp) as first_call
      FROM unified_calls 
      WHERE call_timestamp > 1577836800 AND call_timestamp < 2000000000
      GROUP BY token_address, chain
      ORDER BY first_call DESC
      LIMIT 20
    `);
        logger_1.logger.info('Checking ClickHouse data', { tokenCount: rows.length });
        let foundCount = 0;
        let notFoundCount = 0;
        for (const row of rows) {
            const tokenAddress = row.token_address;
            const chain = row.chain;
            const callTimestamp = row.first_call;
            // Query for 1 hour before to 1 day after call
            const startTime = luxon_1.DateTime.fromSeconds(callTimestamp - 3600);
            const endTime = luxon_1.DateTime.fromSeconds(callTimestamp + 86400);
            try {
                const candles = await (0, clickhouse_client_1.queryCandles)(tokenAddress, chain, startTime, endTime, '5m');
                if (candles && candles.length > 0) {
                    foundCount++;
                    logger_1.logger.info('✅ Found data in ClickHouse', {
                        tokenAddress: tokenAddress.substring(0, 30),
                        chain,
                        candleCount: candles.length,
                        firstCandle: new Date(candles[0].timestamp * 1000).toISOString(),
                        lastCandle: new Date(candles[candles.length - 1].timestamp * 1000).toISOString(),
                    });
                }
                else {
                    notFoundCount++;
                    logger_1.logger.debug('❌ No data in ClickHouse', {
                        tokenAddress: tokenAddress.substring(0, 30),
                        chain,
                        callTimestamp: new Date(callTimestamp * 1000).toISOString(),
                    });
                }
            }
            catch (error) {
                notFoundCount++;
                logger_1.logger.warn('Error querying ClickHouse', {
                    tokenAddress: tokenAddress.substring(0, 30),
                    error: error.message,
                });
            }
            // Small delay to avoid overwhelming ClickHouse
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        logger_1.logger.info('ClickHouse data check complete', {
            total: rows.length,
            found: foundCount,
            notFound: notFoundCount,
            foundPercent: ((foundCount / rows.length) * 100).toFixed(1) + '%',
        });
    }
    catch (error) {
        logger_1.logger.error('Error checking ClickHouse data', error);
    }
    finally {
        await close();
    }
}
if (require.main === module) {
    checkClickHouseData().catch(error => {
        logger_1.logger.error('Fatal error', error);
        process.exit(1);
    });
}
//# sourceMappingURL=check-clickhouse-data.js.map