import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../src/simulation/candles';

async function checkGiggle() {
  const tokenAddress = '0x20d6015660b3fe52e6690a889b5c51f69902ce0e';
  
  // Check September 10th (if someone had called it then)
  const dates = [
    DateTime.fromISO('2025-09-10T00:00:00.000Z'),
    DateTime.fromISO('2025-09-10T12:00:00.000Z')
  ];
  
  for (const alertDate of dates) {
    const endDate = alertDate.plus({ days: 60 });

    console.log(`\n🔍 Checking GIGGLE (BSC) from ${alertDate.toFormat('yyyy-MM-dd HH:mm')}...\n`);
    console.log(`Token: ${tokenAddress}`);

    const candles = await fetchHybridCandles(tokenAddress, alertDate, endDate, 'bsc');

    if (!candles || candles.length === 0) {
      console.log('❌ No candles found');
      continue;
    }

    console.log(`✅ Found ${candles.length} candles`);

    const entryPrice = candles[0].close;
    let maxMultiplier = 1.0;
    let maxCandle = candles[0];
    let maxIndex = 0;

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const multiplier = candle.high / entryPrice;
      if (multiplier > maxMultiplier) {
        maxMultiplier = multiplier;
        maxCandle = candle;
        maxIndex = i;
      }
    }

    console.log(`📊 Results:`);
    console.log(`   Entry Price: $${entryPrice.toFixed(8)}`);
    console.log(`   Max High: $${maxCandle.high.toFixed(8)}`);
    console.log(`   Maximum Multiplier: ${maxMultiplier.toFixed(2)}x`);
    console.log(`   Final Price: $${candles[candles.length - 1].close.toFixed(8)}`);
    console.log(`   Final Multiplier: ${(candles[candles.length - 1].close / entryPrice).toFixed(2)}x`);
  }
}

checkGiggle().catch(console.error);

