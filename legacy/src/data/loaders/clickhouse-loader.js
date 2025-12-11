"use strict";
/**
 * ClickHouse Data Loader
 *
 * Loads trading call data from ClickHouse database
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClickHouseDataLoader = void 0;
const luxon_1 = require("luxon");
const clickhouse_client_1 = require("../../storage/clickhouse-client");
class ClickHouseDataLoader {
    constructor() {
        this.name = 'clickhouse-loader';
    }
    async load(params) {
        const chParams = params;
        // If custom query provided, use it
        if (chParams.query) {
            const client = (0, clickhouse_client_1.getClickHouseClient)();
            const result = await client.query({
                query: chParams.query,
                format: 'JSONEachRow',
            });
            const data = await result.json();
            return this.transformResults(data);
        }
        // Otherwise, query candles and transform
        if (!chParams.mint || !chParams.startTime || !chParams.endTime) {
            throw new Error('ClickHouse loader requires mint, startTime, and endTime for candle queries');
        }
        const chain = chParams.chain || 'solana';
        const candles = await (0, clickhouse_client_1.queryCandles)(chParams.mint, chain, chParams.startTime, chParams.endTime);
        // Transform candles to LoadResult format
        // For candle queries, we create a single result entry
        if (candles.length === 0) {
            return [];
        }
        return [{
                mint: chParams.mint,
                chain,
                timestamp: chParams.startTime,
                tokenAddress: chParams.mint,
                // Include metadata if available
                candlesCount: candles.length,
                firstCandle: candles[0],
                lastCandle: candles[candles.length - 1],
            }];
    }
    canLoad(source) {
        return source === 'clickhouse' || source.startsWith('clickhouse://');
    }
    transformResults(rows) {
        return rows.map(row => ({
            mint: row.token_address || row.mint || row.tokenAddress,
            chain: row.chain || 'solana',
            timestamp: row.timestamp
                ? luxon_1.DateTime.fromJSDate(new Date(row.timestamp))
                : luxon_1.DateTime.now(),
            tokenAddress: row.token_address || row.mint || row.tokenAddress,
            tokenSymbol: row.token_symbol || row.symbol,
            tokenName: row.token_name || row.name,
            caller: row.caller || row.creator || row.sender,
            ...row,
        }));
    }
}
exports.ClickHouseDataLoader = ClickHouseDataLoader;
//# sourceMappingURL=clickhouse-loader.js.map