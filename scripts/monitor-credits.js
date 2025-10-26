const { birdeyeClient } = require('../src/api/birdeye-client');
const { influxDBClient } = require('../src/storage/influxdb-client');
const { ohlcvQuery } = require('../src/services/ohlcv-query');

/**
 * Monitor Birdeye API credit usage and system health
 */
async function monitorCredits() {
  console.log('💳 === BIRDEYE API CREDIT MONITOR ===\n');
  
  try {
    // Get comprehensive credit usage report
    birdeyeClient.logCreditUsageReport();
    
    // Check if approaching limit
    if (birdeyeClient.isApproachingCreditLimit()) {
      console.log('⚠️ WARNING: You are approaching your credit limit!');
      console.log('💡 Recommendations:');
      console.log('   - Reduce simulation frequency');
      console.log('   - Use longer cache TTL');
      console.log('   - Focus on fewer tokens per simulation');
      console.log('   - Consider upgrading your Birdeye plan\n');
    } else {
      console.log('✅ Credit usage is within safe limits\n');
    }
    
    // Test InfluxDB connection
    console.log('🔍 Testing InfluxDB connection...');
    await influxDBClient.initialize();
    
    // Get available tokens count
    const availableTokens = await ohlcvQuery.getAvailableTokens();
    console.log(`📊 Tokens with OHLCV data: ${availableTokens.length}`);
    
    if (availableTokens.length > 0) {
      console.log('📋 Sample tokens:');
      availableTokens.slice(0, 5).forEach(token => {
        console.log(`   - ${token.symbol} (${token.address}): ${token.recordCount} records`);
      });
    }
    
    // Cache statistics
    console.log('\n🗄️ Cache Statistics:');
    ohlcvQuery.logStats();
    
  } catch (error) {
    console.error('❌ Credit monitoring failed:', error.message);
  } finally {
    await influxDBClient.close();
  }
}

/**
 * Estimate credit usage for a simulation
 */
function estimateSimulationCredits(tokenCount, hoursPerToken = 24) {
  const requestsPerToken = hoursPerToken * 60; // 1 request per minute
  const totalRequests = tokenCount * requestsPerToken;
  const estimatedCredits = totalRequests * 1; // 1 credit per request estimate
  
  console.log(`\n📊 === SIMULATION CREDIT ESTIMATE ===`);
  console.log(`🎯 Tokens: ${tokenCount}`);
  console.log(`⏰ Hours per token: ${hoursPerToken}`);
  console.log(`📡 Estimated requests: ${totalRequests.toLocaleString()}`);
  console.log(`💳 Estimated credits: ${estimatedCredits.toLocaleString()}`);
  console.log(`📈 Percentage of total: ${((estimatedCredits / 3180000) * 100).toFixed(2)}%`);
  
  if (estimatedCredits > 100000) {
    console.log('⚠️ WARNING: This simulation will use significant credits!');
    console.log('💡 Consider reducing token count or time range');
  }
  
  console.log('=====================================\n');
}

// Run monitoring if this script is executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 2) {
    // Estimate credits for simulation
    const tokenCount = parseInt(args[0]);
    const hoursPerToken = parseInt(args[1]);
    
    if (isNaN(tokenCount) || isNaN(hoursPerToken)) {
      console.log('Usage: node scripts/monitor-credits.js [tokenCount] [hoursPerToken]');
      console.log('Example: node scripts/monitor-credits.js 10 24');
      process.exit(1);
    }
    
    estimateSimulationCredits(tokenCount, hoursPerToken);
  } else {
    // Run full monitoring
    monitorCredits()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error('❌ Monitoring failed:', error);
        process.exit(1);
      });
  }
}

module.exports = { monitorCredits, estimateSimulationCredits };
