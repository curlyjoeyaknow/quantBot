# InfluxDB OHLCV Integration Setup Guide

## Environment Variables Required

Add these variables to your `.env` file:

```bash
# InfluxDB Configuration
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=your-admin-token
INFLUX_ORG=quantbot
INFLUX_BUCKET=ohlcv_data
INFLUX_USERNAME=admin
INFLUX_PASSWORD=your-secure-password

# Birdeye API Keys (6 keys for rotation)
BIRDEYE_API_KEY_1=dec8084b90724ffe949b68d0a18359d6
BIRDEYE_API_KEY_2=your-second-key
BIRDEYE_API_KEY_3=your-third-key
BIRDEYE_API_KEY_4=your-fourth-key
BIRDEYE_API_KEY_5=your-fifth-key
BIRDEYE_API_KEY_6=your-sixth-key
```

## Setup Instructions

### 1. Start InfluxDB

```bash
docker-compose up -d influxdb
```

### 2. Initialize InfluxDB

- Visit <http://localhost:8086>
- Create admin user and organization
- Copy the admin token to your `.env` file

### 3. Run Migration

```bash
node scripts/migration/migrate-csv-to-influx.js
```

### 4. Test Integration

```bash
node scripts/test-influxdb-integration.js
```

## API Key Setup

You need Birdeye API keys for rotation (3.18M total credits):

1. Get keys from <https://birdeye.so/>
2. Add them to `.env` as `BIRDEYE_API_KEY_1`, `BIRDEYE_API_KEY_2`, etc.
3. The system will automatically rotate between keys and monitor credit usage
4. **Credit Conservation**: Extended cache TTL (30min-2hrs) and reduced batch sizes to minimize API calls

## Usage in Simulations

Replace CSV-based OHLCV loading with:

```javascript
const { ohlcvQuery } = require('./src/services/ohlcv-query');

// Get OHLCV data
const data = await ohlcvQuery.getOHLCV(tokenAddress, startTime, endTime);

// Pre-fetch for simulation
const batchData = await ohlcvQuery.prefetchForSimulation(tokens, startTime, endTime);
```
