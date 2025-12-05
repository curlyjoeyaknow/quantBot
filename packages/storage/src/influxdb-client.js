"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.influxDBClient = exports.InfluxDBOHLCVClient = void 0;
const influxdb_client_1 = require("@influxdata/influxdb-client");
const influxdb_client_apis_1 = require("@influxdata/influxdb-client-apis");
const dotenv_1 = require("dotenv");
const utils_1 = require("@quantbot/utils");
(0, dotenv_1.config)();
class InfluxDBOHLCVClient {
    constructor() {
        const url = process.env.INFLUX_URL || 'http://localhost:8086';
        const token = process.env.INFLUX_TOKEN || '';
        this.org = process.env.INFLUX_ORG || 'quantbot';
        this.bucket = process.env.INFLUX_BUCKET || 'ohlcv_data';
        this.influxDB = new influxdb_client_1.InfluxDB({ url: url, token: token });
        this.writeApi = this.influxDB.getWriteApi(this.org, this.bucket);
        this.queryApi = this.influxDB.getQueryApi(this.org);
        this.managementApi = new influxdb_client_apis_1.BucketsAPI(this.influxDB);
        // Configure write options
        this.writeApi.useDefaultTags({
            source: 'quantbot'
        });
    }
    /**
     * Initialize InfluxDB bucket and retention policy
     */
    async initialize() {
        try {
            utils_1.logger.info('Initializing InfluxDB...');
            // Check if bucket exists
            const buckets = await this.managementApi.getBuckets({ org: this.org });
            const existingBucket = buckets?.buckets?.find((b) => b.name === this.bucket);
            if (!existingBucket) {
                utils_1.logger.info('Creating bucket', { bucket: this.bucket });
                await this.managementApi.postBuckets({
                    body: {
                        name: this.bucket,
                        orgID: this.org,
                        retentionRules: [
                            {
                                type: 'expire',
                                everySeconds: 0 // Infinite retention
                            }
                        ]
                    }
                });
                utils_1.logger.info('Bucket created successfully', { bucket: this.bucket });
            }
            else {
                utils_1.logger.info('Bucket already exists', { bucket: this.bucket });
            }
            // Test write and read
            await this.testConnection();
        }
        catch (error) {
            utils_1.logger.error('Failed to initialize InfluxDB', error);
            throw error;
        }
    }
    /**
     * Test InfluxDB connection with a simple write and read
     */
    async testConnection() {
        const testPoint = new influxdb_client_1.Point('connection_test')
            .tag('test', 'true')
            .floatField('value', 1.0)
            .timestamp(new Date());
        this.writeApi.writePoint(testPoint);
        await this.writeApi.flush();
        const query = `
      from(bucket: "${this.bucket}")
        |> range(start: -1m)
        |> filter(fn: (r) => r._measurement == "connection_test")
        |> limit(n: 1)
    `;
        const result = await this.queryApi.collectRows(query);
        utils_1.logger.info('InfluxDB connection test successful');
    }
    /**
     * Write OHLCV data points to InfluxDB
     */
    async writeOHLCVData(tokenAddress, tokenSymbol, chain, data) {
        try {
            const points = data.map(candle => {
                return new influxdb_client_1.Point('candles')
                    .tag('token_address', tokenAddress.toLowerCase())
                    .tag('token_symbol', tokenSymbol)
                    .tag('chain', chain)
                    .floatField('open', candle.open)
                    .floatField('high', candle.high)
                    .floatField('low', candle.low)
                    .floatField('close', candle.close)
                    .floatField('volume', candle.volume)
                    .timestamp(candle.timestamp);
            });
            this.writeApi.writePoints(points);
            await this.writeApi.flush();
            utils_1.logger.info('Written OHLCV records', { recordCount: data.length, tokenSymbol, tokenAddress });
        }
        catch (error) {
            utils_1.logger.error('Failed to write OHLCV data', error, { tokenAddress });
            throw error;
        }
    }
    /**
     * Query OHLCV data from InfluxDB
     */
    async getOHLCVData(tokenAddress, startTime, endTime, interval = '1m') {
        try {
            const query = `
        from(bucket: "${this.bucket}")
          |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})
          |> filter(fn: (r) => r._measurement == "candles")
          |> filter(fn: (r) => r.token_address == "${tokenAddress.toLowerCase()}")
          |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> sort(columns: ["_time"])
      `;
            const result = await this.queryApi.collectRows(query);
            return result.map((row) => ({
                timestamp: new Date(row._time).getTime(),
                dateTime: new Date(row._time),
                open: parseFloat(row.open) || 0,
                high: parseFloat(row.high) || 0,
                low: parseFloat(row.low) || 0,
                close: parseFloat(row.close) || 0,
                volume: parseFloat(row.volume) || 0
            }));
        }
        catch (error) {
            utils_1.logger.error('Failed to query OHLCV data', error, { tokenAddress });
            throw error;
        }
    }
    /**
     * Get latest price for a token
     */
    async getLatestPrice(tokenAddress) {
        try {
            const query = `
        from(bucket: "${this.bucket}")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement == "candles")
          |> filter(fn: (r) => r.token_address == "${tokenAddress.toLowerCase()}")
          |> filter(fn: (r) => r._field == "close")
          |> last()
      `;
            const result = await this.queryApi.collectRows(query);
            if (result.length > 0) {
                return parseFloat(result[0]._value);
            }
            return 0;
        }
        catch (error) {
            utils_1.logger.error('Failed to get latest price', error, { tokenAddress });
            return 0;
        }
    }
    /**
     * Check if data exists for token in time range
     */
    async hasData(tokenAddress, startTime, endTime) {
        try {
            const query = `
        from(bucket: "${this.bucket}")
          |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})
          |> filter(fn: (r) => r._measurement == "candles")
          |> filter(fn: (r) => r.token_address == "${tokenAddress.toLowerCase()}")
          |> limit(n: 1)
      `;
            const result = await this.queryApi.collectRows(query);
            return result.length > 0;
        }
        catch (error) {
            utils_1.logger.error('Failed to check data existence', error, { tokenAddress });
            return false;
        }
    }
    /**
     * Get all tokens with available data
     */
    async getAvailableTokens() {
        try {
            const query = `
        from(bucket: "${this.bucket}")
          |> range(start: -30d)
          |> filter(fn: (r) => r._measurement == "candles")
          |> group(columns: ["token_address", "token_symbol", "chain"])
          |> count()
          |> group()
          |> sort(columns: ["_value"], desc: true)
      `;
            const result = await this.queryApi.collectRows(query);
            return result.map((row) => ({
                address: row.token_address,
                symbol: row.token_symbol,
                chain: row.chain,
                recordCount: parseInt(row._value),
                firstTimestamp: 0, // Would need separate query for this
                lastTimestamp: 0 // Would need separate query for this
            }));
        }
        catch (error) {
            utils_1.logger.error('Failed to get available tokens', error);
            return [];
        }
    }
    /**
     * Get record count for a specific token
     */
    async getTokenRecordCount(tokenAddress) {
        try {
            const query = `
        from(bucket: "${this.bucket}")
          |> range(start: -30d)
          |> filter(fn: (r) => r._measurement == "candles")
          |> filter(fn: (r) => r.token_address == "${tokenAddress.toLowerCase()}")
          |> count()
      `;
            const result = await this.queryApi.collectRows(query);
            if (result.length > 0) {
                return parseInt(result[0]._value);
            }
            return 0;
        }
        catch (error) {
            utils_1.logger.error('Failed to get record count', error, { tokenAddress });
            return 0;
        }
    }
    /**
     * Close the InfluxDB connection
     */
    async close() {
        await this.writeApi.close();
        utils_1.logger.info('InfluxDB connection closed');
    }
}
exports.InfluxDBOHLCVClient = InfluxDBOHLCVClient;
// Export singleton instance
exports.influxDBClient = new InfluxDBOHLCVClient();
//# sourceMappingURL=influxdb-client.js.map