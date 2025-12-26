#!/usr/bin/env ts-node
/**
 * Diagnose Birdeye API Usage
 * 
 * Shows:
 * - Total requests by endpoint type
 * - Rate limit usage
 * - Active keys
 * - Credit usage
 */

import { getBirdeyeClient } from '@quantbot/api-clients';

async function main() {
  const client = getBirdeyeClient();
  
  console.log('=== Birdeye API Usage Diagnostics ===\n');
  
  // Get usage stats
  const totalRequests = client.getTotalRequests();
  const creditStats = client.getCreditUsageStats();
  const keyUsage = client.getAPIKeyUsage();
  const activeKeys = client.getActiveKeysCount();
  const totalKeys = keyUsage.length;
  
  console.log('📊 Request Statistics:');
  console.log(`  Total Requests: ${totalRequests.toLocaleString()}`);
  console.log(`  Active Keys: ${activeKeys}/${totalKeys}`);
  console.log(`  Credit Usage: ${creditStats.creditsUsed.toLocaleString()}/${creditStats.totalCredits.toLocaleString()} (${creditStats.percentage.toFixed(2)}%)`);
  console.log(`  Credits Remaining: ${creditStats.creditsRemaining.toLocaleString()}`);
  
  console.log('\n🔑 API Key Details:');
  keyUsage.forEach((usage, index) => {
    const status = usage.isActive ? '✅' : '❌';
    console.log(`  Key ${index + 1}: ${status} ${usage.requestsUsed} requests, ${usage.estimatedCreditsUsed} credits, ${usage.consecutiveFailures} consecutive failures`);
  });
  
  console.log('\n⚠️  Rate Limit Status:');
  const rateLimitConfig = {
    maxRequests: 3000,
    windowMs: 60000, // 1 minute
  };
  const requestsPerSecond = totalRequests > 0 ? (totalRequests / (Date.now() / 1000)) : 0;
  const requestsPerMinute = requestsPerSecond * 60;
  const utilizationPercent = (requestsPerMinute / rateLimitConfig.maxRequests) * 100;
  
  console.log(`  Limit: ${rateLimitConfig.maxRequests} req/min`);
  console.log(`  Current Rate: ${requestsPerMinute.toFixed(2)} req/min`);
  console.log(`  Utilization: ${utilizationPercent.toFixed(2)}%`);
  
  if (utilizationPercent >= 90) {
    console.log('  ⚠️  WARNING: Rate limit utilization is very high!');
  }
  
  console.log('\n💡 Recommendations:');
  if (totalRequests > 10000) {
    console.log('  - You\'ve made a lot of requests today');
    console.log('  - Consider using storage/cache more to reduce API calls');
    console.log('  - Check coverage before fetching OHLCV data');
  }
  
  if (activeKeys < totalKeys) {
    console.log(`  - ${totalKeys - activeKeys} keys are inactive`);
    console.log('  - Check if keys are rate-limited or invalid');
  }
  
  if (creditStats.percentage >= 80) {
    console.log('  - ⚠️  Approaching credit limit!');
    console.log('  - Consider reducing API usage');
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});


