const axios = require('axios');

// Test script to verify Birdeye OHLCV API works
async function testBirdeyeAPI() {
  const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
  
  // Test with a known token (SOL) and recent dates
  const testAddress = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
  const chain = 'solana';
  
  // Use recent dates (last week)
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  
  console.log('Testing Birdeye OHLCV API...');
  console.log(`Token: ${testAddress}`);
  console.log(`Chain: ${chain}`);
  console.log(`Start: ${startTime.toISOString()}`);
  console.log(`End: ${endTime.toISOString()}`);
  
  try {
    const response = await axios.get(`https://public-api.birdeye.so/defi/v3/ohlcv`, {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain
      },
      params: {
        address: testAddress,
        type: '5m',
        currency: 'usd',
        ui_amount_mode: 'raw',
        time_from: Math.floor(startTime.getTime() / 1000),
        time_to: Math.floor(endTime.getTime() / 1000),
        mode: 'range',
        padding: true,
        outlier: true
      }
    });

    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
    if (response.data.success && response.data.data.items) {
      console.log(`✅ Success! Found ${response.data.data.items.length} candles`);
      console.log('First candle:', response.data.data.items[0]);
    } else {
      console.log('❌ No data returned');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testBirdeyeAPI();
