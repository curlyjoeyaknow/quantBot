import { InfluxDB, Point, WriteApi, QueryApi } from '@influxdata/influxdb-client';
import { InfluxDBClient } from '@influxdata/influxdb-client-apis';
import { config } from 'dotenv';

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
  private managementApi: InfluxDBClient;
  private bucket: string;
  private org: string;

  constructor() {
    const url = process.env.INFLUX_URL || 'http://localhost:8086';
    const token = process.env.INFLUX_TOKEN || '';
    this.org = process.env.INFLUX_ORG || 'quantbot';
    this.bucket = process.env.INFLUX_BUCKET || 'ohlcv_data';

    this.influxDB = new InfluxDB({ url, token });
    this.writeApi = this.influxDB.getWriteApi(this.org, this.bucket);
    this.queryApi = this.influxDB.getQueryApi(this.org);
    this.managementApi = new InfluxDBClient({ url, token });

    // Configure write options
    this.writeApi.useDefaultTags({
      source: 'quantbot'
    });
  }

  /**
   * Initialize InfluxDB bucket and retention policy
   */
  async initialize(): Promise<void> {
    try {
      console.log('🔧 Initializing InfluxDB...');
      
      // Check if bucket exists
      const bucketsApi = this.managementApi.getBucketsApi();
      const buckets = await bucketsApi.getBuckets({ org: this.org });
      
      const existingBucket = buckets.buckets?.find(b => b.name === this.bucket);
      
      if (!existingBucket) {
        console.log(`📦 Creating bucket: ${this.bucket}`);
        await bucketsApi.postBuckets({
          body: {
            name: this.bucket,
            org: this.org,
            retentionRules: [
              {
                type: 'expire',
                everySeconds: 0 // Infinite retention
              }
            ]
          }
        });
        console.log(`✅ Bucket ${this.bucket} created successfully`);
      } else {
        console.log(`✅ Bucket ${this.bucket} already exists`);
      }

      // Test write and read
      await this.testConnection();
      
    } catch (error) {
      console.error('❌ Failed to initialize InfluxDB:', error);
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
        |> filter(fn: (r) => r._measurement == "connection_test")
        |> limit(n: 1)
    `;

    const result = await this.queryApi.collectRows(query);
    console.log('✅ InfluxDB connection test successful');
  }

  /**
   * Write OHLCV data points to InfluxDB
   */
  async writeOHLCVData(tokenAddress: string, tokenSymbol: string, chain: string, data: OHLCVData[]): Promise<void> {
    try {
      const points: Point[] = data.map(candle => {
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
      
      console.log(`📊 Written ${data.length} OHLCV records for ${tokenSymbol} (${tokenAddress})`);
    } catch (error) {
      console.error(`❌ Failed to write OHLCV data for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Query OHLCV data from InfluxDB
   */
  async getOHLCVData(tokenAddress: string, startTime: Date, endTime: Date, interval: string = '1m'): Promise<OHLCVData[]> {
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
      
      return result.map((row: any) => ({
        timestamp: new Date(row._time).getTime(),
        dateTime: new Date(row._time),
        open: parseFloat(row.open) || 0,
        high: parseFloat(row.high) || 0,
        low: parseFloat(row.low) || 0,
        close: parseFloat(row.close) || 0,
        volume: parseFloat(row.volume) || 0
      }));
    } catch (error) {
      console.error(`❌ Failed to query OHLCV data for ${tokenAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get latest price for a token
   */
  async getLatestPrice(tokenAddress: string): Promise<number> {
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
    } catch (error) {
      console.error(`❌ Failed to get latest price for ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Check if data exists for token in time range
   */
  async hasData(tokenAddress: string, startTime: Date, endTime: Date): Promise<boolean> {
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
    } catch (error) {
      console.error(`❌ Failed to check data existence for ${tokenAddress}:`, error);
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
          |> filter(fn: (r) => r._measurement == "candles")
          |> group(columns: ["token_address", "token_symbol", "chain"])
          |> count()
          |> group()
          |> sort(columns: ["_value"], desc: true)
      `;

      const result = await this.queryApi.collectRows(query);
      
      return result.map((row: any) => ({
        address: row.token_address,
        symbol: row.token_symbol,
        chain: row.chain,
        recordCount: parseInt(row._value),
        firstTimestamp: 0, // Would need separate query for this
        lastTimestamp: 0   // Would need separate query for this
      }));
    } catch (error) {
      console.error('❌ Failed to get available tokens:', error);
      return [];
    }
  }

  /**
   * Get record count for a specific token
   */
  async getTokenRecordCount(tokenAddress: string): Promise<number> {
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
    } catch (error) {
      console.error(`❌ Failed to get record count for ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Close the InfluxDB connection
   */
  async close(): Promise<void> {
    await this.writeApi.close();
    console.log('🔌 InfluxDB connection closed');
  }
}

// Export singleton instance
export const influxDBClient = new InfluxDBOHLCVClient();
