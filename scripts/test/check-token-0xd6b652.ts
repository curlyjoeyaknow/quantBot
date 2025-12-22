import { DateTime } from 'luxon';
import { fetchHybridCandles } from '@quantbot/ohlcv';

async function checkToken() {
  const tokenAddress = '0xd6B652AECB704b0AEBEc6317315afb90ba641d57';
  const chain = 'bsc';

  // Check the actual call date from CSV (September 21st) and also check Sept 10
  const dates = [
    DateTime.fromISO('2025-09-10T00:00:00.000Z'),
    DateTime.fromISO('2025-09-21T17:09:00.000Z'), // Actual call from CSV
  ];

  console.log(`🔍 Checking token ${tokenAddress} (BSC) around September 10th...\n`);

  for (const alertDate of dates) {
    const endDate = alertDate.plus({ days: 60 });

    console.log(`\nChecking from ${alertDate.toFormat('yyyy-MM-dd HH:mm')}...`);

    try {
      const candles = await fetchHybridCandles(tokenAddress, alertDate, endDate, chain);

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

      const finalMultiplier = candles[candles.length - 1].close / entryPrice;

      console.log(`📊 Results:`);
      console.log(`   Entry Price: $${entryPrice.toFixed(8)}`);
      console.log(`   Max High: $${maxCandle.high.toFixed(8)}`);
      console.log(`   Maximum Multiplier: ${maxMultiplier.toFixed(2)}x`);
      console.log(`   Final Price: $${candles[candles.length - 1].close.toFixed(8)}`);
      console.log(`   Final Multiplier: ${finalMultiplier.toFixed(2)}x`);

      if (maxMultiplier > 50) {
        console.log(`   🚀 BIG WINNER!`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
}

checkToken().catch(console.error);
