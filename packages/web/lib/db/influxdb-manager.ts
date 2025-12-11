/**
 * InfluxDB Manager for Web Dashboard
 * Provides access to InfluxDB OHLCV data
 */

import { InfluxDB, QueryApi } from '@influxdata/influxdb-client';

const INFLUX_URL = process.env.INFLUX_URL || 'http://localhost:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || '';
const INFLUX_ORG = process.env.INFLUX_ORG || 'quantbot';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'ohlcv_data';

export interface OHLCVData {
  timestamp: number;
  dateTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

class InfluxDBClient {
  private influxDB: InfluxDB;
  private queryApi: QueryApi;

  constructor() {
    this.influxDB = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
    this.queryApi = this.influxDB.getQueryApi(INFLUX_ORG);
  }

  async getOHLCVData(
    tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string = '1m'
  ): Promise<OHLCVData[]> {
    try {
      const query = `
        from(bucket: "${INFLUX_BUCKET}")
          |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})
          |> filter(fn: (r) => r._measurement == "candles")
          |> filter(fn: (r) => r.token_address == "${tokenAddress.toLowerCase()}")
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> sort(columns: ["_time"])
      `;

      const result: OHLCVData[] = [];

      await this.queryApi.queryRows(query, {
        next(row: any, tableMeta: any) {
          const o = tableMeta.toObject(row);
          result.push({
            timestamp: new Date(o._time).getTime(),
            dateTime: new Date(o._time),
            open: parseFloat(o.open) || 0,
            high: parseFloat(o.high) || 0,
            low: parseFloat(o.low) || 0,
            close: parseFloat(o.close) || 0,
            volume: parseFloat(o.volume) || 0,
          });
        },
        error(error: Error) {
          console.error('InfluxDB query error:', error);
        },
        complete() {
          // Query complete
        },
      });

      return result;
    } catch (error) {
      console.error('Error querying InfluxDB:', error);
      return [];
    }
  }
}

// Create and export a singleton instance
export const influxDBOHLCVClient = new InfluxDBClient();

