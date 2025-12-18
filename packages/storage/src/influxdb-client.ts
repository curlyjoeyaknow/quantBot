import { InfluxDB, Point, WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { BucketsAPI } from '@influxdata/influxdb-client-apis';
import { config } from 'dotenv';
import { logger, ValidationError } from '@quantbot/utils';

config();

export interface OHLCVData {
  timestamp: number;
  dateTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  chain: string;
  recordCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export class InfluxDBOHLCVClient {
  private influxDB: InfluxDB;
  private writeApi: WriteApi;
  private queryApi: QueryApi;
  private managementApi: BucketsAPI;
  private bucket: string;
  private org: string;

  constructor() {
    const url = process.env.INFLUX_URL || 'http://localhost:8086';
    const token = process.env.INFLUX_TOKEN || '';
    this.org = process.env.INFLUX_ORG || 'quantbot';
    this.bucket = process.env.INFLUX_BUCKET || 'ohlcv_data';

    this.influxDB = new InfluxDB({ url: url, token: token });
    this.writeApi = this.influxDB.getWriteApi(this.org, this.bucket);
    this.queryApi = this.influxDB.getQueryApi(this.org);
    this.managementApi = new BucketsAPI(this.influxDB);

    // Configure write options
    this.writeApi.useDefaultTags({
      source: 'quantbot',
    });
  }

  /**
   * Initialize InfluxDB bucket and retention policy
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing InfluxDB...');

      // Check if bucket exists
      const buckets = await this.managementApi.getBuckets({ org: this.org });

      const existingBucket = buckets?.buckets?.find(
        (b: { name?: string }) => b.name === this.bucket
      );

      if (!existingBucket) {
        logger.info('Creating bucket', { bucket: this.bucket });
        await this.managementApi.postBuckets({
          body: {
            name: this.bucket,
            orgID: this.org,
            retentionRules: [
              {
                type: 'expire',
                everySeconds: 0, // Infinite retention
              },
            ],
          },
        });
        logger.info('Bucket created successfully', { bucket: this.bucket });
      } else {
        logger.info('Bucket already exists', { bucket: this.bucket });
      }

      // Test write and read
      await this.testConnection();
    } catch (error) {
      logger.error('Failed to initialize InfluxDB', error as Error);
      throw error;
    }
  }

  /**
   * Test InfluxDB connection with a simple write and read
   */
  private async testConnection(): Promise<void> {
    const testPoint = new Point('connection_test')
      .tag('test', 'true')
      .floatField('value', 1.0)
      .timestamp(new Date());

    this.writeApi.writePoint(testPoint);
    await this.writeApi.flush();

    const query = `
      from(bucket: "${this.bucket}")
        |> range(start: -1m)
        |> filter(fn: (r) => r._measurement === "connection_test")
        |> limit(n: 1)
    `;

    const result = await this.queryApi.collectRows(query);
    logger.info('InfluxDB connection test successful');
  }

  /**
   * Write OHLCV data points to InfluxDB
   */
  async writeOHLCVData(
    tokenAddress: string,
    tokenSymbol: string,
    chain: string,
    data: OHLCVData[]
  ): Promise<void> {
    try {
      const points: Point[] = data.map((candle) => {
        return new Point('candles')
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

      logger.info('Written OHLCV records', { recordCount: data.length, tokenSymbol, tokenAddress });
    } catch (error) {
      logger.error('Failed to write OHLCV data', error as Error, { tokenAddress });
      throw error;
    }
  }

  /**
   * Validate token address format to prevent injection
   */
  private validateTokenAddress(address: string): void {
    // Token addresses should be 32-44 characters, alphanumeric (base58 for Solana)
    // Allow only alphanumeric characters and common base58 characters
    if (!/^[A-Za-z0-9]{32,44}$/.test(address)) {
      throw new ValidationError(`Invalid token address format: ${address.substring(0, 20)}...`, {
        address: address.substring(0, 20) + '...',
        addressLength: address.length,
        expectedFormat: '32-44 alphanumeric characters',
      });
    }
  }

  /**
   * Escape string for Flux query (basic escaping for double quotes and backslashes)
   */
  private escapeFluxString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * Query OHLCV data from InfluxDB
   */
  async getOHLCVData(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m'
  ): Promise<OHLCVData[]> {
    // Validate inputs to prevent injection
    this.validateTokenAddress(tokenAddress);

    // Validate dates are valid Date objects
    if (
      !(startTime instanceof Date) ||
      !(endTime instanceof Date) ||
      isNaN(startTime.getTime()) ||
      isNaN(endTime.getTime())
    ) {
      throw new ValidationError('Invalid date range provided', {
        startTime,
        endTime,
        startTimeType: typeof startTime,
        endTimeType: typeof endTime,
      });
    }

    try {
      // Escape token address for use in Flux query
      const escapedTokenAddress = this.escapeFluxString(tokenAddress.toLowerCase());
      const startISO = startTime.toISOString();
      const endISO = endTime.toISOString();

      const query = `
        from(bucket: "${this.bucket}")
          |> range(start: ${startISO}, stop: ${endISO})
          |> filter(fn: (r) => r._measurement === "candles")
          |> filter(fn: (r) => r.token_address === "${escapedTokenAddress}")
          |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> sort(columns: ["_time"])
      `;

      const result = (await this.queryApi.collectRows(query)) as Array<Record<string, unknown>>;

      return result.map((row) => ({
        timestamp: new Date(String(row._time)).getTime(),
        dateTime: new Date(String(row._time)),
        open: parseFloat(String(row.open)) || 0,
        high: parseFloat(String(row.high)) || 0,
        low: parseFloat(String(row.low)) || 0,
        close: parseFloat(String(row.close)) || 0,
        volume: parseFloat(String(row.volume)) || 0,
      }));
    } catch (error) {
      logger.error('Failed to query OHLCV data', error as Error, { tokenAddress });
      throw error;
    }
  }

  /**
   * Get latest price for a token
   */
  async getLatestPrice(tokenAddress: string): Promise<number> {
    // Validate inputs to prevent injection
    this.validateTokenAddress(tokenAddress);

    try {
      // Escape token address for use in Flux query
      const escapedTokenAddress = this.escapeFluxString(tokenAddress.toLowerCase());

      const query = `
        from(bucket: "${this.bucket}")
          |> range(start: -1h)
          |> filter(fn: (r) => r._measurement === "candles")
          |> filter(fn: (r) => r.token_address === "${escapedTokenAddress}")
          |> filter(fn: (r) => r._field === "close")
          |> last()
      `;

      const result = (await this.queryApi.collectRows(query)) as Array<Record<string, unknown>>;

      if (result.length > 0) {
        return parseFloat(String(result[0]?._value));
      }

      return 0;
    } catch (error) {
      logger.error('Failed to get latest price', error as Error, { tokenAddress });
      return 0;
    }
  }

  /**
   * Check if data exists for token in time range
   */
  async hasData(tokenAddress: string, startTime: Date, endTime: Date): Promise<boolean> {
    // Validate inputs to prevent injection
    this.validateTokenAddress(tokenAddress);

    // Validate dates are valid Date objects
    if (
      !(startTime instanceof Date) ||
      !(endTime instanceof Date) ||
      isNaN(startTime.getTime()) ||
      isNaN(endTime.getTime())
    ) {
      throw new ValidationError('Invalid date range provided', {
        startTime,
        endTime,
        startTimeType: typeof startTime,
        endTimeType: typeof endTime,
      });
    }

    try {
      // Escape token address for use in Flux query
      const escapedTokenAddress = this.escapeFluxString(tokenAddress.toLowerCase());
      const startISO = startTime.toISOString();
      const endISO = endTime.toISOString();

      const query = `
        from(bucket: "${this.bucket}")
          |> range(start: ${startISO}, stop: ${endISO})
          |> filter(fn: (r) => r._measurement === "candles")
          |> filter(fn: (r) => r.token_address === "${escapedTokenAddress}")
          |> limit(n: 1)
      `;

      const result = (await this.queryApi.collectRows(query)) as Array<Record<string, unknown>>;
      return result.length > 0;
    } catch (error) {
      logger.error('Failed to check data existence', error as Error, { tokenAddress });
      return false;
    }
  }

  /**
   * Get all tokens with available data
   */
  async getAvailableTokens(): Promise<TokenInfo[]> {
    try {
      const query = `
        from(bucket: "${this.bucket}")
          |> range(start: -30d)
          |> filter(fn: (r) => r._measurement === "candles")
          |> group(columns: ["token_address", "token_symbol", "chain"])
          |> count()
          |> group()
          |> sort(columns: ["_value"], desc: true)
      `;

      const result = (await this.queryApi.collectRows(query)) as Array<Record<string, unknown>>;

      return result.map((row) => ({
        address: String(row.token_address ?? ''),
        symbol: String(row.token_symbol ?? ''),
        chain: String(row.chain ?? ''),
        recordCount: parseInt(row._value),
        firstTimestamp: 0, // Would need separate query for this
        lastTimestamp: 0, // Would need separate query for this
      }));
    } catch (error) {
      logger.error('Failed to get available tokens', error as Error);
      return [];
    }
  }

  /**
   * Get record count for a specific token
   */
  async getTokenRecordCount(tokenAddress: string): Promise<number> {
    // Validate inputs to prevent injection
    this.validateTokenAddress(tokenAddress);

    try {
      // Escape token address for use in Flux query
      const escapedTokenAddress = this.escapeFluxString(tokenAddress.toLowerCase());

      const query = `
        from(bucket: "${this.bucket}")
          |> range(start: -30d)
          |> filter(fn: (r) => r._measurement === "candles")
          |> filter(fn: (r) => r.token_address === "${escapedTokenAddress}")
          |> count()
      `;

      const result = (await this.queryApi.collectRows(query)) as Array<Record<string, unknown>>;

      if (result.length > 0) {
        return parseInt(String(result[0]?._value));
      }

      return 0;
    } catch (error) {
      logger.error('Failed to get record count', error as Error, { tokenAddress });
      return 0;
    }
  }

  /**
   * Close the InfluxDB connection
   */
  async close(): Promise<void> {
    await this.writeApi.close();
    logger.info('InfluxDB connection closed');
  }
}

// Export singleton instance
export const influxDBClient = new InfluxDBOHLCVClient();
