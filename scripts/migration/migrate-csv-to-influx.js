const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');

// Import our InfluxDB client
const { influxDBClient } = require('../src/storage/influxdb-client');

const OHLCV_DIR = path.join(__dirname, '../data/raw/brook_ohlcv');
const MIGRATION_LOG = path.join(__dirname, '../migration_log.json');

/**
 * Parse filename to extract token information
 */
function parseFilename(filename) {
  // Remove .csv extension
  const nameWithoutExt = filename.replace('.csv', '');
  
  // Split by underscore
  const parts = nameWithoutExt.split('_');
  
  if (parts.length >= 2) {
    const symbol = parts[0];
    const address = parts[1];
    const chain = parts[2] || 'solana'; // Default to solana if not specified
    
    return {
      symbol,
      address,
      chain
    };
  }
  
  return {
    symbol: 'UNKNOWN',
    address: 'UNKNOWN',
    chain: 'solana'
  };
}

/**
 * Load and parse CSV file
 */
async function loadCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const csvContent = fs.readFileSync(filePath, 'utf8');
    
    parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    }, (err, records) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Convert to OHLCV format
      const ohlcvData = records.map(record => ({
        timestamp: parseInt(record.Timestamp),
        dateTime: new Date(parseInt(record.Timestamp)),
        open: parseFloat(record.Open),
        high: parseFloat(record.High),
        low: parseFloat(record.Low),
        close: parseFloat(record.Close),
        volume: parseFloat(record.Volume) || 0
      }));
      
      resolve(ohlcvData);
    });
  });
}

/**
 * Migrate a single CSV file to InfluxDB
 */
async function migrateCSVFile(filename) {
  try {
    console.log(`📄 Processing ${filename}...`);
    
    const filePath = path.join(OHLCV_DIR, filename);
    const tokenInfo = parseFilename(filename);
    const ohlcvData = await loadCSVFile(filePath);
    
    console.log(`  📊 Found ${ohlcvData.length} records for ${tokenInfo.symbol} (${tokenInfo.address})`);
    
    // Write to InfluxDB
    await influxDBClient.writeOHLCVData(
      tokenInfo.address,
      tokenInfo.symbol,
      tokenInfo.chain,
      ohlcvData
    );
    
    console.log(`  ✅ Successfully migrated ${ohlcvData.length} records`);
    
    return {
      filename,
      symbol: tokenInfo.symbol,
      address: tokenInfo.address,
      chain: tokenInfo.chain,
      recordCount: ohlcvData.length,
      success: true
    };
    
  } catch (error) {
    console.error(`  ❌ Failed to migrate ${filename}:`, error.message);
    
    return {
      filename,
      symbol: 'UNKNOWN',
      address: 'UNKNOWN',
      chain: 'solana',
      recordCount: 0,
      success: false,
      error: error.message
    };
  }
}

/**
 * Validate migration by comparing record counts
 */
async function validateMigration(results) {
  console.log('\n🔍 Validating migration...');
  
  let totalMigrated = 0;
  let totalValidated = 0;
  
  for (const result of results) {
    if (result.success) {
      totalMigrated += result.recordCount;
      
      // Query InfluxDB to verify record count
      const influxCount = await influxDBClient.getTokenRecordCount(result.address);
      totalValidated += influxCount;
      
      if (influxCount === result.recordCount) {
        console.log(`  ✅ ${result.symbol}: ${influxCount} records validated`);
      } else {
        console.log(`  ⚠️ ${result.symbol}: Expected ${result.recordCount}, got ${influxCount}`);
      }
    }
  }
  
  console.log(`\n📊 Migration Summary:`);
  console.log(`  📄 Total CSV records: ${totalMigrated}`);
  console.log(`  🗄️ Total InfluxDB records: ${totalValidated}`);
  console.log(`  ✅ Validation: ${totalMigrated === totalValidated ? 'PASSED' : 'FAILED'}`);
  
  return totalMigrated === totalValidated;
}

/**
 * Main migration function
 */
async function migrateCSVToInfluxDB() {
  console.log('🚀 Starting CSV to InfluxDB migration...');
  
  try {
    // Initialize InfluxDB
    await influxDBClient.initialize();
    
    // Get all CSV files
    const files = fs.readdirSync(OHLCV_DIR).filter(file => file.endsWith('.csv'));
    console.log(`📁 Found ${files.length} CSV files to migrate`);
    
    if (files.length === 0) {
      console.log('❌ No CSV files found in', OHLCV_DIR);
      return;
    }
    
    // Migrate files in batches
    const batchSize = 5;
    const results = [];
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)}`);
      
      const batchPromises = batch.map(file => migrateCSVFile(file));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Save migration log
    const migrationLog = {
      timestamp: new Date().toISOString(),
      totalFiles: files.length,
      successfulFiles: results.filter(r => r.success).length,
      failedFiles: results.filter(r => !r.success).length,
      totalRecords: results.reduce((sum, r) => sum + r.recordCount, 0),
      results: results
    };
    
    fs.writeFileSync(MIGRATION_LOG, JSON.stringify(migrationLog, null, 2));
    console.log(`📋 Migration log saved to: ${MIGRATION_LOG}`);
    
    // Validate migration
    const isValid = await validateMigration(results);
    
    // Print summary
    console.log('\n🎉 === MIGRATION COMPLETE ===');
    console.log(`📄 Files processed: ${files.length}`);
    console.log(`✅ Successful: ${results.filter(r => r.success).length}`);
    console.log(`❌ Failed: ${results.filter(r => !r.success).length}`);
    console.log(`📊 Total records: ${results.reduce((sum, r) => sum + r.recordCount, 0)}`);
    console.log(`🔍 Validation: ${isValid ? 'PASSED' : 'FAILED'}`);
    
    if (!isValid) {
      console.log('\n⚠️ Validation failed! Please check the migration log for details.');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await influxDBClient.close();
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateCSVToInfluxDB().catch(console.error);
}

module.exports = { migrateCSVToInfluxDB };
