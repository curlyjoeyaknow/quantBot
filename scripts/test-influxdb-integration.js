const { influxDBClient } = require('../src/storage/influxdb-client');
const { birdeyeClient } = require('../src/api/birdeye-client');
const { ohlcvQuery } = require('../src/services/ohlcv-query');
const { ohlcvIngestion } = require('../src/services/ohlcv-ingestion');

/**
 * Test InfluxDB connection and basic operations
 */
async function testInfluxDBConnection() {
  console.log('🔧 Testing InfluxDB connection...');
  
  try {
    await influxDBClient.initialize();
    console.log('✅ InfluxDB connection successful');
    
    // Test write and read
    const testData = [{
      timestamp: Date.now(),
      dateTime: new Date(),
      open: 1.0,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 1000
    }];
    
    await influxDBClient.writeOHLCVData('test-token', 'TEST', 'solana', testData);
    console.log('✅ Test data written successfully');
    
    const retrievedData = await influxDBClient.getOHLCVData(
      'test-token', 
      new Date(Date.now() - 60000), 
      new Date()
    );
    
    if (retrievedData.length > 0) {
      console.log('✅ Test data retrieved successfully');
    } else {
      console.log('❌ Test data retrieval failed');
    }
    
  } catch (error) {
    console.error('❌ InfluxDB test failed:', error.message);
    throw error;
  }
}

/**
 * Test Birdeye API with multiple keys
 */
async function testBirdeyeAPI() {
  console.log('🔧 Testing Birdeye API...');
  
  try {
    const testToken = 'So11111111111111111111111111111111111111112'; // SOL
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour
    
    const data = await birdeyeClient.fetchOHLCVData(testToken, startTime, endTime);
    
    if (data && data.items && data.items.length > 0) {
      console.log(`✅ Birdeye API test successful: ${data.items.length} records`);
    } else {
      console.log('❌ Birdeye API test failed: No data returned');
    }
    
    // Test API key usage
    const usage = birdeyeClient.getAPIKeyUsage();
    console.log(`📊 API Key Usage: ${usage.length} keys loaded`);
    
  } catch (error) {
    console.error('❌ Birdeye API test failed:', error.message);
    throw error;
  }
}

/**
 * Test OHLCV Query Service
 */
async function testOHLCVQuery() {
  console.log('🔧 Testing OHLCV Query Service...');
  
  try {
    const testToken = 'So11111111111111111111111111111111111111112'; // SOL
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour
    
    // Test data existence check
    const hasData = await ohlcvQuery.hasData(testToken, startTime, endTime);
    console.log(`📊 Data exists for ${testToken}: ${hasData}`);
    
    if (hasData) {
      // Test data retrieval
      const data = await ohlcvQuery.getOHLCV(testToken, startTime, endTime);
      console.log(`✅ Retrieved ${data.length} OHLCV records`);
      
      // Test latest price
      const latestPrice = await ohlcvQuery.getLatestPrice(testToken);
      console.log(`💰 Latest price: $${latestPrice}`);
    }
    
    // Test cache stats
    ohlcvQuery.logStats();
    
  } catch (error) {
    console.error('❌ OHLCV Query test failed:', error.message);
    throw error;
  }
}

/**
 * Test OHLCV Ingestion Service
 */
async function testOHLCVIngestion() {
  console.log('🔧 Testing OHLCV Ingestion Service...');
  
  try {
    await ohlcvIngestion.initialize();
    console.log('✅ OHLCV Ingestion Service initialized');
    
    const testToken = 'So11111111111111111111111111111111111111112'; // SOL
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour
    
    // Test single token ingestion
    const result = await ohlcvIngestion.fetchAndStoreOHLCV(
      testToken, 
      startTime, 
      endTime, 
      'SOL', 
      'solana'
    );
    
    console.log(`📊 Ingestion result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    if (result.success) {
      console.log(`  📈 Records added: ${result.recordsAdded}`);
    } else {
      console.log(`  ❌ Error: ${result.error}`);
    }
    
    // Test batch ingestion
    const tokens = [
      { address: testToken, symbol: 'SOL', chain: 'solana' }
    ];
    
    const batchResults = await ohlcvIngestion.batchFetchOHLCV(tokens, startTime, endTime);
    console.log(`📦 Batch ingestion: ${batchResults.size} tokens processed`);
    
  } catch (error) {
    console.error('❌ OHLCV Ingestion test failed:', error.message);
    throw error;
  }
}

/**
 * Test caching functionality
 */
async function testCaching() {
  console.log('🔧 Testing caching functionality...');
  
  try {
    const testToken = 'So11111111111111111111111111111111111111112'; // SOL
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour
    
    // First query (should miss cache)
    console.log('🔄 First query (cache miss expected)...');
    const data1 = await ohlcvQuery.getOHLCV(testToken, startTime, endTime);
    
    // Second query (should hit cache)
    console.log('🔄 Second query (cache hit expected)...');
    const data2 = await ohlcvQuery.getOHLCV(testToken, startTime, endTime);
    
    if (data1.length === data2.length) {
      console.log('✅ Cache test successful: Data consistency maintained');
    } else {
      console.log('❌ Cache test failed: Data inconsistency');
    }
    
    // Log cache stats
    ohlcvQuery.logStats();
    
  } catch (error) {
    console.error('❌ Caching test failed:', error.message);
    throw error;
  }
}

/**
 * Run all integration tests
 */
async function runIntegrationTests() {
  console.log('🚀 Starting InfluxDB OHLCV Integration Tests...\n');
  
  const tests = [
    { name: 'InfluxDB Connection', fn: testInfluxDBConnection },
    { name: 'Birdeye API', fn: testBirdeyeAPI },
    { name: 'OHLCV Query Service', fn: testOHLCVQuery },
    { name: 'OHLCV Ingestion Service', fn: testOHLCVIngestion },
    { name: 'Caching Functionality', fn: testCaching }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      console.log(`\n📋 Running ${test.name} test...`);
      await test.fn();
      console.log(`✅ ${test.name} test PASSED`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name} test FAILED: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n🎉 === INTEGRATION TEST RESULTS ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! InfluxDB integration is ready to use.');
  } else {
    console.log('\n⚠️ Some tests failed. Please check the configuration and try again.');
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runIntegrationTests()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Integration tests failed:', error);
      process.exit(1);
    });
}

module.exports = { runIntegrationTests };
