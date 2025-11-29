/**
 * Script to fetch and store OHLCV candles for all LSY calls listed in a CSV file.
 * Improvements:
 *   - Added descriptive comments throughout for maintainability and clarity.
 *   - Modularized repeated logic into helper functions.
 *   - Avoided code duplication for result object creation.
 *   - Clearly separated IO, processing, and reporting logic.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const { OHLCVIngestionService } = require('../dist/services/ohlcv-ingestion');

// File paths for input and output
const LSY_CALLS_CSV = path.join(__dirname, '../data/exports/csv/lsy_calls.csv');
const OUTPUT_LOG = path.join(__dirname, '../data/exports/lsy_ohlcv_fetch_log.json');

// Single instance of our OHLCV ingestion service
const ingestionService = new OHLCVIngestionService();

/**
 * Parses the CSV at the given path and returns an array of records.
 * @param {string} csvPath - Path to the CSV file to parse.
 * @returns {Promise<Array>} - Resolves with array of record objects.
 */
function parseCSV(csvPath) {
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  return new Promise((resolve, reject) => {
    parse(csvContent, { columns: true, skip_empty_lines: true }, (err, records) => {
      if (err) reject(err);
      else resolve(records);
    });
   });
}

/**
 * Writes the given object to a file as pretty-printed JSON.
 * @param {string} filePath - Where to write the file.
 * @param {object} data - The data to write.
 */
function writeJSONLog(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Utility to create a result object for processing.
 */
function buildResult(call, extra) {
  return {
    tokenAddress: call.tokenAddress,
    tokenSymbol: call.tokenSymbol || 'UNKNOWN',
    chain: call.chain,
    alertTime: call.timestamp,
    ...extra
  };
}

/**
 * Delay utility to control async rate where needed.
 * @param {number} ms - Milliseconds to delay.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Filters out "fake" LSY calls, e.g. any caller with '4444' in their token address.
 * @param {Array} records - Raw records parsed from CSV.
 * @returns {Array} - Filtered valid records.
 */
function filterValidRecords(records) {
  return records.filter(record => !record.tokenAddress.includes('4444'));
}

/**
 * Processes a single LSY token call, with fetching and error handling.
 * Modularized for easier unit testing and maintenance.
 * @param {object} call - One LSY token call record.
 * @param {object} svc - Instance of OHLCVIngestionService.
 * @returns {object} - The result object summarizing the process.
 */
async function processLSYCall(call, svc) {
  // Display short status indicator
  process.stdout.write(`\r🔄 Processing ${call._indexStr}: ${call.tokenAddress.substring(0, 30)}...`);
  try {
    // Compute the date range: alert date to 7 days later
    const alertDate = new Date(call.timestamp);
    const endDate = new Date(alertDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    console.log(`\n📅 Fetching data for ${call.tokenAddress}`);
    console.log(`   From: ${alertDate.toISOString()}`);
    console.log(`   To:   ${endDate.toISOString()}`);

    // Actually fetch and store the OHLCV data
    const fetchResult = await svc.fetchAndStoreOHLCV(
      call.tokenAddress,
      alertDate,
      endDate,
      call.tokenSymbol || 'UNKNOWN',
      call.chain
    );

    console.log(`   ✅ ${fetchResult.recordsAdded} records added`);

    return buildResult(call, {
      success: fetchResult.success,
      recordsAdded: fetchResult.recordsAdded,
      error: fetchResult.error
    });

  } catch (error) {
    // Log errors and provide structure for output summary
    console.error(`\n❌ Error processing ${call.tokenAddress}:`, error.message);
    return buildResult(call, {
      success: false,
      recordsAdded: 0,
      error: error.message
    });
  }
}

/**
 * Main function: orchestrates the entire CSV parsing, processing, and reporting pipeline.
 */
async function fetchAllLSYOHLCV() {
  console.log('🚀 Starting OHLCV fetch for all LSY calls...\n');

  try {
    // Ensure the service is ready
    await ingestionService.initialize();

    // Load and parse the CSV
    console.log(`📖 Reading LSY calls from: ${LSY_CALLS_CSV}`);
    const rawRecords = await parseCSV(LSY_CALLS_CSV);

    console.log(`📊 Found ${rawRecords.length} LSY calls\n`);

    // Filter and track valid calls only
    const validRecords = filterValidRecords(rawRecords)
      .map((rec, i) => ({ ...rec, _indexStr: `${i + 1}/${rawRecords.length}` })); // Add easy index tracker for logs

    console.log(`✅ Valid records (excluding fake addresses): ${validRecords.length}\n`);

    const results = [];

    // Process each call sequentially to avoid concurrency issues/rate limits
    for (const call of validRecords) {
      const result = await processLSYCall(call, ingestionService);
      results.push(result);
      // Throttle to avoid rate-limiting (1 second delay)
      await delay(1000);
    }

    // Print summary
    console.log(`\n\n✅ OHLCV fetch complete!`);
    console.log(`📊 Summary:`);
    console.log(`   Total calls: ${validRecords.length}`);
    console.log(`   Successful: ${results.filter(r => r.success).length}`);
    console.log(`   Failed: ${results.filter(r => !r.success).length}`);
    console.log(`   Total records added: ${results.reduce((sum, r) => sum + (r.recordsAdded || 0), 0)}`);

    // Save results log (for review and potential troubleshooting)
    writeJSONLog(OUTPUT_LOG, results);
    console.log(`\n📝 Results saved to: ${OUTPUT_LOG}`);

    // Report failed records
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      console.log(`\n❌ Failed addresses:`);
      failed.forEach(f => console.log(`   - ${f.tokenAddress} (${f.chain})`));
    }

    // Cleanup
    await ingestionService.close();

  } catch (error) {
    // Top-level error handler and resource cleanup
    console.error('❌ Fatal error:', error);
    await ingestionService.close();
    process.exit(1);
  }
}

// If this script is invoked directly, run the main function.
if (require.main === module) {
  fetchAllLSYOHLCV()
    .then(() => {
      console.log('\n🎉 Script completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

// Exported for testing or modular usage
module.exports = { fetchAllLSYOHLCV };

